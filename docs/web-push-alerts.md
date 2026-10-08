# Web Push vacancy alerts

The app requests notification permission only after a signed-in user taps **Enable push** in the Job alerts card. Email alerts remain the fallback channel.

## One-time deployment setup

1. Apply `supabase/migrations/20261008_push_subscriptions.sql`.
2. Add these GitHub Actions secrets:
   - `VAPID_PUBLIC_KEY`: the public key embedded in `app-alerts.js`.
   - `VAPID_PRIVATE_KEY`: the private key generated for this deployment.
   - `VAPID_SUBJECT`: `mailto:notifications@sa-recruiters.co.za`.
3. Keep the private key out of Git and out of browser code.
4. The scheduled alert workflow runs the push job before the existing email job.

Push subscriptions are protected by Supabase RLS and are removed automatically when a browser reports an expired endpoint.
