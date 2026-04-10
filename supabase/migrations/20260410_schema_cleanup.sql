alter table if exists public.tasks
  drop column if exists due_date,
  add column if not exists resource_path text;

drop table if exists public.task_screenshots cascade;
drop table if exists public.project_screenshots cascade;

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
