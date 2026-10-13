/** Closing a linked record consumes its route state, preserving list filters. */
export function closedRecordLink(href:string){
 const url=new URL(href);
 if(!url.searchParams.has('record')&&!url.searchParams.has('request'))return null;
 url.searchParams.delete('record');url.searchParams.delete('request');url.searchParams.delete('tab');url.searchParams.delete('action');
 return url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'')+url.hash;
}
