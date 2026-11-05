import {destinationIdentifier} from './model.mjs';
const escape=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function plist(value){
 const encode=v=>Array.isArray(v)?`<array>${v.map(encode).join('')}</array>`:v&&typeof v==='object'?`<dict>${Object.entries(v).map(([key,val])=>`<key>${escape(key)}</key>${encode(val)}`).join('')}</dict>`:typeof v==='boolean'?`<${v?'true':'false'}/>`:typeof v==='number'?`<integer>${v}</integer>`:`<string>${escape(v??'')}</string>`;
 return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">${encode(value)}</plist>`;
}
export const shareEntitlements={
 'com.apple.security.app-sandbox':true,
 'com.apple.security.temporary-exception.files.home-relative-path.read-write':['/Library/Application Support/GrokBot Quick/ShareInbox/']
};
export function destinationInfo(slot,name,applicationPath,iconFile,build){return {CFBundleInfoDictionaryVersion:'6.0',CFBundleName:name,CFBundleDisplayName:name,CFBundleIdentifier:destinationIdentifier(slot),CFBundleExecutable:'GrokBotMenuHost',CFBundlePackageType:'APPL',CFBundleShortVersionString:'0.2.0',CFBundleVersion:String(build),CFBundleIconFile:iconFile,LSUIElement:true,LSMinimumSystemVersion:'14.0',GBAApplicationPath:applicationPath};}
export function extensionInfo(slot,name='Grok Bot',iconFile='AppIcon.icns'){
 return {CFBundleInfoDictionaryVersion:'6.0',CFBundleDevelopmentRegion:'en',CFBundleDisplayName:name,CFBundleName:`GrokBotShare${slot}`,CFBundleExecutable:'GrokBotShare',CFBundleIdentifier:`dev.ronglecat.grokbotquick.menu.slot${String(slot).padStart(2,'0')}`,CFBundlePackageType:'XPC!',CFBundleShortVersionString:'0.2.0',CFBundleVersion:'2',CFBundleIconFile:iconFile,LSMinimumSystemVersion:'14.0',NSExtension:{NSExtensionPointIdentifier:'com.apple.share-services',NSExtensionPrincipalClass:'GrokBotShareViewController',NSExtensionAttributes:{NSExtensionActivationRule:{NSExtensionActivationDictionaryVersion:2,NSExtensionActivationSupportsFileWithMaxCount:100,NSExtensionActivationSupportsText:true,NSExtensionActivationSupportsImageWithMaxCount:100,NSExtensionActivationSupportsMovieWithMaxCount:100}}}};
}
