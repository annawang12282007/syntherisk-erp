export const navigationOrder=['overview','contacts','organizations','engagements','projects','collaboration','approvalInbox','calendar','workforce','finance','procurement','documents','validation','communications','teamDirectory','analytics','personalAssistant','fileAssistant','archives','settings'];

export function normalizeNavigationOrder(saved?:string[]){
 return [...new Set([...(saved??[]).filter(id=>navigationOrder.includes(id)),...navigationOrder])];
}
