export function signatureArtwork(text:string,style:string){
 const escaped=text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
 const font=style==='clean'?'sans-serif':style==='serif'?'serif':'cursive';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="150" viewBox="0 0 700 150"><text x="24" y="98" fill="#173c4a" font-size="${Math.max(10,Math.min(54,640/(Array.from(text).length||1)))}" font-family="${font}"${style==='script'?' font-style="italic"':''}>${escaped}</text><path d="M24 118 Q210 106 370 118" stroke="#327e80" fill="none" stroke-width="1.5"/></svg>`;
}
