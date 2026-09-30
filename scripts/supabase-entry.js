// Entry point for the self-hosted Supabase browser bundle (vendor/supabase.min.js).
// Built by scripts/bundle-app.js from the npm dependency @supabase/supabase-js, replacing the
// unpkg.com <script> tag so first paint no longer waits on a third-party CDN round trip.
// The app only ever calls window.supabase.createClient(...), so that is all we expose.
import { createClient } from '@supabase/supabase-js';
window.supabase = { createClient: createClient };
