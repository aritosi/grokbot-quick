import {listedBots} from '../renderer/group-avatar.mjs';

export function toolboxShareOff(bots,recipients){
  const enabled=new Set((recipients??[]).filter(item=>item?.enabled===true&&typeof item.botId==='string').map(item=>item.botId));
  return (bots??[]).filter(bot=>enabled.has(bot?.id)).map(bot=>({botId:bot.id,patch:{enabled:false}}));
}
export function composerAfterSend(recipient,prefs){
  const per=recipient?.composerAfterSend;
  if(per==='hide'||per==='open')return per;
  return prefs?.afterSend==='open'?'open':'hide';
}
export function confirmCopy({isRoom=false,confirmed=false}={}){
  if(isRoom)return {duplicate:false,reason:'room'};
  if(confirmed!==true)return {duplicate:false,reason:'cancel'};
  return {duplicate:true};
}
export function confirmAccountStill(savedId,currentId){
  return (savedId??null)===(currentId??null);
}

export function trayMenuModel(locale=''){
  const zh=String(locale).toLowerCase().startsWith('zh');
  return [
    {id:'show-main',label:zh?'打开主页面':'Open main window',action:'show-main'},
    {id:'open-composer',label:zh?'打开输入框':'Open composer',action:'open-composer'},
    {id:'quit',label:zh?'退出':'Quit',action:'quit'}
  ];
}
export function trayCommand(id){
  return trayMenuModel().find(item=>item.id===id)?.action??null;
}
export function windowCloseAction({quitting=false,smoke=false,hasTray=true}={}){
  if(quitting||smoke||hasTray===false)return 'quit';
  return 'hide';
}
export const loginItemArg='--opened-at-login';
export function loginItemPayload(enabled){
  return {openAtLogin:enabled===true,openAsHidden:true,args:[loginItemArg]};
}
export function openedAsLoginItem({wasOpenedAtLogin=false,argv=[]}={}){
  return wasOpenedAtLogin===true||(argv??[]).includes(loginItemArg);
}
export function loginItemStartup(pref){
  if(!pref?.known)return null;
  return loginItemPayload(pref.enabled===true);
}
export function applyLoginItem(enabled,settingsApi){
  const payload=loginItemPayload(enabled);
  settingsApi.setLoginItemSettings(payload);
  return payload;
}
export function shouldApplyLoginItem({preview=false,packaged=false}={}){
  return preview!==true&&packaged===true;
}

export function touchBarChoice({moved=false,startId='',selectedId=''}={}){
  if(typeof selectedId!=='string'||!selectedId)return {action:'none'};
  if(!moved&&startId===selectedId)return {action:'compose',botId:selectedId};
  return {action:'select',botId:selectedId};
}
export function touchBarPinPayload(pinned){
  return {pinned:pinned===true};
}
// Direct shares finish in the background. A silent success is fine, but a
// failure must not look like nothing happened.
export function shareResultNotice({status='',botName='',locale='en'}={}){
  if(status==='sent'||!status)return null;
  const zh=String(locale).startsWith('zh');
  const name=botName||(zh?'这个 Bot':'this Bot');
  const title='GrokBot Quick';
  if(status==='unconfirmed')return {title,body:zh?`发给 ${name} 的转发可能已经发出，但结果未确认。请到发送记录核对。`:`The forward to ${name} may have been sent, but delivery was not confirmed. Check Send history.`};
  if(status==='expired')return {title,body:zh?`发给 ${name} 的转发等太久，没有发出去。内容还在发送记录里。`:`The forward to ${name} waited too long and was not sent. It is still in Send history.`};
  if(status==='failed')return {title,body:zh?`发给 ${name} 的转发没有发出去，附件还在发送记录里。`:`The forward to ${name} was not sent. Its files are still in Send history.`};
  return {title,body:zh?`发给 ${name} 的转发还在待发送。请到发送记录处理。`:`The forward to ${name} is waiting. Open Send history to finish it.`};
}
export function floatingComposerTraits(platform){
  return {skipTaskbar:true,alwaysOnTop:true,transparent:true,...platform==='win32'?{thickFrame:false}:{}};
}
// A dragged composer keeps its top-left corner; a fresh one sits at the bottom
// centre of the display the user opened it on.
export function composerBounds({workArea,current=null,width=368,height=110,moved=false,margin=8}={}){
  const area=workArea??{x:0,y:0,width:1280,height:800};
  const aw=Math.max(1,Number(area.width)||0),ah=Math.max(1,Number(area.height)||0);
  const w=Math.min(Math.max(300,Math.round(width)||368),Math.max(300,aw-margin*2));
  const h=Math.min(Math.max(56,Math.round(height)||96),Math.max(56,ah-margin*3));
  const minX=area.x+margin,maxX=Math.max(minX,area.x+aw-w-margin);
  const minY=area.y+margin,maxY=Math.max(minY,area.y+ah-h-margin);
  const clamp=(value,min,max)=>Math.min(Math.max(min,Math.round(Number(value)||0)),max);
  if(moved&&current&&Number.isFinite(Number(current.x))&&Number.isFinite(Number(current.y))){
    return {x:clamp(current.x,minX,maxX),y:clamp(current.y,minY,maxY),width:w,height:h};
  }
  return {x:Math.round(area.x+(aw-w)/2),y:Math.round(area.y+ah-h-margin),width:w,height:h};
}

