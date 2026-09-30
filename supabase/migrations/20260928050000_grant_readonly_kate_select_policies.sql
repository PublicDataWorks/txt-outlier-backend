-- readonly_kate was left in the same broken state readonly_outlier was in before
-- 20260917211629: it holds SELECT grants on all 38 public tables and USAGE on public, but had
-- zero RLS policies. Every public table has RLS enabled, so Postgres silently returned zero rows
-- (including COUNT(*)) instead of erroring, making the database look empty to that credential.
--
-- readonly_kate has a password set and no expiry, so it is a live, usable login -- it just could
-- not see anything. This brings it to parity with readonly_outlier: full analyst read access,
-- matching the access level already chosen for this user (includes resident PII).

create policy "readonly_kate read access" on public.analysis_tags for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.audience_segments for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.authors for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.authors_old for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.broadcast_settings for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.broadcasts for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.broadcasts_segments for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.campaign_file_recipients for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.campaign_personalized_recipients for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.campaigns for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.comments for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.comments_mentions for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversation_analyses for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversation_analyses_backfill for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversation_history for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversations for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversations_assignees for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversations_assignees_history for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversations_authors for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversations_labels for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.conversations_users for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.errors for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.invoke_history for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.labels for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.lookup_history for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.lookup_template for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.message_statuses for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.organizations for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.outgoing_messages for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.rules for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.tasks_assignees for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.teams for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.twilio_messages for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.twilio_messages_old for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.unsubscribed_messages for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.user_history for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.users for select to readonly_kate using (true);
create policy "readonly_kate read access" on public.weekly_reports for select to readonly_kate using (true);

-- Parity with readonly_outlier on the Detroit property data as well, so switching between the two
-- credentials does not silently change what is visible.
grant usage on schema address_lookup to readonly_kate;
grant select on address_lookup.mi_wayne_detroit to readonly_kate;
grant select on address_lookup.residential_rental_registrations to readonly_kate;
grant select on address_lookup.posible_homeowner_windfalls to readonly_kate;

create policy "readonly_kate read access" on address_lookup.posible_homeowner_windfalls
  for select to readonly_kate using (true);
