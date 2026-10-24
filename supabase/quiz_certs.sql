-- Applied 2026-10-24. Written by the award Edge Function (Day 13 quiz certificates); read by the dashboard (service role).
create table public.quiz_certs (id bigint generated always as identity primary key, created_at timestamptz not null default now(), created_at_ist timestamp generated always as ((created_at at time zone 'Asia/Kolkata')) stored, cert_id text not null unique, quiz text not null default 'day-13', name text not null, score int not null check (score >= 0), total int not null check (total > 0 and score <= total), title text, stages jsonb, utm_source text, utm_campaign text, referrer text, browser text, country text, ip_hash text);
alter table public.quiz_certs enable row level security; -- no policies: service role only
create index quiz_certs_created_idx on public.quiz_certs (created_at);
create index quiz_certs_ip_idx on public.quiz_certs (ip_hash, created_at);
