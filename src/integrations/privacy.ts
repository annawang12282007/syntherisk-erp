/** Creator-private calendar records are never automatically exported to a configured calendar. */
export function autoSyncEventPredicate(alias='event'){
 return `(NOT ${alias}.is_private AND NOT EXISTS(SELECT 1 FROM events private_parent WHERE private_parent.workspace_id=${alias}.workspace_id AND private_parent.id=${alias}.recurrence_parent_id AND private_parent.is_private))`;
}
