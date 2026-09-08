/**
 * SA Recruiters — R2 upload/delete Worker
 * ----------------------------------------
 * Replaces Supabase Storage for the two file buckets the site used:
 *   - candidate-photos  (public upload, from the Talent Pool form + admin)
 *   - daily-tracks       (admin-only upload, MP3s)
 *
 * The Postgres database (agencies, employers, vacancies, candidates, etc.)
 * STAYS in Supabase — this Worker only moves file bytes, which is what was
 * eating the Supabase bandwidth/egress quota.
 *
 * Files are stored in a single R2 bucket under two prefixes:
 *   candidate-photos/<key>.jpg
 *   daily-tracks/<key>.<ext>
 *
 * Reads are served directly from R2's public bucket URL (r2.dev or a
 * custom domain) — this Worker is only involved in writes/deletes so admin
 * auth (Supabase Auth JWT) can be checked before touching storage.
 */

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;   // 3MB
const MAX_TRACK_BYTES = 25 * 1024 * 1024;  // 25MB

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// Validate the admin's Supabase session by asking Supabase who this
// access token belongs to. Keeps auth entirely inside Supabase — this
// Worker never needs its own admin password to manage.
async function isAdminRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': env.SUPABASE_ANON_KEY,
      },
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function randomKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function publicUrlFor(env, key) {
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${base}/${key}`;
}

// One-off: move any pool_candidates.photo_url still pointing at Supabase
// Storage over to R2, and update the row. Runs entirely server-side using
// the calling admin's own Supabase session (RLS applies, same as if the
// admin panel updated the row directly) — no service-role key needed.
async function migratePhotos(request, env, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  const listRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pool_candidates?select=id,photo_url&photo_url=not.is.null`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) {
    return json({ error: 'Could not list candidates', detail: await listRes.text() }, 500, origin);
  }
  const candidates = await listRes.json();

  const toMigrate = candidates.filter(
    (c) => typeof c.photo_url === 'string' && c.photo_url.includes('/storage/v1/object/public/candidate-photos/')
  );

  const results = [];
  for (const c of toMigrate) {
    try {
      const imgRes = await fetch(c.photo_url);
      if (!imgRes.ok) { results.push({ id: c.id, ok: false, reason: `download ${imgRes.status}` }); continue; }
      const bytes = await imgRes.arrayBuffer();

      const key = `candidate-photos/${randomKey()}.jpg`;
      await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      const newUrl = publicUrlFor(env, key);

      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_candidates?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ photo_url: newUrl }),
      });
      if (!patchRes.ok) { results.push({ id: c.id, ok: false, reason: `db update ${patchRes.status}` }); continue; }

      results.push({ id: c.id, ok: true, url: newUrl });
    } catch (e) {
      results.push({ id: c.id, ok: false, reason: e.message });
    }
  }

  return json({
    totalWithPhoto: candidates.length,
    foundOnSupabase: toMigrate.length,
    migrated: results.filter((r) => r.ok).length,
    results,
  }, 200, origin);
}

