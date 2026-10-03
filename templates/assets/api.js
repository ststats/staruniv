/**
 * 공개 데이터 API. 공개 페이지는 데이터를 이 파일의 Api 함수로만 받는다 - 표 이름·열·조건은 여기에만 있다.
 * 함수 하나가 서버 API 주소 하나(/api/v1/…, 규격은 저장소 api/openapi.yaml)에 대응하고, 화면이 그리는 것만 돌려준다.
 * 지금은 서버가 없어 브라우저가 Supabase의 공개 읽기 함수(api_*, supabase/staruniv.sql 2번·ststat.sql 14번)를
 * 직접 부른다 - 표는 읽지 않는다. 함수 이름이 주소와 짝이고(api_schedule ↔ /api/v1/schedule) 결과 모양도 규격과 같아,
 * 서버를 붙이면 서버가 같은 함수를 부르고 이 파일 안의 호출만 fetch('/api/v1/…')로 바꾸면 된다(페이지는 그대로).
 * 모든 함수는 데이터를 돌려주고, 실패하면 예외를 던진다. 긴 목록 조회는 wrap(요청에 씌울 Promise 변환, 예: 페이지별
 * 시간 제한)을 받는다. 관리자 화면은 로그인한 supabase-js를 따로 쓴다.
 */
let _publicSupabaseClient = null;
const SUPABASE_REQUEST_TIMEOUT_MS = 8000;
// 공개 페이지는 Supabase의 공개 읽기 함수(rpc)를 부르기만 한다. 그래서 supabase-js(213KB)를 받지 않고,
// 함수 호출(GET /rest/v1/rpc/함수?인자=값)만 같은 주소·헤더 형식으로 직접 만든다. 결과는 supabase-js처럼 {data, error}.
// 로그인이 필요한 관리자 화면은 진짜 supabase-js를 따로 받는다(base.html).
class SupabaseReadQuery {
    constructor(restUrl, path, key) {
        this.url = new URL(`${restUrl}/${path}`);
        this.key = key;
    }
    // DB 함수(rpc) 인자는 주소 뒤 이름=값으로 붙인다(비운 값은 빼서 함수의 기본값을 쓴다)
    params(values) {
        for (const [name, value] of Object.entries(values))
            if (value !== '' && value != null) this.url.searchParams.set(name, `${value}`);
        return this;
    }
    // 응답이 끝내 오지 않으면(연결만 붙고 멈춤 등) 화면이 '불러오는 중'에 머문다. 요청마다 8초 제한을 두고,
    // 네트워크 오류·시간 초과·일시 서버 오류(5xx·429)는 잠깐 쉬었다 한 번 더 시도한다(읽기라 다시 보내도 안전).
    // 그래도 안 되면 {error}를 돌려줘 각 화면의 오류 안내로 넘어간다 - 최악 약 17초.
    async run() {
        const first = await this.runOnce();
        if (first.status === 0 || first.status === 429 || first.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, 800));
            return this.runOnce();
        }
        return first;
    }
    async runOnce() {
        try {
            const res = await fetch(this.url.href, {
                headers: { apikey: this.key, Authorization: `Bearer ${this.key}` },
                signal: AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS),
            });
            const text = await res.text();
            let body = null;
            if (text) {
                try {
                    body = JSON.parse(text);
                } catch (_) {
                    return { data: null, error: { message: text }, status: res.status };
                }
            }
            if (!res.ok) return { data: null, error: body || { message: res.statusText }, status: res.status };
            return { data: body, error: null, status: res.status };
        } catch (e) {
            return { data: null, error: { message: `${e?.name ?? 'FetchError'}: ${e?.message}` }, status: 0 };
        }
    }
    then(onFulfilled, onRejected) {
        return this.run().then(onFulfilled, onRejected);
    }
}

function publicSupabaseClient() {
    if (_publicSupabaseClient) return _publicSupabaseClient;
    const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.key) return null;
    const restUrl = new URL('rest/v1', cfg.url.endsWith('/') ? cfg.url : `${cfg.url}/`).href;
    _publicSupabaseClient = {
        rpc: (fn, values = {}) => new SupabaseReadQuery(restUrl, `rpc/${fn}`, cfg.key).params(values),
    };
    return _publicSupabaseClient;
}