function safeName(name){
  const text=String(name??'').replace(/[\u0000-\u001f"]/g,'').trim().slice(0,80);
  return text||'Bot';
}
function cleanToken(value){
  return String(value??'').trim().replace(/^["']+|["']+$/g,'');
}
function sameId(left,right){
  return typeof left==='string'&&typeof right==='string'&&left.length>0&&left.toLowerCase()===right.toLowerCase();
}
export function explorerBotId(botId,bots){
  const text=cleanToken(botId);
  if(!text)return '';
  const bot=(bots??[]).find(item=>sameId(item?.id,text)||sameId(item?.serverId,text));
  return typeof bot?.id==='string'?bot.id:text;
}
export function explorerTargets(bots,recipients){
  const allowed=new Set(listedBots(bots).map(bot=>bot.id));
  const on=new Map((recipients??[]).filter(item=>item?.enabled===true&&typeof item.botId==='string').map(item=>[item.botId,item]));
  return (bots??[]).map((bot,index)=>({bot,index,order:on.get(bot.id)?.order??0})).filter(item=>allowed.has(item.bot.id)&&on.has(item.bot.id)&&/^[A-Za-z0-9_-]{1,128}$/.test(item.bot.id)).sort((a,b)=>a.order-b.order||a.index-b.index).map(item=>({botId:item.bot.id,name:safeName(item.bot.name)}));
}
export function explorerAccept(botId,recipients,bots){
  const id=explorerBotId(botId,bots);
  return explorerTargets(bots,recipients).some(item=>item.botId===id);
}
export function explorerVerdict({botId,bots,recipients,connected,hasAccount}={}){
  const id=explorerBotId(botId,bots);
  const loaded=Array.isArray(bots)&&Array.isArray(recipients);
  if(!loaded||bots.length===0){
    if(loaded&&hasAccount===false&&connected!==true)return {accept:false,botId:id,reason:'not-signed-in'};
    return {accept:false,botId:id,reason:'not-loaded'};
  }
  if(connected!==true&&hasAccount!==true)return {accept:false,botId:id,reason:'not-signed-in'};
  if(explorerAccept(id,recipients,bots))return {accept:true,botId:id,reason:'accepted'};
  return {accept:false,botId:id,reason:'not-enabled'};
}
export async function resolveExplorerForward({read,waitMs=15000,intervalMs=200,sleep,now=Date.now}={}){
  const pause=sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const start=now();
  let verdict=explorerVerdict(read());
  while(!verdict.accept&&verdict.reason!=='not-enabled'){
    const current=read()??{};
    if(current.settled===true)break;
    if(now()-start>=waitMs)break;
    await pause(intervalMs);
    verdict=explorerVerdict(read());
  }
  return verdict;
}
function quoteCmd(value){
  return `"${String(value).replaceAll('"','')}"`;
}
export function explorerCommand({executable,appArgs=[],botId}){
  const head=[executable,...appArgs].map(quoteCmd).join(' ');
  const id=cleanToken(botId).replaceAll('"','').replaceAll('=','');
  return `${head} --explorer-forward --bot=${id} -- "%1"`;
}
function menuLabel(name){return safeName(name).replaceAll('&','&&');}
export function explorerRejectNotice(locale='',reason='not-enabled'){
  const zh=String(locale).toLowerCase().startsWith('zh');
  const body={
    'not-loaded':zh?'应用还在连接账号，请稍后再试':'The app is still connecting the account. Try again in a moment.',
    'not-signed-in':zh?'请先登录':'Sign in first.',
    'not-enabled':zh?'这个 Bot 没有开启接收转发':'This Bot is not receiving forwards.'
  }[reason]??(zh?'这个 Bot 没有开启接收转发':'This Bot is not receiving forwards.');
  return {title:'GrokBot Quick',body};
}
export function explorerCleanupKeys(){
  return [
    'HKCU\\Software\\Classes\\*\\shell\\GrokBotQuick',
    'HKCU\\Software\\Classes\\GrokBotQuick.Menu',
    'HKCU\\Software\\Classes\\GrokBotQuick.Staging',
    'HKCU\\Software\\Classes\\SystemFileAssociations\\*\\shell\\GrokBotQuick',
    'HKCU\\Software\\Classes\\AllFilesystemObjects\\shell\\GrokBotQuick',
    'HKCU\\Software\\Classes\\Folder\\shell\\GrokBotQuick',
    'HKCU\\Software\\Classes\\Directory\\shell\\GrokBotQuick',
    'HKCU\\Software\\Classes\\Directory\\Background\\shell\\GrokBotQuick'
  ];
}
export function explorerRegistryOps({executable,appArgs=[],bots,recipients,enabled=true}={}){
  const cleanup=explorerCleanupKeys().map(key=>({op:'delete',key}));
  const targets=enabled===false?[]:explorerTargets(bots,recipients);
  if(!targets.length)return cleanup;
  const staging='HKCU\\Software\\Classes\\GrokBotQuick.Staging';
  const menu='HKCU\\Software\\Classes\\GrokBotQuick.Menu';
  const parent='HKCU\\Software\\Classes\\*\\shell\\GrokBotQuick';
  const ops=[{op:'delete',key:staging}];
  const writeTree=(root,rollbackKey)=>{
    targets.forEach((target,index)=>{
      const key=`${root}\\shell\\${String(index+1).padStart(2,'0')}_${target.botId}`;
      const command=explorerCommand({executable,appArgs,botId:target.botId});
      ops.push({op:'add',key:`${key}\\command`,name:'',type:'REG_SZ',value:command,rollbackKey});
      ops.push({op:'add',key,name:'MUIVerb',type:'REG_SZ',value:menuLabel(target.name),rollbackKey});
      ops.push({op:'add',key,name:'MultiSelectModel',type:'REG_SZ',value:'Document',rollbackKey});
    });
  };
  writeTree(staging,staging);
  for(const key of explorerCleanupKeys())if(key!==staging)ops.push({op:'delete',key});
  writeTree(menu,menu);
  ops.push({op:'add',key:parent,name:'MUIVerb',type:'REG_SZ',value:'Grok Bot',rollbackKey:parent});
  ops.push({op:'add',key:parent,name:'ExtendedSubCommandsKey',type:'REG_SZ',value:'GrokBotQuick.Menu',rollbackKey:parent});
  ops.push({op:'add',key:parent,name:'MultiSelectModel',type:'REG_SZ',value:'Document',rollbackKey:parent});
  ops.push({op:'delete',key:staging});
  return ops;
}
export function createExplorerSync(){
  let key='';
  let chain=Promise.resolve();
  return {
    schedule(ops,apply,{force=false}={}){
      const next=JSON.stringify(ops??[]);
      if(!force&&next===key)return chain;
      key=next;
      const scheduled=next;
      const run=chain.catch(()=>{}).then(async()=>{
        if(key!==scheduled)return {applied:false,reason:'stale'};
        try{return await apply(ops);}
        catch(error){if(key===scheduled)key='';throw error;}
      });
      chain=run;
      return run;
    }
  };
}
export async function applyExplorerRegistry(ops,{platform,execFile}={}){
  if(platform!=='win32')return {applied:false,reason:'not-windows'};
  if(typeof execFile!=='function')throw new Error('EXPLORER_REGISTRY_UNAVAILABLE');
  const hide={windowsHide:true};
  const rollback=[];
  const remember=key=>{if(key&&!rollback.includes(key))rollback.push(key);};
  try{
    for(const op of ops??[]){
      if(op.op==='delete'){await Promise.resolve(execFile('reg',['delete',op.key,'/f'],hide)).catch(()=>{});continue;}
      const args=op.name?['add',op.key,'/v',op.name,'/t',op.type,'/d',op.value,'/f']:['add',op.key,'/ve','/t',op.type,'/d',op.value,'/f'];
      await execFile('reg',args,hide);
      remember(op.rollbackKey);
    }
  }catch(error){
    for(const key of rollback.slice().reverse())await Promise.resolve(execFile('reg',['delete',key,'/f'],hide)).catch(()=>{});
    throw error;
  }
  return {applied:true};
}
export function createExplorerBatch({delayMs=800}={}){
  let armed=false;
  let timer=null;
  let deliver=async()=>{};
  const files=new Map();
  const traces=new Map();
  const schedule=()=>{
    if(!armed)return;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;void flush();},delayMs);
  };
  const flush=async()=>{
    const batch=[...files.entries()];
    files.clear();
    for(const [botId,list] of batch)await deliver(botId,list,{argv:traces.get(botId)??[]});
    for(const [botId] of batch)traces.delete(botId);
  };
  return {
    push(forward){
      const botId=typeof forward?.botId==='string'?forward.botId:'';
      const incoming=(forward?.files??[]).filter(file=>typeof file==='string'&&file&&file!=='%1');
      if(!botId||!incoming.length)return false;
      const current=files.get(botId)??[];
      for(const file of incoming)if(!current.includes(file))current.push(file);
      files.set(botId,current);
      if(Array.isArray(forward.argv))traces.set(botId,forward.argv);
      schedule();
      return true;
    },
    arm(fn){
      deliver=fn;
      armed=true;
      if(files.size)schedule();
    }
  };
}
function redactArg(value){
  const text=String(value??'');
  if(!/[\\/]/.test(text)&&!/^[A-Za-z]:/.test(text))return text;
  const base=text.replace(/[\\/]+$/,'').split(/[\\/]/).pop()??'';
  const dot=base.lastIndexOf('.');
  return dot>0?base.slice(dot):'(noext)';
}
export function explorerLogLine({at,argv,botId,state,reason}={}){
  const bots=Array.isArray(state?.bots)?state.bots:[];
  const id=explorerBotId(botId,bots);
  const match=bots.find(item=>item?.id===id)??null;
  const recipient=(Array.isArray(state?.recipients)?state.recipients:[]).find(item=>item?.botId===id)??null;
  return JSON.stringify({at,argv:(argv??[]).map(redactArg),botId:cleanToken(botId),matchedId:match?id:null,botListed:!!match,recipient:recipient?{enabled:recipient.enabled,mode:recipient.mode,sources:recipient.sources??null}:null,connected:state?.connected===true,reason});
}
export function trimExplorerLog(previous,line,max=256*1024){
  const text=`${previous??''}${line}\n`;
  const bytes=Buffer.from(text);
  if(bytes.length<=max)return text;
  let slice=bytes.subarray(bytes.length-max);
  const nl=slice.indexOf(0x0a);
  if(nl>=0&&nl<slice.length-1)slice=slice.subarray(nl+1);
  return slice.toString('utf8');
}
export function parseExplorerForward(argv){
  const args=[...(argv??[])].map(item=>String(item));
  if(!args.includes('--explorer-forward')&&!args.some(item=>item.startsWith('--explorer-forward=')))return null;
  const eq=args.find(item=>item.startsWith('--bot='));
  let botId='';
  if(eq)botId=cleanToken(eq.slice('--bot='.length));
  else{
    const botAt=args.indexOf('--bot');
    if(botAt>=0){
      for(let index=botAt+1;index<args.length;index++){
        const token=args[index];
        if(token==='--')break;
        if(token.startsWith('-'))continue;
        botId=cleanToken(token);
        break;
      }
    }
  }
  const sep=args.indexOf('--');
  const files=(sep>=0?args.slice(sep+1):[]).map(cleanToken).filter(item=>item&&item!=='%1');
  return {botId,files};
}

export function acceptLateFiles({token,current,botId,currentBotId,paths}={}){
  if(token==null||current==null||token!==current)return [];
  if(!botId||botId!==currentBotId)return [];
  return (paths??[]).filter(item=>typeof item==='string'&&item);
}

export function coalBallSvg(){
  // Same shape as assets/bloub/idle.svg: circle r=100, two pill-shaped holes (the page shows through).
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-108 -108 216 216" aria-hidden="true"><mask id="coal-eyes"><circle r="100" fill="#fff"/><path d="M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z" transform="matrix(0.87,-0.33,0.45,0.84,21.42,-43.32)"/><path d="M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z" transform="matrix(0.64,-0.06,0.45,0.84,62.98,-53.9)"/></mask><circle class="corps" r="100" fill="#0a0a0c" mask="url(#coal-eyes)"/></svg>';
}
