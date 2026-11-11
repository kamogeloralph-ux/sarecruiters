-- Private storage for the signed-in candidate's generated CV document.
-- Raw notes sent to the AI builder are intentionally not persisted.
CREATE TABLE IF NOT EXISTS public.candidate_cv_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  generated_cv jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_role text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.candidate_cv_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidate_cv_profiles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.candidate_cv_profiles TO authenticated;

DROP POLICY IF EXISTS candidate_cv_profiles_select_own ON public.candidate_cv_profiles;
CREATE POLICY candidate_cv_profiles_select_own ON public.candidate_cv_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS candidate_cv_profiles_insert_own ON public.candidate_cv_profiles;
CREATE POLICY candidate_cv_profiles_insert_own ON public.candidate_cv_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS candidate_cv_profiles_update_own ON public.candidate_cv_profiles;
CREATE POLICY candidate_cv_profiles_update_own ON public.candidate_cv_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.candidate_cv_profiles IS
  'Private generated CV output, readable and writable only by the owning authenticated candidate; raw AI input is not stored.';
