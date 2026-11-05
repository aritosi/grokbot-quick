import {deflateSync} from 'node:zlib';

const CRC=(()=>{
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;
    table[n]=c>>>0;
  }
  return table;
})();
function crc32(buf){
  let c=0xffffffff;
  for(const byte of buf)c=CRC[(c^byte)&0xff]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function chunk(type,data){
  const name=Buffer.from(type);
  const body=Buffer.concat([name,data]);
  const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length,body,crc]);
}
// Geometry is the idle Bloub from assets/bloub/idle.svg: a perfect circle of radius 100 with two
// slanted pill-shaped holes. Units below are that SVG's user units.
export const COAL_BODY_RADIUS=100;
export const COAL_EYES=[
  {matrix:[0.87,-0.33,0.45,0.84,21.42,-43.32]},
  {matrix:[0.64,-0.06,0.45,0.84,62.98,-53.9]}
];
const EYE_HALF_WIDTH=9.3,EYE_HALF_STRAIGHT=11.3;
function invert([a,b,c,d,e,f]){
  const det=a*d-b*c;
  return {a:d/det,b:-b/det,c:-c/det,d:a/det,e:(c*f-d*e)/det,f:(b*e-a*f)/det};
}
const INVERSE=COAL_EYES.map(eye=>invert(eye.matrix));
export function inCoalEye(ux,uy){
  for(const m of INVERSE){
    const lx=m.a*ux+m.c*uy+m.e,ly=m.b*ux+m.d*uy+m.f;
    const dy=Math.max(Math.abs(ly)-EYE_HALF_STRAIGHT,0);
    if(Math.hypot(lx,dy)<=EYE_HALF_WIDTH)return true;
  }
  return false;
}
// Ball radius in pixels for a square canvas; the Windows rim needs room outside the ball.
export function coalBallGeometry(size,{rim=0,inset=0}={}){
  const radius=size/2-inset-rim-0.5;
  return {cx:size/2,cy:size/2,radius,scale:radius/COAL_BODY_RADIUS,rim};
}
// Continuous sample in pixel space: 'eye' | 'body' | 'rim' | 'out'.
export function coalBallSample(size,px,py,{rim=0,inset=0}={}){
  const {cx,cy,radius,scale}=coalBallGeometry(size,{rim,inset});
  const dx=px-cx,dy=py-cy,dist=Math.hypot(dx,dy);
  if(dist<=radius)return inCoalEye(dx/scale,dy/scale)?'eye':'body';
  return rim>0&&dist<=radius+rim?'rim':'out';
}
const SUPER=4;
function paintBall(size,{body,eye,rimColor=null,rim=0,inset=0}){
  const rgba=Buffer.alloc(size*size*4);
  const palette={body,eye,rim:rimColor};
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      let r=0,g=0,b=0,a=0;
      for(let sy=0;sy<SUPER;sy++)for(let sx=0;sx<SUPER;sx++){
        const kind=coalBallSample(size,x+(sx+0.5)/SUPER,y+(sy+0.5)/SUPER,{rim,inset});
        const color=palette[kind];
        if(!color)continue;
        const alpha=color[3]/255;
        r+=color[0]*alpha;g+=color[1]*alpha;b+=color[2]*alpha;a+=alpha;
      }
      const i=(y*size+x)*4,total=SUPER*SUPER;
      if(a>0){
        rgba[i]=Math.round(r/a);rgba[i+1]=Math.round(g/a);rgba[i+2]=Math.round(b/a);
      }
      rgba[i+3]=Math.round(a/total*255);
    }
  }
  return {width:size,height:size,rgba};
}
export const WINDOWS_BODY=[10,10,12,255],WINDOWS_EYE=[249,249,249,255],WINDOWS_RIM=[232,232,234,255];
export function coalBallRaster(size=32){
  return paintBall(size,{body:WINDOWS_BODY,eye:WINDOWS_EYE,rimColor:WINDOWS_RIM,rim:1});
}
export function coalBallTemplateRaster(size=18){
  return paintBall(size,{body:[0,0,0,255],eye:null});
}
function pngFromRaster(raster){
  const {width,height,rgba}=raster;
  const raw=Buffer.alloc(height*(1+width*4));
  for(let y=0;y<height;y++){
    const row=y*(1+width*4);
    raw[row]=0;
    rgba.copy(raw,row+1,y*width*4,(y+1)*width*4);
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=6;
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function coalBallPng(size=32){
  return pngFromRaster(coalBallRaster(size));
}
export function coalBallTemplatePng(size=18){
  return pngFromRaster(coalBallTemplateRaster(size));
}
// Application icon: a black coal ball on a transparent canvas. On macOS the
// content stays inside the 824px safe area of the 1024px grid (100px margin),
// so Dock icons do not appear a size larger than their neighbours. Windows
// needs only a small transparent edge for the taskbar/Explorer tile.
export const APP_ICON_BODY=[18,18,21,255],APP_ICON_EYE=[249,249,249,255],APP_ICON_RIM=[235,235,240,255];
export function appIconInset(size,platform=process.platform){
  return platform==='darwin'?size*100/1024:size*0.06;
}
export function coalBallAppRaster(size=1024,{platform=process.platform}={}){
  return paintBall(size,{body:APP_ICON_BODY,eye:APP_ICON_EYE,rimColor:APP_ICON_RIM,rim:Math.max(1,Math.round(size/600)),inset:appIconInset(size,platform)});
}
export function coalBallAppPng(size=1024,options={}){
  return pngFromRaster(coalBallAppRaster(size,options));
}
export function trayIconImages(platform){
  const specs=platform==='darwin'
    ?[{size:18,scale:1,template:true},{size:36,scale:2,template:true}]
    :[{size:16,scale:1,template:false},{size:32,scale:2,template:false}];
  return specs.map(spec=>({...spec,source:'coal-ball',png:spec.template?coalBallTemplatePng(spec.size):coalBallPng(spec.size)}));
}
export function coalBallIcon(size=32){
  const png=coalBallPng(size);
  return {source:'coal-ball',png,width:size,height:size};
}
