/**
 * 공개 데이터 API. 공개 페이지는 데이터를 이 파일의 Api 함수로만 받는다 - 표 이름·열·조건은 여기에만 있다.
 * 함수 하나가 서버 API 주소 하나(/api/v1/…, 규격은 저장소 api/openapi.yaml)에 대응하고, 화면이 그리는 것만 돌려준다.
 * 지금은 서버가 없어 브라우저가 Supabase 공개 조회(anon, 권한은 supabase/staruniv.sql 2번·ststat.sql 14번)로
 * 직접 받는다. 서버를 붙이면 이 파일 안의 조회만 fetch('/api/v1/…')로 바꾸고 페이지는 그대로 둔다.
 * 모든 함수는 데이터를 돌려주고, 실패하면 예외를 던진다. 여러 쪽으로 나눠 받는 조회는 wrap(쪽마다 씌울 Promise
 * 변환, 예: 페이지별 시간 제한)과 pageSize·parallel을 받는다. 관리자 화면은 로그인한 supabase-js를 따로 쓴다.
 */
let _publicSupabaseClient = null;
const SUPABASE_REQUEST_TIMEOUT_MS = 8000;
// 공개 페이지는 Supabase 표를 읽기만 한다. 그래서 supabase-js(213KB)를 받지 않고, 쓰는 조회
// (select·eq·in·not·gte·lte·order·range·limit·maybeSingle)만 같은 주소 형식으로 직접 만든다 - 주소와
// 헤더가 supabase-js와 한 글자까지 같아서 서버 쪽에서 보면 차이가 없다. 결과도 똑같이 {data, error}.
// 로그인이 필요한 관리자 화면은 진짜 supabase-js를 따로 받는다(base.html).
class SupabaseReadQuery {
    constructor(restUrl, table, key) {
        this.url = new URL(`${restUrl}/${table}`);
        this.key = key;
        this.maybeOne = false;
    }
    select(columns = '*') {
        let quoted = false;
        const cleaned = String(columns).split('')
            .map(ch => (/\s/.test(ch) && !quoted ? '' : (ch === '"' && (quoted = !quoted), ch))).join('');
        this.url.searchParams.set('select', cleaned);
        return this;
    }
    eq(column, value) { this.url.searchParams.append(column, `eq.${value}`); return this; }
    not(column, operator, value) { this.url.searchParams.append(column, `not.${operator}.${value}`); return this; }
    gte(column, value) { this.url.searchParams.append(column, `gte.${value}`); return this; }
    lte(column, value) { this.url.searchParams.append(column, `lte.${value}`); return this; }
    in(column, values) {
        const list = Array.from(new Set(values))
            .map(v => (typeof v === 'string' && /[,()]/.test(v) ? `"${v}"` : `${v}`)).join(',');
        this.url.searchParams.append(column, `in.(${list})`);
        return this;
    }
    order(column, { ascending = true, nullsFirst } = {}) {
        const prev = this.url.searchParams.get('order');
        const nulls = nullsFirst === undefined ? '' : (nullsFirst ? '.nullsfirst' : '.nullslast');
        this.url.searchParams.set('order', `${prev ? `${prev},` : ''}${column}.${ascending ? 'asc' : 'desc'}${nulls}`);
        return this;
    }
    limit(count) { this.url.searchParams.set('limit', `${count}`); return this; }
    range(from, to) {
        this.url.searchParams.set('offset', `${from}`);
        this.url.searchParams.set('limit', `${to - from + 1}`);
        return this;
    }
    maybeSingle() { this.maybeOne = true; return this; }
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
                try { body = JSON.parse(text); } catch (_) { return { data: null, error: { message: text }, status: res.status }; }
            }
            if (!res.ok) return { data: null, error: body || { message: res.statusText }, status: res.status };
            if (this.maybeOne && Array.isArray(body)) {
                if (body.length > 1) {
                    return { data: null, status: 406, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
                }
                body = body.length ? body[0] : null;
            }
            return { data: body, error: null, status: res.status };
        } catch (e) {
            return { data: null, error: { message: `${e?.name ?? 'FetchError'}: ${e?.message}` }, status: 0 };
        }
    }
    then(onFulfilled, onRejected) { return this.run().then(onFulfilled, onRejected); }
}

