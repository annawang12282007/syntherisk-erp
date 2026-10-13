import 'dotenv/config';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Client} from 'pg';

// Explicit configuration inventory. All other application tables must be empty
// on the destination. This is a copy, never a cleanup of the source database.
export const configurationTables = new Set([
  'workspaces','user','account','account_security','memberships','companies','brands',
  'company_information','permissions','workspace_roles','departments','department_jobs',
  'employee_assignments','employee_numbers','employee_number_history','operator_configuration',
  'company_teams','company_team_members','team_profiles','user_preferences','workspace_defaults',
  'theme_presets','layout_presets','saved_views','notification_preferences','personal_mail_preferences',
  'signature_profiles','signature_profile_versions','mail_identities','mail_images','communication_templates',
  'accounts','currencies','tax_rates','expense_categories','approval_policies','record_categories',
  'retention_policies','pipelines','pipeline_stages','integration_connections','chat_destinations',
]);
const builtinTables = new Set(['roles','_prisma_migrations']);
const ident = name => {
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw new Error('Invalid identifier');
  return '"'+name+'"';
};
const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
async function migrations(client) {
  const entries = (await readdir('prisma/migrations',{withFileTypes:true})).filter(entry=>entry.isDirectory());
  const expected = {};
  for (const entry of entries) expected[entry.name] = hash(await readFile(join('prisma/migrations',entry.name,'migration.sql')));
  const applied = Object.fromEntries((await client.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(row=>[row.migration_name,row.checksum]));
  if (JSON.stringify(ordered(expected)) !== JSON.stringify(ordered(applied))) throw new Error('Migrations must match source exactly');
  return ordered(expected);
}
async function tableNames(client) {
  return (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
}
export function transformConfiguration(table, rows) {
  return rows.filter(row=>(table!=='approval_policies'||!row.project_id)&&(table!=='retention_policies'||!row.record_id)).map(source=>{
    const row = {...source};
    if (table==='account') {
      // Login identities/password hashes stay; old encrypted login tokens do not.
      for (const key of ['accessToken','refreshToken','idToken','accessTokenExpiresAt','refreshTokenExpiresAt']) row[key]=null;
    }
    if (table==='integration_connections') {
      for (const key of ['calendar_id','drive_id','folder_id','sync_token','last_success_at','last_error','last_access_verified_at']) row[key]=null;
      row.settings={};
      if (row.status==='syncing') row.status='connected';
    }
    if (table==='chat_destinations') {
      row.enabled=false;row.last_success_at=null;row.last_error=null;
    }
    return row;
  });
}
export async function exportConfiguration(destination, sourceUrl=process.env.DATABASE_URL) {
  const client = new Client({connectionString:sourceUrl});await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const migrationHashes=await migrations(client), available=await tableNames(client), tables={};
    for (const table of [...configurationTables].sort()) {
      if (!available.includes(table)) throw new Error('Configuration table missing: '+table);
      tables[table]=transformConfiguration(table,(await client.query(`SELECT * FROM ${ident(table)}`)).rows);
    }
    if (!tables.workspaces.length||!tables.user.length||!tables.companies.length) throw new Error('Required company/access configuration missing');
    const payload=JSON.stringify(tables);
    const document={format:'syntherisk-production-configuration-v1',createdAt:new Date().toISOString(),migrations:migrationHashes,sha256:hash(payload),tables};
    await writeFile(destination,JSON.stringify(document),{flag:'wx',mode:0o600});
    await client.query('COMMIT');
    return {configurationCounts:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length])),businessRowsCopied:0};
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {await client.end();}
}
export async function importConfiguration(source, targetUrl=process.env.DATABASE_URL) {
  const targetName=new URL(targetUrl).pathname.slice(1);
  if (targetName!=='syntherisk'&&!/^syntherisk_releasecheck_[a-f0-9]{32}$/.test(targetName)) throw new Error('Destination is not an isolated production/check database');
  const document=JSON.parse(await readFile(source,'utf8'));
  if(document.format!=='syntherisk-production-configuration-v1'||document.sha256!==hash(JSON.stringify(document.tables))) throw new Error('Configuration package checksum mismatch');
  if(JSON.stringify(Object.keys(document.tables).sort())!==JSON.stringify([...configurationTables].sort())) throw new Error('Unexpected configuration inventory');
  const client=new Client({connectionString:targetUrl});await client.connect();
  try {
    await client.query('BEGIN');
    if(JSON.stringify(await migrations(client))!==JSON.stringify(ordered(document.migrations))) throw new Error('Configuration migration mismatch');
    const tables=(await tableNames(client)).filter(table=>!builtinTables.has(table));
    for (const table of tables) {
      await client.query(`LOCK TABLE ${ident(table)} IN ACCESS EXCLUSIVE MODE`);
      if((await client.query(`SELECT 1 FROM ${ident(table)} LIMIT 1`)).rowCount) throw new Error('Destination must be empty: '+table);
    }
    const foreignKeys=(await client.query("SELECT c.relname AS table_name,f.conname,f.condeferrable,f.condeferred FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE f.contype='f' AND n.nspname='public'")).rows;
    for(const fk of foreignKeys) await client.query(`ALTER TABLE ${ident(fk.table_name)} ALTER CONSTRAINT ${ident(fk.conname)} DEFERRABLE INITIALLY DEFERRED`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const triggers=(await client.query("SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")).rows;
    for(const trigger of triggers) await client.query(`ALTER TABLE ${ident(trigger.table_name)} DISABLE TRIGGER ${ident(trigger.name)}`);
    for(const [table,rows] of Object.entries(document.tables)) {
      const columns=(await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table])).rows;
      const names=columns.map(column=>column.column_name);
      for(const row of rows) {
        if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify([...names].sort())) throw new Error('Column inventory mismatch: '+table);
        const values=columns.map(({column_name:name,data_type:type})=>{
          const value=row[name];
          if(value===null) return null;
          if(type==='bytea') {
            if(value.type!=='Buffer'||!Array.isArray(value.data)||value.data.some(byte=>!Number.isInteger(byte)||byte<0||byte>255)) throw new Error('Invalid binary configuration');
            return Buffer.from(value.data);
          }
          return ['json','jsonb'].includes(type)?JSON.stringify(value):value;
        });
        await client.query(`INSERT INTO ${ident(table)}(${names.map(ident).join(',')}) VALUES(${names.map((_,i)=>'$'+(i+1)).join(',')})`,values);
      }
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    for(const trigger of triggers) {
      const mode=trigger.enabled==='D'?'DISABLE':trigger.enabled==='A'?'ENABLE ALWAYS':trigger.enabled==='R'?'ENABLE REPLICA':'ENABLE';
      await client.query(`ALTER TABLE ${ident(trigger.table_name)} ${mode} TRIGGER ${ident(trigger.name)}`);
    }
    for(const fk of foreignKeys) await client.query(`ALTER TABLE ${ident(fk.table_name)} ALTER CONSTRAINT ${ident(fk.conname)} ${fk.condeferrable?'DEFERRABLE '+(fk.condeferred?'INITIALLY DEFERRED':'INITIALLY IMMEDIATE'):'NOT DEFERRABLE'}`);
    let emptyBusinessTables=0;
    for(const table of tables) {
      const count=(await client.query(`SELECT count(*)::int AS n FROM ${ident(table)}`)).rows[0].n;
      if(count!==(document.tables[table]?.length??0)) throw new Error('Post-copy count mismatch: '+table);
      if(!configurationTables.has(table)) emptyBusinessTables++;
    }
    await client.query('COMMIT');
    return {configurationTables:configurationTables.size,emptyBusinessTables,accountCount:document.tables.user.length,companyCount:document.tables.companies.length,businessRowsCopied:0};
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action,path]=process.argv.slice(2);
    if(!path||!['export','import'].includes(action)) throw new Error('Use export/import and a private configuration path');
    console.log(JSON.stringify(await (action==='export'?exportConfiguration(path):importConfiguration(path))));
  } catch(error) {
    // SQL error details can contain row values, hashes and tokens.
    console.error(JSON.stringify({configurationTransfer:'failed',code:error.code??error.name}));process.exitCode=1;
  }
}
