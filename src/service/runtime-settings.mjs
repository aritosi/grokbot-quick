import {randomUUID} from 'node:crypto';

const API='https://api2.cursor.sh/aiserver.v1.GrokBotService/GetGrokBotUserRuntimeSettings';
function checksum(machineId){
  const t=Math.floor(Date.now()/1e6);
  const bytes=Uint8Array.from([t>>40&255,t>>32&255,t>>24&255,t>>16&255,t>>8&255,t&255]);
  let previous=165;
  for(let i=0;i<bytes.length;i++){bytes[i]=(bytes[i]^previous)+i%256;previous=bytes[i];}
  return Buffer.from(bytes).toString('base64url')+machineId;
}
function headersFor(credentials){
  const version=credentials.version??'0.78.1';
  const headers={
    'content-type':'application/json','connect-protocol-version':'1',
    authorization:`Bearer ${credentials.accessToken}`,'x-cursor-client-type':'sand',
    'x-cursor-client-version':version,'x-cursor-client-source':'sand-desktop',
    'x-cursor-client-os':'darwin','x-sand-box-namespace':'prod','x-ghost-mode':'true',
    'x-request-id':randomUUID(),
    'user-agent':`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Sand/${version} Safari/537.36`
  };
  if(credentials.machineId)headers['x-cursor-checksum']=checksum(credentials.machineId);
  if(credentials.teamId!==undefined)headers['x-cursor-team-id']=String(credentials.teamId);
  return headers;
}

function agentIdList(value){
  const raw=Array.isArray(value)?value:(value?.agentIds??value?.agent_ids??[]);
  if(!Array.isArray(raw))return [];
  const ids=[];
  for(const id of raw){
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||ids.includes(id))continue;
    ids.push(id);
    if(ids.length===200)break;
  }
  return ids;
}

export function sidebarFromSettings(settings){
  const source=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:{};
  const raw=source.mainAgentId??source.main_agent_id;
  const pins=source.pinnedAgents??source.pinned_agents??source.pinnedAgentIds??source.pinned_agent_ids;
  const block=source.sidebarSections??source.sidebar_sections;
  const rows=Array.isArray(block)?block:(block?.sections??[]);
  const sections=[],seen=new Set();
  for(const section of Array.isArray(rows)?rows:[]){
    if(!section||typeof section!=='object'||Array.isArray(section))continue;
    const id=section.id;
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||seen.has(id))continue;
    seen.add(id);
    const name=typeof section.name==='string'?section.name:'';
    sections.push({id,name:name.slice(0,80),agentIds:agentIdList(section.agentIds??section.agent_ids),collapsed:section.isCollapsed===true||section.is_collapsed===true});
    if(sections.length===40)break;
  }
  return {mainAgentId:typeof raw==='string'&&raw.length?raw:null,pinnedAgentIds:agentIdList(pins),sections};
}

export async function readSidebarSettings(credentials,fetchImpl=fetch){
  const response=await fetchImpl(API,{method:'POST',headers:headersFor(credentials),body:'{}',redirect:'error',signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(new Error('RPC_FAILED'),{httpStatus:response.status});
  const settings=data.settings&&typeof data.settings==='object'&&!Array.isArray(data.settings)?data.settings:{};
  return sidebarFromSettings(settings);
}
