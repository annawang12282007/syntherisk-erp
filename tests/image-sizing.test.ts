import {it,expect} from 'vitest';
import sharp from 'sharp';
import {imageWidth,resizedImage} from '../src/lib/image-sizing';
it('keeps proportions and original bytes while producing the requested image width',async()=>{
 const source=await sharp({create:{width:800,height:400,channels:4,background:'#347777'}}).png().toBuffer(),original=Buffer.from(source);
 const output=await resizedImage(source,320),meta=await sharp(output).metadata();
 expect(meta).toMatchObject({width:320,height:160,format:'png'});expect(source.equals(original)).toBe(true);
});
it('rejects unreasonable dimensions, non-raster payloads and malformed images',async()=>{
 for(const value of ['NaN','80px',0,2049,1.5,-20])expect(()=>imageWidth(value)).toThrow();
 expect(imageWidth('280')).toBe(280);
 await expect(resizedImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'),100)).rejects.toMatchObject({code:'INVALID_IMAGE'});
 await expect(resizedImage(Buffer.from('broken'),100)).rejects.toMatchObject({code:'INVALID_IMAGE'});
});
