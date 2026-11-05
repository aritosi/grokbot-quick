import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmod,cp,lstat,mkdir,readFile,readlink,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve,sep,win32,posix} from 'node:path';
import {promisify} from 'node:util';

const runFile=(file,args,options={})=>promisify(execFile)(file,args,{windowsHide:true,...options});
export const MANAGED='.grokbot-quick-managed.json';
export const PATH_BEGIN='# grokbot-quick';
export const PATH_END='# grokbot-quick end';
const MARKER='grokbot-quick';

export function globalSkillsDir(home,exists=existsSync){
  const agents=join(home,'.agents','skills');
  if(exists(agents))return agents;
  return agents;
}
export function claudeSkillsDir(home){return join(home,'.claude','skills');}
export function commandPathFor(home,platform){return join(home,'.local','bin',platform==='win32'?'grok-bot.cmd':'grok-bot');}
export function binDirFor(home){return join(home,'.local','bin');}
export function skillBundleDir({packaged,resourcesPath,devRoot}){
  return join(packaged?resourcesPath:devRoot,packaged?'grok-bot-skill/grok-bot':'resources/grok-bot-skill/grok-bot');
}

export function quoteSh(value){return `'${String(value).replaceAll("'","'\\''")}'`;}
// The delimiter belongs to the target platform, not to the host that runs the
// install: a darwin install assembled on a Windows worker still separates with ':'.
export function pathHasDir(pathEnv,dir,platform=process.platform){return String(pathEnv??'').split(platform==='win32'?';':':').some(item=>item===dir);}
export function pathSnippet(dir){return `${PATH_BEGIN}\nexport PATH="${dir}:$PATH"\n${PATH_END}\n`;}
export function withoutPathSnippet(text){
  const start=text.indexOf(PATH_BEGIN),end=text.indexOf(PATH_END);
  if(start<0||end<start)return text;
  const tail=text.slice(end+PATH_END.length).replace(/^\n/,'');
  return `${text.slice(0,start)}${tail}`.replace(/\n{3,}/g,'\n\n');
}
export function rcFile(home,platform){return platform==='darwin'?join(home,'.zprofile'):platform==='linux'?join(home,'.profile'):'';}

export function canonicalPath(value,platform=process.platform){
  let text=String(value??'').trim();
  if(text.startsWith('\\\\?\\UNC\\'))text=`\\\\${text.slice(8)}`;
  else if(text.startsWith('\\\\?\\'))text=text.slice(4);
  const win=platform==='win32';
  if(win)text=text.replaceAll('/','\\');
  text=text.replace(/[\\/]+$/g,'');
  return win?text.toLowerCase():text;
}
export function samePath(left,right,platform=process.platform){
  return canonicalPath(left,platform)===canonicalPath(right,platform);
}
function pathLib(platform){return platform==='win32'?win32:posix;}
function resolveLink(target,base,platform){
  const lib=pathLib(platform);
  let text=String(target??'');
  if(text.startsWith('\\\\?\\UNC\\'))text=`\\\\${text.slice(8)}`;
  else if(text.startsWith('\\\\?\\'))text=text.slice(4);
  if(!lib.isAbsolute(text))text=lib.resolve(base,text);
  return text;
}
function commandTargets(dest){
  return [join(dest,'scripts','grok-bot'),join(dest,'scripts','grok-bot.cmd')];
}

export function profileDocument(credentials){
  if(typeof credentials?.accessToken!=='string'||!credentials.accessToken)return null;
  const team=Number.isInteger(credentials.teamId)?credentials.teamId:Number.isInteger(credentials.selectedTeamId)?credentials.selectedTeamId:undefined;
  return {accessToken:credentials.accessToken,...team!==undefined?{selectedTeamId:team}:{}};
}
export function registryDocument(now){
  return {version:1,default:'default',accounts:[{alias:'default',label:'',addedAt:now,lastUsedAt:now}]};
}

