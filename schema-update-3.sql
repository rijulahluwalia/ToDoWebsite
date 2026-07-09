-- ============================================
-- PRIO · Phase 3 starter: University
-- Run once after schema.sql, schema-update.sql, schema-update-2.sql
-- ============================================

create extension if not exists "pgcrypto";

create table if not exists public.uni_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text,
  name text not null,
  color text default '#4353ff',
  position integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.uni_classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.uni_subjects(id) on delete cascade,
  class_type text default 'Class',
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time,
  end_time time,
  room text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.uni_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.uni_subjects(id) on delete cascade,
  title text not null,
  due_date date,
  weight numeric default 0,
  task_type text default 'Individual',
  notes text,
  position integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.uni_assessment_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.uni_assessments(id) on delete cascade,
  title text not null,
  done boolean default false,
  position integer default 0,
  created_at timestamptz default now()
);

alter table public.uni_subjects enable row level security;
alter table public.uni_classes enable row level security;
alter table public.uni_assessments enable row level security;
alter table public.uni_assessment_steps enable row level security;

create policy "Users manage own uni subjects" on public.uni_subjects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own uni classes" on public.uni_classes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own uni assessments" on public.uni_assessments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own uni assessment steps" on public.uni_assessment_steps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
