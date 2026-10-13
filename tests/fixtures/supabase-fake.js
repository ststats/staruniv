// 페이지 연기 테스트용 가짜 Supabase 응답(늘 같은 값).
const NAMES = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아라', '자람', '차오', '하늘', '한별'];
const TIERS = ['갓', '킹', '잭', '조커', '스페이드', '0', '1', '2', '3', '4', '5', '6', '7', '8', '베이비'];
const RACES = ['T', 'Z', 'P'];
const TEAMS = ['캄몬스타즈', '늪지대', '파비콘', '숲로고'];
const BASE = Date.UTC(2026, 8, 20, 3, 0, 0);
const day = (i) => new Date(BASE - i * 86400000).toISOString().slice(0, 10);

// 중첩 JSON이라 이름 규칙으로 그럴듯하게 만들 수 없는 표
const EMPTY = new Set(['member_posts', 'elo_ranking_meta', 'site_config', 'elo_rating_history']);

function value(col, i, table) {
  const c = col.toLowerCase();
  // 경기 형식은 실제 DB처럼 영문 키다. 아래 _name 규칙보다 먼저 본다
  if (c === 'category_name' && table === 'elo_public_matches') return ['college_event', 'college_war', 'college_mini', 'team_event', 'sponsored'][i % 5];
  if (table === 'history_entries') {
    if (c === 'image_path') return i % 3 === 0 ? `history/photo${i}.webp` : '';
    if (c === 'youtube_url') return i % 4 === 1 ? 'https://www.youtube.com/watch?v=abcdefghij' + (i % 10) : '';
    if (c === 'members') return i % 5 === 2 ? NAMES.slice(0, 9) : [NAMES[i % 12], NAMES[(i + 1) % 12]];
  }
  if (table === 'calendar_events' && c === 'end_date') return day(i * 2 - 6 - (i % 4 === 0 ? 3 : 0));
  if (table === 'external_tools') {
    if (c === 'url') return `https://tool${i}.example.com/page`;
    if (c === 'favicon') return i % 2 ? `https://tool${i}.example.com/favicon.ico` : '';
    if (c === 'category') return i % 3 === 2 ? 'extSites' : 'extTools';
  }
  if (c === 'id' || c === 'source_order' || c === 'sort_order' || c === 'match_no') return i + 1;
  if (c === 'elo_id' || c === 'opponent_elo_id' || c === 'map_id' || c === 'broad_no' || c === 'broad_cate_no') return 1000 + (c === 'opponent_elo_id' ? (i + 3) % 12 : i);
  if (c === 'soop_id') return 'user' + (i % 12);
  if (/(^|_)(nickname|name|person|elo_name|display_name|author|our_player|opponent_player)$/.test(c)) return NAMES[i % NAMES.length];
  if (c === 'tier') return TIERS[i % TIERS.length];
  if (c.endsWith('race')) return RACES[i % 3];
  if (c === 'gender') return i % 2 ? '여자' : '남자';
  if (c === 'affiliation' || c === 'opponent_team' || c === 'team_name') return TEAMS[i % TEAMS.length];
  if (c === 'role') return ['감독', '코치', '선수'][Math.min(i, 2)];
  if (c === 'members') return [NAMES[i % 12], NAMES[(i + 1) % 12]];
  if (c === 'event_time') return '20:00';
  if (c === 'color') return ['blue', 'red', 'green'][i % 3];
  if (c === 'stat_date' || c === 'month_end') return day(0);
  if (/(date|_on)$/.test(c) || c === 'start_date' || c === 'end_date') return day(i * 2 - 6);
  if (/(_at|published|broad_start|as_of)$/.test(c)) return new Date(BASE - i * 3600000).toISOString();
  if (/(won|short|hidden)$/.test(c)) return c === 'won' ? i % 2 === 0 : false;
  if (c === 'active' || c === 'is_active') return true;
  if (/(url|thumb|favicon|path)$/.test(c)) return '';
  if (/(wins|losses|games|views|viewers|balloons|seconds|rank|count|pages|uploads|rating|rating_se|current_sum_viewer)/.test(c)) return (i * 37 + 11) % 400;
  if (c === 'result' || c === 'final_result') return i % 2 ? '패' : '승';
  if (c === 'match_format' || c === 'category_name' || c === 'at_category') return ['대회', '대학', '미니', 'CK'][i % 4];
  return `${col} ${i + 1}`;
}

