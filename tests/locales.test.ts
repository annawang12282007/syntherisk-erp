import {describe,it,expect} from 'vitest';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {words,translate} from '../src/locales';
import {resources} from '../src/domain/registry';
async function files(root:string):Promise<string[]>{const result:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())result.push(...await files(path));else if(/\.tsx?$/.test(path))result.push(path);}return result;}
describe('locale coverage',()=>{
 it('every UI literal and business state/action/option is translated in three languages',async()=>{
  const used=new Set<string>();for(const file of await files('src/components')){const text=await readFile(file,'utf8');for(const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g))used.add(match[1]);}
  for(const resource of Object.values(resources)){for(const key of [...resource.states??[],...resource.actions??[],...resource.fields.flatMap(field=>field.options??[])])used.add(key);for(const field of [...resource.fields,...Object.values(resource.actionFields??{}).flat()])expect(field.label.every(label=>label.trim().length>0)).toBe(true);}
  expect([...used].filter(key=>!(key in words))).toEqual([]);
  for(const[key,tuple]of Object.entries(words)){expect(tuple,key).toHaveLength(3);expect(tuple.every(value=>value.trim().length>0),key).toBe(true);for(const locale of ['zh-TW','zh-CN','en'] as const)expect(translate(locale,key),key).not.toBe('');}
 });
});
