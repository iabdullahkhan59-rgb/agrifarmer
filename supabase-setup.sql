-- ============================================================
-- AgriTrack — Supabase Table Setup
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jnnbtvgobqzdqyafxxvp/sql
-- ============================================================

create table if not exists public.farmers (
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
  date         timestamptz default now()
);

-- Enable Row Level Security (RLS)
alter table public.farmers enable row level security;

-- Allow all operations with the publishable (anon) key
-- (suitable for a single-user / internal tool — tighten this for multi-user apps)
create policy "Allow all for anon"
  on public.farmers
  for all
  using (true)
  with check (true);
