-- ============================================
-- PRIO · Phase 4: Calendar events + invites
-- Run ONCE in Supabase → SQL Editor (safe on existing data)
-- ============================================

-- EVENTS --------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean default false,
  color text default '#4353ff',
  created_at timestamptz default now()
);

create index if not exists events_owner_start_idx on public.events (owner_id, starts_at);

-- EVENT INVITES -------------------------------
-- status: 'pending' | 'accepted' | 'declined'
create table if not exists public.event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz default now(),
  unique (event_id, invitee_id)
);

create index if not exists event_invites_invitee_idx on public.event_invites (invitee_id, status);

alter table public.events enable row level security;
alter table public.event_invites enable row level security;

-- Helper: is the current user invited to this event?
-- SECURITY DEFINER avoids the events <-> invites policy recursion.
create or replace function public.is_invited(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.event_invites
    where event_id = p_event_id and invitee_id = auth.uid()
  );
$$;

-- EVENTS policies: owner has full control; invitees can read only.
drop policy if exists "events select" on public.events;
create policy "events select" on public.events for select
  using (auth.uid() = owner_id or public.is_invited(id));

drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events for insert
  with check (auth.uid() = owner_id);

drop policy if exists "events update" on public.events;
create policy "events update" on public.events for update
  using (auth.uid() = owner_id);

drop policy if exists "events delete" on public.events;
create policy "events delete" on public.events for delete
  using (auth.uid() = owner_id);

-- INVITES policies:
-- read: you're the invitee, or you're the event owner
-- create/remove: only the event owner
-- update: only the invitee, and only to accept/decline (status column)
drop policy if exists "invites select" on public.event_invites;
create policy "invites select" on public.event_invites for select
  using (
    auth.uid() = invitee_id
    or exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

drop policy if exists "invites insert" on public.event_invites;
create policy "invites insert" on public.event_invites for insert
  with check (
    auth.uid() = inviter_id
    and exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

drop policy if exists "invites update" on public.event_invites;
create policy "invites update" on public.event_invites for update
  using (auth.uid() = invitee_id)
  with check (auth.uid() = invitee_id);

drop policy if exists "invites delete" on public.event_invites;
create policy "invites delete" on public.event_invites for delete
  using (
    auth.uid() = invitee_id
    or exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

-- PEOPLE SEARCH -------------------------------
-- Privacy-conscious lookup. Deliberately does NOT expose emails, and
-- requires at least 2 characters matching from the START of a name or
-- email local-part, so the whole user list can't be enumerated.
-- Returns at most 8 rows.
create or replace function public.search_people(q text)
returns table (id uuid, display_name text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.display_name
  from public.profiles p
  where length(trim(q)) >= 2
    and p.id <> auth.uid()
    and (
      p.display_name ilike trim(q) || '%'
      or exists (
        select 1 from auth.users u
        where u.id = p.id and split_part(u.email, '@', 1) ilike trim(q) || '%'
      )
    )
  order by p.display_name
  limit 8;
$$;

revoke all on function public.search_people(text) from public, anon;
grant execute on function public.search_people(text) to authenticated;

-- Let signed-in users resolve the names of people on an event they can see.
drop policy if exists "profiles readable to signed in" on public.profiles;
create policy "profiles readable to signed in" on public.profiles for select
  using (auth.role() = 'authenticated');
