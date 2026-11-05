export const stackIconVersion=3;
export function isGroup(bot){
 return !!bot&&(bot.kind==='GROK_BOT_AGENT_KIND_ROOM'||(Array.isArray(bot.memberAgentIds)&&bot.memberAgentIds.length>0));
}
export function listedBots(bots){
 const names=new Set();
 for(const bot of bots??[]){
  const name=bot?.name?.trim();
  if(name&&isGroup(bot))names.add(name);
 }
 if(!names.size)return [...(bots??[])];
 return (bots??[]).filter(bot=>{
  const name=bot?.name?.trim();
  return isGroup(bot)||!name||!names.has(name);
 });
}
export function groupMembers(bot,bots){
 if(!isGroup(bot))return [];
 const seen=new Set();
 const members=[];
 for(const id of bot.memberAgentIds??[]){
  if(typeof id!=='string'||!id||id===bot.id||seen.has(id))continue;
  seen.add(id);
  const member=bots.find(item=>item.id===id||item.serverId===id);
  if(member&&member.id!==bot.id)members.push(member);
 }
 return members;
}
export function stackSlots(count){
 const size=count<=2?0.64:count===3?0.56:0.62;
 const end=1-size;
 if(count<=1)return [{x:(1-size)/2,y:(1-size)/2,size}];
 if(count===2)return [{x:0,y:0.18,size},{x:end,y:0.18,size}];
 if(count===3)return [{x:end/2,y:0,size},{x:0,y:end,size},{x:end,y:end,size}];
 return [{x:0,y:0,size},{x:end,y:0,size},{x:0,y:end,size},{x:end,y:end,size}];
}
export function stackPlan(members){
 const shown=members.slice(0,4);
 return {shown,extra:0,count:shown.length||1,ratio:stackSlots(shown.length||1)[0].size};
}
export function placeStack(root){
 const faces=[...root.children].filter(node=>node.classList?.contains('stack-face'));
 const slots=stackSlots(faces.length||1);
 faces.forEach((face,index)=>{
  const slot=slots[index];
  face.style.position='absolute';
  face.style.left=`${slot.x*100}%`;
  face.style.top=`${slot.y*100}%`;
  face.style.width=face.style.height=`${slot.size*100}%`;
  face.style.zIndex=String(index+1);
 });
}
// Visible gap. The same fraction of the whole cluster at every size, and the same
// width for every face. The drawn stroke is twice this because it is centered.
export function cutoutGap(stackWidth){
 return stackWidth*0.05;
}
function fmt(value){return Number.isFinite(value)?value.toFixed(3):'0';}
function xml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function bodyShape(face){
 const svg=face.querySelector('.avatar')?.shadowRoot?.querySelector('svg');
 if(!svg)return null;
 const use=svg.querySelector('g[transform] use');
 const group=[...svg.querySelectorAll('defs g')].find(node=>node.id.endsWith('-body'));
 let path=use&&group?group.querySelector('path'):null;
 let space=path?use:null;
 if(!path){
  path=[...svg.querySelectorAll('path')].find(node=>{
   const fill=(node.getAttribute('fill')||'').toLowerCase();
   return node.getAttribute('d')&&fill!=='#fff'&&fill!=='#ffffff'&&fill!=='none';
  });
  space=path;
 }
 const d=path?.getAttribute('d');
 const ctm=space?.getScreenCTM?.();
 if(!d||!ctm)return null;
 return {d,ctm};
}
function clearMask(face){
 if(!face.style.maskImage&&!face.style.webkitMaskImage)return;
 face.style.maskImage='';
 face.style.webkitMaskImage='';
 delete face.dataset.cut;
}
function maskFor(face,holes,stackWidth){
 const box=face.getBoundingClientRect();
 if(box.width<2||box.height<2)return '';
 const paths=holes.map(hole=>{
  const m=hole.ctm;
  const scale=Math.hypot(m.a,m.b)||1;
  const stroke=(cutoutGap(stackWidth)*2)/scale;
  return `<path d="${xml(hole.d)}" transform="matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e-box.left)} ${fmt(m.f-box.top)})" fill="black" stroke="black" stroke-width="${fmt(stroke)}" stroke-linejoin="round" stroke-linecap="round"/>`;
 }).join('');
 const dpr=window.devicePixelRatio||1;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(box.width*dpr)}" height="${fmt(box.height*dpr)}" viewBox="0 0 ${fmt(box.width)} ${fmt(box.height)}"><defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(box.width)}" height="${fmt(box.height)}"><rect width="100%" height="100%" fill="white"/>${paths}</mask></defs><rect width="100%" height="100%" fill="white" mask="url(#m)"/></svg>`;
 return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function punch(root){
 const faces=[...root.querySelectorAll(':scope > .stack-face')];
 if(faces.length<2)return 'solo';
 const stackWidth=root.getBoundingClientRect().width;
 const layers=faces.map((face,index)=>({face,index,z:Number(face.style.zIndex)||index+1,shape:bodyShape(face),badge:!!face.querySelector('.stack-more')}));
 if(layers.some(layer=>!layer.badge&&!layer.shape))return '';
 const parts=[];
 for(const rear of layers){
  const fronts=layers.filter(layer=>(layer.z>rear.z||(layer.z===rear.z&&layer.index>rear.index))&&layer.shape);
  if(!fronts.length){clearMask(rear.face);parts.push('open');continue;}
  const box=rear.face.getBoundingClientRect();
  const holes=fronts.map(layer=>layer.shape);
  const sig=[fmt(stackWidth),fmt(box.width),fmt(box.height),...holes.map(hole=>`${hole.d.slice(0,48)}:${fmt(hole.ctm.a)}:${fmt(hole.ctm.d)}:${fmt(hole.ctm.e-box.left)}:${fmt(hole.ctm.f-box.top)}`)].join('|');
  parts.push(sig);
  if(rear.face.dataset.cut===sig)continue;
  const url=maskFor(rear.face,holes,stackWidth);
  if(!url)continue;
  rear.face.dataset.cut=sig;
  rear.face.style.maskImage=url;
  rear.face.style.webkitMaskImage=url;
  rear.face.style.maskSize='100% 100%';
  rear.face.style.webkitMaskSize='100% 100%';
  rear.face.style.maskRepeat='no-repeat';
  rear.face.style.webkitMaskRepeat='no-repeat';
  rear.face.style.maskMode='alpha';
 }
 return parts.join('||');
}
export function cutoutStack(root){
 let stopped=false;
 // The avatar engine swaps the silhouette in after the first paint, without
 // resizing the stack. Keep following that swap or the gap is left on the old shape.
 const apply=()=>{if(stopped||!root.isConnected)return;punch(root);};
 const timer=setInterval(apply,80);
 const stopTimer=setTimeout(()=>clearInterval(timer),5000);
 let resize=null,mo=null,armTimer=null;
 if(typeof ResizeObserver==='function'){resize=new ResizeObserver(apply);resize.observe(root);}
 if(typeof MutationObserver==='function'){
  mo=new MutationObserver(apply);
  const arm=()=>{for(const host of root.querySelectorAll('.avatar'))if(host.shadowRoot)mo.observe(host.shadowRoot,{subtree:true,childList:true,attributes:true,attributeFilter:['style','d','transform','viewBox']});};
  arm();
  armTimer=setInterval(arm,150);
  setTimeout(()=>clearInterval(armTimer),5000);
 }
 const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);clearInterval(armTimer);clearTimeout(stopTimer);resize?.disconnect();mo?.disconnect();};
 apply();
 return stop;
}
function svgImage(svg){
 const host=svg.getRootNode()?.host;
 const ink=host?getComputedStyle(host).getPropertyValue('--grok-bot-ink').trim():'';
 const clone=svg.cloneNode(true);
 clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
 const rect=svg.getBoundingClientRect();
 clone.setAttribute('width',String(Math.max(1,rect.width)));
 clone.setAttribute('height',String(Math.max(1,rect.height)));
 let text=new XMLSerializer().serializeToString(clone);
 if(ink)text=text.replaceAll('var(--grok-bot-ink)',ink).replaceAll('currentColor',ink);
 const image=new Image();
 const url=`data:image/svg+xml,${encodeURIComponent(text)}`;
 return new Promise((resolve,reject)=>{
  image.onload=()=>resolve({image,rect});
  image.onerror=()=>reject(new Error('STACK_AVATAR_MISSING'));
  image.src=url;
 });
}
export async function renderStackPng(root,pixelSize=256){
 const stack=root.getBoundingClientRect();
 if(stack.width<8||stack.height<8)throw new Error('STACK_AVATAR_MISSING');
 const scale=pixelSize/stack.width;
 const canvas=document.createElement('canvas');
 canvas.width=pixelSize;canvas.height=pixelSize;
 const ctx=canvas.getContext('2d');
 const faces=[...root.querySelectorAll(':scope > .stack-face')].sort((a,b)=>(Number(a.style.zIndex)||0)-(Number(b.style.zIndex)||0));
 for(const face of faces){
  const box=face.getBoundingClientRect();
  const shape=bodyShape(face);
  if(shape){
   ctx.save();
   ctx.globalCompositeOperation='destination-out';
   const m=shape.ctm;
   ctx.setTransform(m.a*scale,m.b*scale,m.c*scale,m.d*scale,(m.e-stack.left)*scale,(m.f-stack.top)*scale);
   const path=new Path2D(shape.d);
   ctx.lineWidth=(cutoutGap(stack.width)*2)/(Math.hypot(m.a,m.b)||1);
   ctx.lineJoin='round';ctx.lineCap='round';
   ctx.fill(path);ctx.stroke(path);
   ctx.restore();
  }
  ctx.save();
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.globalCompositeOperation='source-over';
  ctx.beginPath();
  ctx.rect(box.left-stack.left,box.top-stack.top,box.width,box.height);
  ctx.clip();
  const badge=face.querySelector('.stack-more');
  if(badge){
   ctx.fillStyle='#1c1c1e';
   ctx.fillRect(box.left-stack.left,box.top-stack.top,box.width,box.height);
   ctx.fillStyle='#fff';
   ctx.font=`600 ${Math.max(9,box.width*0.34)}px sans-serif`;
   ctx.textAlign='center';ctx.textBaseline='middle';
   ctx.fillText(badge.textContent||'',box.left-stack.left+box.width/2,box.top-stack.top+box.height/2);
   ctx.restore();
   continue;
  }
  const imageNode=face.querySelector('img');
  if(imageNode?.complete&&imageNode.naturalWidth){
   ctx.drawImage(imageNode,box.left-stack.left,box.top-stack.top,box.width,box.height);
   ctx.restore();
   continue;
  }
  const svg=face.querySelector('.avatar')?.shadowRoot?.querySelector('svg');
  if(!svg){ctx.restore();continue;}
  const {image,rect}=await svgImage(svg);
  ctx.drawImage(image,rect.left-stack.left,rect.top-stack.top,rect.width,rect.height);
  ctx.restore();
 }
 return canvas.toDataURL('image/png');
}
