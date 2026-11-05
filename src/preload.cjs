const {contextBridge,ipcRenderer,webUtils}=require('electron');
const call=(method,params={})=>ipcRenderer.invoke('grokbotQuick:call',method,params).then(result=>{
  if(result?.error)throw new Error(result.error);return result?.value;
});
contextBridge.exposeInMainWorld('grokbotQuick',{
  quickAction:(action,botId)=>call('quickAction',{action,botId}),
  state:()=>call('state'),login:()=>call('login'),desktopLogin:()=>call('desktopLogin'),logout:()=>call('logout'),refresh:()=>call('refresh'),
  duplicateBot:botId=>call('duplicateBot',{botId}),
  disableAllReceive:()=>call('disableAllReceive'),
  explorerMenu:action=>call('explorerMenu',action??{}),
  configure:(botId,patch)=>call('configure',{botId,patch}),theme:theme=>call('theme',{theme}),
  compose:botId=>call('compose',{botId}),copyComposeLink:botId=>call('copyComposeLink',{botId}),openBot:botId=>call('openBot',{botId}),openReceipt:id=>call('openReceipt',{id}),sendReceipt:id=>call('sendReceipt',{id}),
  sendDraft:(botId,text,files,receiptId,remoteKeep)=>call('sendDraft',{botId,text,files,receiptId,remoteKeep}),
  retry:id=>call('retry',{id}),
  resolve:id=>call('resolve',{id}),
  updateMenu:()=>call('updateMenu'),
  copyDiagnostics:()=>call('copyDiagnostics'),
  menuOrder:()=>call('menuOrder'),
  chooseFiles:botId=>call('chooseFiles',{botId}),
  pickFiles:()=>call('pickFiles'),
  fileSizes:paths=>call('fileSizes',{paths}),
  setShortcut:(slot,accelerator)=>call('setShortcut',{slot,accelerator}),
  suppressShortcuts:on=>call('suppressShortcuts',{on}),
  setComposerPrefs:prefs=>call('setComposerPrefs',prefs),
  setCli:enabled=>call('setCli',{enabled}),
  setOpenAtLogin:enabled=>call('setOpenAtLogin',{enabled}),
  setTouchBarPinned:pinned=>call('setTouchBarPinned',{pinned}),
  noteBot:botId=>call('noteBot',{botId}),
  pendingComposer:()=>call('pendingComposer'),
  sharePickerData:()=>call('sharePickerData'),
  sharePickerConfirm:botId=>call('sharePickerConfirm',{botId}),
  sharePickerCancel:()=>call('sharePickerCancel'),
  sharePickerResize:height=>call('sharePickerResize',{height}),
  hideComposer:clear=>call('hideComposer',{clear:clear===true}),
  keepComposerOpen:on=>call('keepComposerOpen',{on:on===true}),
  setHit:hit=>call('setHit',{hit}),
  placeComposer:(width,height,regions)=>call('placeComposer',{width,height,regions}),
  composerReady:state=>call('composerReady',state??{}),
  focusComposer:()=>call('focusComposer'),
  syncPicker:payload=>call('syncPicker',payload??{}),
  pickBot:botId=>call('pickBot',{botId}),
  dropFiles:(botId,files)=>call('dropFiles',{botId,files:files.map(file=>webUtils.getPathForFile(file)).filter(Boolean)}),
  filePaths:files=>files.map(file=>webUtils.getPathForFile(file)).filter(Boolean),
  onChange:listener=>{const handler=(_event,data)=>listener(data);ipcRenderer.on('grokbotQuick:event',handler);return()=>ipcRenderer.removeListener('grokbotQuick:event',handler);},
  windowControl:action=>ipcRenderer.invoke('grokbotQuick:window-control',action).then(result=>{
    if(result?.error)throw new Error(result.error);return result?.value;
  }),
  onWindowState:listener=>{const handler=(_event,data)=>listener(data);ipcRenderer.on('grokbotQuick:window-state',handler);return()=>ipcRenderer.removeListener('grokbotQuick:window-state',handler);}
});
