export const BOT_ID=/^[A-Za-z0-9_-]{1,128}$/;
export const BATCH_ID=/^[a-f0-9]{32}$/i;
export const TEXT_LIMIT=8000;
const ACTIONS=new Set(['open','compose','send','share']);

function tokenField(key){
  const name=String(key).toLowerCase().replace(/[^a-z0-9]+/g,'');
  return name==='token'||name.endsWith('token')||name.endsWith('tokens');
}
function collectedParams(url){
  const params=new URLSearchParams(url.search);
  const hash=url.hash.startsWith('#')?url.hash.slice(1):'';
  if(!hash)return params;
  const extra=new URLSearchParams(hash.startsWith('?')?hash.slice(1):hash);
  for(const [key,value] of extra)params.append(key,value);
  return params;
}
export function parseDeeplink(input){
  if(typeof input!=='string'||!input.trim())return {ok:false,reason:'invalid'};
  let url;
  try{url=new URL(input.trim());}catch{return {ok:false,reason:'invalid'};}
  if(url.protocol!=='grokbotquick:')return {ok:false,reason:'scheme'};
  if(url.username||url.password)return {ok:false,reason:'token'};
  if(url.port)return {ok:false,reason:'host'};
  const action=url.hostname;
  if(!ACTIONS.has(action))return {ok:false,reason:'host'};
  if(url.pathname&&url.pathname!=='/')return {ok:false,reason:'path'};
  const params=collectedParams(url);
  for(const key of params.keys())if(tokenField(key))return {ok:false,reason:'token'};
  const texts=params.getAll('text');
  if(texts.some(value=>value.length>TEXT_LIMIT))return {ok:false,reason:'text'};
  const bots=params.getAll('bot');
  if(bots.some(value=>!BOT_ID.test(value)))return {ok:false,reason:'bot'};
  if(action==='send'&&!bots.length)return {ok:false,reason:'bot'};
  // The Windows share helper writes a batch folder and passes its id; the Bot
  // is chosen in the app, so a share link never carries one.
  if(action==='share'){
    const batches=params.getAll('batch');
    if(batches.length!==1||!BATCH_ID.test(batches[0]))return {ok:false,reason:'batch'};
    // A share names a batch, never a Bot: the picker decides that.
    if(bots.length)return {ok:false,reason:'bot'};
    return {ok:true,action,batch:batches[0],bot:null,text:'',hasText:false};
  }
  return {ok:true,action,bot:bots[0]??null,text:texts[0]??'',hasText:texts.length>0};
}
export function composeLink(botId){
  if(!BOT_ID.test(botId??''))return null;
  return `grokbotquick://compose?bot=${botId}`;
}
export function shortcutSourceAllowed(recipient){
  return recipient?.enabled===true&&recipient?.sources?.shortcuts===true;
}
const DEEPLINK_NOTICES={
  DEEPLINK_IGNORED:['这个链接没有执行。','This link did not run.'],
  SOURCE_DISABLED:['请先为这个 Bot 打开接收，并打开对应来源。','Enable this Bot and the source you are using.'],
  BOT_NOT_FOUND:['没有找到这个 Bot。','That Bot was not found.'],
  LOGIN_REQUIRED:['请登录后发送。内容已留在这台电脑上。','Sign in to send. Your context stays on this computer.'],
  RECEIPT_EMPTY:['先写一点内容，或加上文件。','Write something or add a file.']
};
export function deeplinkNotice(locale,code){
  const pair=DEEPLINK_NOTICES[code]??['这个链接没有执行。','This link did not run.'];
  return String(locale??'').toLowerCase().startsWith('zh')?pair[0]:pair[1];
}
