const base = (process.env.SITE_URL || 'https://sa-recruiters.co.za').replace(/\/$/, '');
const paths = ['/', '/manifest.json', '/sw.js', '/data/startup.json', '/icons/v2-icon-192.png'];
const failures = [];
for (const path of paths) {
  const url = base + path;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const type = response.headers.get('content-type') || '';
    if (!response.ok) failures.push(`${path}: HTTP ${response.status}`);
    else if (path.endsWith('.json') && !type.includes('json')) failures.push(`${path}: unexpected content type ${type}`);
    else console.log(`[pwa] ${path}: ${response.status} ${type}`);
  } catch (error) { failures.push(`${path}: ${error.message}`); }
}
if (failures.length) { console.error('[pwa] failures:\n' + failures.map((x) => `- ${x}`).join('\n')); process.exit(1); }
