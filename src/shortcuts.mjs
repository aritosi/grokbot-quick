export const DEFAULT_SHORTCUTS={compose:'Ctrl+Alt+Space',wheel:'CommandOrControl+Alt+Shift+Space',screenshot:'Ctrl+Alt+Shift+S'};
const MODIFIERS=new Set(['Command','Cmd','Control','Ctrl','CommandOrControl','CmdOrCtrl','Alt','Option','AltGr','Shift','Super','Meta']);
const STRONG=new Set(['Command','Cmd','Control','Ctrl','CommandOrControl','CmdOrCtrl','Alt','Option','Super','Meta']);
const NAMED=new Set(['Space','Tab','Esc','Escape','Return','Enter','Up','Down','Left','Right','Home','End','PageUp','PageDown','Backspace','Delete','Plus',...Array.from({length:24},(_,index)=>`F${index+1}`)]);

export function normalizeAccelerator(input){
  if(input==null||input==='')return null;
  if(typeof input!=='string'||input.length>64)throw new Error('SHORTCUT_INVALID');
  const parts=input.split('+').map(part=>part.trim()).filter(Boolean);
  if(parts.length<2||parts.length>4)throw new Error('SHORTCUT_INVALID');
  const key=parts.at(-1),mods=parts.slice(0,-1);
  if(!mods.every(part=>MODIFIERS.has(part))||!mods.some(part=>STRONG.has(part)))throw new Error('SHORTCUT_INVALID');
  if(!NAMED.has(key)&&!/^[A-Z0-9]$/.test(key))throw new Error('SHORTCUT_INVALID');
  return [...mods,key].join('+');
}

export function acceleratorFromEvent(event){
  if(!event||event.isComposing)return null;
  const key=event.key;
  if(!key||['Control','Shift','Alt','Meta'].includes(key))return null;
  const mods=[];
  if(event.metaKey)mods.push('Command');
  if(event.ctrlKey)mods.push('Ctrl');
  if(event.altKey)mods.push('Alt');
  if(event.shiftKey)mods.push('Shift');
  if(!mods.some(part=>STRONG.has(part)))return null;
  const named={' ':'Space',Escape:'Esc',Enter:'Return',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Backspace:'Backspace',Delete:'Delete',Tab:'Tab'};
  let token=named[key];
  if(!token){
    if(key.length===1)token=key.toUpperCase();
    else if(/^F([1-9]|1[0-9]|2[0-4])$/.test(key))token=key;
    else return null;
  }
  return [...mods,token].join('+');
}

// Electron treats modifier aliases and ordering as the same global shortcut.
export function acceleratorKey(value,platform=typeof process!=='undefined'?process.platform:'darwin'){
  if(!value)return '';
  const parts=value.split('+'),key=parts.pop();
  const aliases={Cmd:'Command',Control:'Ctrl',Option:'Alt',CmdOrCtrl:platform==='darwin'?'Command':'Ctrl',CommandOrControl:platform==='darwin'?'Command':'Ctrl',Meta:'Super'};
  return [...new Set(parts.map(part=>aliases[part]??part))].sort().join('+')+'+'+key;
}
const SLOT=/^[\w-]{1,80}$/;
function takeShortcut(seen,target,id,value){
  if(!SLOT.test(id)||typeof value!=='string'||!value)return;
  try{
    const accelerator=normalizeAccelerator(value);
    if(!accelerator||seen.has(acceleratorKey(accelerator)))return;
    seen.add(acceleratorKey(accelerator));
    target[id]=accelerator;
  }catch{}
}
export function normalizeShortcutMap(saved){
  const map={compose:DEFAULT_SHORTCUTS.compose,open:null,wheel:DEFAULT_SHORTCUTS.wheel,screenshot:DEFAULT_SHORTCUTS.screenshot,bots:{},opens:{}};
  if(!saved||typeof saved!=='object')return map;
  if(Object.prototype.hasOwnProperty.call(saved,'compose')){
    if(saved.compose==null||saved.compose==='')map.compose=null;
    else{try{map.compose=normalizeAccelerator(saved.compose);}catch{map.compose=DEFAULT_SHORTCUTS.compose;}}
  }
  if(Object.prototype.hasOwnProperty.call(saved,'open')){
    if(saved.open==null||saved.open==='')map.open=null;
    else{try{map.open=normalizeAccelerator(saved.open);}catch{map.open=null;}}
  }
  if(Object.prototype.hasOwnProperty.call(saved,'wheel')){
    if(saved.wheel==null||saved.wheel==='')map.wheel=null;
    else{try{map.wheel=normalizeAccelerator(saved.wheel);}catch{map.wheel=DEFAULT_SHORTCUTS.wheel;}}
  }
  if(Object.prototype.hasOwnProperty.call(saved,'screenshot')){
    if(saved.screenshot==null||saved.screenshot==='')map.screenshot=null;
    else{try{map.screenshot=normalizeAccelerator(saved.screenshot);}catch{map.screenshot=DEFAULT_SHORTCUTS.screenshot;}}
  }
  if(map.screenshot&&[map.compose,map.open,map.wheel].some(value=>value&&acceleratorKey(value)===acceleratorKey(map.screenshot)))map.screenshot=null;
  if(map.compose&&acceleratorKey(map.open)===acceleratorKey(map.compose))map.open=null;
  const seen=new Set([map.compose,map.open,map.wheel,map.screenshot].filter(Boolean).map(value=>acceleratorKey(value)));
  if(saved.bots&&typeof saved.bots==='object')for(const [id,value] of Object.entries(saved.bots))takeShortcut(seen,map.bots,id,value);
  if(saved.opens&&typeof saved.opens==='object')for(const [id,value] of Object.entries(saved.opens))takeShortcut(seen,map.opens,id,value);
  return map;
}

export function formatAccelerator(accelerator,platform='darwin'){
  if(!accelerator)return '';
  if(platform!=='darwin')return accelerator;
  const symbols={Command:'⌘',Cmd:'⌘',Control:'⌃',Ctrl:'⌃',CommandOrControl:'⌘',CmdOrCtrl:'⌘',Alt:'⌥',Option:'⌥',Shift:'⇧',Space:'Space'};
  return accelerator.split('+').map(part=>symbols[part]??part).join('');
}