export function posixLauncher({runtime,script,configDir}){
  return `#!/bin/sh
# ${MARKER}
set -u
runtime=${quoteSh(runtime)}
script=${quoteSh(script)}
config=${quoteSh(configDir)}
want_json=0
for arg in "$@"; do
  if [ "$arg" = "--json" ]; then want_json=1; fi
done
fail() {
  printf '%s\\n' "$1" >&2
  if [ "$want_json" -eq 1 ]; then
    printf '%s\\n' '{"ok":false,"error":{"code":"CLI_RUNTIME_MISSING","message":"GrokBot Quick is not available."}}'
  fi
  exit 3
}
[ -x "$runtime" ] || fail "CLI_RUNTIME_MISSING: GrokBot Quick is not available."
[ -f "$script" ] || fail "CLI_RUNTIME_MISSING: The grok-bot command is not installed."
export ELECTRON_RUN_AS_NODE=1
export GROK_BOT_CONFIG_DIR="$config"
export GROK_BOT_NO_AUTO_INSTALL=1
exec "$runtime" "$script" "$@"
`;
}
function batchText(value){return String(value??'').replaceAll('"','').replaceAll('%','%%');}
export function quoteCmd(value){return `"${batchText(value)}"`;}
function setCmd(name,value){return `set "${name}=${batchText(value)}"`;}
export function windowsCommand({runtime,script,configDir}){
  const runtimeQuoted=quoteCmd(runtime);
  const lines=[
    '@echo off',
    `rem ${MARKER}`,
    'setlocal DisableDelayedExpansion',
    `for /f "tokens=2 delims=:." %%a in ('chcp') do set "_cp=%%a"`,
    'chcp 65001 >nul',
    setCmd('ELECTRON_RUN_AS_NODE','1'),
    setCmd('GROK_BOT_CONFIG_DIR',configDir),
    setCmd('GROK_BOT_NO_AUTO_INSTALL','1'),
    `if not exist ${runtimeQuoted} ( echo CLI_RUNTIME_MISSING: GrokBot Quick is not available. 1>&2 & echo {"ok":false,"error":{"code":"CLI_RUNTIME_MISSING","message":"GrokBot Quick is not available."}} & chcp %_cp% >nul & exit /b 127 )`,
    `${runtimeQuoted} ${quoteCmd(script)} %*`,
    'set "GROK_BOT_EXIT=%ERRORLEVEL%"',
    'chcp %_cp% >nul',
    'exit /b %GROK_BOT_EXIT%'
  ];
  return `${lines.join('\r\n')}\r\n`;
}
export function windowsPowerShell(){
  return '\uFEFF& "$PSScriptRoot\\grok-bot.cmd" @args; exit $LASTEXITCODE\r\n';
}
export function parseRegPath(stdout){
  const line=String(stdout??'').split(/\r?\n/).find(item=>/^\s*Path\s+REG_/i.test(item));
  if(!line)return null;
  const match=line.match(/^\s*Path\s+(REG_\w+)\s+(.*)$/i);
  if(!match)return null;
  return {type:match[1].toUpperCase(),value:match[2].replace(/\s+$/,'')};
}
export function windowsPathHasDir(value,dir,home=''){
  return String(value??'').split(';').some(item=>item&&segmentMatches(item,dir,home));
}
function segmentMatches(segment,dir,home){
  if(samePath(segment,dir,'win32'))return true;
  if(!home)return false;
  const suffix=canonicalPath(dir,'win32');
  const root=canonicalPath(home,'win32');
  if(suffix!==root&&!suffix.startsWith(`${root}\\`))return false;
  const rest=suffix.slice(root.length);
  return canonicalPath(segment,'win32')===canonicalPath(`%USERPROFILE%${rest}`,'win32');
}
export function windowsPathAppend(value,dir){
  const current=String(value??'');
  if(windowsPathHasDir(current,dir))return current;
  if(!current)return dir;
  return current.endsWith(';')?`${current}${dir}`:`${current};${dir}`;
}
export function windowsPathRemove(value,dir){
  const want=canonicalPath(dir,'win32');
  return String(value??'').split(';').filter(item=>item&&canonicalPath(item,'win32')!==want).join(';');
}

function assertInside(home,target){
  const root=resolve(home)+sep,full=resolve(target);
  if(full!==resolve(home)&&!full.startsWith(root))throw new Error('CLI_INSTALL_FAILED');
}
function emptyStatus(){return {enabled:false,command:'',skillsPath:'',claudeLinked:false,credential:false,pathSnippet:false,warning:'',error:''};}

