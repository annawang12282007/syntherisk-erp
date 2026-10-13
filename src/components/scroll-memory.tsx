'use client';
import {useEffect} from 'react';

/** Remember only positions, scoped to the signed-in member; never record page contents. */
export default function ScrollMemory({identity,route,revision}:{identity:string;route:string;revision:number}){
 useEffect(()=>{
  const key=`syntherisk.scroll.${identity}.${route}`,sideKey=`syntherisk.sidebar-scroll.${identity}`;
  const nav=document.querySelector<HTMLElement>('.sidebar nav');
  const read=(name:string)=>{try{return Math.max(0,Number(sessionStorage.getItem(name))||0);}catch{return 0;}};
  const write=(name:string,value:number)=>{try{sessionStorage.setItem(name,String(value));}catch{}};
  const target=read(key),sideTarget=read(sideKey);let restoring=true;
  const save=()=>{if(!restoring)write(key,window.scrollY);};
  const saveSide=()=>{if(!restoring&&nav)write(sideKey,nav.scrollTop);};
  const restore=()=>{window.scrollTo({top:target,behavior:'instant'});if(nav)nav.scrollTop=sideTarget;};
  const observer=new ResizeObserver(()=>{if(restoring)restore();});
  const main=document.querySelector('.main-content');if(main)observer.observe(main);
  const frame=requestAnimationFrame(restore);
  const finish=()=>{restoring=false;observer.disconnect();};
  const timer=setTimeout(finish,1200);
  window.addEventListener('wheel',finish,{once:true,passive:true});
  window.addEventListener('touchstart',finish,{once:true,passive:true});
  window.addEventListener('keydown',finish,{once:true});
  window.addEventListener('scroll',save,{passive:true});nav?.addEventListener('scroll',saveSide,{passive:true});
  window.addEventListener('pagehide',save);
  return()=>{save();saveSide();observer.disconnect();cancelAnimationFrame(frame);clearTimeout(timer);window.removeEventListener('wheel',finish);window.removeEventListener('touchstart',finish);window.removeEventListener('keydown',finish);window.removeEventListener('scroll',save);window.removeEventListener('pagehide',save);nav?.removeEventListener('scroll',saveSide);};
 },[identity,route,revision]);
 return null;
}
