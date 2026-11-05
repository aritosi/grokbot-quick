import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Local JSON-lines transport: the native view never receives credentials.
export class NativeUI {
  constructor(executable,onAction,environment={}){this.executable=executable;this.onAction=onAction;this.environment=environment;this.ready=false;}
  start(){
    return new Promise((resolve,reject)=>{
      const child=this.child=spawn(this.executable,[],{stdio:['pipe','pipe','pipe'],env:{...process.env,...this.environment,...((process.argv.includes('--native-settings-self-test')||process.argv.includes('--avatar-self-test'))?{GROK_NATIVE_TEST:'1'}:{})}});
      child.stderr.on('data',data=>console.error('Native UI:',data.toString().trim()));
      const timer=setTimeout(()=>{child.kill();reject(new Error('NATIVE_UI_TIMEOUT'));},15000);
      const fail=error=>{clearTimeout(timer);this.ready=false;reject(error);};
      child.once('error',fail);child.once('exit',()=>{this.ready=false;fail(new Error('NATIVE_UI_EXITED'));});
      child.stdin.on('error',()=>{this.ready=false;});
      createInterface({input:child.stdout}).on('line',line=>{
        if(Buffer.byteLength(line)>4*1024*1024)return;
        let message;try{message=JSON.parse(line);}catch{return;}
        if(message.action==='ready'){this.ready=true;clearTimeout(timer);resolve();return;}
        Promise.resolve(this.onAction(message)).catch(error=>console.error('Native UI action:',error.message));
      });
    });
  }
  send(value){if(this.ready&&this.child?.stdin.writable)this.child.stdin.write(JSON.stringify(value)+'\n');}
  stop(){this.send({command:'quit'});this.child?.stdin.end();}
}
