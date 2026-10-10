// ============================================================================
//  SA Recruiters watchdog -- "keeps itself running".
// ============================================================================
//  Runs on Cloudflare's cron, which is deliberately a DIFFERENT failure domain
//  from the things it watches (GitHub Actions, Supabase pg_cron, Pages).
//
//  The rule is: heal first, bother a human only if healing did not work.
//
//    GitHub workflow disabled by "60 days of inactivity" .. re-enable + run it
//    GitHub workflow stale / never ran ..................... run it now
//    pg_cron stalled (TipChat sweep not running) ........... run the sweep here
//    Everything else (site down, snapshot stale, D1 sync
//    failing, workflow failing repeatedly, expired token) .. alert, de-duplicated
//
//  Alerts are de-duplicated (one email per problem per 24h) and a short
//  "recovered" note follows when a problem clears. A daily TipChat Autopilot
//  digest shows what was approved / hidden so mistakes are easy to spot.
//
//  Optional: set HEALTHCHECK_PING_URL (e.g. a free healthchecks.io check). The
//  watchdog pings it every run, so if THIS Worker ever stops, that service
//  emails you -- the only failure nothing inside the system can report.
// ============================================================================

const HOUR = 3600 * 1000;

// Workflows that must keep running. `staleHours` is how long without a
// success before the watchdog restarts the workflow (roughly 1.5-2x its schedule,
// so a single slow run or GitHub's cron jitter never triggers a false restart).
export const WORKFLOWS = [
  { file: 'refresh-static-data.yml', label: 'Vacancy scrapers + static snapshot', staleHours: 16 },
  { file: 'send-saved-search-alerts.yml', label: 'Saved-search alerts', staleHours: 9 },
  { file: 'community-risk.yml', label: 'TipChat risk scan', staleHours: 3 },
  { file: 'purge-stale-vacancies.yml', label: 'Expired vacancy purge', staleHours: 30 },
  { file: 'enforce-vacancy-caps.yml', label: 'Vacancy caps', staleHours: 30 },
  { file: 'check-vacancy-links.yml', label: 'Application link checks', staleHours: 30 },
  { file: 'pwa-health.yml', label: 'PWA health check', staleHours: 30 },
  { file: 'backup-data.yml', label: 'Data backup', staleHours: 30 },
  { file: 'weekly-analytics.yml', label: 'Weekly analytics email', staleHours: 8 * 24 },
];

const ACTIVE_RUN_STATES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

// ---------------------------------------------------------------------------
// Pure decision logic (unit-tested; no network, no clock besides `now`)
// ---------------------------------------------------------------------------

/**
 * Decide what is wrong with one workflow and what to do about it.
 * @returns {{problems: object[], actions: string[]}}  actions: 'enable' | 'dispatch'
 */
export function assessWorkflow(wf, { workflow, runs }, now = Date.now()) {
  const problems = [];
  const actions = [];
  const state = workflow && workflow.state;

  if (state && state !== 'active') {
    if (state === 'disabled_inactivity') {
      problems.push({
        key: `wf:${wf.file}:disabled`, grace: 2,
        title: `${wf.label} was switched off by GitHub (60 days without repository activity)`,
        detail: 'The watchdog re-enables and restarts it automatically.',
      });
      actions.push('enable', 'dispatch');
    } else {
      // disabled_manually etc.: a person did this on purpose -- tell them, never override.
      problems.push({
        key: `wf:${wf.file}:disabled`, grace: 1,
        title: `${wf.label} is disabled (${state})`,
        detail: 'It was disabled by a person, so the watchdog will not turn it back on.',
      });
    }
    return { problems, actions };
  }

  const list = Array.isArray(runs) ? runs : [];
  const running = list.find((run) => ACTIVE_RUN_STATES.has(run.status)
    && now - Date.parse(run.created_at || run.updated_at || 0) < 3 * HOUR);
  const lastSuccess = list.find((run) => run.conclusion === 'success');
  const lastSuccessAt = lastSuccess ? Date.parse(lastSuccess.updated_at || lastSuccess.created_at) : null;
  const ageHours = lastSuccessAt ? (now - lastSuccessAt) / HOUR : Infinity;

  if (!running && ageHours > wf.staleHours) {
    problems.push({
      key: `wf:${wf.file}:stale`, grace: 2,
      title: `${wf.label} has not succeeded for ${Number.isFinite(ageHours) ? `${Math.round(ageHours)}h` : 'a long time'} (expected every ~${Math.round(wf.staleHours / 1.5)}h)`,
      detail: 'The watchdog restarted it. If this alert repeats, look at the latest run in GitHub Actions.',
    });
    actions.push('dispatch');
  }

  const finished = list.filter((run) => run.status === 'completed').slice(0, 3);
  if (finished.length === 3 && finished.every((run) => FAILED_CONCLUSIONS.has(run.conclusion))) {
    problems.push({
      key: `wf:${wf.file}:failing`, grace: 1,
      title: `${wf.label} has failed its last 3 runs`,
      detail: 'Restarting will not fix this. Check the run log (usually an expired secret or a changed website).',
    });
  }
  return { problems, actions };
}

