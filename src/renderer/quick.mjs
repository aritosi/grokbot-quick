const api=window.grokbotQuick,root=document.querySelector('#app'),wheel=new URLSearchParams(location.search).get('mode')==='wheel';
let state,selected='',page=0,view='list',draft='',sending=false,errorText='';const drafts=new Map();
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(cls,text,label,fn)=>{const e=make('button',cls,text);e.type='button';e.setAttribute('aria-label',label||text);e.title=label||text;e.addEventListener('click',fn);return e;};
const bots=()=>state?.bots?.filter(b=>b?.id&&b.name)??[];
const current=()=>bots().find(b=>b.id===selected);
async function act(action,id){try{await api.quickAction(action,id);}catch(error){errorText=error.message;showError();}}
function showError(){const notice=root.querySelector('.message');if(notice)notice.textContent=errorText;}
function choose(bot){selected=bot.id;draft=drafts.get(bot.id)??'';errorText='';view='chat';void api.noteBot(bot.id).catch(()=>{});paint();root.querySelector('textarea')?.focus();}
function paint(){
 document.documentElement.dataset.theme=state.theme||'system';root.replaceChildren();
 if(wheel){paintWheel();return;}if(view==='chat'&&current()){paintChat();return;}paintList();
}
function paintList(){
 const card=make('section','panel list-panel');const head=make('header','list-head');
 const title=make('div');title.append(make('div','eyebrow','GROKBOT QUICK'),make('h1','','你的 Bot'));
 head.append(title,button('circle-button','⚙','设置',()=>act('settings')));card.append(head,make('p','subtitle','轻点一个 Bot，开始对话'));
 const list=make('div','bot-list');for(const bot of bots()){const item=button('bot','',`与 ${bot.name} 对话`,()=>choose(bot));item.append(make('span','bot-icon',bot.name.trim().slice(0,1).toUpperCase()),make('span','bot-name',bot.name),make('span','chevron','›'));list.append(item);}if(!bots().length)list.append(make('p','empty','登录后即可在这里选择 Bot。'));card.append(list);
 const foot=make('footer','menu-foot');foot.append(button('foot-action','◉  快捷轮盘','打开快捷轮盘',()=>act('wheel')),button('foot-action quiet','退出','退出应用',()=>act('quit')));card.append(foot,make('p','message'));root.append(card);
}
function paintChat(){
 const bot=current(),card=make('section','panel chat-panel'),head=make('header','chat-head');
 const back=button('circle-button back','‹','返回 Bot 列表',()=>{view='list';paint();});
 const identity=make('div','chat-identity');identity.append(make('strong','chat-name',bot.name),make('span','chat-subtitle','Bot 对话'));
 head.append(back,identity,button('circle-button','⤢','展开或收起聊天',()=>act('expand',bot.id)),button('circle-button','⚙','此 Bot 的设置',()=>act('botSettings',bot.id)));card.append(head);
 const thread=make('div','thread');thread.setAttribute('role','log');thread.setAttribute('aria-label','本工具中的对话记录');card.append(thread);
 const composer=make('form','chat-compose'),field=make('textarea','chat-input');field.rows=1;field.placeholder='发送消息…';field.setAttribute('aria-label','消息');field.value=draft;field.addEventListener('input',()=>{draft=field.value;drafts.set(bot.id,draft);send.disabled=sending||!draft.trim();});
 const send=make('button','send-button','↑');send.type='submit';send.setAttribute('aria-label','发送消息');send.disabled=sending||!draft.trim();
 field.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();composer.requestSubmit();}});
 composer.addEventListener('submit',async event=>{event.preventDefault();const text=draft.trim();if(!text||sending)return;sending=true;send.disabled=true;errorText='';showError();try{await api.sendDraft(bot.id,text,[]);if((drafts.get(bot.id)??'').trim()===text){drafts.delete(bot.id);if(selected===bot.id){draft='';field.value='';}}if(field.isConnected)field.focus();}catch(error){errorText=error.message==='PREVIEW_ONLY'?'预览模式不能发送消息':error.message==='LOGIN_REQUIRED'?'请先登录账号':'发送未完成，请检查连接或发送记录。';showError();}finally{sending=false;send.disabled=!draft.trim();}});
 composer.append(field,send);card.append(composer,make('p','message'));root.append(card);paintThread();showError();
}
function paintThread(){
 const thread=root.querySelector('.thread');if(!thread)return;const nearBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<80;thread.replaceChildren();
 const records=(state.inbox??[]).filter(item=>item.botId===selected&&item.status!=='needs-input').slice().reverse();const seen=new Set();
 for(const item of records){if(item.text){const line=make('div','bubble-row outgoing'),bubble=make('div','bubble',item.text);line.append(bubble);thread.append(line);if(item.status==='failed'||item.status==='unconfirmed')thread.append(make('div','delivery-status',item.status==='failed'?'发送失败，请在发送记录中查看':'发送结果未确认，请在发送记录中查看'));}for(const reply of item.replies??[]){if(reply.id&&seen.has(reply.id))continue;if(reply.id)seen.add(reply.id);const row=make('div','bubble-row incoming');row.append(make('div','bubble',reply.text));thread.append(row);}}
 if(!thread.childElementCount){const blank=make('div','chat-empty');blank.append(make('span','chat-empty-icon','✦'),make('strong','','有什么可以帮你？'),make('span','','这里显示本工具发送的消息和收到的回复。'));thread.append(blank);}if(nearBottom)thread.scrollTop=thread.scrollHeight;
}
function paintWheel(){
 const all=bots();if(!all.some(b=>b.id===selected))selected=all[0]?.id??'';const bot=current(),shell=make('section','wheel');shell.append(make('div','ring outer'),make('div','ring inner'));
 const center=make('div','center');center.append(make('span','center-caption','选择 BOT'),make('strong','center-name',bot?.name??'暂无 Bot'),make('span','center-hint','轻点 Bot 打开聊天'));shell.append(center);
 const rows=all.slice(page*6,page*6+6);rows.forEach((item,i)=>{const angle=(-90+i*360/Math.max(rows.length,1))*Math.PI/180;const b=button('orbit-bot'+(selected===item.id?' selected':''),item.name,`与 ${item.name} 对话`,()=>act('compose',item.id));b.style.left=`${50+27*Math.cos(angle)}%`;b.style.top=`${50+27*Math.sin(angle)}%`;shell.append(b);});
 const actions=[['↗','Grok Bot',()=>act('open',selected)],['⚙','设置',()=>act('settings')]];actions.forEach(([symbol,label,fn],i)=>{const angle=(-45+i*90)*Math.PI/180;const b=button('orbit-action','',label,fn);b.style.left=`${50+43*Math.cos(angle)}%`;b.style.top=`${50+43*Math.sin(angle)}%`;b.append(make('span','action-icon',symbol),make('span','action-label',label));if(i===0&&!selected)b.disabled=true;shell.append(b);});
 if(all.length>6){const pages=make('div','pagination');pages.append(button('page-button','‹','上一页',()=>{page=(page-1+Math.ceil(all.length/6))%Math.ceil(all.length/6);paint();}),make('span','',`${page+1} / ${Math.ceil(all.length/6)}`),button('page-button','›','下一页',()=>{page=(page+1)%Math.ceil(all.length/6);paint();}));shell.append(pages);}shell.append(make('p','message'));root.append(shell);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.close();});
api.onChange(message=>{if(message.event==='quick-reset'&&!wheel){view='list';if(state)paint();}if(message.event==='state'){state=message.data;document.documentElement.dataset.theme=state.theme||'system';if(view==='chat'&&!wheel&&current())paintThread();else paint();}});api.state().then(value=>{state=value;paint();});
