import {nativeImage,net,BrowserWindow} from 'electron';
import {menuEntries} from '../share/model.mjs';
import {groupMembers,listedBots} from '../renderer/group-avatar.mjs';
function menuMembers(bot,state){
 const members=groupMembers(bot,state.bots);
 if(members.length<2)return undefined;
 return members.map(member=>({agentId:member.id,shape:member.avatarShape,color:member.avatarColor}));
}
export async function captureMenuIcons(state,avatarPage){
 const window=new BrowserWindow({show:false,x:-1600,y:120,width:160,height:160,skipTaskbar:true,focusable:false,paintWhenInitiallyHidden:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 try{
  window.webContents.setBackgroundThrottling(false);
  window.setOpacity(0);
  window.showInactive();
  await window.loadFile(avatarPage);const icons=[];
  for(const entry of menuEntries(state)){
   const members=menuMembers(entry.bot,state);
   if(!members&&entry.bot.avatar?.kind==='picture'&&entry.bot.avatar.picture?.url)continue;
   const config={agentId:entry.botId,shape:entry.bot.avatarShape,color:entry.bot.avatarColor,main:false,members};
   icons.push({botId:entry.botId,png:await window.webContents.executeJavaScript(`Promise.race([window.captureMenuAvatar(${JSON.stringify(config)}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('MENU_AVATAR_TIMEOUT')),15000))])`)});
  }
  const resolved=await resolvePictureIcons(state,icons);
  for(const icon of resolved)icon.png=await window.webContents.executeJavaScript(`window.whiteMenuIcon(${JSON.stringify(icon.png)})`);
  return resolved;
 }finally{window.destroy();}
}

// Render every visible Bot using the original avatar engine, not share-menu eligibility.
export async function captureBotAvatars(state,avatarPage,onAvatar=()=>{}){
 const target=new BrowserWindow({show:false,x:-1600,y:120,width:160,height:160,skipTaskbar:true,focusable:false,paintWhenInitiallyHidden:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 try{
  target.webContents.setBackgroundThrottling(false);target.setOpacity(0);target.showInactive();await target.loadFile(avatarPage);
  const images={};
  for(const bot of listedBots(state.bots??[])){
   try{
    const members=menuMembers(bot,state),picture=bot.avatar?.kind==='picture'?bot.avatar.picture?.url:null;
    if(picture&&!members){
     let image;if(picture.startsWith('data:image/')&&picture.length<=3*1024*1024)image=nativeImage.createFromDataURL(picture);
     else{const url=new URL(picture);if(url.protocol!=='https:'||url.username||url.password)continue;const response=await net.fetch(url.href,{signal:AbortSignal.timeout(8000)});if(!response.ok||Number(response.headers.get('content-length'))>2*1024*1024)continue;const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2*1024*1024)throw new Error('AVATAR_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}image=nativeImage.createFromBuffer(Buffer.concat(chunks));}
     if(!image.isEmpty())images[bot.id]=squareIcon(image).toDataURL();
    }else{
     const config={agentId:bot.id,shape:bot.avatarShape,color:bot.avatarColor,main:false,members};
     const png=await target.webContents.executeJavaScript(`Promise.race([window.captureMenuAvatar(${JSON.stringify(config)}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('AVATAR_TIMEOUT')),10000))])`);
     if(typeof png==='string'&&png.startsWith('data:image/png;base64,'))images[bot.id]=png;
    }
    if(images[bot.id])onAvatar(bot.id,images[bot.id]);
   }catch(error){console.warn('Bot avatar unavailable:',bot.id,error?.message??'error');}
  }
  return images;
 }finally{target.destroy();}
}
function squareIcon(image){
 const {width,height}=image.getSize();
 if(!width||!height)throw new Error('MENU_AVATAR_MISSING');
 const side=Math.min(width,height);
 const square=width===height?image:image.crop({x:Math.floor((width-side)/2),y:Math.floor((height-side)/2),width:side,height:side});
 const resized=square.resize({width:128,height:128});
 return resized.isEmpty()?image.resize({width:128,height:128}):resized;
}
export async function resolvePictureIcons(state,icons){
 const result=[...icons];
 for(const entry of menuEntries(state)){
  const picture=entry.bot.avatar?.kind==='picture'?entry.bot.avatar.picture?.url:null;if(!picture||menuMembers(entry.bot,state))continue;
  let image;
  if(picture.startsWith('data:image/')&&picture.length<=3*1024*1024)image=nativeImage.createFromDataURL(picture);
  else{
   const url=new URL(picture);if(url.protocol!=='https:'||url.username||url.password)throw new Error('MENU_AVATAR_MISSING');
   const response=await net.fetch(url.href,{signal:AbortSignal.timeout(15000)});if(!response.ok||Number(response.headers.get('content-length'))>2*1024*1024)throw new Error('MENU_AVATAR_MISSING');
   const reader=response.body.getReader(),chunks=[];let length=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024)throw new Error('MENU_AVATAR_MISSING');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
   image=nativeImage.createFromBuffer(Buffer.concat(chunks));
  }
  if(image.isEmpty())throw new Error('MENU_AVATAR_MISSING');
  const png=squareIcon(image).toDataURL(),index=result.findIndex(i=>i.botId===entry.botId);
  if(index>=0)result[index]={botId:entry.botId,png};else result.push({botId:entry.botId,png});
 }
 return result;
}
