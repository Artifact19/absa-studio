-- Migration: Add platform and Reddit metadata and CoT rationale to absa_tweets and recreate absa_tweets_v view
alter table public.absa_tweets 
  add column if not exists platform text not null default 'twitter',
  add column if not exists subreddit text,
  add column if not exists context_url text,
  add column if not exists rationale text;

create or replace view public.absa_tweets_v
with (security_invoker = true)
as
select id, topic_key, aspect, "user" as handle, "time" as tweeted_at, text, cleaned_text,
       coalesce(platform, 'twitter') as platform, subreddit, context_url, rationale,
       "qwen2.5-3b-instruct_sentiment" as sentiment,
       qwen_prob_pos as p_pos, qwen_prob_neg as p_neg, qwen_prob_neu as p_neu, created_at
from public.absa_tweets;

grant select on public.absa_tweets_v to anon, authenticated, service_role;
alter view if exists public.absa_tweets_v set (security_invoker = true);
