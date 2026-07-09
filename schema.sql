-- ============================================
-- PRIO · Supabase schema
-- Run this once in Supabase → SQL Editor → New query → Run
-- ============================================

-- 1. PROFILES ---------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create a profile row when someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. PRIORITIES (custom colour labels) --------
create table public.priorities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  position int default 0,
  created_at timestamptz default now()
);

alter table public.priorities enable row level security;

create policy "Users manage own priorities select"
  on public.priorities for select using (auth.uid() = user_id);
create policy "Users manage own priorities insert"
  on public.priorities for insert with check (auth.uid() = user_id);
create policy "Users manage own priorities update"
  on public.priorities for update using (auth.uid() = user_id);
create policy "Users manage own priorities delete"
  on public.priorities for delete using (auth.uid() = user_id);

-- 3. TASKS ------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  priority_id uuid references public.priorities(id) on delete set null,
  due_date date,
  completed boolean default false,
  created_at timestamptz default now()
);

alter table public.tasks enable row level security;

create policy "Users manage own tasks select"
  on public.tasks for select using (auth.uid() = user_id);
create policy "Users manage own tasks insert"
  on public.tasks for insert with check (auth.uid() = user_id);
create policy "Users manage own tasks update"
  on public.tasks for update using (auth.uid() = user_id);
create policy "Users manage own tasks delete"
  on public.tasks for delete using (auth.uid() = user_id);
