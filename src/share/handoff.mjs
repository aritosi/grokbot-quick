export function shareHandoff({mode}){
  if(mode==='direct')return 'service';
  return 'composer';
}
