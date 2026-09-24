import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, "detecta.sqlite");
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, city TEXT, state TEXT DEFAULT 'SP', franchisee TEXT, phone TEXT, email TEXT, cnpj TEXT,
  status TEXT NOT NULL DEFAULT 'ativa', is_hq INTEGER NOT NULL DEFAULT 0, opened_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS roles (key TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'unit', perms TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role_key TEXT NOT NULL REFERENCES roles(key),
  unit_id INTEGER REFERENCES units(id), active INTEGER NOT NULL DEFAULT 1, last_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS login_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, ip TEXT, ok INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS ticket_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, department TEXT NOT NULL, sla_hours INTEGER NOT NULL DEFAULT 8);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, unit_id INTEGER NOT NULL REFERENCES units(id), category_id INTEGER REFERENCES ticket_categories(id),
  priority TEXT NOT NULL DEFAULT 'media', status TEXT NOT NULL DEFAULT 'aberto', created_by INTEGER, assigned_to INTEGER, sla_due TEXT, resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, user_id INTEGER, body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, author_id INTEGER, audience TEXT NOT NULL DEFAULT 'all',
  unit_ids TEXT NOT NULL DEFAULT '[]', requires_ack INTEGER NOT NULL DEFAULT 1, published_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS communication_reads (
  communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (communication_id, user_id));
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT, unit_id INTEGER,
  assigned_to INTEGER, created_by INTEGER, priority TEXT NOT NULL DEFAULT 'media', status TEXT NOT NULL DEFAULT 'aberta', due_date TEXT, done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, unit_id INTEGER, kind TEXT NOT NULL, message TEXT NOT NULL, ref TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_tickets_unit ON tickets(unit_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at DESC);
`;
export function migrate() { db.exec(SCHEMA); }

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const log = (user_id, unit_id, kind, message, ref = null) =>
  run("insert into activity_log(user_id,unit_id,kind,message,ref) values(?,?,?,?,?)", user_id ?? null, unit_id ?? null, kind, message, ref);
