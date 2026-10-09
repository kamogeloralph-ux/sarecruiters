const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OPS_ALERT_EMAIL = process.env.OPS_ALERT_EMAIL;
const EMAIL_FROM = process.env.EMAIL_FROM || 'SA Recruiters Alerts <alerts@sa-recruiters.co.za>';

export async function sendOpsEmail({ subject, text, html }) {
  if (!RESEND_API_KEY || !OPS_ALERT_EMAIL) {
    console.warn('[ops-email] RESEND_API_KEY or OPS_ALERT_EMAIL is not configured; summary will remain in workflow logs.');
    return { sent: false, reason: 'missing credentials' };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [OPS_ALERT_EMAIL], subject, text, html: html || `<pre>${String(text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>` }),
  });
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${await response.text()}`);
  return { sent: true, data: await response.json().catch(() => ({})) };
}
