(function () {
  'use strict';
  const C=()=>window.AdminCore;
  let rows=[];

  function normalize(item) {
    return {
      id:item.id, entry_kind:item.entry_kind||'manual', date:item.event_date||'', type:item.event_type||'event',
      title:item.title||'', desc:item.description||'', members:Array.isArray(item.members)?item.members:[],
      youtube:item.youtube_url||'', image:item.image_path||'', order:item.sort_order??0, hidden:!!item.hidden
    };
  }

  async function load() {
    const {data,error}=await C().state.client.from('history_entries').select('*')
      .order('event_date',{ascending:false,nullsFirst:false}).order('sort_order');
    if(error) throw error;
    rows=(data||[]).map(normalize);
    await render();
  }

  async function render() {
    const root=document.getElementById('history-root');
    if(!root) return;
    const data=await histLoadData();
    const merged=histMergeItems(data, SiteData.members, true);
    histRegisterItems(merged);
    histRenderTypeBar(merged);
    window.histRedraw=render;
    root.innerHTML=histTimelineHtml(histFilterItems(merged),{members:SiteData.members,avatarUrl:getProfileImgUrl,admin:true});
    // 연혁 추가는 페이지 관리 상자(서브탭 편집과 같은 상자)에 한 번만 붙인다
    C().addPageTool({id:'adminHistoryAdd',label:'연혁 추가',icon:'plus',onClick:()=>open(null)});
  }

  function participantRows(selected,locked) {
    const rows=(selected||[]).map(entry=>{
      const parsed=typeof histParseMember==='function'?histParseMember(entry):{name:String(entry||''),note:''};
      return {name:parsed.name||'',note:parsed.note||''};
    });
    if(!rows.length&&!locked) rows.push({name:'',note:''});
    return `
      <div class="admin-participants${locked?' is-locked':''}" id="ahParticipants">
        ${rows.map((r,i)=>participantRowHtml(r,i,locked)).join('')}
      </div>
      <div class="admin-participant-tools">
        ${locked?'':'<button type="button" class="admin-btn admin-btn-compact" id="ahAddParticipant">참여 인원 추가</button>'}
        <span class="admin-help">${locked
          ?'자동 항목의 인원은 멤버 데이터(입단일·퇴단일)로 정해집니다. 이름 뒤 괄호 설명만 붙일 수 있습니다'
          :'멤버가 아니어도 직접 입력할 수 있고, 설명은 이름 뒤 괄호로 표시됩니다'}</span>
      </div>`;
  }

  function participantRowHtml(row,index,locked) {
    return `<div class="admin-participant-row" data-participant-row>
      <input class="admin-input" name="ah_member_name" value="${C().esc(row.name||'')}" placeholder="이름" list="ahMemberNames" aria-label="참여 인원 이름"${locked?' readonly':''}>
      <input class="admin-input" name="ah_member_note" value="${C().esc(row.note||'')}" placeholder="설명 (예: 게스트, 코치)" aria-label="참여 인원 설명">
      ${locked?'<span></span>':'<button type="button" class="admin-icon-btn" data-remove-participant aria-label="참여 인원 삭제">×</button>'}
    </div>`;
  }

  // 형식: 공개 화면 뱃지(HISTORY_TYPES · .hist-type-*)와 같은 이름·색으로 고른다
  const TYPE_ORDER=['founding','join','leave','match','event','broadcast','other'];
  function typePicker(selected){
    const labels=(typeof HISTORY_TYPES==='object'&&HISTORY_TYPES)||{};
    const key=TYPE_ORDER.includes(selected)?selected:'event';
    return `<div class="admin-type-grid">${TYPE_ORDER.map(t=>
      `<label class="admin-type-option"><input type="radio" name="ah_type" value="${t}"${t===key?' checked':''}><span class="admin-type-dot admin-type-${t}"></span><b>${C().esc(labels[t]||t)}</b></label>`).join('')}</div>`;
  }

  function collectParticipants() {
    return [...document.querySelectorAll('#ahParticipants [data-participant-row]')].map(row=>{
      const name=row.querySelector('[name="ah_member_name"]')?.value.trim()||'';
      const note=row.querySelector('[name="ah_member_note"]')?.value.trim()||'';
      if(!name) return '';
      return typeof histFormatMember==='function' ? histFormatMember(name,note) : (note?`${name}(${note})`:name);
    }).filter(Boolean);
  }

  function bindParticipantEditor() {
    const box=document.getElementById('ahParticipants');
    const add=document.getElementById('ahAddParticipant');
    const datalist=document.createElement('datalist');
    datalist.id='ahMemberNames';
    datalist.innerHTML=(C().state.members||[]).map(m=>`<option value="${C().esc(m.nickname||m.name||'')}"></option>`).join('');
    box?.after(datalist);
    const bindRemove=()=>box?.querySelectorAll('[data-remove-participant]').forEach(btn=>{
      btn.onclick=()=>{
        const rows=box.querySelectorAll('[data-participant-row]');
        if(rows.length===1){
          rows[0].querySelectorAll('input').forEach(x=>x.value='');
          C().markDirty(true);
          return;
        }
        btn.closest('[data-participant-row]')?.remove();
        C().markDirty(true);
      };
    });
    add?.addEventListener('click',()=>{
      box?.insertAdjacentHTML('beforeend',participantRowHtml({name:'',note:''},box.querySelectorAll('[data-participant-row]').length));
      bindRemove();
      box?.lastElementChild?.querySelector('input')?.focus();
      C().markDirty(true);
    });
    bindRemove();
  }

  function open(row) {
    if(row&&row.auto)return openAuto(row);
    row=row||{entry_kind:'manual',date:'',type:'event',title:'',desc:'',members:[],youtube:'',image:'',order:0,hidden:false};
    C().openDrawer({
      eyebrow:'HISTORY', title:row.id?'연혁 수정':'연혁 추가',
      html:`
        <div class="admin-form-grid">
          ${C().field('날짜',C().input('ah_date',row.date,'date','required'))}
          ${C().field('숨김',C().checkbox('ah_hidden',row.hidden,'공개 화면에서 숨김'))}
        </div>
        <div class="admin-field"><span>형식</span>${typePicker(row.type)}</div>
        ${C().field('제목',C().input('ah_title',row.title,'text','required maxlength="120"'))}
        ${C().field('설명',C().textarea('ah_desc',row.desc,'rows="4"'))}
        <div class="admin-field"><span>참여 인원</span>${participantRows(row.members)}</div>
        ${C().field('YouTube 링크',C().input('ah_youtube',row.youtube,'url','placeholder="https://..."'))}
        <div class="admin-preview-row">
          <div><b>YouTube 미리보기</b><div id="ahYoutubePreview" class="admin-media-preview"></div></div>
          <div><b>사진 미리보기</b><div id="ahImagePreview" class="admin-media-preview">${row.image?`<img src="${C().esc(C().mediaUrl(row.image)||row.image)}" alt="">`:''}</div></div>
        </div>
        ${C().field('사진',`<input class="admin-input" id="ah_image" type="file" accept="image/*">`)}
      `,
      onSubmit:async()=>{
        const id=row.id||`h-${Date.now().toString(36)}`;
        let image=row.image||null;
        const file=document.getElementById('ah_image')?.files?.[0];
        if(file) image=await C().uploadMedia(file,'history',id);
        const eventDate=C().value('ah_date');
        // 같은 날 안의 순서는 카드의 ▲▼로 정한다. 기존 항목은 날짜가 그대로면 자리를 지키고,
        // 새 항목이거나 날짜를 옮긴 항목은 그날의 맨 뒤에 붙인다.
        let order=row.order;
        if(!row.id||row.date!==eventDate){
          const day=(await dayItems(eventDate)).filter(x=>String(x.id)!==String(row.id));
          order=day.length?Math.max(...day.map((x,i)=>Number.isFinite(x.ord)?x.ord:i))+1:0;
        }
        const payload={
          id,entry_kind:'manual',event_date:eventDate,event_type:document.querySelector('input[name="ah_type"]:checked')?.value||'event',
          title:C().value('ah_title').trim(),description:C().empty(C().value('ah_desc')),
          members:collectParticipants(),
          youtube_url:C().empty(C().value('ah_youtube')),image_path:image,
          sort_order:order,hidden:!!document.getElementById('ah_hidden')?.checked,
          updated_at:new Date().toISOString()
        };
        if(!payload.event_date||!payload.title) throw new Error('날짜와 제목은 필수입니다');
        const {error}=await C().state.client.from('history_entries').upsert(payload,{onConflict:'id'});
        if(error) throw error;
        C().toast('연혁을 저장했습니다');
        await load();
      },
      onDelete:row.id?async()=>{
        const {error}=await C().state.client.from('history_entries').delete().eq('id',row.id);
        if(error) throw error;
        await C().audit('delete','history_entries',row.id,{title:row.title});
        C().toast('연혁을 삭제했습니다');
        await load();
      }:null
    });
    bindParticipantEditor();
    bindMediaPreview();
  }

  function bindMediaPreview(){
    const yt=document.getElementById('ah_youtube');
    const img=document.getElementById('ah_image');
    const refreshYt=()=>{
      const id=(String(yt?.value||'').match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{6,})/)||[])[1];
      const box=document.getElementById('ahYoutubePreview');
      if(box) box.innerHTML=id?`<img src="https://i.ytimg.com/vi/${C().esc(id)}/hqdefault.jpg" alt="">`:'';
    };
    yt?.addEventListener('input',refreshYt);refreshYt();
    img?.addEventListener('change',()=>{const f=img.files?.[0],box=document.getElementById('ahImagePreview');if(f&&box)box.innerHTML=`<img src="${URL.createObjectURL(f)}" alt="">`;});
  }

  // 자동 항목(멤버 입단·퇴단 등) 편집: 날짜·형식·인원은 멤버 데이터가 정하므로 고정하고,
  // 제목·설명·인원 설명·영상·사진·숨김만 override 줄에 덮어쓴다. 예전엔 '수정'이 새 항목 추가 창을 열었다.
  function openAuto(item){
    const labels=(typeof HISTORY_TYPES==='object'&&HISTORY_TYPES)||{};
    C().openDrawer({
      eyebrow:'HISTORY · 자동', title:'자동 연혁 수정',
      html:`
        <p class="admin-help">멤버 데이터에서 자동으로 만들어진 항목입니다. 날짜·형식·인원은 멤버의 입단일·퇴단일을 따르고, 여기서는 보이는 내용만 바꿉니다</p>
        <div class="admin-form-grid">
          ${C().field('날짜',C().input('ah_date',item.date,'date','readonly'))}
          ${C().field('형식',C().input('ah_type_label',labels[item.type]||item.type,'text','readonly'))}
        </div>
        ${C().field('숨김',C().checkbox('ah_hidden',item.hidden,'공개 화면에서 숨김'))}
        ${C().field('제목',C().input('ah_title',item.title,'text','maxlength="120"'))}
        ${C().field('설명',C().textarea('ah_desc',item.desc,'rows="4"'))}
        <div class="admin-field"><span>참여 인원</span>${participantRows(item.members,true)}</div>
        ${C().field('YouTube 링크',C().input('ah_youtube',item.youtube,'url','placeholder="https://..."'))}
        <div class="admin-preview-row">
          <div><b>YouTube 미리보기</b><div id="ahYoutubePreview" class="admin-media-preview"></div></div>
          <div><b>사진 미리보기</b><div id="ahImagePreview" class="admin-media-preview">${item.image?`<img src="${C().esc(C().mediaUrl(item.image)||item.image)}" alt="">`:''}</div></div>
        </div>
        ${C().field('사진',`<input class="admin-input" id="ah_image" type="file" accept="image/*">`)}
      `,
      onSubmit:async()=>{
        let image=item.image||null;
        const file=document.getElementById('ah_image')?.files?.[0];
        if(file) image=await C().uploadMedia(file,'history',item.id);
        await saveItem(item,{
          title:C().empty(C().value('ah_title').trim()),description:C().empty(C().value('ah_desc')),
          members:collectParticipants(),youtube_url:C().empty(C().value('ah_youtube')),image_path:image,
          hidden:!!document.getElementById('ah_hidden')?.checked
        });
        C().toast('자동 연혁을 수정했습니다');
        await load();
      }
    });
    bindParticipantEditor();
    bindMediaPreview();
  }

  // 화면에 보이는 그날의 항목들(자동 항목 포함), 화면과 같은 순서
  async function dayItems(date){
    const merged=histMergeItems(await histLoadData(), SiteData.members, true);
    return merged.filter(x=>x.date===date);
  }
  // 한 항목의 같은 날 순서/숨김을 저장한다. 자동 항목(입단·퇴단 등)은 원본이 멤버 데이터라
  // 'override' 줄에 덮어쓸 값만 둔다(없는 칸은 원래 값을 그대로 쓴다).
  async function saveItem(item,fields){
    const q=C().state.client.from('history_entries');
    const now=new Date().toISOString();
    const {error}=item.auto
      ?await q.upsert({id:item.id,entry_kind:'override',event_date:item.date,...fields,updated_at:now},{onConflict:'id'})
      :await q.update({...fields,updated_at:now}).eq('id',item.id);
    if(error)throw error;
  }
  // ▲▼: 화면에 보이는 순서 그대로 옆 항목과 자리를 바꾸고, 그날 항목 전체를 0,1,2...로 다시 번호 매긴다.
  // (예전엔 DB 행끼리 sort_order 값만 맞바꿔서, 값이 모두 0이면 아무 일도 안 일어났고
  //  자동 항목은 목록에 없어 무시됐다.)
  async function move(id,dir){
    const all=histMergeItems(await histLoadData(), SiteData.members, true);
    const item=all.find(x=>String(x.id)===String(id));if(!item)return;
    const day=all.filter(x=>x.date===item.date);
    const idx=day.findIndex(x=>String(x.id)===String(id)), to=idx+dir;
    if(to<0||to>=day.length)return;
    [day[idx],day[to]]=[day[to],day[idx]];
    for(let i=0;i<day.length;i++){
      if(day[i].ord!==i)await saveItem(day[i],{sort_order:i});
    }
    await load();
  }
  async function toggle(id){
    const all=histMergeItems(await histLoadData(), SiteData.members, true);
    const item=all.find(x=>String(x.id)===String(id));if(!item)return;
    await saveItem(item,{hidden:!item.hidden});
    await load();
  }

  window.StarUnivAdminHistory={render,openNew:()=>open(null)};

  async function init(){
    if(document.body.dataset.adminPage!=='schedule')return;
    await C().loadMembers();
    window.histAdminEdit=async id=>{
      const manual=rows.find(x=>String(x.id)===String(id)&&x.entry_kind==='manual');
      if(manual)return open(manual);
      const all=histMergeItems(await histLoadData(), SiteData.members, true);
      const item=all.find(x=>String(x.id)===String(id));
      if(item)open(item);
    };
    window.histAdminRemove=id=>toggle(id);
    window.histAdminMove=(id,dir)=>move(id,dir).catch(e=>C().toast(C().errorText(e),'error'));
    await load();
  }
  document.addEventListener('admin:ready',init);
}());
