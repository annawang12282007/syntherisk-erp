import sharp from 'sharp';
import {DomainError} from './context';
export function imageWidth(value:unknown,min=16,max=2048){
 if(typeof value!=='string'&&typeof value!=='number'||!/^\d+$/.test(String(value)))throw new DomainError(422,'INVALID_IMAGE_WIDTH');
 const width=Number(value);if(!Number.isInteger(width)||width<min||width>max)throw new DomainError(422,'INVALID_IMAGE_WIDTH');return width;
}
export async function resizedImage(bytes:Buffer,width:number){
 imageWidth(width);
 try{
  const image=sharp(bytes,{limitInputPixels:40000000,failOn:'warning',animated:false}),meta=await image.metadata();
  if(!['png','jpeg','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error('format');
  return await image.rotate().resize({width,height:4096,fit:'inside'}).png().toBuffer();
 }catch{throw new DomainError(422,'INVALID_IMAGE');}
}
