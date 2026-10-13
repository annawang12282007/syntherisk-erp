import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {excludedReleasePath,inspectReleaseText,scanPublicRelease} from '../scripts/public-release-scan.mjs';

test('rejects private artifacts while keeping environment templates and migration source',()=>{
  for(const path of ['.env','.env.production','.venv/pyvenv.cfg','data/file.bin','docs/qa/result.json','work/runtime.json','backup.dump','client_secret_test.json','demo-credentials.json','secret.pem','database.sql.gz'])assert.equal(excludedReleasePath(path),true,path);
  for(const path of ['.env.example','src/lib/auth.ts','prisma/migrations/001/migration.sql','public/brand/LICENSE_LIBERATION.txt'])assert.equal(excludedReleasePath(path),false,path);
});

test('findings identify location and category without exposing credential values',()=>{
  const token='gh'+'p_'+'a'.repeat(36),text='const token="'+token+'";';
  const findings=inspectReleaseText('src/example.ts',text);
  assert.deepEqual(findings,[{path:'src/example.ts',line:1,kind:'github-token'}]);
  assert.equal(JSON.stringify(findings).includes(token),false);
});

test('catches embedded secrets but permits synthetic examples',()=>{
  assert.equal(inspectReleaseText('sample.ts','postgresql://person:'+('private'+'value123')+'@db.invalid/app')[0].kind,'embedded-connection-credential');
  assert.deepEqual(inspectReleaseText('sample.ts','postgresql://demo:${password}@localhost/example\nmember@example.invalid'),[]);
});

test('private markers are optional literal case-insensitive values and are never returned',()=>{
  const marker='Fictional Example [Internal]',text='header\n'+marker.toUpperCase();
  assert.deepEqual(inspectReleaseText('sample.ts',text),[]);
  const findings=inspectReleaseText('sample.ts',text,{privateMarkers:['',marker,'  '+marker+'  ']});
  assert.deepEqual(findings,[{path:'sample.ts',line:2,kind:'private-release-marker'}]);
  assert.equal(JSON.stringify(findings).includes(marker),false);
  assert.deepEqual(inspectReleaseText('sample.ts','Fictional Example I',{privateMarkers:[marker]}),[]);
});

test('filesystem scan loads newline-delimited private markers from local environment',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'release-scan-'));
  const previous=process.env.PRIVATE_RELEASE_MARKERS;
  try{
    process.env.PRIVATE_RELEASE_MARKERS='  demo-company.example.invalid\r\n\r\nSample Person';
    await writeFile(join(directory,'fixture.txt'),'DEMO-COMPANY.EXAMPLE.INVALID\nSample Person\npublic documentation');
    const result=await scanPublicRelease(directory);
    assert.equal(result.files,1);
    assert.deepEqual(result.findings,[{path:'fixture.txt',line:1,kind:'private-release-marker'},{path:'fixture.txt',line:2,kind:'private-release-marker'}]);
    assert.equal(JSON.stringify(result).includes('demo-company'),false);
  }finally{
    if(previous===undefined)delete process.env.PRIVATE_RELEASE_MARKERS;else process.env.PRIVATE_RELEASE_MARKERS=previous;
    await rm(directory,{recursive:true,force:true});
  }
});
