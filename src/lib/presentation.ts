/** Formatting only: amounts remain integer minor units in storage and APIs. */
export function moneyLabel(label:string){return label.replace(/（[^）]*單位）|（[^）]*单位）| \(minor units\)/g,'');}
export function decodeMailSnippet(value:unknown){
 const entities:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
 return String(value??'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,code:string)=>{if(code[0]!=='#')return entities[code.toLowerCase()]??whole;const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));return Number.isSafeInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;});
}
export function mailDisplayDate(value:unknown,internalDate:unknown,locale:string,timezone:string){
 const parsed=new Date(String(value??'')),date=Number.isNaN(parsed.getTime())?new Date(Number(internalDate)):parsed;
 if(!value&&!internalDate||Number.isNaN(date.getTime()))return '—';
 try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(date);}catch{return '—';}
}
