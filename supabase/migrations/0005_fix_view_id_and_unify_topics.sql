-- Migration: 0005_fix_view_id_and_unify_topics.sql
-- 1. Unify fragmented topics and aspects (Ramayana, GTA 6, Microsoft)
update public.absa_tweets
set topic_key = 'ramayana part 1',
    aspect = 'Ramayana Part 1'
where topic_key in ('ramayana part 1', 'ramayana part 1 rise of the legend')
   or aspect in ('ramayana part 1', 'Ramayana Part 1', 'Ramayana Rise');

update public.absa_tweets
set topic_key = 'gta 6',
    aspect = 'GTA 6'
where topic_key in ('gta 6', 'gta6')
   or aspect = 'GTA 6';

update public.absa_tweets
set topic_key = 'microsoft',
    aspect = 'Microsoft'
where topic_key = 'microsoft';

update public.absa_tweets
set topic_key = 'bengal famine',
    aspect = 'Bengal famine'
where topic_key = 'bengal fanine';

-- Ensure all rows have valid non-null string IDs
update public.absa_tweets
set id = row_id::text
where id is null or id = 'nan';

-- 2. Ensure absa_tweets_v always exposes a non-null id by coalescing with row_id
drop view if exists public.absa_tweets_v cascade;

create view public.absa_tweets_v
with (security_invoker = true)
as
select coalesce(id, row_id::text) as id,
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

