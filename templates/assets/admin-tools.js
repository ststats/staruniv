(function () {
  'use strict';
  const C=()=>window.AdminCore;
  let rows=[];
  async function load(){
    const {data,error}=await C().state.client.from('external_tools').select('*').order('source_order');
    if(error)throw error;rows=data||[];
    const grouped={extTools:{items:[]},extSites:{items:[]}};
    rows.filter(r=>r.active||document.body.classList.contains('admin-mode')).forEach(r=>{
      (grouped[r.category]||grouped.extTools).items.push({...r});
    });
    renderExternalTools(grouped);
    requestAnimationFrame(()=>document.querySelectorAll('.tool-card[data-tool-id]').forEach(card=>{
      const row=rows.find(r=>String(r.id)===card.dataset.toolId);card.classList.toggle('admin-config-hidden',!!row&&!row.active);
    }));
  }
  function open(row){
    row=row||{category:'extTools',name:'',url:'',favicon:'',source_order:'',active:true};
    C().openDrawer({
      eyebrow:'TOOL',title:row.id?'외부 도구 수정':'외부 도구 추가',
      html:`
        ${C().field('구분',C().select('at_category',[['extTools','도구'],['extSites','사이트']],row.category))}
        ${C().field('이름',C().input('at_name',row.name||'','text','required'))}
        ${C().field('URL',C().input('at_url',row.url||'','url','required'))}
        ${C().field('파비콘',C().input('at_favicon',row.favicon||'','url'))}
        <div class="admin-form-grid">
          ${C().field('표시 순서',C().input('at_order',row.source_order??'','number','min="0"'))}
          ${C().field('표시 여부',C().checkbox('at_active',row.id?!!row.active:true,'표시'))}
        </div>`,
      onSubmit:async()=>{
        const url=C().value('at_url').trim();if(!/^https?:\/\//i.test(url))throw new Error('URL은 http:// 또는 https://로 시작해야 합니다');
        const dup=rows.find(r=>r.url.toLowerCase()===url.toLowerCase()&&String(r.id)!==String(row.id||''));if(dup&&!confirm(`같은 URL이 이미 "${dup.name}"에 등록돼 있습니다. 그래도 저장할까요?`))throw new Error('중복 URL 저장을 취소했습니다');
        const payload={category:C().value('at_category'),name:C().value('at_name').trim(),url,favicon:C().empty(C().value('at_favicon')),source_order:Number(C().value('at_order')||await C().nextSourceOrder('external_tools')),active:!!document.getElementById('at_active')?.checked,updated_at:new Date().toISOString()};
        let error;if(row.id)({error}=await C().state.client.from('external_tools').update(payload).eq('id',row.id));else({error}=await C().state.client.from('external_tools').insert(payload));if(error)throw error;C().toast('도구를 저장했습니다');await load();
      },
      onDelete:row.id?async()=>{const {error}=await C().state.client.from('external_tools').delete().eq('id',row.id);if(error)throw error;await C().audit('delete','external_tools',row.id,{name:row.name,url:row.url});await load();}:null
    });
  }
  async function init(){
    if(document.body.dataset.adminPage!=='tools')return;
    window.toolCardAdminExtra=tool=>C().state.editMode?`<button type="button" class="admin-card-action" data-admin-tool="${C().esc(tool.id)}">편집</button>`:'';
    await load();
    const ext=document.getElementById('view-tools-external');
    if(ext)C().addPageTool({id:'adminToolAdd',label:'외부 도구·사이트 추가',icon:'plus',onClick:()=>open(null)});
    document.addEventListener('click',ev=>{const b=ev.target.closest('[data-admin-tool]');if(!b)return;ev.preventDefault();ev.stopPropagation();open(rows.find(r=>String(r.id)===b.dataset.adminTool));},true);
  }
  document.addEventListener('admin:ready',init);
}());