/**
 * De-duplicate alerts across runs.
 *  - a problem alerts once it has been seen `grace` runs in a row (grace 2 gives self-healing
 *    a full cycle to work before a human is told)
 *  - re-alerts at most every `realertMs`
 *  - a problem we alerted about that disappears produces a one-line "recovered"
 */
export function planAlerts(problems, prevState, now = Date.now(), realertMs = 24 * HOUR) {
  const prev = (prevState && prevState.problems) || {};
  const nextProblems = {};
  const toAlert = [];
  const seen = new Set();

  for (const problem of problems) {
    if (seen.has(problem.key)) continue;
    seen.add(problem.key);
    const before = prev[problem.key];
    const count = (before ? before.count : 0) + 1;
    const lastAlert = before ? before.last_alert : null;
    const entry = {
      first_seen: before ? before.first_seen : new Date(now).toISOString(),
      count,
      last_alert: lastAlert || null,
      title: problem.title,
    };
    const due = !lastAlert || now - Date.parse(lastAlert) >= realertMs;
    if (count >= (problem.grace || 1) && due) {
      toAlert.push(problem);
      entry.last_alert = new Date(now).toISOString();
    }
    nextProblems[problem.key] = entry;
  }

  const recovered = Object.entries(prev)
    .filter(([key, entry]) => !seen.has(key) && entry && entry.last_alert)
    .map(([key, entry]) => ({ key, title: entry.title }));

  return { toAlert, recovered, nextProblems };
}

/** At most one heal per target per cooldown, so a broken workflow is never hammered. */
export function canHeal(state, key, now = Date.now(), cooldownMs = 6 * HOUR) {
  const last = state && state.heals && state.heals[key];
  return !last || now - Date.parse(last) >= cooldownMs;
}

export function renderAlertEmail({ toAlert, recovered }, now = new Date()) {
  const lines = [];
  if (toAlert.length) {
    lines.push(`${toAlert.length} thing${toAlert.length === 1 ? '' : 's'} need${toAlert.length === 1 ? 's' : ''} your attention:`, '');
    for (const problem of toAlert) {
      lines.push(`• ${problem.title}`);
      if (problem.detail) lines.push(`    ${problem.detail}`);
    }
  }
  if (recovered.length) {
    if (lines.length) lines.push('');
    lines.push('Recovered on their own:');
    for (const item of recovered) lines.push(`• ${item.title}`);
  }
  lines.push('', `— SA Recruiters watchdog, ${now.toISOString()}`);
  return lines.join('\n');
}

export function renderDigest(digest, now = new Date()) {
  const counts = (digest && digest.counts) || {};
  const mode = (digest && digest.mode) || 'unknown';
  const shadow = mode === 'shadow';
  // Keys look like "approve:insert", "hide:ttl", "hold:sweep:shadow" (":shadow" = recorded, not applied).
  const total = (prefix, wantShadow) => Object.entries(counts)
    .filter(([key]) => key.startsWith(prefix) && key.endsWith(':shadow') === wantShadow)
    .reduce((sum, [, n]) => sum + Number(n), 0);
  const approved = total('approve:', shadow);
  const hidden = total('hide:', shadow);
  const held = total('hold:', shadow);
  const lines = [];
  lines.push(`TipChat Autopilot (mode: ${mode}) — last 24 hours`, '');
  lines.push(shadow
    ? `Would have approved: ${approved}   Would have hidden: ${hidden}   Would have held: ${held}`
    : `Approved automatically: ${approved}   Hidden: ${hidden}   Held for a closer look: ${held}`);
  if (!shadow) {
    const expired = Number(counts['hide:ttl'] || 0);
    const reported = Number(counts['hide:reports'] || 0);
    if (expired || reported) lines.push(`Of the hidden: ${expired} expired while held, ${reported} hidden after community reports`);
  }
  const reasons = Array.isArray(digest && digest.top_reasons) ? digest.top_reasons : [];
  if (reasons.length) {
    lines.push('', 'Most common reasons something was held or hidden:');
    for (const item of reasons) lines.push(`  ${item.reason}: ${item.n}`);
  }
  const samples = Array.isArray(digest && digest.samples) ? digest.samples : [];
  if (samples.length) {
    lines.push('', 'Recent examples (check these for mistakes):');
    for (const item of samples) {
      lines.push(`  [${item.decision}${item.applied ? '' : (shadow ? ', not applied' : '')} · ${item.kind}] ${(item.reasons || []).join(', ')} — "${item.snippet}"`);
    }
  }
  if (shadow) {
    lines.push('', 'Autopilot is still in SHADOW mode: it is only recording what it would do. When this looks right, go live with one statement in the Supabase SQL editor:',
      "  update public.community_automod_settings set mode = 'live', updated_at = now();");
  } else {
    lines.push('', 'Something wrongly hidden? Approve it in the TipChat moderation queue or run:',
      "  update public.community_posts set status = 'approved' where id = '<id>';",
      'A human decision is never overridden by Autopilot.');
  }
  lines.push('', `— ${now.toISOString()}`);
  return lines.join('\n');
}

