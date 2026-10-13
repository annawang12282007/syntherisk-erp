import {interfaceText} from './interface-text';
const messages:Record<string,[string,string]>={
 accounting_cad_required:['请先核对公司本位币；此流程适用于 CAD 账套。','Confirm the company home currency. This workflow requires a CAD ledger.'],
 accounting_chart_exists:['已有会计科目，请直接维护，不能重复初始化。','Accounts already exist. Manage them without reinitializing.'],
 accounting_registration_number:['请输入完整 GST/HST 账号，例如 123456789RT0001。','Enter a complete GST/HST account number, e.g. 123456789RT0001.'],
 accounting_account_kind:['所选科目的分类不符合本次入账用途，或科目已停用。','The account classification does not match this posting, or the account is inactive.'],
 accounting_refund_review_required:['退款需结合原入账和贷项处理，请由财务通过会计分录完成并关联原凭证。','Finance must review the original posting and credit before recording a refund journal linked to its evidence.'],
 accounting_credit_review_required:['该单据已有贷项，请先由财务核对原金额与贷项分录。','This document has credits. Finance must review the original amount and credit journals first.'],
 accounting_legacy_review_required:['相关付款已通过旧流程入账，请先核对原分录，避免重复记账。','Related payments were posted through the previous workflow. Review their journals to prevent duplicate recognition.'],
 accounting_source_first:['请先对原始账单或报销单确认入账，再核销付款；已冲销单据需先更正。','Recognize the original bill or claim before posting settlement. Correct reversed sources first.'],
 accounting_tax_exceeds_source:['确认税额不能超过原始单据记录的税额或核准总额。','Tax cannot exceed the recorded source tax or the approved total.'],
 accounting_registration_required:['先在会计设置中确认 GST/HST 登记信息，再确认税额。','Confirm GST/HST registration in Accounting setup before recognizing tax.'],
 accounting_sales_tax_required:['销售单据中的税额须单独计入税款负债，不能并入收入。','Record the tax on a sales document separately as a tax liability, not revenue.'],
 accounting_allocations_required:['请至少选择一个分类科目，并填写有效的拆分金额。','Select at least one allocation account and enter valid split amounts.'],
 accounting_allocation_mismatch:['分类金额加税额必须等于单据总额或核准金额。','Allocations plus tax must equal the document or approved amount.'],
 accounting_preview_changed:['入账依据已变化，请重新预览并确认。','The posting basis changed. Preview and confirm again.'],
 accounting_guided_required:['请使用“入账”预览流程核销此付款。','Use the guided posting preview to settle this payment.'],
 accounting_bank_mismatch:['请选择与付款一致的会计账户后再匹配银行流水。','Select the same ledger account as the payment before matching bank activity.']
};
export const accountingWords:Record<string,readonly string[]>={Debit:['借方','借方','Debit'],Credit:['貸方','贷方','Credit'],financeProtectedSource:['無法存取來源單據','来源单据不可访问','Source document unavailable'],...Object.fromEntries(Object.entries(messages).map(([key,[zh,en]])=>['error_'+key,[interfaceText('zh-TW',zh,en),zh,en]]))};