async function commandKind(commandPath,dest,platform){
  let info;
  try{info=await lstat(commandPath);}catch(error){if(error?.code==='ENOENT')return 'missing';throw error;}
  if(info.isSymbolicLink()){
    const target=resolveLink(await readlink(commandPath),dirname(commandPath),platform);
    return commandTargets(dest).some(item=>samePath(target,item,platform))?'ours':'foreign';
  }
  const text=await readFile(commandPath,'utf8').catch(()=>'');
  return text.includes(MARKER)?'ours':'foreign';
}
async function skillSlot(slot,{ownTargets=[],platform=process.platform}={}){
  let info;
  try{info=await lstat(slot);}catch(error){if(error?.code==='ENOENT')return 'missing';throw error;}
  if(info.isSymbolicLink()){
    const target=resolveLink(await readlink(slot),dirname(slot),platform);
    return ownTargets.some(item=>item&&samePath(target,item,platform))?'link':'foreign';
  }
  try{
    const marker=JSON.parse(await readFile(join(slot,MANAGED),'utf8'));
    if(marker?.app===MARKER)return 'managed';
  }catch{/* An unrelated directory is not ours. */}
  return 'foreign';
}
async function replaceSlot(slot,kind){
  if(kind==='missing')return;
  if(kind==='link'){await rm(slot,{force:true});return;}
  await rm(slot,{recursive:true,force:true});
}

async function writeAtomic(file,contents,mode){
  const dir=dirname(file);
  await mkdir(dir,{recursive:true,mode:0o700});
  const tmp=join(dir,`.${randomBytes(8).toString('hex')}.tmp`);
  try{
    await writeFile(tmp,contents,{mode});
    try{await chmod(tmp,mode);}catch{/* Windows ACLs are best-effort. */}
    await rename(tmp,file);
    try{await chmod(file,mode);}catch{/* Windows ACLs are best-effort. */}
  }catch(error){
    await rm(tmp,{force:true});
    throw error;
  }
}
export async function writeCliCredential(configDir,credentials,now=new Date().toISOString()){
  const profile=join(configDir,'profiles','default.json');
  const doc=profileDocument(credentials);
  if(!doc){await rm(profile,{force:true});return false;}
  await writeAtomic(profile,`${JSON.stringify(doc)}\n`,0o600);
  await writeAtomic(join(configDir,'accounts.json'),`${JSON.stringify(registryDocument(now))}\n`,0o600);
  return true;
}

