import {DomainError} from '../lib/context';
export function minor(value:unknown,allowNegative=false):bigint { const v=String(value??'0'); if(!/^-?\d{1,20}$/.test(v)||(!allowNegative&&v.startsWith('-')))throw new DomainError(422,'invalid_money');return BigInt(v); }
export function decimal(value:unknown,scale=6):bigint { const v=String(value??'0');if(!/^\d+(\.\d+)?$/.test(v))throw new DomainError(422,'invalid_decimal');const [whole,fraction='']=v.split('.');if(fraction.length>scale)throw new DomainError(422,'decimal_precision');return BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0')); }
/** Round half away from zero; conversion is performed once on the full original amount. */
export function roundDivide(numerator:bigint,denominator:bigint):bigint {if(denominator<=0n)throw new DomainError(422,'invalid_rate');const sign=numerator<0n?-1n:1n;const n=numerator<0n?-numerator:numerator;return sign*((n+denominator/2n)/denominator);}
export function multiplyQuantity(amount:unknown,quantity:unknown):bigint{return roundDivide(minor(amount)*decimal(quantity),1000000n);}
export function exchange(amount:unknown,rate:unknown,fromDigits=2,toDigits=2):bigint{if(!Number.isInteger(fromDigits)||!Number.isInteger(toDigits)||fromDigits<0||toDigits<0||fromDigits>6||toDigits>6)throw new DomainError(422,'invalid_currency_digits');return roundDivide(minor(amount)*decimal(rate,12)*10n**BigInt(toDigits),1000000000000n*10n**BigInt(fromDigits));}
export function quantityString(value:bigint):string{return `${value/1000000n}.${String(value%1000000n).padStart(6,'0')}`;}
