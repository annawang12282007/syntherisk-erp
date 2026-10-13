import * as OpenCC from 'opencc-js';
const simplified=OpenCC.Converter({from:'tw',to:'cn'});
const entries:Record<string,[string,string]>={
 plain:['純文字','Plain text'],formatted:['格式化郵件','Formatted mail'],INVALID_DATE_RANGE:['請選擇有效日期範圍，一次最多 366 天。','Choose a valid date range of up to 366 days.'],TOO_MANY_RECIPIENTS:['一次最多 100 個收件地址，請分批檢閱。','Review no more than 100 recipient addresses at once.'],
  "archives": [
    "資料封存區",
    "Records archive"
  ],
  "signatureDeleteVersion": [
    "刪除所選簽名版本",
    "Delete selected signature version"
  ],
  "signatureDeleteHint": [
    "此簽名樣式將刪除，已完成的簽署留檔不受影響。若刪除目前使用版本，系統會改用最近保留的版本；若沒有其他版本，會回到帳戶名稱的預設樣式。",
    "Deletes this preset without changing signed receipts. Deleting the active version selects the latest remaining version, or the account-name default when no versions remain."
  ],
  "retentionIntro": [
    "先封存，再依資料等級刪除。刪除後移入回收區，可依權限還原；原始內容與稽核紀錄仍保留，不代表永久抹除。",
    "Archive first, then delete according to retention rules. Deleted records enter the recycle area and can be restored with permission. Content and audit records are retained; this is not permanent erasure."
  ],
  "retentionLevel": [
    "資料保留等級",
    "Retention level"
  ],
  "retentionTier_owner": [
    "封存後建立者可刪除",
    "Creator may delete after archiving"
  ],
  "retentionTier_authorized": [
    "封存後具刪除權限者可刪除",
    "Authorized user may delete after archiving"
  ],
  "retentionTier_approval": [
    "封存後須管理審核方可刪除",
    "Management approval required after archiving"
  ],
  "retentionTier_archive_only": [
    "可封存，不可刪除",
    "Archive allowed; deletion prohibited"
  ],
  "retentionTier_locked": [
    "不可封存，不可刪除",
    "Archiving and deletion prohibited"
  ],
  "retentionTierHint_owner": [
    "建立者仍須具有這筆資料的檢閱及編輯權限。",
    "The creator must retain read and edit access to this record."
  ],
  "retentionTierHint_authorized": [
    "須具有這筆資料的檢閱、編輯與刪除權限；管理員可在權限設定中授予角色。",
    "Requires read, edit and deletion rights. Administrators can grant deletion rights in permission settings."
  ],
  "retentionTierHint_approval": [
    "具刪除權限者提出申請，由另一位具刪除審核權限的人檢閱並核准。",
    "An authorized user requests deletion; a different authorized deletion reviewer must approve."
  ],
  "retentionTierHint_archive_only": [
    "資料可移至封存區及還原，但不提供刪除。",
    "The record can be archived and restored, but cannot be deleted."
  ],
  "retentionTierHint_locked": [
    "資料持續保留於原位置，封存與刪除均受限制。",
    "The record remains in its current location; neither archiving nor deletion is allowed."
  ],
  "retentionProtection": [
    "系統最低保護：財務、唯讀及稽核資料不可封存或刪除；已有簽署留檔的業務資料至少為「可封存，不可刪除」。自訂等級不能降低這些保護。",
    "System minimum protection: financial, read-only and audit data cannot be archived or deleted. Signed business records are at least archive-only. Custom rules cannot weaken these safeguards."
  ],
  "retentionView_active": [
    "使用中",
    "Active"
  ],
  "retentionView_archived": [
    "已封存",
    "Archived"
  ],
  "retentionView_deleted": [
    "回收區",
    "Recycle area"
  ],
  "retentionView_requests": [
    "刪除審核",
    "Deletion reviews"
  ],
  "retentionAction_archive": [
    "封存",
    "Archive"
  ],
  "retentionAction_restore": [
    "還原至使用中",
    "Restore to active"
  ],
  "retentionAction_delete": [
    "刪除至回收區",
    "Delete to recycle area"
  ],
  "retentionAction_recover": [
    "還原至封存區",
    "Recover to archive"
  ],
  "retentionAction_request": [
    "申請刪除",
    "Request deletion"
  ],
  "retentionAction_approve": [
    "核准刪除",
    "Approve deletion"
  ],
  "retentionAction_reject": [
    "駁回申請",
    "Reject request"
  ],
  "retentionAction_cancel": [
    "撤回申請",
    "Withdraw request"
  ],
  "retentionAction_policy": [
    "設定資料保留等級",
    "Set retention level"
  ],
  "retentionConfirm_archive": [
    "封存後將從一般清單隱藏，可在封存區檢閱或還原。進行中的任務與交接須先完成或取消。",
    "Archived records leave active lists and remain available in the archive. Open tasks and handoffs must first be completed or cancelled."
  ],
  "retentionConfirm_restore": [
    "將資料移回一般清單，同時取消尚未完成的刪除申請。",
    "Restores the record to active lists and cancels pending deletion requests."
  ],
  "retentionConfirm_delete": [
    "將此資料移入回收區，停止一般檢閱與操作。此操作保留內容供還原，不會刪除 Google 原始檔。",
    "Moves this record to the recycle area and prevents ordinary access. Content is retained for recovery. Google source files are unchanged."
  ],
  "retentionConfirm_recover": [
    "先還原至封存區；如需重新使用，再執行「還原至使用中」。",
    "Recovers to the archive. Restore to active separately when needed."
  ],
  "retentionConfirm_request": [
    "送出原因與紀錄資訊給指定審核人。審核人必須原本就有檢閱權；不會自動擴大私人資料的可見範圍。",
    "Sends the reason and record information to a designated reviewer who already has access. Private visibility is not expanded."
  ],
  "retentionConfirm_approve": [
    "核准後資料將移入回收區。送審後資料、權限或保留等級變更時，必須重新申請。",
    "Approval moves the record to the recycle area. Changed record versions, permissions or retention policies require a new request."
  ],
  "retentionConfirm_reject": [
    "駁回後資料繼續留在封存區，申請人可重新提出申請。",
    "The record stays archived. The requester may submit another request."
  ],
  "retentionConfirm_cancel": [
    "撤回尚未完成的刪除申請，資料仍留在封存區。",
    "Withdraws the pending request and keeps the record archived."
  ],
  "retentionRequest_pending": [
    "待審核",
    "Pending review"
  ],
  "retentionRequest_approved": [
    "已核准",
    "Approved"
  ],
  "retentionRequest_rejected": [
    "已駁回",
    "Rejected"
  ],
  "retentionRequest_cancelled": [
    "已撤回／取消",
    "Withdrawn / cancelled"
  ],
  "retentionReviewerHint": [
    "只列出目前能檢閱此筆資料且具有刪除審核權限的人，不含申請人自己。",
    "Only users with current record access and deletion-review rights are listed. The requester is excluded."
  ],
  "retentionNoReviewer": [
    "目前沒有符合條件的審核人。請管理員配置刪除審核權限；如為私人資料，建立者需先自行決定是否分享。",
    "No eligible reviewer. Ask an administrator to configure deletion-review rights. The creator must decide whether to share private records."
  ],
  "delete": [
    "刪除封存資料",
    "Delete archived records"
  ],
  "delete_review": [
    "審核資料刪除",
    "Review record deletion"
  ],
  "notification.deletion_review": [
    "有資料刪除申請待您審核",
    "A record deletion request needs your review"
  ],
  "RETENTION_UNSUPPORTED": [
    "此類資料使用原有管理功能，不適用一般封存。",
    "This resource uses its dedicated management tools."
  ],
  "RETENTION_LOCKED": [
    "此資料不可封存或移動，請確認保留等級。",
    "This record cannot be archived or moved under its retention rules."
  ],
  "RETENTION_DELETE_PROTECTED": [
    "此資料的保留等級或簽署紀錄禁止刪除。",
    "Retention rules or signed receipts prohibit deletion."
  ],
  "RETENTION_CREATOR_REQUIRED": [
    "此等級只允許資料建立者刪除。",
    "Only the record creator may delete at this retention level."
  ],
  "RETENTION_REFERENCED": [
    "仍有其他紀錄引用此資料。請先檢閱關聯紀錄，解除可移除的關聯後再申請。",
    "Other records still refer to this record. Review related records and remove eligible links first."
  ],
  "RETENTION_PENDING_SIGNATURE": [
    "此資料仍有待簽署要求，請先完成或取消要求。",
    "Pending signature requests must be completed or cancelled first."
  ],
  "RETENTION_ARCHIVE_FIRST": [
    "請先封存此資料，再執行刪除。",
    "Archive this record before deleting it."
  ],
  "RETENTION_CLOSE_FIRST": [
    "進行中的任務、交接或行程請先完成、撤回或取消，再封存。",
    "Complete, withdraw or cancel open work before archiving it."
  ],
  "RETENTION_REVIEWER_UNAVAILABLE": [
    "相關帳戶已停用或無法使用，請重新選擇審核人。",
    "A required account is inactive or unavailable. Choose another reviewer."
  ],
  "RETENTION_REVIEWER_REQUIRED": [
    "請由另一位指定且有權限的審核人處理。",
    "A different designated and authorized reviewer must handle this request."
  ],
  "RETENTION_REVIEW_CHANGED": [
    "資料版本或保留政策已變更。請撤回此申請，重新檢閱後送審。",
    "The record or retention policy changed. Withdraw this request and submit a newly reviewed one."
  ],
  "RETENTION_APPROVAL_REQUIRED": [
    "此資料須先送交管理審核，不能直接刪除。",
    "Management approval is required; direct deletion is not allowed."
  ]
};
export const retentionWords:Record<string,[string,string,string]>=Object.fromEntries(Object.entries(entries).map(([key,[zh,en]])=>[key,[zh,simplified(zh),en]]));
