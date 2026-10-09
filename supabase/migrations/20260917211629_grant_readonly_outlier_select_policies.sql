-- readonly_outlier already holds table-level GRANT SELECT on every public table and schema USAGE
-- on public, but every public table has RLS enabled with no policy covering readonly_outlier.
-- With RLS on and no matching policy, Postgres returns zero rows to that role (including COUNT(*))
-- rather than an error, which is why the role appeared to see an "empty" database.
--
-- This grants readonly_outlier unrestricted SELECT (USING (true)) on all 38 public tables,
-- matching the "read everything, same as internal staff" access level requested for this role.
-- It does not touch the existing anon-scoped policies on authors/comments/twilio_messages.
--
-- Applied to production as 20260917211629. The roles and schemas it touches exist only in production, so
-- the statements run only when role readonly_outlier exist. A fresh database (CI's `supabase start`,
-- local development) skips this migration instead of failing.

DO $guard$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_outlier')) THEN
    RAISE NOTICE 'Skipping 20260917211629: requires role readonly_outlier';
    RETURN;
  END IF;

  EXECUTE $migration$
create policy "readonly_outlier read access" on public.analysis_tags for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.audience_segments for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.authors for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.authors_old for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.broadcast_settings for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.broadcasts for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.broadcasts_segments for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.campaign_file_recipients for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.campaign_personalized_recipients for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.campaigns for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.comments for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.comments_mentions for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversation_analyses for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversation_analyses_backfill for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversation_history for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversations for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversations_assignees for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversations_assignees_history for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversations_authors for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversations_labels for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.conversations_users for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.errors for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.invoke_history for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.labels for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.lookup_history for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.lookup_template for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.message_statuses for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.organizations for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.outgoing_messages for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.rules for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.tasks_assignees for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.teams for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.twilio_messages for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.twilio_messages_old for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.unsubscribed_messages for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.user_history for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.users for select to readonly_outlier using (true);
create policy "readonly_outlier read access" on public.weekly_reports for select to readonly_outlier using (true);
$migration$;
END
$guard$;
