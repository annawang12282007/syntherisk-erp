import {interfaceText} from './interface-text';
const messages:Record<string,[string,string]>={
 journal_currency_unsupported:['此分录可使用公司本位币或 USD。','Use the company home currency or USD for this journal.'],
 journal_currency_required:['请在分录编辑器中确认原币，再保存美元草稿。','Confirm the original currency in the journal editor before saving this USD draft.'],
 journal_fx_rate:['汇率必须大于零，最多保留 12 位小数。','Enter a positive exchange rate with up to 12 decimal places.'],
 journal_fx_required:['请补齐美元汇率、汇率日期及来源，再保存并入账。','Complete the USD exchange rate, date and source, then save before posting.'],
 journal_fx_changed:['原币资料与入账明细不一致，请重新打开分录编辑器核对并保存。','Original amounts and ledger lines differ. Reopen the journal editor, review and save.'],
 journal_original_unbalanced:['USD 原币借贷尚未平衡，不能正式入账。','The original USD debits and credits must balance before posting.'],
 journal_one_side:['同一行只能填写借方或贷方金额。','Enter either a debit or a credit on each line.'],
 journal_draft_changed:['分录已被更新，请关闭后重新打开，核对最新内容再保存。','This journal changed. Close and reopen it to review the latest version before saving.'],
 journal_draft_incomplete:['草稿尚未完成，请补齐科目、金额及适用的汇率资料，确认折算金额不为零，保存后再入账。','Complete the accounts, amounts and applicable exchange details, check that converted amounts are nonzero, then save before posting.'],
 fiscal_invalid_dates:['请选择有效日期。月份与日期必须匹配。','Choose valid dates that match the selected month.'],
 fiscal_first_year_length:['首个财年的起止顺序必须正确，且不得超过 371 天。','The first fiscal year must run forward and last no more than 371 days.'],
 fiscal_end_mismatch:['首个财年结束日须与每年的结账月份和日期一致。','The first fiscal year-end must match the annual year-end month and day.'],
 fiscal_year_unavailable:['请选择首个财年或之后的有效年份。','Choose the first fiscal year or a later supported year.'],
 fiscal_before_start:['日期早于首个财年开始日，请单独核对成立前支出。','The date precedes the first fiscal year. Review pre-incorporation costs separately.'],
 fiscal_settings_locked:['已有会计期间或已过账分录，不能直接改变财年边界。','Periods or posted journals exist; fiscal boundaries cannot be changed directly.'],
 fiscal_existing_period_conflict:['已有期间与所选财年或月份冲突，请先核对现有期间。','Existing periods conflict with this fiscal year or its months. Review them first.'],
 fiscal_settings_required:['请先保存公司的会计年度设置。','Save the company fiscal-year settings first.'],
 fiscal_preview_changed:['设置或会计期间已变化，请重新预览后再生成。','Settings or periods changed. Preview again before generating.']
};
export const fiscalYearWords=Object.fromEntries(Object.entries(messages).map(([key,[zh,en]])=>['error_'+key,[interfaceText('zh-TW',zh,en),zh,en]]));
