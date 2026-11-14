-- S.M.I.P schema for Supabase (Postgres)
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste ->
-- Run. It is idempotent, so it is safe to run again after an update.
--
-- The server talks to these tables through the REST API using the service-role
-- key. Row Level Security is enabled with no public policies: the anon key can
-- read nothing, and only the service role (which bypasses RLS) can write.

-- ---------------------------------------------------------------- extensions
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------ trackers
create table if not exists public.trackers (
  id          text primary key,
  type        text not null default 'brand',
  query       text not null,
  platforms   text[] not null default '{}',
  -- Handles for channels that have no keyword search (Telegram channel names).
  accounts    text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------- analyzed posts
create table if not exists public.analyzed_posts (
  id               text primary key,
  url              text not null default '',
  platform         text not null default 'other',
  title            text not null default '',
  description      text not null default '',
  image_url        text not null default '',
  sentiment        text not null default 'neutral'
                   check (sentiment in ('positive', 'neutral', 'negative')),
  sentiment_score  double precision not null default 0,
  emotion          text not null default 'Neutral',
  engagement       text not null default 'Low',
  hashtags         text[] not null default '{}',
  analyzed_at      timestamptz not null default now()
);

-- ----------------------------------------------------------- monitor results
create table if not exists public.monitor_results (
  id               text primary key,
  platform         text not null default 'unknown',
  url              text not null default '',
  author           text not null default '',
  title            text not null default '',
  content          text not null default '',
  sentiment        text not null default 'neutral'
                   check (sentiment in ('positive', 'neutral', 'negative')),
  sentiment_score  double precision not null default 0,
  emotion          text not null default 'Neutral',
  engagement       text not null default 'Low',
  date             timestamptz not null default now(),
  tracker_id       text not null default '',
  country          text not null default 'Global',
  -- Coordinates are only stored when the source publishes them. Most read APIs
  -- do not, so these stay null rather than being filled with a country centroid.
  latitude         double precision,
  longitude        double precision,
  -- Raw engagement count from the source, kept so a ranking can use a number.
  -- `engagement` above stays the High/Medium/Low label the UI renders.
  engagement_score integer,
  -- Which query framing found this row (exact phrase, intent words, hashtag...).
  query_variant    text
);

-- --------------------------------------------------------------- indexes
create index if not exists idx_mentions_tracker on public.monitor_results (tracker_id);
create index if not exists idx_mentions_tracker_url on public.monitor_results (tracker_id, url);
create index if not exists idx_mentions_date    on public.monitor_results (date desc);
create index if not exists idx_analyzed_date    on public.analyzed_posts (analyzed_at desc);

-- ------------------------------------------------------------------ updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_trackers_updated_at on public.trackers;
create trigger trg_trackers_updated_at
  before update on public.trackers
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------- row level security
-- Enabled with zero policies: anon and authenticated keys get nothing.
-- The server uses the service-role key, which bypasses RLS by design.
alter table public.trackers       enable row level security;
alter table public.analyzed_posts enable row level security;
alter table public.monitor_results enable row level security;

revoke all on public.trackers        from anon, authenticated;
revoke all on public.analyzed_posts  from anon, authenticated;
revoke all on public.monitor_results from anon, authenticated;

-- --------------------------------------------------------------- verification
-- After running, this should return three rows and zero policies:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename in
--          ('trackers', 'analyzed_posts', 'monitor_results');
--   select count(*) from pg_policies where schemaname = 'public';

-- ------------------------------------------------- growing an existing install
-- `create table if not exists` does nothing to a table that already exists, so a
-- database created before these columns were added needs them spelled out. All
-- of these are additive and safe to run more than once.
alter table public.monitor_results add column if not exists engagement_score integer;
alter table public.monitor_results add column if not exists query_variant    text;
create index if not exists idx_mentions_tracker_url on public.monitor_results (tracker_id, url);
alter table public.trackers add column if not exists accounts text[] not null default '{}';
