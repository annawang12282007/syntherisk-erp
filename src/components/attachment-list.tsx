'use client';
import {useState} from 'react';
import {Download,FileCheck2,Paperclip} from 'lucide-react';
import {useApp} from './context';
import {ApiError,errorMessage} from './api';
import {Button,Modal} from './primitives';
import {useCompanyWords} from './company-information';
import ImageSizeControl from './image-size-control';
import type {Row} from './types';
import styles from './attachment-list.module.css';

export default function AttachmentList({files}:{files:Row[]}){
 const {t,notify}=useApp();const [pending,setPending]=useState<string|null>(null);
 const L=useCompanyWords(),[image,setImage]=useState<Row|null>(null),[width,setWidth]=useState(600);
 async function checksum(id:string){
  setPending(id);
  try{
   let response:Response;try{response=await fetch(`/api/attachments?id=${encodeURIComponent(id)}&format=checksum`,{credentials:'same-origin'});}catch{throw new ApiError(0,'networkError','Network unavailable');}
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(response.status,body.error?.code||'error',body.error?.message||response.statusText);}
   const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
   const encoded=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
   link.href=url;link.download=encoded?decodeURIComponent(encoded):`${id}.checksum.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){notify(errorMessage(error,t),'error');}finally{setPending(null);}
 }
 return <div className={styles.list}>{files.map(file=><div key={file.id} className={styles.file}><a href={`/api/attachments?id=${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer"><Paperclip size={18}/><span>{String(file.filename||file.original_name||file.name||file.id)}</span><Download size={16}/></a>{['image/png','image/jpeg','image/webp'].includes(String(file.mime_type))&&<Button onClick={()=>{setImage(file);setWidth(600);}}>{L('圖片尺寸','Image size')}</Button>}<Button icon={FileCheck2} disabled={pending!==null} title={t('attachmentChecksumHint')} onClick={()=>void checksum(file.id)}>{pending===file.id?t('loading'):t('attachmentChecksumDownload')}</Button></div>)}{image&&<Modal wide title={String(image.filename)} onClose={()=>setImage(null)} footer={<a className="btn primary" href={`/api/attachments?id=${encodeURIComponent(image.id)}&format=image-download&width=${width}`}>{L('下載調整尺寸副本','Download resized copy')}</a>}><p>{L('按比例調整尺寸，原始附件與簽署留檔不變。','Resize proportionally. The original attachment and signed receipts are preserved.')}</p><ImageSizeControl value={width} onChange={setWidth} min={16} max={2048}/><img src={`/api/attachments?id=${encodeURIComponent(image.id)}&format=image&width=2048`} alt={String(image.filename)} style={{width,maxWidth:'100%',height:'auto'}}/></Modal>}</div>;
}