async function ensureUserPath({home,platform,pathEnv,binDir}){
  const file=rcFile(home,platform);
  if(!file||pathHasDir(pathEnv,binDir,platform))return false;
  let text='';
  try{text=await readFile(file,'utf8');}catch(error){if(error?.code!=='ENOENT')throw error;}
  if(text.includes(PATH_BEGIN))return false;
  const next=`${text.length===0||text.endsWith('\n')?text:`${text}\n`}${pathSnippet(binDir)}`;
  await writeFile(file,next);
  return true;
}
async function removeUserPath({home,platform}){
  const file=rcFile(home,platform);
  if(!file)return;
  let text;
  try{text=await readFile(file,'utf8');}catch{return;}
  if(!text.includes(PATH_BEGIN))return;
  await writeFile(file,withoutPathSnippet(text));
}
// The Path value is UTF-8 from PowerShell and travels in the environment, not on the command line.
export const WINDOWS_PATH_ENV='GROK_BOT_WINDOWS_PATH';
export const WINDOWS_PATH_MISSING='__MISSING__';
export const WINDOWS_PATH_READ=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
if($null -eq $key){[Console]::Out.WriteLine('${WINDOWS_PATH_MISSING}');exit 0}
$found=$false
foreach($name in @($key.GetValueNames())){if($name -eq 'Path'){$found=$true}}
if(-not $found){[Console]::Out.WriteLine('${WINDOWS_PATH_MISSING}');exit 0}
$kind=$key.GetValueKind('Path')
$value=$key.GetValue('Path',$null,'DoNotExpandEnvironmentNames')
if($null -eq $value){[Console]::Out.WriteLine('${WINDOWS_PATH_MISSING}');exit 0}
[Console]::Out.WriteLine($kind.ToString())
[Console]::Out.WriteLine([string]$value)
`;
export const WINDOWS_PATH_WRITE=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
if(-not (Test-Path 'Env:${WINDOWS_PATH_ENV}')){exit 1}
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true)
if($null -eq $key){exit 1}
$key.SetValue('Path',[string]$env:${WINDOWS_PATH_ENV},'ExpandString')
`;
export const WINDOWS_ENV_BROADCAST=`$sig='[DllImport("user32.dll",CharSet=CharSet.Auto,SetLastError=true)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd,uint Msg,System.UIntPtr wParam,string lParam,uint fuFlags,uint uTimeout,out System.UIntPtr lpdwResult);'; Add-Type -Namespace Gba -Name Env -MemberDefinition $sig; $result=[System.UIntPtr]::Zero; [void][Gba.Env]::SendMessageTimeout([System.IntPtr]0xffff,0x1A,[System.UIntPtr]::Zero,'Environment',2,2000,[ref]$result)`;
function commandText(result){return typeof result==='string'?result:result?.stdout??'';}
function powershellArgs(script){return ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script];}
export function parseWindowsPathOutput(stdout){
  const lines=String(stdout??'').replace(/^\uFEFF/,'').split(/\r?\n/);
  if(lines.length&&lines.at(-1)==='')lines.pop();
  if(lines.length===1&&lines[0].trim()===WINDOWS_PATH_MISSING)return {type:'ExpandString',value:''};
  const kind=lines[0]?.trim()??'';
  if(lines.length<2||(kind!=='String'&&kind!=='ExpandString'))throw new Error('CLI_INSTALL_FAILED');
  return {type:kind,value:lines.slice(1).join('\n')};
}
async function readWindowsPath(execFileImpl){
  let result;
  try{result=await execFileImpl('powershell.exe',powershellArgs(WINDOWS_PATH_READ),{windowsHide:true,encoding:'utf8'});}
  catch{throw new Error('CLI_INSTALL_FAILED');}
  return parseWindowsPathOutput(commandText(result));
}
async function writeWindowsPath(value,execFileImpl){
  const env={...process.env,[WINDOWS_PATH_ENV]:String(value??'')};
  try{await execFileImpl('powershell.exe',powershellArgs(WINDOWS_PATH_WRITE),{windowsHide:true,encoding:'utf8',env});}
  catch{throw new Error('CLI_INSTALL_FAILED');}
}
async function broadcastEnvironment(execFileImpl){
  try{
    await execFileImpl('powershell.exe',powershellArgs(WINDOWS_ENV_BROADCAST),{windowsHide:true,encoding:'utf8',timeout:8000});
    return '';
  }catch{
    return 'ENV_BROADCAST_FAILED';
  }
}
async function ensureWindowsPath(dir,home,execFileImpl){
  const current=await readWindowsPath(execFileImpl);
  if(windowsPathHasDir(current.value,dir,home))return {added:false,warning:''};
  await writeWindowsPath(windowsPathAppend(current.value,dir),execFileImpl);
  return {added:true,warning:await broadcastEnvironment(execFileImpl)};
}
async function removeWindowsPath(dir,execFileImpl){
  const current=await readWindowsPath(execFileImpl);
  if(!windowsPathHasDir(current.value,dir))return;
  await writeWindowsPath(windowsPathRemove(current.value,dir),execFileImpl);
  await broadcastEnvironment(execFileImpl);
}

