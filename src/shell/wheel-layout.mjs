export const WHEEL_SLOTS={inner:6,outer:7};
const validId=value=>typeof value==='string'&&value.length<=128&&!/[\u0000-\u001f]/.test(value);
export function normalizeWheelLayout(value,bots=[]){
 const ids=bots.map(bot=>bot?.id).filter(id=>validId(id)&&id);
 const initial={inner:ids.slice(0,6),outer:ids.slice(6,13)};
 const result={};
 for(const [ring,count] of Object.entries(WHEEL_SLOTS)){
  const input=Array.isArray(value?.[ring])?value[ring]:initial[ring];
  result[ring]=Array.from({length:count},(_,index)=>validId(input[index])?input[index]:'');
 }
 return result;
}
export function changeWheelSlot(layout,ring,index,botId,bots=[]){
 if(!Object.hasOwn(WHEEL_SLOTS,ring)||!Number.isInteger(index)||index<0||index>=WHEEL_SLOTS[ring]||!validId(botId))throw new Error('WHEEL_SLOT_INVALID');
 if(botId&&!bots.some(bot=>bot.id===botId))throw new Error('BOT_NOT_FOUND');
 const result=normalizeWheelLayout(layout,bots);result[ring][index]=botId;return result;
}
