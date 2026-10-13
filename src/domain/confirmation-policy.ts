/** Confirmation notes follow existing workflow permissions and signature rules. */
export function recordsConfirmationNote(resource:string,action:string){
 return ['accept','confirm','approve','sign','complete','adopt','receive'].includes(action)
  ||resource==='reviews'&&action==='return'
  ||resource==='delegations'&&action==='request_changes';
}
export const confirmationOpinionKeys=['reason','comments','acceptance_notes'];
