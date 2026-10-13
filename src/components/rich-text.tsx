'use client';
import './rich-text.css';
import {isRichText,richTextHtml} from '../lib/rich-text';
export default function RichText({value,className=''}:{value:unknown;className?:string}){return isRichText(value)?<span className={`rich-text ${className}`} dangerouslySetInnerHTML={{__html:richTextHtml(value)}}/>:<span className={`plain-text ${className}`}>{String(value??'')}</span>;}
