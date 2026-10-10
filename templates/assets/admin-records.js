(function () {
    'use strict';
    const C = () => window.AdminCore;
    const RACE_CHOICES = ['테란', '저그', '프로토스', '랜덤'];
    const S = {
        page: 0,
        size: 25,
        count: 0,
        rows: [],
        expanded: new Map(),
        members: [],
        roundCounts: {},
        loaded: false,
    };

    function esc(v) {
        return C().esc(v);
    }
    function resultKind(v) {
        const s = String(v || '')
            .trim()
            .toLowerCase();
        if (['승', '승리', 'win', 'w'].includes(s)) return 'win';
        if (['패', '패배', 'loss', 'lose', 'l'].includes(s)) return 'loss';
        return '';
    }
    function validateScore(match, rounds) {
        let w = 0,
            l = 0;
        rounds.forEach(r => {
            const k = resultKind(r.result);
            if (k === 'win') w++;
            if (k === 'loss') l++;
        });
        if (!w && !l) return null;
        const score = `${w}:${l}`,
            final = w > l ? '승' : w < l ? '패' : '무';
        const mismatches = [];
        if (match.set_result && String(match.set_result).replace(/\s/g, '') !== score)
            mismatches.push(`세트 스코어 ${match.set_result} ↔ ${score}`);
        if (
            match.final_result &&
            resultKind(match.final_result) &&
            resultKind(match.final_result) !== resultKind(final)
        )
            mismatches.push(`결과 ${match.final_result} ↔ ${final}`);
        return { w, l, score, final, mismatches };
    }
    // 용병이 뛰는 경우도 있어 선수는 자유 입력이고 멤버 이름은 제안만 한다.
    function memberDatalist() {
        const names = [...new Set(S.members.map(m => m.nickname || m.name).filter(Boolean))];
        return `<datalist id="ar_member_names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
    }
    // 서랍(540px)에 12칸 표는 너무 좁아서 세트 하나를 카드 하나로 세운다.
    function roundRow(r = {}, idx = 0) {
        const f = (label, k, attrs = '', cls = '') =>
            `<label class="admin-round-field${cls}"><span>${label}</span><input class="admin-input" data-k="${k}" value="${esc(r[k] || '')}"${attrs}></label>`;
        // 목록에 없는 값은 지우지 않게 끝에 그대로 보여 준다.
        const raceField = (label, k) => {
            const v = r[k] || '';
            const list = ['', ...RACE_CHOICES, ...(v && !RACE_CHOICES.includes(v) ? [v] : [])];
            return `<label class="admin-round-field"><span>${label}</span><select class="admin-input" data-k="${k}">${list
                .map(x => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(x || '-')}</option>`)
                .join('')}</select></label>`;
        };
        return `<div class="admin-round-row admin-round-card" data-round-index="${idx}">
      <div class="admin-round-head">
        <b><span class="admin-round-no">${idx + 1}</span>세트</b>
        <select class="admin-input admin-round-result" data-k="result" aria-label="결과"><option value="">결과</option><option${r.result === '승' ? ' selected' : ''}>승</option><option${r.result === '패' ? ' selected' : ''}>패</option></select>
        <button type="button" class="admin-btn danger admin-round-delete">삭제</button>
      </div>
      <div class="admin-round-grid">
        ${f('세트명', 'set_name')}${f('라운드명', 'round_name', '', ' is-wide')}
        ${f('캄몬 선수', 'our_player', ' list="ar_member_names" placeholder="멤버 또는 용병"')}${raceField('종족', 'our_race')}${f('티어', 'our_tier')}
        ${f('상대 선수', 'opponent_player')}${raceField('종족', 'opponent_race')}${f('티어', 'opponent_tier')}
        ${f('맵', 'map_name', '', ' is-full')}
      </div>
    </div>`;
    }
    // 결과·세트 스코어는 세트 결과가 있으면 자동 계산한다(세트가 없는 기록만 직접 적는다).
    function editorHtml(match = {}, rounds = [], nextNo = null) {
        const isNew = match.match_no == null;
        return `
      <div class="admin-form-grid">
        ${C().field('경기번호', C().input('ar_no', match.match_no ?? nextNo ?? '', 'number', 'min="1"'), isNew ? '다음 번호로 자동' : '')}
        ${C().field('날짜', C().input('ar_date', match.match_date || '', 'date', 'required'))}
        ${C().field('상대 대학', C().input('ar_opp', match.opponent_team || '', 'text', 'required'))}
        ${C().field('형식', C().input('ar_format', match.match_format || ''))}
        ${C().field('진행 방식', C().input('ar_method', match.method || ''))}
        ${C().field('결과', C().input('ar_result', match.final_result || ''))}
        ${C().field('세트 스코어', C().input('ar_set', match.set_result || ''), '세트 결과로 자동 계산')}
      </div>
      <div class="admin-section-head"><b>세트</b><button type="button" class="admin-btn" id="ar_add_round">+ 세트 추가</button></div>
      <div class="admin-round-list" id="ar_rounds">${rounds.map(roundRow).join('')}</div>${memberDatalist()}`;
    }
    function collectRounds() {
        return [...document.querySelectorAll('#ar_rounds .admin-round-row')].map((tr, i) => {
            const r = {};
            tr.querySelectorAll('[data-k]').forEach(el => (r[el.dataset.k] = C().empty(el.value)));
            r.source_order = i + 1;
            return r;
        });
    }
    function refreshRounds() {
        document.querySelectorAll('#ar_rounds .admin-round-no').forEach((el, i) => {
            el.textContent = i + 1;
        });
        const check = validateScore({}, collectRounds());
        const set = document.getElementById('ar_set'),
            res = document.getElementById('ar_result');
        if (!set || !res) return;
        if (check) {
            set.value = check.score;
            res.value = check.final;
        }
        set.readOnly = res.readOnly = !!check;
    }
    async function nextMatchNo() {
        const { data, error } = await AdminApi.matches.nextNo();
        if (error) return null;
        return Number(data?.[0]?.match_no || 0) + 1;
    }
    async function getRounds(matchNo) {
        const { data, error } = await AdminApi.rounds.ofMatch(matchNo);
        if (error) throw error;
        return data || [];
    }
    async function openEditor(match, clone = false) {
        match = match || {};
        const sourceNo = match.match_no;
        const rounds = sourceNo ? await getRounds(sourceNo) : [];
        const editing = clone ? { ...match, match_no: null, source_order: null } : match;
        const nextNo = editing.match_no == null ? await nextMatchNo() : null;
        C().openDrawer({
            eyebrow: 'RECORD',
            title: clone ? '매치 복제' : sourceNo ? '매치 수정' : '새 매치',
            html: editorHtml(editing, rounds, nextNo),
            onSubmit: async () => {
                const p_match = {
                    match_no: C().intOrNull(C().value('ar_no')),
                    source_order: editing.source_order || null,
                    match_date: C().value('ar_date'),
                    opponent_team: C().value('ar_opp').trim(),
                    match_format: C().empty(C().value('ar_format')),
                    method: C().empty(C().value('ar_method')),
                    final_result: C().empty(C().value('ar_result')),
                    set_result: C().empty(C().value('ar_set')),
                };
                if (!p_match.match_date || !p_match.opponent_team) throw new Error('날짜와 상대 대학은 필수입니다');
                const p_rounds = collectRounds();
                const check = validateScore(p_match, p_rounds);
                if (
                    check?.mismatches.length &&
                    !confirm(`세트 결과와 매치 결과가 다릅니다.\n${check.mismatches.join('\n')}\n그래도 저장할까요?`)
                )
                    throw new Error('결과 불일치로 저장을 취소했습니다');
                const { data, error } = await AdminApi.matches.save(p_match, p_rounds);
                if (error) throw error;
                C().toast(`경기 ${data}번을 저장했습니다`);
                await load(S.page);
            },
            onDelete:
                sourceNo && !clone
                    ? async () => {
                          const { error } = await AdminApi.matches.remove(sourceNo);
                          if (error) throw error;
                          await load(S.page);
                      }
                    : null,
        });
        document.getElementById('ar_add_round').onclick = () => {
            const tb = document.getElementById('ar_rounds');
            tb.insertAdjacentHTML('beforeend', roundRow({}, tb.children.length));
            refreshRounds();
            C().markDirty(true);
        };
        const tbody = document.getElementById('ar_rounds');
        tbody.addEventListener('click', ev => {
            const b = ev.target.closest('.admin-round-delete');
            if (!b) return;
            b.closest('.admin-round-row').remove();
            refreshRounds();
            C().markDirty(true);
        });
        tbody.addEventListener('change', ev => {
            if (ev.target.matches('[data-k="result"]')) refreshRounds();
        });
        refreshRounds();
    }
    async function load(page = 0) {
        S.page = Math.max(0, page);
        let allowed = null;
        const player = C().value('recordsPlayer').trim();
        if (player) {
            const { data, error } = await AdminApi.rounds.matchNosOfPlayer(player);
            if (error) throw error;
            allowed = [...new Set((data || []).map(x => x.match_no))];
            if (!allowed.length) {
                S.rows = [];
                S.count = 0;
                render();
                return;
            }
        }
        const from = S.page * S.size,
            to = from + S.size - 1;
        const { data, count, error } = await AdminApi.matches.page({
            from,
            to,
            date: C().value('recordsDate'),
            opponent: C().value('recordsOpponent').trim(),
            format: C().value('recordsFormat').trim(),
            matchNos: allowed,
        });
        if (error) throw error;
        S.rows = data || [];
        S.count = count || 0;
        S.roundCounts = {};
        const matchNos = S.rows.map(r => r.match_no).filter(v => v !== null && v !== undefined);
        if (matchNos.length) {
            const { data: roundRows, error: roundError } = await AdminApi.rounds.matchNosIn(matchNos);
            if (roundError) throw roundError;
            (roundRows || []).forEach(r => {
                const k = String(r.match_no);
                S.roundCounts[k] = (S.roundCounts[k] || 0) + 1;
            });
        }
        render();
    }
    async function toggleRounds(no, tr) {
        if (S.expanded.has(no)) {
            S.expanded.delete(no);
            tr.nextElementSibling?.remove();
            return;
        }
        const rows = await getRounds(no);
        S.expanded.set(no, rows);
        const detail = document.createElement('tr');
        detail.className = 'admin-expand-row';
        detail.innerHTML = `<td colspan="9"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>순서</th><th>세트명</th><th>라운드명</th><th>캄몬 선수</th><th>종족</th><th>티어</th><th>상대 선수</th><th>상대 종족</th><th>상대 티어</th><th>맵</th><th>결과</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.source_order}</td><td>${esc(r.set_name)}</td><td>${esc(r.round_name)}</td><td>${esc(r.our_player)}</td><td>${esc(r.our_race)}</td><td>${esc(r.our_tier)}</td><td>${esc(r.opponent_player)}</td><td>${esc(r.opponent_race)}</td><td>${esc(r.opponent_tier)}</td><td>${esc(r.map_name)}</td><td>${wl(r.result)}</td></tr>`).join('')}</tbody></table></div></td>`;
        tr.after(detail);
    }
    function wl(v) {
        const t = String(v ?? '');
        const c = t.includes('승') ? 'h2h-win' : t.includes('패') ? 'h2h-lose' : '';
        return c ? `<span class="${c}">${esc(t)}</span>` : esc(t);
    }
    async function show() {
        render();
        if (S.loaded) return;
        S.loaded = true;
        try {
            if (!S.members.length) S.members = await C().loadMembers();
            await load(0);
        } catch (e) {
            S.loaded = false;
            C().toast(`전적 조회 실패: ${C().errorText(e)}`, 'error');
        }
    }
    // 실패를 알리지 않으면 버튼이 멈춘 것처럼 보인다
    const report = p => p.catch(e => C().toast(C().errorText(e), 'error'));
    function render() {
        // 새로 그리면 펼친 세트 줄도 사라지므로 펼침 기록도 비운다
        S.expanded.clear();
        const root = document.getElementById('adminMatchesRoot');
        root.innerHTML = `
      <div class="admin-filter-grid">
        <input class="admin-input" id="recordsDate" type="date" value="${esc(C().value('recordsDate'))}">
        <input class="admin-input" id="recordsOpponent" placeholder="상대 대학" value="${esc(C().value('recordsOpponent'))}">
        <input class="admin-input" id="recordsFormat" placeholder="경기 형식" value="${esc(C().value('recordsFormat'))}">
        <input class="admin-input" id="recordsPlayer" placeholder="선수 검색" value="${esc(C().value('recordsPlayer'))}">
        <button class="admin-btn primary" id="recordsSearch">조회</button>
      </div>
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>경기번호</th><th>날짜</th><th>상대 대학</th><th>형식</th><th>진행 방식</th><th>결과</th><th>세트 스코어</th><th>라운드 수</th><th>관리</th></tr></thead><tbody>${S.rows.map(r => `<tr data-match="${r.match_no}"><td>${r.match_no}</td><td>${esc(r.match_date)}</td><td><b>${esc(r.opponent_team)}</b></td><td>${esc(r.match_format)}</td><td>${esc(r.method)}</td><td>${wl(r.final_result)}</td><td>${esc(r.set_result)}</td><td>${S.roundCounts[String(r.match_no)] || 0}</td><td><button class="admin-btn" data-edit="${r.match_no}">수정</button><button class="admin-btn" data-clone="${r.match_no}">복제</button></td></tr>`).join('') || '<tr><td colspan="9">검색 결과가 없습니다</td></tr>'}</tbody></table></div>
      ${matchPaginationHtml(S.count, S.page + 1, S.size, 'adminRecordsPage', '경기')}`;
        root.querySelector('#recordsSearch').onclick = () => report(load(0));
        root.querySelectorAll('[data-edit]').forEach(
            b =>
                (b.onclick = ev => {
                    ev.stopPropagation();
                    report(openEditor(S.rows.find(r => String(r.match_no) === b.dataset.edit)));
                })
        );
        root.querySelectorAll('[data-clone]').forEach(
            b =>
                (b.onclick = ev => {
                    ev.stopPropagation();
                    report(
                        openEditor(
                            S.rows.find(r => String(r.match_no) === b.dataset.clone),
                            true
                        )
                    );
                })
        );
        root.querySelectorAll('tr[data-match]').forEach(
            tr => (tr.onclick = () => report(toggleRounds(Number(tr.dataset.match), tr)))
        );
    }
    async function init() {
        if (document.body.dataset.adminPage !== 'records') return;
        C().addPageTool({
            id: 'recordsAdd',
            label: '새 매치',
            icon: 'plus',
            scope: '#view-record-matches',
            onClick: () => report(openEditor(null)),
        });
        await show();
    }
    window.adminRecordsPage = page => report(load(page - 1));
    bootPage(() => {}, { siteData: false });
    document.addEventListener('admin:ready', init);
})();
