// One-off, conservative cascade cleanup. Run from the repository root.
const fs = require('fs');
const path = require('path');
const load = name => process.env.DESIGN_TOOL_MODULES ? require(path.join(process.env.DESIGN_TOOL_MODULES,name)) : require(name);
const postcss = load('postcss');
const prettier = load('prettier');
const selectorParser = load('postcss-selector-parser');
const rootDir = process.cwd();
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]);
}
const source = [...files('templates'), ...files('docs'), ...files('scripts')]
  .filter(p => /\.(html|js|py)$/.test(p) && !p.endsWith('purify.min.js'))
  .map(p => fs.readFileSync(p,'utf8')).join('\n');
const report = {removedSelectors:[], removedDeclarations:0, removedRules:0};
function known(name) {
  // Bootstrap owns these runtime states; rank classes are composed as r${rank}.
  if (['modal-open','form-control','form-select','modal-footer','r2','r3'].includes(name)) return true;
  // Preserve dynamically composed families, not just literal class attributes.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if (new RegExp('(?<![\\w-])'+escaped+'(?![\\w-])').test(source)) return true;
  for (let i=name.indexOf('-');i>=0;i=name.indexOf('-',i+1)) {
    const prefix=name.slice(0,i+1);
    if(source.includes(prefix+'${') || source.includes(prefix+'{{') || source.includes(prefix+"' +") || source.includes(prefix+'" +')) return true;
  }
  return false;
}
async function clean(css, dead) {
  const root = postcss.parse(css);
  if (dead) root.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    const parsed = selectorParser().astSync(rule.selector);
    parsed.each(sel => {
      let unused = false;
      sel.walk(n => {
        // Nested :not() alternatives cannot prove the outer selector is dead.
        if ((n.type === 'class' || n.type === 'id') && n.parent === sel && !known(n.value)) unused = true;
      });
      if (unused) { report.removedSelectors.push(sel.toString()); sel.remove(); }
    });
    if (!parsed.nodes.length) rule.remove(); else rule.selector = parsed.toString();
  });
  const seen = new Map();
  const rules = []; root.walkRules(r => rules.push(r));
  for (const rule of rules.reverse()) {
    let scope = []; for(let p=rule.parent;p && p.type!=='root';p=p.parent) scope.unshift('@'+p.name+' '+p.params);
    const key = scope.join('|')+'|'+rule.selector;
    const later = seen.get(key) || new Map(); seen.set(key,later);
    for (const d of [...rule.nodes].reverse()) {
      if (d.type !== 'decl') continue;
      const priority = d.important ? 1 : 0;
      if (later.has(d.prop) && later.get(d.prop) >= priority) { d.remove(); report.removedDeclarations++; }
      else later.set(d.prop,priority);
    }
    if (!rule.nodes.some(n=>n.type==='decl')) {rule.remove();report.removedRules++;}
  }
  root.walkComments(c => c.remove());
  root.walkAtRules(a => {if(a.nodes && !a.nodes.length) a.remove();});
  // Move a repeated selector only across rules that cannot touch its properties.
  // Keep shorthand/longhand families together to avoid accidental precedence changes.
  const family=p=>/^(margin|padding|border|font|background|grid|flex|animation|transition|overflow|text|list|outline|column|place|align|justify|gap)/.exec(p)?.[1]||(/width|height|size/.test(p)?'dimensions':p);
  function merge(container) {
    for (const n of [...(container.nodes||[])]) if(n.type==='atrule'&&n.nodes)merge(n);
    let changed=true;
    while(changed) {
      changed=false;
      for(const rule of [...(container.nodes||[])]) {
        if(rule.type!=='rule')continue;
        const props=new Set(rule.nodes.filter(n=>n.type==='decl').map(d=>family(d.prop)));
        for(let next=rule.next();next;next=next.next()) {
          if(next.type==='rule'&&next.selector===rule.selector) {
            next.prepend(...rule.nodes);rule.remove();report.removedRules++;changed=true;break;
          }
          let conflict=false;
          if(next.walkDecls)next.walkDecls(d=>{if(props.has(family(d.prop))||d.prop==='all')conflict=true;});
          if(conflict)break;
        }
      }
    }
  }
  merge(root);
  // Adjacent identical selectors can be merged without changing precedence.
  root.walkRules(r=>{const next=r.next();if(next && next.type==='rule' && next.selector===r.selector){r.append(...next.nodes);next.remove();}});
  return prettier.format(root.toString(),{parser:'css',tabWidth:4,printWidth:110});
}
(async()=>{
  const css = await clean(fs.readFileSync('templates/assets/style.css','utf8'),true);
  fs.mkdirSync('build/design-audit',{recursive:true});
  fs.writeFileSync('build/design-audit/style.candidate.css',css);
  for(const name of ['admin','multiview']) {
    const html = fs.readFileSync('docs/'+name+'.html','utf8');
    const match=html.match(/<style>([\s\S]*?)<\/style>/);
    fs.writeFileSync('build/design-audit/'+name+'.candidate.html',html.replace(match[0],'<style>\n'+await clean(match[1],false)+'</style>'));
  }
  fs.writeFileSync('build/design-audit/cleanup.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})();
