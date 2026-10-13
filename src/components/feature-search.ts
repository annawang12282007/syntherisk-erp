import {translate,type Locale} from '../locales';
import type {Resource} from './types';
export type FunctionEntry={id:string;title:string;category:string;path:string;terms:string[]};
const locales:Locale[]=['zh-TW','zh-CN','en'];
const words=(key:string)=>locales.map(locale=>translate(locale,key));
export function functionCatalog(resources:Record<string,Resource>,roles:string[],locale:Locale):FunctionEntry[]{
 const t=(key:string)=>translate(locale,key),admin=roles.includes('admin');
 const entries:FunctionEntry[]=[
  {id:'archives',title:t('archives'),category:t('management'),path:'/archives',terms:['封存 删除 刪除 回收 還原 审核 審核 archive recycle retention']},
  {id:'approvalInbox',title:t('approvalInbox'),category:t('workspace'),path:'/approvals',terms:['電子簽名 电子签名 簽署 签署 核准 审批 審核 approval signature sign']},
  {id:'overview',title:t('overview'),category:t('workspace'),path:'/',terms:[...words('overview'),'首頁','首页','dashboard']},
  {id:'calendar',title:t('calendar'),category:t('workspace'),path:'/calendar',terms:[...words('calendar'),'排程','日程','schedule']},
  {id:'analytics',title:t('analytics'),category:t('management'),path:'/analytics',terms:[...words('analytics'),'報表','报表','reports']},
  {id:'notifications',title:t('notifications'),category:t('workspace'),path:'/notifications',terms:[...words('notifications'),'提醒','通知','公告','發布通知','发布通知','announcements','reminders']},
 ];
 if(!roles.every(role=>role==='external'))entries.push({id:'personalAssistant',title:t('personalAssistant'),category:t('workspace'),path:'/personal-assistant',terms:['个人助理 日报 每日报告 personal assistant daily report']},{id:'fileAssistant',title:t('fileAssistant'),category:t('workspace'),path:'/file-assistant',terms:['系统助理 文件 导入 assistant import files']});
 if(!roles.every(role=>role==='external'))entries.push({id:'team',title:t('teamDirectory'),category:t('management'),path:'/team',terms:[...words('teamDirectory'),'成員 成员 聯繫 联系 通訊錄 通讯录 contacts directory']});
 if(!roles.every(role=>role==='external'))entries.push({id:'workforce',title:t('workforce'),category:t('management'),path:'/workforce',terms:[...words('workforce'),'人力 排班 出勤 打卡 休息 薪資 薪资 月薪 時薪 时薪 payroll workforce attendance clock shift salary']});
 const settings=[['appearance','字體 字体 font 主題 主题 theme 顏色 颜色 color UI'],['profile','簽名樣式 电子签名 signature 密碼 password 郵箱 綁定 email 帳戶名稱 账户名称 名稱 名称 account name 快捷新增 快捷入口 最近使用 釘選 钉选 側欄 侧栏 排序 quick create shortcuts pinned recent sidebar'],['integrations','Google 同步 sync 郵件 邮件 mail'],...(admin?[['company','品牌 brand 公司 company'],['members','邀請 邀请 invite 成員 成员 members'],['permissions','授權 授权 權限 权限 authorization permissions'],['audit','操作歷史 操作历史 history audit']]:[])];
 for(const [key,aliases] of settings)entries.push({id:`settings:${key}`,title:t(key),category:t('settings'),path:`/settings?section=${key}`,terms:[...words(key),aliases]});
 for(const resource of Object.values(resources).filter(item=>!item.parent&&!item.hidden&&item.capabilities?.read!==false)){
  const title=resource.label[locale==='en'?2:locale==='zh-CN'?1:0];
  entries.push({id:resource.key,title,category:t(resource.module),path:resource.module==='settings'&&admin?`/settings?section=${resource.key}`:`/data/${resource.key}`,terms:[...resource.label,resource.key.replaceAll('_',' ')]});
  if(resource.capabilities?.create&&!resource.readonly)entries.push({id:`create:${resource.key}`,title:`${t('add')} · ${title}`,category:t('quickCreate'),path:`/data/${resource.key}?new=1`,terms:locales.map((language,index)=>`${translate(language,'add')} ${resource.label[index]}`).concat(resource.label.map(label=>`create ${label}`))});
 }
 return entries;
}
export function findFunctions(entries:FunctionEntry[],query:string){
 const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().trim();const text=normalize(query),tokens=text.split(/\s+/).filter(Boolean);
 if(!text)return entries.filter(entry=>!entry.id.startsWith('create:')).slice(0,8);
 return entries.filter(entry=>tokens.every(token=>normalize([entry.title,...entry.terms].join(' ')).includes(token))).sort((a,b)=>Number(normalize(b.title)===text)-Number(normalize(a.title)===text)||Number(normalize(b.title).startsWith(text))-Number(normalize(a.title).startsWith(text))||Number(a.id.startsWith('create:'))-Number(b.id.startsWith('create:'))).slice(0,24);
}
