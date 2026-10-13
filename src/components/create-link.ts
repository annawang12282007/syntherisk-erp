/** Consume a one-shot create URL without discarding list filters or the fragment. */
export function consumedCreateLink(href:string,resource:string,recordId?:string){
 const url=new URL(href);if(url.searchParams.get('new')!=='1')return null;
 url.searchParams.delete('new');
 if(recordId){
  if(url.pathname==='/data/reviews'&&resource==='work_requests'){url.searchParams.delete('record');url.searchParams.set('request',recordId);}
  else{url.searchParams.set('record',recordId);if(url.pathname.startsWith('/module/'))url.pathname=`/data/${resource}`;}
 }
 return url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'')+url.hash;
}
