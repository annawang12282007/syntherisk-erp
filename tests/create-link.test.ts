import {describe,it,expect} from 'vitest';
import {consumedCreateLink} from '../src/components/create-link';
describe('one-shot create links',()=>{
 it('replaces the create flag with the saved record while retaining filters and fragment',()=>{expect(consumedCreateLink('http://localhost:3000/data/decisions?new=1&status=proposed&owner_id=member#content','decisions','created-id')).toBe('/data/decisions?status=proposed&owner_id=member&record=created-id#content');});
 it('consumes a cancelled create without inventing a record or dropping existing query parameters',()=>{expect(consumedCreateLink('http://localhost:3000/data/contacts?new=1&q=sample&scope=mine','contacts')).toBe('/data/contacts?q=sample&scope=mine');expect(consumedCreateLink('http://localhost:3000/data/contacts?new=1','contacts')).toBe('/data/contacts');expect(consumedCreateLink('http://localhost:3000/data/contacts?q=sample','contacts','created-id')).toBeNull();});
 it('keeps review requests in their review lane and makes module creation reloadable',()=>{expect(consumedCreateLink('http://localhost:3000/data/reviews?new=1&request_lane=review','work_requests','request-id')).toBe('/data/reviews?request_lane=review&request=request-id');expect(consumedCreateLink('http://localhost:3000/module/documents?new=1&status=proposed','decisions','decision-id')).toBe('/data/decisions?status=proposed&record=decision-id');});
});
