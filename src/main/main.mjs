import {app,BrowserWindow,ipcMain,utilityProcess,safeStorage,shell,dialog,nativeTheme,Menu,Notification,globalShortcut,screen,Tray,nativeImage,clipboard} from 'electron';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {dirname,isAbsolute,join} from 'node:path';
import {appendFile,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {RpcClient} from './rpc.mjs';
import {CredentialVault} from './credentials.mjs';
import {NativeUI} from './native-ui.mjs';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {homedir} from 'node:os';
import {ShareMenu} from './share-menu.mjs';
import {captureMenuIcons,captureBotAvatars} from './menu-icons.mjs';
import {MenuReconciler} from '../share/reconciler.mjs';
import {menuHostTemplate,sharingApplicationPath} from '../share/host-path.mjs';
import {shareHandoff} from '../share/handoff.mjs';
import {pickerBots} from '../share/picker.mjs';
import {frontmostFiles,prepareExplorerSelection,regularFiles,stopExplorerSelection,warmExplorerSelection} from './selection.mjs';
import {menuEntries} from '../share/model.mjs';
import {matchShareTitles,spliceWechatOrder} from '../share/order.mjs';
import {grokBotAgentUrl} from '../grok-link.mjs';
import {disableCli,enableCli,skillBundleDir,writeCliCredential} from './cli-bridge.mjs';
import {applyExplorerRegistry,applyLoginItem,composerBounds,createExplorerBatch,createExplorerSync,explorerLogLine,explorerRegistryOps,explorerRejectNotice,floatingComposerTraits,loginItemStartup,openedAsLoginItem,parseExplorerForward,resolveExplorerForward,shareResultNotice,shouldApplyLoginItem,trayCommand,trayMenuModel,trimExplorerLog,windowCloseAction} from '../shell/actions.mjs';
import {coalBallAppPng,coalBallIcon,coalBallPng,trayIconImages} from '../shell/coal-ball.mjs';
import {acceptWindowControl,editCommand,mainWindowOptions,maximizedContentInset} from '../shell/window-chrome.mjs';
import {composeLink,deeplinkNotice,parseDeeplink,shortcutSourceAllowed} from '../shell/deeplink.mjs';
import {listedBots} from '../renderer/group-avatar.mjs';
import {normalizeWheelLayout,changeWheelSlot} from '../shell/wheel-layout.mjs';

const runProcess=promisify(execFile);
const RECEIVE_TIMEOUT=30*60_000;

const here=dirname(fileURLToPath(import.meta.url));
const smoke=process.argv.includes('--smoke-test');
const preview=smoke||process.argv.includes('--preview');
const backgroundShare=process.argv.includes('--share-intake');
const quietLaunch=backgroundShare||process.argv.includes('--explorer-forward')||process.argv.some(arg=>String(arg).includes('grokbotquick://'));
let nativeUI,quickPanelRestoredBounds=null,panelWindow,wheelWindow,window,floatWindow,avatarWindow,pickerWindow,worker,rpc,vault,shareMenu,menuReconciler,temporaryRoot,tray,quitting=false,accountBusy=false,finderRefreshTimer=null,suppressActivate=false,composerReadyState=null;
let openAtLogin=false,loginItemKnown=false,explorerMenu=true,explorerSettled=false;
if(preview){temporaryRoot=mkdtempSync(join(tmpdir(),'grokbot-quick-preview-'));app.setPath('userData',temporaryRoot);app.setPath('sessionData',temporaryRoot);}
let latestState={},hostIssue=null,windowMaterial='none',activeBotId='',pendingFloat=null,suspendFloatDismiss=false,keepFloatOpen=false,ipcSender=null,dockHidden=false;
let composerPrefs={afterSend:'hide',dismissOnOutside:true},floatShownAt=0,pickerOpen=false,pickerSize={width:760,height:188},composeGeneration=0,floatMoved=false,lastFloatBounds=null,composerBar=false;
let avatarSignature='',avatarRefreshQueued=false,avatarRefreshRunning=false,avatarCache={},wheelLayouts={};
let cliStatus={enabled:false,command:'',skillsPath:'',claudeLinked:false,credential:false,pathSnippet:false,error:''};
const pendingSharedComposers=new Set();let openingSharedComposer=false,shortcutsSuppressed=false;
const pendingLinks=[];let deeplinkReady=false,deeplinkChain=Promise.resolve();
const registeredShortcuts=new Map();
const zh=app.getLocale?.().startsWith('zh');
const notify=(event,data)=>{const payload={event,data};for(const target of [window,floatWindow,avatarWindow,pickerWindow,panelWindow,wheelWindow])if(target&&!target.isDestroyed())target.webContents.send('grokbotQuick:event',payload);};
const cliPublic=()=>({enabled:!!cliStatus.enabled,command:cliStatus.command??'',skillsPath:cliStatus.skillsPath??'',claudeLinked:!!cliStatus.claudeLinked,credential:!!cliStatus.credential,error:cliStatus.error??''});
const publicState=()=>({...latestState,activeBotId,composerPrefs,wheelLayout:normalizeWheelLayout(wheelLayouts[latestState.account?.id??'']??null,listedBots(latestState.bots??[])),host:{platform:process.platform,locale:app.getLocale(),material:windowMaterial,preview,issue:hostIssue,openAtLogin,explorerMenu,menu:shareMenu?.status??{available:false,needsUpdate:true,registered:0},cli:cliPublic()}});
const update=()=>{const state=publicState();notify('state',state);nativeUI?.send({command:'state',...state});scheduleBotAvatars();};
const issue=code=>{if(!code||code==='ACCOUNT_BUSY')return;hostIssue=code;update();};
const errorCode=error=>/^[A-Z][A-Z0-9_]{1,70}$/.test(error?.message??'')?error.message:'OPERATION_FAILED';

function scheduleBotAvatars(){
  if(!nativeUI?.ready||process.platform!=='darwin'||(preview&&process.argv.includes('--native-settings-self-test')))return;
  const bots=latestState.bots??[];
  const signature=JSON.stringify(bots.map(bot=>[bot.id,bot.avatarShape,bot.avatarColor,bot.avatar,bot.memberAgentIds]));
  if(signature===avatarSignature)return;
  avatarSignature=signature;avatarRefreshQueued=true;
  if(avatarRefreshRunning)return;
  avatarRefreshRunning=true;
  void(async()=>{try{while(avatarRefreshQueued){
    avatarRefreshQueued=false;const version=avatarSignature;const state={...latestState,bots:[...(latestState.bots??[])]};
    const page=app.isPackaged?join(process.resourcesPath,'native/avatar/index.html'):join(here,'../../bundle-resources/native/avatar/index.html');
    const images=state.bots.length?await captureBotAvatars(state,page,(botId,png)=>{if(version===avatarSignature){avatarCache[botId]=png;nativeUI?.send({command:'avatar',botId,png});}}):{};
    if(version===avatarSignature){avatarCache=images;nativeUI?.send({command:'avatars',images});}
  }}catch(error){console.warn('Bot avatars:',error?.message??'error');}finally{avatarRefreshRunning=false;if(avatarRefreshQueued){avatarSignature='';scheduleBotAvatars();}}})();
}
function paintChrome(){if(!window||window.isDestroyed()||process.platform!=='darwin')return;window.setBackgroundColor('#00000000');}
nativeTheme.on('updated',paintChrome);
function loadComposerPrefs(){
  try{const parsed=JSON.parse(readFileSync(join(app.getPath('userData'),'composer-prefs.json'),'utf8'));composerPrefs={afterSend:parsed.afterSend==='open'?'open':'hide',dismissOnOutside:parsed.dismissOnOutside!==false};}
  catch{composerPrefs={afterSend:'hide',dismissOnOutside:true};}
}
function saveComposerPrefs(){try{writeFileSync(join(app.getPath('userData'),'composer-prefs.json'),JSON.stringify(composerPrefs));}catch{}}
function cliConfigDir(){return process.platform==='win32'?join(app.getPath('localAppData'),'GrokBot Quick','cli'):join(app.getPath('userData'),'cli');}
function loadCliPref(){try{const parsed=JSON.parse(readFileSync(join(app.getPath('userData'),'cli-enabled.json'),'utf8'));return {enabled:parsed.enabled===true,pathSnippet:parsed.pathSnippet===true};}catch{return {enabled:false,pathSnippet:false};}}
function saveCliPref(pref){try{writeFileSync(join(app.getPath('userData'),'cli-enabled.json'),JSON.stringify({enabled:!!pref.enabled,pathSnippet:!!pref.pathSnippet}));}catch{}}
function loadWheelLayouts(){try{const value=JSON.parse(readFileSync(join(app.getPath('userData'),'wheel-layouts.json'),'utf8'));wheelLayouts=value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{wheelLayouts={};}}
function setWheelSlot(params){
 const account=latestState.account?.id;if(!account)throw new Error('LOGIN_REQUIRED');
 const bots=listedBots(latestState.bots??[]);const changed=changeWheelSlot(wheelLayouts[account]??null,params.ring,params.index,params.botId??'',bots);
 const next={...wheelLayouts,[account]:changed},file=join(app.getPath('userData'),'wheel-layouts.json'),tmp=`${file}.${process.pid}.tmp`;
 writeFileSync(tmp,JSON.stringify(next),{mode:0o600});renameSync(tmp,file);wheelLayouts=next;update();return changed;
}
function loadShellPrefs(){
  try{const parsed=JSON.parse(readFileSync(join(app.getPath('userData'),'login-item.json'),'utf8'));loginItemKnown=true;openAtLogin=parsed.enabled===true;}catch{loginItemKnown=false;openAtLogin=false;}
  try{explorerMenu=JSON.parse(readFileSync(join(app.getPath('userData'),'explorer-menu.json'),'utf8')).enabled!==false;}catch{explorerMenu=true;}
}
function saveExplorerPref(){try{writeFileSync(join(app.getPath('userData'),'explorer-menu.json'),JSON.stringify({enabled:explorerMenu===true}));}catch{}}
function saveLoginPref(){try{writeFileSync(join(app.getPath('userData'),'login-item.json'),JSON.stringify({enabled:openAtLogin}));}catch{}}
let notifyIcon;
function notificationIcon(){
  if(process.platform!=='win32')return null;
  if(!notifyIcon||notifyIcon.isEmpty())notifyIcon=nativeImage.createFromBuffer(coalBallPng(256));
  return notifyIcon.isEmpty()?null:notifyIcon;
}
function systemNotification(payload){
  const icon=notificationIcon();
  return new Notification({...payload,...icon?{icon}:{}});
}
function trayImage(){
  const image=nativeImage.createEmpty();
  const icons=process.platform==='darwin'?trayIconImages('darwin'):[coalBallIcon(16),coalBallIcon(32)].map(icon=>({png:icon.png,size:icon.width,scale:icon.width/16,template:false}));
  for(const icon of icons)image.addRepresentation({scaleFactor:icon.scale,width:icon.size/icon.scale,height:icon.size/icon.scale,dataURL:`data:image/png;base64,${icon.png.toString('base64')}`});
  if(icons.some(icon=>icon.template))image.setTemplateImage(true);
  return image;
}
function showDock(){
  if(process.platform!=='darwin'||!dockHidden)return;
  try{app.setActivationPolicy('regular');}catch{}
  try{app.dock?.show();}catch{}
  dockHidden=false;
}
function hideDock(){
  if(process.platform!=='darwin'||quitting||dockHidden)return;
  try{app.setActivationPolicy('accessory');}catch{}
  try{app.dock?.hide();}catch{}
  dockHidden=true;
}
function composerVisible(){
  return [floatWindow,avatarWindow,pickerWindow].some(target=>target&&!target.isDestroyed()&&target.isVisible());
}
function waitForComposerReady(generation){
  return new Promise(resolve=>{
    const started=Date.now();
    const tick=()=>{
      if(generation!==composeGeneration)return resolve(null);
      const ready=composerReadyState;
      if(ready?.generation===generation&&ready.card&&ready.avatar)return resolve(ready);
      if(Date.now()-started>=1200)return resolve(ready?.generation===generation?ready:null);
      setTimeout(tick,16);
    };
    tick();
  });
}
async function showMainWindow({legacy=false,section='general',botId=''}={}){
  if(process.platform==='darwin'&&!smoke){if(!nativeUI?.ready)throw new Error('NATIVE_UI_UNAVAILABLE');nativeUI.send({command:'state',...publicState()});nativeUI.send({command:'showSettings',section,botId});return;}
  if(!window||window.isDestroyed())await createWindow();
  if(!window||window.isDestroyed())return;
  await window.webContents.executeJavaScript(`new Promise(resolve=>{if(document.documentElement.dataset.ready==='true')return resolve();const t=setInterval(()=>{if(document.documentElement.dataset.ready==='true'){clearInterval(t);resolve();}},50);setTimeout(()=>{clearInterval(t);resolve();},5000);})`);
  if(process.platform!=='darwin')showDock();
  if(window.isMinimized())window.restore();
  window.show();
  window.focus();
}
function applyAppIcon(){
  if(smoke||preview||process.platform!=='darwin')return;
  try{const image=nativeImage.createFromBuffer(coalBallAppPng(1024,{platform:'darwin'}));if(!image.isEmpty())app.dock?.setIcon(image);}catch{}
}
function ensureTray(){
  if(tray||smoke||preview)return;
  if(process.platform!=='darwin'&&process.platform!=='win32')return;
  const image=trayImage();
  if(!image||image.isEmpty())return;
  tray=new Tray(image);
  tray.setToolTip('GrokBot Quick');
  tray.on('click',()=>void showQuickPanel('menu'));
  tray.on('right-click',()=>void showQuickPanel('menu'));
}
async function showQuickPanel(kind){
  if(process.platform==='darwin'&&nativeUI?.ready){nativeUI.send({command:'state',...publicState()});nativeUI.send({command:'avatars',images:avatarCache});nativeUI.send({command:'show',mode:kind==='wheel'?'wheel':'list',anchor:kind==='wheel'?{}:(tray?.getBounds()??{})});return;}
  if(process.platform==='darwin'&&!smoke){console.error('Native UI unavailable');return;}
  const isWheel=kind==='wheel';
  let target=isWheel?wheelWindow:panelWindow;
  if(target&&!target.isDestroyed()&&target.isVisible()){target.hide();return;}
  if(!target||target.isDestroyed()){
    target=new BrowserWindow({width:isWheel?500:330,height:isWheel?500:510,show:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,skipTaskbar:true,alwaysOnTop:true,hasShadow:false,webPreferences:{preload:join(here,'../preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    if(isWheel)wheelWindow=target;else panelWindow=target;
    wireFloat(target,isWheel?'Wheel':'Menu');
    target.on('blur',()=>target.hide());
    target.on('closed',()=>{if(isWheel)wheelWindow=null;else panelWindow=null;});
    await target.loadFile(join(here,'../../src/renderer/quick.html'),{query:{mode:kind}});
  }
  const point=screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(point),area=display.workArea;
  const anchor=!isWheel&&tray?tray.getBounds():{x:point.x,y:point.y,width:0,height:0};
  if(!isWheel){target.setSize(330,510);quickPanelRestoredBounds=null;}
  const bounds=target.getBounds();
  const x=Math.max(area.x,Math.min(area.x+area.width-bounds.width,Math.round(anchor.x+anchor.width/2-bounds.width/2)));
  const y=Math.max(area.y,Math.min(area.y+area.height-bounds.height,Math.round(isWheel?point.y-bounds.height/2:anchor.y+anchor.height+4)));
  target.setPosition(x,y);if(!isWheel)target.webContents.send('grokbotQuick:event',{event:'quick-reset'});target.webContents.send('grokbotQuick:event',{event:'state',data:publicState()});target.show();target.focus();
}
function runTray(action){
  if(action==='show-main'){showMainWindow();return;}
  if(action==='open-composer'){const bot=lastAwakeBot();if(bot)void openComposer(bot.id).catch(error=>issue(errorCode(error)));else showMainWindow();return;}
  if(action==='quit'){quitting=true;app.quit();}
}
const explorerSync=createExplorerSync();
function explorerOps(){
  return explorerRegistryOps({executable:process.execPath,appArgs:app.isPackaged?[]:[app.getAppPath()],bots:latestState.bots??[],recipients:latestState.recipients??[],enabled:explorerMenu!==false});
}
function applyExplorer(ops){
  return applyExplorerRegistry(ops,{platform:process.platform,execFile:(file,args,options)=>runProcess(file,args,{windowsHide:true,...options})});
}
function syncExplorer(){
  if(process.platform!=='win32'||preview)return;
  void explorerSync.schedule(explorerOps(),applyExplorer).then(result=>{
    if(result?.applied&&hostIssue==='EXPLORER_SYNC_FAILED'){hostIssue=null;update();}
  }).catch(()=>issue('EXPLORER_SYNC_FAILED'));
}
async function logExplorerReject(argv,botId,reason){
  try{
    const dir=join(app.getPath('userData'),'logs');
    await mkdir(dir,{recursive:true});
    const file=join(dir,'explorer-forward.log');
    let previous='';
    try{previous=readFileSync(file,'utf8');}catch{previous='';}
    writeFileSync(file,trimExplorerLog(previous,explorerLogLine({at:new Date().toISOString(),argv,botId,state:latestState,reason})));
  }catch{}
}
async function deliverExplorer(forward){
  if(!forward?.botId)return;
  const verdict=await resolveExplorerForward({read:()=>({botId:forward.botId,bots:latestState.bots,recipients:latestState.recipients,connected:latestState.connected===true,hasAccount:!!latestState.account,settled:explorerSettled})});
  if(!verdict.accept){
    await logExplorerReject(forward.argv??[],verdict.botId||forward.botId,verdict.reason);
    if(!preview&&Notification.isSupported())systemNotification(explorerRejectNotice(app.getLocale?.()??'',verdict.reason)).show();
    return;
  }
  const appArg=app.isPackaged?'':app.getAppPath();
  const files=(forward.files??[]).filter(file=>typeof file==='string'&&isAbsolute(file)&&file!==appArg);
  if(!files.length)return;
  const item=await rpc.call('receive',{botId:verdict.botId,source:'share',files,manual:true},RECEIVE_TIMEOUT);
  await openComposer(verdict.botId,item);
}
const explorerBatch=createExplorerBatch();
const launchForward=parseExplorerForward(process.argv);
if(launchForward){launchForward.argv=process.argv;explorerBatch.push(launchForward);}
function deeplinkIssue(code){
  const safe=errorCode({message:code});
  notify('toast',safe);
  const visible=!!window&&!window.isDestroyed()&&window.isVisible();
  if(visible||preview||!Notification.isSupported())return;
  systemNotification({title:'GrokBot Quick',body:deeplinkNotice(app.getLocale?.()??'',safe)}).show();
}
function acceptDeeplink(raw){
  const text=String(raw??'').trim().replace(/^"(.*)"$/,'$1');
  if(!text.startsWith('grokbotquick:'))return false;
  if(preview)return true;
  if(!deeplinkReady){pendingLinks.push(text);return true;}
  deeplinkChain=deeplinkChain.then(()=>handleDeeplink(text)).catch(error=>deeplinkIssue(errorCode(error)));
  return true;
}
// A Windows share names a batch, not a Bot: read the batch the helper wrote,
// show the frameless picker, and run the same receive/submit path the composer
// uses. Cancelling (Esc, blur, or the button) discards the batch.
let sharePickerWindow=null,sharePending=null;
function ensureSharePickerWindow(){
  if(sharePickerWindow&&!sharePickerWindow.isDestroyed())return sharePickerWindow;
  sharePickerWindow=new BrowserWindow({
    width:380,height:260,frame:false,transparent:true,resizable:false,maximizable:false,minimizable:false,
    fullscreenable:false,skipTaskbar:true,alwaysOnTop:true,show:false,hasShadow:true,backgroundColor:'#00000000',
    webPreferences:{preload:join(here,'../preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}
  });
  sharePickerWindow.on('closed',()=>{sharePickerWindow=null;});
  sharePickerWindow.on('blur',()=>{if(sharePending)void cancelShare();});
  void sharePickerWindow.loadFile(join(here,'../../out/share-picker.html'));
  return sharePickerWindow;
}
function closeSharePicker(){
  const target=sharePickerWindow;
  sharePickerWindow=null;
  if(target&&!target.isDestroyed())target.close();
}
function dropShareBatch(){
  if(!sharePending)return;
  try{rmSync(sharePending.dir,{recursive:true,force:true});}catch{}
  sharePending=null;
}
function cancelShare(){closeSharePicker();dropShareBatch();}
async function openSharePicker(batch){
  const dir=join(app.getPath('userData'),'share-pending',batch);
  let manifest;
  try{manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));}catch{return;}
  sharePending={dir,batch,manifest,files:(manifest.files??[]).map(file=>file.path).filter(Boolean),text:manifest.text??''};
  const panel=ensureSharePickerWindow();
  panel.show();
  panel.focus();
}
function sharePickerPayload(){
  if(!sharePending)return {bots:[],fileCount:0};
  const bots=pickerBots(latestState,{allSources:process.platform==='win32'}).map(entry=>{
    const bot=(latestState.bots??[]).find(item=>item.id===entry.botId)??{};
    return {
      botId:entry.botId,
      name:entry.name,
      avatarShape:bot.avatarShape,
      avatarColor:bot.avatarColor,
      avatarPicture:bot.avatar?.kind==='picture'?bot.avatar.picture?.url??'':'',
      running:(latestState.runtime?.statuses??[]).some(row=>row.agentId===entry.botId&&row.isRunning)
    };
  });
  return {bots,fileCount:sharePending.files.length};
}
async function confirmShare(botId){
  if(!sharePending)return {ok:false};
  const {files,text,dir}=sharePending;
  // The Bot decides where this lands: "先放进输入框" must open the composer,
  // only a direct Bot submits straight away.
  const recipient=(latestState.recipients??[]).find(row=>row.botId===botId);
  const mode=recipient?.mode==='direct'?'direct':'compose';
  try{
    const receipt=await rpc.call('receive',{botId,source:'wechat',text,files,manual:mode!=='direct'},RECEIVE_TIMEOUT);
    if(mode==='direct'){
      // receive() already sends direct receipts when the account is connected.
      // Submit only when it could not start (offline/transition), or the same
      // receipt is submitted twice and the second call reports a false failure.
      const result=receipt.status==='needs-input'?await rpc.call('submit',{id:receipt.id,text,files},0):receipt;
      if(result.status!=='sent'){
        issue(result.status==='unconfirmed'?'SEND_UNCONFIRMED':result.status==='expired'?'SEND_EXPIRED':'SEND_FAILED');
        return {ok:false};
      }
    }else{
      // openComposer owns revealing and focusing the composer now.
      await openComposer(botId,receipt);
    }
    try{rmSync(dir,{recursive:true,force:true});}catch{}
    sharePending=null;
    closeSharePicker();
    return {ok:true};
  }catch(error){issue(errorCode(error));return {ok:false};}
}
async function handleDeeplink(raw){
  if(preview)return;
  const parsed=parseDeeplink(raw);
  if(!parsed.ok){deeplinkIssue('DEEPLINK_IGNORED');return;}
  if(parsed.action==='open'){showMainWindow();return;}
  if(parsed.action==='share'){await openSharePicker(parsed.batch);return;}
  if(parsed.action==='compose'){
    const bot=parsed.bot?(latestState.bots??[]).find(item=>item.id===parsed.bot):lastAwakeBot();
    if(!bot){if(parsed.bot)deeplinkIssue('BOT_NOT_FOUND');else showMainWindow();return;}
    if(parsed.hasText){
      if(!latestState.connected){deeplinkIssue('LOGIN_REQUIRED');return;}
      const recipient=(latestState.recipients??[]).find(item=>item.botId===bot.id);
      if(!shortcutSourceAllowed(recipient)){deeplinkIssue('SOURCE_DISABLED');return;}
    }
    try{await openComposer(bot.id,undefined,{text:parsed.hasText?parsed.text:undefined,captureSelection:!parsed.hasText});}
    catch(error){deeplinkIssue(errorCode(error));}
    return;
  }
  const bot=(latestState.bots??[]).find(item=>item.id===parsed.bot);
  if(!latestState.connected){deeplinkIssue('LOGIN_REQUIRED');return;}
  if(!bot){deeplinkIssue('BOT_NOT_FOUND');return;}
  const recipient=(latestState.recipients??[]).find(item=>item.botId===bot.id);
  if(!shortcutSourceAllowed(recipient)){deeplinkIssue('SOURCE_DISABLED');return;}
  try{
    const item=await rpc.call('receive',{botId:bot.id,source:'shortcuts',text:parsed.text,manual:true},RECEIVE_TIMEOUT);
    if(item?.error)deeplinkIssue(item.error);
    if(item?.mode==='compose')await openComposer(bot.id,item);
  }catch(error){deeplinkIssue(errorCode(error));}
}
if(process.platform!=='darwin')for(const arg of process.argv)if(String(arg).includes('grokbotquick://'))acceptDeeplink(arg);
function cliBundle(){return app.isPackaged?skillBundleDir({packaged:true,resourcesPath:process.resourcesPath}):join(here,'../../bundle-resources/grok-bot-skill/grok-bot');}
async function syncCliCredential(credentials){
  if(!cliStatus.enabled||preview)return;
  cliStatus.credential=await writeCliCredential(cliConfigDir(),credentials);
  cliStatus.error='';
}
async function forgetCliCredential(){
  if(preview)return;
  try{await writeCliCredential(cliConfigDir(),null);cliStatus.credential=false;}
  catch(error){cliStatus.error=errorCode(error);}
}
async function setCliEnabled(enabled){
  if(preview)throw new Error('PREVIEW_ONLY');
  if(!enabled){
    const pref=loadCliPref();
    cliStatus=await disableCli({home:homedir(),platform:process.platform,configDir:cliConfigDir(),removePath:pref.pathSnippet});
    saveCliPref({enabled:false,pathSnippet:false});
    update();
    return cliPublic();
  }
  const saved=loadCliPref();
  let credentials=null;
  try{credentials=await vault.load();}catch(error){if(error?.message==='CREDENTIAL_STORAGE_UNAVAILABLE')throw error;}
  cliStatus=await enableCli({home:homedir(),platform:process.platform,pathEnv:process.env.PATH??'',bundleDir:cliBundle(),configDir:cliConfigDir(),runtime:process.execPath,credentials,savedPathSnippet:saved.pathSnippet});
  saveCliPref({enabled:true,pathSnippet:!!cliStatus.pathSnippet});
  update();
  return cliPublic();
}
function rankedBots(){
  const bots=latestState.bots??[],recipients=latestState.recipients??[];
  const order=id=>recipients.find(item=>item.botId===id)?.order??0;
  return bots.map((bot,index)=>({bot,index,order:order(bot.id)})).sort((a,b)=>a.order-b.order||a.index-b.index).map(item=>item.bot);
}
function lastAwakeBot(){
  const bots=rankedBots();
  return bots.find(bot=>bot.id===activeBotId)??bots[0]??null;
}
function unregisterShortcuts(){
  for(const accelerator of registeredShortcuts.keys()){try{globalShortcut.unregister(accelerator);}catch{}}
  registeredShortcuts.clear();
}
function shortcutTargets(map){
  const wanted=new Map();
  if(typeof map?.wheel==='string'&&map.wheel)wanted.set(map.wheel,'wheel');
  if(process.platform==='darwin'&&typeof map?.screenshot==='string'&&map.screenshot)wanted.set(map.screenshot,'screenshot');
  if(process.platform==='darwin'&&typeof map?.compose==='string'&&map.compose)wanted.set(map.compose,'compose');
  if(process.platform==='darwin')for(const [id,key] of Object.entries(map?.bots??{}))if(key&&rankedBots().some(bot=>bot.id===id))wanted.set(key,id);
  return wanted;
}
function layoutExtras(){
  if(!floatWindow||floatWindow.isDestroyed()||!floatWindow.isVisible())return;
  if(composerBar){
    for(const extra of [avatarWindow,pickerWindow])if(extra&&!extra.isDestroyed()&&extra.isVisible())extra.hide();
    return;
  }
  const card=floatWindow.getBounds();
  const area=screen.getDisplayMatching(card).workArea;
  // The 104px window carries an 8px transparent inset so the avatar's drop
  // shadow is not clipped by the window edge.
  const avatarBox=104,avatarPad=8,avatarGap=6;
  const avatarY=Math.round(card.y-avatarBox+avatarPad-avatarGap);
  const avatarTop=avatarY+avatarPad;
  if(avatarWindow&&!avatarWindow.isDestroyed()){
    const x=Math.round(card.x+(card.width-avatarBox)/2);
    if(avatarY>=area.y){
      avatarWindow.setBounds({x,y:avatarY,width:avatarBox,height:avatarBox},false);
      if(!avatarWindow.isVisible())avatarWindow.showInactive();
    }else if(avatarWindow.isVisible())avatarWindow.hide();
  }
  if(!pickerWindow||pickerWindow.isDestroyed())return;
  if(!pickerOpen){if(pickerWindow.isVisible())pickerWindow.hide();return;}
  const width=Math.min(Math.max(320,pickerSize.width),Math.max(320,area.width-16));
  const above=avatarTop-area.y-8;
  const below=area.y+area.height-(card.y+card.height)-8;
  const preferAbove=above>=80||above>=below;
  const available=Math.max(80,(preferAbove?above:below-8));
  const height=Math.min(Math.max(80,pickerSize.height),available,Math.max(80,area.height-16));
  const y=preferAbove?avatarTop-8-height:card.y+card.height+8;
  const x=Math.round(card.x+(card.width-width)/2);
  pickerWindow.setBounds({
    x:Math.min(Math.max(area.x+8,x),Math.max(area.x+8,area.x+area.width-width-8)),
    y:Math.min(Math.max(area.y+8,y),Math.max(area.y+8,area.y+area.height-height-8)),
    width,height
  },false);
  if(!pickerWindow.isVisible())pickerWindow.showInactive();
}
function placeFloat(width,height){
  if(!floatWindow||floatWindow.isDestroyed())return;
  const current=floatWindow.getBounds();
  const display=floatMoved?screen.getDisplayMatching(current):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area=display.workArea;
  const bounds=composerBounds({workArea:area,current,width,height,moved:floatMoved});
  lastFloatBounds=bounds;
  floatWindow.setBounds(bounds,false);
  layoutExtras();
}
function placePicker(width,height){
  pickerSize={width:Math.round(width)||760,height:Math.round(height)||188};
  layoutExtras();
}
function hideFloat({clearAttachments=false}={}){
  keepFloatOpen=false;
  composerBar=false;
  suppressActivate=true;
  setTimeout(()=>{suppressActivate=false;},400);
  pickerOpen=false;
  if(clearAttachments){
    notify('composer-clear',{attachments:true});
    if(pendingFloat){
      if(pendingFloat.id){
        const id=pendingFloat.id;
        pendingFloat={...pendingFloat,files:[]};
        if(rpc)void rpc.call('dismissComposer',{id}).catch(()=>{});
      }else pendingFloat={...pendingFloat,localPaths:[]};
    }
  }
  for(const extra of [avatarWindow,pickerWindow])if(extra&&!extra.isDestroyed()&&extra.isVisible())extra.hide();
  if(!floatWindow||floatWindow.isDestroyed()||!floatWindow.isVisible())return;
  floatWindow.hide();
  // Do not blur the main window after hiding the composer. On macOS, blurring
  // the only visible regular window makes AppKit order it out, which looks like
  // the main window closing with the composer.
}
function wireFloat(target,label){
  target.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  target.webContents.on('will-navigate',event=>event.preventDefault());
  target.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  if(smoke)target.webContents.on('console-message',details=>{if(details.level==='error')console.error(`${label}:`,details.message);});
  bindWindowsEditKeys(target.webContents);
}
async function ensureFloat(){
  if(floatWindow&&!floatWindow.isDestroyed())return floatWindow;
  const mac=process.platform==='darwin';
  const traits=floatingComposerTraits(process.platform);
  const common={show:false,frame:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:traits.skipTaskbar,transparent:traits.transparent,hasShadow:false,roundedCorners:false,backgroundColor:'#00000000',excludedFromShownWindowsMenu:true,...(traits.thickFrame===false?{thickFrame:false}:{}),webPreferences:{preload:join(here,'../preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false}};
  // One CSS corner. Native rounding, vibrancy, or acrylic draws a second outline around the card.
  floatWindow=new BrowserWindow({...common,movable:true,width:368,height:120,acceptFirstMouse:true,title:'GrokBot Quick'});
  // On macOS attached child windows follow the card inside AppKit's native drag
  // loop. Updating them from the move event made the avatar trail the drag by
  // frames. Windows keeps the event-driven layout until it is verified on hardware.
  const child=process.platform==='darwin'?{parent:floatWindow}:{};
  avatarWindow=new BrowserWindow({...common,...child,width:104,height:104,focusable:false});
  pickerWindow=new BrowserWindow({...common,...child,width:760,height:188,acceptFirstMouse:true});
  for(const target of [floatWindow,avatarWindow,pickerWindow]){if(traits.alwaysOnTop){if(mac)target.setAlwaysOnTop(true,'floating');else target.setAlwaysOnTop(true);}try{target.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:true});}catch{target.setVisibleOnAllWorkspaces(true);}}
  avatarWindow.setIgnoreMouseEvents(true);
  wireFloat(floatWindow,'Composer');wireFloat(avatarWindow,'Avatar');wireFloat(pickerWindow,'Picker');
  floatWindow.on('blur',()=>{setTimeout(()=>{if(suspendFloatDismiss||keepFloatOpen||!composerPrefs.dismissOnOutside||Date.now()-floatShownAt<500)return;const focused=BrowserWindow.getFocusedWindow();if(floatWindow?.isFocused()||focused===pickerWindow||focused===avatarWindow)return;hideFloat({clearAttachments:true});},120);});
  // The card is frameless but draggable from its grip. Programmatic placement
  // also emits move; only a different position means the user moved it.
  floatWindow.on('move',()=>{
    if(!floatWindow||floatWindow.isDestroyed())return;
    const bounds=floatWindow.getBounds();
    if(lastFloatBounds&&bounds.x===lastFloatBounds.x&&bounds.y===lastFloatBounds.y&&bounds.width===lastFloatBounds.width&&bounds.height===lastFloatBounds.height)return;
    lastFloatBounds=bounds;floatMoved=true;
    if(process.platform!=='darwin')layoutExtras();
  });
  floatWindow.on('closed',()=>{floatWindow=null;});
  avatarWindow.on('closed',()=>{avatarWindow=null;});
  pickerWindow.on('closed',()=>{pickerWindow=null;});
  await Promise.all([
    floatWindow.loadFile(join(here,'../../out/composer.html')),
    avatarWindow.loadFile(join(here,'../../out/composer.html'),{query:{part:'avatar'}}),
    pickerWindow.loadFile(join(here,'../../out/composer.html'),{query:{part:'picker'}})
  ]);
  return floatWindow;
}
function applyShortcuts(map){
  if(smoke||preview||shortcutsSuppressed)return;
  const wanted=shortcutTargets(map);
  let same=wanted.size===registeredShortcuts.size;
  if(same)for(const [accelerator,slot] of wanted)if(registeredShortcuts.get(accelerator)!==slot)same=false;
  if(same)return;
  unregisterShortcuts();
  let failed=false;
  for(const [accelerator,slot] of wanted){
    let registered=false;
    try{registered=globalShortcut.register(accelerator,()=>{
      if(slot==='wheel'){void showQuickPanel('wheel');return;}
      if(slot==='screenshot'){nativeUI?.send({command:'captureScreen'});return;}
      if(slot==='compose'){nativeUI?.send({command:'toggleBar'});return;}
      if(process.platform==='darwin'){if(rankedBots().some(bot=>bot.id===slot))void openComposer(slot,undefined,{captureSelection:false});return;}
      const grok=slot.startsWith('grok:')?slot.slice(5):'';
      const bot=slot==='compose'||slot==='open'?lastAwakeBot():rankedBots().find(item=>item.id===(grok||slot));
      if(!bot){showMainWindow();return;}
      activeBotId=bot.id;update();
      const action=openInGrokBot(bot.id);
      void action.catch(error=>issue(errorCode(error)));
    });}catch{registered=false;}
    if(!registered){failed=true;continue;}
    registeredShortcuts.set(accelerator,slot);
  }
  if(failed)issue('SHORTCUT_UNAVAILABLE');
  else if(hostIssue==='SHORTCUT_UNAVAILABLE'){hostIssue=null;update();}
}
async function readShareOrder(){
  const current=()=>menuEntries(latestState).map(entry=>entry.botId);
  if(process.platform==='darwin'){
    try{
      const {stdout}=await runProcess('swift',[join(here,'../../scripts/probe-share.swift')],{timeout:25000,maxBuffer:1024*1024});
      const ids=matchShareTitles(stdout.split('\n'),menuEntries(latestState));
      if(ids.length)return {ids,source:'wechat'};
    }catch{}
    const known=new Set((latestState.bots??[]).map(bot=>bot.id));
    const ids=(shareMenu?.installed?.entries??[]).filter(entry=>entry.slot>=1&&entry.slot<=12&&known.has(entry.botId)).sort((a,b)=>a.slot-b.slot).map(entry=>entry.botId);
    if(ids.length)return {ids,source:'installed'};
  }
  return {ids:current(),source:'settings'};
}
function enabledShareBots(){return rankedBots().filter(bot=>{const recipient=(latestState.recipients??[]).find(row=>row.botId===bot.id);return recipient?.enabled&&recipient.sources?.wechat;}).slice(0,12);}
async function applyShareOrder(ids){for(let index=0;index<ids.length;index++){const row=(latestState.recipients??[]).find(item=>item.botId===ids[index]);if((row?.order??0)!==index)await rpc.call('configure',{botId:ids[index],patch:{order:index}});}}
async function moveShare(botId,delta){
 if(![-1,1].includes(delta))throw new Error('METHOD_UNKNOWN');
 const all=rankedBots().map(bot=>bot.id),ids=enabledShareBots().map(bot=>bot.id),index=ids.indexOf(botId),next=index+delta;
 if(index<0||next<0||next>=ids.length)return {ok:true};
 const moved=ids.slice();[moved[index],moved[next]]=[moved[next],moved[index]];await applyShareOrder(spliceWechatOrder(all,ids,moved));return {ok:true};
}
async function syncReadShareOrder(){const result=await readShareOrder();if(result.source==='wechat'||result.source==='installed')await applyShareOrder(spliceWechatOrder(rankedBots().map(bot=>bot.id),enabledShareBots().map(bot=>bot.id),result.ids??[]));return result;}
async function openInGrokBot(botId){
  if(!(latestState.bots??[]).some(bot=>bot.id===botId))throw new Error('BOT_NOT_FOUND');
  const url=grokBotAgentUrl(botId);
  try{await shell.openExternal(url);}catch{throw new Error('GROK_BOT_OPEN_FAILED');}
  return {ok:true};
}
async function openComposer(botId,receipt,options={}){
  if(latestState.accountBusy)throw new Error('ACCOUNT_BUSY');
  if(receipt&&(receipt.accountId!==latestState.account?.id||receipt.botId!==botId))throw new Error('RECEIPT_SCOPE_MISMATCH');
  const bot=latestState.bots?.find(item=>item.id===botId);if(!bot)throw new Error('BOT_NOT_FOUND');
  if(process.platform==='darwin'&&!smoke){
    if(!nativeUI?.ready)throw new Error('NATIVE_UI_UNAVAILABLE');
    const localPaths=!receipt&&!options.preparing&&options.captureSelection!==false?await frontmostFiles():[];
    nativeUI.send({command:'openChat',botId,text:typeof options.text==='string'?options.text:undefined,files:localPaths,receipt:receipt?{id:receipt.id,botId,text:receipt.text??'',files:(receipt.files??[]).map(file=>({name:file.name}))}:undefined});
    activeBotId=botId;update();return {ok:true};
  }
  const mainWasVisible=!!window&&!window.isDestroyed()&&window.isVisible();
  const dismissWasSuspended=suspendFloatDismiss;
  keepFloatOpen=options.keepOpen===true;
  suspendFloatDismiss=true;
  if(!mainWasVisible)hideDock();
  const generation=++composeGeneration;
  const preparing=options.preparing??null;
  const capture=!receipt&&!preparing&&options.captureSelection!==false;
  const deferFiles=capture&&process.platform==='win32';
  // macOS reads Finder before focus moves. Windows snapshots the foreground hwnd before show, then reads that window.
  let prepared=null;
  if(deferFiles){
    const pending=prepareExplorerSelection();
    const snap=await Promise.race([pending.hwndReady.then(info=>({info})),new Promise(resolve=>setTimeout(()=>resolve({info:'TIMEOUT'}),2500))]);
    if(generation!==composeGeneration)return {ok:true};
    if(snap.info!=='TIMEOUT')prepared=pending;
  }
  const localPaths=capture&&!deferFiles?await frontmostFiles():[];
  if(generation!==composeGeneration)return {ok:true};
  activeBotId=botId;
  const draftText=typeof options.text==='string'?options.text:undefined;
  const attachToken=deferFiles?generation:0;
  composerBar=false;
  pendingFloat=receipt?{id:receipt.id,botId,text:receipt.text??'',title:receipt.title??'',files:(receipt.files??[]).map(({name,bytes},index)=>({name,bytes,index})),botName:receipt.botName??bot.name}:preparing?{botId,text:'',preparing,botName:bot.name}:{botId,focus:true,localPaths,...attachToken?{attachToken}:{},...draftText!==undefined?{text:draftText}:{}};
  composerReadyState={generation,card:null,avatar:false};
  const float=await ensureFloat();
  const entering=!float.isVisible();
  placeFloat(368,110);
  if(entering){try{float.setOpacity(0);avatarWindow?.setOpacity(0);}catch{}}
  floatShownAt=Date.now();
  float.setIgnoreMouseEvents(false);
  suppressActivate=true;
  const mainVisible=!!window&&!window.isDestroyed()&&window.isVisible();
  if(!mainVisible){
    // Enter accessory mode before showing anything: otherwise the Dock icon
    // appears for a frame and has to disappear again.
    hideDock();
    float.show();
  }else float.show();
  float.focus();
  if(!mainVisible)hideDock();
  setTimeout(()=>{suppressActivate=false;},400);
  layoutExtras();
  notify('composer',pendingFloat);
  const ready=await waitForComposerReady(generation);
  if(generation!==composeGeneration)return {ok:true};
  const card=ready?.card??{width:368,height:110};
  placeFloat(card.width,card.height);
  notify('composer-show',{});
  // WeChat/share handoffs can open the composer while another app is frontmost.
  // showInactive avoids the Dock flash, so explicitly activate the accessory app
  // and refocus the text field after the card has rendered.
  if(process.platform==='darwin'){try{app.focus({steal:true});}catch{}}
  float.focus();
  notify('composer-focus',{});
  if(!mainVisible)setTimeout(hideDock,120);
  setTimeout(()=>{suspendFloatDismiss=dismissWasSuspended;},1500);
  setTimeout(()=>{try{float.setOpacity(1);avatarWindow?.setOpacity(1);}catch{}},20);
  if(prepared){
    const token=attachToken;
    const openedFor=botId;
    void prepared.files().then(async paths=>{
      if(token!==composeGeneration)return;
      const localPaths=await regularFiles(Array.isArray(paths)?paths:[]);
      if(token!==composeGeneration)return;
      notify('composer-files',{botId:openedFor,token,localPaths});
    }).catch(()=>{});
  }
  return {ok:true};
}
async function intake(botId,files){
  if(!Array.isArray(files)||files.length>100||files.some(p=>typeof p!=='string'))throw new Error('ATTACHMENT_INVALID');
  const item=await rpc.call('receive',{botId,source:'drop',files},RECEIVE_TIMEOUT);
  if(item.mode==='compose')await openComposer(botId,item);
  return {id:item.id};
}
async function presentShare(id){
  try{const item=await rpc.call('composer',{id});await openComposer(item.botId,item,{keepOpen:true});}
  catch(error){if(errorCode(error)!=='RECEIPT_NOT_SENDABLE'&&errorCode(error)!=='RECEIPT_NOT_FOUND')issue(errorCode(error));}
}
function presentPendingComposer(){
  const pending=(latestState.inbox??[]).filter(item=>item.status==='needs-input'&&item.phase==='ready'&&!item.queue&&!item.composerDismissed&&shareHandoff({mode:item.mode})==='composer');
  const item=pending.sort((a,b)=>a.createdAt-b.createdAt).at(-1);
  if(item)void presentShare(item.id);
}
async function sendDraft(botId,text,files,receiptId,remoteKeep){
  if(preview)throw new Error('PREVIEW_ONLY');
  if(typeof text!=='string'||text.length>2_000_000)throw new Error('MESSAGE_INVALID');
  if(files!=null&&(!Array.isArray(files)||files.length>100||files.some(path=>typeof path!=='string'||!path)))throw new Error('ATTACHMENT_INVALID');
  const extra=files??[];
  if(receiptId){
    const item=await rpc.call('composer',{id:receiptId});
    if(item.botId!==botId)throw new Error('RECEIPT_SCOPE_MISMATCH');
    const selected=Array.isArray(remoteKeep)?new Set(remoteKeep.filter(index=>Number.isSafeInteger(index)&&index>=0)):null;
    const kept=selected?item.files.filter((_file,index)=>selected.has(index)):item.files;
    const merged=selected?[...kept.map(file=>file.path),...extra]:(extra.length?[...item.files.map(file=>file.path),...extra]:undefined);
    const result=await rpc.call('submitAsync',{id:receiptId,text,...merged?{files:merged}:selected?{files:[]}:{}},0);
    pendingFloat=null;
    return {id:result.id,status:'sending',error:null};
  }
  if(!text.trim()&&!extra.length)throw new Error('RECEIPT_EMPTY');
  const created=await rpc.call('receive',{botId,source:'drop',manual:true,text,files:extra},RECEIVE_TIMEOUT);
  const result=await rpc.call('submitAsync',{id:created.id,text},0);
  pendingFloat=null;
  return {id:result.id,status:'sending',error:null};
}
async function flushSharedComposers(){
 if(openingSharedComposer||!nativeUI?.ready||latestState.accountBusy)return;
 openingSharedComposer=true;
 try{for(const id of pendingSharedComposers){
  pendingSharedComposers.delete(id);
  try{const item=await rpc.call('composer',{id});await openComposer(item.botId,item);}catch(error){if(errorCode(error)!=='RECEIPT_NOT_SENDABLE'&&errorCode(error)!=='RECEIPT_NOT_FOUND')issue(errorCode(error));}
 }}finally{openingSharedComposer=false;}
}
async function accountAction(method){
  if(preview)throw new Error('PREVIEW_ONLY');
  if(accountBusy)throw new Error('ACCOUNT_BUSY');accountBusy=true;
  try{
    const result=await rpc.call(method,{},600000);
    await vault.save(result.credentials);latestState=result.state;hostIssue=null;try{await syncCliCredential(result.credentials);}catch(error){cliStatus.error=errorCode(error);}update();
    void rpc.call('resume').catch(error=>issue(errorCode(error)));
    return publicState();
  }finally{accountBusy=false;}
}
function tailText(value,limit){
  if(typeof value!=='string'||!value)return '';
  return value.length>limit?`… ${value.length-limit} characters omitted …\n${value.slice(-limit)}`:value;
}
function menuSummary(installed){
  const entries=(installed?.entries??[]).map(entry=>({slot:entry.slot,botName:entry.botName,generation:entry.generation??1,extensionId:entry.extensionId??'',mode:entry.mode??''}));
  return {layoutVersion:installed?.layoutVersion??null,hostPath:installed?.hostPath??'',build:installed?.build??null,entries};
}
async function copyDiagnostics(){
  const root=join(app.getPath('userData'),'ShareInbox');
  const status=shareMenu?.status??{available:false,registered:0,needsUpdate:true};
  const lines=[
    `GrokBot Quick ${app.getVersion()}`,
    `time=${new Date().toISOString()}`,
    `platform=${process.platform} ${process.arch}`,
    `electron=${process.versions.electron??''} node=${process.versions.node??''}`,
    `packaged=${app.isPackaged}`,
    `hostIssue=${hostIssue??''}`,
    `shareMenu=${JSON.stringify({available:!!status.available,registered:status.registered??0,enabled:status.enabled??0,needsUpdate:!!status.needsUpdate,busy:!!status.busy,error:status.error??''})}`,
    `installed=${JSON.stringify(menuSummary(shareMenu?.installed))}`
  ];
  try{
    const finderPid=(await runProcess('/usr/bin/pgrep',['-x','Finder'])).stdout.trim().split('\n')[0];
    const finderStart=(await runProcess('/bin/ps',['-o','lstart=','-p',finderPid])).stdout.trim();
    lines.push(`finder=${finderPid} started=${finderStart}`);
  }catch(error){lines.push(`finder=<${error.code??error.message}>`);}
  try{lines.push(`menu-state-updated=${(await stat(join(root,'menu-state.json'))).mtime.toISOString()}`);}catch{}
  for(const name of ['configuration.json','menu-state.json']){
    try{
      const data=JSON.parse(await readFile(join(root,name),'utf8'));
      const entries=(data.entries??[]).map(entry=>({slot:entry.slot,botName:entry.botName,mode:entry.mode??'',generation:entry.generation??1}));
      lines.push(`${name}=${JSON.stringify({accountId:data.accountId?'[set]':null,entries})}`);
    }catch(error){lines.push(`${name}=<unreadable: ${error.code??error.message}>`);}
  }
  try{
    const log=await readFile(join(root,'menu-update.log'),'utf8');
    lines.push('','menu-update.log (tail):',tailText(log,30000));
  }catch(error){
    lines.push('',`menu-update.log=<${error.code??error.message}>`);
  }
  try{
    const names=(await readdir(root)).filter(name=>name.startsWith('update-failure-')&&name.endsWith('.txt'));
    const files=[];
    for(const name of names){const info=await stat(join(root,name));files.push({name,mtime:info.mtimeMs});}
    files.sort((a,b)=>b.mtime-a.mtime);
    for(const file of files.slice(0,2)){
      const content=await readFile(join(root,file.name),'utf8').catch(error=>`<${error.code??error.message}>`);
      lines.push('',`${file.name}:`,tailText(content,8000));
    }
    if(!files.length)lines.push('','update-failure-*.txt=none');
  }catch(error){lines.push('',`update-failure-*.txt=<${error.code??error.message}>`);}
  const text=lines.join('\n');
  clipboard.writeText(text);
  return {copied:true,characters:text.length};
}
async function refreshFinderMenu(){
  if(process.platform!=='darwin')return;
  try{await runProcess('/usr/bin/killall',['Finder'],{timeout:8000});}catch{}
}
function scheduleFinderRefresh(delay=1200){
  if(process.platform!=='darwin'||preview||smoke)return;
  clearTimeout(finderRefreshTimer);
  finderRefreshTimer=setTimeout(()=>{finderRefreshTimer=null;void refreshFinderMenu();},delay);
}
async function refreshFinderIfStale(){
  if(process.platform!=='darwin'||preview||smoke||!shareMenu)return;
  try{
    const pid=(await runProcess('/usr/bin/pgrep',['-x','Finder'])).stdout.trim().split('\n')[0];
    const started=Date.parse((await runProcess('/bin/ps',['-o','lstart=','-p',pid])).stdout.trim());
    const state=await stat(join(shareMenu.root,'menu-state.json'));
    if(Number.isFinite(started)&&started<state.mtimeMs)scheduleFinderRefresh();
  }catch{}
}
async function nativeRequest(method,p){
  switch(method){
    case 'list':return {bots:latestState.bots,truncated:false};
    case 'runtime':return {mainAgentId:latestState.runtime?.mainAgentId??null};
    case 'statuses':return {statuses:latestState.runtime?.statuses??[]};
    case 'status':return {connected:latestState.connected,sending:latestState.backgroundSending||latestState.inbox?.some(row=>['uploading','sending'].includes(row.phase))||false};
    case 'compose':return openComposer(p.botId);
    case 'unwatch':return {};
    case 'resolve':{
      for(const item of latestState.inbox.filter(row=>row.botId===p.botId&&row.status==='unconfirmed'&&!row.holdResolved))await rpc.call('resolve',{id:item.id});
      return {};
    }
    case 'watch':return rpc.call('watch',{botId:p.botId,sessionId:p.sessionId});
    case 'send':{
      if(preview)throw new Error('PREVIEW_ONLY');
      let id=p.receiptId;
      if(id){const receipt=await rpc.call('composer',{id});if(receipt.botId!==p.botId)throw new Error('RECEIPT_SCOPE_MISMATCH');}
      else{id=(await rpc.call('receive',{botId:p.botId,source:'drop',manual:true,text:p.text,files:p.files},RECEIVE_TIMEOUT)).id;}
      const result=await rpc.call('submit',{id,text:p.text,files:p.files},0);
      if(result.status!=='sent')throw new Error(result.status==='unconfirmed'?'SEND_UNCONFIRMED':result.error??'SEND_FAILED');
      return result;
    }
    default:throw new Error('METHOD_UNKNOWN');
  }
}
async function dispatch(method,p){
  switch(method){
    case 'state':return publicState();
    case 'quickAction':{
      if(![panelWindow?.webContents,wheelWindow?.webContents].includes(ipcSender))throw new Error('UNTRUSTED_SENDER');
      if(p.action==='expand'){
        if(!panelWindow||panelWindow.isDestroyed()||ipcSender!==panelWindow.webContents)throw new Error('UNTRUSTED_SENDER');
        if(quickPanelRestoredBounds){panelWindow.setBounds(quickPanelRestoredBounds,true);quickPanelRestoredBounds=null;return {expanded:false};}
        const bounds=panelWindow.getBounds(),area=screen.getDisplayMatching(bounds).workArea;quickPanelRestoredBounds=bounds;
        const width=Math.min(680,area.width),height=Math.min(760,area.height);
        panelWindow.setBounds({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height},true);return {expanded:true};
      }
      if(p.action==='settings'){panelWindow?.hide();wheelWindow?.hide();notify('navigate',{page:'settings'});showMainWindow();return;}
      if(p.action==='botSettings'){if(!rankedBots().some(bot=>bot.id===p.botId))throw new Error('BOT_NOT_FOUND');panelWindow?.hide();wheelWindow?.hide();notify('navigate',{page:'bots',botId:p.botId});showMainWindow();return;}
      if(p.action==='wheel'){panelWindow?.hide();return showQuickPanel('wheel');}
      if(p.action==='quit'){quitting=true;app.quit();return;}
      if(!rankedBots().some(bot=>bot.id===p.botId))throw new Error('BOT_NOT_FOUND');
      panelWindow?.hide();wheelWindow?.hide();
      if(p.action==='compose')return openComposer(p.botId,undefined,{captureSelection:!preview});
      if(p.action==='open')return openInGrokBot(p.botId);
      throw new Error('METHOD_UNKNOWN');
    }
    case 'sharePickerData':return sharePickerPayload();
    case 'sharePickerConfirm':return confirmShare(p.botId);
    case 'sharePickerCancel':cancelShare();return {ok:true};
    case 'sharePickerResize':{
      // The panel is sized by its content: no fixed 460px of empty space.
      if(sharePickerWindow&&!sharePickerWindow.isDestroyed()){
        const height=Math.max(150,Math.min(600,Math.round(Number(p.height)||0)));
        if(height>0){const bounds=sharePickerWindow.getBounds();if(bounds.height!==height)sharePickerWindow.setBounds({...bounds,height});}
      }
      return {ok:true};
    }
    case 'login':return accountAction('login');
    case 'desktopLogin':return accountAction('desktopLogin');
    case 'logout':{
      if(accountBusy)throw new Error('ACCOUNT_BUSY');
      const state=await rpc.call('logout');await vault.remove();await forgetCliCredential();latestState=state;update();return publicState();
    }
    case 'refresh':await rpc.call('refresh');return publicState();
    case 'duplicateBot':{const result=await rpc.call('duplicateBot',{botId:p.botId});return {...publicState(),duplicatedBotId:result?.bot?.id??''};}
    case 'configure':return rpc.call('configure',{botId:p.botId,patch:p.patch});
    case 'disableAllReceive':return rpc.call('disableAllReceive');
    case 'explorerMenu':{
      if(preview)throw new Error('PREVIEW_ONLY');
      if(process.platform!=='win32')throw new Error('EXPLORER_MENU_UNAVAILABLE');
      if(p.action==='remove')explorerMenu=false;
      else if(p.action==='set')explorerMenu=p.enabled===true;
      else if(p.action!=='rebuild')throw new Error('METHOD_UNKNOWN');
      saveExplorerPref();
      try{await explorerSync.schedule(explorerOps(),applyExplorer,{force:true});}
      catch{issue('EXPLORER_SYNC_FAILED');throw new Error('EXPLORER_SYNC_FAILED');}
      update();
      return {enabled:explorerMenu===true};
    }
    case 'copyDiagnostics':return copyDiagnostics();
    case 'updateMenu':{
      if(!shareMenu||preview)throw new Error('MENU_UNAVAILABLE');
      if(!latestState.account?.id||latestState.accountBusy)throw new Error('ACCOUNT_BUSY');
      menuReconciler.request(latestState);await menuReconciler.flush({force:true});return shareMenu.status;
    }
    case 'menuOrder':return readShareOrder();
    case 'readMenuOrder':return syncReadShareOrder();
    case 'moveShare':return moveShare(p.botId,p.delta);
    case 'prepareReceipt':{const item=await rpc.call('composer',{id:p.id});nativeUI?.send({command:'receipt',receipt:{id:item.id,botId:item.botId,text:item.text??'',files:(item.files??[]).map(file=>({name:file.name}))}});return {ok:true};}
    case 'theme':nativeTheme.themeSource=p.theme;return rpc.call('theme',{theme:p.theme});
    case 'setShortcut':return rpc.call('setShortcut',{slot:p.slot,accelerator:p.accelerator});
    case 'setWheelSlot':return setWheelSlot(p);
    case 'setCli':return setCliEnabled(!!p.enabled);
    case 'setOpenAtLogin':{
      const next=!!p.enabled;
      if(shouldApplyLoginItem({preview,packaged:app.isPackaged})){try{applyLoginItem(next,app);}catch{throw new Error('LOGIN_ITEM_FAILED');}}
      openAtLogin=next;loginItemKnown=true;saveLoginPref();
      update();return {enabled:openAtLogin};
    }
    case 'setComposerPrefs':{
      composerPrefs={afterSend:['hide','open'].includes(p.afterSend)?p.afterSend:composerPrefs.afterSend,dismissOnOutside:typeof p.dismissOnOutside==='boolean'?p.dismissOnOutside:composerPrefs.dismissOnOutside};
      saveComposerPrefs();update();return composerPrefs;
    }
    case 'noteBot':if(typeof p.botId==='string'){activeBotId=p.botId;update();}return {ok:true};
    case 'pendingComposer':return pendingFloat;
    case 'hideComposer':hideFloat({clearAttachments:p.clear===true});return {ok:true};
    case 'keepComposerOpen':keepFloatOpen=p.on===true;return {ok:true};
    case 'focusComposer':if(floatWindow&&!floatWindow.isDestroyed())floatWindow.focus();return {ok:true};
    case 'setHit':if(floatWindow&&!floatWindow.isDestroyed())floatWindow.setIgnoreMouseEvents(!p.hit,{forward:true});return {ok:true};
    case 'composerReady':{
      const ready=composerReadyState;
      if(ready&&ready.generation===composeGeneration){
       if(p.part==='card'&&Number.isFinite(p.width)&&Number.isFinite(p.height))ready.card={width:Math.max(1,Math.round(p.width)),height:Math.max(1,Math.round(p.height))};
       if(p.part==='avatar')ready.avatar=true;
      }
      return {ok:true};
    }
    case 'placeComposer':
      if(p.regions?.part==='picker')placePicker(p.width,p.height);
      else if(p.regions?.part==='bar'){
       // A late bar resize after the bar was closed must not revive bar mode.
       if(!floatWindow||floatWindow.isDestroyed()||!floatWindow.isVisible())return {ok:true};
       composerBar=true;for(const extra of [avatarWindow,pickerWindow])if(extra&&!extra.isDestroyed()&&extra.isVisible())extra.hide();placeFloat(p.width,p.height);
      }
      else{composerBar=false;placeFloat(p.width,p.height);}
      return {ok:true};
    case 'syncPicker':{
      pickerOpen=!!p.open;
      if(pickerWindow&&!pickerWindow.isDestroyed())pickerWindow.webContents.send('grokbotQuick:event',{event:'picker',data:{open:pickerOpen,index:p.index|0}});
      layoutExtras();return {ok:true};
    }
    case 'pickBot':{
      if(typeof p.botId==='string'&&floatWindow&&!floatWindow.isDestroyed()){floatWindow.webContents.send('grokbotQuick:event',{event:'pick',data:{botId:p.botId}});floatWindow.focus();}
      return {ok:true};
    }
    case 'suppressShortcuts':{
      shortcutsSuppressed=!!p.on;
      if(shortcutsSuppressed)unregisterShortcuts();
      else applyShortcuts(latestState.shortcuts);
      return {ok:true};
    }
    case 'copyComposeLink':{
      const link=composeLink(p.botId);
      if(!link||!(latestState.bots??[]).some(bot=>bot.id===p.botId))throw new Error('BOT_NOT_FOUND');
      clipboard.writeText(link);return {ok:true};
    }
    case 'openBot':return openInGrokBot(p.botId);
    case 'compose':return openComposer(p.botId);
    case 'openReceipt':{const item=await rpc.call('composer',{id:p.id});return openComposer(item.botId,item);}
    case 'sendReceipt':{const item=await rpc.call('composer',{id:p.id});return rpc.call('submit',{id:p.id,text:item.text??''},0);}
    case 'sendDraft':return sendDraft(p.botId,p.text??'',p.files,p.receiptId);
    case 'retry':if(preview)throw new Error('PREVIEW_ONLY');return rpc.call('retry',{id:p.id});
    case 'resolve':return rpc.call('resolve',{id:p.id});
    case 'fileSizes':{
      const paths=Array.isArray(p.paths)?p.paths.filter(path=>typeof path==='string'&&isAbsolute(path)).slice(0,100):[];
      return Promise.all(paths.map(async path=>{const info=await stat(path).catch(()=>null);return {path,bytes:info?.isFile()?info.size:0};}));
    }
    case 'pickFiles':{
      suspendFloatDismiss=true;
      try{const picked=await dialog.showOpenDialog(ownerWindow(),{properties:['openFile','multiSelections']});return picked.canceled?[]:picked.filePaths;}
      finally{setTimeout(()=>{suspendFloatDismiss=false;},400);}
    }
    case 'chooseFiles':{
      const result=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections']});
      return result.canceled?null:intake(p.botId,result.filePaths);
    }
    case 'dropFiles':return intake(p.botId,p.files);
    default:throw new Error('METHOD_UNKNOWN');
  }
}
function serviceEvent(message){
  if(message.event==='state'){
    latestState=message.data;applyShortcuts(latestState.shortcuts);update();
    if(menuReconciler)menuReconciler.request(latestState);
    if(process.platform==='win32')syncExplorer();
    if(pendingSharedComposers.size)void flushSharedComposers();
  }
  if(message.event==='login.url'){
    try{const url=new URL(message.data.url);if(url.origin!=='https://cursor.com'||url.pathname!=='/loginDeepControl')throw new Error();void shell.openExternal(url.href).catch(()=>issue('BROWSER_OPEN_FAILED'));}catch{issue('LOGIN_URL_INVALID');}
  }
  if(message.event==='auth.expired'){hostIssue='LOGIN_REQUIRED';void vault.remove().catch(()=>{});void forgetCliCredential().then(()=>update()).catch(()=>update());}
  if(message.event==='reply'&&!preview&&Notification.isSupported())systemNotification({title:message.data.name||'Grok Bot',body:zh?'收到新回复':'New reply'}).show();
  if(message.event==='share.preparing'){
    const data=message.data;
    if(data?.mode==='compose'&&!preview&&!composerBar&&!composerVisible()){
      void openComposer(data.botId,undefined,{preparing:data,captureSelection:false,keepOpen:true}).catch(error=>{const code=errorCode(error);if(!['BOT_NOT_FOUND','ACCOUNT_BUSY'].includes(code))issue(code);});
    }
  }
  if(message.event==='share.received'){
    if(!window||window.isDestroyed()||!window.isVisible())hideDock();
    const action=shareHandoff({mode:message.data.mode});
    if(action==='service'){
      if(pendingFloat?.preparing?.id&&message.data.batchId&&pendingFloat.preparing.id===message.data.batchId)hideFloat({clearAttachments:true});
      notify('navigate',{page:'inbox'});
      const botName=(latestState.bots??[]).find(bot=>bot.id===message.data.botId)?.name??'';
      const notice=shareResultNotice({status:message.data.status,botName,locale:app.getLocale()});
      if(notice&&!preview&&Notification.isSupported())systemNotification(notice).show();
    }else void presentShare(message.data.id);
  }
  if(message.event==='send.error'&&floatWindow&&!floatWindow.isDestroyed())floatWindow.webContents.send('grokbotQuick:event',{event:'send-error',data:message.data});
  if(message.event==='share.error'){
    issue('SHARE_IMPORT_FAILED');
    if(!preview&&Notification.isSupported())systemNotification({title:'GrokBot Quick',body:zh?'这次转发没有导入，内容还在本地。请到发送记录查看。':'This forward could not be imported. The content stays local; check Send history.'}).show();
  }
}
function ownerWindow(){const owner=ipcSender?BrowserWindow.fromWebContents(ipcSender):null;return owner&&!owner.isDestroyed()?owner:window;}
function trusted(event){const contents=event.sender;if(event.senderFrame!==contents.mainFrame)return false;return [window,floatWindow,avatarWindow,pickerWindow,sharePickerWindow,panelWindow,wheelWindow].some(target=>target&&contents===target.webContents);}
// win32 去掉应用菜单后，编辑快捷键不再由菜单 accelerator 派发，这里补回输入框命令
// 2026-11-01 before-input-event：selectAll/copy/paste/cut/undo/redo，contents 无返回值
function bindWindowsEditKeys(contents){
  if(process.platform!=='win32')return;
  contents.on('before-input-event',(event,input)=>{
    const command=editCommand(input);
    if(!command)return;
    event.preventDefault();
    contents[command]();
  });
}
function pushWindowState(){
  if(!window||window.isDestroyed())return;
  let inset=0;
  try{const bounds=window.getBounds();inset=maximizedContentInset(process.platform,window.isMaximized(),bounds,screen.getDisplayMatching(bounds).workArea);}catch{inset=0;}
  window.webContents.send('grokbotQuick:window-state',{maximized:window.isMaximized(),focused:window.isFocused(),inset});
}
async function createWindow(){
  window=new BrowserWindow({...mainWindowOptions(process.platform),
    ...(process.platform==='win32'?{icon:nativeImage.createFromBuffer(coalBallAppPng(256,{platform:'win32'}))}:{}),
    webPreferences:{preload:join(here,'../preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false}});
  if(process.platform==='win32'){try{window.setBackgroundMaterial('acrylic');windowMaterial='acrylic';}catch{window.setBackgroundColor('#f4f4f4');windowMaterial='none';}}
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  if(smoke)window.webContents.on('console-message',details=>{if(details.level==='error')console.error('Renderer:',details.message);});
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  bindWindowsEditKeys(window.webContents);
  window.on('close',event=>{if(windowCloseAction({quitting,smoke,hasTray:!!tray})==='hide'){event.preventDefault();window.hide();setTimeout(hideDock,50);}});
  for(const name of ['maximize','unmaximize','focus','blur'])window.on(name,pushWindowState);
  if(process.platform!=='darwin')window.on('show',showDock);
  window.webContents.on('did-finish-load',pushWindowState);
  window.on('session-end',()=>{quitting=true;});
  window.once('ready-to-show',()=>{
    let wasOpenedAtLogin=false;
    try{wasOpenedAtLogin=app.getLoginItemSettings().wasOpenedAtLogin===true;}catch{wasOpenedAtLogin=false;}
    const openedAtLogin=openedAsLoginItem({wasOpenedAtLogin,argv:process.argv});
    if(!smoke&&process.platform!=='darwin'&&(preview||!tray))showMainWindow();else if(!smoke)hideDock();
  });
  await window.loadFile(join(here,'../../out/index.html'));
}
if(process.platform==='win32')app.setAppUserModelId('dev.ronglecat.grokbotquick');
app.setName('GrokBot Quick');
if(process.argv.includes('--identity-self-test')){console.log('IDENTITY_SELF_TEST',JSON.stringify({name:app.getName(),userData:app.getPath('userData')}));app.exit(0);}
if(!app.requestSingleInstanceLock({argv:process.argv})&&!smoke){app.quit();}else{
 app.on('second-instance',(_event,commandLine,_cwd,additionalData)=>{
  const argv=Array.isArray(additionalData?.argv)&&additionalData.argv.length?additionalData.argv:(commandLine??[]);
  const forward=parseExplorerForward(argv);
  const link=(argv??[]).map(item=>String(item).trim().replace(/^"(.*)"$/,'$1')).find(item=>item.startsWith('grokbotquick://'));
  if(forward){forward.argv=argv;explorerBatch.push(forward);}
  if(link){if(!window||window.isDestroyed()||!window.isVisible())hideDock();acceptDeeplink(link);}
  if(forward||link||argv.includes('--share-intake')||openedAsLoginItem({argv:argv}))return;
  showMainWindow();
 });
 app.on('open-url',(event,url)=>{
  event.preventDefault();
  if(String(url??'').startsWith('grokbotquick:')){
   if(!window||window.isDestroyed()||!window.isVisible())hideDock();
   acceptDeeplink(url);
  }
 });
 app.whenReady().then(async()=>{
  if(!preview){
    if(app.isPackaged)app.setAsDefaultProtocolClient('grokbotquick');
    else app.setAsDefaultProtocolClient('grokbotquick',process.execPath,[app.getAppPath()]);
  }
  if(process.platform==='win32'&&!preview)warmExplorerSelection();
  vault=new CredentialVault(join(app.getPath('userData'),'account.enc'),safeStorage);
  if(!preview&&loadCliPref().enabled){try{await setCliEnabled(true);}catch(error){cliStatus={enabled:false,command:'',skillsPath:'',claudeLinked:false,credential:false,pathSnippet:false,error:errorCode(error)};}}
  if(!preview&&process.platform==='darwin'){
    const template=menuHostTemplate({packaged:app.isPackaged,resourcesPath:process.resourcesPath,devRoot:join(here,'../../bundle-resources')});
    if(existsSync(join(template,'Contents/MacOS/GrokBotMenuHost'))){
      shareMenu=new ShareMenu({root:join(app.getPath('userData'),'ShareInbox'),template,applicationsRoot:join(homedir(),'Applications'),applicationPath:sharingApplicationPath({packaged:app.isPackaged,appPath:app.getAppPath(),execPath:process.execPath}),locale:app.getLocale(),onChange:()=>{if(!shareMenu.status.needsUpdate&&hostIssue==='MENU_UPDATE_FAILED')hostIssue=null;update();}});
      await shareMenu.initialize();
      await shareMenu.elect().catch(()=>{});
      menuReconciler=new MenuReconciler({
        sync:state=>shareMenu.sync(state),publish:state=>shareMenu.sync(state),needsUpdate:()=>shareMenu.status.needsUpdate,
        update:async(state,isCurrent,force)=>{const avatarPage=app.isPackaged?join(process.resourcesPath,'native/avatar/index.html'):join(here,'../../bundle-resources/native/avatar/index.html');const icons=await captureMenuIcons(state,avatarPage);if(!isCurrent())return;const result=await shareMenu.update(state,icons,{isCurrent,force});if(result)scheduleFinderRefresh();return result;},
        onError:error=>{
          if(['MENU_SUPERSEDED','MENU_UPDATE_BUSY','ACCOUNT_BUSY'].includes(error?.message))return;
          shareMenu.status.error='MENU_UPDATE_FAILED';
          const detail=[new Date().toISOString(),error?.message??String(error),error?.cause?.message,error?.cause?.stderr,error?.stack].filter(Boolean).join('\n');
          void appendFile(join(app.getPath('userData'),'ShareInbox','menu-update.log'),detail+'\n---\n',{mode:0o600}).catch(()=>{});
          issue('MENU_UPDATE_FAILED');
        }
      });
    }
  }
  worker=utilityProcess.fork(join(here,'../service/worker.mjs'),[],{serviceName:'Grok Bot Service',stdio:'pipe'});
  rpc=new RpcClient({send:message=>worker.postMessage(message),onEvent:serviceEvent});
  worker.on('message',message=>rpc.receive(message));worker.on('exit',()=>{rpc.close();issue('SERVICE_EXITED');});
  worker.stderr?.on('data',bytes=>{if(smoke)process.stderr.write(bytes);});
  loadComposerPrefs();
  loadShellPrefs();
  loadWheelLayouts();
  const loginStartup=loginItemStartup({known:loginItemKnown,enabled:openAtLogin});
  if(loginStartup&&shouldApplyLoginItem({preview,packaged:app.isPackaged})){try{applyLoginItem(loginStartup.openAtLogin,app);}catch{/* Keep the saved preference when the system rejects it. */}}
  latestState=await rpc.call('initialize',{root:join(app.getPath('userData'),'inbox'),shareRoot:shareMenu?.root,preview,locale:app.getLocale()});
  applyShortcuts(latestState.shortcuts);
  if(menuReconciler)menuReconciler.request(latestState);
  void refreshFinderIfStale();
  nativeTheme.themeSource=latestState.theme;
  ipcMain.handle('grokbotQuick:call',async(event,method,params)=>{
    if(!trusted(event))return {error:'UNTRUSTED_SENDER'};
    ipcSender=event.sender;
    try{return {value:await dispatch(method,params??{})};}catch(error){return {error:errorCode(error)};}
    finally{ipcSender=null;}
  });
  ipcMain.handle('grokbotQuick:window-control',(event,action)=>{
    if(!trusted(event)||!window||window.isDestroyed()||event.sender!==window.webContents)return {error:'UNTRUSTED_SENDER'};
    const allowed=acceptWindowControl(action);
    if(!allowed)return {error:'METHOD_UNKNOWN'};
    if(allowed==='minimize')window.minimize();
    else if(allowed==='toggleMaximize'){if(window.isMaximized())window.unmaximize();else window.maximize();}
    // 关闭走窗口 close，由 windowCloseAction 决定隐藏到托盘或退出
    // 2026-11-01 action close → window.close()
    else window.close();
    return {value:{ok:true}};
  });
  if(process.platform==='win32')Menu.setApplicationMenu(null);
  else{const menu=Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'GrokBot Quick',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:zh?'文件':'File',submenu:[{label:zh?'设置':'Settings',click:()=>{notify('navigate',{page:'settings'});showMainWindow();}},{label:zh?'关闭窗口':'Close window',accelerator:'CmdOrCtrl+W',click:()=>{if(window&&!window.isDestroyed())window.close();}},...(process.platform!=='darwin'?[{role:'quit'}]:[])]},
    {role:'editMenu'},{role:'windowMenu'}]);Menu.setApplicationMenu(menu);}
  if(process.platform==='darwin'&&!smoke){
    const binary=join(here,'../../native-ui/GrokNativePanel.app/Contents/MacOS/GrokNativePanel');
    let settingsQueue=Promise.resolve();
    let nativeSettingsTestResolve;
    const nativeSettingsTest=new Promise(resolve=>{nativeSettingsTestResolve=resolve;});
    nativeUI=new NativeUI(binary,async message=>{
      const botId=typeof message.botId==='string'?message.botId:'';
      if(message.action==='selected'){if(rankedBots().some(bot=>bot.id===botId)){activeBotId=botId;update();}return;}
      if(message.action==='send'){try{if(!rankedBots().some(bot=>bot.id===botId))throw new Error('BOT_NOT_FOUND');await sendDraft(botId,message.text,Array.isArray(message.files)?message.files:[],typeof message.receiptId==='string'?message.receiptId:undefined);nativeUI.send({command:'sendResult',ok:true,botId,text:message.text});}catch(error){nativeUI.send({command:'sendResult',ok:false,botId,text:message.text,message:preview?'预览模式不能发送消息。':'发送未完成，请检查连接或发送记录。'});}return;}
      if(message.action==='wheel'){nativeUI.send({command:'show',mode:'wheel'});return;}
      if(message.action==='staging'){nativeUI.send({command:'show',mode:'staging'});return;}
      if(message.action==='quickSend'){try{if(!rankedBots().some(bot=>bot.id===botId))throw new Error('BOT_NOT_FOUND');await sendDraft(botId,message.text,Array.isArray(message.files)?message.files:[]);nativeUI.send({command:'quickSendResult',ok:true,message:'已加入发送流程，请在聊天中查看结果。'});}catch(error){nativeUI.send({command:'quickSendResult',ok:false,message:preview?'预览模式不能发送消息。':'未能加入发送流程，请检查连接。'});}return;}
      if(message.action==='taskAction'){const methods=new Set(['taskCreate','taskUpdate','taskCancel','taskMove','taskDispatch']);if(!methods.has(message.method))return;try{await rpc.call(message.method,message.params??{},message.method==='taskDispatch'?0:RECEIVE_TIMEOUT);nativeUI.send({command:'taskResult',ok:true,message:'操作已完成。'});}catch(error){nativeUI.send({command:'taskResult',ok:false,message:preview?'预览模式不能发送任务。':`任务操作未完成（${errorCode(error)}）。`});}return;}
      if(message.action==='open'){if(rankedBots().some(bot=>bot.id===botId))await openInGrokBot(botId);nativeUI.send({command:'hide'});return;}
      if(message.action==='settings'||message.action==='botSettings'){await showMainWindow({section:message.action==='botSettings'?'bots':'general',botId});return;}
      
      if(message.action==='settingsAction'){
        const allowed=new Set(['login','desktopLogin','logout','refresh','configure','theme','setShortcut','setWheelSlot','suppressShortcuts','setComposerPrefs','setCli','setOpenAtLogin','updateMenu','copyDiagnostics','disableAllReceive','retry','resolve','prepareReceipt','duplicateBot','readMenuOrder','moveShare']);
        const method=message.method,params=message.params&&typeof message.params==='object'?message.params:{};
        if(!allowed.has(method))return;
        const perform=async()=>{try{await dispatch(method,params);update();if(!['suppressShortcuts','configure','theme','setShortcut','setWheelSlot','moveShare','setComposerPrefs','setOpenAtLogin'].includes(method))nativeUI.send({command:'settingsResult',message:method==='copyDiagnostics'?'已复制报错日志。':'操作已完成。'});}catch(error){nativeUI.send({command:'settingsResult',message:preview?'预览模式下无法执行此操作。':`操作未完成（${errorCode(error)}），请检查设置后重试。`});}};
        settingsQueue=settingsQueue.then(perform,perform);await settingsQueue;return;
      }
      if(message.action==='testSettingsResult'||message.action==='testAvatarResult'){nativeSettingsTestResolve(message);return;}
      if(message.action==='quit'){quitting=true;app.quit();}
    },preview?{GROK_STAGING_DIR:join(temporaryRoot,'staging')} : {});
    await nativeUI.start();update();
    if(preview&&process.argv.includes('--avatar-self-test')){
      const start=Date.now();while(avatarRefreshRunning&&Date.now()-start<45000)await new Promise(resolve=>setTimeout(resolve,100));
      const expected=listedBots(latestState.bots??[]).length,count=Object.keys(avatarCache).length;
      if(avatarRefreshRunning||!expected||count!==expected||Object.values(avatarCache).some(value=>!value.startsWith('data:image/png;base64,')))throw new Error('AVATAR_SELF_TEST_FAILED');
      nativeUI.send({command:'avatars',images:avatarCache});nativeUI.send({command:'testAvatarState'});
      const decoded=await Promise.race([nativeSettingsTest,new Promise((_,reject)=>setTimeout(()=>reject(new Error('AVATAR_DECODE_TIMEOUT')),10000))]);
      if(decoded.decoded!==expected)throw new Error('AVATAR_DECODE_FAILED');
      console.log('AVATAR_SELF_TEST',JSON.stringify({expected,count,decoded:decoded.decoded}));quitting=true;app.quit();return;
    }
    if(preview&&process.argv.includes('--native-settings-self-test')){
      nativeUI.send({command:'testSettings'});
      const result=await Promise.race([nativeSettingsTest,new Promise((_,reject)=>setTimeout(()=>reject(new Error('NATIVE_SETTINGS_TEST_TIMEOUT')),10000))]);
      await settingsQueue;
      const id=latestState.bots?.[0]?.id;
      wheelLayouts={};loadWheelLayouts();
      if(!result.visible||!result.botCount||latestState.theme!=='dark'||!latestState.recipients?.find(row=>row.botId===id)?.enabled||publicState().wheelLayout.outer[6]!==id||latestState.shortcuts?.wheel!=='Command+Shift+J'||composerPrefs.afterSend!=='open'||window)throw new Error('NATIVE_SETTINGS_TEST_FAILED');
      console.log('NATIVE_SETTINGS_SELF_TEST',JSON.stringify({visible:true,bots:result.botCount,theme:latestState.theme,botConfig:true,wheelLayout:true,wheelShortcut:true,composer:true,electronWindow:!!window}));quitting=true;app.quit();return;
    }
  }
  ensureTray();
  if(process.platform!=='darwin'||smoke)await createWindow();
  applyAppIcon();
  // No Touch Bar companion in this menu-bar-only build.
  if(preview&&!smoke&&process.platform!=='darwin'&&process.argv.includes('--quick-self-test')){
    await showQuickPanel('menu');
    const result=await panelWindow.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      for(let i=0;i<100&&!document.querySelector('.bot');i++)await wait(50);
      const row=document.querySelector('.bot');if(!row)throw new Error('BOT_LIST_MISSING');row.click();await wait(100);
      if(!document.querySelector('.chat-input')||!document.querySelector('.thread'))throw new Error('CHAT_MISSING');
      const input=document.querySelector('.chat-input');input.value='preview message';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').requestSubmit();await wait(200);
      if(!document.querySelector('.message').textContent.includes('预览模式')&&!document.querySelector('.message').textContent.includes('发送未完成'))throw new Error('PREVIEW_SEND_GUARD_MISSING');
      return {botList:true,chat:true,previewSendGuard:true};
    })()`);
    await panelWindow.webContents.executeJavaScript(`document.querySelector('[aria-label="展开或收起聊天"]').click()`);
    await new Promise(resolve=>setTimeout(resolve,250));
    if(panelWindow.getBounds().width<=330)throw new Error('CHAT_EXPAND_FAILED');
    await panelWindow.webContents.executeJavaScript(`document.querySelector('[aria-label="此 Bot 的设置"]').click()`);
    await new Promise(resolve=>setTimeout(resolve,250));
    const settings=await window.webContents.executeJavaScript(`document.getElementById('titlebar-title').textContent`);
    if(!settings||settings==='设置')throw new Error('BOT_SETTINGS_FAILED');
    await showQuickPanel('wheel');
    const wheelResult=await wheelWindow.webContents.executeJavaScript(`(async()=>{for(let i=0;i<100&&!document.querySelector('.orbit-bot');i++)await new Promise(r=>setTimeout(r,50));return {bots:document.querySelectorAll('.orbit-bot').length,actions:[...document.querySelectorAll('.orbit-action')].map(x=>x.textContent)};})()`);
    if(!wheelResult.bots)throw new Error('WHEEL_BOTS_MISSING');
    await wheelWindow.webContents.executeJavaScript(`document.querySelector('.orbit-bot').click()`);
    for(let i=0;i<50&&!floatWindow?.isVisible();i++)await new Promise(resolve=>setTimeout(resolve,100));
    if(!floatWindow?.isVisible())throw new Error('WHEEL_COMPOSER_FAILED');
    console.log('QUICK_SELF_TEST',JSON.stringify({...result,expanded:true,botSettings:settings,wheel:wheelResult,wheelComposer:true}));app.quit();return;
  }
  if(process.platform!=='darwin'&&preview&&!smoke&&process.argv.includes('--settings-self-test')){
    await showMainWindow({legacy:true});
    const settingsTest=await window.webContents.executeJavaScript(`(async()=>{
      const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
      const sections=['general','shortcuts','composer','bots','share','toolbox','inbox'];
      const visited=[];
      for(const name of sections){const tab=document.querySelector('[data-section="'+name+'"]');if(!tab)throw Error('MISSING_SECTION_'+name);tab.click();await pause();if(!document.querySelector('.section-heading')?.textContent)throw Error('MISSING_HEADING_'+name);visited.push(name);}
      document.querySelector('[data-section="bots"]').click();await pause();
      const picker=document.querySelector('.bot-selector');if(!picker||picker.options.length<2)throw Error('BOT_SELECTOR_MISSING');
      const botId=picker.options[1].value;picker.value=botId;picker.dispatchEvent(new Event('change',{bubbles:true}));await pause();
      if(!document.querySelector('.bot-identity-name')||document.querySelector('.bot-identity-name').textContent!==picker.options[1].textContent)throw Error('BOT_SELECTOR_FAILED');
      document.querySelector('[data-section="general"]').click();await pause();await window.grokbotQuick.theme('dark');await pause();
      if(document.documentElement.dataset.theme!=='dark')throw Error('DARK_THEME_FAILED');
      await window.grokbotQuick.theme('light');await pause();if(document.documentElement.dataset.theme!=='light')throw Error('LIGHT_THEME_FAILED');
      return {sections:visited,botSwitch:true,dark:true,light:true};
    })()`);
    console.log('SETTINGS_SELF_TEST',JSON.stringify(settingsTest));quitting=true;app.quit();return;
  }
  if(preview&&!smoke&&process.argv.includes('--preview-settings'))await showMainWindow();
  if(preview&&!smoke&&process.argv.includes('--preview-menu'))await showQuickPanel('menu');
  if(preview&&!smoke&&process.argv.includes('--preview-wheel'))await showQuickPanel('wheel');
  if(smoke){
    const result=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(document.documentElement.dataset.ready==='true')resolve({title:document.title,headings:[...document.querySelectorAll('h1')].map(e=>e.textContent)});else if(Date.now()-start>10000)reject(new Error('RENDERER_NOT_READY'));else setTimeout(tick,50);};tick();})`);
    const artifactRoot=app.isPackaged?join(temporaryRoot,'artifacts'):join(here,'../../artifacts');await mkdir(artifactRoot,{recursive:true});
    const avatarStats=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const nodes=[...document.querySelectorAll('.avatar')];if(nodes.length&&nodes.every(n=>n.shadowRoot?.querySelector('svg')))resolve({avatarCount:nodes.length});else if(Date.now()-start>8000)reject(new Error('AVATARS_NOT_PAINTED'));else setTimeout(check,40);};check();})`);
    await writeFile(join(artifactRoot,'bots.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`window.grokbotQuick.theme('dark')`);
    await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const nodes=[...document.querySelectorAll('.avatar')];if(nodes.length&&nodes.every(n=>n.shadowRoot?.querySelector('svg')))resolve(true);else if(Date.now()-start>8000)reject(new Error('AVATARS_NOT_PAINTED'));else setTimeout(check,40);};check();})`);
    await writeFile(join(artifactRoot,'bots-dark.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`window.grokbotQuick.theme('light')`);
    const botId=latestState.bots[0].id;
    await rpc.call('configure',{botId,patch:{enabled:true,sources:{drop:true}}});
    const fixture=join(temporaryRoot,'会议记录.zip');await writeFile(fixture,Buffer.alloc(5*1024*1024,7));
    const receipt=await rpc.call('receive',{botId,source:'drop',files:[fixture],text:'把这份会议记录整理成待办'});
    if(receipt.status!=='needs-input'||receipt.files[0].bytes!==5*1024*1024)throw new Error('LOCAL_INTAKE_FAILED');
    await window.webContents.executeJavaScript(`(async()=>{document.querySelector('.nav-button[data-page="settings"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    await writeFile(join(artifactRoot,'settings.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(async()=>{document.querySelector('.nav-button[data-page="inbox"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    await writeFile(join(artifactRoot,'inbox.png'),(await window.webContents.capturePage()).toPNG());
    await openComposer(botId,receipt);
    await floatWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(document.querySelector('textarea.composer-input')&&document.querySelector('.float-avatar .avatar'))resolve(true);else if(Date.now()-start>8000)reject(new Error('FLOAT_NOT_READY'));else setTimeout(tick,40);};tick();})`);
    const floatControls=await floatWindow.webContents.executeJavaScript(`({composerCount:document.querySelectorAll('textarea.composer-input').length,avatarCount:document.querySelectorAll('.float-avatar .avatar').length})`);
    if(floatControls.composerCount!==1||floatControls.avatarCount!==1)throw new Error('FLOAT_UI_FAILED');
    await writeFile(join(artifactRoot,'composer.png'),(await floatWindow.webContents.capturePage()).toPNG());
    hideFloat();
    const controls=await window.webContents.executeJavaScript(`({composerCount:document.querySelectorAll('textarea.composer-input').length,receiptCount:document.querySelectorAll('article').length})`);
    if(controls.composerCount!==0||controls.receiptCount!==1)throw new Error('SHARED_UI_FAILED');
    console.log(JSON.stringify({smoke:'passed',...result,...controls,...avatarStats,node:process.versions.node}));
    quitting=true;app.quit();return;
  }
  if(!preview){
    explorerBatch.arm(async(botId,files,meta)=>{try{await deliverExplorer({botId,files,argv:meta?.argv??[]});}catch(error){issue(errorCode(error));}});
    try{const credentials=await vault.load();if(credentials){const result=await rpc.call('connect',credentials);latestState=result.state;applyShortcuts(latestState.shortcuts);update();void rpc.call('resume').catch(error=>issue(errorCode(error)));presentPendingComposer();}}
    catch(error){issue(errorCode(error));}
    explorerSettled=true;
    deeplinkReady=true;
    for(const raw of pendingLinks.splice(0))acceptDeeplink(raw);
  }
 }).catch(error=>{console.error(errorCode(error));app.exit(1);});
}
app.on('activate',()=>{
 if(!window||window.isDestroyed()||!window.isVisible())hideDock();
 if(suppressActivate||composerVisible())return;
 // macOS activation is also delivered for share/extension handoffs. Only
 // restore a minimized window here; a closed main window opens only via an
 // explicit tray/menu/deep-link action.
 if(process.platform==='darwin'&&!window?.isMinimized())return;
 showMainWindow();
});
app.on('window-all-closed',()=>{if(smoke)app.quit();});
app.on('session-end',()=>{quitting=true;});
app.on('before-quit',()=>{quitting=true;if(tray){tray.destroy();tray=null;}stopExplorerSelection();unregisterShortcuts();menuReconciler?.close();nativeUI?.stop();worker?.kill();rpc?.close();});
// Preview data uses an OS temporary directory. Do not delete Chromium's cache
// while its helper processes are still shutting down.