// 공개 조회 클라이언트. 설정이 없으면(로컬 파일로 연 경우 등) 예외.
function apiClient() {
    const client = publicSupabaseClient();
    if (!client) throw new Error('Supabase 공개 설정(supabase-config.js)이 없습니다');
    return client;
}
// {data, error} 결과를 데이터로 바꾼다
async function apiRows(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
}
// 공개 읽기 함수(api_*) 한 번 호출 - 함수가 결과 전체를 JSON 하나로 돌려준다(행 수 제한·쪽 나눔 없음)
async function apiCall(fn, values = {}, wrap = p => p) {
    return apiRows(wrap(apiClient().rpc(fn, values)));
}
// ELO 긴 목록은 DB 함수가 요청 한 번에 {c: 열 이름, r: [[값…]]}로 돌려준다(ststat.sql 14번 끝) - 객체 배열로 바꾼다.
// wrap은 그 요청에 씌울 Promise 변환(예: 페이지별 시간 제한).
async function apiList(fn, values, wrap = p => p) {
    const { c, r } = await apiRows(wrap(apiClient().rpc(fn, values)));
    return r.map(row => Object.fromEntries(c.map((name, i) => [name, row[i]])));
}

// player_stats(ststat.sql)는 한 번에 ID 300개까지 받는다 - 넘으면 나눠 부른다
async function playerStats(soopIds, date) {
    const ids = [...new Set((soopIds || []).map(id => String(id || '').trim()).filter(Boolean))];
    const chunks = [];
    for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    const parts = await Promise.all(
        chunks.map(chunk =>
            apiRows(
                apiClient().rpc(
                    'player_stats',
                    date ? { p_ids: chunk.join(','), p_date: date } : { p_ids: chunk.join(',') }
                )
            )
        )
    );
    return parts.flat();
}

