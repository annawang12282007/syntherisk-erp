import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

// Preserve the upstream Unicode subsets: browsers fetch only glyph ranges in use.
// Unique CSS aliases avoid collision with locally installed partial CJK fonts.
const output=resolve('public/fonts');await mkdir(output,{recursive:true});
const css=[],manifest=[];
for(const [id,family] of [['noto-sans-tc','Syntherisk Sans TC'],['noto-sans-sc','Syntherisk Sans SC']]){
 const source=resolve('node_modules/@fontsource-variable',id),destination=join(output,id);await mkdir(destination,{recursive:true});
 const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
 let sheet=await readFile(join(source,'index.css'),'utf8');
 const files=[...new Set([...sheet.matchAll(/url\(\.\/files\/([a-z0-9-]+\.woff2)\)/g)].map(match=>match[1]))];
 if(!files.length)throw new Error(`Missing WOFF2 subsets: ${id}`);
 const assets=[];for(const name of files){await copyFile(join(source,'files',name),join(destination,name));const content=await readFile(join(destination,name));assets.push({file:name,bytes:(await stat(join(destination,name))).size,sha256:createHash('sha256').update(content).digest('hex')});}
 await copyFile(join(source,'LICENSE'),join(destination,'OFL.txt'));
 sheet=sheet.replace(/font-family: '[^']+';/g,`font-family: '${family}';`).replaceAll('url(./files/',`url(/fonts/${id}/`);
 css.push(sheet);manifest.push({package:pkg.name,version:pkg.version,license:pkg.license,cssFamily:family,source:`https://fontsource.org/fonts/${id}`,assets});
}
css.push(`
@font-face{font-family:Liberation;src:url('/brand/LiberationSans-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:Liberation;src:url('/brand/LiberationSans-Bold.ttf') format('truetype');font-style:normal;font-weight:700;font-display:swap}
@font-face{font-family:Liberation;src:url('/brand/LiberationSans-Italic.ttf') format('truetype');font-style:italic;font-weight:400;font-display:swap}
@font-face{font-family:Liberation;src:url('/brand/LiberationSans-BoldItalic.ttf') format('truetype');font-style:italic;font-weight:700;font-display:swap}
:root{--font-sans:Liberation,'Syntherisk Sans TC','Syntherisk Sans SC','Microsoft JhengHei','PingFang TC',Arial,sans-serif}
html:lang(zh-Hans),html:lang(zh-CN){--font-sans:Liberation,'Syntherisk Sans SC','Syntherisk Sans TC','Microsoft YaHei','PingFang SC',Arial,sans-serif}
`);
await writeFile(join(output,'typography.css'),css.join('\n'));
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Self-hosted TC/SC fonts prepared: ${manifest.reduce((count,item)=>count+item.assets.length,0)} Unicode subsets.`);
