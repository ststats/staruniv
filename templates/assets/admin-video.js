(function () {
  'use strict';
  const C=()=>window.AdminCore;
  let channels=[],videos=[],picks=[];

  function youtubeId(url){
    const s=String(url||'').trim();
    if(/^[A-Za-z0-9_-]{11}$/.test(s))return s;
    return (s.match(/(?:youtu\.be\/|v=|shorts\/)([A-Za-z0-9_-]{11})/)||[])[1]||'';
  }
  function soopId(url){
    const s=String(url||'').trim();
    const n=(s.match(/(?:vod|player)\/?(\d{1,20})/)||s.match(/(\d{5,20})/ )||[])[1];
    return n?`soop:${n}`:'';
  }
  function pickUrl(row){
    return row.kind==='soop'
      ? (String(row.id||'').replace(/^soop:/,'') ? `https://vod.sooplive.co.kr/player/${String(row.id).replace(/^soop:/,'')}` : '')
      : (row.id?`https://www.youtube.com/watch?v=${row.id}`:'');
  }

  async function fetchAll(){
    const [ch,v,p]=await Promise.all([
      C().state.client.from('video_channels').select('*').order('source_order'),
      C().state.client.from('videos').select('*').order('published',{ascending:false}).limit(3000),
      C().state.client.from('video_picks').select('*').order('source_order')
    ]);
    const error=ch.error||v.error||p.error;if(error)throw error;
    channels=ch.data||[];videos=v.data||[];picks=p.data||[];
  }

  function syncRenderer(){
    if(typeof VideoState==='undefined')return;
    const map={};
    channels.forEach(ch=>map[ch.channel_url]={id:ch.channel_id||'',title:ch.title||'',name:ch.display_name||ch.title||'',thumb:ch.thumb||'',url:ch.channel_url,uploads:ch.uploads||'',active:!!ch.active});
    VideoState.data={
      channels:map,
      videos:videos.filter(v=>!!map[v.channel_url]).map(v=>({id:v.id,channel:v.channel_url,title:v.title,published:v.published,thumb:v.thumb,views:Number(v.views)||0,short:!!v.short,hidden:!!v.hidden})),
      picks:picks.map(v=>({id:v.id,kind:v.kind,title:v.title,note:v.note||'',group:v.group_name||'',groupEn:v.group_en||'',addedAt:v.added_at||'',author:v.author||'',thumb:v.thumb||'',short:!!v.short,hidden:!!v.hidden,source_order:v.source_order}))
    };
    VideoState.channelKeys=Object.keys(map);
    VideoState.byId=new Map();
    [...VideoState.data.videos,...VideoState.data.picks].forEach(v=>VideoState.byId.set(v.id,v));
    renderVideoChannels();renderFantube();renderPicks();
    requestAnimationFrame(()=>{
      document.querySelectorAll('.video-card[data-video-id]').forEach(card=>{
        const id=card.dataset.videoId, isPick=card.dataset.videoPick==='1';
        const row=isPick?picks.find(x=>String(x.id)===id):videos.find(x=>String(x.id)===id);
        card.classList.toggle('admin-config-hidden',!!row?.hidden);
      });
    });
  }

  async function refresh(){await fetchAll();syncRenderer();}

  function openChannel(row){
    row=row||{};
    C().openDrawer({
      eyebrow:'CHANNEL',title:row.channel_url?'팬튜브 채널 수정':'팬튜브 채널 추가',
      html:`
        ${C().field('채널 URL',C().input('avc_url',row.channel_url||'','url','required'))}
        ${C().field('표시 이름',C().input('avc_name',row.display_name||row.title||'','text','required'))}
        <div class="admin-form-grid">
          ${C().field('표시 순서',C().input('avc_order',row.source_order??'','number','min="0"'))}
          ${C().field('사용 여부',C().checkbox('avc_active',row.channel_url?!!row.active:true,'사용'))}
        </div>`,
      onSubmit:async()=>{
        const url=C().value('avc_url').trim();if(!/^https?:\/\//i.test(url))throw new Error('올바른 채널 URL을 입력하세요');
        const payload={channel_url:url,display_name:C().value('avc_name').trim(),source_order:Number(C().value('avc_order')||await C().nextSourceOrder('video_channels')),active:!!document.getElementById('avc_active')?.checked,updated_at:new Date().toISOString()};
        if(row.channel_url&&row.channel_url!==url){
          const {error:del}=await C().state.client.from('video_channels').delete().eq('channel_url',row.channel_url);if(del)throw del;
        }
        const {error}=await C().state.client.from('video_channels').upsert({...row,...payload},{onConflict:'channel_url'});if(error)throw error;
        C().toast('채널을 저장했습니다');await refresh();
      }
    });
  }

  function openChannelList(){
    C().openDrawer({
      eyebrow:'CHANNELS',title:'팬튜브 채널',
      html:`<button type="button" class="admin-btn primary" id="avc_add">+ 채널 추가</button>
        <div class="admin-list">${channels.map((r,i)=>`<button type="button" class="admin-list-row" data-channel-index="${i}"><b>${C().esc(r.display_name||r.title||r.channel_url)}</b><span>${r.active?'사용':'중지'} · ${r.source_order}</span></button>`).join('')}</div>`,
      onSubmit:async()=>{}
    });
    document.getElementById('adminDrawerSave').hidden=true;
    document.getElementById('avc_add').onclick=()=>openChannel(null);
    document.querySelectorAll('[data-channel-index]').forEach(b=>b.onclick=()=>openChannel(channels[Number(b.dataset.channelIndex)]));
  }

  async function toggleHidden(id,hidden){
    const {error}=await C().state.client.from('videos').update({hidden}).eq('id',id);if(error)throw error;
    C().toast(hidden?'영상을 숨겼습니다':'영상을 표시했습니다');await refresh();
  }

  function openPick(row){
    row=row||{kind:'youtube',title:'',note:'',group_name:'',author:'',thumb:'',added_at:new Date().toISOString().slice(0,10),source_order:'',short:false,hidden:false};
    C().openDrawer({
      eyebrow:'PICK',title:row.id?'보자 영상 수정':'보자 영상 추가',
      html:`
        ${C().field('YouTube 또는 SOOP URL',C().input('avp_url',row.id?pickUrl(row):'','url','required'))}
        ${C().field('제목',C().input('avp_title',row.title||'','text','required'))}
        ${C().field('설명',C().textarea('avp_note',row.note||'','rows="3"'))}
        <div class="admin-form-grid">
          ${C().field('분류',C().input('avp_group',row.group_name||''))}
          ${C().field('작성자',C().input('avp_author',row.author||''))}
          ${C().field('등록일',C().input('avp_date',row.added_at||'','date'))}
          ${C().field('표시 순서',C().input('avp_order',row.source_order??'','number','min="0"'))}
        </div>
        ${C().field('썸네일',C().input('avp_thumb',row.thumb||'','url'))}
        <div class="admin-form-grid">${C().field('쇼츠',C().checkbox('avp_short',!!row.short,'쇼츠'))}${C().field('숨김',C().checkbox('avp_hidden',!!row.hidden,'숨김'))}</div>
        <div class="admin-media-preview" id="avp_preview">${row.thumb?`<img src="${C().esc(row.thumb)}" alt="">`:''}</div>`,
      onSubmit:async()=>{
        const url=C().value('avp_url').trim();const y=youtubeId(url),s=soopId(url);if(!y&&!s)throw new Error('지원하는 YouTube 또는 SOOP URL이 아닙니다');
        const id=y||s,kind=y?'youtube':'soop';
        const payload={id,kind,title:C().value('avp_title').trim(),note:C().empty(C().value('avp_note')),group_name:C().empty(C().value('avp_group')),group_en:null,author:C().empty(C().value('avp_author')),thumb:C().empty(C().value('avp_thumb')),added_at:C().empty(C().value('avp_date')),source_order:Number(C().value('avp_order')||await C().nextSourceOrder('video_picks')),short:!!document.getElementById('avp_short')?.checked,hidden:!!document.getElementById('avp_hidden')?.checked,updated_at:new Date().toISOString()};
        if(row.id&&row.id!==id){const {error:del}=await C().state.client.from('video_picks').delete().eq('id',row.id);if(del)throw del;}
        const {error}=await C().state.client.from('video_picks').upsert(payload,{onConflict:'id'});if(error)throw error;
        C().toast('보자 영상을 저장했습니다');await refresh();
      },
      onDelete:row.id?async()=>{const {error}=await C().state.client.from('video_picks').delete().eq('id',row.id);if(error)throw error;await C().audit('delete','video_picks',row.id,{title:row.title});await refresh();}:null
    });
    document.getElementById('avp_thumb')?.addEventListener('input',ev=>{document.getElementById('avp_preview').innerHTML=ev.target.value?`<img src="${C().esc(ev.target.value)}" alt="">`:'';});
  }

  async function init(){
    if(document.body.dataset.adminPage!=='video')return;
    window.videoCardAdminExtra=(v,opts)=>{
      if(!C().state.editMode)return '';
      const row=opts?.pick?picks.find(x=>String(x.id)===String(v.id)):videos.find(x=>String(x.id)===String(v.id));
      if(opts?.pick)return `<button type="button" class="admin-card-action" data-admin-pick="${C().esc(v.id)}">편집</button>`;
      return `<button type="button" class="admin-card-action" data-admin-video-toggle="${C().esc(v.id)}">${row?.hidden?'표시':'숨김'}</button>`;
    };
    await refresh();
    if(document.getElementById('video-channel-row'))C().addPageTool({id:'adminVideoChannels',label:'팬튜브 채널 관리',icon:'edit',onClick:openChannelList});
    if(document.getElementById('view-video-pick'))C().addPageTool({id:'adminVideoPickAdd',label:'보자 영상 추가',icon:'plus',onClick:()=>openPick(null)});
    document.addEventListener('click',ev=>{
      const p=ev.target.closest('[data-admin-pick]');if(p){ev.preventDefault();ev.stopPropagation();openPick(picks.find(x=>String(x.id)===p.dataset.adminPick));return;}
      const v=ev.target.closest('[data-admin-video-toggle]');if(v){ev.preventDefault();ev.stopPropagation();const r=videos.find(x=>String(x.id)===v.dataset.adminVideoToggle);toggleHidden(r.id,!r.hidden).catch(e=>C().toast(C().errorText(e),'error'));}
    },true);
  }
  document.addEventListener('admin:ready',init);
}());
