import { mkdir, readFile, writeFile, readdir, unlink, lstat, realpath } from 'node:fs/promises';
import { resolve, join, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { pool } from './db';
import { getFile } from './storage';

const excluded = new Set(['_prisma_migrations', 'session', 'verification', 'rateLimit', 'roles', 'oauth_states']);
const ident = (name: string) => { if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) throw new Error('Invalid SQL identifier'); return '"' + name + '"'; };
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const sorted = (object: Record<string, unknown>) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
interface SequenceState { lastValue: string; isCalled: boolean }
export interface BackupManifest {
  format: 2; createdAt: string; postgres: string; migrations: Record<string, string>;
  counts: Record<string, number>; files: Record<string, string>; databaseHash: string;
  excluded: string[]; sequences: Record<string, SequenceState>;
  snapshot: { database: string; transactionSnapshot: string; walLsn: string };
}
interface Table { columns: string[]; jsonColumns: Set<string>; binaryColumns:Set<string> }
async function migrationHashes() {
  const result: Record<string, string> = {};
  const entries = (await readdir('prisma/migrations', { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) result[entry.name] = hash(await readFile(join('prisma/migrations', entry.name, 'migration.sql')));
  return result;
}
async function catalog(client: PoolClient) {
  const rows = (await client.query<{ table_name: string; column_name: string; data_type: string }>("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const tables: Record<string, Table> = {};
  for (const row of rows) {
    const table = tables[row.table_name] ??= { columns: [], jsonColumns: new Set(), binaryColumns:new Set() };
    table.columns.push(row.column_name);
    if(row.data_type==='bytea')table.binaryColumns.add(row.column_name);
    if (['json', 'jsonb'].includes(row.data_type)) table.jsonColumns.add(row.column_name);
  }
  return tables;
}
async function sequenceStates(client: PoolClient): Promise<Record<string, SequenceState>> {
  const names = (await client.query<{ sequence_name: string }>("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' ORDER BY sequence_name")).rows;
  const states: Record<string, SequenceState> = {};
  for (const { sequence_name: name } of names) {
    const state = (await client.query<{ last_value: string; is_called: boolean }>(`SELECT last_value::text,is_called FROM ${ident(name)}`)).rows[0];
    states[name] = { lastValue: state.last_value, isCalled: state.is_called };
  }
  return states;
}
async function identity(client: PoolClient) {
  const row = (await client.query<{ database: string; address: string | null; port: number | null; system_identifier?: string }>('SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0];
  try { row.system_identifier = (await client.query<{ system_identifier: string }>('SELECT system_identifier::text FROM pg_control_system()')).rows[0].system_identifier; } catch { /* Managed PostgreSQL may restrict cluster identifiers; endpoint identity is the conservative fallback. */ }
  return row;
}
function keyPath(root: string, key: string) {
  if (!/^[a-f0-9-]+\/[a-f0-9-]+$/.test(key)) throw new Error('Invalid attachment key');
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error('Attachment escapes target');
  return path;
}
async function ensureSafeParent(root: string, path: string) {
  await mkdir(root, { recursive: true }); await mkdir(dirname(path), { recursive: true });
  const actualRoot = await realpath(root), actualParent = await realpath(dirname(path));
  if (actualParent !== actualRoot && !actualParent.startsWith(actualRoot + sep)) throw new Error('Attachment directory escapes target');
}

export async function backup(destination: string): Promise<BackupManifest> {
  const out = resolve(destination); await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) throw new Error('Backup destination must be empty');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query<{ database: string; transactionSnapshot: string; walLsn: string }>('SELECT current_database() AS database,txid_current_snapshot()::text AS "transactionSnapshot",pg_current_wal_lsn()::text AS "walLsn"')).rows[0];
    const cat = await catalog(client), tables: Record<string, Record<string, unknown>[]> = {}, counts: Record<string, number> = {};
    for (const table of Object.keys(cat).sort()) {
      if (excluded.has(table)) continue;
      const rows = (await client.query<Record<string, unknown>>(`SELECT * FROM ${ident(table)}`)).rows;
      tables[table] = rows; counts[table] = rows.length;
    }
    const files: Record<string, string> = {};
    for (const attachment of [...(tables.attachments ?? []),...(tables.file_assistant_files ?? []).filter(file=>!file.deleted_at)]) {
      const key = String(attachment.storage_key), path = keyPath(resolve(out, 'attachments'), key), bytes = await getFile(key);
      if (hash(bytes) !== attachment.sha256) throw new Error('Attachment checksum mismatch');
      await ensureSafeParent(resolve(out, 'attachments'), path); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); files[key] = hash(bytes);
    }
    // Sequence allocation is not transactional. Capture high-water marks after exporting the consistent row snapshot.
    const sequences = await sequenceStates(client), database = JSON.stringify(tables), migrations=await migrationHashes();
    if(cat._prisma_migrations){
      const applied=(await client.query<{migration_name:string;checksum:string}>('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
      if(JSON.stringify(sorted(Object.fromEntries(applied.map(row=>[row.migration_name,row.checksum]))))!==JSON.stringify(sorted(migrations)))throw new Error('Apply all matching migrations before backing up');
    }
    const manifest: BackupManifest = { format: 2, createdAt: new Date().toISOString(), postgres: (await client.query<{ server_version: string }>('SHOW server_version')).rows[0].server_version, migrations, counts, files, databaseHash: hash(database), excluded: [...excluded].sort(), sequences, snapshot };
    await writeFile(join(out, 'database.json'), database, { flag: 'wx', mode: 0o600 });
    await client.query('COMMIT');
    // The manifest is the completion marker. Partial folders without it cannot be restored.
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 }); return manifest;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function restore(source: string, targetUrl: string, attachmentDir: string) {
  const src = resolve(source), dest = resolve(attachmentDir);
  if (src === dest || dest.startsWith(src + sep)) throw new Error('Restore attachments must be outside the backup');
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== 2 || !manifest.sequences || !manifest.snapshot) throw new Error('Unsupported backup format');
  if (JSON.stringify(sorted(manifest.migrations)) !== JSON.stringify(sorted(await migrationHashes()))) throw new Error('Migration versions differ; restore with matching source version.');
  const database = await readFile(join(src, 'database.json'), 'utf8');
  if (hash(database) !== manifest.databaseHash) throw new Error('Database checksum mismatch');
  const tables = JSON.parse(database) as Record<string, Record<string, unknown>[]>;
  const buffers: Record<string, Buffer> = {};
  for (const [key, expected] of Object.entries(manifest.files)) {
    const path = keyPath(resolve(src, 'attachments'), key), bytes = await readFile(path);
    if (hash(bytes) !== expected) throw new Error('Attachment checksum mismatch'); buffers[key] = bytes;
  }
  const storedFiles=[...(tables.attachments ?? []),...(tables.file_assistant_files ?? []).filter(file=>!file.deleted_at)];
  for (const attachment of storedFiles) if (manifest.files[String(attachment.storage_key)] !== attachment.sha256) throw new Error('Attachment manifest is incomplete');
  if (Object.keys(manifest.files).length !== storedFiles.length) throw new Error('Attachment manifest count mismatch');
  const target = new Pool({ connectionString: targetUrl, max: 1 }), client = await target.connect(), sourceClient = await pool.connect();
  const createdPaths: string[] = [];
  let oldSequences: Record<string, SequenceState> = {}, committed = false;
  try {
    const current = await identity(sourceClient), destination = await identity(client);
    const sameCluster = current.system_identifier && destination.system_identifier ? current.system_identifier === destination.system_identifier : current.address === destination.address && current.port === destination.port;
    if (sameCluster && current.database === destination.database) throw new Error('Restore requires a separate empty database.');
    await client.query('BEGIN');
    const cat = await catalog(client), expectedTables = Object.keys(cat).filter(table => !excluded.has(table)).sort();
    if (JSON.stringify(Object.keys(tables).sort()) !== JSON.stringify(expectedTables) || JSON.stringify(Object.keys(manifest.counts).sort()) !== JSON.stringify(expectedTables)) throw new Error('Backup table inventory mismatch');
    for (const table of expectedTables) {
      await client.query(`LOCK TABLE ${ident(table)} IN ACCESS EXCLUSIVE MODE`);
      if ((await client.query<{ count: string }>(`SELECT count(*) FROM ${ident(table)}`)).rows[0].count !== '0') throw new Error('Restore target contains data: ' + table);
    }
    oldSequences = await sequenceStates(client);
    if (JSON.stringify(Object.keys(oldSequences).sort()) !== JSON.stringify(Object.keys(manifest.sequences).sort())) throw new Error('Sequence inventory mismatch');
    const fks = (await client.query<{ table_name: string; conname: string; condeferrable: boolean; condeferred: boolean }>("SELECT cl.relname table_name,co.conname,co.condeferrable,co.condeferred FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE co.contype='f' AND n.nspname='public'")).rows;
    for (const fk of fks) await client.query(`ALTER TABLE ${ident(fk.table_name)} ALTER CONSTRAINT ${ident(fk.conname)} DEFERRABLE INITIALLY DEFERRED`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    // Restore source rows exactly: application insert triggers must not generate new defaults,
    // revisions or history. Internal FK triggers remain active and are checked before commit.
    const triggers = (await client.query<{ table_name: string; name: string; enabled: string }>("SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY($1::text[])", [expectedTables])).rows;
    for (const trigger of triggers) await client.query(`ALTER TABLE ${ident(trigger.table_name)} DISABLE TRIGGER ${ident(trigger.name)}`);
    for (const [table, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows) || rows.length !== manifest.counts[table]) throw new Error('Row count mismatch');
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length !== cat[table].columns.length || columns.some(column => !cat[table].columns.includes(column))) throw new Error('Backup column inventory mismatch');
        const values = columns.map(column => {const value=row[column];if(cat[table].binaryColumns.has(column)&&value!==null){const bytes=value as {type?:string;data?:unknown};if(bytes?.type!=='Buffer'||!Array.isArray(bytes.data)||bytes.data.some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw new Error('Invalid binary backup value');return Buffer.from(bytes.data);}return value===null?null:cat[table].jsonColumns.has(column)?JSON.stringify(value):value;});
        await client.query(`INSERT INTO ${ident(table)}(${columns.map(ident).join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, values);
      }
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    for (const trigger of triggers) {
      const mode = trigger.enabled === 'D' ? 'DISABLE' : trigger.enabled === 'A' ? 'ENABLE ALWAYS' : trigger.enabled === 'R' ? 'ENABLE REPLICA' : 'ENABLE';
      await client.query(`ALTER TABLE ${ident(trigger.table_name)} ${mode} TRIGGER ${ident(trigger.name)}`);
    }
    for (const fk of fks) await client.query(`ALTER TABLE ${ident(fk.table_name)} ALTER CONSTRAINT ${ident(fk.conname)} ${fk.condeferrable ? 'DEFERRABLE ' + (fk.condeferred ? 'INITIALLY DEFERRED' : 'INITIALLY IMMEDIATE') : 'NOT DEFERRABLE'}`);
    for (const [key, bytes] of Object.entries(buffers)) {
      const path = keyPath(dest, key); await ensureSafeParent(dest, path);
      let existing = false;
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || hash(await readFile(path)) !== hash(bytes)) throw new Error('Existing restore attachment differs'); existing = true;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!existing) { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); createdPaths.push(path); }
    }
    for (const [name, state] of Object.entries(manifest.sequences)) {
      if (!/^-?\d+$/.test(state.lastValue) || typeof state.isCalled !== 'boolean') throw new Error('Invalid sequence state');
      await client.query('SELECT setval($1::regclass,$2::bigint,$3)', [name, state.lastValue, state.isCalled]);
    }
    await client.query('COMMIT'); committed = true;
    return { counts: manifest.counts, attachments: Object.keys(buffers).length, sequences: manifest.sequences, snapshot: manifest.snapshot };
  } catch (error) {
    await client.query('ROLLBACK');
    if (!committed) {
      for (const [name, state] of Object.entries(oldSequences)) await client.query('SELECT setval($1::regclass,$2::bigint,$3)', [name, state.lastValue, state.isCalled]);
      for (const path of createdPaths.reverse()) await unlink(path).catch(() => undefined);
    }
    throw error;
  } finally { sourceClient.release(); client.release(); await target.end(); }
}
