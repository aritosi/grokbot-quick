import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeShortcutMap} from '../src/shortcuts.mjs';

test('screenshot shortcut defaults, can be customized and disabled',()=>{
  assert.equal(normalizeShortcutMap(null).screenshot,'Ctrl+Alt+Shift+S');
  assert.equal(normalizeShortcutMap({screenshot:'Command+Shift+Y'}).screenshot,'Command+Shift+Y');
  assert.equal(normalizeShortcutMap({screenshot:null}).screenshot,null);
});
test('screenshot shortcut never takes an existing wheel binding',()=>{
  const result=normalizeShortcutMap({wheel:'Command+Alt+Shift+Space',screenshot:'Command+Alt+Shift+Space'});
  assert.equal(result.screenshot,null);
});
test('bottom bar and Bot shortcuts are saved and collisions are rejected',async()=>{
 const {InboxStore}=await import('../src/service/store.mjs');const {AccountSession}=await import('../src/service/session.mjs');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'grok-shortcuts-')),store=new InboxStore(dir),session=new AccountSession({store});
 try {session.bots=[{id:'bot-1',name:'test'}];session.setShortcut('compose','Command+Shift+B');session.setShortcut('bot-1','Command+Shift+J');const saved=session.shortcutMap();assert.equal(saved.compose,'Command+Shift+B');assert.equal(saved.bots['bot-1'],'Command+Shift+J');assert.throws(()=>session.setShortcut('wheel','Command+Shift+J'),/SHORTCUT_UNAVAILABLE/);}
 finally {session.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
