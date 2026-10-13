import {interfaceText} from './interface-text';
export function assistantError(code:string,locale:string){
 const messages:Record<string,[string,string]>={
 ASSISTANT_BUDGET_EXCEEDED:['本月额度已用完，请申请追加额度或等待下月重置。','Your monthly allowance is exhausted. Request more or wait for the monthly reset.'],
 ASSISTANT_USAGE_PENDING:['有调用正在处理或费用待核实，请稍后重试或联系管理员。','A call is in progress or awaiting usage reconciliation. Try later or contact an administrator.'],
 ASSISTANT_PROVIDER_UNCERTAIN:['本次调用结果待核实，系统未自动重试，避免重复费用。','The call outcome is uncertain. It was not retried automatically to avoid duplicate charges.'],
 ASSISTANT_BUSY:['上一项任务仍在处理，请稍后重试。','Another request is processing. Try again shortly.'],
 ASSISTANT_NOT_CONFIGURED:['服务尚未配置，请联系管理员。','The service is not configured. Contact an administrator.'],
 ASSISTANT_CREDENTIALS:['服务授权或账户余额不可用，请联系管理员。','Service credentials or credit are unavailable. Contact an administrator.'],
 ASSISTANT_SIGNATURE_REQUIRED:['此操作需要您在原记录中核对身份并签署，请打开原记录办理。','Open the original record to verify your identity and sign this action.'],
 ASSISTANT_RECORD_CHANGED:['记录已发生变化，请重新核对后生成操作清单。','The record changed. Refresh and review a new plan.'],
 ASSISTANT_PREVIEW_CHANGED:['记录或权限已变化，请重新核对操作清单。','Records or permissions changed. Review a refreshed plan.'],
 ASSISTANT_DEPENDENCY_REQUIRED:['请先执行本步骤所依赖的新增操作。','Complete the prerequisite creation step first.'],
 ASSISTANT_PARTIAL_EXECUTION:['此清单已有操作完成。请重试未完成步骤，或新建任务继续处理；已完成操作不会重新分析。','Some actions have completed. Retry unfinished steps or start a new request; completed actions cannot be reanalyzed.'],
 ASSISTANT_DUPLICATE:['检测到重复记录，已跳过。','A duplicate was detected and skipped.'],
 ASSISTANT_INPUT_TOO_LARGE:['资料超过处理上限，请缩小范围或拆分文件。','The input is too large. Narrow the scope or split the files.'],
 ASSISTANT_FILE_INVALID:['无法读取文件，请使用未加密的支持格式。','Cannot read this file. Use a supported unencrypted format.'],
 ASSISTANT_INVALID_PLAN:['结果未通过核验，尚未执行；请补充要求后重试。','The result did not pass validation. Nothing was executed; clarify and retry.'],
 ASSISTANT_ANALYSIS_FAILED:['分析未完成，尚未执行操作，请重试或联系管理员。','Analysis did not complete. No actions ran. Retry or contact an administrator.'],
 ASSISTANT_OPERATION_FAILED:['该步骤未完成，请在原记录中核对所需字段及状态。','This step failed. Check required fields and status on the original record.'],
 FORBIDDEN:['当前无权执行此操作。','You do not have permission for this action.']
 };
 const pair=messages[code];return pair?interfaceText(locale,...pair):interfaceText(locale,'操作未完成，请核对原记录或联系管理员。','Action not completed. Check the record or contact an administrator.')+' ('+code+')';
}
