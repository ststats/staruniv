-- 어드민 일정 화면의 '달력 사진 갱신' 버튼이 부르는 함수.
-- 스타유니브 빌드(Build StarUniv web)를 실행해 docs/data/calendar.png를 새로 찍는다
-- (외부 자동화가 이 사진 주소를 가져간다). GitHub 토큰은 브라우저에 두지 않고 Vault에서 꺼내 쓴다.
--
-- 준비(한 번만):
--   1) GitHub에서 fine-grained 토큰 발급: 저장소 ststats/staruniv만, 권한 Actions = Read and write
--   2) 아래 한 줄을 SQL 편집기에서 실행해 토큰을 Vault에 넣는다(토큰 값은 이 파일에 적지 말 것)
--        select vault.create_secret('<토큰>', 'github_actions_token');
--      토큰을 바꿀 때는:
--        select vault.update_secret((select id from vault.secrets where name = 'github_actions_token'), '<새 토큰>');
--   3) 이 파일 전체를 실행한다.
--
-- 버튼을 여러 번 눌러도 빌드가 줄줄이 쌓이지 않는다: 워크플로의 concurrency 설정 때문에
-- 도는 중인 빌드 하나 + 대기 하나만 남는다.

create extension if not exists pg_net with schema extensions;

-- 빌드 실행 요청. 반환값은 pg_net 요청 번호(결과 확인용).
create or replace function public.admin_request_calendar_capture()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
  request_id bigint;
begin
  if not public.is_admin() then
    raise exception '관리자만 실행할 수 있습니다.';
  end if;
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_actions_token'
  limit 1;
  if token is null or token = '' then
    raise exception 'GitHub 토큰(github_actions_token)이 Vault에 없습니다.';
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/ststats/staruniv/actions/workflows/update.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'staruniv-supabase'
    )
  ) into request_id;
  return request_id;
end;
$$;

-- 요청 결과: GitHub 응답 코드(204면 성공). 아직 응답이 없으면 null.
create or replace function public.admin_calendar_capture_status(p_request_id bigint)
returns table (status_code integer, error text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 실행할 수 있습니다.';
  end if;
  return query
    select r.status_code, coalesce(r.error_msg, case when r.status_code >= 300 then left(r.content::text, 300) end)
    from net._http_response r
    where r.id = p_request_id;
end;
$$;

revoke all on function public.admin_request_calendar_capture() from public, anon;
revoke all on function public.admin_calendar_capture_status(bigint) from public, anon;
grant execute on function public.admin_request_calendar_capture() to authenticated;
grant execute on function public.admin_calendar_capture_status(bigint) to authenticated;

-- (예전 안) 일정이 바뀔 때마다 자동으로 돌리던 트리거가 있으면 지운다
drop trigger if exists calendar_events_capture on public.calendar_events;
drop trigger if exists calendar_off_air_capture on public.calendar_off_air;
drop function if exists public.request_calendar_capture();
