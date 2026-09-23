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
    root.innerHTML=histTimelineHtml(merged,{members:SiteData.members,avatarUrl:getProfileImgUrl,admin:true});
  }

  function memberChecks(selected) {
    const set=new Set(selected||[]);
    return `<div class="admin-member-checks">${(C().state.members||[]).map(m=>{
      const name=m.name||m.nickname;
      return `<label><input type="checkbox" name="ah_member" value="${C().esc(name)}"${set.has(name)?' checked':''}>${C().esc(name)}</label>`;
    }).join('')}</div>`;
  }

  function open(row) {
    row=row||{entry_kind:'manual',date:'',type:'event',title:'',desc:'',members:[],youtube:'',image:'',order:0,hidden:false};
    C().openDrawer({
      eyebrow:'HISTORY', title:row.id?'연혁 수정':'연혁 추가',
      html:`
        <div class="admin-form-grid">
          ${C().field('날짜',C().input('ah_date',row.date,'date','required'))}
          ${C().field('형식',C().input('ah_type',row.type,'text','placeholder="대회, 입단, 이벤트"'))}
          ${C().field('같은 날짜 내 순서',C().input('ah_order',row.order,'number','min="0"'))}
          ${C().field('숨김',C().checkbox('ah_hidden',row.hidden,'공개 화면에서 숨김'))}
        </div>
        ${C().field('제목',C().input('ah_title',row.title,'text','required maxlength="120"'))}
        ${C().field('설명',C().textarea('ah_desc',row.desc,'rows="4"'))}
        <div class="admin-field"><span>참여 인원</span>${memberChecks(row.members)}</div>
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
        const payload={
          id,entry_kind:'manual',event_date:C().value('ah_date'),event_type:C().empty(C().value('ah_type')),
          title:C().value('ah_title').trim(),description:C().empty(C().value('ah_desc')),
          members:[...document.querySelectorAll('input[name="ah_member"]:checked')].map(x=>x.value),
          youtube_url:C().empty(C().value('ah_youtube')),image_path:image,
          sort_order:Number(C().value('ah_order')||0),hidden:!!document.getElementById('ah_hidden')?.checked,
          updated_at:new Date().toISOString()
        };
        if(!payload.event_date||!payload.title) throw new Error('날짜와 제목은 필수입니다.');
        const {error}=await C().state.client.from('history_entries').upsert(payload,{onConflict:'id'});
        if(error) throw error;
        C().toast('연혁을 저장했습니다.');
        await load();
      },
      onDelete:row.id?async()=>{
        const {error}=await C().state.client.from('history_entries').delete().eq('id',row.id);
        if(error) throw error;
        await C().audit('delete','history_entries',row.id,{title:row.title});
        C().toast('연혁을 삭제했습니다.');
        await load();
      }:null
    });
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

  async function move(id,dir){
    const row=rows.find(x=>String(x.id)===String(id));if(!row)return;
    const same=rows.filter(x=>x.date===row.date).sort((a,b)=>Number(a.order)-Number(b.order));
    const idx=same.findIndex(x=>String(x.id)===String(id)), other=same[idx+dir];if(!other)return;
    const a=row.order,b=other.order;
    const r1=await C().state.client.from('history_entries').update({sort_order:b}).eq('id',row.id);
    const r2=await C().state.client.from('history_entries').update({sort_order:a}).eq('id',other.id);
    if(r1.error||r2.error)throw r1.error||r2.error;
    await load();
  }
  async function toggle(id){
    const row=rows.find(x=>String(x.id)===String(id));if(!row)return;
    const {error}=await C().state.client.from('history_entries').update({hidden:!row.hidden,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;await load();
  }

  async function init(){
    if(document.body.dataset.adminPage!=='schedule')return;
    await C().loadMembers();
    window.histAdminEdit=id=>open(rows.find(x=>String(x.id)===String(id)));
    window.histAdminRemove=id=>toggle(id);
    window.histAdminMove=(id,dir)=>move(id,dir).catch(e=>C().toast(C().errorText(e),'error'));
    const tabs=document.querySelector('.sub-tabs');
    if(tabs&&!document.getElementById('adminHistoryAdd')){
      const b=document.createElement('button');b.type='button';b.id='adminHistoryAdd';b.className='admin-inline-add admin-tab-action';b.textContent='+ 연혁';
      b.onclick=()=>open(null);tabs.appendChild(b);
    }
    await load();
  }
  document.addEventListener('admin:ready',init);
}());
