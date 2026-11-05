import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {slotIdentifier,slotExtensionPath,destinationPath} from './model.mjs';
export async function registerSlots(host,enabledSlots,run,sleep=delay,{isCurrent=()=>true,identifier=slotIdentifier,extension=slotExtensionPath,destination=destinationPath}={}){
 const checked=async(file,args)=>{if(!isCurrent())throw new Error('MENU_SUPERSEDED');return run(file,args);};
 for(let slot=1;slot<=12;slot++){
  if(destination)await checked('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',destination(host,slot)]);
  await checked('/usr/bin/pluginkit',['-a',extension(host,slot)]);
  await checked('/usr/bin/pluginkit',['-e',enabledSlots.includes(slot)?'use':'ignore','-i',identifier(slot)]);
 }
 let count=0;
 for(let pass=0;pass<3;pass++){
  count=0;
  for(const slot of enabledSlots){
   const id=identifier(slot),result=await checked('/usr/bin/pluginkit',['-m','-i',id]);
   if(result.stdout.split('\n').some(line=>line.startsWith('+')&&line.includes(id))){count++;continue;}
   await checked('/usr/bin/pluginkit',['-a',extension(host,slot)]);
   await checked('/usr/bin/pluginkit',['-e','use','-i',id]);
  }
  if(count===enabledSlots.length)return count;
  await sleep(250);
 }
 return count;
}