const Api = {
    // GET /api/v1/site/{shell|records|profiles} - 멤버·전적 묶음(지금은 빌드가 만든 data/site_*.json)
    // [캐시] 빌드가 페이지에 넣어준 파일별 내용 해시(<meta name="site-data-version" content="shell:…,records:…">)를
    // 주소에 붙인다. 그 파일이 바뀐 배포에서만 주소가 바뀌므로 평소엔 브라우저 캐시를 그대로 쓰고(vercel.json 1년 캐시),
    // 해시가 없으면 매번 변경 여부만 확인한다(no-cache → 304).
    async siteData(part) {
        const meta = document.querySelector('meta[name="site-data-version"]')?.content || '';
        const version = meta
            .split(',')
            .map(x => x.split(':'))
            .find(([k]) => k === part)?.[1];
        const url = `data/site_${part}.json${version ? `?v=${encodeURIComponent(version)}` : ''}`;
        // 끝내 안 오면 20초에 끊고 오류 안내로 넘어간다
        const res = await fetch(url, { cache: version ? 'default' : 'no-cache', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`${part}: HTTP ${res.status}`);
        return res.json();
    },

    // GET /api/v1/site/nav - 메뉴·히어로 설명·서브탭 설정
    async navConfig() {
        return (await apiCall('api_site_nav')) || {};
    },

    // GET /api/v1/logos?names= - 화면에 나오는 대학의 로고만 [{name, path}]
    async universityLogos(names) {
        return apiCall('api_university_logos', { p_names: JSON.stringify([...new Set(names || [])]) });
    },

    // GET /api/v1/live - 지금 방송 중인 선수 [{soop_id, broad_no, broad_title, current_sum_viewer, broad_start, category_name, broad_cate_no}]
    async liveBroadcasts() {
        return apiCall('api_live');
    },

    // GET /api/v1/live/ids - 방송 중인 선수의 SOOP ID만(LIVE 점만 찍는 화면) [{soop_id}]
    async liveSoopIds() {
        return apiCall('api_live_ids');
    },

    // GET /api/v1/stats/dates - 방송통계가 있는 날짜(최신순) [{stat_date}]
    async statsDates() {
        return apiCall('api_stats_dates');
    },

    // GET /api/v1/stats/latest?ids= - 가장 최근 날짜의 월 누적(멤버별, 날짜 stat_date 포함). 날짜를 먼저 받지 않아도 된다.
    // 휴면 선수도 그 선수 칸(프로필·방송통계)에는 나와야 하므로 표를 직접 읽지 않고 ID를 받는 함수(player_stats)로 읽는다.
    async statsLatest(soopIds) {
        return playerStats(soopIds, null);
    },

    // GET /api/v1/stats?date=&ids= - 그날까지의 월 누적(멤버별)
    async stats(date, soopIds) {
        return playerStats(soopIds, date);
    },

    // GET /api/v1/schedule - 일정 전체와 휴방 { events, offAir } (요청 한 번)
    async schedule() {
        return apiCall('api_schedule');
    },

    // GET /api/v1/schedule?date= - 그날에 걸친 일정(홈)
    async scheduleOn(date) {
        return apiCall('api_schedule_on', { p_date: date });
    },

    // GET /api/v1/history - 연혁(수동 항목 + 자동 항목 덮어쓰기). 어드민은 숨긴 항목까지 보려고 로그인 클라이언트를
    // 넘긴다 - 그때만 표를 읽는다(공개 함수는 숨긴 항목을 뺀다).
    async history(client) {
        if (!client) return apiCall('api_history');
        return apiRows(
            client
                .from('history_entries')
                .select(
                    'id,entry_kind,event_date,event_type,title,description,members,youtube_url,image_path,sort_order,hidden'
                )
                .order('event_date', { ascending: false, nullsFirst: false })
        );
    },

    // GET /api/v1/posts - 멤버 공지 모음(최신순) [{soop_id, total_pages, post}]
    async memberPosts() {
        return apiCall('api_member_posts');
    },

    // GET /api/v1/posts?limit= - 전체 멤버 공지 중 최신 limit개(홈 카드) [{soop_id, titleName, regDate, text, thumb}]
    // 홈 카드는 제목·본문 글자·시각·첫 사진만 그리므로 글 전체(JSON) 대신 그 칸만 받는다.
    async recentPosts(limit) {
        return apiCall('api_recent_posts', { p_limit: limit });
    },

    // GET /api/v1/tier/members - 티어표 명단
    async tierMembers() {
        return apiCall('api_tier_members');
    },

    // GET /api/v1/videos - 팬 채널·최신 영상·추천 영상 { channels, videos, picks }
    async videos() {
        return apiCall('api_videos');
    },

    // GET /api/v1/tools - 외부 도구·사이트 링크
    async tools() {
        return apiCall('api_tools');
    },

    // GET /api/v1/elo/players[?ranked=1] - EloBoard 선수 목록(검색·요약 카드). ranked면 티어 안 순위·기준일까지.
    async eloPlayers({ ranked = false, wrap } = {}) {
        return apiList('elo_players_list', { p_ranked: ranked }, wrap);
    },

    // GET /api/v1/elo/players/{id}/matches[?since=] - 한 선수의 경기(최신순)
    async eloPlayerMatches(eloId, { since = '', wrap } = {}) {
        return apiList('elo_player_match_list', { p_elo_id: Number(eloId), p_since: since }, wrap);
    },

    // GET /api/v1/elo/ratings/range - 레이팅 기록이 있는 첫 달·마지막 달 { first, last } (YYYY-MM-DD)
    async eloRatingRange() {
        const range = (await apiCall('api_elo_rating_range')) || {};
        return { first: String(range.first || ''), last: String(range.last || '') };
    },

    // GET /api/v1/elo/players/{id}/ratings - 한 선수의 월말 레이팅 [{month_end, rating}]
    async eloRatingHistory(eloId) {
        return apiCall('api_elo_rating_history', { p_elo_id: Number(eloId) });
    },

    // GET /api/v1/elo/rankings - 티어 안 순위·레이팅
    async eloRankings({ wrap } = {}) {
        return apiList('elo_rankings_list', {}, wrap);
    },

    // GET /api/v1/elo/rankings/meta - 가장 최근 랭킹의 티어 기준선·종족 상성 (없으면 {})
    async eloRankingMeta({ wrap } = {}) {
        return (await apiCall('api_elo_ranking_meta', {}, wrap)) || {};
    },

    // GET /api/v1/elo/ratings - 순위 밖 선수까지 전 선수 레이팅
    async eloPlayerRatings({ wrap } = {}) {
        return apiList('elo_player_ratings_list', {}, wrap);
    },
};
