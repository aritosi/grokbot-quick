import {randomUUID} from 'node:crypto';
export class RpcClient {
  constructor({send,onEvent=()=>{}}){Object.assign(this,{send,onEvent});this.pending=new Map();this.closed=false;}
  call(method,params={},timeout=120000){
    if(this.closed)return Promise.reject(new Error('SERVICE_EXITED'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=timeout>0?setTimeout(()=>{this.pending.delete(id);reject(new Error('REQUEST_TIMEOUT'));},timeout):null;
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  receive(message){
    if(!message||typeof message!=='object')return;
    if(message.event){this.onEvent(message);return;}
    const pending=this.pending.get(message.id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(message.id);
    if(message.error)pending.reject(Object.assign(new Error(message.error.code),{code:message.error.code}));else pending.resolve(message.result);
  }
  close(){this.closed=true;for(const {reject,timer} of this.pending.values()){clearTimeout(timer);reject(new Error('SERVICE_EXITED'));}this.pending.clear();}
}