export function digestHasNews(digest) {
  const counts = (digest && digest.counts) || {};
  return Object.keys(counts).length > 0 || (digest && digest.mode === 'shadow');
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

const STATE_KEY = 'watchdog_state';

async function loadState(env) {
  if (!env.DB) return { problems: {}, heals: {} };
  try {
    const result = await env.DB.prepare('SELECT value FROM sync_meta WHERE key = ? LIMIT 1').bind(STATE_KEY).all();
    const raw = result.results && result.results[0] && result.results[0].value;
    const parsed = raw ? JSON.parse(raw) : {};
    return { problems: parsed.problems || {}, heals: parsed.heals || {} };
  } catch (error) {
    console.error('watchdog: could not load state', error);
    return { problems: {}, heals: {} };
  }
}

async function saveState(env, state) {
  if (!env.DB) return;
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)')
      .bind(STATE_KEY, JSON.stringify(state)).run();
  } catch (error) {
    console.error('watchdog: could not save state', error);
  }
}

async function sendMail(env, subject, text, fetchImpl) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  const to = env.OPS_ALERT_EMAIL || env.ADMIN_NOTIFY_EMAIL || 'sarecruiters.directory@gmail.com';
  const from = env.EMAIL_FROM || 'SA Recruiters <notifications@sa-recruiters.co.za>';
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) return { sent: false, reason: `resend ${response.status}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: String(error && error.message || error) };
  }
}

const supabaseHeaders = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
});

async function rpc(env, name, body, fetchImpl) {
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: supabaseHeaders(env),
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`rpc ${name} -> HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Checks. Each one pushes into ctx.problems and never throws.
// ---------------------------------------------------------------------------

async function checkSite(ctx) {
  const { env, fetchImpl, now, deep } = ctx;
  const site = (env.SITE_URL || 'https://sa-recruiters.co.za').replace(/\/$/, '');
  try {
    const response = await fetchImpl(site, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'sarecruiters-watchdog' } });
    if (!response.ok) {
      ctx.problems.push({ key: 'site-down', grace: 2, title: `The website answered HTTP ${response.status}`, detail: site });
    }
  } catch (error) {
    ctx.problems.push({ key: 'site-down', grace: 2, title: 'The website is not reachable', detail: `${site} — ${String(error && error.message || error)}` });
    return;
  }
  if (!deep) return;
  try {
    const response = await fetchImpl(`${site}/data/startup.json`, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'sarecruiters-watchdog' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    const count = Array.isArray(snapshot.vacancies) ? snapshot.vacancies.length : 0;
    const ageHours = snapshot.updated_at ? (now - Date.parse(snapshot.updated_at)) / HOUR : Infinity;
    if (count < 100) ctx.problems.push({ key: 'snapshot-empty', grace: 1, title: `The public job snapshot has only ${count} vacancies`, detail: 'Visitors would see an almost empty app.' });
    if (ageHours > 36) ctx.problems.push({ key: 'snapshot-stale', grace: 1, title: `The public job snapshot is ${Number.isFinite(ageHours) ? Math.round(ageHours) + 'h' : 'of unknown age'} old`, detail: 'Normally refreshed twice a day by the scraper workflow.' });
  } catch (error) {
    ctx.problems.push({ key: 'snapshot-unreadable', grace: 2, title: 'The public job snapshot could not be read', detail: String(error && error.message || error) });
  }
}

