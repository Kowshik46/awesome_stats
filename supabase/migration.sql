alter table public.page_views add column if not exists visitor_hash text;
alter table public.page_events add column if not exists visitor_hash text;
-- Old rows keep visitor_hash null; the dashboard falls back to ip_hash for them.