// One-off: move any base64-embedded logo (agencies.photo / employers.photo)
// over to R2, replacing the column value with a URL. These were never
// Supabase Storage files — they're data: URLs baked straight into the row —
// so this decodes and re-uploads rather than fetching from Supabase.
async function migrateBase64Logos(request, env, origin, table, prefix) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  const listRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?select=id,photo&photo=not.is.null`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) {
    return json({ error: `Could not list ${table}`, detail: await listRes.text() }, 500, origin);
  }
  const rows = await listRes.json();

  const toMigrate = rows.filter((r) => typeof r.photo === 'string' && r.photo.startsWith('data:image'));

  const results = [];
  for (const r of toMigrate) {
    try {
      const match = r.photo.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) { results.push({ id: r.id, ok: false, reason: 'not a recognisable data URL' }); continue; }
      const contentType = match[1];
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

      const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
      const key = `${prefix}/${randomKey()}.${ext}`;
      await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
      const newUrl = publicUrlFor(env, key);

      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ photo: newUrl }),
      });
      if (!patchRes.ok) { results.push({ id: r.id, ok: false, reason: `db update ${patchRes.status}` }); continue; }

      results.push({ id: r.id, ok: true, url: newUrl });
    } catch (e) {
      results.push({ id: r.id, ok: false, reason: e.message });
    }
  }

  return json({
    total: rows.length,
    foundBase64: toMigrate.length,
    migrated: results.filter((x) => x.ok).length,
    results,
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      // ---- Public: candidate photo / agency logo / employer logo upload ----
      // (mirrors old open anon-key behaviour — publicly writable, matches
      // how the site already worked before this migration)
      if (path === '/api/upload/candidate-photo' && request.method === 'POST') {
        const contentType = request.headers.get('Content-Type') || '';
        if (!contentType.startsWith('image/')) {
          return json({ error: 'Only image uploads are allowed.' }, 400, origin);
        }
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) return json({ error: 'Empty file.' }, 400, origin);
        if (bytes.byteLength > MAX_PHOTO_BYTES) {
          return json({ error: 'Photo too large (max 3MB).' }, 413, origin);
        }
        const allowedPrefixes = ['candidate-photos', 'agency-logos', 'employer-logos'];
        const reqPrefix = url.searchParams.get('prefix');
        const prefix = allowedPrefixes.includes(reqPrefix) ? reqPrefix : 'candidate-photos';
        const key = `${prefix}/${randomKey()}.jpg`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
        return json({ url: publicUrlFor(env, key), key }, 200, origin);
      }

      // ---- Admin-only: daily track (MP3) upload ----
      if (path === '/api/upload/daily-track' && request.method === 'POST') {
        if (!(await isAdminRequest(request, env))) {
          return json({ error: 'Not authorized.' }, 401, origin);
        }
        const contentType = request.headers.get('Content-Type') || 'audio/mpeg';
        const trackId = url.searchParams.get('id') || randomKey();
        const ext = (url.searchParams.get('ext') || 'mp3').replace(/[^a-z0-9]/gi, '');
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0) return json({ error: 'Empty file.' }, 400, origin);
        if (bytes.byteLength > MAX_TRACK_BYTES) {
          return json({ error: 'Track too large (max 25MB).' }, 413, origin);
        }
        const key = `daily-tracks/${trackId}.${ext}`;
        await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
        return json({ url: publicUrlFor(env, key), key }, 200, origin);
      }

      // ---- Admin-only: one-off migration of old Supabase-hosted photos to R2 ----
      if (path === '/api/migrate-photos' && request.method === 'POST') {
        if (!(await isAdminRequest(request, env))) {
          return json({ error: 'Not authorized.' }, 401, origin);
        }
        return await migratePhotos(request, env, origin);
      }

      // ---- Admin-only: migrate base64 agency/employer logos to R2 ----
      if (path === '/api/migrate-agency-logos' && request.method === 'POST') {
        if (!(await isAdminRequest(request, env))) {
          return json({ error: 'Not authorized.' }, 401, origin);
        }
        return await migrateBase64Logos(request, env, origin, 'agencies', 'agency-logos');
      }
      if (path === '/api/migrate-employer-logos' && request.method === 'POST') {
        if (!(await isAdminRequest(request, env))) {
          return json({ error: 'Not authorized.' }, 401, origin);
        }
        return await migrateBase64Logos(request, env, origin, 'employers', 'employer-logos');
      }

      // ---- Admin-only: delete an object (photos or tracks) ----
      if (path === '/api/delete' && request.method === 'DELETE') {
        if (!(await isAdminRequest(request, env))) {
          return json({ error: 'Not authorized.' }, 401, origin);
        }
        const key = url.searchParams.get('key');
        if (!key) return json({ error: 'Missing key.' }, 400, origin);
        await env.MEDIA_BUCKET.delete(key);
        return json({ ok: true }, 200, origin);
      }

      return json({ error: 'Not found.' }, 404, origin);
    } catch (e) {
      return json({ error: e.message || 'Server error.' }, 500, origin);
    }
  },
};
