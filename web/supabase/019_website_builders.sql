-- Morning Telos migration 019: the website builders Hephaestus works in (Framer, Webflow, WordPress.com).
-- Run once in Supabase → SQL Editor, after 018_email_log.sql. Safe to run again.
-- Only the list of apps a workspace can connect grows. Who reads app_connections and how stays as 016 set it.
--
-- The toolkit list matches TOOLKITS in src/lib/composio/catalog.ts. tests/apps.test.ts fails when they drift.
alter table public.app_connections drop constraint if exists app_connections_toolkit_check;
alter table public.app_connections add constraint app_connections_toolkit_check check (toolkit in ('gmail', 'outlook', 'googlecalendar', 'calendly', 'hubspot', 'pipedrive', 'salesforce', 'slack', 'zendesk', 'help_scout', 'framer', 'webflow', 'wordpress_com'));
