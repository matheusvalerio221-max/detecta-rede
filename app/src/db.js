import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, "detecta.sqlite");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, message_id INTEGER, user_id INTEGER,
  filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, stored TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id INTEGER, user_id INTEGER, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  stored TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, audience TEXT NOT NULL DEFAULT 'ambos', active INTEGER NOT NULL DEFAULT 1,
  create_tasks INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE, ord INTEGER NOT NULL DEFAULT 0,
  section TEXT, text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'yesno', weight REAL NOT NULL DEFAULT 1, required INTEGER NOT NULL DEFAULT 1,
  allow_photo INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES checklist_templates(id), unit_id INTEGER NOT NULL REFERENCES units(id),
  user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'rascunho', score REAL, max_score REAL, pct REAL, notes TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
CREATE TABLE IF NOT EXISTS checklist_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES checklist_runs(id) ON DELETE CASCADE, item_id INTEGER NOT NULL,
  value TEXT, note TEXT, conform INTEGER, UNIQUE(run_id, item_id));
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, category TEXT, audience TEXT NOT NULL DEFAULT 'all',
  mandatory INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, pass_score INTEGER NOT NULL DEFAULT 70, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, ord INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'video', content TEXT, file_id INTEGER, duration_min INTEGER, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, ord INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', correct INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS lesson_progress (user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, done_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS lesson_views (user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 1, first_at TEXT NOT NULL DEFAULT (datetime('now')), last_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS course_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, user_id INTEGER NOT NULL, score INTEGER NOT NULL, passed INTEGER NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS mail_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_email TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT, ref TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, next_at TEXT, sent_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
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
export function migrate() {
  db.exec(SCHEMA);
  // migrações incrementais (idempotentes)
  const cols = all("pragma table_info(users)").map(c => c.name);
  if (!cols.includes("approval")) db.exec("alter table users add column approval TEXT NOT NULL DEFAULT 'aprovado'"); // aprovado | pendente | recusado
  if (!cols.includes("requested_by")) db.exec("alter table users add column requested_by INTEGER");
  const ccols = all("pragma table_info(ticket_categories)").map(c => c.name);
  if (!ccols.includes("sla_unit_hours")) db.exec("alter table ticket_categories add column sla_unit_hours INTEGER NOT NULL DEFAULT 24"); // prazo do franqueado responder
  if (!ccols.includes("active")) db.exec("alter table ticket_categories add column active INTEGER NOT NULL DEFAULT 1");
  if (!ccols.includes("description")) db.exec("alter table ticket_categories add column description TEXT");
  if (get("select count(*) n from ticket_categories").n > 0 && !get("select 1 from ticket_categories where lower(name)=lower('Orçamentos')"))
    run("insert into ticket_categories(name,department,sla_hours,sla_unit_hours) values('Orçamentos','Comercial',8,24)");
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const log = (user_id, unit_id, kind, message, ref = null) =>
  run("insert into activity_log(user_id,unit_id,kind,message,ref) values(?,?,?,?,?)", user_id ?? null, unit_id ?? null, kind, message, ref);
