-- ============================================================
-- AgriTrack - Supabase Table Setup
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jnnbtvgobqzdqyafxxvp/sql
-- ============================================================

-- Drop old table if exists (re-run safe)
drop table if exists public.farmers;

-- Create farmers table with user_id for per-user data isolation
create table public.farmers (
  id           text primary key,
  name         text not null,
  contact      text,
  dealer       text,
  land_area    numeric,
  crops        jsonb default '[]',
  village      text,
  tehsil       text,
  district     text,
  province     text,
  full_address text,
  lat          numeric,
  lng          numeric,
  products     jsonb default '[]',
  date         timestamptz default now(),
  user_id      uuid references auth.users(id) on delete cascade
);

-- Enable Row Level Security
alter table public.farmers enable row level security;

-- Each user can only access their own farmers
create policy "select_own" on public.farmers
  for select using (auth.uid() = user_id);

create policy "insert_own" on public.farmers
  for insert with check (auth.uid() = user_id);

create policy "update_own" on public.farmers
  for update using (auth.uid() = user_id);

create policy "delete_own" on public.farmers
  for delete using (auth.uid() = user_id);
