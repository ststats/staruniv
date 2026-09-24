(function () {
  'use strict';
  const C = () => window.AdminCore;
  const COLORS = [
    ['red','빨강'],['orange','주황'],['yellow','노랑'],['green','초록'],
    ['blue','파랑'],['indigo','남색'],['purple','보라'],['light_gray','연한 회색']
  ];

  function colorPicker(selected) {
    const key = COLORS.some(x=>x[0]===selected) ? selected : 'blue';
    return `<div class="admin-color-grid">${COLORS.map(([v,l]) =>
      `<label class="admin-color-option"><input type="radio" name="schedule_color" value="${v}"${v===key?' checked':''}><span class="admin-color-swatch cal-color-${v}"></span><b>${l}</b></label>`
    ).join('')}</div>`;
  }

  async function refresh(date) {
    const keep = date || (typeof calSelectedDateStr !== 'undefined' ? calSelectedDateStr : '') || (typeof calTodayStr === 'function' ? calTodayStr() : '');
    await calLoadPublicData();
    if (keep) calSelectDate(keep);
  }

  function openEvent(row, date) {
    const isNew = !row;
    const start = row?.startDate || date || window.calSelectedDateStr || calTodayStr();
    const end = row?.endDate || start;
    const selectedColor = row?.color || 'blue';
    C().openDrawer({
      eyebrow: 'SCHEDULE',
      title: isNew ? '일정 추가' : '일정 수정',
      html: `
        <div class="admin-form-grid">
          ${C().field('시작일', C().input('as_start', start, 'date', 'required'))}
          ${C().field('종료일', C().input('as_end', end, 'date', 'required'))}
          ${C().field('시간', C().input('as_time', row?.time || '', 'text', 'placeholder="19:00"'))}
          ${C().field('제목', C().input('as_person', row?.person || '', 'text', 'required maxlength="60" placeholder="예: 캄몬, 중만컵, 멤버 이름"'))}
        </div>
        ${C().field('간략 내용', C().input('as_desc', row?.desc || '', 'text', 'maxlength="120"'))}
        ${C().field('상세 내용', C().textarea('as_detail', row?.detail || '', 'rows="4"'))}
        <div class="admin-field"><span>색상</span>${colorPicker(selectedColor)}</div>`,
      onSubmit: async () => {
        const startDate=C().value('as_start'), endDate=C().value('as_end')||startDate;
        if (!startDate || !endDate) throw new Error('시작일과 종료일이 필요합니다.');
        if (endDate < startDate) throw new Error('종료일은 시작일보다 빠를 수 없습니다.');
        if (!C().value('as_person').trim()) throw new Error('제목을 입력하세요.');
        const color = document.querySelector('input[name="schedule_color"]:checked')?.value || 'blue';
        const dbRow = {
          start_date:startDate, end_date:endDate, event_time:C().empty(C().value('as_time')),
          person:C().value('as_person').trim(), description:C().empty(C().value('as_desc')),
          detail:C().empty(C().value('as_detail')), color
        };
        let error;
        if (row?.id) ({error}=await C().state.client.from('calendar_events').update(dbRow).eq('id',row.id));
        else {
          dbRow.id=Date.now();
          dbRow.source_order=await C().nextSourceOrder('calendar_events');
          ({error}=await C().state.client.from('calendar_events').insert(dbRow));
        }
        if (error) throw error;
        C().toast('일정을 저장했습니다.');
        await refresh(startDate);
      },
      onDelete: row?.id ? async () => {
        const {error}=await C().state.client.from('calendar_events').delete().eq('id',row.id);
        if (error) throw error;
        await C().audit('delete','calendar_events',row.id,{start_date:row.startDate,person:row.person});
        C().toast('일정을 삭제했습니다.');
        await refresh(startDate);
      } : null,
      deleteConfirm:'이 일정을 삭제할까요?'
    });
  }

  // 휴방은 날짜 하나에 여러 명을 체크 목록으로 한 번에 정한다.
  // 선택지는 활동 중인 멤버(퇴단일 없음)만. 그날 이미 휴방으로 등록된 사람은 퇴단했어도 남겨 둔다.
  function offAirChecklist(date) {
    const current = new Set(calOffAirForDate(date));
    const members = (C().state.members || []).filter(m => m.soop_id && (!m.left_date || current.has(m.soop_id)));
    if (!members.length) return '<p class="admin-help">선택할 수 있는 멤버가 없습니다.</p>';
    return members.map(m => `<label class="admin-pick-item"><input type="checkbox" value="${C().esc(m.soop_id)}"${current.has(m.soop_id)?' checked':''}><span>${C().esc(m.name || m.nickname || m.soop_id)}</span></label>`).join('');
  }

  function openOffAir(date) {
    let shownDate = date || calSelectedDateStr || calTodayStr();
    C().openDrawer({
      eyebrow:'OFF AIR',
      title:'휴방 관리',
      html: `
        ${C().field('날짜', C().input('ao_date', shownDate,'date','required'))}
        <div class="admin-field"><span>휴방 멤버 <em class="admin-pick-count" id="ao_count"></em></span>
          <div class="admin-pick-grid" id="ao_members">${offAirChecklist(shownDate)}</div>
        </div>
        <p class="admin-help">체크한 멤버가 그날 휴방으로 표시됩니다. 체크를 풀면 휴방에서 빠집니다.</p>
      `,
      onSubmit: async () => {
        const offDate = C().value('ao_date');
        if (!offDate) throw new Error('날짜를 선택하세요.');
        const before = new Set(calOffAirForDate(offDate));
        const after = new Set([...document.querySelectorAll('#ao_members input:checked')].map(x => x.value));
        const add = [...after].filter(id => !before.has(id));
        const remove = [...before].filter(id => !after.has(id));
        if (!add.length && !remove.length) throw new Error('바뀐 내용이 없습니다.');
        if (remove.length) {
          const {error} = await C().state.client.from('calendar_off_air').delete().eq('off_date',offDate).in('soop_id',remove);
          if (error) throw error;
          await C().audit('delete','calendar_off_air',`${offDate}:${remove.join(',')}`,{});
        }
        if (add.length) {
          const start = await C().nextSourceOrder('calendar_off_air');
          const {error} = await C().state.client.from('calendar_off_air').upsert(
            add.map((soop_id,i) => ({off_date:offDate, soop_id, source_order:start+i})), {onConflict:'off_date,soop_id'});
          if (error) throw error;
        }
        C().toast(`휴방을 저장했습니다. (추가 ${add.length} · 삭제 ${remove.length})`);
        await refresh(offDate);
      }
    });
    const list = document.getElementById('ao_members');
    const count = () => { const el=document.getElementById('ao_count'); if (el) el.textContent = `${list.querySelectorAll('input:checked').length}명`; };
    count();
    list?.addEventListener('change', count);
    document.getElementById('ao_date')?.addEventListener('change', ev => {
      const d = ev.target.value; if (!d || d === shownDate) return;
      shownDate = d; list.innerHTML = offAirChecklist(d); count();
    });
  }

  async function init() {
    if (document.body.dataset.adminPage !== 'schedule') return;
    await C().loadMembers();
    const publicOffAirExtra = window.calOffAirExtra;
    window.calCardExtra = item => C().state.editMode
      ? `<button type="button" class="admin-inline-edit" data-admin-event-id="${C().esc(item.id)}">수정</button>` : '';
    window.calOffAirExtra = (date,type) => {
      const publicHtml = typeof publicOffAirExtra === 'function' ? publicOffAirExtra(date,type) : '';
      const addHtml = C().state.editMode && type === 'selected'
        ? `<button type="button" class="admin-inline-add" data-admin-offair-add="${C().esc(date)}">휴방 관리</button>` : '';
      return publicHtml + addHtml;
    };
    document.addEventListener('click', ev => {
      if (!C().state.editMode) return;
      const edit = ev.target.closest('[data-admin-event-id]');
      if (edit) {
        ev.preventDefault(); ev.stopPropagation();
        const row=(typeof calEvents!=='undefined'?calEvents:[]).find(x=>String(x.id)===String(edit.dataset.adminEventId));
        if (row) openEvent(row, row.startDate);
        return;
      }
      const off = ev.target.closest('.cal-offair-chip[data-offair-date][data-soop-id]');
      if (off) {
        ev.preventDefault(); ev.stopPropagation();
        openOffAir(off.dataset.offairDate);
        return;
      }
      const addOff = ev.target.closest('[data-admin-offair-add]');
      if (addOff) {
        ev.preventDefault(); ev.stopPropagation();
        openOffAir(addOff.dataset.adminOffairAdd);
        return;
      }
      const cell = ev.target.closest('.cal-day-cell[data-date]');
      if (cell && !ev.target.closest('.cal-cell-event')) {
        setTimeout(()=>openEvent(null,cell.dataset.date),0);
      }
    }, true);
    if (typeof calRenderSelectedDateSchedules === 'function') calRenderSelectedDateSchedules();
    if (typeof calRenderTodaySchedules === 'function') calRenderTodaySchedules();
  }
  document.addEventListener('admin:ready', init);
}());
