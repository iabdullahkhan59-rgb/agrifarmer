-- ============================================================
-- AgriTrack - Supabase Table Setup
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jnnbtvgobqzdqyafxxvp/sql
-- ============================================================

-- Drop old table if exists (re-run safe)
drop table if exists public.farmers;

-- Create farmers table
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
  lat          numeric,
  lng          numeric,
  products     jsonb default '[]',
  date         timestamptz default now(),
  user_id      uuid references auth.users(id) on delete cascade
);

-- Enable Row Level Security
alter table public.farmers enable row level security;

-- Policies: each user sees only their own rows
create policy "select_own" on public.farmers
  for select using (auth.uid() = user_id);

create policy "insert_own" on public.farmers
  for insert with check (auth.uid() = user_id);

-- Update and delete allow null user_id rows (imported data)
create policy "update_own" on public.farmers
  for update using (auth.uid() = user_id or user_id is null)
  with check (auth.uid() = user_id or user_id is null);

create policy "delete_own" on public.farmers
  for delete using (auth.uid() = user_id or user_id is null);

-- ============================================================
-- ONE-TIME FIX: Run these if you already have data in the table
-- (fixes disappearing dealer/products after sign out + sign in)
-- ============================================================

-- Step 1: Fix the update policy to allow null user_id rows
-- (already included above for fresh installs)
-- drop policy if exists "update_own" on public.farmers;
-- create policy "update_own" on public.farmers
--   for update using (auth.uid() = user_id or user_id is null)
--   with check (auth.uid() = user_id or user_id is null);

-- Step 2: Backfill user_id on rows that are missing it
-- Run this while logged in as your user in Supabase Auth:
-- update public.farmers
--   set user_id = auth.uid()
--   where user_id is null;
