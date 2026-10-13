'use client';
import RichTextEditor from './rich-text-editor';
import {formattedText,renderMail,type MailStyle} from '../lib/mail-format';
export function MailPreview({body,format='formatted',style={}}:{body:string;format?:string;style?:MailStyle}){return <div className="mail-preview" dangerouslySetInnerHTML={{__html:renderMail(body,format,style).html}}/>;}
export default function MailEditor({id,label,value,onChange,disabled=false,rows=8}:{id:string;label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;rows?:number}){
 return <div className="field mail-editor"><label htmlFor={id}>{label}</label><RichTextEditor id={id} aria-label={label} value={value} initialHtml={formattedText(value)} maxLength={50000} rows={rows} disabled={disabled} onChange={e=>onChange(e.target.value)}/></div>;
}
