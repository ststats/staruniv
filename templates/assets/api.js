// 공개 데이터 API. 공개 페이지는 이 파일의 Api로만 데이터를 받는다.
// 함수마다 /api/v1 주소 하나(api/openapi.yaml)에 대응한다. 서버가 생기면 이 파일의 호출만 fetch로 바꾸면 된다.
let _publicSupabaseClient = null;
const SUPABASE_REQUEST_TIMEOUT_MS = 12000;
// 공개 페이지는 rpc만 부르므로 supabase-js(213KB) 대신 같은 요청을 직접 만든다. 결과는 {data, error}.
class SupabaseReadQuery {
    constructor(restUrl, path, key) {
        this.url = new URL(`${restUrl}/${path}`);
        this.key = key;
    }
    // 빈 값은 빼서 DB 함수의 기본값을 쓰게 한다
    params(values) {
        for (const [name, value] of Object.entries(values))
            if (value !== '' && value != null) this.url.searchParams.set(name, `${value}`);
        return this;
    }
    // 재시도까지 한 시간 예산 안에서 한다. 네트워크 오류·429·5xx만 한 번 더 시도한다.
    async run({ timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS, label = '요청', signal } = {}) {
        const controller = new AbortController();
        const cancel = () => controller.abort(signal.reason);
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => controller.abort(new Error(`${label} 응답 시간이 초과되었습니다`)), timeoutMs);
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                const result = await this.runOnce(controller.signal);
                if (
                    controller.signal.aborted ||
                    attempt === 1 ||
                    !(result.status === 0 || result.status === 429 || result.status >= 500)
                )
                    return result;
                await new Promise(resolve => {
                    const done = () => {
                        clearTimeout(retryTimer);
                        controller.signal.removeEventListener('abort', done);
                        resolve();
                    };
                    const retryTimer = setTimeout(done, 800);
                    controller.signal.addEventListener('abort', done, { once: true });
                    if (controller.signal.aborted) done();
                });
            }
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        }
    }
    async runOnce(signal) {
        try {
            signal.throwIfAborted();
            const res = await fetch(this.url.href, {
                headers: { apikey: this.key, Authorization: `Bearer ${this.key}` },
                signal,
            });
            const text = await res.text();
            signal.throwIfAborted();
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
            return { data: null, error: signal.aborted ? signal.reason : e, status: 0 };
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

function apiClient() {
    const client = publicSupabaseClient();
    if (!client) throw new Error('Supabase 공개 설정(supabase-config.js)이 없습니다');
    return client;
}
async function apiRows(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
}
async function apiCall(fn, values = {}, wrap = p => p) {
    return apiRows(wrap(apiClient().rpc(fn, values)));
}
// 긴 목록은 크기를 줄이려고 {c: 열 이름, r: [[값…]]}로 온다
async function apiList(fn, values, wrap = p => p) {
    const { c, r } = await apiRows(wrap(apiClient().rpc(fn, values)));
    return r.map(row => Object.fromEntries(c.map((name, i) => [name, row[i]])));
}

// player_stats는 한 번에 ID 300개까지 받는다
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
    // GET /api/v1/members - 멤버 목록(사이트 순서)과 누적 매치·세트 수 { members, matchCount, roundCount }
    async members() {
        return apiCall('api_site_members');
    },

    // GET /api/v1/members/profiles - 프로필 창에서만 보이는 칸 { profiles: { 멤버 _id: {…} } }(멤버 페이지만)
    async memberProfiles() {
        return apiCall('api_member_profiles');
    },

    // GET /api/v1/holidays - 공휴일 { "YYYY-MM-DD": true }(일정 달력)
    async holidays() {
        return apiCall('api_holidays');
    },

    // GET /api/v1/site/records - 빌드가 만든 data/site_{part}_v2.json
    // 빌드가 넣은 내용 해시를 주소에 붙여 1년 캐시를 쓴다. 해시가 없으면 no-cache로 매번 확인한다.
    async siteData(part) {
        const meta = document.querySelector('meta[name="site-data-version"]')?.content || '';
        const version = meta
            .split(',')
            .map(x => x.split(':'))
            .find(([k]) => k === part)?.[1];
        const url = `data/site_${part}_v2.json${version ? `?v=${encodeURIComponent(version)}` : ''}`;
        const res = await fetch(url, { cache: version ? 'default' : 'no-cache', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`${part}: HTTP ${res.status}`);
        const data = await res.json();
        if (data.schemaVersion !== 2) throw new Error(`${part}: 지원하지 않는 데이터 형식`);
        return data;
    },

    // GET /api/v1/site/nav - 메뉴·히어로 설명·서브탭 설정
    async navConfig() {
        return (await apiCall('api_site_nav')) || {};
    },

    // GET /api/v1/logos?names= - 화면에 나오는 대학의 로고만 [{name, path}]
    async universityLogos(names) {
        return apiCall('api_university_logos', { p_names: JSON.stringify([...new Set(names || [])]) });
    },

    // GET /api/v1/live - 지금 방송 중인 선수
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

    // GET /api/v1/stats/latest?ids= - 가장 최근 날짜의 월 누적(stat_date 포함)
    // 휴면 선수도 나와야 해서 ID를 받는 player_stats로 읽는다
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

    // GET /api/v1/history - 연혁. 숨긴 항목은 빠진다(관리자는 AdminApi.history.timeline).
    async history() {
        return apiCall('api_history');
    },

    // GET /api/v1/posts - 멤버 공지 모음(최신순) [{soop_id, total_pages, post}]
    async memberPosts() {
        return apiCall('api_member_posts');
    },

    // GET /api/v1/posts?limit= - 전체 멤버 공지 중 최신 limit개(홈 카드) [{soop_id, titleName, regDate, text, thumb}]
    async recentPosts(limit) {
        return apiCall('api_recent_posts', { p_limit: limit });
    },

    // GET /api/v1/tier/members - 티어표 명단
    async tierMembers() {
        return apiCall('api_tier_members');
    },

    // GET /api/v1/teams/order - 대학 이름, 창단일 순(엔트리 소속 고르기)
    async teamOrder() {
        return apiCall('api_team_order');
    },

    // GET /api/v1/videos - 최신 한 쪽과 첫 쪽 요약. 관리자도 같은 계약을 쓴다.
    async videos(params = {}, client = null) {
        return apiRows((client || apiClient()).rpc('api_videos', { ...params, p_admin: !!client }));
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
