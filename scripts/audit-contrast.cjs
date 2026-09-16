// Diagnostic, not a WCAG certification: gradients/images and translucency need visual review.
module.exports = function auditContrast() {
 const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
 const luminance=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const issues=[];
 for(const e of document.querySelectorAll('body *')) {
  if(!e.getBoundingClientRect().height||e.closest('[disabled],.disabled,.cal-cell-event'))continue;
  const text=Array.from(e.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('');
  if(!text||!/\p{Letter}|\p{Number}/u.test(text))continue;
  const style=getComputedStyle(e);let bg=[255,255,255];
  for(let p=e;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if((c[3]??1)>.8){bg=c;break;}}
  const a=luminance(rgb(style.color)),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  if(ratio<3)issues.push({selector:e.tagName+'.'+e.className,text:text.slice(0,40),color:style.color,bg,ratio:+ratio.toFixed(2)});
 }
 return Array.from(new Map(issues.map(x=>[x.selector,x])).values());
};
