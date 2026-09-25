(function () {
  'use strict';
  const C=()=>window.AdminCore;
  let rows=[];
  let people=null;   // 티어표 선수(연결용): {id,nickname,soop_id,tier}
  async function loadPeople(){
    if(people)return people;
    people=await fetchAllPages((from,to)=>C().state.client.from('tier_members').select('id,nickname,soop_id,tier').order('id').range(from,to));
    return people;
  }
  const low=v=>String(v||'').trim().toLowerCase();
  // 연동 기준은 SOOP ID(DB 트리거가 같은 SOOP ID의 티어표 선수에 잇는다). 창에는 연동 상태만 보여준다.
  function linkStatus(list,soop){
    if(!low(soop))return 'SOOP ID를 적으면 같은 SOOP ID의 티어표 선수와 연동됩니다';
    const p=list.find(x=>low(x.soop_id)===low(soop));
    return p?`티어표 연동: <b>${C().esc(p.nickname)}</b>${p.tier?` · ${C().esc(p.tier)}${/^\d$/.test(p.tier)?'티어':''}`:''} (SOOP ID·생년월일·성별·지금 티어는 티어표 값을 씁니다)`
      :'이 SOOP ID는 티어표에 없어 연동되지 않습니다(여기 적은 값을 그대로 씁니다)';
  }

  function toPublic(r){
    return {
      '이름':r.nickname||r.name||'','닉네임':r.nickname||r.name||'','SOOP ID':r.soop_id||'','ELO ID':r.elo_id??'',
      '직책':r.role||'','티어':r.tier||'','입단 티어':r.join_tier||'','종족':r.race||'','성별':normalizeGender(r.gender),
      '생년월일':r.birth_date||'','MBTI':r.mbti||'','YouTube':r.youtube_url||'','입단일':r.joined_date||'','퇴단일':r.left_date||'','프로필 사진':r.avatar_path||''
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

  // 비워 두면 null. "@핸들"은 채널 주소로 바꾸고, 유튜브 주소가 아니면 저장하지 않는다.
  function youtubeUrl(value){
    const raw=String(value||'').trim();
    if(!raw)return null;
    if(/^@[\w.\-]+$/.test(raw))return 'https://www.youtube.com/'+raw;
    let url;
    try{url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);}catch(e){throw new Error('YouTube 주소 형식이 올바르지 않습니다');}
    const host=url.hostname.toLowerCase().replace(/^(www|m)\./,'');
    if(host!=='youtube.com'&&host!=='youtu.be')throw new Error('YouTube 칸에는 youtube.com 주소나 @핸들만 넣을 수 있습니다');
    url.protocol='https:';
    return url.href;
  }

  function normalizeGender(value){
    const raw=String(value||'').trim();
    const upper=raw.toUpperCase();
    if(['남','남성','남자'].includes(raw)||['M','MALE'].includes(upper))return '남자';
    if(['여','여성','여자'].includes(raw)||['F','FEMALE'].includes(upper))return '여자';
    return raw;
  }

  async function open(row){
    row=row||{};
    const list=await loadPeople().catch(()=>[]);
    C().openDrawer({
      eyebrow:'MEMBER',title:row.id?'멤버 수정':'멤버 추가',
      html:`
        <div class="admin-form-grid">
          ${C().field('이름',C().input('am_name',row.name||'','text','required'))}
          ${C().field('닉네임',C().input('am_nick',row.nickname||'','text','required'))}
          ${C().field('SOOP ID',C().input('am_soop',row.soop_id||''))}
          ${C().field('ELO ID(전적 분석 버튼용)',C().input('am_elo',row.elo_id??'','number','min="1" placeholder="비우면 전적 분석 버튼 없음"'))}
          ${C().field('직책',C().input('am_role',row.role||''))}
          ${C().field('티어(지금)',C().input('am_tier',row.tier||''))}
          ${C().field('입단 티어',C().input('am_join_tier',row.join_tier||''))}
          ${C().field('종족',`<select class="admin-input" id="am_race">${opts(['','테란','저그','프로토스'],row.race)}</select>`)}
          ${C().field('성별',`<select class="admin-input" id="am_gender">${opts(['','남자','여자'],normalizeGender(row.gender))}</select>`)}
          ${C().field('생년월일',C().input('am_birth',row.birth_date||'','date'))}
          ${C().field('MBTI',C().input('am_mbti',row.mbti||'','text','maxlength="8"'))}
          ${C().field('입단일',C().input('am_joined',row.joined_date||'','date'))}
          ${C().field('퇴단일',C().input('am_left',row.left_date||'','date'))}
          ${C().field('YouTube',C().input('am_youtube',row.youtube_url||'','text','placeholder="https://www.youtube.com/@채널 또는 @핸들"'))}
        </div>
        <p class="admin-help" id="am_link">${linkStatus(list,row.soop_id)}</p>
        <p class="admin-help">닉네임·종족·입단 티어·직책·입단일·퇴단일·ELO ID는 이 입단 기록의 값입니다</p>
        <p class="admin-help">활동 상태는 별도 필드 없이 퇴단일 유무로 판단합니다. 일반적인 운영에서는 삭제 대신 퇴단일을 입력하세요</p>
        <div class="admin-preview-row"><div><b>현재 프로필</b><div class="admin-media-preview">${row.avatar_path?`<img src="${C().esc(C().mediaUrl(row.avatar_path))}" alt="">`:''}</div></div></div>
        ${C().field('프로필 사진',`<input class="admin-input" id="am_avatar" type="file" accept="image/*">`)}
      `,
      onSubmit:async()=>{
        const payload={
          name:C().value('am_name').trim(),nickname:C().value('am_nick').trim(),soop_id:C().empty(C().value('am_soop')),
          elo_id:C().intOrNull(C().value('am_elo')),role:C().empty(C().value('am_role')),tier:C().empty(C().value('am_tier')),
          join_tier:C().empty(C().value('am_join_tier')),race:C().empty(C().value('am_race')),gender:C().empty(C().value('am_gender')),
          birth_date:C().empty(C().value('am_birth')),mbti:C().empty(C().value('am_mbti')),joined_date:C().empty(C().value('am_joined')),
          left_date:C().empty(C().value('am_left')),youtube_url:youtubeUrl(C().value('am_youtube')),avatar_path:row.avatar_path||null
        };

        if(!payload.name||!payload.nickname)throw new Error('이름과 닉네임은 필수입니다');
        const file=document.getElementById('am_avatar')?.files?.[0];
        if(file)payload.avatar_path=await C().uploadMedia(file,'members',payload.soop_id||payload.nickname);
        let error;
        if(row.id)({error}=await C().state.client.from('members').update(payload).eq('id',row.id));
        else{
          payload.source_order=await C().nextSourceOrder('members');
          ({error}=await C().state.client.from('members').insert(payload));
        }
        if(error)throw error;
        C().toast('멤버를 저장했습니다');
        await load();
      },
      onDelete:row.id?async()=>{
        const {count,error:countErr}=await C().state.client.from('rounds').select('*',{head:true,count:'exact'}).ilike('our_player',row.nickname||row.name||'');
        if(countErr)throw countErr;
        if(Number(count||0)>0&&!confirm(`이 멤버 이름이 연결된 세트가 ${count}개 있습니다. 그래도 실제 삭제할까요?`))return;
        const {error}=await C().state.client.from('members').delete().eq('id',row.id);
        if(error)throw error;
        await C().audit('delete','members',row.id,{name:row.name,linked_rounds:count||0});
        C().toast('멤버를 삭제했습니다');
        await load();
      }:null,
      deleteConfirm:'멤버 삭제는 연결 데이터에 영향을 줄 수 있습니다. 계속할까요?'
    });
    const soopEl=document.getElementById('am_soop'),linkEl=document.getElementById('am_link');
    if(soopEl&&linkEl)soopEl.addEventListener('input',()=>{linkEl.innerHTML=linkStatus(list,soopEl.value);});
  }

  async function init(){
    if(document.body.dataset.adminPage!=='members')return;
    await load();
    const container=document.getElementById('members-groups');
    if(container&&!document.getElementById('adminMemberAdd')){
      const b=document.createElement('button');b.id='adminMemberAdd';b.type='button';b.className='admin-floating-add';b.dataset.icon='plus';b.textContent='멤버 추가';b.onclick=()=>open(null);
      container.parentElement?.prepend(b);
    }
    document.addEventListener('click',ev=>{
      if(!C().state.editMode)return;
      const card=ev.target.closest('.member-card[data-member]');
      if(!card)return;
      ev.preventDefault();ev.stopPropagation();
      const name=card.dataset.member;
      const row=rows.find(r=>r.nickname===name)||rows.find(r=>r.name===name);
      if(row)open(row);
    },true);
  }
  document.addEventListener('admin:ready',init);
}());
