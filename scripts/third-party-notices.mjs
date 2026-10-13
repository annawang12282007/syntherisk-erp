import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='node_modules/.pnpm', packages=new Map();
async function inspect(path) {
 try {
  const data=JSON.parse(await readFile(join(path,'package.json'),'utf8'));
  if(!data.name||!data.version)return;
  packages.set(data.name+'@'+data.version,{name:data.name,version:data.version,license:typeof data.license==='string'?data.license:(data.license?.type??'SEE PACKAGE LICENSE'),repository:typeof data.repository==='string'?data.repository:(data.repository?.url??null)});
 }catch{/* Non-package entries have no package.json. */}
}
for(const directory of await readdir(root)) {
 if(directory==='node_modules'||directory.startsWith('.'))continue;
 const modules=join(root,directory,'node_modules');
 let entries;try{entries=await readdir(modules,{withFileTypes:true});}catch{continue;}
 for(const entry of entries) {
  // Follow only the installed package directory, not pnpm dependency links.
  if(!entry.isDirectory())continue;
  if(entry.name.startsWith('@')) {
   for(const child of await readdir(join(modules,entry.name),{withFileTypes:true}))if(child.isDirectory())await inspect(join(modules,entry.name,child.name));
  } else await inspect(join(modules,entry.name));
 }
}
await mkdir('docs',{recursive:true});
await writeFile('docs/THIRD_PARTY.json',JSON.stringify({description:'Installed packages for the committed pnpm lockfile. Package licenses and notices govern their respective code; this metadata inventory is not a license compatibility opinion.',packages:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version))},null,2)+'\n');
console.log(`Generated license inventory for ${packages.size} packages.`);
