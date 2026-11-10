-- Migration: 0004_human_labels.sql
-- Add human labeling columns and model routing metadata to absa_tweets
alter table public.absa_tweets
  add column if not exists human_label text check (human_label in ('positive', 'negative', 'neutral')),
  add column if not exists label_source text check (label_source in ('random', 'uncertain', 'import')),
  add column if not exists labeled_at timestamptz,
  add column if not exists model_route text;

-- Indexes to optimize labeling queue sampling and evaluated subsets
create index if not exists idx_absa_tweets_human_label on public.absa_tweets(topic_key) where human_label is not null;
create index if not exists idx_absa_tweets_unlabeled on public.absa_tweets(topic_key, "time" desc) where human_label is null;

-- Recreate absa_tweets_v view to expose human labels and model route
drop view if exists public.absa_tweets_v cascade;

create view public.absa_tweets_v
with (security_invoker = true)
as
select id,
       topic_key,
       aspect,
       "user" as handle,
       "time" as tweeted_at,
       text,
       cleaned_text,
       coalesce(platform, 'twitter') as platform,
       subreddit,
       context_url,
       rationale,
       model_route,
       "qwen2.5-3b-instruct_sentiment" as sentiment,
       qwen_prob_pos as p_pos,
       qwen_prob_neg as p_neg,
       qwen_prob_neu as p_neu,
       human_label,
       label_source,
       labeled_at,
       created_at
from public.absa_tweets;

grant select on public.absa_tweets_v to anon, authenticated, service_role;

