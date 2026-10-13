'use client';
import {Info} from 'lucide-react';
import {useApp} from './context';
import {DisplayValue} from './primitives';
import type {Field,Row} from './types';
import './configuration-guide.css';

type Guide={summary:string;purpose:string;example:string;empty:string;rules:string[];fields:Record<string,string>};
export const configurationGuides:Record<string,Guide>={
 approval_policies:{summary:'policySummary',purpose:'policyPurpose',example:'policyExample',empty:'policyEmpty',rules:['policyRuleCurrency','policyRuleMatch','policyRuleReview','policyRuleFallback'],fields:{min_minor:'policyMinHint',max_minor:'policyMaxHint',category_id:'policyCategoryHint',project_id:'policyProjectHint',reviewer_id:'policyReviewerHint',delegate_id:'policyDelegateHint',owner_id:'configOwnerHint'}},
 expense_categories:{summary:'categorySummary',purpose:'categoryPurpose',example:'categoryExample',empty:'categoryEmpty',rules:['categoryAccountHint'],fields:{account_id:'categoryAccountHint',owner_id:'configOwnerHint'}},
 currencies:{summary:'currencySummary',purpose:'currencyPurpose',example:'currencyExample',empty:'currencyEmpty',rules:['currencyRule'],fields:{code:'currencyCodeHint',minor_digits:'currencyDigitsHint',owner_id:'configOwnerHint'}},
 tax_rates:{summary:'taxSummary',purpose:'taxPurpose',example:'taxExample',empty:'taxEmpty',rules:['taxRule'],fields:{rate:'taxRateHint',jurisdiction:'taxJurisdictionHint',account_id:'taxRule',owner_id:'configOwnerHint'}},
};

export function ConfigurationGuide({resourceKey,compact=false}:{resourceKey:string;compact?:boolean}){
 const {t}=useApp();const guide=configurationGuides[resourceKey];if(!guide)return null;
 return <details className={`configuration-help${compact?' compact':''}`} data-resource={resourceKey}>
  <summary><Info size={15}/>{t(compact?'settingFormHint':'settingHelp')}</summary>
  <div className="configuration-help-body"><p>{t(guide.purpose)}</p><p><strong>{t('settingExample')}：</strong>{t(guide.example)}</p><ul>{guide.rules.map(key=><li key={key}>{t(key)}</li>)}</ul></div>
 </details>;
}

export function configurationField(resourceKey:string,field:Field):Field{
 if(resourceKey==='approval_policies'&&(field.key==='min_minor'||field.key==='max_minor'))return {...field,label:field.key==='min_minor'?['最低金額（最小單位）','最低金额（最小单位）','Minimum amount (minor units)']:['最高金額（0＝不限）','最高金额（0＝不限）','Maximum amount (0 = unlimited)']};
 if(resourceKey==='currencies'&&field.key==='minor_digits')return {...field,required:true};
 return field;
}

export function ConfigurationValue({resourceKey,field,value,row}:{resourceKey:string;field:Field;value:unknown;row:Row}){
 const {t,locale}=useApp();
 if(resourceKey==='approval_policies'&&(field.key==='min_minor'||field.key==='max_minor')&&value!==null&&value!==undefined){
  if(field.key==='max_minor'&&String(value)==='0')return <span>{t('settingNoUpperLimit')}</span>;
  let amount=String(value);try{amount=new Intl.NumberFormat(locale).format(BigInt(amount));}catch{}
  return <span className="tabular">{amount} <small className="muted">{t('settingMinorUnits')}</small></span>;
 }
 return <DisplayValue field={field} value={value} row={row}/>;
}
