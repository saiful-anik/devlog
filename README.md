# DevLog

DevLog is a personal development diary app built with React + Vite + Supabase.
It helps you track projects, task movement, notes, and timeline events in one place.

## Features

- GitHub OAuth login via Supabase Auth.
- Dashboard with project progress and recent activity.
- Project management:
	- Create projects
	- Rename projects
	- Open project detail board
- Kanban-style task flow per project:
	- Backlog, In Progress, Completed
	- Drag and drop between columns
	- Auto timeline event when task status changes
- Task details:
	- Title
	- Description
	- Optional URL/file path reference field
- Notes module:
	- Independent from projects/tasks
	- Title + content based notes
- Timeline module:
	- Custom events
	- Optional project linkage
	- Optional event image
	- Auto event creation for key actions
- Health check page for auth/database connectivity.
- Backup export (ZIP with JSON and image payloads where available).

## Auto Timeline Events

The app automatically creates timeline events when:

- A project is created
- A task is created
- A task is moved between status columns

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS + Radix UI
- TanStack Query
- Supabase (Auth + Postgres)
- Vitest + Testing Library

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create env file from template:

```bash
copy .env.example .env
```

3. Fill env values in `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-publishable-anon-key
```

4. Start dev server:

```bash
npm run dev
```

## Use Your Own Supabase Project

Follow this if you want to run DevLog on your own Supabase backend.

### 1) Create project

- Create a new project in Supabase.

### 2) Enable GitHub OAuth

- In Supabase dashboard:
	- Go to Authentication -> Providers -> GitHub
	- Enable GitHub provider
	- Set Client ID and Client Secret from your GitHub OAuth App
- Add redirect URL in Supabase and GitHub OAuth app:
	- Local: `http://localhost:5173/login`
	- Production: `https://your-domain/login`

### 3) Create database schema

Run this SQL in Supabase SQL Editor (or apply via CLI):

```sql
create extension if not exists "pgcrypto";

create table if not exists public.projects (
	id uuid primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	title text not null,
	description text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
	id uuid primary key,
	project_id uuid not null references public.projects(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	title text not null,
	details text,
	status text not null check (status in ('backlog', 'in-progress', 'completed')),
	resource_path text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.notes (
	id uuid primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	title text,
	content text not null default '',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.timeline_events (
	id uuid primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	project_id uuid references public.projects(id) on delete set null,
	event_type text not null,
	payload jsonb,
	occurred_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.timeline_events enable row level security;

drop policy if exists projects_owner_select on public.projects;
drop policy if exists projects_owner_insert on public.projects;
drop policy if exists projects_owner_update on public.projects;
drop policy if exists projects_owner_delete on public.projects;
create policy projects_owner_select on public.projects for select using (auth.uid() = user_id);
create policy projects_owner_insert on public.projects for insert with check (auth.uid() = user_id);
create policy projects_owner_update on public.projects for update using (auth.uid() = user_id);
create policy projects_owner_delete on public.projects for delete using (auth.uid() = user_id);

drop policy if exists tasks_owner_select on public.tasks;
drop policy if exists tasks_owner_insert on public.tasks;
drop policy if exists tasks_owner_update on public.tasks;
drop policy if exists tasks_owner_delete on public.tasks;
create policy tasks_owner_select on public.tasks for select using (auth.uid() = user_id);
create policy tasks_owner_insert on public.tasks for insert with check (auth.uid() = user_id);
create policy tasks_owner_update on public.tasks for update using (auth.uid() = user_id);
create policy tasks_owner_delete on public.tasks for delete using (auth.uid() = user_id);

drop policy if exists notes_owner_select on public.notes;
drop policy if exists notes_owner_insert on public.notes;
drop policy if exists notes_owner_update on public.notes;
drop policy if exists notes_owner_delete on public.notes;
create policy notes_owner_select on public.notes for select using (auth.uid() = user_id);
create policy notes_owner_insert on public.notes for insert with check (auth.uid() = user_id);
create policy notes_owner_update on public.notes for update using (auth.uid() = user_id);
create policy notes_owner_delete on public.notes for delete using (auth.uid() = user_id);

drop policy if exists timeline_owner_select on public.timeline_events;
drop policy if exists timeline_owner_insert on public.timeline_events;
drop policy if exists timeline_owner_update on public.timeline_events;
drop policy if exists timeline_owner_delete on public.timeline_events;
create policy timeline_owner_select on public.timeline_events for select using (auth.uid() = user_id);
create policy timeline_owner_insert on public.timeline_events for insert with check (auth.uid() = user_id);
create policy timeline_owner_update on public.timeline_events for update using (auth.uid() = user_id);
create policy timeline_owner_delete on public.timeline_events for delete using (auth.uid() = user_id);

create index if not exists idx_projects_user on public.projects(user_id);
create index if not exists idx_tasks_user on public.tasks(user_id);
create index if not exists idx_tasks_project on public.tasks(project_id);
create index if not exists idx_notes_user on public.notes(user_id);
create index if not exists idx_timeline_user on public.timeline_events(user_id);
create index if not exists idx_timeline_project on public.timeline_events(project_id);
```

### 4) Apply included migration (if needed)

If you are migrating from older schema versions, run:

```bash
npx supabase db query --linked -f supabase/migrations/20260410_schema_cleanup.sql
```

### 5) Configure app env

Set these values in `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-publishable-anon-key
```

### 6) Verify connectivity

- Start app and open `/health`
- Confirm auth + table checks pass

## Available Scripts

- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm test` - Run unit tests once
- `npm run test:watch` - Watch mode tests

## Current Limitations

- Native browser drag ghost can vary slightly across OS/browser engines.
- No server-side function layer yet for event automation (currently handled in app logic).
- Import/restore flow from backup is not implemented yet (export exists).

## Future Scope

### Product

- Timeline filters (by project, type, date range)
- Global search across projects, tasks, notes, timeline
- Task assignees/tags/priority
- Recurring tasks and due windows
- Markdown notes with preview mode
- Restore/import from backup ZIP

### Collaboration

- Shared workspaces
- Role-based access (owner/editor/viewer)
- Team activity feed

### Platform & DX

- Server-side event hooks or database triggers for guaranteed timeline consistency
- Full migration history and automated schema bootstrap
- E2E test suite for auth + drag/drop + data sync
- Performance tuning for larger datasets (pagination/virtualization)
- PWA/offline-first cache strategy
