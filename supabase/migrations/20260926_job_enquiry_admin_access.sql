-- Allow authenticated admin users to review and edit public job enquiries.
DROP POLICY IF EXISTS job_post_enquiries_admin_select ON public.job_post_enquiries;
CREATE POLICY job_post_enquiries_admin_select ON public.job_post_enquiries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));
DROP POLICY IF EXISTS job_post_enquiries_admin_update ON public.job_post_enquiries;
CREATE POLICY job_post_enquiries_admin_update ON public.job_post_enquiries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));
DROP POLICY IF EXISTS job_post_enquiries_admin_delete ON public.job_post_enquiries;
CREATE POLICY job_post_enquiries_admin_delete ON public.job_post_enquiries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()));
