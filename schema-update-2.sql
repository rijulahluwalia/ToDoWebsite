-- ============================================
-- ROOTED · Phase 2 schema update (Projects + Routines)
-- Run this ONCE in Supabase → SQL Editor (safe on existing data)
-- ============================================

-- PROJECTS ------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '📂',
  notes text default '',
  position int default 0,
  created_at timestamptz default now()
);

alter table public.projects enable row level security;
create policy "own projects select" on public.projects for select using (auth.uid() = user_id);
create policy "own projects insert" on public.projects for insert with check (auth.uid() = user_id);
create policy "own projects update" on public.projects for update using (auth.uid() = user_id);
create policy "own projects delete" on public.projects for delete using (auth.uid() = user_id);

-- PROJECT SECTIONS (nested via parent_id) -----
create table public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.project_sections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position int default 0,
  created_at timestamptz default now()
);

alter table public.project_sections enable row level security;
create policy "own psections select" on public.project_sections for select using (auth.uid() = user_id);
create policy "own psections insert" on public.project_sections for insert with check (auth.uid() = user_id);
create policy "own psections update" on public.project_sections for update using (auth.uid() = user_id);
create policy "own psections delete" on public.project_sections for delete using (auth.uid() = user_id);

-- PROJECT ITEMS (tasks inside projects) -------
create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_id uuid references public.project_sections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  link text,
  due_date date,
  completed boolean default false,
  completed_at timestamptz,
  position int default 0,
  created_at timestamptz default now()
);

alter table public.project_items enable row level security;
create policy "own pitems select" on public.project_items for select using (auth.uid() = user_id);
create policy "own pitems insert" on public.project_items for insert with check (auth.uid() = user_id);
create policy "own pitems update" on public.project_items for update using (auth.uid() = user_id);
create policy "own pitems delete" on public.project_items for delete using (auth.uid() = user_id);

-- ROUTINES (master templates) -----------------
-- days: which weekdays this routine runs, as digits 0-6 (0 = Sunday).
-- e.g. '12345' = weekdays, '0123456' = every day.
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '🔁',
  days text default '0123456',
  position int default 0,
  created_at timestamptz default now()
);

alter table public.routines enable row level security;
create policy "own routines select" on public.routines for select using (auth.uid() = user_id);
create policy "own routines insert" on public.routines for insert with check (auth.uid() = user_id);
create policy "own routines update" on public.routines for update using (auth.uid() = user_id);
create policy "own routines delete" on public.routines for delete using (auth.uid() = user_id);

-- ROUTINE STEPS (master steps) ----------------
create table public.routine_steps (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  time_hint text,           -- 'HH:MM' or null
  position int default 0,
  created_at timestamptz default now()
);

alter table public.routine_steps enable row level security;
create policy "own rsteps select" on public.routine_steps for select using (auth.uid() = user_id);
create policy "own rsteps insert" on public.routine_steps for insert with check (auth.uid() = user_id);
create policy "own rsteps update" on public.routine_steps for update using (auth.uid() = user_id);
create policy "own rsteps delete" on public.routine_steps for delete using (auth.uid() = user_id);

-- ROUTINE DAY STEPS (today's editable copy) ---
-- When a routine appears in the Daily planner, its master steps are copied
-- here for that date. All edits (check, rename, add, remove) touch only
-- these rows — the master routine never changes.
create table public.routine_day_steps (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null,
  time_hint text,
  position int default 0,
  done boolean default false
);

alter table public.routine_day_steps enable row level security;
create policy "own rdsteps select" on public.routine_day_steps for select using (auth.uid() = user_id);
create policy "own rdsteps insert" on public.routine_day_steps for insert with check (auth.uid() = user_id);
create policy "own rdsteps update" on public.routine_day_steps for update using (auth.uid() = user_id);
create policy "own rdsteps delete" on public.routine_day_steps for delete using (auth.uid() = user_id);

-- ROUTINE DAY STATE (marks a date as materialised) --
-- Prevents re-copying master steps if the user deletes every step for a day.
create table public.routine_day_state (
  routine_id uuid not null references public.routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  primary key (routine_id, date)
);

alter table public.routine_day_state enable row level security;
create policy "own rdstate select" on public.routine_day_state for select using (auth.uid() = user_id);
create policy "own rdstate insert" on public.routine_day_state for insert with check (auth.uid() = user_id);
create policy "own rdstate delete" on public.routine_day_state for delete using (auth.uid() = user_id);
