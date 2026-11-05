export function mainWindowOptions(platform){
  const mac=platform==='darwin';
  return {
    width:860,height:670,minWidth:720,minHeight:540,title:'设置',show:false,
    titleBarStyle:mac?'hiddenInset':'default',backgroundColor:'#00000000',transparent:mac,hasShadow:true,
    ...(mac?{vibrancy:'fullscreen-ui',trafficLightPosition:{x:14,y:18}}:{}),
    ...(platform==='win32'?{frame:false}:{})
  };
}
export function acceptWindowControl(action){
  if(action==='minimize'||action==='toggleMaximize'||action==='close')return action;
  return null;
}
// Windows 无边框最大化时窗口会伸出工作区，四边溢出取最大正值作为内容内边距
// 2026-11-01 maximizedContentInset(platform, maximized, bounds, workArea) → number
export function maximizedContentInset(platform,maximized,bounds,workArea){
  if(platform!=='win32'||maximized!==true||!bounds||!workArea)return 0;
  const edges=[
    Number(workArea.x)-Number(bounds.x),
    Number(workArea.y)-Number(bounds.y),
    Number(bounds.x)+Number(bounds.width)-(Number(workArea.x)+Number(workArea.width)),
    Number(bounds.y)+Number(bounds.height)-(Number(workArea.y)+Number(workArea.height))
  ];
  if(edges.some(edge=>!Number.isFinite(edge)))return 0;
  return Math.max(0,...edges.map(edge=>Math.round(edge)));
}
export function editCommand(input){
  if(!input||input.type!=='keyDown'||input.control!==true||input.alt===true||input.meta===true||input.isComposing===true)return null;
  const key=String(input.key??'').toLowerCase();
  if(key==='z')return input.shift===true?'redo':'undo';
  if(input.shift===true)return null;
  if(key==='a')return 'selectAll';
  if(key==='c')return 'copy';
  if(key==='x')return 'cut';
  if(key==='v')return 'paste';
  if(key==='y')return 'redo';
  return null;
}
export function windowCaptionButtons(platform){
  if(platform!=='win32')return [];
  return [{action:'minimize'},{action:'toggleMaximize'},{action:'close'}];
}
export function windowCaptionLabel(action,{maximized=false,zh=false}={}){
  const pair=action==='minimize'?['最小化','Minimize']:action==='toggleMaximize'?(maximized?['还原','Restore']:['最大化','Maximize']):action==='close'?['关闭','Close']:null;
  if(!pair)return '';
  return zh?pair[0]:pair[1];
}
export function captionGlyph(name){
  if(name==='minimize')return ['M1 5h8'];
  if(name==='maximize')return ['M1.5 1.5h7v7h-7z'];
  if(name==='restore')return ['M3.5 3.5V1.5H8.5V6.5H6.5','M1.5 3.5h5v5h-5z'];
  if(name==='close')return ['M1.5 1.5l7 7','M8.5 1.5l-7 7'];
  return [];
}
