(function () {
    'use strict';
    const C = () => window.AdminCore;
    const VIEWS = ['members', 'teams', 'ranking', 'update'];
    const VIEW_TABS = Object.fromEntries(VIEWS.map(key => [key, [`tab-admin-tier-${key}`, `view-admin-tier-${key}`]]));
    const startView = location.hash.startsWith('#tier-update')
        ? 'update'
        : new URLSearchParams(location.search).get('view');
    const S = {
        view: VIEWS.includes(startView) ? startView : 'members',
        page: 0,
        size: 50,
        count: 0,
        rows: [],
        sort: 'source_order',
        asc: true,
        selected: new Set(),
        filters: { q: '', tier: '', aff: '', race: '' },
        options: { tiers: [], affs: [], races: [] },
    };
    const PROMO = [8, 7, 6, 5, 4, 3, 2, 1, 0];
    // ststat의 티어 순서와도 같아야 한다.
    const LADDER = SITE_ORDER.tiers;
    // 공개 화면의 core.js tierLabel과 달리 숫자 티어에만 '티어'를 붙인다.
    const adminTierLabel = t => (/^\d$/.test(String(t)) ? `${t}티어` : String(t) === '체크' ? '미분류' : `${t}`);
    const tierRank = t => {
        const i = LADDER.indexOf(String(t));
        return i < 0 ? LADDER.length : i;
    };
    // 랭킹은 스냅샷을 한 번 읽어 두고 화면에서만 거른다.
    const R = { loaded: false, loading: null, rows: [], tier: '', q: '', gapOnly: false };
    const N = { rows: null, status: 'pending' };

    // 모르는 값은 목록 끝에 그대로 보여 줘서 모르고 지우지 않게 한다.
    function genderSelect(value) {
        const g = C().normalizeGender(value),
            list = ['', '남자', '여자'];
        if (g && !list.includes(g)) list.push(g);
        return `<select class="admin-input" id="ati_gender">${list.map(v => `<option value="${C().esc(v)}"${g === v ? ' selected' : ''}>${C().esc(v || '-')}</option>`).join('')}</select>`;
    }
    function raceSelect(value) {
        const v = String(value || ''),
            list = ['', '테란', '저그', '프로토스', '랜덤'];
        if (v && !list.includes(v)) list.push(v);
        return `<select class="admin-input" id="ati_race">${list.map(x => `<option value="${C().esc(x)}"${v === x ? ' selected' : ''}>${C().esc(x || '-')}</option>`).join('')}</select>`;
    }
    function modifiedStamp(day) {
        const kst = new Date(Date.now() + 9 * 3600e3).toISOString();
        const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : kst.slice(0, 10);
        return d + ' ' + kst.slice(11, 19);
    }

    function esc(v) {
        return C().esc(v);
    }
    // 승급일 칸은 글자라 '2021-07-13, 2021-10-26'처럼 날짜가 여러 개일 수 있다(같은 티어에 다시 오른 경우).
    const promoDates = v =>
        String(v || '')
            .split(/[,\s/]+/)
            .map(x => x.trim())
            .filter(Boolean);
    function promotionEvents(r) {
        return PROMO.flatMap(n => promoDates(r[`promoted_tier_${n}`]).map(date => ({ n, date }))).sort((a, b) =>
            a.date.localeCompare(b.date)
        );
    }
    function latestPromotion(r) {
        const events = promotionEvents(r);
        return events.length ? events[events.length - 1].date : '';
    }
    // 칸에는 강등된 날도 적으므로 순서는 따지지 않고, 가장 최근 날짜의 티어만 지금 티어와 비교한다.
    function promotionWarnings(r) {
        const chrono = promotionEvents(r);
        if (!chrono.length) return [];
        const latest = chrono[chrono.length - 1].n;
        const tier = String(r.tier || '')
            .replace('티어', '')
            .trim();
        return /^[0-8]$/.test(tier) && Number(tier) !== latest
            ? [
                  `현재 티어(${r.tier})와 가장 최근 날짜의 티어(${latest}티어)가 다릅니다. 승급·강등 날짜가 빠졌을 수 있습니다`,
              ]
            : [];
    }
    function historyHtml(r) {
        // 앞 기록보다 숫자가 커지면 강등이다
        const rows = promotionEvents(r)
            .map(
                (e, i, all) =>
                    `<tr><td>${esc(e.date)}</td><td>${e.n}티어 ${i && e.n > all[i - 1].n ? '강등' : i ? '승급' : '시작'}</td></tr>`
            )
            .join('');
        return rows ? `<table class="admin-mini-table"><tbody>${rows}</tbody></table>` : '승급 이력이 없습니다';
    }
    async function duplicateElo(elo, id) {
        if (!elo) return null;
        const { data, error } = await AdminApi.tierMembers.withElo(elo, id);
        if (error) throw error;
        return data?.[0] || null;
    }
    function fields(r = {}) {
        // type=date는 날짜 하나만 받아 여러 날짜가 든 칸을 지워 버린다
        const promo = PROMO.map(n =>
            C().field(
                `${n}티어 승급일`,
                C().input(
                    `ati_p${n}`,
                    r[`promoted_tier_${n}`] || '',
                    'text',
                    'placeholder="YYYY-MM-DD" inputmode="numeric"'
                )
            )
        ).join('');
        return `<div class="admin-form-grid">
      ${C().field('이름', C().input('ati_name', r.name || ''))}
      ${C().field('닉네임', C().input('ati_nick', r.nickname || '', 'text', 'required'))}
      ${C().field('SOOP ID', C().input('ati_soop', r.soop_id || ''))}
      ${C().field('ELO ID(메인 종족 계정)', C().input('ati_elo', r.elo_id ?? '', 'number', 'min="1"'))}
      ${C().field('성별', genderSelect(r.gender))}
      ${C().field('종족', raceSelect(r.race))}
      ${C().field('생년월일', C().input('ati_birth', r.birth_date || '', 'date'))}
      ${C().field('티어', C().input('ati_tier', r.tier || ''))}
      ${C().field('소속', C().input('ati_aff', r.affiliation || '', 'text', 'placeholder="소속 / FA / 휴면"'))}
      ${C().field('직책', C().input('ati_role', r.role || ''))}
      ${C().field('수정일(방송통계 소급 시작일)', C().input('ati_modified', String(r.modified_at || '').slice(0, 10), 'date'))}
      ${C().field('시작', C().input('ati_started', r.started_on || ''))}
      ${C().field('ELO 등록', C().input('ati_elo_registered', r.elo_registered || ''))}
      ${C().field('티어표 등록', C().input('ati_table_registered', r.tier_table_registered || ''))}
    </div><div class="admin-section-head"><b>연혁</b></div>
    ${C().field('팀 이동 등 연혁', C().textarea('ati_history', r.history || '', 'rows="5"'))}
    ${r.id ? `<div class="admin-section-head"><b>연결된 ELO 계정</b><small>메인 종족이 아닌 다른 계정. 신규 인원에서 연결합니다(전적·방송통계는 메인 계정만)</small></div><div id="ati_links" class="admin-help">불러오는 중</div>` : ''}
    <div class="admin-section-head"><b>승급 이력</b><small>그 티어가 된 날짜입니다. 강등으로 내려간 날도 그 티어 칸에 적고, 같은 티어가 여러 번이면 쉼표로 이어 적습니다(예: 2021-07-13, 2021-10-26)</small></div><div class="admin-form-grid">${promo}</div>`;
    }
    function collect(r = {}) {
        const p = {
            name: C().empty(C().value('ati_name')),
            nickname: C().value('ati_nick').trim(),
            soop_id: C().empty(C().value('ati_soop')),
            elo_id: C().intOrNull(C().value('ati_elo')),
            gender: C().empty(C().value('ati_gender')),
            race: C().empty(C().value('ati_race')),
            birth_date: C().empty(C().value('ati_birth')),
            tier: C().empty(C().value('ati_tier')),
            affiliation: C().empty(C().value('ati_aff')),
            role: C().empty(C().value('ati_role')),
            modified_at: modifiedStamp(C().value('ati_modified')),
        };
        p.history = C().empty(C().value('ati_history'));
        p.started_on = C().empty(C().value('ati_started'));
        p.elo_registered = C().empty(C().value('ati_elo_registered'));
        p.tier_table_registered = C().empty(C().value('ati_table_registered'));
        PROMO.forEach(n => {
            const dates = promoDates(C().value(`ati_p${n}`));
            const bad = dates.find(d => !/^\d{4}-\d{2}-\d{2}$/.test(d));
            if (bad)
                throw new Error(`${n}티어 승급일 '${bad}'는 YYYY-MM-DD 형식이어야 합니다(여러 번이면 쉼표로 구분)`);
            p[`promoted_tier_${n}`] = dates.length ? dates.sort().join(', ') : null;
        });
        return p;
    }
    // after: 새로 저장한 뒤 할 일(신규 인원에서 추가하면 대기 명단 줄을 지운다)
    function open(r, after) {
        r = r || {};
        C().openDrawer({
            eyebrow: 'TIER',
            title: r.id ? '티어 선수 수정' : '새 선수 추가',
            html: fields(r),
            onSubmit: async () => {
                const p = collect(r);
                if (!p.nickname) throw new Error('닉네임은 필수입니다');
                const dup = await duplicateElo(p.elo_id, r.id);
                if (dup) throw new Error(`ELO ID ${p.elo_id}는 이미 ${dup.nickname}에게 사용 중입니다`);
                const warnings = promotionWarnings({ ...r, ...p });
                if (warnings.length && !confirm(`${warnings.join('\n')}\n그래도 저장할까요?`))
                    throw new Error('검증 경고로 저장을 취소했습니다');
                let error;
                if (r.id) ({ error } = await AdminApi.tierMembers.update(r.id, p));
                else {
                    p.source_order = await C().nextSourceOrder('tier_members');
                    ({ error } = await AdminApi.tierMembers.insert(p));
                }
                if (error) throw error;
                C().toast('티어 선수를 저장했습니다');
                if (after) await after(p);
                else await load(S.page);
            },
            onDelete: r.id
                ? async () => {
                      const { error } = await AdminApi.tierMembers.remove(r.id);
                      if (error) throw error;
                      await load(S.page);
                  }
                : null,
        });
        if (r.id) showLinks(r.id);
    }
    async function showLinks(memberId) {
        const box = document.getElementById('ati_links');
        if (!box) return;
        const { data, error } = await AdminApi.eloLinks.ofMember(memberId);
        if (!box.isConnected) return;
        if (error) {
            box.textContent = `연결 계정을 불러오지 못했습니다: ${C().errorText(error)}`;
            return;
        }
        // 연결 계정의 이름·종족은 구분용 메모라 전적·랭킹에는 쓰지 않는다.
        const RACES = ['테란', '저그', '프로토스'];
        const raceOf = v =>
            RACE_NAMES[
                String(v || '')
                    .trim()
                    .toUpperCase()
            ] || String(v || '').trim();
        box.innerHTML = (data || []).length
            ? data
                  .map(l => {
                      const race = raceOf(l.race);
                      return `<div class="admin-link-row" data-link-row="${esc(l.elo_id)}">
      <b class="admin-link-id">ELO ${esc(l.elo_id)}</b>
      <input class="admin-input" data-link-name value="${esc(l.elo_name || '')}" placeholder="이름">
      <select class="admin-input" data-link-race>${['', ...RACES, ...(race && !RACES.includes(race) ? [race] : [])].map(r => `<option value="${esc(r)}"${r === race ? ' selected' : ''}>${esc(r || '종족')}</option>`).join('')}</select>
      <div class="admin-link-actions"><button type="button" class="admin-btn" data-link-save="${esc(l.elo_id)}">저장</button><button type="button" class="admin-btn" data-main-elo="${esc(l.elo_id)}">메인으로</button><button type="button" class="admin-btn" data-unlink="${esc(l.elo_id)}">해제</button></div></div>`;
                  })
                  .join('')
            : '없음';
        // Enter가 선수 수정 창 전체를 저장하지 않게
        box.querySelectorAll('[data-link-name]').forEach(
            i =>
                (i.onkeydown = ev => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        i.closest('[data-link-row]').querySelector('[data-link-save]').click();
                    }
                })
        );
        box.querySelectorAll('[data-link-save]').forEach(
            b =>
                (b.onclick = async () => {
                    const tr = b.closest('[data-link-row]');
                    const payload = {
                        elo_name: tr.querySelector('[data-link-name]').value.trim() || null,
                        race: tr.querySelector('[data-link-race]').value || null,
                    };
                    b.disabled = true;
                    const { error } = await AdminApi.eloLinks.update(Number(b.dataset.linkSave), payload);
                    b.disabled = false;
                    if (error) return C().toast(C().errorText(error), 'error');
                    C().toast(`ELO ${b.dataset.linkSave} 연결 계정을 저장했습니다`);
                })
        );
        // 창의 ELO ID 칸과 어긋나지 않게 바꾼 뒤 창을 닫는다.
        box.querySelectorAll('[data-main-elo]').forEach(
            b =>
                (b.onclick = async () => {
                    const elo = Number(b.dataset.mainElo);
                    if (
                        !confirm(
                            `ELO ${elo}를 메인 계정으로 바꿀까요?\n지금 메인 계정은 연결 계정으로 옮겨지고, 오늘부터 방송통계가 새 계정으로 세집니다${C().state.dirty ? '\n이 창에서 고친 내용은 저장되지 않습니다' : ''}`
                        )
                    )
                        return;
                    b.disabled = true;
                    const { error } = await AdminApi.tierMembers.setMainElo(memberId, elo);
                    if (error) {
                        b.disabled = false;
                        return C().toast(C().errorText(error), 'error');
                    }
                    C().toast(`ELO ${elo}를 메인 계정으로 바꿨습니다. 종족이 바뀌었으면 종족 칸도 고치세요`);
                    C().closeDrawer(true);
                    await load(S.page);
                })
        );
        box.querySelectorAll('[data-unlink]').forEach(
            b =>
                (b.onclick = async () => {
                    if (!confirm(`ELO ${b.dataset.unlink} 연결을 해제할까요? 다음 동기화 때 신규 인원에 다시 뜹니다`))
                        return;
                    const { error } = await AdminApi.eloLinks.remove(Number(b.dataset.unlink));
                    if (error) return C().toast(C().errorText(error), 'error');
                    showLinks(memberId);
                })
        );
    }
    async function bulk() {
        if (!S.selected.size) return C().toast('선택한 행이 없습니다', 'error');
        C().openDrawer({
            eyebrow: 'BULK',
            title: `${S.selected.size}명 일괄 수정`,
            html: `${C().field('소속', C().input('atb_aff', '', 'text', 'placeholder="비우면 변경 안 함"'))}${C().field('티어', C().input('atb_tier', '', 'text', 'placeholder="비우면 변경 안 함"'))}<p class="admin-help">소속에는 FA 또는 휴면을 그대로 저장할 수 있습니다</p>`,
            onSubmit: async () => {
                const aff = C().empty(C().value('atb_aff')),
                    tier = C().empty(C().value('atb_tier'));
                if (!aff && !tier) throw new Error('소속 또는 티어 중 하나를 입력하세요');
                const { error } = await AdminApi.tierMembers.bulkUpdate([...S.selected], aff, tier);
                if (error) throw error;
                C().toast('일괄 수정했습니다');
                S.selected.clear();
                await load(S.page);
            },
        });
    }
    async function loadFilterOptions() {
        const all = await AdminApi.tierMembers.all('tier,affiliation,race');
        const clean = key =>
            [...new Set(all.map(r => String(r[key] || '').trim()).filter(Boolean))].sort((a, b) =>
                a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })
            );
        const tiers = clean('tier').sort((a, b) => tierRank(a) - tierRank(b) || a.localeCompare(b, 'ko'));
        S.options = { tiers, affs: clean('affiliation'), races: clean('race') };
    }

    let loadSequence = 0;
    async function load(page = 0) {
        const sequence = ++loadSequence;
        S.page = Math.max(0, page);
        if (document.getElementById('tierQ')) {
            S.filters = {
                q: C().value('tierQ').trim(),
                tier: C().value('tierFilter').trim(),
                aff: C().value('tierAff').trim(),
                race: C().value('tierRace').trim(),
            };
        }
        const from = S.page * S.size,
            to = from + S.size - 1;
        const { q: search, tier, aff, race } = S.filters;
        let result;
        try {
            result = await AdminApi.tierMembers.page({
                from,
                to,
                sort: S.sort,
                ascending: S.asc,
                search,
                tier,
                affiliation: aff,
                race,
            });
        } catch (error) {
            if (sequence !== loadSequence) return;
            throw error;
        }
        if (sequence !== loadSequence) return;
        const { data, count, error } = result;
        if (error) throw error;
        S.rows = data || [];
        S.count = count || 0;
        render();
    }
    function setView(view) {
        if (S.view === view) return;
        S.view = view;
        const url = new URL(location.href);
        if (view === 'members') url.searchParams.delete('view');
        else url.searchParams.set('view', view);
        history.replaceState(null, '', url);
        showView();
    }

    async function showView() {
        activateTabView(VIEW_TABS, S.view);
        if (S.view === 'ranking') await showRanking();
        else if (S.view === 'update') await window.AdminTierUpdate.show();
        else if (S.view === 'teams') await window.AdminTeams.show();
        else await Promise.all([showMembers(), showCandidates()]);
    }
    function render() {
        const root = document.getElementById('adminTierMembersBody');
        if (!root) return;
        const { tiers = [], affs = [], races = [] } = S.options || {};
        const selected = (value, current) => (String(value) === String(current || '') ? ' selected' : '');
        root.innerHTML = `
      <div class="admin-filter-grid"><input class="admin-input" id="tierQ" placeholder="이름 · 닉네임 · SOOP ID · ELO ID" value="${esc(S.filters.q)}">
      <select class="admin-input" id="tierFilter"><option value="">전체 티어</option>${tiers.map(x => `<option value="${esc(x)}"${selected(x, S.filters.tier)}>${esc(adminTierLabel(x))}</option>`).join('')}</select>
      <select class="admin-input" id="tierAff"><option value="">전체 소속</option>${affs.map(x => `<option value="${esc(x)}"${selected(x, S.filters.aff)}>${esc(x)}</option>`).join('')}</select>
      <select class="admin-input" id="tierRace"><option value="">전체 종족</option>${races.map(x => `<option value="${esc(x)}"${selected(x, S.filters.race)}>${esc(x)}</option>`).join('')}</select><button class="admin-btn primary" id="tierSearch">조회</button></div>
      <div class="admin-table-wrap"><table class="admin-table admin-table-wide"><thead><tr><th></th>${[
          ['name', '이름'],
          ['nickname', '닉네임'],
          ['soop_id', 'SOOP ID'],
          ['elo_id', 'ELO ID'],
          ['gender', '성별'],
          ['race', '종족'],
          ['birth_date', '생년월일'],
          ['tier', '티어'],
          ['affiliation', '소속'],
          ['role', '직책'],
          ['', '최근 승급일'], // 여러 승급일 칸에서 계산한 값이라 DB 정렬이 없다
          ['modified_at', '수정일'],
      ]
          .map(([k, l]) => (k ? `<th><button class="admin-sort" data-sort="${k}">${l}</button></th>` : `<th>${l}</th>`))
          .join('')}<th>관리</th></tr></thead><tbody>${
          S.rows
              .map(r => {
                  const warn = promotionWarnings(r);
                  return `<tr data-tier-id="${r.id}" class="${warn.length ? 'has-warning' : ''}"><td><input type="checkbox" data-select-id="${r.id}"${S.selected.has(r.id) ? ' checked' : ''}></td><td>${esc(r.name)}</td><td><b>${esc(r.nickname)}</b>${warn.length ? `<span class="admin-warning" title="${esc(warn.join(' / '))}">!</span>` : ''}</td><td>${esc(r.soop_id)}</td><td>${esc(r.elo_id)}</td><td>${esc(r.gender)}</td><td>${esc(r.race)}</td><td>${esc(r.birth_date)}</td><td>${esc(r.tier)}</td><td>${esc(r.affiliation)}</td><td>${esc(r.role)}</td><td>${esc(latestPromotion(r))}</td><td>${esc(r.modified_at)}</td><td><button class="admin-btn" data-edit-tier="${r.id}">수정</button><button class="admin-btn" data-history-tier="${r.id}">이력</button></td></tr>`;
              })
              .join('') || '<tr><td colspan="14">검색 결과가 없습니다</td></tr>'
      }</tbody></table></div>
      ${matchPaginationHtml(S.count, S.page + 1, S.size, 'adminTierPage', '명')}`;
        root.querySelector('#tierSearch').onclick = () => load(0);
        root.querySelectorAll('[data-select-id]').forEach(
            ch =>
                (ch.onchange = () => {
                    const id = Number(ch.dataset.selectId);
                    ch.checked ? S.selected.add(id) : S.selected.delete(id);
                })
        );
        root.querySelectorAll('[data-edit-tier]').forEach(
            b => (b.onclick = () => open(S.rows.find(r => String(r.id) === b.dataset.editTier)))
        );
        root.querySelectorAll('[data-history-tier]').forEach(
            b =>
                (b.onclick = () => {
                    const r = S.rows.find(x => String(x.id) === b.dataset.historyTier);
                    C().openDrawer({
                        eyebrow: 'PROMOTION',
                        title: `${r.nickname} 승급 이력`,
                        html: historyHtml(r),
                    });
                })
        );
        root.querySelectorAll('[data-sort]').forEach(
            b =>
                (b.onclick = () => {
                    const k = b.dataset.sort;
                    if (S.sort === k) S.asc = !S.asc;
                    else {
                        S.sort = k;
                        S.asc = true;
                    }
                    load(0);
                })
        );
    }
    // ---- 티어 랭킹 보기(ststat가 계산한 스냅샷) ----
    async function loadRanking() {
        if (R.loaded) return;
        if (!R.loading)
            R.loading = (async () => {
                const [ranks, people] = await Promise.all([
                    AdminApi.ranking.rankingsAll(),
                    AdminApi.ranking.playersAll(),
                ]);
                // 표준오차(elo_player_ratings)를 못 읽으면 칸만 비운다.
                let se = {};
                try {
                    (await AdminApi.ranking.ratingSeAll()).forEach(r => {
                        se[r.elo_id] = r.rating_se;
                    });
                } catch (e) {
                    se = {};
                }
                const who = {};
                people.forEach(p => {
                    who[p.elo_id] = p;
                });
                R.rows = ranks
                    .filter(r => r.tier_rank != null)
                    .map(r => ({ ...r, ...(who[r.elo_id] || {}), se: se[r.elo_id] ?? null }))
                    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.tier_rank - b.tier_rank);
                R.loaded = true;
            })().finally(() => {
                R.loading = null;
            });
        await R.loading;
    }
    async function showRanking() {
        renderRanking();
        try {
            await loadRanking();
            renderRanking();
        } catch (err) {
            console.error('티어 랭킹 조회 실패:', err);
            const box = document.getElementById('rankBody');
            if (box)
                box.innerHTML = `<div class="content-state is-boxed">티어 랭킹을 불러오지 못했습니다<br><small>${esc(C().errorText(err))}</small></div>`;
        }
    }
    function recordCell(g, w) {
        g = Number(g) || 0;
        w = Number(w) || 0;
        return g
            ? `${g}판 <span class="admin-rank-rate">${((w / g) * 100).toFixed(0)}%</span>`
            : '<span class="admin-rank-none">—</span>';
    }
    function gapCell(r) {
        const gap = Number(r.tier_gap) || 0;
        if (!gap) return '<span class="admin-rank-none">일치</span>';
        // tier_gap > 0이면 데이터상 더 높은 티어(승급 후보)
        return `<span class="${gap > 0 ? 'h2h-win' : 'h2h-lose'}">${esc(adminTierLabel(r.data_tier))} ${gap > 0 ? '↑' : '↓'}${Math.abs(gap)}</span>`;
    }
    function rankingExplain() {
        const steps = [
            [
                '실력 점수',
                '선수마다 하나의 실력 점수(레이팅)를 둡니다 <b>레이팅 = 티어 기준점 + 개인 편차</b>입니다. 티어 기준점은 그 티어의 평균 실력, 개인 편차는 같은 티어 안에서 얼마나 위·아래인지입니다',
            ],
            [
                '승리 확률',
                '두 선수의 레이팅 차이로 승률을 정합니다(Elo와 같은 식) <code>A가 이길 확률 = 1 / (1 + 10^(−(A − B) / 400))</code> — 차이 0점이면 50%, 100점이면 약 64%, 200점이면 약 76%입니다',
            ],
            [
                '점수 맞추기',
                'EloBoard의 모든 1대1 경기 결과를 가장 잘 설명하는 레이팅을 한꺼번에 계산합니다. 그래서 <b>강한 상대를 이기면 크게 오르고, 약한 상대에게 지면 크게 떨어집니다</b>. 경기 순서에 따라 점수가 달라지는 일반 Elo와 달리, 같은 기록이면 늘 같은 점수가 나옵니다',
            ],
            [
                '경기 비중',
                '경기 형식과 최근성으로 경기마다 비중을 곱합니다. 형식: <b>대회 1.0 › 대학대전 0.9 › 미니 0.8 › 리그·CK 0.7 › 스폰 0.6</b>. 최근성: 개인 편차는 <b>90일</b>마다 비중이 절반(최근 3개월 폼), 티어 기준점은 <b>540일</b>마다 절반(티어 간격은 천천히 변함)',
            ],
            ['종족 상성', '테란·저그·프로토스 사이의 공통 유불리를 따로 계산해 빼고, 순수한 개인 실력만 비교합니다'],
            [
                '적은 기록',
                '경기가 적은 선수는 몇 판의 운으로 튀지 않게 티어 평균 쪽으로 당겨집니다. 많이 둘수록 자기 성적대로 자리를 잡습니다',
            ],
            [
                '승급한 선수',
                '티어 기준점은 경기 당시 티어로 계산하고, 개인 편차는 지금 티어 기준으로 계산합니다. 그래서 막 승급한 선수가 옛 티어에서 번 성적만으로 새 티어 1위에 오르지 않습니다',
            ],
            [
                '순위 매기기',
                '지금 티어가 있고, <b>최근 1년에 10판 이상</b> 뒀고, 휴면이 아닌 선수만 같은 티어 안에서 레이팅 순서로 줄 세웁니다',
            ],
            [
                '데이터 티어',
                '레이팅이 오차 범위까지 고려해도 옆 티어 기준을 확실히 넘으면 ↑(더 높은 티어) · ↓(더 낮은 티어)로 표시합니다. 티어표 조정 검토용이며 순위에는 영향이 없습니다',
            ],
        ];
        return `<ol>${steps.map(([t, d]) => `<li><strong>${t}</strong><p>${d}</p></li>`).join('')}</ol>`;
    }
    function renderRanking() {
        if (S.view !== 'ranking') return; // 불러오는 사이 다른 보기로 옮겼으면 덮어쓰지 않는다
        const root = document.getElementById('rankBody');
        if (!root) return;
        const help = document.getElementById('rankHelp');
        const explain = document.getElementById('rankExplain');
        if (!explain.innerHTML) explain.innerHTML = rankingExplain();
        help.onclick = () => {
            explain.hidden = !explain.hidden;
            help.setAttribute('aria-expanded', String(!explain.hidden));
        };
        const counts = {};
        R.rows.forEach(r => {
            counts[r.tier] = (counts[r.tier] || 0) + 1;
        });
        const q = R.q.trim().toLowerCase();
        const rows = R.rows.filter(
            r =>
                (!R.tier || String(r.tier) === R.tier) &&
                (!R.gapOnly || Number(r.tier_gap)) &&
                (!q ||
                    [r.nickname, r.elo_name, r.affiliation].some(v =>
                        String(v || '')
                            .toLowerCase()
                            .includes(q)
                    ))
        );
        const tiers = [
            ['', '전체', R.rows.length],
            ...LADDER.filter(t => counts[t]).map(t => [t, adminTierLabel(t), counts[t]]),
        ]
            .map(
                ([k, l, n]) => `<option value="${esc(k)}"${R.tier === k ? ' selected' : ''}>${esc(l)} · ${n}명</option>`
            )
            .join('');
        const body = rows
            .map(r => {
                return `<tr${Number(r.tier_gap) ? ' class="has-gap"' : ''}>
        <td>${esc(adminTierLabel(r.tier))}</td>
        <td><b>${r.tier_rank}</b><span class="admin-rank-none"> / ${r.tier_count || counts[r.tier] || ''}</span></td>
        <td><b>${esc(r.nickname || r.elo_name || r.elo_id)}</b>${r.nickname && r.elo_name && r.nickname !== r.elo_name ? `<span class="admin-rank-none"> ${esc(r.elo_name)}</span>` : ''}</td>
        <td>${esc(r.race || '')}</td>
        <td>${esc(r.affiliation || '')}</td>
        <td><b>${r.raw_rating == null ? '—' : Number(r.raw_rating).toFixed(0)}</b></td>
        <td>${r.se == null ? '<span class="admin-rank-none">—</span>' : '±' + Number(r.se).toFixed(0)}</td>
        <td>${gapCell(r)}</td>
        <td>${recordCell(r.recent_365_games, r.recent_365_wins)}</td>
        <td>${recordCell(r.recent_90_games, r.recent_90_wins)}</td>
        <td>${recordCell(r.recent_30_games, r.recent_30_wins)}</td>
      </tr>`;
            })
            .join('');
        const loading = !R.loaded;
        root.innerHTML = `${
            loading
                ? '<div class="content-state is-boxed">티어 랭킹을 불러오는 중</div>'
                : `<div class="admin-rank-tools">
        <select class="admin-input" id="rankTier" aria-label="티어">${tiers}</select>
        <input class="admin-input" id="rankQ" aria-label="선수 검색" placeholder="닉네임 · 소속 검색" value="${esc(R.q)}">
        <div class="filter-nav" role="group" aria-label="티어 괴리 필터">${[
            [false, '전체'],
            [true, '티어 괴리'],
        ]
            .map(
                ([gap, label]) =>
                    `<button type="button" class="filter-item${R.gapOnly === gap ? ' active' : ''}" data-rank-gap="${gap}" aria-pressed="${R.gapOnly === gap}">${label}</button>`
            )
            .join('')}</div>
      </div>
      <div class="admin-table-wrap"><table class="admin-table admin-rank-table"><thead><tr><th>티어</th><th>순위</th><th>닉네임</th><th>종족</th><th>소속</th><th>레이팅</th><th>오차</th><th>데이터 티어</th><th>최근 1년</th><th>90일</th><th>30일</th></tr></thead>
      <tbody>${body || '<tr><td colspan="11">조건에 맞는 선수가 없습니다</td></tr>'}</tbody></table></div>`
        }`;
        const tierEl = root.querySelector('#rankTier');
        if (tierEl)
            tierEl.onchange = () => {
                R.tier = tierEl.value;
                renderRanking();
            };
        root.querySelectorAll('[data-rank-gap]').forEach(button => {
            button.onclick = () => {
                R.gapOnly = button.dataset.rankGap === 'true';
                renderRanking();
            };
        });
        const qEl = root.querySelector('#rankQ');
        if (qEl)
            qEl.oninput = () => {
                R.q = qEl.value;
                const pos = qEl.selectionStart;
                renderRanking();
                const again = document.getElementById('rankQ');
                again.focus();
                again.setSelectionRange(pos, pos);
            };
    }

    // ---- 신규 인원 보기(EloBoard에는 있고 명단엔 없는 선수) ----
    // 무시한 줄은 남겨 둬야 ststat이 같은 ELO ID를 다시 올리지 않는다.
    async function loadCandidates() {
        N.members = await AdminApi.tierMembers.all('id,nickname,name,soop_id,elo_id,race,affiliation');
        N.rows = await AdminApi.candidates.all(N.status);
    }
    async function showCandidates() {
        N.rows = null;
        renderCandidates();
        try {
            await loadCandidates();
            renderCandidates();
        } catch (err) {
            console.error('신규 인원 조회 실패:', err);
            document.querySelectorAll('#candFilters button').forEach(button => {
                button.disabled = false;
            });
            const box = document.getElementById('candBody');
            if (box)
                box.innerHTML = `<div class="content-state is-boxed">신규 인원을 불러오지 못했습니다<br><small>${esc(C().errorText(err))}</small></div>`;
        }
    }
    async function setCandidateStatus(c, status) {
        const { error } = await AdminApi.candidates.setStatus(c.id, status);
        if (error) throw error;
        N.rows = N.rows.filter(x => x.id !== c.id);
        renderCandidates();
    }
    function addCandidate(c) {
        const tier = String(c.tier || '')
            .replace('티어', '')
            .trim();
        open(
            {
                nickname: c.nickname,
                elo_id: c.elo_id,
                soop_id: c.soop_id,
                gender: c.gender,
                race: c.race,
                tier: tier || null,
                affiliation: c.affiliation,
            },
            async () => {
                const { error } = await AdminApi.candidates.remove(c.id);
                if (error) throw error;
                membersLoaded = false;
                await Promise.all([showMembers(), showCandidates()]);
            }
        );
    }
    // 같은 사람일 수 있는 기존 선수. EloBoard는 '진땅콩.', '진땅콩..'처럼 점으로 계정을 구분해 점·공백을 빼고 비교한다.
    const baseName = v =>
        String(v || '')
            .toLowerCase()
            .replace(/[.\s]+/g, '');
    function sameMember(c) {
        const low = v =>
            String(v || '')
                .trim()
                .toLowerCase();
        const soop = low(c.soop_id),
            name = baseName(c.nickname);
        return (
            (N.members || []).find(m => soop && low(m.soop_id) === soop) ||
            (N.members || []).find(m => name && (baseName(m.nickname) === name || baseName(m.name) === name)) ||
            null
        );
    }
    function memberLabel(m) {
        return `${m.nickname}${m.affiliation ? ` · ${m.affiliation}` : ''}${m.race ? ` · ${m.race}` : ''}${m.elo_id ? ` · ELO ${m.elo_id}` : ''}`;
    }
    function linkCandidate(c) {
        const hint = sameMember(c);
        const opts = (N.members || []).map(m => `<option value="${esc(memberLabel(m))}"></option>`).join('');
        C().openDrawer({
            eyebrow: 'LINK',
            title: `${c.nickname} (ELO ${c.elo_id}) 기존 선수에 연결`,
            html: `<p class="admin-help">같은 사람의 다른 종족 계정이면 연결하세요. 연결하면 신규 인원에 다시 뜨지 않고, 선수 정보(메인 ELO ID·소속·SOOP ID 등)와 전적은 바뀌지 않습니다. 수정일도 필요 없습니다</p>
        ${C().field('연결할 선수', `<input class="admin-input" id="atl_member" list="atl_members" value="${esc(hint ? memberLabel(hint) : '')}" placeholder="닉네임으로 찾기" autocomplete="off"><datalist id="atl_members">${opts}</datalist>`)}`,
            onSubmit: async () => {
                const label = C().value('atl_member').trim();
                const m =
                    (N.members || []).find(x => memberLabel(x) === label) ||
                    (N.members || []).find(x => x.nickname === label);
                if (!m) throw new Error('목록에서 선수를 고르세요');
                const { error } = await AdminApi.eloLinks.insert({
                    elo_id: c.elo_id,
                    tier_member_id: m.id,
                    elo_name: c.nickname,
                    race: c.race,
                });
                if (error) throw error;
                const del = await AdminApi.candidates.remove(c.id);
                if (del.error) throw del.error;
                C().toast(`${m.nickname} 선수에 연결했습니다`);
                N.rows = N.rows.filter(x => x.id !== c.id);
                renderCandidates();
            },
        });
    }
    function renderCandidates() {
        const root = document.getElementById('candBody');
        if (!root) return;
        const rows = N.rows || [];
        const filters = document.getElementById('candFilters');
        filters.innerHTML = [
            ['pending', '대기'],
            ['ignored', '무시함'],
        ]
            .map(
                ([key, label]) =>
                    `<button type="button" class="filter-item${N.status === key ? ' active' : ''}" data-cand-status="${key}" aria-pressed="${N.status === key}"${N.rows === null ? ' disabled' : ''}>${label}${N.status === key && N.rows ? ` ${N.rows.length}` : ''}</button>`
            )
            .join('');
        const pending = N.status === 'pending';
        const body = rows
            .map(c => {
                const same = sameMember(c);
                return `<tr><td><b>${esc(c.nickname)}</b>${
                    same
                        ? `<div class="admin-help">⚠ ${esc(same.nickname)} 선수와 ${
                              String(same.soop_id || '')
                                  .trim()
                                  .toLowerCase() ===
                                  String(c.soop_id || '')
                                      .trim()
                                      .toLowerCase() && c.soop_id
                                  ? 'SOOP ID가'
                                  : '이름이'
                          } 같음 · 같은 사람의 다른 계정이면 연결</div>`
                        : ''
                }</td><td>${esc(c.elo_id)}</td><td>${esc(c.soop_id)}</td><td>${esc(c.race)}</td><td>${esc(c.tier)}</td><td>${esc(c.affiliation)}</td><td>${esc(c.found_at)}</td><td>${esc(c.source === 'ststat_sync_eloboard' ? '경기 기록' : '티어 목록')}</td>
      <td>${pending ? `<button class="admin-btn${same ? '' : ' primary'}" data-cand-add="${esc(c.id)}">선수로 추가</button><button class="admin-btn${same ? ' primary' : ''}" data-cand-link="${esc(c.id)}">기존 선수에 연결</button><button class="admin-btn" data-cand-ignore="${esc(c.id)}">무시</button>` : `<button class="admin-btn" data-cand-restore="${esc(c.id)}">되돌리기</button>`}</td></tr>`;
            })
            .join('');
        root.innerHTML = `
      ${
          N.rows === null
              ? '<div class="content-state is-boxed">신규 인원을 불러오는 중</div>'
              : `      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>EloBoard 이름</th><th>ELO ID</th><th>SOOP ID</th><th>종족</th><th>티어</th><th>소속</th><th>발견일</th><th>출처</th><th>관리</th></tr></thead>
      <tbody>${body || `<tr><td colspan="9">${pending ? '대기 중인 신규 인원이 없습니다' : '무시한 선수가 없습니다'}</td></tr>`}</tbody></table></div>`
      }`;
        const find = id => N.rows.find(c => c.id === id);
        const act = fn => async b => {
            b.disabled = true;
            try {
                await fn();
            } catch (err) {
                b.disabled = false;
                C().toast(C().errorText(err), 'error');
            }
        };
        filters.querySelectorAll('[data-cand-status]').forEach(
            b =>
                (b.onclick = () => {
                    N.status = b.dataset.candStatus;
                    showCandidates();
                })
        );
        root.querySelectorAll('[data-cand-add]').forEach(
            b => (b.onclick = () => addCandidate(find(b.dataset.candAdd)))
        );
        root.querySelectorAll('[data-cand-link]').forEach(
            b => (b.onclick = () => linkCandidate(find(b.dataset.candLink)))
        );
        root.querySelectorAll('[data-cand-ignore]').forEach(
            b => (b.onclick = () => act(() => setCandidateStatus(find(b.dataset.candIgnore), 'ignored'))(b))
        );
        root.querySelectorAll('[data-cand-restore]').forEach(
            b => (b.onclick = () => act(() => setCandidateStatus(find(b.dataset.candRestore), 'pending'))(b))
        );
    }

    async function init() {
        if (document.body.dataset.adminPage !== 'tier') return;
        C().addPageTool({
            id: 'tierAdd',
            label: '새 선수',
            icon: 'plus',
            scope: '#view-admin-tier-members',
            onClick: () => open(null),
        });
        C().addPageTool({
            id: 'tierBulk',
            label: '일괄 수정',
            icon: 'edit',
            scope: '#view-admin-tier-members',
            onClick: bulk,
        });
        await showView();
    }

    let membersLoaded = false;
    async function showMembers() {
        render();
        if (membersLoaded) return;
        membersLoaded = true;
        try {
            await load(0);
        } catch (err) {
            console.error('티어표 관리 조회 실패:', err);
            const root = document.getElementById('adminTierMembersBody');
            if (root)
                root.innerHTML = `<div class="content-state is-boxed">티어표 데이터를 불러오지 못했습니다<br><small>${esc(C().errorText(err))}</small></div>`;
            C().toast(`티어표 조회 실패: ${C().errorText(err)}`, 'error');
            membersLoaded = false;
            return;
        }

        loadFilterOptions()
            .then(() => render())
            .catch(err => {
                console.error('티어 필터 옵션 조회 실패:', err);
                C().toast('티어 필터 옵션 일부를 불러오지 못했습니다. 표 조회는 계속 사용할 수 있습니다', 'error');
            });
    }
    window.switchAdminTierView = setView;
    window.adminTierPage = page => load(page - 1).catch(err => C().toast(C().errorText(err), 'error'));
    bootPage(() => {}, { siteData: false, view: () => activateTabView(VIEW_TABS, S.view) });
    document.addEventListener('admin:ready', init);
})();
