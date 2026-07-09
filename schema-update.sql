-- ============================================
-- ROOTED · Phase 1 schema update
-- Run this ONCE in Supabase → SQL Editor (safe to run on your existing data)
-- ============================================

-- Tasks get a "scope" (daily / weekly / monthly / half-yearly / yearly)
-- and a completion timestamp so Today's Wins knows what was done today
alter table public.tasks add column if not exists scope text default 'daily';
alter table public.tasks add column if not exists completed_at timestamptz;
update public.tasks set scope = 'daily' where scope is null;

-- HABITS (for streaks) -----------------------
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '⭐',
  position int default 0,
  created_at timestamptz default now()
);

alter table public.habits enable row level security;
create policy "own habits select" on public.habits for select using (auth.uid() = user_id);
create policy "own habits insert" on public.habits for insert with check (auth.uid() = user_id);
create policy "own habits update" on public.habits for update using (auth.uid() = user_id);
create policy "own habits delete" on public.habits for delete using (auth.uid() = user_id);

-- HABIT CHECKS (one row per habit per day) ----
create table public.habit_checks (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  unique (habit_id, date)
);

alter table public.habit_checks enable row level security;
create policy "own checks select" on public.habit_checks for select using (auth.uid() = user_id);
create policy "own checks insert" on public.habit_checks for insert with check (auth.uid() = user_id);
create policy "own checks delete" on public.habit_checks for delete using (auth.uid() = user_id);

-- BRAIN DUMP (one blank page per user) --------
create table public.brain_dump (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content text default '',
  updated_at timestamptz default now()
);

alter table public.brain_dump enable row level security;
create policy "own dump select" on public.brain_dump for select using (auth.uid() = user_id);
create policy "own dump insert" on public.brain_dump for insert with check (auth.uid() = user_id);
create policy "own dump update" on public.brain_dump for update using (auth.uid() = user_id);