// DB 목록 함수(rpc): 표 줄을 {c, r} 모양으로
const RPC = {
  elo_players_list: (q) => ['elo_public_players', 'elo_id,elo_name,race,nickname,soop_id,tier,affiliation,total_games' + (q.get('p_ranked') === 'true' ? ',tier_rank,tier_count,as_of' : '')],
  elo_player_match_list: () => ['elo_public_matches', 'match_date,opponent_elo_id,won,map_id,map_name,category_name'],
  elo_rankings_list: () => ['elo_rankings', 'elo_id,raw_rating,tier,tier_rank,as_of'],
  elo_player_ratings_list: () => ['elo_player_ratings', 'elo_id,rating,rating_se'],
};
function POSTS() {
  const out = [];
  for (let i = 0; i < 12; i++) for (let k = 0; k < 2; k++) {
    const n = i * 2 + k;
    out.push({ soop_id: 'user' + i, post: {
      titleNo: 5000 + n, titleName: n % 3 ? `공지 ${n}` : `아주 긴 공지 제목이 여기 들어가서 한 줄을 넘어가는 경우 ${n}`,
      regDate: new Date(BASE - n * 5400000).toISOString().replace('T', ' ').slice(0, 19),
      photos: n % 4 === 0 ? [1, 2, 3].map((k) => ({ url: 'https://stimg.sooplive.co.kr/x/' + n + '-' + k + '.jpg' })) : [],
      content: { textContent: n % 2 ? '오늘 방송은 저녁 8시에 시작합니다. 많이 와 주세요!' : '', content: n % 2 ? '<p>오늘 방송은 저녁 8시에 시작합니다.</p><p>많이 와 주세요!</p>' : '' },
      count: { readCnt: 100 + n, likeCnt: n } } });
  }
  return out;
}
function respond(url) {
  const u = new URL(url);
  const fn = u.pathname.split('/').pop();
  if (fn === 'player_stats') {   // 선수용 함수: 받은 ID마다 한 줄(휴면 포함)
    const ids = (u.searchParams.get('p_ids') || '').split(',').filter(Boolean);
    const cols = 'stat_date,soop_id,nickname,balloons,broadcast_seconds,cumulative_viewers,sponsor_wins,sponsor_losses,updated_at'.split(',');
    return ids.map((id, i) => Object.fromEntries(cols.map((k) => [k, k === 'soop_id' ? id : value(k, i + 1)])));
  }
  // 공개 읽기 함수(api_*): 표 줄을 만들어 함수 결과 모양(JSON 하나)으로 돌려준다
  const T = (table, cols, extra = '') => respond(`https://fake.supabase.co/rest/v1/${table}?select=${cols}&limit=1000${extra}`);
  const API = {
    api_site_nav: () => (T('site_config', 'config_value')[0] || {}).config_value || {},
    api_university_logos: (q) => respond(`https://fake.supabase.co/rest/v1/university_logos?name=in.(${JSON.parse(q.get('p_names') || '[]').join(',')})`),
    api_daily_stats: (q) => q.get('p_date')
      ? T('daily_member_stats', q.get('p_light') ? 'role,affiliation,gender,balloons,broadcast_seconds,cumulative_viewers,sponsor_wins,sponsor_losses' : 'soop_id,nickname,role,affiliation,tier,gender,birth_month,balloons,broadcast_seconds,cumulative_viewers,sponsor_wins,sponsor_losses,updated_at,sponsor_updated_at', `&stat_date=eq.${q.get('p_date')}&order=nickname.asc,soop_id.asc`)
      : T('daily_member_stats', 'stat_date,soop_id,nickname,role,affiliation,tier,gender,birth_month,balloons,broadcast_seconds,cumulative_viewers,sponsor_wins,sponsor_losses,updated_at,sponsor_updated_at', '&order=nickname.asc,soop_id.asc'),
    api_live: () => T('live_broadcasts', 'soop_id,broad_no,broad_title,current_sum_viewer,broad_start,category_name,broad_cate_no'),
    api_live_ids: () => T('live_broadcasts', 'soop_id'),
    api_stats_dates: () => T('synergy_daily_dates', 'stat_date'),
    api_schedule: () => ({ events: T('calendar_events', 'id,start_date,end_date,event_time,person,description,detail,color'), offAir: T('calendar_off_air', 'off_date,soop_id') }),
    api_schedule_on: () => T('calendar_events', 'start_date,end_date,event_time,person,description'),
    api_history: () => T('history_entries', 'id,entry_kind,event_date,event_type,title,description,members,youtube_url,image_path,sort_order,hidden'),
    api_member_posts: () => POSTS().map((p) => ({ soop_id: p.soop_id, total_pages: 2, post: p.post })),
    api_recent_posts: () => POSTS().map((p) => ({ soop_id: p.soop_id, titleName: p.post.titleName, regDate: p.post.regDate, text: p.post.content.textContent, thumb: (p.post.photos[0] || {}).url || null })),
    api_tier_members: () => T('tier_members', 'nickname,soop_id,race,tier,affiliation,modified_at'),
    api_videos: q => {
      const data = {
      channels: [0, 1, 2].map((k) => ({ channel_url: 'https://www.youtube.com/@fan' + k, title: '팬튜브 채널 ' + k, display_name: ['캄몬 팬튜브', '스타대학 하이라이트', '아주 긴 이름의 팬 채널입니다'][k], thumb: k === 2 ? '' : 'https://yt3.ggpht.com/fan' + k + '.jpg' })),
      videos: Array.from({ length: 18 }, (_, i) => ({ id: ('vid' + i).padEnd(11, 'x'), channel_url: 'https://www.youtube.com/@fan' + (i % 3),
        title: i % 5 === 0 ? `아주 긴 영상 제목이 두 줄을 넘어가는지 보려고 길게 쓴 제목 ${i}번 - 하이라이트 모음` : `경기 하이라이트 ${i}`,
        published: new Date(BASE - i * 86400000 * 1.5).toISOString(), thumb: i % 4 === 3 ? '' : 'https://i.ytimg.com/vi/vid' + i + '/hqdefault.jpg',
        views: (i * 7919) % 250000 + 120, short: i % 3 === 1 })),
      picks: Array.from({ length: 7 }, (_, i) => ({ id: ('pick' + i).padEnd(11, 'x'), kind: 'youtube', title: `추천 영상 ${i}`, note: i % 2 ? '이 경기는 마지막 세트가 볼만합니다.\n두 번째 줄 설명' : '',
        group_name: i < 4 ? '명경기' : '입문', group_en: i < 4 ? 'CLASSIC' : 'BEGINNER', author: NAMES[i % NAMES.length], thumb: 'https://i.ytimg.com/vi/pick' + i + '/hqdefault.jpg', short: i === 6 })),
      };
      const selected = data.videos.filter(v => !q.get('p_channel') || v.channel_url === q.get('p_channel'));
      const normal = selected.filter(v => !v.short).sort((a,b) => b.published.localeCompare(a.published) || b.id.localeCompare(a.id));
      const before = q.get('p_before_id');
      const offset = before ? normal.findIndex(v => v.id === before) + 1 : 0;
      const limit = Number(q.get('p_limit') || 20);
      const videos = normal.slice(offset, offset + limit);
      const last = videos.at(-1);
      return {
        videos,
        next: offset + limit < normal.length ? { published: last.published, id: last.id } : null,
        summary: before ? null : {
          channels: data.channels.map(ch => ({ ...ch, count: data.videos.filter(v => v.channel_url === ch.channel_url).length })),
          total: normal.length,
          top: normal.filter(v => Date.parse(v.published) >= Date.now() - 30 * 86400000).sort((a,b) => b.views-a.views).slice(0,3),
          shorts: selected.filter(v => v.short).slice(0,24),
          picks: data.picks,
        },
      };
    },
    api_tools: () => T('external_tools', 'id,category,name,url,favicon'),
    api_elo_rating_range: () => { const r = T('elo_rating_history', 'month_end'); return { first: String((r[0] || {}).month_end || ''), last: String((r[r.length - 1] || {}).month_end || '') }; },
    api_elo_rating_history: () => T('elo_rating_history', 'month_end,rating'),
    api_elo_ranking_meta: () => T('elo_ranking_meta', 'as_of,tier_counts,tier_levels,race_matchup')[0] || {},
  };
  // 멤버 목록·프로필은 siteData()로 만들고 멤버 줄 순서를 _id로 쓴다
  if (fn === 'api_site_members') { const sd = siteData(); return { ...sd.members, members: sd.members.members.map((m, i) => ({ _id: i + 1, ...m })) }; }
  if (fn === 'api_member_profiles') { const sd = siteData(); const q = Object.fromEntries(Object.entries(sd.profiles.profiles).map(([k, v]) => [k, v.slice()])); const out = {}; sd.members.members.forEach((m, i) => { out[i + 1] = (q[m['이름']] || []).shift() || {}; }); return { profiles: out }; }
  if (fn === 'api_team_order') return [...TEAMS].reverse(); // 인원 순과 다르게
  if (fn === 'api_holidays') return { '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-10-03': '개천절' };
  if (u.pathname.includes('/rpc/') && API[fn]) return API[fn](u.searchParams);
  if (u.pathname.includes('/rpc/') && RPC[fn]) {
    const [table, cols] = RPC[fn](u.searchParams);
    const rows = respond(`https://fake.supabase.co/rest/v1/${table}?select=${cols}&limit=1000`);
    const c = cols.split(',');
    return { c, r: rows.map((row) => c.map((k) => row[k])) };
  }
  const table = fn;
  if (table === 'university_logos') {   // 이름으로 거른 것만(in.(...)), 늪지대는 로고 없음
    const m = (u.searchParams.get('name') || '').match(/^in\.\((.*)\)$/);
    const names = m ? m[1].split(',').map((x) => x.replace(/"/g, '')) : TEAMS;
    return names.filter((n) => n !== '늪지대').map((n) => ({ name: n, path: `logos/${n}.webp` }));
  }
  if (EMPTY.has(table)) return [];
  const cols = (u.searchParams.get('select') || 'id').split(',').filter(Boolean);
  const limit = Math.min(Number(u.searchParams.get('limit') || 12), 12);
  const rows = [];
  for (let i = 0; i < limit; i++) {
    const row = {};
    for (const col of cols.length ? cols : ['id']) row[col] = value(col, i, table);
    rows.push(row);
  }
  return rows;
}

function siteData() {
  const members = NAMES.map((n, i) => ({
    '이름': n, 'SOOP ID': 'user' + i, 'ELO ID': String(1000 + i), '생년월일': `199${i % 10}-0${(i % 9) + 1}-1${i % 9}`,
    '성별': i % 2 ? '여자' : '남자', '종족': RACES[i % 3], '티어': TIERS[(i + 3) % 15], '입단 티어': TIERS[(i + 5) % 15],
    '직책': ['감독', '코치'][i] || '선수', '입단일': day(300 - i * 10), '퇴단일': i === 11 ? day(5) : '', 'MBTI': 'INTJ',
    'YouTube': '', '대표 사진': '',
  }));
  const matches = [], rounds = [];
  for (let m = 0; m < 10; m++) {
    const key = 'm' + m, fmt = ['대회', '대학', '미니', 'CK'][m % 4], d = day(m * 7);
    matches.push({ '매치 번호': m + 1, '날짜': d, '상대팀': TEAMS[1 + (m % 3)], '형식': fmt, '방식': '팀전',
      '최종 결과': m % 3 ? '승' : '패', '세트 결과': '3:1', '_match_key': key });
    for (let r = 0; r < 4; r++) rounds.push({ '매치 번호': m + 1, '날짜': d, '상대팀': TEAMS[1 + (m % 3)], '형식': fmt,
      '세트': `${r + 1}세트`, '라운드': '1', '우리 선수': NAMES[(m + r) % 12], '결과': (m + r) % 3 ? '승' : '패',
      '상대 선수': NAMES[(m + r + 5) % 12], '맵': '투혼', '_match_key': key });
  }
  const playersStats = NAMES.map((n) => ({ '이름': n, '대회 전적': { wins: 3, losses: 1 }, '대학 전적': { wins: 0, losses: 0 }, '미니 전적': { wins: 1, losses: 1 },
    'CK 전적': { wins: 0, losses: 0 }, '테란전 전적': { wins: 2, losses: 0 }, '저그전 전적': { wins: 0, losses: 0 }, '프로토스전 전적': { wins: 1, losses: 2 } }));
  const PROFILE = ['생년월일', 'MBTI', 'YouTube', 'ELO ID', '입단 티어'];
  const profiles = {};
  members.forEach((m) => { (profiles[m['이름']] = profiles[m['이름']] || []).push(Object.fromEntries(PROFILE.map((k) => [k, m[k]]))); });
  const listMembers = members.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !PROFILE.includes(k))));
  return { members: { members: listMembers, matchCount: matches.length, roundCount: rounds.length }, records: { schemaVersion: 2, matches, rounds, playersStats }, profiles: { profiles } };
}

module.exports = { respond, siteData };
