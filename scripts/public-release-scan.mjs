import {execFileSync} from 'node:child_process';
import {lstat,readdir,readFile} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const generated=new Set(['.git','node_modules','.venv','.next','data','work','backups','coverage','test-results','playwright-report']);
const textExtensions=/\.(?:[cm]?[jt]sx?|json|ya?ml|toml|md|txt|csv|sql|prisma|css|svg|sh|py|example)$/i;
const secretRules=[
  ['private-key',/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['provider-key',/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{30,}|GOCSPX-[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/],
];

export function excludedReleasePath(path){
  const parts=path.replaceAll('\\','/').split('/'),name=parts.at(-1);
  return parts.some(part=>generated.has(part)) || parts.includes('qa') && parts.includes('docs')
    || /^\.env(?:\.|$)/.test(name) && name!=='.env.example'
    || /\.(?:pem|key|p12|pfx|dump|zip|tar|tar\.gz|sql\.gz|tsbuildinfo|log)$/i.test(name)
    || /(?:client_secret.*|.*credentials.*|.*runtime|.*configuration-export.*|.*production-configuration.*)\.json$/i.test(name);
}

/** Return locations/categories only. Never return matched credential or personal values. */
export function inspectReleaseText(path,text,{privateMarkers=[]}={}){
  const markers=[...new Set(privateMarkers.map(value=>value.trim().toLowerCase()).filter(Boolean))];
  const findings=[];
  for(const [index,line] of text.split(/\r?\n/).entries()){
    const add=kind=>findings.push({path,line:index+1,kind});
    for(const [kind,pattern] of secretRules)if(pattern.test(line))add(kind);
    if(markers.some(marker=>line.toLowerCase().includes(marker)))add('private-release-marker');
    if(/(?:[A-Za-z]:[\\/]Users[\\/][^\\/\s]+|\/home\/[^/\s]+\/)/i.test(line))add('personal-filesystem-path');
    // Credential-bearing connection URLs must contain a placeholder or generated interpolation.
    for(const match of line.matchAll(/(?:postgres(?:ql)?|mysql|redis|https?):\/\/([^\s'"`<>]+)@/g)){
      const credentials=match[1],colon=credentials.indexOf(':');
      if(colon<0)continue;
      const password=credentials.slice(colon+1);
      if(password && !/[${}\[\]]/.test(password) && !/^(?:secret|password|test|fixture|example|changeme|change-me|replace[-_].*|generate[-_].*)$/i.test(password))add('embedded-connection-credential');
    }
  }
  return findings;
}

async function filesystemCandidates(root,directory=root){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const absolute=join(directory,entry.name),path=relative(root,absolute).replaceAll('\\','/');
    if(excludedReleasePath(path))continue;
    if(entry.isSymbolicLink()){result.push({path,issue:'symbolic-link'});continue;}
    if(entry.isDirectory())result.push(...await filesystemCandidates(root,absolute));
    else if(entry.isFile())result.push({path});
  }
  return result;
}

export async function scanPublicRelease(root,{staged=false,privateMarkers=(process.env.PRIVATE_RELEASE_MARKERS??'').split(/\r?\n/)}={}){
  root=resolve(root);let entries;
  if(staged){
    const top=execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
    if(resolve(top)!==root)throw new Error('Initialize an independent repository at the release root before scanning its index.');
    entries=execFileSync('git',['-C',root,'ls-files','--stage','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).map(line=>{
      const tab=line.indexOf('\t'),metadata=line.slice(0,tab).split(' ');
      return {path:line.slice(tab+1),issue:metadata[0]==='120000'?'symbolic-link':metadata[0]==='160000'?'git-submodule':undefined};
    });
  }else entries=await filesystemCandidates(root);
  const findings=[];
  for(const entry of entries){
    const {path}=entry;
    if(entry.issue){findings.push({path,kind:entry.issue});continue;}
    if(excludedReleasePath(path)){findings.push({path,kind:'private-generated-file'});continue;}
    if(!textExtensions.test(path)&&!['Dockerfile','.gitignore','.dockerignore'].includes(path))continue;
    let text;
    if(staged)text=execFileSync('git',['-C',root,'show',':'+path],{encoding:'utf8',maxBuffer:20_000_000});
    else {
      const absolute=resolve(root,path),metadata=await lstat(absolute);
      if(metadata.isSymbolicLink()){findings.push({path,kind:'symbolic-link'});continue;}
      if(metadata.size>20_000_000){findings.push({path,kind:'oversized-text-requires-review'});continue;}
      text=await readFile(absolute,'utf8');
    }
    findings.push(...inspectReleaseText(path,text,{privateMarkers}));
  }
  return {mode:staged?'git-index':'filesystem-candidates',files:entries.length,findings};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const result=await scanPublicRelease(resolve(dirname(fileURLToPath(import.meta.url)),'..'),{staged:process.argv.includes('--staged')});
    console.log(JSON.stringify(result,null,2));
    if(result.findings.length)process.exitCode=1;
  }catch(error){console.error('Public-release scan failed: '+error.name);process.exitCode=1;}
}
