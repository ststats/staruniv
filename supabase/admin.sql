-- StarUniv 관리자용 Auth/RLS 설정
-- 현재 운영 중인 Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- 실행 후 Authentication > Users 에서 관리자 계정을 만든 다음, 맨 아래 예시 INSERT로 등록합니다.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- RLS 정책 안에서 재사용하는 관리자 판별 함수.
-- SECURITY DEFINER로 admin_users 자체의 RLS 순환을 피한다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 로그인한 사용자는 자기 관리자 등록 상태만 읽을 수 있다.
drop policy if exists "admin_users_read_self" on public.admin_users;
create policy "admin_users_read_self"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

grant select on public.admin_users to authenticated;

-- 운영 데이터: 관리자만 브라우저에서 CRUD 가능.
do $$
declare
  t text;
begin
  foreach t in array array['settings','teams','members','matches','rounds','tier_members','calendar_events','calendar_off_air','site_config','history_entries']
  loop
    execute format('drop policy if exists %I on public.%I', 'admins_all_' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      'admins_all_' || t,
      t
    );
  end loop;
end $$;

grant select, insert, update, delete on public.settings, public.teams, public.members,
  public.matches, public.rounds, public.tier_members, public.calendar_events, public.calendar_off_air, public.site_config, public.history_entries to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ELO 원본은 관리자 화면에서는 조회만 허용한다.
do $$
declare
  t text;
begin
  foreach t in array array['elo_categories','elo_maps','elo_players','elo_matches']
  loop
    execute format('drop policy if exists %I on public.%I', 'admins_read_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_admin())',
      'admins_read_' || t,
      t
    );
  end loop;
end $$;

grant select on public.elo_categories, public.elo_maps, public.elo_players, public.elo_matches to authenticated;

-- 경기 + 세트를 한 트랜잭션으로 저장한다.
-- 기존 경기를 수정할 때는 source_order를 유지하고, 세트 목록은 전달된 내용으로 교체한다.
create or replace function public.admin_save_match(p_match jsonb, p_rounds jsonb default '[]'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_no integer;
  v_source_order integer;
  v_round_source integer;
  r jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  v_match_no := nullif(p_match->>'match_no', '')::integer;
  if v_match_no is null then
    select coalesce(max(match_no), 0) + 1 into v_match_no from public.matches;
  end if;

  v_source_order := nullif(p_match->>'source_order', '')::integer;
  if v_source_order is null then
    select coalesce(max(source_order), 0) + 1 into v_source_order from public.matches;
  end if;

  insert into public.matches (
    match_no, source_order, match_date, opponent_team, match_format, method,
    final_result, set_result, score_diff, funding, support_amount, personal_amount, challenge_mission
  ) values (
    v_match_no,
    v_source_order,
    nullif(p_match->>'match_date','')::date,
    nullif(p_match->>'opponent_team',''),
    nullif(p_match->>'match_format',''),
    nullif(p_match->>'method',''),
    nullif(p_match->>'final_result',''),
    nullif(p_match->>'set_result',''),
    nullif(p_match->>'score_diff',''),
    nullif(p_match->>'funding',''),
    nullif(p_match->>'support_amount',''),
    nullif(p_match->>'personal_amount',''),
    nullif(p_match->>'challenge_mission','')
  )
  on conflict (match_no) do update set
    source_order = excluded.source_order,
    match_date = excluded.match_date,
    opponent_team = excluded.opponent_team,
    match_format = excluded.match_format,
    method = excluded.method,
    final_result = excluded.final_result,
    set_result = excluded.set_result,
    score_diff = excluded.score_diff,
    funding = excluded.funding,
    support_amount = excluded.support_amount,
    personal_amount = excluded.personal_amount,
    challenge_mission = excluded.challenge_mission;

  delete from public.rounds where match_no = v_match_no;
  select coalesce(max(source_order), 0) into v_round_source from public.rounds;

  for r in select value from jsonb_array_elements(coalesce(p_rounds, '[]'::jsonb))
  loop
    v_round_source := v_round_source + 1;
    insert into public.rounds (
      source_order, match_no, match_date, opponent_team, match_format,
      set_name, round_name, our_player, our_race, our_tier, result,
      opponent_player, opponent_race, opponent_tier, map_name
    ) values (
      v_round_source,
      v_match_no,
      nullif(coalesce(r->>'match_date', p_match->>'match_date'),'')::date,
      nullif(coalesce(r->>'opponent_team', p_match->>'opponent_team'),''),
      nullif(coalesce(r->>'match_format', p_match->>'match_format'),''),
      nullif(r->>'set_name',''),
      nullif(r->>'round_name',''),
      nullif(r->>'our_player',''),
      nullif(r->>'our_race',''),
      nullif(r->>'our_tier',''),
      nullif(r->>'result',''),
      nullif(r->>'opponent_player',''),
      nullif(r->>'opponent_race',''),
      nullif(r->>'opponent_tier',''),
      nullif(r->>'map_name','')
    );
  end loop;

  return v_match_no;
end;
$$;

revoke all on function public.admin_save_match(jsonb, jsonb) from public;
grant execute on function public.admin_save_match(jsonb, jsonb) to authenticated;

-- 관리자 계정 등록 예시
-- 1) Authentication > Users > Add user 로 이메일/비밀번호 계정을 만든 뒤
-- 2) 아래 EMAIL 부분만 바꾸고 실행하세요.
-- insert into public.admin_users (user_id, role)
-- select id, 'owner' from auth.users where email = 'YOUR_ADMIN_EMAIL@example.com'
-- on conflict (user_id) do update set role = excluded.role, is_active = true;
