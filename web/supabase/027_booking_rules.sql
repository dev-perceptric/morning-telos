-- Settings a teammate keeps beyond on or off, trust and model. Today: Cleo's booking rules ({"booking": {...}},
-- src/lib/booking.ts), set on her Settings tab and given to her in her instructions. Admins and the owner change it
-- through the existing agent_prefs policies (011_ai_team.sql); members read it.
alter table public.agent_prefs add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.agent_prefs drop constraint if exists agent_prefs_settings_check;
alter table public.agent_prefs add constraint agent_prefs_settings_check check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4000);
