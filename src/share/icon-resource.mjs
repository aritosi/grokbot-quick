import {createHash} from 'node:crypto';
export function iconResourceName(bytes){return `BotAvatar-${createHash('sha256').update(bytes).digest('hex').slice(0,20)}.icns`;}
