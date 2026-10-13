'use client';
import {useState,type InputHTMLAttributes} from 'react';
export function majorToMinor(text:string,digits:number){if(!new RegExp('^-?\\d+(?:\\.\\d{0,'+digits+'})?$').test(text)||digits===0&&text.includes('.'))return null;const negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/,'').split('.');return ((negative?-1n:1n)*(BigInt(whole)*10n**BigInt(digits)+BigInt(fraction.padEnd(digits,'0')||'0'))).toString();}
export function minorToMajor(value:unknown,digits:number){if(value===null||value===undefined||value==='')return '';const number=BigInt(String(value)),absolute=number<0n?-number:number,base=10n**BigInt(digits);return `${number<0n?'-':''}${absolute/base}${digits?'.'+String(absolute%base).padStart(digits,'0'):''}`;}
export default function MoneyInput({value,onValue,currency,minorDigits,allowNegative=false,...props}:{value:unknown;onValue:(v:string)=>void;currency:string;minorDigits?:number;allowNegative?:boolean}&Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'>){
 let digits=2;try{digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;}catch{}
 if(Number.isInteger(minorDigits)&&minorDigits!>=0&&minorDigits!<=6)digits=minorDigits!;
 const [draft,setDraft]=useState({text:minorToMajor(value,digits),minor:String(value??''),digits});
 const shown=draft.minor===String(value??'')&&draft.digits===digits?draft.text:minorToMajor(value,digits);
 return <input {...props} inputMode="decimal" pattern={(allowNegative?'-?':'')+'[0-9]+'+(digits?'(\\.[0-9]{0,'+digits+'})?':'')} placeholder={digits?'0.'+'0'.repeat(digits):'0'} value={shown} onChange={e=>{const next=e.target.value;if(!new RegExp('^'+(allowNegative?'-?':'')+'\\d*(?:\\.\\d{0,'+digits+'})?$').test(next)||digits===0&&next.includes('.'))return;const minor=majorToMinor(next,digits)??'';setDraft({text:next,minor,digits});onValue(minor);}}/>;
}
