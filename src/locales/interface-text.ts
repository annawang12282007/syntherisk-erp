import {Converter} from 'opencc-js';

const simplified = Converter({from:'tw',to:'cn'});
const traditional = Converter({from:'cn',to:'twp'});

/** Localize application-authored labels only; never pass user content here. */
export function interfaceText(locale:string, chinese:string, english:string):string {
  if(locale==='en') return english;
  if(locale!=='zh-TW') return simplified(chinese);
  return traditional(chinese).replaceAll('信息','資訊').replaceAll('字段','欄位')
    .replaceAll('默認','預設').replaceAll('創建','建立').replaceAll('設置','設定')
    .replaceAll('保存','儲存').replaceAll('用戶','使用者').replaceAll('聯繫人','聯絡人')
    .replaceAll('生成','產生').replaceAll('自定義','自訂').replaceAll('打開','開啟')
    .replaceAll('設定物件','設定對象').replaceAll('適用物件','適用對象');
}
