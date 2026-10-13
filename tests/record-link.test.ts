import {describe,it,expect} from 'vitest';
import {closedRecordLink} from '../src/components/record-link';
describe('closing search and notification record links',()=>{
 it('consumes modal state but retains list context and fragments',()=>{
  expect(closedRecordLink('http://localhost:3000/data/delegations?record=abc&assignment_view=all&tab=workflow#items')).toBe('/data/delegations?assignment_view=all#items');
  expect(closedRecordLink('http://localhost:3000/data/reviews?request=xyz&request_lane=review')).toBe('/data/reviews?request_lane=review');
  expect(closedRecordLink('http://localhost:3000/data/tasks?q=hello')).toBeNull();
 });
});
