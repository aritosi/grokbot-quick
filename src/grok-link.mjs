export const GROK_BOT_AGENT_LINK='grokbot://app/v1/agent?id=';

export function grokBotAgentUrl(id){
  if(typeof id!=='string'||!/^[\w-]{1,80}$/.test(id))throw new Error('BOT_NOT_FOUND');
  return GROK_BOT_AGENT_LINK+id;
}