async function checkD1Sync(ctx) {
  const { env, now } = ctx;
  if (!env.DB) return;
  try {
    const result = await env.DB.prepare('SELECT value FROM sync_meta WHERE key = ? LIMIT 1').bind('sync_status').all();
    const raw = result.results && result.results[0] && result.results[0].value;
    if (!raw) return;
    const status = JSON.parse(raw);
    if (status.status === 'failed') {
      ctx.problems.push({ key: 'd1-sync-failed', grace: 2, title: 'The D1 data sync is failing', detail: `${status.failed_at || ''} ${status.error || ''}`.trim() });
    } else if (status.status === 'running' && status.started_at && now - Date.parse(status.started_at) > 2 * HOUR) {
      ctx.problems.push({ key: 'd1-sync-stuck', grace: 1, title: 'The D1 data sync has been "running" for over 2 hours', detail: `Started ${status.started_at}` });
    } else if (status.status === 'success' && status.synced_at && now - Date.parse(status.synced_at) > 14 * HOUR) {
      ctx.problems.push({ key: 'd1-sync-stale', grace: 1, title: `The D1 data sync last succeeded ${Math.round((now - Date.parse(status.synced_at)) / HOUR)}h ago`, detail: 'It should run every 6 hours.' });
    }
  } catch (error) {
    console.error('watchdog: d1 check failed', error);
  }
}

async function checkAutopilot(ctx) {
  const { env, fetchImpl, now, state } = ctx;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let health;
  try {
    health = await rpc(env, 'community_automod_health', {}, fetchImpl);
  } catch (error) {
    // 404 = migration not applied yet. Stay quiet rather than cry wolf.
    if (error.status === 404) return null;
    ctx.problems.push({ key: 'supabase-unreachable', grace: 2, title: 'The watchdog cannot reach Supabase', detail: String(error.message || error) });
    return null;
  }
  if (!health || health.mode === 'off') return health;

  const last = health.last_sweep_at ? Date.parse(health.last_sweep_at) : 0;
  if (now - last > 20 * 60 * 1000) {
    // Moderation must not depend on one scheduler: run the sweep ourselves.
    try {
      await rpc(env, 'community_automod_sweep', { p_via: 'watchdog' }, fetchImpl);
      state.heals['autopilot-sweep'] = new Date(now).toISOString();
    } catch (error) {
      ctx.problems.push({ key: 'autopilot-sweep-failed', grace: 2, title: 'TipChat Autopilot sweep failed', detail: String(error.message || error) });
    }
  }
  const lastCron = health.last_cron_sweep_at ? Date.parse(health.last_cron_sweep_at) : 0;
  if (now - lastCron > 30 * 60 * 1000) {
    ctx.problems.push({
      key: 'pg-cron-stalled', grace: 2,
      title: 'The Supabase pg_cron schedule for TipChat Autopilot is not firing',
      detail: 'The watchdog is running the sweep in the meantime, so moderation continues. Check: select jobname, active from cron.job; (pg_cron may be disabled or the project paused).',
    });
  }
  if (health.mode === 'live' && Number(health.stuck) > 0) {
    ctx.problems.push({ key: 'autopilot-stuck', grace: 2, title: `${health.stuck} TipChat item(s) are stuck pending past their expiry`, detail: 'Autopilot should have resolved them. Check community_moderation_log.' });
  }
  return health;
}

function githubFetch(ctx, path, init = {}) {
  const { env, fetchImpl } = ctx;
  return fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${env.WATCHDOG_GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sarecruiters-watchdog',
      ...(init.headers || {}),
    },
  });
}

