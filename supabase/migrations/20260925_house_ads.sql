-- Admin-only house ads: direct, first-party promotional banners.
CREATE TABLE IF NOT EXISTS public.house_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_name text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  image_url text NOT NULL,
  target_url text NOT NULL,
  placement text NOT NULL DEFAULT 'home' CHECK (placement IN ('directories', 'agencies', 'employers', 'candidates', 'home', 'vacancies', 'both')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS house_ads_active_schedule_idx
  ON public.house_ads (is_active, placement, starts_at, ends_at, sort_order);

ALTER TABLE public.house_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "house ads public active read" ON public.house_ads;
CREATE POLICY "house ads public active read" ON public.house_ads
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  );

DROP POLICY IF EXISTS "house ads admin read" ON public.house_ads;
CREATE POLICY "house ads admin read" ON public.house_ads
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "house ads admin insert" ON public.house_ads;
CREATE POLICY "house ads admin insert" ON public.house_ads
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "house ads admin update" ON public.house_ads;
CREATE POLICY "house ads admin update" ON public.house_ads
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "house ads admin delete" ON public.house_ads;
CREATE POLICY "house ads admin delete" ON public.house_ads
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.record_house_ad_event(p_ad_id uuid, p_event text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event NOT IN ('impression', 'click') THEN
    RETURN false;
  END IF;
  IF p_event = 'impression' THEN
    UPDATE public.house_ads SET impressions = impressions + 1 WHERE id = p_ad_id;
  ELSE
    UPDATE public.house_ads SET clicks = clicks + 1 WHERE id = p_ad_id;
  END IF;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.record_house_ad_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_house_ad_event(uuid, text) TO anon, authenticated;
COMMENT ON TABLE public.house_ads IS 'First-party promotional banners managed by authorized SA Recruiters admins.';
