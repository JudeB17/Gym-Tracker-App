-- ============================================================
-- Gym app: shared workout feed
-- Run once in the Supabase SQL editor of the project the habit app
-- uses. Every object is prefixed gym_ so nothing collides with the
-- habit app's tables. Safe to re-run.
-- ============================================================

-- one row per person who has opened the feed settings
create table if not exists public.gym_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  in_feed      boolean not null default false,
  updated_at   timestamptz not null default now()
);

-- one row per posted workout. The workout itself is a JSON copy made
-- when it was posted (or last edited), so the app's data shape can
-- keep changing without migrations.
create table if not exists public.gym_posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.gym_profiles (user_id) on delete cascade,
  session_id   text not null check (char_length(session_id) between 1 and 64),
  workout_date date not null,
  title        text not null check (char_length(title) between 1 and 120),
  data         jsonb not null check (octet_length(data::text) < 100000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, session_id)
);
create index if not exists gym_posts_feed_idx on public.gym_posts (workout_date desc, created_at desc);

-- is this person currently in the feed? security definer so the
-- policies below can ask without recursing through RLS
create or replace function public.gym_in_feed(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select in_feed from public.gym_profiles where user_id = uid), false)
$$;
revoke all on function public.gym_in_feed(uuid) from public;
grant execute on function public.gym_in_feed(uuid) to authenticated;

alter table public.gym_profiles enable row level security;
alter table public.gym_posts    enable row level security;

-- profiles: you always see your own; feed members see each other
drop policy if exists gym_profiles_select on public.gym_profiles;
create policy gym_profiles_select on public.gym_profiles for select to authenticated
  using (user_id = auth.uid() or (in_feed and public.gym_in_feed(auth.uid())));
drop policy if exists gym_profiles_insert on public.gym_profiles;
create policy gym_profiles_insert on public.gym_profiles for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists gym_profiles_update on public.gym_profiles;
create policy gym_profiles_update on public.gym_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists gym_profiles_delete on public.gym_profiles;
create policy gym_profiles_delete on public.gym_profiles for delete to authenticated
  using (user_id = auth.uid());

-- posts: only visible while both you and the poster are in the feed.
-- Leaving the feed hides your posts without deleting them.
drop policy if exists gym_posts_select on public.gym_posts;
create policy gym_posts_select on public.gym_posts for select to authenticated
  using (user_id = auth.uid() or (public.gym_in_feed(auth.uid()) and public.gym_in_feed(user_id)));
drop policy if exists gym_posts_insert on public.gym_posts;
create policy gym_posts_insert on public.gym_posts for insert to authenticated
  with check (user_id = auth.uid() and public.gym_in_feed(auth.uid()));
drop policy if exists gym_posts_update on public.gym_posts;
create policy gym_posts_update on public.gym_posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.gym_in_feed(auth.uid()));
drop policy if exists gym_posts_delete on public.gym_posts;
create policy gym_posts_delete on public.gym_posts for delete to authenticated
  using (user_id = auth.uid());

-- anonymous visitors get nothing
revoke all on public.gym_profiles from anon;
revoke all on public.gym_posts    from anon;
grant select, insert, update, delete on public.gym_profiles to authenticated;
grant select, insert, update, delete on public.gym_posts    to authenticated;
