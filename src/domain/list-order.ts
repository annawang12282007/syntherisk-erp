import type {ResourceDef} from './registry';

/** Resolve only registered, persisted columns before interpolating SQL identifiers. */
export function listOrderSql(resource:ResourceDef,requestedSort:unknown,requestedOrder:unknown){
 const sort=typeof requestedSort==='string'&&(resource.fields.some(field=>!field.derived&&field.key===requestedSort)||['created_at','updated_at','version',...(resource.states?['status']:[])].includes(requestedSort))?requestedSort:'updated_at';
 const direction=requestedOrder==='asc'?'ASC':'DESC';
 // Priority is an ordered business scale, not an alphabetical label. Keep the
 // ordering in SQL so pagination and exports see the same complete ordering.
 const expression=resource.key==='tasks'&&sort==='priority'?"CASE r.priority WHEN 'low' THEN 1 WHEN 'normal' THEN 2 WHEN 'high' THEN 3 WHEN 'urgent' THEN 4 ELSE NULL END":`r.${sort}`;
 return `${expression} ${direction} NULLS LAST,r.id ASC`;
}