function publicSupabaseClient() {
    if (_publicSupabaseClient) return _publicSupabaseClient;
    const cfg = window.STARUNIV_SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.key) return null;
    const restUrl = new URL('rest/v1', cfg.url.endsWith('/') ? cfg.url : `${cfg.url}/`).href;
    _publicSupabaseClient = { from: table => new SupabaseReadQuery(restUrl, table, cfg.key) };
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
// 1000줄씩 나눠 받는 조회(core.js fetchAllPages). make(client, from, to)는 .range까지 붙인 조회.
async function apiPaged(make, { wrap = p => p, pageSize = 1000, parallel = 2 } = {}) {
    const client = apiClient();
    return fetchAllPages((from, to) => wrap(make(client, from, to)), { pageSize, parallel });
}

const Api = {
    // GET /api/v1/site/{shell|records} - 멤버·전적 묶음(지금은 빌드가 만든 data/site_*.json)
    // [캐시] 빌드가 페이지에 넣어준 버전(<meta name="site-data-version">)을 주소에 붙인다. 데이터가 바뀐 배포에서만
    // 주소가 바뀌므로 평소엔 브라우저 캐시를 쓰고, 버전이 없으면 매번 변경 여부만 확인한다(no-cache → 304).
    async siteData(part) {
        const version = document.querySelector('meta[name="site-data-version"]')?.content;
        const url = `data/site_${part}.json${version ? `?v=${encodeURIComponent(version)}` : ''}`;
        // 끝내 안 오면 20초에 끊고 오류 안내로 넘어간다
        const res = await fetch(url, { cache: version ? 'default' : 'no-cache', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`${part}: HTTP ${res.status}`);
        return res.json();
    },

    // GET /api/v1/site/nav - 메뉴·히어로 설명·서브탭 설정
    async navConfig() {
        const row = await apiRows(apiClient().from('site_config').select('config_value').eq('config_key', 'nav').maybeSingle());
        return row?.config_value || {};
    },

    // GET /api/v1/logos - 대학 로고 [{name, path}]
    async universityLogos() {
        return apiRows(apiClient().from('university_logos').select('name,path'));
    },

    // GET /api/v1/live - 지금 방송 중인 선수 [{soop_id, broad_no, broad_title, current_sum_viewer, broad_start, category_name, broad_cate_no}]
    async liveBroadcasts() {
        return apiRows(apiClient().from('live_broadcasts_current')
            .select('soop_id,broad_no,broad_title,current_sum_viewer,broad_start,category_name,broad_cate_no')
            .limit(5000));
    },

    // GET /api/v1/live/ids - 방송 중인 선수의 SOOP ID만(LIVE 점만 찍는 화면) [{soop_id}]
    async liveSoopIds() {
        return apiRows(apiClient().from('live_broadcasts_current').select('soop_id').limit(5000));
    },

    // GET /api/v1/stats/dates - 방송통계가 있는 날짜(최신순) [{stat_date}]
    async statsDates() {
        return apiPaged((c, from, to) => c.from('synergy_daily_dates').select('stat_date')
            .order('stat_date', { ascending: false }).range(from, to), { parallel: 1 });
    },

    // GET /api/v1/stats?date=&ids= - 그날까지의 월 누적(멤버별)
    async stats(date, soopIds) {
        return apiPaged((c, from, to) => c.from('daily_member_stats')
            .select('soop_id,nickname,balloons,broadcast_seconds,cumulative_viewers,sponsor_wins,sponsor_losses,updated_at')
            .eq('stat_date', date).in('soop_id', soopIds).order('soop_id', { ascending: true }).range(from, to), { parallel: 1 });
    },

    // GET /api/v1/schedule - 일정 전체와 휴방 { events, offAir }
    async schedule() {
        const client = apiClient();
        const [events, offAir] = await Promise.all([
            apiRows(client.from('calendar_events').select('id,start_date,end_date,event_time,person,description,detail,color').order('source_order')),
            apiRows(client.from('calendar_off_air').select('off_date,soop_id').order('off_date').order('source_order')),
        ]);
        return { events, offAir };
    },

    // GET /api/v1/schedule?date= - 그날에 걸친 일정(홈)
    async scheduleOn(date) {
        return apiRows(apiClient().from('calendar_events').select('start_date,end_date,event_time,person,description')
            .lte('start_date', date).gte('end_date', date).order('source_order'));
    },

    // GET /api/v1/history - 연혁(수동 항목 + 자동 항목 덮어쓰기). 어드민은 숨긴 항목까지 보려고 로그인 클라이언트를 넘긴다.
    async history(client = apiClient()) {
        return apiRows(client.from('history_entries')
            .select('id,entry_kind,event_date,event_type,title,description,members,youtube_url,image_path,sort_order,hidden')
            .order('event_date', { ascending: false, nullsFirst: false }));
    },

    // GET /api/v1/posts - 멤버 공지 모음(최신순) [{soop_id, total_pages, post}]
    async memberPosts() {
        return apiRows(apiClient().from('member_posts').select('soop_id,total_pages,post').order('reg_date', { ascending: false }).limit(2000));
    },

    // GET /api/v1/posts?limit= - 전체 멤버 공지 중 최신 limit개(홈) [{soop_id, post}]
    async recentPosts(limit) {
        return apiRows(apiClient().from('member_posts').select('soop_id,post').order('reg_date', { ascending: false }).limit(limit));
    },

    // GET /api/v1/tier/members - 티어표 명단
    async tierMembers() {
        return apiPaged((c, from, to) => c.from('tier_members')
            .select('nickname,soop_id,race,tier,affiliation,modified_at')
            .order('source_order', { ascending: true }).order('soop_id', { ascending: true }).range(from, to));
    },

    // GET /api/v1/videos - 팬 채널·최신 영상·추천 영상 { channels, videos, picks }
    async videos() {
        const client = apiClient();
        const [channels, videos, picks] = await Promise.all([
            apiRows(client.from('video_channels').select('channel_url,title,display_name,thumb').eq('active', true).order('source_order')),
            apiRows(client.from('videos').select('id,channel_url,title,published,thumb,views,short').order('published', { ascending: false }).limit(3000)),
            apiRows(client.from('video_picks').select('id,kind,title,note,group_name,group_en,author,thumb,short').order('source_order')),
        ]);
        return { channels, videos, picks };
    },

    // GET /api/v1/tools - 외부 도구·사이트 링크
    async tools() {
        return apiRows(apiClient().from('external_tools').select('id,category,name,url,favicon').eq('active', true).order('source_order'));
    },

    // GET /api/v1/elo/players[?ranked=1] - EloBoard 선수 목록(검색·요약 카드). ranked면 티어 안 순위·기준일까지.
    async eloPlayers({ ranked = false, ...paging } = {}) {
        const cols = 'elo_id,elo_name,race,nickname,soop_id,tier,affiliation,total_games' + (ranked ? ',tier_rank,tier_count,as_of' : '');
        return apiPaged((c, from, to) => c.from('elo_public_players').select(cols).order('elo_id', { ascending: true }).range(from, to), paging);
    },

    // GET /api/v1/elo/players/{id}/matches[?since=] - 한 선수의 경기(최신순)
    async eloPlayerMatches(eloId, { since = '', ...paging } = {}) {
        return apiPaged((c, from, to) => {
            let q = c.from('elo_public_matches').select('match_date,opponent_elo_id,won,map_id,map_name,category_name')
                .eq('elo_id', Number(eloId)).order('match_date', { ascending: false });
            if (since) q = q.gte('match_date', since);
            return q.range(from, to);
        }, paging);
    },

    // GET /api/v1/elo/ratings/range - 레이팅 기록이 있는 첫 달·마지막 달 { first, last } (YYYY-MM-DD)
    async eloRatingRange() {
        const edge = ascending => apiRows(apiClient().from('elo_rating_history').select('month_end').order('month_end', { ascending }).limit(1));
        const [a, b] = await Promise.all([edge(true), edge(false)]);
        return { first: String(((a || [])[0] || {}).month_end || ''), last: String(((b || [])[0] || {}).month_end || '') };
    },

    // GET /api/v1/elo/players/{id}/ratings - 한 선수의 월말 레이팅 [{month_end, rating}]
    async eloRatingHistory(eloId) {
        return apiRows(apiClient().from('elo_rating_history').select('month_end,rating')
            .eq('elo_id', eloId).order('month_end', { ascending: true }).limit(1000));
    },

    // GET /api/v1/elo/rankings - 티어 안 순위·레이팅
    async eloRankings(paging) {
        return apiPaged((c, from, to) => c.from('elo_rankings').select('elo_id,raw_rating,rating,tier,tier_rank,as_of')
            .order('elo_id', { ascending: true }).range(from, to), paging);
    },

    // GET /api/v1/elo/rankings/meta - 가장 최근 랭킹의 티어 기준선·종족 상성 (없으면 {})
    async eloRankingMeta({ wrap = p => p } = {}) {
        const rows = await apiRows(wrap(apiClient().from('elo_ranking_meta').select('as_of,tier_counts,tier_levels,race_matchup')
            .order('as_of', { ascending: false }).limit(1)));
        return (rows || [])[0] || {};
    },

    // GET /api/v1/elo/ratings - 순위 밖 선수까지 전 선수 레이팅
    async eloPlayerRatings(paging) {
        return apiPaged((c, from, to) => c.from('elo_player_ratings').select('elo_id,rating,rating_se')
            .order('elo_id', { ascending: true }).range(from, to), paging);
    },
};
