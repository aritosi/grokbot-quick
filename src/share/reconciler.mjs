import {shareConfiguration} from './model.mjs';
export class MenuReconciler {
 constructor({sync,publish,needsUpdate,update,onError=()=>{},delay=300}){Object.assign(this,{sync,publish,needsUpdate,update,onError,delay});this.revision=0;this.applied=0;this.closed=false;}
 request(state){
  this.latest=state;const key=JSON.stringify(shareConfiguration(state));if(key===this.key)return;
  this.key=key;this.revision++;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(this.onError),this.delay);
  if(this.publish){this.published=Promise.resolve().then(()=>this.publish(state));this.published.catch(this.onError);}
 }
 async flush({force=false}={}){
  clearTimeout(this.timer);if(force&&this.latest){this.revision++;this.force=true;}
  if(this.running)return this.running;if(!this.latest||this.closed)return this.result;
  this.running=(async()=>{
   let retries=0;
   while(!this.closed&&this.applied!==this.revision){
    const revision=this.revision,state=this.latest;
    if(this.publish)await this.published;else await this.sync(state);
    if(revision===this.revision&&!state.accountBusy&&(this.force||this.needsUpdate())){
     try{
      this.result=await this.update(state,()=>!this.closed&&revision===this.revision,!!this.force);
      retries=0;this.force=false;
     }catch(error){
      const code=error?.message;
      const superseded=code==='MENU_SUPERSEDED';
      const busy=code==='MENU_UPDATE_BUSY'||code==='ACCOUNT_BUSY';
      // A newer state arrived while installing: retry it. A previous installer
      // still unwinding is also expected: wait and retry a bounded number of
      // times. Neither should surface MENU_UPDATE_FAILED or lose the request.
      if(!this.closed&&(superseded||(busy&&retries<4))){
       if(!superseded)retries++;
       await new Promise(resolve=>setTimeout(resolve,superseded?20:350));
       continue;
      }
      throw error;
     }
    }
    this.applied=revision;
   }
   return this.result;
  })().finally(()=>{this.running=null;});
  return this.running;
 }
 close(){this.closed=true;clearTimeout(this.timer);}
}
