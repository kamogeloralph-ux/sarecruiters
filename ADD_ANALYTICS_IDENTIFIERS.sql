-- Privacy-preserving analytics identifiers.
-- visitor_id is a random first-party browser identifier; session_id changes per visit.
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS visitor_id text,
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
  ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_visitor_id_idx
  ON public.analytics_events (visitor_id, created_at DESC);

COMMENT ON COLUMN public.analytics_events.visitor_id IS
  'Random first-party anonymous visitor identifier; contains no personal data.';
COMMENT ON COLUMN public.analytics_events.is_admin IS
  'Server/client classification used to exclude authenticated admin activity from public metrics.';
