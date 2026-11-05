import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InboxStore} from '../src/service/store.mjs';
import {TaskQueue} from '../src/service/task-queue.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'grok-task-test-')),store=new InboxStore(root);let clock=1000,sends=0;
  const session={account:{id:'a'},client:{},transition:false,emit(){},requireAccount(){return this.account.id},requireClient(){if(!this.client)throw Error('LOGIN_REQUIRED')},
    async receive({botId,text,files}) { const item={id:`id${store.list('a').length}`,accountId:'a',botId,text,files:files.map(path=>({path})),status:'needs-input',phase:'ready'};store.add(item);return item; },
    async submit(id){sends++;return store.update(id,'a',{status:'sent',phase:'done'})}};
  const queue=new TaskQueue({store,session,now:()=>clock});
  return {store,session,queue,advance(n){clock+=n},sends:()=>sends,close(){store.close();rmSync(root,{recursive:true,force:true})}};
}
test('create, edit, reorder and cancel queued tasks',async()=>{const f=fixture();try{
  const a=await f.queue.create({botId:'b',text:'first'}),b=await f.queue.create({botId:'b',text:'second'});
  f.queue.update(a.id,{text:'edited'});f.queue.move(b.id,-1);
  assert.equal(f.store.get(a.id,'a').text,'edited');assert.equal(f.store.get(b.id,'a').queue.order,0);
  f.queue.cancel(a.id);assert.equal(f.store.get(a.id,'a').queue.state,'cancelled');
  await assert.rejects(f.queue.dispatch(a.id),/TASK_NOT_SENDABLE/);
}finally{f.close()}});
test('scheduled dispatch runs once and records final result',async()=>{const f=fixture();try{
  const a=await f.queue.create({botId:'b',text:'hello',dueAt:1100});f.advance(100);f.queue.tick();f.queue.tick();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.sends(),1);assert.equal(f.store.get(a.id,'a').queue.state,'sent');
  await assert.rejects(f.queue.dispatch(a.id),/TASK_NOT_SENDABLE/);
}finally{f.close()}});
test('offline and overdue after restart are missed, never automatically sent',async()=>{const f=fixture();try{
  const a=await f.queue.create({botId:'b',text:'hello',dueAt:1100});f.session.client=null;f.advance(100);f.queue.tick();
  assert.equal(f.store.get(a.id,'a').queue.state,'missed');assert.equal(f.sends(),0);
  f.session.client={};f.queue.update(a.id,{dueAt:1200});f.advance(100);
  const restarted=new TaskQueue({store:f.store,session:f.session,now:()=>1200});restarted.tick();
  assert.equal(f.store.get(a.id,'a').queue.state,'missed');assert.equal(f.sends(),0);
}finally{f.close()}});
test('restart holds tasks interrupted while running',async()=>{const root=mkdtempSync(join(tmpdir(),'grok-task-test-'));try{
  let store=new InboxStore(root);store.add({id:'x',accountId:'a',phase:'sending',queue:{state:'running'}});store.close();
  store=new InboxStore(root);const item=store.get('x','a');assert.equal(item.queue.state,'unconfirmed');assert.equal(item.status,'unconfirmed');store.close();
}finally{rmSync(root,{recursive:true,force:true})}});

test('real delivery receives its own attachment copy and sends once',async()=>{
  const {AccountSession}=await import('../src/service/session.mjs');
  const {Delivery}=await import('../src/service/delivery.mjs');
  const root=mkdtempSync(join(tmpdir(),'grok-task-integration-'));let store;
  try {
    store=new InboxStore(root);const file=join(root,'source.txt');writeFileSync(file,'sample');let sends=0;
    const session=new AccountSession({store,now:()=>1000,upload:async f=>({path:'/uploaded',name:f.name})});
    session.account={id:'account'};session.bots=[{id:'bot',name:'Test'}];session.client={sendMessage:async()=>{sends++;return {}}};
    session.delivery=new Delivery({store,client:session.client,now:()=>1000,upload:async f=>({path:'/uploaded',name:f.name})});
    const q=new TaskQueue({store,session,now:()=>1000});
    const item=await q.create({botId:'bot',text:'read',files:[file]});assert.notEqual(item.files[0].path,file);
    const result=await q.dispatch(item.id);assert.equal(result.queue.state,'sent');assert.equal(result.status,'sent');assert.equal(sends,1);
    session.close();
  } finally {store?.close();rmSync(root,{recursive:true,force:true})}
});
