-- 관리자 대시보드 ELO exact 통계
create or replace function public.admin_elo_stats()
returns table (
  total bigint,
  min_match_id bigint,
  max_match_id bigint,
  first_match_date date,
  last_match_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  return query
  select
    count(*)::bigint,
    min(m.elo_match_id)::bigint,
    max(m.elo_match_id)::bigint,
    min(m.match_date)::date,
    max(m.match_date)::date
  from public.elo_matches m;
end;
$$;

revoke all on function public.admin_elo_stats() from public;
grant execute on function public.admin_elo_stats() to authenticated;
