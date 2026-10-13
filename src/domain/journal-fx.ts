import {DomainError} from '../lib/context';
import {decimal,exchange,minor} from './money';
export type JournalInputLine={account_id:string;description:string;debit_minor:string;credit_minor:string;project_id?:string};
export type JournalFx={currency:string;rate:string;rate_date:string;rate_source:string;from_digits:number;to_digits:number;lines:JournalInputLine[]};
export function validJournalRate(rate:string){return /^\d{1,12}(\.\d{1,12})?$/.test(rate)&&decimal(rate,12)>0n;}
/** Allocate each side's rounded cumulative total so balanced original sums remain balanced. */
export function convertJournalLines(lines:JournalInputLine[],rate:string,fromDigits=2,toDigits=2){
 if(!validJournalRate(rate))throw new DomainError(422,'journal_fx_rate');
 const sums={debit_minor:0n,credit_minor:0n},converted={debit_minor:0n,credit_minor:0n};
 return lines.map(line=>{
  const result={...line};
  for(const side of ['debit_minor','credit_minor'] as const){
   sums[side]+=minor(line[side]||'0');const next=exchange(sums[side].toString(),rate,fromDigits,toDigits),value=next-converted[side];
   minor(value.toString());result[side]=value.toString();converted[side]=next;
  }
  return result;
 });
}
export function journalTotals(lines:JournalInputLine[]){return lines.reduce((sum,line)=>({debit:sum.debit+minor(line.debit_minor||'0'),credit:sum.credit+minor(line.credit_minor||'0')}),{debit:0n,credit:0n});}
export function reverseJournalFx(fx:JournalFx):JournalFx{return {...fx,lines:fx.lines.map(line=>({...line,debit_minor:line.credit_minor,credit_minor:line.debit_minor}))};}
