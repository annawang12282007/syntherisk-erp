import {describe,it,expect} from 'vitest';
import {interfaceText} from '../src/locales/interface-text';
import {assistantError} from '../src/locales/assistant-errors';
describe('assistant interface languages',()=>{
 it('uses Traditional Chinese and Taiwan interface terms',()=>{
  expect(interfaceText('zh-TW','本月个人额度 · 剩余 · 日报设置','Allowance')).toBe('本月個人額度 · 剩餘 · 日報設定');
  expect(interfaceText('zh-TW','未选择文件；默认创建用户信息字段并保存','Files')).toBe('未選擇檔案；預設建立使用者資訊欄位並儲存');
 });
 it('retains Simplified Chinese and English independently',()=>{
  expect(interfaceText('zh-CN','本月個人額度','Your monthly allowance')).toBe('本月个人额度');
  expect(interfaceText('en','本月个人额度','Your monthly allowance')).toBe('Your monthly allowance');
 });
 it('localizes blocked and fallback states as well as normal controls',()=>{
  expect(assistantError('ASSISTANT_BUDGET_EXCEEDED','zh-TW')).toContain('額度已用完，請申請追加額度');
  expect(assistantError('UNKNOWN','zh-TW')).toContain('請核對');
  expect(assistantError('UNKNOWN','en')).toBe('Action not completed. Check the record or contact an administrator. (UNKNOWN)');
 });
});
