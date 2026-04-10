alter table if exists public.tasks
  drop column if exists due_date,
  add column if not exists resource_path text;

drop table if exists public.task_screenshots cascade;
drop table if exists public.project_screenshots cascade;

create table if not exists public.project_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  file_path text not null,
  caption text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_screenshots enable row level security;

drop policy if exists "Users read own project screenshots" on public.project_screenshots;
drop policy if exists "Users insert own project screenshots" on public.project_screenshots;
drop policy if exists "Users update own project screenshots" on public.project_screenshots;
drop policy if exists "Users delete own project screenshots" on public.project_screenshots;

create policy "Users read own project screenshots"
on public.project_screenshots
for select
to authenticated
using (user_id = auth.uid());

create policy "Users insert own project screenshots"
on public.project_screenshots
for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users update own project screenshots"
on public.project_screenshots
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users delete own project screenshots"
on public.project_screenshots
for delete
to authenticated
using (user_id = auth.uid());

alter table if exists public.notes
  add column if not exists title text;

update public.notes
set title = coalesce(nullif(left(split_part(content, E'\n', 1), 80), ''), 'Untitled Note')
where title is null;

alter table if exists public.notes
  drop column if exists project_id,
  drop column if exists task_id;

alter table if exists public.timeline_events
  alter column project_id drop not null;
