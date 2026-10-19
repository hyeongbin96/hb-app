-- Supabase 대시보드 > SQL Editor에서 한 번 실행하세요.

create table if not exists public.boards (
  id text primary key,
  data jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- RLS를 켜고 정책은 만들지 않는다: 공개(anon) 키로는 접근할 수 없고
-- Vercel 함수가 쓰는 service_role 키로만 읽고 쓸 수 있다.
alter table public.boards enable row level security;

insert into public.boards (id) values ('main') on conflict (id) do nothing;

-- 접속자 기록 (관리자만 조회). 이미 위 테이블을 만들었다면 아래만 실행해도 된다.
create table if not exists public.presence (
  id text primary key,
  nickname text not null,
  card_id text,
  last_seen timestamptz not null default now()
);

alter table public.presence enable row level security;
