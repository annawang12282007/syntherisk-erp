import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const bundled=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
const python=process.env.QA_PYTHON||(existsSync(bundled)?bundled:process.platform==='win32'?'python':'python3');
/** Independent readers, never the application ZIP/XML code. Requires openpyxl and pypdf. */
export function readWorkbook(bytes:Buffer):{names:string[];sheets:Record<string,{values:unknown[][];types:string[][]}>}{
 const source="import sys,base64,io,json,zipfile,openpyxl\nb=base64.b64decode(sys.stdin.read())\nz=zipfile.ZipFile(io.BytesIO(b))\nassert z.testzip() is None\nw=openpyxl.load_workbook(io.BytesIO(b),data_only=False)\nprint(json.dumps({'names':w.sheetnames,'sheets':{s.title:{'values':[[c.value for c in row] for row in s.iter_rows()],'types':[[c.data_type for c in row] for row in s.iter_rows()]} for s in w}},ensure_ascii=True))";
 return JSON.parse(execFileSync(python,['-c',source],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:20_000_000}));
}
export function readPdf(bytes:Buffer):{pages:number;text:string;pageTexts:string[]}{
 const source="import sys,base64,io,json,pypdf\nr=pypdf.PdfReader(io.BytesIO(base64.b64decode(sys.stdin.read())))\nt=[p.extract_text() for p in r.pages]\nprint(json.dumps({'pages':len(r.pages),'text':'\\n'.join(t),'pageTexts':t},ensure_ascii=True))";
 return JSON.parse(execFileSync(python,['-c',source],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:20_000_000}));
}
