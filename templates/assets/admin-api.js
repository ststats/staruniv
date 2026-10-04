/**
 * 관리자 데이터 API. 관리자 화면의 DB 읽기·쓰기·파일 올리기는 이 파일의 AdminApi로만 한다 - 표 이름·열·조건은
 * 여기에만 있다. 함수 하나가 나중 서버의 관리자 주소 하나(주석의 /api/v1/admin/…)에 대응한다.
 * 지금은 서버가 없어 로그인한 supabase-js(AdminCore.state.client)로 바로 부르고, 권한은 DB가 정한다
 * (표 정책의 is_admin, admin_* 함수). 서버를 붙이면 이 파일 안만 fetch('/api/v1/admin/…')로 바꾸고 화면은 그대로 둔다.
 * 결과는 supabase-js 그대로({data, error, count}) 돌려준다 - 화면 쪽 오류 처리가 지금과 같다.
 * 긴 목록(…All)만 끝까지 받은 배열을 돌려주고, 실패하면 예외를 던진다(core.js fetchAllPages).
 * 공개 페이지와 같은 데이터(연혁 등)는 공개 Api(api.js)에 로그인 클라이언트를 넘겨 읽는다.
 */
(function () {
    'use strict';
    const db = () => window.AdminCore.state.client;
    const MEDIA_BUCKET = 'staruniv-media';
    const now = () => new Date().toISOString();
    // 1000줄씩 끝까지 받는다. make(client)는 .range만 빠진 조회.
    const all = make => fetchAllPages((from, to) => make(db()).range(from, to));

    window.AdminApi = {
        // ---- 로그인 ----
        auth: {
            // GET /api/v1/admin/me
            user: () => db().auth.getUser(),
            // POST /api/v1/admin/login
            signIn: (email, password) => db().auth.signInWithPassword({ email, password }),
            // POST /api/v1/admin/logout
            signOut: () => db().auth.signOut(),
            // 로그인·로그아웃·토큰 갱신 알림(cb(session))
            onChange: cb => db().auth.onAuthStateChange((_event, session) => cb(session)),
            // GET /api/v1/admin/me/role - 관리자 명단의 역할·활성 여부
            role: userId => db().from('admin_users').select('role,is_active').eq('user_id', userId).maybeSingle(),
        },

        // ---- 공통 ----
        // GET /api/v1/admin/{table}/next-order - 새 줄의 표시 순서(가장 큰 source_order 다음)
        nextSourceOrder: table =>
            db().from(table).select('source_order').order('source_order', { ascending: false }).limit(1),
        // POST /api/v1/admin/audit - 감사 기록(admin_write_audit)
        audit: (action, entity, entityId, details) =>
            db().rpc('admin_write_audit', {
                p_action: action,
                p_entity: entity,
                p_entity_id: entityId,
                p_details: details,
            }),
        // GET /api/v1/admin/dashboard - 운영 현황(admin_dashboard_stats)
        dashboardStats: () => db().rpc('admin_dashboard_stats'),
        // 달력 사진 다시 찍기(admin_request_calendar_capture → 진행 상태)
        calendarCapture: {
            // POST /api/v1/admin/calendar-capture
            request: () => db().rpc('admin_request_calendar_capture'),
            // GET /api/v1/admin/calendar-capture/{id}
            status: requestId => db().rpc('admin_calendar_capture_status', { p_request_id: requestId }),
        },

        // ---- 파일(Storage staruniv-media) ----
        media: {
            // PUT /api/v1/admin/media/{path}
            upload: (path, file, options) => db().storage.from(MEDIA_BUCKET).upload(path, file, options),
            // DELETE /api/v1/admin/media (paths)
            remove: paths => db().storage.from(MEDIA_BUCKET).remove(paths),
            // 공개 주소(요청 없이 계산)
            publicUrl: path => db().storage.from(MEDIA_BUCKET).getPublicUrl(path)?.data?.publicUrl || '',
        },

        // ---- 사이트 설정(메뉴·히어로·서브탭) ----
        siteConfig: {
            // GET /api/v1/admin/site-config/{key}
            get: (key = 'nav') => db().from('site_config').select('config_value').eq('config_key', key).maybeSingle(),
            // PUT /api/v1/admin/site-config/{key}
            save: (value, key = 'nav') =>
                db()
                    .from('site_config')
                    .upsert({ config_key: key, config_value: value, updated_at: now() }, { onConflict: 'config_key' }),
        },

        // ---- 멤버 ----
        members: {
            // GET /api/v1/admin/members
            list: () => db().from('members').select('*').order('source_order'),
            // POST /api/v1/admin/members
            insert: row => db().from('members').insert(row),
            // PATCH /api/v1/admin/members/{id}
            update: (id, row) => db().from('members').update(row).eq('id', id),
            // DELETE /api/v1/admin/members/{id}
            remove: id => db().from('members').delete().eq('id', id),
        },

        // ---- 연혁 ----
        history: {
            // GET /api/v1/admin/history - 숨긴 항목까지 전부
            list: () =>
                db()
                    .from('history_entries')
                    .select('*')
                    .order('event_date', { ascending: false, nullsFirst: false })
                    .order('sort_order'),
            // GET /api/v1/admin/history/timeline - 연혁 화면용(공개 /api/v1/history와 같은 열, 숨긴 항목까지). 배열, 실패하면 던진다
            timeline: async () => {
                const { data, error } = await db()
                    .from('history_entries')
                    .select(
                        'id,entry_kind,event_date,event_type,title,description,members,youtube_url,image_path,sort_order,hidden'
                    )
                    .order('event_date', { ascending: false, nullsFirst: false });
                if (error) throw error;
                return data;
            },
            // PUT /api/v1/admin/history/{id} - 수동 항목 저장·자동 항목 덮어쓰기(override)
            upsert: row => db().from('history_entries').upsert(row, { onConflict: 'id' }),
            // PATCH /api/v1/admin/history/{id}
            update: (id, fields) => db().from('history_entries').update(fields).eq('id', id),
            // DELETE /api/v1/admin/history/{id}
            remove: id => db().from('history_entries').delete().eq('id', id),
        },

        // ---- 일정·휴방 ----
        schedule: {
            // POST /api/v1/admin/schedule
            insert: row => db().from('calendar_events').insert(row),
            // PATCH /api/v1/admin/schedule/{id}
            update: (id, row) => db().from('calendar_events').update(row).eq('id', id),
            // DELETE /api/v1/admin/schedule/{id}
            remove: id => db().from('calendar_events').delete().eq('id', id),
            // PUT /api/v1/admin/off-air - 그날 휴방 추가(같은 날·같은 사람은 덮어쓴다)
            addOffAir: rows => db().from('calendar_off_air').upsert(rows, { onConflict: 'off_date,soop_id' }),
            // DELETE /api/v1/admin/off-air/{date}?ids=
            removeOffAir: (date, soopIds) =>
                db().from('calendar_off_air').delete().eq('off_date', date).in('soop_id', soopIds),
        },

        // ---- 공휴일 ----
        holidays: {
            // GET /api/v1/admin/holidays
            list: () => db().from('holidays').select('day,name').order('day'),
            // PUT /api/v1/admin/holidays - 날짜별로 넣거나 이름을 고친다
            save: rows => db().from('holidays').upsert(rows, { onConflict: 'day' }),
            // DELETE /api/v1/admin/holidays?days=
            remove: days => db().from('holidays').delete().in('day', days),
        },

        // ---- 전적(경기·세트) ----
        matches: {
            // GET /api/v1/admin/matches/next-no
            nextNo: () => db().from('matches').select('match_no').order('match_no', { ascending: false }).limit(1),
            // GET /api/v1/admin/matches?date=&opponent=&format=&nos= - 최신순 한 쪽(전체 개수 포함)
            page: ({ from, to, date, opponent, format, matchNos }) => {
                let q = db()
                    .from('matches')
                    .select('*', { count: 'exact' })
                    .order('match_date', { ascending: false })
                    .order('match_no', { ascending: false })
                    .range(from, to);
                if (date) q = q.eq('match_date', date);
                if (opponent) q = q.ilike('opponent_team', `%${opponent}%`);
                if (format) q = q.ilike('match_format', `%${format}%`);
                if (matchNos) q = q.in('match_no', matchNos);
                return q;
            },
            // PUT /api/v1/admin/matches/{no} - 경기와 세트를 한 번에(admin_save_match)
            save: (match, rounds) => db().rpc('admin_save_match', { p_match: match, p_rounds: rounds }),
            // DELETE /api/v1/admin/matches/{no}
            remove: matchNo => db().from('matches').delete().eq('match_no', matchNo),
        },
        rounds: {
            // GET /api/v1/admin/matches/{no}/rounds
            ofMatch: matchNo => db().from('rounds').select('*').eq('match_no', matchNo).order('source_order'),
            // GET /api/v1/admin/rounds/match-nos?nos= - 세트 수 세기용(경기마다 한 줄씩)
            matchNosIn: matchNos => db().from('rounds').select('match_no').in('match_no', matchNos),
            // GET /api/v1/admin/rounds/match-nos?player= - 그 선수(우리·상대)가 뛴 경기 번호
            matchNosOfPlayer: player => {
                const p = String(player).replace(/[%_,]/g, '');
                return db()
                    .from('rounds')
                    .select('match_no')
                    .or(`our_player.ilike.%${p}%,opponent_player.ilike.%${p}%`)
                    .limit(5000);
            },
            // GET /api/v1/admin/rounds/count?our_player= - 그 이름이 우리 선수로 든 세트 수
            countOfOurPlayer: name =>
                db().from('rounds').select('*', { head: true, count: 'exact' }).ilike('our_player', name),
        },

        // ---- 팀·대학 로고 ----
        teams: {
            // GET /api/v1/admin/teams
            list: () => db().from('teams').select('*').order('source_order'),
            // POST /api/v1/admin/teams
            insert: row => db().from('teams').insert(row),
            // PATCH /api/v1/admin/teams/{id}
            update: (id, row) => db().from('teams').update(row).eq('id', id),
            // DELETE /api/v1/admin/teams/{id}
            remove: id => db().from('teams').delete().eq('id', id),
        },
        logos: {
            // GET /api/v1/admin/logos
            list: () => db().from('university_logos').select('name,path,color,updated_at'),
            // PUT /api/v1/admin/logos/{name}
            save: row => db().from('university_logos').upsert(row, { onConflict: 'name' }),
            // DELETE /api/v1/admin/logos/{name}
            remove: name => db().from('university_logos').delete().eq('name', name),
            // PATCH /api/v1/admin/logos/{name} - 팀 이름을 바꾸면 로고도 새 이름으로
            rename: (from, to) => db().from('university_logos').update({ name: to }).eq('name', from),
        },

        // ---- 티어표 명단 ----
        tierMembers: {
            // GET /api/v1/admin/tier-members?cols= - 전원(번호순), 필요한 칸만
            all: columns => all(c => c.from('tier_members').select(columns).order('id', { ascending: true })),
            // GET /api/v1/admin/tier-members?sort=&q=&tier=&affiliation=&race= - 한 쪽(전체 개수 포함)
            page: ({ from, to, sort, ascending, search, tier, affiliation, race }) => {
                let q = db()
                    .from('tier_members')
                    .select('*', { count: 'exact' })
                    .order(sort, { ascending })
                    .range(from, to);
                if (search)
                    q = q.or(
                        `name.ilike.%${search}%,nickname.ilike.%${search}%,soop_id.ilike.%${search}%,elo_id.eq.${/^\d+$/.test(search) ? search : -1}`
                    );
                if (tier) q = q.eq('tier', tier);
                if (affiliation) q = q.eq('affiliation', affiliation);
                if (race) q = q.eq('race', race);
                return q;
            },
            // GET /api/v1/admin/tier-members?elo_id=&except= - 같은 ELO ID를 쓰는 다른 선수
            withElo: (eloId, exceptId) => {
                let q = db().from('tier_members').select('id,nickname,elo_id').eq('elo_id', eloId).limit(2);
                if (exceptId) q = q.neq('id', exceptId);
                return q;
            },
            // POST /api/v1/admin/tier-members
            insert: row => db().from('tier_members').insert(row),
            // PATCH /api/v1/admin/tier-members/{id}
            update: (id, row) => db().from('tier_members').update(row).eq('id', id),
            // DELETE /api/v1/admin/tier-members/{id}
            remove: id => db().from('tier_members').delete().eq('id', id),
            // PATCH /api/v1/admin/tier-members (ids) - 소속·티어 일괄 수정(admin_bulk_update_tier_members)
            bulkUpdate: (ids, affiliation, tier) =>
                db().rpc('admin_bulk_update_tier_members', { p_ids: ids, p_affiliation: affiliation, p_tier: tier }),
            // PUT /api/v1/admin/tier-members/{id}/main-elo - 연결 계정을 메인으로(admin_set_main_elo)
            setMainElo: (memberId, eloId) => db().rpc('admin_set_main_elo', { p_member_id: memberId, p_elo_id: eloId }),
        },
        // 다른 종족 ELO 계정(한 선수에 여러 계정)
        eloLinks: {
            // GET /api/v1/admin/tier-members/{id}/elo-links
            ofMember: memberId =>
                db()
                    .from('tier_member_elo_links')
                    .select('elo_id,elo_name,race')
                    .eq('tier_member_id', memberId)
                    .order('elo_id'),
            // POST /api/v1/admin/elo-links
            insert: row => db().from('tier_member_elo_links').insert(row),
            // PATCH /api/v1/admin/elo-links/{elo_id}
            update: (eloId, row) => db().from('tier_member_elo_links').update(row).eq('elo_id', eloId),
            // DELETE /api/v1/admin/elo-links/{elo_id}
            remove: eloId => db().from('tier_member_elo_links').delete().eq('elo_id', eloId),
        },
        // EloBoard에서 찾은 새 인원
        candidates: {
            // GET /api/v1/admin/candidates?status=
            all: status =>
                all(c =>
                    c
                        .from('tier_member_candidates')
                        .select(
                            'id,nickname,elo_id,soop_id,gender,race,tier,affiliation,source,found_at,last_seen_at,status'
                        )
                        .eq('status', status)
                        .order('found_at', { ascending: false, nullsFirst: false })
                        .order('id')
                ),
            // PATCH /api/v1/admin/candidates/{id}
            setStatus: (id, status) =>
                db().from('tier_member_candidates').update({ status, updated_at: now() }).eq('id', id),
            // DELETE /api/v1/admin/candidates/{id}
            remove: id => db().from('tier_member_candidates').delete().eq('id', id),
        },
        // 랭킹 보기(관리자 전용 칸 포함)
        ranking: {
            // GET /api/v1/admin/ranking
            rankingsAll: () =>
                all(c =>
                    c
                        .from('elo_rankings')
                        .select(
                            'elo_id,tier,tier_rank,tier_count,raw_rating,rating,data_tier,tier_gap,recent_365_games,recent_365_wins,recent_90_games,recent_90_wins,recent_30_games,recent_30_wins,as_of'
                        )
                        .order('elo_id', { ascending: true })
                ),
            // GET /api/v1/admin/ranking/players
            playersAll: () =>
                all(c =>
                    c
                        .from('elo_public_players')
                        .select('elo_id,elo_name,nickname,race,affiliation')
                        .order('elo_id', { ascending: true })
                ),
            // GET /api/v1/admin/ranking/rating-se - 레이팅 표준오차
            ratingSeAll: () =>
                all(c => c.from('elo_player_ratings').select('elo_id,rating_se').order('elo_id', { ascending: true })),
            // GET /api/v1/admin/ranking/as-of - 가장 최근 랭킹 기준일
            latestAsOf: () =>
                db().from('elo_ranking_meta').select('as_of').order('as_of', { ascending: false }).limit(1),
        },
        // 티어표 사진 분석 작업
        tierJobs: {
            // GET /api/v1/admin/tier-jobs - 최근 12개
            list: () =>
                db()
                    .from('tier_update_jobs')
                    .select('id,created_at,status,error,started_at,finished_at,applied_at,image_url')
                    .order('id', { ascending: false })
                    .limit(12),
            // GET /api/v1/admin/tier-jobs/{id}
            get: id =>
                db()
                    .from('tier_update_jobs')
                    .select('id,status,error,image_url,fa_text,result,applied,created_at,applied_at')
                    .eq('id', id)
                    .maybeSingle(),
            // POST /api/v1/admin/tier-jobs - 분석 요청(admin_request_tier_analysis)
            request: (imageUrl, faText) =>
                db().rpc('admin_request_tier_analysis', { p_image_url: imageUrl, p_fa_text: faText }),
            // GET /api/v1/admin/tier-jobs/{id}/dispatch - GitHub 실행 요청 결과
            dispatchStatus: id => db().rpc('admin_tier_job_dispatch_status', { p_job_id: id }),
            // POST /api/v1/admin/tier-jobs/{id}/apply - 고른 변경을 명단에 반영(admin_apply_tier_update)
            apply: ({ jobId, updates, inserts, confirmed, date }) =>
                db().rpc('admin_apply_tier_update', {
                    p_job_id: jobId,
                    p_updates: updates,
                    p_inserts: inserts,
                    p_confirmed: confirmed,
                    p_date: date,
                }),
        },

        // ---- 영상 ----
        video: {
            // GET /api/v1/admin/video - 채널·영상(숨긴 것 포함, 최신 3000개)·추천 영상
            channels: () => db().from('video_channels').select('*').order('source_order'),
            videos: () => db().from('videos').select('*').order('published', { ascending: false }).limit(3000),
            picks: () => db().from('video_picks').select('*').order('source_order'),
            // PATCH /api/v1/admin/videos/{id} - 숨김·표시
            setHidden: (id, hidden) => db().from('videos').update({ hidden }).eq('id', id),
            // PATCH /api/v1/admin/video-picks?group= - 같은 분류의 영문 이름
            setPickGroupEn: (group, groupEn) =>
                db().from('video_picks').update({ group_en: groupEn }).eq('group_name', group),
            // DELETE /api/v1/admin/video-picks/{id}
            removePick: id => db().from('video_picks').delete().eq('id', id),
            // PUT /api/v1/admin/{video-channels|video-picks}/{key} - 키(주소)가 바뀌면 지우고 다시 넣지 않고 키를 바꾸는
            // UPDATE 한 번으로(실패해도 원래 항목이 남는다). 원래 항목이 그사이 지워졌으면 새로 넣는다. 실패하면 던진다.
            saveKeyed: async (table, key, oldKey, row) => {
                if (table !== 'video_channels' && table !== 'video_picks') throw new Error(`알 수 없는 표: ${table}`);
                if (oldKey != null && oldKey !== row[key]) {
                    const { data, error } = await db().from(table).update(row).eq(key, oldKey).select(key);
                    if (error) throw error;
                    if (data && data.length) return;
                }
                const { error } = await db().from(table).upsert(row, { onConflict: key });
                if (error) throw error;
            },
        },

        // ---- 외부 도구 ----
        tools: {
            // GET /api/v1/admin/tools
            list: () => db().from('external_tools').select('*').order('source_order'),
            // POST /api/v1/admin/tools
            insert: row => db().from('external_tools').insert(row),
            // PATCH /api/v1/admin/tools/{id}
            update: (id, row) => db().from('external_tools').update(row).eq('id', id),
            // DELETE /api/v1/admin/tools/{id}
            remove: id => db().from('external_tools').delete().eq('id', id),
        },
    };
})();
