-- Safety net for the admin console. The Worker (service role) is now the primary
-- path for editing/deleting posters and updating job enquiries, but these admin-only
-- policies let a signed-in admin do the same directly if the Worker is bypassed.
-- Idempotent.

DROP POLICY IF EXISTS posters_admin_update ON public.employer_posters;
CREATE POLICY posters_admin_update ON public.employer_posters
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));

DROP POLICY IF EXISTS posters_admin_delete ON public.employer_posters;
CREATE POLICY posters_admin_delete ON public.employer_posters
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));
