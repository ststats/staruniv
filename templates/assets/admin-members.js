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
      '생년월일':r.birth_date||'','MBTI':r.mbti||'','YouTube':r.youtube_url||'','입단일':r.joined_date||'','퇴단일':r.left_date||'','프로필 사진':r.avatar_path||'','대표 사진':r.photo_path||''
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

  // 대표 영상 자동 편집: 올린 영상을 브라우저에서 1280×720(16:9, 가운데 기준으로 잘라 맞춤) · 30fps ·
  // 소리 없음 · 최대 6초 MP4(H.264)로 다시 만든다. 저장소의 다른 대표 영상들과 같은 크기이고, 6초 400~500KB 안팎이라
  // 방송통계에서 끊기지 않는다(예전 720×404는 TOP 칸에서 흐릿했다).
  // WebCodecs(VideoEncoder)와 mp4-muxer.js를 쓴다. 브라우저가 못 하면 null(원본을 그대로 올릴지 묻는다).
  // 코덱은 H.264만 쓴다(아이폰 사파리까지 어디서나 재생). 크롬·엣지는 지원, 못 하는 브라우저면 원본을 올릴지 묻는다.
  // 소프트웨어 인코더(크롬·엣지의 OpenH264, Baseline 레벨 3.x)를 먼저 쓴다. 하드웨어 인코더는 올리는 PC의 그래픽 칩마다
  // 결과가 달라서(윈도우 기본 인코더는 레벨 4.1·CABAC) 그렇게 만든 영상이 PC·휴대폰 사이트에서 첫 장면에 멈춘 적이 있다
  // (2026-09 변현제 대표 영상). 소프트웨어가 안 되는 브라우저에서만 예전 설정(하드웨어 Main)으로 넘어간다.
  // OpenH264는 비트레이트를 높게 줘도(고정·가변 모두) 1280×720 6초에 400~470KB 안팎으로 맞춘다 - 하드웨어보다 조금 부드럽지만
  // 어느 기기에서나 같은 결과가 나오는 쪽을 택했다. 레벨 3.1이 1280×720 30fps까지 받는다.
  const CLIP={w:1280,h:720,fps:30,maxSec:6,bitrate:2_500_000,codecs:[
    {encoder:'avc1.42001f',muxer:'avc',extra:{avc:{format:'avc'},hardwareAcceleration:'prefer-software'}},
    {encoder:'avc1.4d401f',muxer:'avc',extra:{avc:{format:'avc'}}},
  ]};
  async function pickCodec(){
    for(const c of CLIP.codecs){
      const config={codec:c.encoder,width:CLIP.w,height:CLIP.h,bitrate:CLIP.bitrate,framerate:CLIP.fps,...c.extra};
      try{if((await VideoEncoder.isConfigSupported(config)).supported)return {config,muxer:c.muxer};}catch(e){}
    }
    return null;
  }
  async function encodeClip(file,onProgress){
    if(typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined'||!window.Mp4Muxer)return null;
    const codec=await pickCodec();
    if(!codec)return null;
    const config=codec.config;
    const url=URL.createObjectURL(file);
    const video=document.createElement('video');
    video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
    // 모바일(특히 아이폰)은 영상을 미리 불러오지 않아 여기서 멈출 수 있다 - 제한 시간을 두고, 재생을 한 번 걸어 불러오게 한다
    const within=(promise,ms,msg)=>Promise.race([promise,new Promise((_,no)=>setTimeout(()=>no(new Error(msg)),ms))]);
    try{
      const loaded=new Promise((ok,no)=>{video.onloadeddata=ok;video.onerror=()=>no(new Error('이 브라우저에서 열 수 없는 영상입니다'));});
      video.load();
      video.play().then(()=>video.pause()).catch(()=>{});
      await within(loaded,10000,'영상을 불러오지 못했습니다(시간 초과)');
      const vw=video.videoWidth,vh=video.videoHeight;
      if(!vw||!vh)throw new Error('영상 크기를 읽지 못했습니다');
      // 16:9가 아니면 가운데를 16:9로 잘라 쓴다(사진 칸도 가운데 기준으로 채운다)
      const scale=Math.max(CLIP.w/vw,CLIP.h/vh),sw=CLIP.w/scale,sh=CLIP.h/scale,sx=(vw-sw)/2,sy=(vh-sh)/2;
      const canvas=document.createElement('canvas');canvas.width=CLIP.w;canvas.height=CLIP.h;
      const ctx=canvas.getContext('2d');
      const muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:codec.muxer,width:CLIP.w,height:CLIP.h,frameRate:CLIP.fps},fastStart:'in-memory'});
      let failure=null;
      const encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:e=>{failure=e;}});
      encoder.configure(config);
      const total=Math.max(1,Math.floor(Math.min(video.duration||0,CLIP.maxSec)*CLIP.fps));
      for(let i=0;i<total;i++){
        if(failure)throw failure;
        const t=i/CLIP.fps;
        await within(new Promise(ok=>{video.onseeked=ok;video.currentTime=Math.min(t,Math.max(0,video.duration-0.001));}),5000,'영상 장면을 읽지 못했습니다(시간 초과)');
        ctx.drawImage(video,sx,sy,sw,sh,0,0,CLIP.w,CLIP.h);
        const frame=new VideoFrame(canvas,{timestamp:Math.round(t*1e6),duration:Math.round(1e6/CLIP.fps)});
        encoder.encode(frame,{keyFrame:i%(CLIP.fps*2)===0});
        frame.close();
        if(encoder.encodeQueueSize>10)await new Promise(ok=>setTimeout(ok,0));
        onProgress?.((i+1)/total);
      }
      await encoder.flush();
      if(failure)throw failure;
      encoder.close();
      muxer.finalize();
      const stem=String(file.name||'clip').replace(/\.[^.]+$/,'');
      return new File([muxer.target.buffer],`${stem}.mp4`,{type:'video/mp4'});
    }finally{URL.revokeObjectURL(url);}
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
        <div class="admin-preview-row"><div><b>대표 사진·영상(방송통계 TOP)</b><div class="admin-media-preview">${row.photo_path?(/\.(mp4|webm)$/i.test(row.photo_path)?`<video src="${C().esc(C().mediaUrl(row.photo_path))}" muted loop autoplay playsinline></video>`:`<img src="${C().esc(C().mediaUrl(row.photo_path))}" alt="">`):''}</div></div></div>
        ${C().field('대표 사진·영상',`<input class="admin-input" id="am_photo" type="file" accept="video/mp4,video/webm,video/*,image/webp,image/gif,image/png,image/jpeg">`)}
        <p class="admin-help" id="am_photo_status"></p>
        <p class="admin-help">영상을 고르면 저장할 때 자동으로 1280×720 · 30fps · 소리 없음 · 최대 6초 MP4로 줄여서 올립니다(16:9가 아니면 가운데를 잘라 맞춤). PC 크롬·엣지에서 올려 주세요(모바일은 줄이지 못할 수 있음). 사진·움짤은 그대로 올라갑니다. 얼굴이 가운데~위쪽에 오게 해 주세요${row.photo_path?` · <label><input type="checkbox" id="am_photo_clear"> 대표 사진 지우기</label>`:''}</p>
      `,
      onSubmit:async()=>{
        const payload={
          name:C().value('am_name').trim(),nickname:C().value('am_nick').trim(),soop_id:C().empty(C().value('am_soop')),
          elo_id:C().intOrNull(C().value('am_elo')),role:C().empty(C().value('am_role')),tier:C().empty(C().value('am_tier')),
          join_tier:C().empty(C().value('am_join_tier')),race:C().empty(C().value('am_race')),gender:C().empty(C().value('am_gender')),
          birth_date:C().empty(C().value('am_birth')),mbti:C().empty(C().value('am_mbti')),joined_date:C().empty(C().value('am_joined')),
          left_date:C().empty(C().value('am_left')),youtube_url:youtubeUrl(C().value('am_youtube')),avatar_path:row.avatar_path||null
        };
        // 대표 사진 칸(photo_path)은 SQL을 돌린 뒤에 생긴다. 칸이 없는 DB에 보내면 멤버 저장 자체가 실패하니
        // 칸이 있을 때(읽은 줄에 키가 있음)나 사진을 올릴 때만 보낸다.
        if(Object.prototype.hasOwnProperty.call(row,'photo_path'))payload.photo_path=document.getElementById('am_photo_clear')?.checked?null:(row.photo_path||null);

        if(!payload.name||!payload.nickname)throw new Error('이름과 닉네임은 필수입니다');
        const file=document.getElementById('am_avatar')?.files?.[0];
        if(file)payload.avatar_path=await C().uploadMedia(file,'members',payload.soop_id||payload.nickname);
        let photo=document.getElementById('am_photo')?.files?.[0];
        if(photo&&/^video\//.test(photo.type)){
          const status=document.getElementById('am_photo_status');
          const say=t=>{if(status)status.textContent=t;};
          say('영상 편집 중(1280×720 · 30fps · 소리 없음)');
          const before=photo.size;
          let why='';
          const clip=await encodeClip(photo,p=>say(`영상 편집 중 ${Math.round(p*100)}%`)).catch(e=>{why=C().errorText(e);return null;});
          if(clip){photo=clip;say(`편집 완료: ${Math.round(before/1024)}KB → ${Math.round(clip.size/1024)}KB`);}
          else{
            // 이 브라우저가 못 줄이면(모바일 등) 원본을 그대로 올릴지 묻는다. 저장소는 MP4·WebM만 받는다(아이폰 .mov는 안 됨)
            say(why?`영상 편집 실패: ${why}`:'이 브라우저는 영상 자동 편집을 지원하지 않습니다');
            if(!/^video\/(mp4|webm)$/.test(photo.type))throw new Error('이 기기에서는 영상을 줄일 수 없고 원본 형식(MP4·WebM만 가능)도 올릴 수 없습니다. PC 크롬·엣지에서 올리거나 채팅으로 보내 주세요');
            if(!confirm(`${why?`영상 편집에 실패했습니다(${why})`:'이 브라우저는 영상 자동 편집을 지원하지 않습니다'}\n원본(${Math.round(before/1024)}KB)을 그대로 올릴까요? 줄여서 올리려면 PC 크롬·엣지에서 다시 올려 주세요`))throw new Error('영상 올리기를 취소했습니다');
          }
        }
        if(photo){
          if(photo.size>10*1024*1024)throw new Error('대표 사진은 10MB 이하만 올릴 수 있습니다(2MB 이하 권장)');
          payload.photo_path=await C().uploadMedia(photo,'members-photo',payload.soop_id||payload.nickname);
        }
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
    if(document.getElementById('members-groups'))C().addPageTool({id:'adminMemberAdd',label:'멤버 추가',icon:'plus',onClick:()=>open(null)});
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
