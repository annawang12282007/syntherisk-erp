'use client';
import {useEffect,useState} from 'react';
import {Bell} from 'lucide-react';
import {post} from './api';
import {useApp} from './context';
import type {Row} from './types';
export default function NotificationBell(){const {t,navigate,refreshKey}=useApp();const [count,setCount]=useState(0);
 useEffect(()=>{let active=true;const refresh=()=>{if(document.visibilityState==='hidden')return;void post<Row[]>('/api/integrations',{action:'notifications'}).then(rows=>{if(active)setCount(rows.filter(row=>!row.read_at).length);}).catch(()=>{});};refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('syntherisk-notifications',refresh);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('syntherisk-notifications',refresh);};},[refreshKey]);
 return <button className="icon-button notification-trigger" style={{position:'relative'}} aria-label={`${t('notifications')}${count?` · ${count} ${t('unread')}`:''}`} onClick={()=>navigate('/notifications')}><Bell size={19}/>{count>0&&<span style={{position:'absolute',right:-5,top:-5,borderRadius:10,background:'var(--primary)',color:'#fff',fontSize:10,padding:'1px 4px'}}>{count>=100?'99+':count}</span>}</button>;
}
