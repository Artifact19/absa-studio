-- Migration: Add topic_metadata table and include genre in topic_summary view
create table if not exists public.topic_metadata (
  topic_key    text primary key,
  genre        text not null default 'General & News',
  description  text,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.topic_metadata enable row level security;

-- Grant permissions for service_role and reading
grant select on public.topic_metadata to anon, authenticated, service_role;
grant all on public.topic_metadata to service_role;

-- Recreate public.topic_summary view with genre
create or replace view public.topic_summary
with (security_invoker = true)
as
select a.topic_key,
       coalesce(m.genre, 'General & News') as genre,
       count(*)::int as n,
       min(a."time")  as oldest,
       max(a."time")  as newest
from public.absa_tweets a
left join public.topic_metadata m on m.topic_key = a.topic_key
group by a.topic_key, m.genre;

grant select on public.topic_summary to anon, authenticated, service_role;
alter view if exists public.topic_summary set (security_invoker = true);

