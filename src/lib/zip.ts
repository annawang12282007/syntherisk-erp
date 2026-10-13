import {crc32} from 'node:zlib';
/** Bounded UTF-8, uncompressed ZIP entries (APPNOTE 4.3); no filesystem paths or ZIP64. */
export function storedZip(entries:{name:string;bytes:Buffer}[],at=new Date()):Buffer {
 if(entries.length>1000||entries.reduce((size,entry)=>size+entry.bytes.length,0)>100_000_000)throw new Error('ZIP size limit exceeded');
 for(const entry of entries)if(!entry.name||entry.name.startsWith('/')||entry.name.includes('\\')||entry.name.split('/').some(part=>part==='..')||Buffer.byteLength(entry.name)>65535)throw new Error('Invalid ZIP entry name');
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 const year=Math.max(1980,Math.min(2107,at.getUTCFullYear()));
 const date=((year-1980)<<9)|((at.getUTCMonth()+1)<<5)|at.getUTCDate();
 const time=(at.getUTCHours()<<11)|(at.getUTCMinutes()<<5)|(at.getUTCSeconds()>>1);
 for(const entry of entries){
  const name=Buffer.from(entry.name,'utf8'),size=entry.bytes.length,crc=crc32(entry.bytes);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(time,10);header.writeUInt16LE(date,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(size,18);header.writeUInt32LE(size,22);header.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(time,12);directory.writeUInt16LE(date,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(size,20);directory.writeUInt32LE(size,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,name,entry.bytes);central.push(directory,name);offset+=header.length+name.length+size;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

