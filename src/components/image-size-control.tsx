'use client';
import {useCompanyWords} from './company-information';
export default function ImageSizeControl({value,onChange,min=60,max=700,disabled=false}:{value:number;onChange:(width:number)=>void;min?:number;max?:number;disabled?:boolean}){
 const L=useCompanyWords();
 return <label className="field">{L('圖片寬度（px，高度等比例調整）','Image width (px, height scales proportionally)')}
 <div className="action-wrap"><input aria-label={L('圖片寬度','Image width')} type="range" min={min} max={max} value={value} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/><input aria-label={L('圖片寬度數值','Image width value')} type="number" min={min} max={max} value={value} disabled={disabled} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=min&&n<=max)onChange(n);}} style={{width:100}}/></div></label>;
}
