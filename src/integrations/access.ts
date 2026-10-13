import {type Context} from '../lib/context';
import {isExternal,permissionScope} from '../domain/core';
export function canUseGoogle(ctx:Context){if(isExternal(ctx))return false;const policy=permissionScope(ctx,'google_integrations','connect');return policy===undefined||policy!=='none';}
