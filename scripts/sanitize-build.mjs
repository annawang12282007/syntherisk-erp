import {readdir,unlink,access,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
// Next copies loaded .env files into standalone output. Deployment receives
// secrets through the environment, never through a distributable build.
const root=resolve('.next/standalone');
for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isFile()&&/^\.env($|\.)/.test(entry.name))await unlink(join(root,entry.name));
for(const directory of ['data','backups','work','test-results','playwright-report']){
 const present=await access(join(root,directory)).then(()=>true,()=>false);
 if(present)throw new Error(`Unexpected private directory in standalone build: ${directory}`);
}
console.log('Standalone build checked: no environment secrets or runtime data.');
await cp('public',join(root,'public'),{recursive:true});
await cp('.next/static',join(root,'.next/static'),{recursive:true});
// Native DLL dependencies are not discovered by Next's JS file tracing on Windows.
if(process.platform==='win32')for(const entry of await readdir('node_modules/.pnpm')){
 if(!entry.startsWith('@img+sharp-win32-'))continue;
 const directory=join('node_modules','.pnpm',entry,'node_modules','@img',`sharp-win32-${process.arch}`,'lib');
 if(await access(directory).then(()=>true,()=>false))await cp(directory,join(root,directory),{recursive:true});
}
const runtime=createRequire(join(root,'package.json'));
if(!runtime.resolve('sharp').startsWith(root))throw new Error('Signature image runtime is missing from standalone output');
await runtime('sharp')({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer();
console.log('Standalone signature image runtime verified.');
