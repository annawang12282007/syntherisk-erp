import {handle,body} from '@/lib/http';
import {DomainError} from '@/lib/context';
import {listBoards,readBoard,saveBoard,saveBoardPost,boardHistory,readBoardForPost,changeBoardPostDeletion} from '@/lib/team-boards';
export async function GET(r:Request){return handle(r,async ctx=>{const p=new URL(r.url).searchParams;return p.get('team_id')?(p.get('post_id')?boardHistory(ctx,p.get('team_id')!,p.get('post_id')!):readBoard(ctx,p.get('team_id')!)):p.get('post_id')?readBoardForPost(ctx,p.get('post_id')!):listBoards(ctx);});}
export async function POST(r:Request){return handle(r,async ctx=>{const {action,...data}=await body(r);if(action==='save_team')return saveBoard(ctx,data);if(action==='save_post')return saveBoardPost(ctx,data);if(action==='delete_post'||action==='restore_post')return changeBoardPostDeletion(ctx,data,action==='restore_post');throw new DomainError(422,'INVALID_ACTION');});}
