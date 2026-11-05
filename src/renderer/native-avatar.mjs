import {createAvatar,createStrip,renderAvatarPng} from 'grok-bot-avatar-engine';
import {placeStack,renderStackPng,stackPlan} from './group-avatar.mjs';
let avatar,live,strip;
window.setAvatar=config=>{const target=document.querySelector('#avatar');if(!avatar)avatar=createAvatar(target,{...config,size:Math.min(innerWidth,innerHeight)});else avatar.update(config);};
window.renderStill=config=>renderAvatarPng({...config,size:128});
window.prepareLive=config=>{const target=document.querySelector('#live');target.style.display='block';if(!live)live=createAvatar(target,{...config,size:128});else live.update(config);};
window.captureLive=()=>live?.capture(128)??'';
window.renderStrip=config=>{document.body.classList.add('strip');const target=document.querySelector('#stage');if(!strip)strip=createStrip(target,config);else strip.update(config);};
window.stepStrip=()=>{};
window.acknowledge=id=>strip?.acknowledge(id);
window.nodNeighbors=()=>strip?.nodNeighbors()??'';
async function waitStack(root){
 const start=Date.now();let last='',stable=0;
 while(Date.now()-start<4000){
  const avatars=[...root.querySelectorAll('.avatar')];
  const ready=avatars.length>0&&avatars.every(node=>node.shadowRoot?.querySelector('svg'));
  const sig=avatars.map(node=>{
   const shadow=node.shadowRoot;
   const glyph=shadow?.querySelector('.glyph')?.style.transform||'';
   const path=shadow?.querySelector('svg path')?.getAttribute('d')?.slice(0,32)||'';
   return `${glyph}:${path}`;
  }).join('|');
  if(ready&&sig&&sig===last)stable+=1;else stable=0;
  last=sig;
  if(ready&&stable>=8)return;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw new Error('MENU_AVATAR_TIMEOUT');
}
function resetHost(){
 // A single-face capture mounts into #avatar and leaves its shadow root behind.
 // Light-DOM children are then not painted, so the group stack never gets an SVG.
 let host=document.querySelector('#avatar');
 if(host.shadowRoot){
  const next=host.cloneNode(false);
  next.id='avatar';
  host.replaceWith(next);
  host=next;
 }
 host.replaceChildren();
 host.style.cssText='position:relative;display:block;width:128px;height:128px;background:transparent';
 return host;
}
async function captureStack(members){
 const host=resetHost();
 const root=document.createElement('div');
 root.className='avatar-stack';
 root.style.cssText='position:relative;width:128px;height:128px';
 const plan=stackPlan(members);
 const handles=[];
 const add=node=>{const face=document.createElement('div');face.className='stack-face';face.append(node);root.append(face);};
 if(plan.extra){
  const badge=document.createElement('span');
  badge.className='stack-more';
  badge.textContent=`+${plan.extra}`;
  badge.style.cssText='display:grid;place-items:center;width:100%;height:100%;background:#1c1c1e;color:#fff;font:600 12px sans-serif';
  add(badge);
 }
 host.append(root);
 const faceSize=Math.round(128*plan.ratio);
 for(const member of plan.shown){
  const target=document.createElement('div');
  target.className='avatar';
  add(target);
  handles.push(createAvatar(target,{agentId:member.agentId,shape:member.shape,color:member.color,size:faceSize,main:false,state:'idle',reducedMotion:true,theme:'light'}));
  target.style.width='100%';target.style.height='100%';
 }
 placeStack(root);
 try{await waitStack(root);return await renderStackPng(root,256);}finally{for(const handle of handles)handle.destroy();}
}
window.captureMenuAvatar=async config=>{
 if(Array.isArray(config.members)&&config.members.length>=2)return captureStack(config.members);
 const target=document.createElement('div');
 target.className='avatar';
 resetHost().append(target);
 const handle=createAvatar(target,{...config,size:128,reducedMotion:true,theme:'light'});
 try{return await handle.capture(128);}finally{handle.destroy();}
};

// Share-menu icons keep the avatar's transparent background. Finder supplies
// its own tile behind the icon; baking white into the PNG breaks dark mode.
window.whiteMenuIcon=async source=>source;
