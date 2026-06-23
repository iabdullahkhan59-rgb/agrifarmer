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

-- Allow update if the row belongs to the user OR if user_id is null
-- (handles farmers imported before user_id was set)
create policy "update_own" on public.farmers
  for update using (auth.uid() = user_id or user_id is null);

create policy "delete_own" on public.farmers
  for delete using (auth.uid() = user_id or user_id is null);

-- ============================================================
-- IMPORTANT: Run these in Supabase SQL Editor to fix existing data
-- that has NULL user_id (imported farmers, early records etc.)
-- This is the ROOT CAUSE of products disappearing on reload.
-- ============================================================

-- Step 1: Drop the old restrictive update policy
-- drop policy if exists "update_own" on public.farmers;

-- Step 2: Create a permissive update policy that also allows
-- updating rows where user_id is NULL
-- create policy "update_own" on public.farmers
--   for update using (auth.uid() = user_id or user_id is null)
--   with check (auth.uid() = user_id or user_id is null);

-- Step 3: Fill in the missing user_id for rows that don't have it
-- (Run this while logged in as the correct user in Supabase Auth)
-- update public.farmers
--   set user_id = auth.uid()
--   where user_id is null;
