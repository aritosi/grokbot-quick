// Application-owned attachment transport. Bot login/list/send/watch remain in grok-bot-sdk.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Transform} from 'node:stream';

const API='https://api2.cursor.sh/aiserver.v1.GrokBotService/';
export async function uploadFile(file,{credentials,botId,sessionId='',deadline=Date.now()+90000,fetchImpl=fetch,onProgress=()=>{}}) {
  const info=await stat(file.path);if(!info.isFile()||!info.size)throw new Error('ATTACHMENT_INVALID');
  onProgress({bytes:0,totalBytes:info.size});
  const hash=createHash('sha256');for await(const chunk of createReadStream(file.path))hash.update(chunk);
  const headers={authorization:`Bearer ${credentials.accessToken}`,'content-type':'application/json','connect-protocol-version':'1','x-cursor-client-type':'sand','x-cursor-client-version':credentials.version??'0.70.2','x-cursor-client-source':'sand-desktop','x-sand-box-namespace':'prod','x-ghost-mode':'true'};
  if(credentials.teamId!==undefined)headers['x-cursor-team-id']=String(credentials.teamId);
  const signal=()=>{const left=deadline-Date.now();if(left<=0)throw new Error('UPLOAD_EXPIRED');return AbortSignal.timeout(Math.max(1,Math.floor(Math.min(30*60_000,left))));};
  const request=async(url,options)=>{
    const response=await fetchImpl(url,{...options,redirect:'error',signal:signal()});
    if(!response.ok)throw Object.assign(new Error('UPLOAD_FAILED'),{httpStatus:response.status});return response;
  };
  const rpc=async(method,body)=>(await request(API+method,{method:'POST',headers:{...headers,'x-request-id':randomUUID()},body:JSON.stringify(body)})).json();
  const begun=await rpc('BeginGrokBotAttachmentUpload',{agentId:botId,...sessionId?{sessionId}:{},fileName:file.name,sizeBytes:String(info.size),supportsStoreAttachmentRefs:true,supportsMultipart:false,sha256Hex:hash.digest('hex')});
  if([1,'GROK_BOT_ATTACHMENT_UPLOAD_MODE_USE_BOX'].includes(begun.mode)){
    // The gateway endpoint accepts base64 JSON, not a streaming/multipart body.
    if(info.size>64*1024*1024)throw new Error('GATEWAY_ATTACHMENT_TOO_LARGE');
    let box;
    for(let attempt=0;attempt<10;attempt++){
      box=await rpc('EnsureSandBox',{wake:true,supportsAsleepBox:true});
      if(box.gatewayUrl&&box.gatewayToken)break;
      await delay(1000,undefined,{signal:signal()});
    }
    const url=new URL(box?.gatewayUrl??'https://invalid');
    if(url.protocol!=='https:'||!url.hostname.endsWith('.cursorvm.com')||url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443')||url.pathname!=='/')throw new Error('UNTRUSTED_UPLOAD_ORIGIN');
    const gatewayHeaders={authorization:`Bearer ${box.gatewayToken}`,'content-type':'application/json'};
    if(box.networkToken)gatewayHeaders['x-anyrun-network-token']=box.networkToken;
    const data=await(await request(new URL('/api/uploadAttachment',url),{method:'POST',headers:gatewayHeaders,body:JSON.stringify({agentId:botId,filename:file.name,bytesBase64:(await readFile(file.path)).toString('base64')})})).json();
    onProgress({bytes:info.size,totalBytes:info.size});
    if(typeof data.path!=='string'||!data.path)throw new Error('UPLOAD_TARGET_INVALID');return {path:data.path,name:file.name};
  }
  if(![2,'GROK_BOT_ATTACHMENT_UPLOAD_MODE_SINGLE_PUT'].includes(begun.mode))throw new Error('UPLOAD_MODE_UNSUPPORTED');
  if(!begun.uploadToken||!begun.put?.url)throw new Error('UPLOAD_TARGET_INVALID');
  const url=new URL(begun.put.url);
  const trusted=url.hostname.endsWith('.amazonaws.com')||url.hostname.endsWith('.r2.cloudflarestorage.com')||url.hostname==='storage.googleapis.com'||url.hostname.endsWith('.storage.googleapis.com');
  if(!trusted||url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))throw new Error('UNTRUSTED_UPLOAD_ORIGIN');
  const putHeaders={};for(const [key,value] of Object.entries(begun.put.headers??{})){
    const name=key.toLowerCase();if(name==='authorization'||name==='cookie'||name.startsWith('x-cursor-'))throw new Error('UPLOAD_HEADERS_INVALID');
    if(name==='content-length'&&String(value)!==String(info.size))throw new Error('UPLOAD_LENGTH_MISMATCH');
    putHeaders[name]=value;
  }
  let sent=0;
  const body=createReadStream(file.path).pipe(new Transform({transform(chunk,_encoding,callback){sent+=chunk.length;onProgress({bytes:sent,totalBytes:info.size});callback(null,chunk);}}));
  try{const response=await request(url,{method:'PUT',headers:putHeaders,body,duplex:'half'});await response.body?.cancel();onProgress({bytes:info.size,totalBytes:info.size});}finally{body.destroy();}
  const result=await rpc('CompleteGrokBotAttachmentUpload',{uploadToken:begun.uploadToken});
  if(![undefined,0,'GROK_BOT_ATTACHMENT_UPLOAD_REFUSAL_UNSPECIFIED'].includes(result.refusal)||typeof result.alias!=='string'||!result.alias||result.sizeBytes!==undefined&&BigInt(result.sizeBytes)!==BigInt(info.size))throw new Error('UPLOAD_COMMIT_REFUSED');
  return {path:result.alias,name:file.name};
}
