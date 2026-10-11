-- Keep the public app and admin console synchronized with database writes.
-- The checks make this migration safe to run more than once in hosted Supabase.
-- Both clients also poll as a bounded fallback for projects where Realtime
-- publication settings have not yet been applied.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agencies',
    'branches',
    'vacancies',
    'employers',
    'employer_posters',
    'app_settings',
    'pool_candidates'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = table_name
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END
$$;
