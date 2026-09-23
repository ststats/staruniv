-- Idempotent public read grants for the browser-facing site.
-- Write access remains restricted to the existing authenticated admin policies.

revoke all on public.members from anon;
revoke all on public.teams from anon;
revoke all on public.matches from anon;
revoke all on public.rounds from anon;
revoke all on public.tier_members from anon;

grant select (source_order,nickname,soop_id,birth_date,gender,race,tier,role,joined_date,left_date,mbti,avatar_path) on public.members to anon;
grant select (source_order,team_name,logo_path) on public.teams to anon;
grant select (source_order,match_no,match_date,opponent_team,match_format,method,final_result,set_result) on public.matches to anon;
grant select (source_order,match_no,match_date,opponent_team,match_format,set_name,round_name,our_player,our_race,result,opponent_player,opponent_race,map_name) on public.rounds to anon;
grant select (source_order,nickname,soop_id,race,tier,affiliation,modified_at) on public.tier_members to anon;

drop policy if exists public_read_teams on public.teams;
create policy public_read_teams on public.teams for select to anon using (true);
drop policy if exists public_read_members on public.members;
create policy public_read_members on public.members for select to anon using (true);
drop policy if exists public_read_matches on public.matches;
create policy public_read_matches on public.matches for select to anon using (true);
drop policy if exists public_read_rounds on public.rounds;
create policy public_read_rounds on public.rounds for select to anon using (true);
drop policy if exists public_read_tier_members on public.tier_members;
create policy public_read_tier_members on public.tier_members for select to anon using (true);

revoke all on public.calendar_events from anon;
revoke all on public.calendar_off_air from anon;
revoke all on public.site_config from anon;
grant select (id,source_order,start_date,end_date,event_time,person,description,detail,color) on public.calendar_events to anon;
grant select (off_date,soop_id,source_order) on public.calendar_off_air to anon;
grant select (config_key,config_value) on public.site_config to anon;
drop policy if exists public_read_calendar_events on public.calendar_events;
create policy public_read_calendar_events on public.calendar_events for select to anon using (true);
drop policy if exists public_read_calendar_off_air on public.calendar_off_air;
create policy public_read_calendar_off_air on public.calendar_off_air for select to anon using (true);
drop policy if exists public_read_site_config on public.site_config;
create policy public_read_site_config on public.site_config for select to anon using (config_key='nav');

revoke all on public.history_entries from anon;
grant select (id,entry_kind,event_date,event_type,title,description,members,youtube_url,image_path,sort_order,hidden) on public.history_entries to anon;
drop policy if exists public_read_history_entries on public.history_entries;
create policy public_read_history_entries on public.history_entries for select to anon using (true);

revoke all on public.video_channels from anon;
revoke all on public.videos from anon;
revoke all on public.video_picks from anon;
grant select (channel_url,channel_id,title,display_name,thumb,uploads,source_order,active) on public.video_channels to anon;
grant select (id,channel_url,title,published,thumb,views,short,hidden) on public.videos to anon;
grant select (id,kind,title,note,group_name,group_en,added_at,author,thumb,short,hidden,source_order) on public.video_picks to anon;
drop policy if exists public_read_video_channels on public.video_channels;
create policy public_read_video_channels on public.video_channels for select to anon using (active=true);
drop policy if exists public_read_videos on public.videos;
create policy public_read_videos on public.videos for select to anon using (true);
drop policy if exists public_read_video_picks on public.video_picks;
create policy public_read_video_picks on public.video_picks for select to anon using (true);

revoke all on public.external_tools from anon;
grant select (id,category,name,url,favicon,source_order,active) on public.external_tools to anon;
drop policy if exists public_read_external_tools on public.external_tools;
create policy public_read_external_tools on public.external_tools for select to anon using (active=true);
