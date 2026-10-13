'use client';
import {useSearchParams,useRouter} from 'next/navigation';
import MailHub from './mail-hub';
import {ResourceView} from './resource-view';
import {useCompanyWords} from './company-information';
export default function MailRecords({filters}:{filters:Record<string,string>}){
 const params=useSearchParams(),router=useRouter(),L=useCompanyWords(),manual=params.get('records')==='manual'||!!params.get('record')||params.get('new')==='1';
 return <section><div className="notice-tabs"><button aria-pressed={!manual} className={!manual?'active':''} onClick={()=>router.push('/data/campaigns')}>{L('Gmail 已寄出','Gmail sent')}</button><button aria-pressed={manual} className={manual?'active':''} onClick={()=>router.push('/data/campaigns?records=manual')}>{L('ERP 郵件活動','ERP mail activities')}</button></div>{manual?<ResourceView resourceKey="campaigns" initialFilters={filters}/>:<MailHub sent/>}</section>;
}