export async function enableCli({home=homedir(),platform=process.platform,pathEnv=process.env.PATH??'',bundleDir,configDir,runtime,credentials=null,now=new Date().toISOString(),execFileImpl=runFile,symlinkImpl=symlink,savedPathSnippet=false}={}){
  if(!bundleDir||!existsSync(join(bundleDir,'SKILL.md'))||!existsSync(join(bundleDir,'bin','grok-bot.mjs')))throw new Error('CLI_BUNDLE_MISSING');
  if(!runtime||!existsSync(runtime))throw new Error('CLI_RUNTIME_MISSING');
  const skillsDir=globalSkillsDir(home),dest=join(skillsDir,'grok-bot'),claude=join(claudeSkillsDir(home),'grok-bot');
  const script=join(dest,'scripts','grok-bot'),ps1=join(dest,'scripts','grok-bot.ps1'),commandPath=commandPathFor(home,platform),binDir=binDirFor(home);
  assertInside(home,dest);assertInside(home,claude);assertInside(home,commandPath);assertInside(home,configDir);
  const destKind=await skillSlot(dest,{ownTargets:[bundleDir],platform});
  if(destKind==='foreign')throw new Error('CLI_COMMAND_EXISTS');
  const claudeKind=await skillSlot(claude,{ownTargets:[dest,bundleDir],platform});
  if(claudeKind==='foreign')throw new Error('CLI_COMMAND_EXISTS');
  if(await commandKind(commandPath,dest,platform)==='foreign')throw new Error('CLI_COMMAND_EXISTS');
  await mkdir(skillsDir,{recursive:true});
  await replaceSlot(dest,destKind);
  await cp(bundleDir,dest,{recursive:true});
  await mkdir(join(dest,'scripts'),{recursive:true});
  const bundledScript=join(dest,'bin','grok-bot.mjs');
  await writeFile(script,posixLauncher({runtime,script:bundledScript,configDir}),{mode:0o755});
  try{await chmod(script,0o755);}catch{/* Windows ACLs are best-effort. */}
  const commandBody=windowsCommand({runtime,script:bundledScript,configDir});
  await writeFile(join(dest,'scripts','grok-bot.cmd'),commandBody);
  await writeFile(ps1,windowsPowerShell());
  await writeFile(join(dest,MANAGED),`${JSON.stringify({app:MARKER,version:1})}\n`);
  await mkdir(claudeSkillsDir(home),{recursive:true});
  await replaceSlot(claude,claudeKind);
  if(platform==='win32')await symlinkImpl(dest,claude,'junction');
  else await symlinkImpl(dest,claude);
  await mkdir(binDir,{recursive:true});
  await rm(commandPath,{force:true});
  if(platform==='win32')await writeFile(commandPath,commandBody);
  else await symlink(script,commandPath);
  let pathSnippetAdded=false,pathWarning='';
  if(platform==='win32'){const pathResult=await ensureWindowsPath(binDir,home,execFileImpl);pathSnippetAdded=pathResult.added;pathWarning=pathResult.warning;}
  else pathSnippetAdded=await ensureUserPath({home,platform,pathEnv,binDir});
  const credential=await writeCliCredential(configDir,credentials,now);
  return {enabled:true,command:commandPath,skillsPath:dest,claudeLinked:true,credential,pathSnippet:!!(pathSnippetAdded||savedPathSnippet),warning:pathWarning,error:''};
}

export async function disableCli({home=homedir(),platform=process.platform,configDir,removePath=false,execFileImpl=runFile}={}){
  if(configDir)await writeCliCredential(configDir,null);
  const dest=join(globalSkillsDir(home),'grok-bot'),claude=join(claudeSkillsDir(home),'grok-bot'),commandPath=commandPathFor(home,platform);
  const destKind=await skillSlot(dest,{ownTargets:[],platform});
  if(destKind!=='foreign'&&await commandKind(commandPath,dest,platform)==='ours')await rm(commandPath,{force:true});
  if(destKind==='managed'||destKind==='link'||destKind==='missing'){
    try{
      const target=resolveLink(await readlink(claude),dirname(claude),platform);
      if(samePath(target,dest,platform))await rm(claude,{force:true});
    }catch{/* A real directory is left in place. */}
  }
  if(destKind==='link')await rm(dest,{force:true});
  else if(destKind==='managed'){
    try{
      const marker=JSON.parse(await readFile(join(dest,MANAGED),'utf8'));
      if(marker?.app===MARKER)await rm(dest,{recursive:true,force:true});
    }catch{/* An unrelated skill directory is left in place. */}
  }
  if(removePath){
    if(platform==='win32')await removeWindowsPath(binDirFor(home),execFileImpl).catch(()=>{});
    else await removeUserPath({home,platform});
  }
  return emptyStatus();
}
