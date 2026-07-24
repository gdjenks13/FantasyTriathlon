-- Fantasy Triathlon shared state
-- Run this in Supabase Dashboard → SQL Editor → New query → Run

-- Single-row document store for the whole app JSON state
create table if not exists public.app_state (
  id integer primary key check (id = 1),
  payload jsonb not null default '{"players":[],"results":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.app_state (id, payload)
values (1, '{"players":[],"results":{}}'::jsonb)
on conflict (id) do nothing;

alter table public.app_state enable row level security;

-- Drop old policies if re-running
drop policy if exists "Anyone can read app state" on public.app_state;
drop policy if exists "Authenticated can insert app state" on public.app_state;
drop policy if exists "Authenticated can update app state" on public.app_state;

-- Public read (spectators + logged-out visitors)
create policy "Anyone can read app state"
  on public.app_state
  for select
  to anon, authenticated
  using (true);

-- Only signed-in editor can write
create policy "Authenticated can insert app state"
  on public.app_state
  for insert
  to authenticated
  with check (true);

create policy "Authenticated can update app state"
  on public.app_state
  for update
  to authenticated
  using (true)
  with check (true);

-- Realtime: Dashboard → Database → Publications → supabase_realtime
-- enable for table app_state, or run:
alter publication supabase_realtime add table public.app_state;
