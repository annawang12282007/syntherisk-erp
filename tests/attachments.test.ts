import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {describe,expect,it} from 'vitest';
import {attachmentBasename,attachmentPackage,type AttachmentMetadata} from '../src/lib/attachment-package';

const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const bytes=Buffer.from('Preservation bytes\n繁體中文\u0000\u0001');
const file:AttachmentMetadata={id:'8ab00f11-9fb7-4546-ac98-344b920ec089',filename:'研究附件.txt',mime_type:'text/plain',byte_size:bytes.length,sha256:hash(bytes),created_at:'2026-10-07T01:00:00.000Z',resource:'documents',record_id:'9af8ba1e-ceee-4b2b-88ef-d29463dd74a0'};

/** Independent platform ZIP reader validates the central directory and extracts original bytes. */
function extract(zip:Buffer):Record<string,string>{
 const script=process.platform==='win32'?`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression;[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$stream=[IO.MemoryStream]::new([Convert]::FromBase64String([Console]::In.ReadToEnd()));$zip=[IO.Compression.ZipArchive]::new($stream);$result=@{};foreach($entry in $zip.Entries){$out=[IO.MemoryStream]::new();$source=$entry.Open();$source.CopyTo($out);$source.Dispose();$result[$entry.FullName]=[Convert]::ToBase64String($out.ToArray());$out.Dispose()};$zip.Dispose();$stream.Dispose();$result|ConvertTo-Json -Compress`:`import sys,io,base64,zipfile,json\nz=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read())))\nassert z.testzip() is None\nprint(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))`;
 const result=execFileSync(process.platform==='win32'?'powershell.exe':'python3',process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',script]:['-c',script],{input:zip.toString('base64'),encoding:'utf8',windowsHide:true});
 return JSON.parse(result.trim());
}

describe('attachment preservation package',()=>{
 it('extracts original bytes with an independent ZIP reader and verifies both manifest digests',()=>{
  const bundle=attachmentPackage(file,bytes,7,new Date('2026-10-07T02:00:00Z'));
  const entries=extract(bundle.bytes);expect(Object.keys(entries).sort()).toEqual(['SHA256SUMS','metadata.json','研究附件.txt'].sort());
  expect(Buffer.from(entries[file.filename],'base64')).toEqual(bytes);
  const manifest=Buffer.from(entries.SHA256SUMS,'base64').toString('utf8');
  for(const line of manifest.trimEnd().split('\n')){const [expected,name]=line.split('  ');expect(hash(Buffer.from(entries[name],'base64'))).toBe(expected);}
  const metadata=JSON.parse(Buffer.from(entries['metadata.json'],'base64').toString('utf8'));
  expect(metadata).toMatchObject({filename:file.filename,byte_size:bytes.length,sha256:file.sha256,uploaded_at:file.created_at,downloaded_at:'2026-10-07T02:00:00.000Z',record:{resource:'documents',id:file.record_id,version_at_download:7}});
  expect(bundle.archiveSha256).toBe(hash(bundle.bytes));expect(metadata).not.toHaveProperty('storage_key');
 });
 it('refuses mismatched bytes or size before producing a package',()=>{
  expect(()=>attachmentPackage(file,Buffer.from('tampered'),7)).toThrow('ATTACHMENT_INTEGRITY_MISMATCH');
  expect(()=>attachmentPackage({...file,byte_size:bytes.length+1},bytes,7)).toThrow('ATTACHMENT_INTEGRITY_MISMATCH');
  expect(()=>attachmentPackage({...file,sha256:'0'.repeat(64)},bytes,7)).toThrow('ATTACHMENT_INTEGRITY_MISMATCH');
 });
 it('uses portable basenames and prevents path traversal, metadata collisions and control characters',()=>{
  for(const name of ['../../metadata.json','C:\\private\\SHA256SUMS','CON.txt','..','a\r\nb.txt','../'+'繁'.repeat(120)+'.txt']){
   const safe=attachmentBasename(name);expect(safe).not.toMatch(/[/\\\r\n]/);expect(Buffer.byteLength(safe)).toBeLessThanOrEqual(180);expect(['metadata.json','SHA256SUMS','.','..','CON.txt']).not.toContain(safe);
   const entries=extract(attachmentPackage({...file,filename:name},bytes,null).bytes);expect(Object.keys(entries)).toHaveLength(3);expect(Buffer.from(entries[safe],'base64')).toEqual(bytes);
  }
 });
});
