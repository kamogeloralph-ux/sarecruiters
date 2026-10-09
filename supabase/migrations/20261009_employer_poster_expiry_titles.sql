-- Keep every recruitment poster for 14 days from publication, then allow the
-- scheduled Cloudflare Worker to remove both its database row and R2 object.
CREATE OR REPLACE FUNCTION public.set_employer_poster_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;
  NEW.expires_at := NEW.created_at + interval '14 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employer_posters_set_expiry ON public.employer_posters;
CREATE TRIGGER employer_posters_set_expiry
  BEFORE INSERT ON public.employer_posters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_employer_poster_expiry();

-- Normalize historical rows, including rows inserted through the signed-in
-- uploader that previously omitted expires_at.
UPDATE public.employer_posters
SET expires_at = COALESCE(created_at, now()) + interval '14 days'
WHERE expires_at IS DISTINCT FROM COALESCE(created_at, now()) + interval '14 days';

CREATE OR REPLACE FUNCTION public.public_submit_poster(
  p_image_url text,
  p_caption text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  poster_id uuid;
  clean_caption text := nullif(left(trim(coalesce(p_caption, '')), 500), '');
BEGIN
  IF p_image_url IS NULL
     OR length(p_image_url) > 1200
     OR p_image_url NOT LIKE '%/employer-posters/%' THEN
    RAISE EXCEPTION 'invalid poster image';
  END IF;
  INSERT INTO public.employer_posters (image_url, caption, expires_at)
  VALUES (p_image_url, clean_caption, now() + interval '14 days')
  RETURNING id INTO poster_id;
  RETURN poster_id;
END;
$$;
REVOKE ALL ON FUNCTION public.public_submit_poster(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_submit_poster(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_expired_employer_poster(p_poster_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rows_deleted integer;
BEGIN
  DELETE FROM public.employer_posters
  WHERE id = p_poster_id
    AND expires_at IS NOT NULL
    AND expires_at <= now();
  GET DIAGNOSTICS rows_deleted = ROW_COUNT;
  RETURN rows_deleted > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_expired_employer_poster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_expired_employer_poster(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.delete_expired_employer_poster(uuid) IS
  'Deletes one employer poster row only after its recorded expiry time; called after its R2 image is removed by the scheduled Worker.';

CREATE OR REPLACE FUNCTION public.set_employer_poster_caption_if_missing(
  p_poster_id uuid,
  p_caption text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rows_updated integer;
  clean_caption text := left(trim(coalesce(p_caption, '')), 120);
BEGIN
  IF clean_caption = '' THEN
    RETURN false;
  END IF;
  UPDATE public.employer_posters
  SET caption = clean_caption
  WHERE id = p_poster_id
    AND (caption IS NULL OR trim(caption) = '')
    AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.set_employer_poster_caption_if_missing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employer_poster_caption_if_missing(uuid, text) TO anon, authenticated;
COMMENT ON FUNCTION public.set_employer_poster_caption_if_missing(uuid, text) IS
  'Fills a missing employer poster caption without overwriting a user-provided title; called by the image-title backfill.';
