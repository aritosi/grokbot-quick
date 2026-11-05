import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InboxStore} from '../src/service/store.mjs';

test('new Bot accepts general inputs by default while WeChat is off',()=>{
 const dir=mkdtempSync(join(tmpdir(),'grrobot-recipient-'));const store=new InboxStore(dir);
 try {const r=store.recipient('a','b');assert.equal(r.enabled,true);assert.equal(r.sources.drop,true);assert.equal(r.sources.share,true);assert.equal(r.sources.wechat,false);assert.equal(r.mode,'compose');}
 finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('legacy disabled sources become general enabled and WeChat remains unavailable',()=>{
 const dir=mkdtempSync(join(tmpdir(),'grrobot-recipient-'));const store=new InboxStore(dir);
 try {store.saveRecipient('a','b',{enabled:false,mode:'direct',sources:{drop:false,share:false,wechat:true}});const r=store.recipient('a','b');assert.equal(r.enabled,true);assert.equal(r.sources.drop,true);assert.equal(r.sources.share,true);assert.equal(r.sources.wechat,false);assert.equal(r.mode,'direct');}
 finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
