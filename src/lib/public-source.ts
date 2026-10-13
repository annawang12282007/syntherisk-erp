const defaultSource='https://github.com/annawang12282007/syntherisk-erp';
function publicUrl(value:string|undefined,fallback:string){
 if(!value)return fallback;
 try{const parsed=new URL(value);return ['https:','http:'].includes(parsed.protocol)?parsed.toString():fallback;}catch{return fallback;}
}
export const publicSourceUrl=publicUrl(process.env.NEXT_PUBLIC_SOURCE_URL,defaultSource);
export const publicLicenseUrl=publicUrl(process.env.NEXT_PUBLIC_LICENSE_URL,`${defaultSource}/blob/main/LICENSE`);
