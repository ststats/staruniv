(function () {
  'use strict';
  const C=()=>window.AdminCore;
  let rows=[];

  function toPublic(r){
    return {
      '이름':r.name||r.nickname||'','닉네임':r.nickname||r.name||'','SOOP ID':r.soop_id||'','ELO ID':r.elo_id??'',
      '직책':r.role||'','티어':r.tier||'','입단 티어':r.join_tier||'','종족':r.race||'','성별':r.gender||'',
      '생년월일':r.birth_date||'','MBTI':r.mbti||'','입단일':r.joined_date||'','퇴단일':r.left_date||'','프로필 사진':r.avatar_path||''
    };
  }

  async function load(){
    rows=await C().loadMembers(true);
    if(typeof SiteData!=='undefined'){
      SiteData.members=rows.map(toPublic);
      if(typeof renderMembersPage==='function') await renderMembersPage();
    }
  }

  function opts(values,selected){
    return values.map(v=>`<option value="${C().esc(v)}"${String(v)===String(selected||'')?' selected':''}>${C().esc(v||'선택')}</option>`).join('');
  }

  function open(row){
    row=row||{};
    C().openDrawer({
      eyebrow:'MEMBER',title:row.id?'멤버 수정':'멤버 추가',
      html:`
        <div class="admin-form-grid">
          ${C().field('이름',C().input('am_name',row.name||'','text','required'))}
          ${C().field('닉네임',C().input('am_nick',row.nickname||'','text','required'))}
          ${C().field('SOOP ID',C().input('am_soop',row.soop_id||''))}
          ${C().field('ELO ID',C().input('am_elo',row.elo_id??'','number','min="1"'))}
          ${C().field('직책',C().input('am_role',row.role||''))}
          ${C().field('티어',C().input('am_tier',row.tier||''))}
          ${C().field('입단 티어',C().input('am_join_tier',row.join_tier||''))}
          ${C().field('종족',`<select class="admin-input" id="am_race">${opts(['','테란','저그','프로토스'],row.race)}</select>`)}
          ${C().field('성별',`<select class="admin-input" id="am_gender">${opts(['','남','여'],row.gender)}</select>`)}
          ${C().field('생년월일',C().input('am_birth',row.birth_date||'','date'))}
          ${C().field('MBTI',C().input('am_mbti',row.mbti||'','text','maxlength="8"'))}
          ${C().field('입단일',C().input('am_joined',row.joined_date||'','date'))}
          ${C().field('퇴단일',C().input('am_left',row.left_date||'','date'))}
        </div>
        <p class="admin-help">활동 상태는 별도 필드 없이 퇴단일 유무로 판단합니다. 일반적인 운영에서는 삭제 대신 퇴단일을 입력하세요.</p>
        <div class="admin-preview-row"><div><b>현재 프로필</b><div class="admin-media-preview">${row.avatar_path?`<img src="${C().esc(C().mediaUrl(row.avatar_path))}" alt="">`:''}</div></div></div>
        ${C().field('프로필 사진',`<input class="admin-input" id="am_avatar" type="file" accept="image/*">`)}
      `,
      onSubmit:async()=>{
        const payload={
          name:C().value('am_name').trim(),nickname:C().value('am_nick').trim(),soop_id:C().empty(C().value('am_soop')),
          elo_id:C().intOrNull(C().value('am_elo')),role:C().empty(C().value('am_role')),tier:C().empty(C().value('am_tier')),
          join_tier:C().empty(C().value('am_join_tier')),race:C().empty(C().value('am_race')),gender:C().empty(C().value('am_gender')),
          birth_date:C().empty(C().value('am_birth')),mbti:C().empty(C().value('am_mbti')),joined_date:C().empty(C().value('am_joined')),
          left_date:C().empty(C().value('am_left')),avatar_path:row.avatar_path||null
        };
        if(!payload.name||!payload.nickname)throw new Error('이름과 닉네임은 필수입니다.');
        const file=document.getElementById('am_avatar')?.files?.[0];
        if(file)payload.avatar_path=await C().uploadMedia(file,'members',payload.soop_id||payload.nickname);
        let error;
        if(row.id)({error}=await C().state.client.from('members').update(payload).eq('id',row.id));
        else{
          payload.source_order=await C().nextSourceOrder('members');
          ({error}=await C().state.client.from('members').insert(payload));
        }
        if(error)throw error;
        C().toast('멤버를 저장했습니다.');
        await load();
      },
      onDelete:row.id?async()=>{
        const {count,error:countErr}=await C().state.client.from('rounds').select('*',{head:true,count:'exact'}).ilike('our_player',row.name||row.nickname||'');
        if(countErr)throw countErr;
        if(Number(count||0)>0&&!confirm(`이 멤버 이름이 연결된 세트가 ${count}개 있습니다. 그래도 실제 삭제할까요?`))return;
        const {error}=await C().state.client.from('members').delete().eq('id',row.id);
        if(error)throw error;
        await C().audit('delete','members',row.id,{name:row.name,linked_rounds:count||0});
        C().toast('멤버를 삭제했습니다.');
        await load();
      }:null,
      deleteConfirm:'멤버 삭제는 연결 데이터에 영향을 줄 수 있습니다. 계속할까요?'
    });
  }

  async function init(){
    if(document.body.dataset.adminPage!=='members')return;
    await load();
    const container=document.getElementById('members-groups');
    if(container&&!document.getElementById('adminMemberAdd')){
      const b=document.createElement('button');b.id='adminMemberAdd';b.type='button';b.className='admin-floating-add';b.textContent='+ 멤버 추가';b.onclick=()=>open(null);
      container.parentElement?.prepend(b);
    }
    document.addEventListener('click',ev=>{
      if(!C().state.editMode)return;
      const card=ev.target.closest('.member-card[data-member]');
      if(!card)return;
      ev.preventDefault();ev.stopPropagation();
      const name=card.dataset.member;
      const row=rows.find(r=>r.name===name||r.nickname===name);
      if(row)open(row);
    },true);
  }
  document.addEventListener('admin:ready',init);
}());
