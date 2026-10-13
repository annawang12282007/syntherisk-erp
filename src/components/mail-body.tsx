'use client';
import {plainMailHtml,safeMailHtml} from '@/lib/mail-content';
export default function MailBody({html,text}:{html?:unknown;text?:unknown}){return <div className={'mail-content '+(html?'':'mail-content-plain')} dangerouslySetInnerHTML={{__html:html?safeMailHtml(String(html)):plainMailHtml(String(text||''))}}/>;}