async function checkGithub(ctx) {
  const { env, now, state } = ctx;
  if (!env.GITHUB_REPO || !env.WATCHDOG_GH_TOKEN) return; // optional feature
  const branch = env.GITHUB_BRANCH || 'main';

  await Promise.all(WORKFLOWS.map(async (wf) => {
    try {
      const [wfRes, runsRes] = await Promise.all([
        githubFetch(ctx, `/actions/workflows/${wf.file}`),
        githubFetch(ctx, `/actions/workflows/${wf.file}/runs?per_page=10`),
      ]);
      if (wfRes.status === 401 || wfRes.status === 403) {
        ctx.problems.push({ key: 'github-auth', grace: 1, title: 'The watchdog\'s GitHub token was rejected (expired or missing permission)', detail: 'Create a new fine-grained token with Actions: read & write and update the WATCHDOG_GH_TOKEN secret.' });
        return;
      }
      if (wfRes.status === 404) {
        ctx.problems.push({ key: `wf:${wf.file}:missing`, grace: 2, title: `Workflow ${wf.file} was not found in ${env.GITHUB_REPO}`, detail: 'Renamed or deleted? Update WORKFLOWS in Cloudflare-worker/watchdog.js.' });
        return;
      }
      if (!wfRes.ok || !runsRes.ok) throw new Error(`GitHub HTTP ${wfRes.status}/${runsRes.status}`);
      const workflow = await wfRes.json();
      const runs = (await runsRes.json()).workflow_runs || [];
      const { problems, actions } = assessWorkflow(wf, { workflow, runs }, now);
      ctx.problems.push(...problems);

      const healKey = `wf:${wf.file}`;
      if (!actions.length || !canHeal(state, healKey, now)) return;
      let ok = true;
      if (actions.includes('enable')) {
        const res = await githubFetch(ctx, `/actions/workflows/${wf.file}/enable`, { method: 'PUT' });
        ok = res.ok;
      }
      if (ok && actions.includes('dispatch')) {
        const res = await githubFetch(ctx, `/actions/workflows/${wf.file}/dispatches`, {
          method: 'POST', body: JSON.stringify({ ref: branch }), headers: { 'Content-Type': 'application/json' },
        });
        ok = res.ok;
      }
      if (ok) state.heals[healKey] = new Date(now).toISOString();
      else console.error(`watchdog: could not heal ${wf.file}`);
    } catch (error) {
      console.error(`watchdog: github check failed for ${wf.file}`, error);
    }
  }));
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * @param {object} env  Worker env
 * @param {{deep?: boolean, digest?: boolean, now?: number, fetchImpl?: typeof fetch}} options
 *   deep   - also download and validate the 4-5MB public snapshot (done every 6h)
 *   digest - also email the daily TipChat Autopilot digest
 */
export async function runWatchdog(env, options = {}) {
  const now = options.now || Date.now();
  const fetchImpl = options.fetchImpl || fetch;
  const state = await loadState(env);
  const ctx = { env, fetchImpl, now, deep: !!options.deep, state, problems: [] };

  const settled = await Promise.allSettled([checkSite(ctx), checkD1Sync(ctx), checkAutopilot(ctx), checkGithub(ctx)]);
  settled.forEach((result) => { if (result.status === 'rejected') console.error('watchdog check crashed', result.reason); });

  const plan = planAlerts(ctx.problems, state, now);
  let alerted = false;
  if (plan.toAlert.length || plan.recovered.length) {
    const subject = plan.toAlert.length
      ? `SA Recruiters: ${plan.toAlert.length} issue${plan.toAlert.length === 1 ? '' : 's'} need attention`
      : 'SA Recruiters: all clear again';
    const sent = await sendMail(env, subject, renderAlertEmail(plan, new Date(now)), fetchImpl);
    alerted = sent.sent;
    if (!sent.sent) {
      console.error('watchdog: alert email not sent', sent.reason);
      // Un-stamp so the next run retries instead of assuming the human was told.
      for (const problem of plan.toAlert) {
        const prior = state.problems[problem.key];
        if (plan.nextProblems[problem.key]) plan.nextProblems[problem.key].last_alert = prior ? prior.last_alert : null;
      }
    }
  }

  if (options.digest && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const digest = await rpc(env, 'community_automod_digest', { p_hours: 24 }, fetchImpl);
      if (digestHasNews(digest)) {
        const sent = await sendMail(env, 'TipChat Autopilot: daily summary', renderDigest(digest, new Date(now)), fetchImpl);
        if (!sent.sent) console.error('watchdog: digest not sent', sent.reason);
      }
    } catch (error) {
      if (error.status !== 404) console.error('watchdog: digest failed', error);
    }
  }

  await saveState(env, { problems: plan.nextProblems, heals: state.heals });

  // Dead-man's switch for the watchdog itself.
  if (env.HEALTHCHECK_PING_URL) {
    try { await fetchImpl(env.HEALTHCHECK_PING_URL, { signal: AbortSignal.timeout(10000) }); } catch (error) { console.error('watchdog: heartbeat ping failed', error); }
  }

  return { problems: ctx.problems.map((p) => p.key), alerted, recovered: plan.recovered.length };
}
