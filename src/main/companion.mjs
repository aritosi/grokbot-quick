import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {RpcClient} from './rpc.mjs';

export class NativeCompanion {
  constructor({executable,avatarRoot,onRequest,onEvent=()=>{},smoke=false}){Object.assign(this,{executable,avatarRoot,onRequest,onEvent,smoke});this.ready=false;}
  async start(){
    this.child=spawn(this.executable,['--companion'],{stdio:['pipe','pipe','pipe'],env:{...process.env,GROK_BOT_AVATAR_ROOT:this.avatarRoot,...this.smoke?{GROKBOT_QUICK_SMOKE:'1'}:{}}});
    this.child.stderr.resume();
    this.rpc=new RpcClient({send:request=>this.child.stdin.write(JSON.stringify(request)+'\n'),onEvent:message=>this.onEvent(message)});
    this.child.stdin.on('error',()=>this.rpc.close());
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(new Error('NATIVE_COMPANION_TIMEOUT'));this.stop();},15000);
      const fail=()=>{clearTimeout(timer);this.ready=false;this.rpc.close();reject(new Error('NATIVE_COMPANION_EXITED'));this.onEvent({event:'exit'});};
      this.child.once('error',fail);this.child.once('exit',fail);
      const lines=createInterface({input:this.child.stdout});
      lines.on('line',line=>{
        if(Buffer.byteLength(line)>4*1024*1024)return;
        let message;try{message=JSON.parse(line);}catch{return;}
        if(message.event==='hello'){
          if(message.data?.version!==1){clearTimeout(timer);reject(new Error('NATIVE_PROTOCOL_MISMATCH'));this.stop();return;}
          this.ready=true;clearTimeout(timer);resolve(message.data);return;
        }
        if(typeof message.method==='string'&&typeof message.id==='string'){
          void Promise.resolve().then(()=>this.onRequest(message.method,message.params??{})).then(
            result=>this.reply({id:message.id,result:result??{}}),
            error=>this.reply({id:message.id,error:{code:/^[A-Z][A-Z0-9_]{1,70}$/.test(error.message)?error.message:'HOST_REQUEST_FAILED'}}));
        }else this.rpc.receive(message);
      });
    });
  }
  reply(value){if(this.child&&!this.child.killed)this.child.stdin.write(JSON.stringify(value)+'\n');}
  call(method,params){if(!this.ready)return Promise.reject(new Error('NATIVE_COMPOSER_UNAVAILABLE'));return this.rpc.call(method,params);}
  stop(){this.ready=false;this.rpc?.close();this.child?.stdin.end();this.child?.kill();}
}
