// Scheduled tasks reuse delivery receipts, including their attachment copies and
// account scope. Persist "running" before submitting: an interrupted process is
// held for review instead of replayed.
export class TaskQueue {
  constructor({store,session,now=Date.now,enabled=true}) { Object.assign(this,{store,session,now,enabled}); this.active=new Set(); this.startedAt=now(); }
  current(id) {
    const account=this.session.requireAccount(), item=this.store.get(id,account);
    if(!item?.queue)throw new Error('TASK_NOT_FOUND');
    return {account,item};
  }
  async create({botId,text='',files=[],dueAt=null}) {
    const account=this.session.requireAccount();
    if(dueAt!==null&&(!Number.isSafeInteger(dueAt)||dueAt<=this.now()))throw new Error('TASK_TIME_INVALID');
    const item=await this.session.receive({botId,source:'drop',manual:true,text,files});
    if(this.session.requireAccount()!==account)throw new Error('ACCOUNT_BUSY');
    const result=this.store.update(item.id,account,{queue:{state:'queued',dueAt,order:Math.max(-1,...this.store.list(account).filter(row=>row.queue).map(row=>row.queue.order??-1))+1}});this.session.emit();return result;
  }
  update(id,{text,dueAt,order}={}) {
    const {account,item}=this.current(id);
    if(!['queued','missed'].includes(item.queue.state))throw new Error('TASK_NOT_EDITABLE');
    if(text!==undefined&&(typeof text!=='string'||text.length>2_000_000||(!text.trim()&&!item.files.length)))throw new Error('MESSAGE_INVALID');
    if(dueAt!==undefined&&dueAt!==null&&(!Number.isSafeInteger(dueAt)||dueAt<=this.now()))throw new Error('TASK_TIME_INVALID');
    if(order!==undefined&&!Number.isSafeInteger(order))throw new Error('TASK_ORDER_INVALID');
    const queue={...item.queue,...dueAt!==undefined?{dueAt,state:'queued'}:{},...order!==undefined?{order}:{}};
    const result=this.store.update(id,account,{...text!==undefined?{text}:{},queue});this.session.emit();return result;
  }
  cancel(id) {
    const {account,item}=this.current(id);
    if(!['queued','missed'].includes(item.queue.state))throw new Error('TASK_NOT_CANCELLABLE');
    const result=this.store.update(id,account,{queue:{...item.queue,state:'cancelled'}});this.session.emit();return result;
  }
  move(id,direction) {
    const {account,item}=this.current(id);
    if(!['queued','missed'].includes(item.queue.state)||![-1,1].includes(direction))throw new Error('TASK_NOT_EDITABLE');
    const rows=this.store.list(account).filter(row=>['queued','missed'].includes(row.queue?.state)).sort((a,b)=>(a.queue.order-b.queue.order)||a.id.localeCompare(b.id));
    const index=rows.findIndex(row=>row.id===id), other=index+direction;
    if(other<0||other>=rows.length)return item;
    [rows[index],rows[other]]=[rows[other],rows[index]];
    this.store.db.exec('BEGIN IMMEDIATE');
    try { rows.forEach((row,i)=>this.store.update(row.id,account,{queue:{...row.queue,order:i}})); this.store.db.exec('COMMIT'); }
    catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.session.emit();return this.store.get(id,account);
  }
  async dispatch(id) {
    if(!this.enabled)throw new Error('PREVIEW_ONLY');
    const {account,item}=this.current(id);
    if(!['queued','missed'].includes(item.queue.state)||this.active.has(id))throw new Error('TASK_NOT_SENDABLE');
    this.session.requireClient();
    this.active.add(id);
    this.store.update(id,account,{queue:{...item.queue,state:'running'}});this.session.emit();
    try {
      const sent=await this.session.submit(id,item.text);
      const state=sent.status==='sent'?'sent':sent.status==='failed'?'failed':'unconfirmed';
      this.store.update(id,account,{queue:{...item.queue,state,dueAt:item.queue.dueAt}});this.session.emit();return this.store.get(id,account);
    } catch(error) {
      const current=this.store.get(id,account);
      if(current)this.store.update(id,account,{queue:{...item.queue,state:current.phase==='sending'||current.status==='unconfirmed'?'unconfirmed':'failed'}});
      this.session.emit();throw error;
    } finally { this.active.delete(id); }
  }
  tick() {
    const account=this.session.account?.id;if(!account)return;
    const now=this.now();
    for(const item of this.store.list(account)) {
      const q=item.queue;if(q?.state!=='queued'||q.dueAt==null||q.dueAt>now)continue;
      if(!this.enabled||!this.session.client||this.session.transition||q.dueAt<=this.startedAt||now-q.dueAt>60_000){this.store.update(item.id,account,{queue:{...q,state:'missed'}});this.session.emit();continue;}
      void this.dispatch(item.id).catch(()=>{});
    }
  }
}
