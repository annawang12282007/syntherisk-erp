import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

test('Compose setup gives each installation a persistent distinct image and preserves existing settings',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'erp-compose-setup-'));
  const script=fileURLToPath(new URL('../scripts/setup-compose.ts',import.meta.url));
  try{
    const installations=[join(directory,'one'),join(directory,'two')],images=[];
    for(const cwd of installations){
      await mkdir(cwd);
      const first=spawnSync(process.execPath,[script],{cwd,encoding:'utf8',windowsHide:true});
      assert.equal(first.status,0);
      const file=join(cwd,'.env.compose'),before=await readFile(file,'utf8');
      const image=/^ERP_IMAGE=(.+)$/m.exec(before)?.[1];
      assert.match(image??'',/^syntherisk-erp:install-[a-f0-9]{16}$/);
      images.push(image);
      const second=spawnSync(process.execPath,[script],{cwd,encoding:'utf8',windowsHide:true});
      assert.notEqual(second.status,0);
      assert.equal((await readFile(file,'utf8'))===before,true,'Existing configuration must remain byte-for-byte unchanged');
    }
    assert.notEqual(images[0],images[1]);
  }finally{
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
    await rm(directory,{recursive:true,force:true});
  }
});
