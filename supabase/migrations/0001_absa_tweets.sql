create extension if not exists pgcrypto;

create table if not exists public.absa_tweets (
  id            uuid primary key default gen_random_uuid(),
  topic_key     text        not null,           -- lowercased, trimmed, collapsed whitespace
  aspect        text,                           -- extracted target entity (display form)
  "user"        text,
  "time"        timestamptz not null,           -- original tweet timestamp
  text          text        not null,
  cleaned_text  text        not null,
  dedup_key     text        not null,           -- sha256(normalized text + '|' + lower(user))
  "qwen2.5-3b-instruct_sentiment" text
      check ("qwen2.5-3b-instruct_sentiment" in ('positive','negative','neutral')),
  qwen_prob_pos double precision check (qwen_prob_pos between 0 and 1),
  qwen_prob_neg double precision check (qwen_prob_neg between 0 and 1),
  qwen_prob_neu double precision check (qwen_prob_neu between 0 and 1),
  created_at    timestamptz not null default now(),
  constraint absa_tweets_topic_dedup_uniq unique (topic_key, dedup_key)
);

create index if not exists idx_absa_tweets_topic_key  on public.absa_tweets (topic_key);
create index if not exists idx_absa_tweets_created_at on public.absa_tweets (created_at desc);
create index if not exists idx_absa_tweets_topic_time on public.absa_tweets (topic_key, "time" desc);

-- Views defined with security_invoker = true to satisfy Supabase Security Advisor
create or replace view public.absa_tweets_v
with (security_invoker = true)
as
select id, topic_key, aspect, "user" as handle, "time" as tweeted_at, text, cleaned_text,
       "qwen2.5-3b-instruct_sentiment" as sentiment,
       qwen_prob_pos as p_pos, qwen_prob_neg as p_neg, qwen_prob_neu as p_neu, created_at
from public.absa_tweets;

-- Public-safe aggregate view with security_invoker = true
create or replace view public.topic_summary
with (security_invoker = true)
as
select topic_key,
       count(*)::int as n,
       min("time")  as oldest,
       max("time")  as newest
from public.absa_tweets
group by topic_key;

-- Storage metric RPC for admin dashboard
create or replace function public.admin_table_size() returns bigint
language sql security definer set search_path = public as
$$ select pg_total_relation_size('public.absa_tweets') $$;

-- ---------- RLS Security ----------
alter table public.absa_tweets enable row level security;

-- Drop redundant policy if it exists (service_role natively bypasses RLS)
drop policy if exists "service_role full access" on public.absa_tweets;

-- Grant read access to public views so queries never throw permission errors
grant select on public.absa_tweets_v to anon, authenticated, service_role;
grant select on public.topic_summary to anon, authenticated, service_role;
grant all on public.absa_tweets to service_role;
grant execute on function public.admin_table_size() to service_role, anon;

-- Revoke execute on rls_auto_enable helper if it exists in the database
do $$
begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable') then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated;';
  end if;
end $$;
