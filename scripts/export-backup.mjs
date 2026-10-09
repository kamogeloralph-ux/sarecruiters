import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });
const tables = ['agencies', 'employers', 'vacancies', 'pool_candidates_public', 'saved_searches', 'push_subscriptions', 'community_posts', 'community_comments', 'house_ads', 'media_settings'];
const output = process.env.BACKUP_DIR || 'backup';
await fs.mkdir(output, { recursive: true });
const manifest = { generated_at: new Date().toISOString(), tables: {} };
for (const table of tables) {
  const result = await db.from(table).select('*').limit(50000);
  if (result.error) { console.warn(`[backup] ${table}: skipped (${result.error.message})`); continue; }
  await fs.writeFile(path.join(output, `${table}.json`), JSON.stringify(result.data || [], null, 2));
  manifest.tables[table] = (result.data || []).length;
}
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
