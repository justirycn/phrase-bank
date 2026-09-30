// Executed inside the existing production container before replacing it.
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = '/app/data';
const database = '/app/data/phrase-bank.sqlite';
const directory = '/app/data/deployment-backups';
const isRegularDirectory = (path) => { const item = lstatSync(path); return item.isDirectory() && !item.isSymbolicLink(); };
if (!isRegularDirectory(root)) throw new Error('Unexpected data volume path');
const source = lstatSync(database);
if (!source.isFile() || source.isSymbolicLink()) throw new Error('Unexpected database file');
if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
if (!isRegularDirectory(directory)) throw new Error('Unexpected backup directory');
const name = `before-deploy-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`;
const destination = `${directory}/${name}`;
if (!/^before-deploy-[0-9TZ.-]+-[0-9a-f-]+\.sqlite$/.test(name) || existsSync(destination)) throw new Error('Invalid backup destination');
const db = new DatabaseSync(database, { readOnly: true });
try { db.exec(`VACUUM INTO '${destination}'`); } finally { db.close(); }
chmodSync(destination, 0o600);
const backup = new DatabaseSync(destination, { readOnly: true });
try {
  if (backup.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Database backup verification failed');
} finally { backup.close(); }
console.log(JSON.stringify({ backup: 'verified', file: name, bytes: statSync(destination).size }));
