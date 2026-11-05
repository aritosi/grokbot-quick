const ESCAPES={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>ESCAPES[ch]);
const safeHref=value=>{
  const raw=String(value??'').trim().replace(/^<|>$/g,'').replace(/&amp;/g,'&');
  if(raw.startsWith('#'))return raw;
  try{const url=new URL(raw);return ['http:','https:','mailto:'].includes(url.protocol)?url.href:null;}catch{return null;}
};
function inline(value){
  let text=escapeHtml(value);
  const codes=[];
  text=text.replace(/`([^`\n]+)`/g,(_match,code)=>{const token=`\u0000code${codes.length}\u0000`;codes.push(`<code>${escapeHtml(code)}</code>`);return token;});
  text=text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(match,label,url)=>{
    const href=safeHref(url);
    return href?`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`:label;
  });
  text=text.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g,'<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g,'<del>$1</del>')
    .replace(/(^|[^\*])\*([^*\n]+)\*/g,'$1<em>$2</em>')
    .replace(/\n/g,'<br>');
  for(let i=0;i<codes.length;i++)text=text.replace(`\u0000code${i}\u0000`,codes[i]);
  return text;
}
const FENCE=/^\s*```(.*)$/;
const LIST=/^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING=/^\s{0,3}(#{1,6})\s+(.*)$/;
const HR=/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const QUOTE=/^\s{0,3}>\s?(.*)$/;
function isBlockStart(line){return FENCE.test(line)||LIST.test(line)||HEADING.test(line)||HR.test(line)||QUOTE.test(line);}
function renderList(lines,start,ordered){
  const pattern=ordered?/^\s*\d+[.)]\s+(.*)$/:/^\s*[-*+]\s+(.*)$/;
  const items=[];let i=start;
  while(i<lines.length){
    const match=lines[i].match(pattern);
    if(!match)break;
    let text=match[1];
    i++;
    while(i<lines.length&&lines[i].trim()&&!LIST.test(lines[i])&&!FENCE.test(lines[i])&&!HEADING.test(lines[i])&&!QUOTE.test(lines[i])){text+=`\n${lines[i].trim()}`;i++;}
    items.push(`<li>${inline(text)}</li>`);
    while(i<lines.length&&!lines[i].trim())i++;
    if(i>=lines.length||!pattern.test(lines[i]))break;
  }
  return {html:`<${ordered?'ol':'ul'}>${items.join('')}</${ordered?'ol':'ul'}>`,next:i};
}
export function renderMarkdown(markdown=''){
  const lines=String(markdown??'').replace(/\r\n?/g,'\n').split('\n');
  const out=[];let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    const fence=line.match(FENCE);
    if(fence){
      const language=fence[1].trim().split(/\s+/)[0].replace(/[^a-z0-9_-]/gi,'');
      i++;const body=[];
      while(i<lines.length&&!/^\s*```/.test(lines[i]))body.push(lines[i++]);
      if(i<lines.length)i++;
      out.push(`<pre><code${language?` class="language-${language}"`:''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading=line.match(HEADING);
    if(heading){const level=heading[1].length;out.push(`<h${level}>${inline(heading[2])}</h${level}>`);i++;continue;}
    if(HR.test(line)){out.push('<hr>');i++;continue;}
    const quote=line.match(QUOTE);
    if(quote){
      const body=[quote[1]];i++;
      while(i<lines.length){const match=lines[i].match(QUOTE);if(!match)break;body.push(match[1]);i++;}
      out.push(`<blockquote>${inline(body.join('\n'))}</blockquote>`);continue;
    }
    const list=line.match(LIST);
    if(list){
      const rendered=renderList(lines,i,/\d/.test(list[2]));
      out.push(rendered.html);i=rendered.next;continue;
    }
    const paragraph=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!isBlockStart(lines[i]))paragraph.push(lines[i++]);
    out.push(`<p>${inline(paragraph.join('\n'))}</p>`);
  }
  return out.join('');
}
