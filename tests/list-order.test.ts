import {expect,it} from 'vitest';
import {listOrderSql} from '../src/domain/list-order';
import {resources} from '../src/domain/registry';

it('rejects arbitrary and derived sort columns and never interpolates an unchecked direction',()=>{
 for(const sort of ['priority DESC; DROP TABLE tasks; --','blocked_by_dependencies',{},null])expect(listOrderSql(resources.tasks,sort,'asc')).toBe('r.updated_at ASC NULLS LAST,r.id ASC');
 expect(listOrderSql(resources.tasks,'title','ASC NULLS FIRST; --')).toBe('r.title DESC NULLS LAST,r.id ASC');
 expect(listOrderSql(resources.contacts,'status','asc')).toBe('r.updated_at ASC NULLS LAST,r.id ASC');
});

it('keeps registered scalar and metadata fields sortable with deterministic ties',()=>{
 for(const sort of ['title','due_date','completion_required','created_at','updated_at','version','status'])expect(listOrderSql(resources.tasks,sort,'asc')).toBe(`r.${sort} ASC NULLS LAST,r.id ASC`);
 expect(listOrderSql(resources.accounts,'code','asc')).toBe('r.code ASC NULLS LAST,r.id ASC');
});
