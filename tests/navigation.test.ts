import {describe,it,expect} from 'vitest';
import {baseCapabilities} from '../src/lib/capabilities';
import {resources} from '../src/domain/registry';
import {functionCatalog,findFunctions} from '../src/components/feature-search';
const context={userId:'user',workspaceId:'workspace',companyId:'company',roles:['member']};
describe('permission bounded navigation',()=>{
 it('does not offer member financial/config creation, readonly review creation, or child creation',()=>{
  expect(baseCapabilities(context,resources.tasks).create).toBe(true);
  for(const key of ['budgets','approval_policies','reviews','task_comments'])expect(baseCapabilities(context,resources[key]).create).toBe(false);
  expect(baseCapabilities(context,resources.budgets).read).toBe(false);
  expect(baseCapabilities(context,resources.budgets).needsRecordCheck).toBe(true);
 });
 it('respects explicit restrictions and external creation denial',()=>{
  expect(baseCapabilities({...context,roles:['finance']},resources.budgets)).toMatchObject({read:true,create:true});
  expect(baseCapabilities({...context,roles:['external']},resources.contacts)).toMatchObject({read:false,create:false});
  expect(baseCapabilities({...context,permissions:[{resource:'tasks',operation:'create',scope:'none'},{resource:'tasks',operation:'read',scope:'none'}]},resources.tasks)).toEqual({read:false,create:false,needsRecordCheck:false});
 });
 it('finds features across languages and links to exact settings or creation destinations',()=>{
  const catalog=functionCatalog({contacts:{...resources.contacts,capabilities:{read:true,create:true}}},['admin'],'zh-TW');
  expect(findFunctions(catalog,'快捷新增')[0].path).toBe('/settings?section=profile');
  expect(findFunctions(catalog,'appearance')[0].path).toBe('/settings?section=appearance');
  expect(findFunctions(catalog,'新增 聯絡人')[0].path).toBe('/data/contacts?new=1');
 });
 it('excludes inaccessible functions and administrative settings from ordinary-member results',()=>{
  const catalog=functionCatalog({budgets:{...resources.budgets,capabilities:{read:false,create:false}},contacts:{...resources.contacts,capabilities:{read:true,create:false}}},['member'],'en');
  expect(findFunctions(catalog,'Budget')).toEqual([]);expect(findFunctions(catalog,'permissions')).toEqual([]);
  expect(catalog.some(entry=>entry.id==='contacts')).toBe(true);expect(catalog.some(entry=>entry.id==='create:contacts')).toBe(false);
 });
});
