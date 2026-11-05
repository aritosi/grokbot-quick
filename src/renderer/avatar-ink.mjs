// Eye/spot ink for the avatar body. Black palette bodies turn white in dark
// mode, so a fixed white spot would disappear; choose the higher-contrast ink.
export function eyeInk(value){
 const match=/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(value??'').trim());
 if(!match)return '#fff';
 let hex=match[1];
 if(hex.length===3)hex=hex.split('').map(char=>char+char).join('');
 const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
 const linear=channel=>{const part=channel/255;return part<=0.03928?part/12.92:((part+0.055)/1.055)**2.4;};
 const luminance=0.2126*linear(r)+0.7152*linear(g)+0.0722*linear(b);
 const whiteContrast=1.05/(luminance+0.05),blackContrast=(luminance+0.05)/0.05;
 return blackContrast>=whiteContrast?'#111':'#fff';
}
