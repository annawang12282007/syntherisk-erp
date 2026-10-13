import {z} from 'zod';
import {normalizeRichText,RICH_LIMIT} from './rich-text';
export function richString(max:number,min=0){return z.string().max(RICH_LIMIT).transform((value,ctx)=>{try{return normalizeRichText(value,max,min);}catch{ctx.addIssue({code:'custom',message:'INVALID_TEXT'});return z.NEVER;}});}
