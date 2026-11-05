import {join} from 'node:path';

export function menuHostTemplate({packaged,resourcesPath,devRoot}){
  return join(packaged?resourcesPath:devRoot,'native/GrokBotMenuHost.app');
}

export function sharingApplicationPath({packaged,appPath,execPath}){
  const marker=packaged?'/Contents/Resources/':'/Contents/MacOS/';
  const source=packaged?appPath:execPath;
  const index=source.indexOf(marker);
  return index>=0?source.slice(0,index):source;
}
