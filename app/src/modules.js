/* Fase 2 — Checklist de campo, Universidade Corporativa e arquivos genéricos */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { all, get, run, log, UPLOAD_DIR } from "./db.js";
import { HttpError } from "./server.js";
import { isNetwork } from "./auth.js";
import { route, need, bad, scoped } from "./routes.js";
import { enqueue, layout, recipients } from "./mail.js";
const E = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const net = (ctx) => isNetwork(ctx.user);
const onlyHQ = (ctx, msg = "Apenas a franqueadora pode fazer isso.") => { if (!net(ctx)) throw new HttpError(403, msg); };
const J = (s, d = []) => { if (Array.isArray(s) || (s && typeof s === "object")) return s; try { return JSON.parse(s ?? "") ?? d; } catch { return d; } };
const int = (v, d = 0) => Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d;
const num = (v, d = 0) => Number.isFinite(parseFloat(v)) ? parseFloat(v) : d;

/* =====================================================================
   Arquivos genéricos (fotos de checklist, PDFs de aula)
   kind: "answer" (ref = checklist_answers.id) | "lesson" (ref = lessons.id ou null enquanto rascunho)
   ===================================================================== */
const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf" };
const ALLOWED_LESSON = { ...ALLOWED, "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "audio/mpeg": ".mp3",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx", "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", "application/vnd.ms-excel": ".xls", "application/octet-stream": "" };
const EXT_MIME = { pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel" };
function fileAccess(ctx, f) {
  if (f.kind === "answer") {
    const r = get("select r.unit_id from checklist_answers a join checklist_runs r on r.id=a.run_id where a.id=?", f.ref_id);
    if (!r) throw new HttpError(404, "Arquivo órfão."); scoped(ctx, r.unit_id);
  } else if (f.kind === "lesson") { need(ctx, "university", 0); }
  else throw new HttpError(403, "Sem acesso.");
}
route("POST", "/files", (ctx) => {
  const kind = ctx.query.kind; if (!["answer", "lesson"].includes(kind)) bad("Tipo de arquivo inválido.");
  let mime = (ctx.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const allowed = kind === "lesson" ? ALLOWED_LESSON : ALLOWED;
  const extOf = decodeURIComponent(ctx.query.filename || "").split(".").pop().toLowerCase();
  if (kind === "lesson" && (mime === "application/octet-stream" || !mime) && EXT_MIME[extOf]) mime = EXT_MIME[extOf]; // navegador sem tipo: deduz pela extensão
  if (!allowed[mime] || (kind === "lesson" && mime === "application/octet-stream")) bad(kind === "lesson" ? "Formato não aceito. Envie vídeo (MP4/WEBM/MOV), áudio MP3, PDF, imagem, PowerPoint, Word ou Excel." : "Envie imagem (JPG, PNG, WEBP, GIF) ou PDF.");
  if (!ctx.rawFile?.size) bad("Arquivo vazio.");
  const ref = ctx.query.ref ? int(ctx.query.ref) : null;
  if (kind === "answer") { need(ctx, "checklist", 1); if (ctx.rawFile.size > 12e6) bad("Foto muito grande (máx. 10 MB)."); const r = get("select r.unit_id, r.status from checklist_answers a join checklist_runs r on r.id=a.run_id where a.id=?", ref); if (!r) bad("Resposta não encontrada."); scoped(ctx, r.unit_id); if (r.status !== "rascunho") bad("Checklist já concluído."); }
  if (kind === "lesson") { need(ctx, "university", 1); onlyHQ(ctx); }
  const filename = decodeURIComponent(ctx.query.filename || "arquivo").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const stored = crypto.randomUUID() + (allowed[mime] || ("." + extOf));
  fs.copyFileSync(ctx.rawFile.path, path.join(UPLOAD_DIR, stored));
  const r = run("insert into files(kind,ref_id,user_id,filename,mime,size,stored) values(?,?,?,?,?,?,?)", kind, ref, ctx.user.id, filename, mime, ctx.rawFile.size, stored);
  return get("select id,kind,ref_id,filename,mime,size,created_at from files where id=?", r.lastInsertRowid);
}, { raw: true, stream: true, max: 2.2e9 });
route("GET", "/files/:id", (ctx) => {
  const f = get("select * from files where id=?", ctx.params.id); if (!f) throw new HttpError(404, "Arquivo não encontrado.");
  fileAccess(ctx, f);
  const p = path.join(UPLOAD_DIR, f.stored); if (!fs.existsSync(p)) throw new HttpError(404, "Arquivo não encontrado no servidor.");
  return { __file: p, mime: f.mime, filename: f.filename, inline: ctx.query.dl === undefined };
});
route("DELETE", "/files/:id", (ctx) => {
  const f = get("select * from files where id=?", ctx.params.id); if (!f) throw new HttpError(404, "Arquivo não encontrado.");
  fileAccess(ctx, f); if (f.user_id !== ctx.user.id && !net(ctx)) throw new HttpError(403, "Só quem enviou pode remover.");
  run("delete from files where id=?", f.id); try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored)); } catch {}
});

/* =====================================================================
   CHECKLIST
   ===================================================================== */
const ITEM_KINDS = ["yesno", "score", "text"];
const tplWithItems = (id, includeInactive = false) => {
  const t = get("select t.*, u.name created_by_name, (select count(*) from checklist_runs r where r.template_id=t.id) runs from checklist_templates t left join users u on u.id=t.created_by where t.id=?", id);
  if (!t) throw new HttpError(404, "Modelo não encontrado.");
  t.items = all(`select * from checklist_items where template_id=? ${includeInactive ? "" : "and active=1"} order by ord, id`, id);
  return t;
};
route("GET", "/checklists/templates", (ctx) => {
  need(ctx, "checklist", 0);
  const aud = net(ctx) ? "" : " and (audience='ambos' or audience='franqueado')";
  return all(`select t.*, (select count(*) from checklist_items i where i.template_id=t.id and i.active=1) items, (select count(*) from checklist_runs r where r.template_id=t.id) runs
    from checklist_templates t where 1=1 ${ctx.query.all && net(ctx) ? "" : " and active=1" + aud} order by active desc, name`);
});
route("GET", "/checklists/templates/:id", (ctx) => { need(ctx, "checklist", 0); return tplWithItems(ctx.params.id, !!ctx.query.all && net(ctx)); });
function saveItems(templateId, items) {
  const keep = [];
  (items || []).forEach((it, i) => {
    if (!it.text?.trim()) return;
    const kind = ITEM_KINDS.includes(it.kind) ? it.kind : "yesno";
    const v = [i, (it.section || "").trim() || null, it.text.trim(), kind, Math.max(0, num(it.weight, 1)), it.required === false ? 0 : 1, it.allow_photo === false ? 0 : 1];
    if (it.id && get("select 1 from checklist_items where id=? and template_id=?", it.id, templateId)) { run("update checklist_items set ord=?,section=?,text=?,kind=?,weight=?,required=?,allow_photo=?,active=1 where id=?", ...v, it.id); keep.push(it.id); }
    else { const r = run("insert into checklist_items(template_id,ord,section,text,kind,weight,required,allow_photo) values(?,?,?,?,?,?,?,?)", templateId, ...v); keep.push(r.lastInsertRowid); }
  });
  // itens removidos: desativa (respostas antigas continuam íntegras)
  run(`update checklist_items set active=0 where template_id=? ${keep.length ? `and id not in (${keep.map(() => "?").join(",")})` : ""}`, templateId, ...keep);
}
route("POST", "/checklists/templates", (ctx) => {
  need(ctx, "checklist", 1); onlyHQ(ctx, "Apenas a franqueadora cria modelos de checklist."); const b = ctx.body;
  if (!b.name?.trim()) bad("Informe o nome do modelo."); if (!(b.items || []).some(i => i.text?.trim())) bad("Inclua ao menos um item.");
  const r = run("insert into checklist_templates(name,description,audience,create_tasks,created_by) values(?,?,?,?,?)", b.name.trim(), b.description || null, ["consultor", "franqueado", "ambos"].includes(b.audience) ? b.audience : "ambos", b.create_tasks === false ? 0 : 1, ctx.user.id);
  saveItems(r.lastInsertRowid, b.items);
  log(ctx.user.id, null, "checklist", `Modelo de checklist criado: ${b.name.trim()}`);
  return tplWithItems(r.lastInsertRowid);
});
route("PUT", "/checklists/templates/:id", (ctx) => {
  need(ctx, "checklist", 2); onlyHQ(ctx); const b = ctx.body; const t = tplWithItems(ctx.params.id, true);
  if (!b.name?.trim()) bad("Informe o nome do modelo.");
  run("update checklist_templates set name=?,description=?,audience=?,create_tasks=?,active=? where id=?", b.name.trim(), b.description || null, ["consultor", "franqueado", "ambos"].includes(b.audience) ? b.audience : t.audience, b.create_tasks === false ? 0 : 1, b.active === false ? 0 : 1, t.id);
  if (Array.isArray(b.items)) saveItems(t.id, b.items);
  return tplWithItems(t.id);
});

/* --- aplicações (runs) --- */
const scoreOf = (item, value) => { // retorna {score,max,conform} ou null quando não pontua
  if (value === null || value === undefined || value === "" || value === "na") return null;
  if (item.kind === "yesno") { const ok = value === "sim"; return { score: ok ? item.weight : 0, max: item.weight, conform: ok ? 1 : 0 }; }
  if (item.kind === "score") { const n = Math.max(0, Math.min(10, num(value))); return { score: n / 10 * item.weight, max: item.weight, conform: n >= 7 ? 1 : 0 }; }
  return null;
};
function computeRun(runId) {
  const rows = all("select a.*, i.kind, i.weight from checklist_answers a join checklist_items i on i.id=a.item_id where a.run_id=?", runId);
  let score = 0, max = 0;
  for (const a of rows) { const s = scoreOf(a, a.value); run("update checklist_answers set conform=? where id=?", s ? s.conform : null, a.id); if (s) { score += s.score; max += s.max; } }
  const pct = max ? Math.round(score / max * 1000) / 10 : null;
  run("update checklist_runs set score=?,max_score=?,pct=? where id=?", score, max, pct, runId);
  return { score, max, pct };
}
const runFull = (ctx, id) => {
  const r = get(`select r.*, t.name template_name, t.description template_description, t.create_tasks, un.name unit_name, u.name user_name
    from checklist_runs r join checklist_templates t on t.id=r.template_id join units un on un.id=r.unit_id left join users u on u.id=r.user_id where r.id=?`, id);
  if (!r) throw new HttpError(404, "Checklist não encontrado."); scoped(ctx, r.unit_id);
  r.items = all(`select i.*, a.id answer_id, a.value, a.note, a.conform from checklist_items i left join checklist_answers a on a.item_id=i.id and a.run_id=?
    where i.template_id=? and (i.active=1 or a.id is not null) order by i.ord, i.id`, r.id, r.template_id);
  const files = all("select id, ref_id, filename, mime, size from files where kind='answer' and ref_id in (select id from checklist_answers where run_id=?)", r.id);
  for (const it of r.items) it.files = files.filter(f => f.ref_id === it.answer_id);
  r.tasks = all("select id,title,status,due_date from tasks where source='checklist' and source_ref=?", `run:${r.id}`);
  return r;
};
route("GET", "/checklists/runs", (ctx) => {
  need(ctx, "checklist", 0); const w = [], v = [];
  if (!net(ctx)) { w.push("r.unit_id=?"); v.push(ctx.user.unit_id); }
  if (ctx.query.unit_id) { w.push("r.unit_id=?"); v.push(int(ctx.query.unit_id)); }
  if (ctx.query.template_id) { w.push("r.template_id=?"); v.push(int(ctx.query.template_id)); }
  return all(`select r.*, t.name template_name, un.name unit_name, u.name user_name,
    (select count(*) from checklist_answers a where a.run_id=r.id and a.conform=0) nonconform
    from checklist_runs r join checklist_templates t on t.id=r.template_id join units un on un.id=r.unit_id left join users u on u.id=r.user_id
    ${w.length ? "where " + w.join(" and ") : ""} order by (r.status='rascunho') desc, coalesce(r.finished_at, r.started_at) desc limit 300`, ...v);
});
route("GET", "/checklists/runs/:id", (ctx) => { need(ctx, "checklist", 0); return runFull(ctx, ctx.params.id); });
route("POST", "/checklists/runs", (ctx) => {
  need(ctx, "checklist", 1); const b = ctx.body;
  const t = get("select * from checklist_templates where id=? and active=1", b.template_id); if (!t) bad("Modelo inválido ou inativo.");
  if (!net(ctx) && t.audience === "consultor") throw new HttpError(403, "Este checklist é aplicado pela franqueadora.");
  const unit_id = net(ctx) ? int(b.unit_id) : ctx.user.unit_id; if (!unit_id || !get("select 1 from units where id=?", unit_id)) bad("Informe a unidade.");
  const r = run("insert into checklist_runs(template_id,unit_id,user_id) values(?,?,?)", t.id, unit_id, ctx.user.id);
  for (const it of all("select id from checklist_items where template_id=? and active=1", t.id)) run("insert into checklist_answers(run_id,item_id) values(?,?)", r.lastInsertRowid, it.id);
  log(ctx.user.id, unit_id, "checklist", `Checklist "${t.name}" iniciado`, `run:${r.lastInsertRowid}`);
  return runFull(ctx, r.lastInsertRowid);
});
route("PUT", "/checklists/runs/:id", (ctx) => { // salva respostas (rascunho)
  need(ctx, "checklist", 1); const r = get("select * from checklist_runs where id=?", ctx.params.id); if (!r) throw new HttpError(404, "Checklist não encontrado."); scoped(ctx, r.unit_id);
  if (r.status !== "rascunho") bad("Checklist já concluído.");
  if (!net(ctx) && r.user_id !== ctx.user.id) need(ctx, "checklist", 2); // outro usuário da unidade só com permissão de editar
  for (const a of ctx.body.answers || []) {
    const ex = get("select a.id from checklist_answers a where a.run_id=? and a.item_id=?", r.id, a.item_id); if (!ex) continue;
    run("update checklist_answers set value=?, note=? where id=?", a.value === undefined || a.value === null ? null : String(a.value), a.note?.trim() || null, ex.id);
  }
  if (ctx.body.notes !== undefined) run("update checklist_runs set notes=? where id=?", ctx.body.notes || null, r.id);
  computeRun(r.id); return runFull(ctx, r.id);
});
route("POST", "/checklists/runs/:id/finish", (ctx) => {
  need(ctx, "checklist", 1); const r = runFull(ctx, ctx.params.id); if (r.status !== "rascunho") bad("Checklist já concluído.");
  const missing = r.items.filter(i => i.required && i.active && (i.value === null || i.value === "")); if (missing.length) bad(`Responda os itens obrigatórios (${missing.length} pendente${missing.length > 1 ? "s" : ""}).`);
  const s = computeRun(r.id);
  run("update checklist_runs set status='concluido', finished_at=datetime('now') where id=?", r.id);
  let created = 0;
  if (r.create_tasks && ctx.body.create_tasks !== false) {
    const owner = get("select id from users where unit_id=? and role_key='franqueado' and active=1 order by id limit 1", r.unit_id)?.id || ctx.user.id;
    for (const it of r.items.filter(i => i.conform === 0)) {
      run("insert into tasks(title,description,source,source_ref,unit_id,assigned_to,created_by,priority,due_date) values(?,?,?,?,?,?,?,?,date('now','+7 days'))",
        `Plano de ação: ${it.text}`.slice(0, 140), `Item não conforme no checklist "${r.template_name}" (${it.section ? it.section + " · " : ""}resposta: ${it.value}${it.note ? " · obs.: " + it.note : ""}).`, "checklist", `run:${r.id}`, r.unit_id, owner, ctx.user.id, "alta");
      created++;
    }
  }
  log(ctx.user.id, r.unit_id, "checklist", `Checklist "${r.template_name}" concluído: ${s.pct ?? "—"}%${created ? ` · ${created} tarefa(s) de plano de ação` : ""}`, `run:${r.id}`);
  return { ...runFull(ctx, r.id), tasks_created: created };
});
route("DELETE", "/checklists/runs/:id", (ctx) => {
  need(ctx, "checklist", 1); const r = get("select * from checklist_runs where id=?", ctx.params.id); if (!r) throw new HttpError(404, "Checklist não encontrado."); scoped(ctx, r.unit_id);
  if (r.status !== "rascunho") { need(ctx, "checklist", 3); }
  else if (r.user_id !== ctx.user.id) need(ctx, "checklist", 2);
  for (const f of all("select * from files where kind='answer' and ref_id in (select id from checklist_answers where run_id=?)", r.id)) { run("delete from files where id=?", f.id); try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored)); } catch {} }
  run("delete from checklist_answers where run_id=?", r.id); run("delete from checklist_runs where id=?", r.id);
});
route("GET", "/checklists/summary", (ctx) => { // evolução por unidade
  need(ctx, "checklist", 0); const w = net(ctx) ? "" : "where r.unit_id=" + Number(ctx.user.unit_id);
  return {
    byUnit: all(`select un.id unit_id, un.name unit_name, count(*) runs, round(avg(r.pct),1) avg_pct, max(r.finished_at) last_at,
      (select round(pct,1) from checklist_runs x where x.unit_id=un.id and x.status='concluido' order by finished_at desc limit 1) last_pct
      from checklist_runs r join units un on un.id=r.unit_id ${w ? w + " and" : "where"} r.status='concluido' group by un.id order by un.name`),
    recent: all(`select r.id, r.pct, r.finished_at, t.name template_name, un.name unit_name from checklist_runs r join checklist_templates t on t.id=r.template_id join units un on un.id=r.unit_id ${w ? w + " and" : "where"} r.status='concluido' order by r.finished_at desc limit 20`),
  };
});

/* =====================================================================
   UNIVERSIDADE
   ===================================================================== */
const LESSON_KINDS = ["video", "text", "pdf", "link"];
const audienceOk = (c, u) => c.audience === "all" || (c.audience === "franqueado" && u.role_key === "franqueado") || (c.audience === "tecnico" && u.role_key === "tecnico") || (c.audience === "unidade" && u.unit_id) || (c.audience === "franqueadora" && !u.unit_id)
  || (c.audience === "units" && !!u.unit_id && J(c.unit_ids).map(Number).includes(Number(u.unit_id)));
const embedUrl = (url = "") => { // YouTube / Vimeo → iframe src; outros: null
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/); if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/); if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
};
function courseFull(ctx, id, forEdit = false) {
  const c = get("select c.*, u.name created_by_name from courses c left join users u on u.id=c.created_by where c.id=?", id); if (!c) throw new HttpError(404, "Curso não encontrado.");
  if (!forEdit && !net(ctx) && (!c.active || !audienceOk(c, ctx.user))) throw new HttpError(403, "Curso não disponível para o seu perfil.");
  c.unit_ids = J(c.unit_ids);
  c.lessons = all(`select l.*, f.filename file_name, f.mime file_mime from lessons l left join files f on f.id=l.file_id where l.course_id=? ${forEdit ? "" : "and l.active=1"} order by l.ord, l.id`, id)
    .map(l => ({ ...l, embed: l.kind === "video" ? embedUrl(l.content || "") : null }));
  const done = new Set(all("select lesson_id from lesson_progress where user_id=?", ctx.user.id).map(x => x.lesson_id));
  c.lessons.forEach(l => l.done = done.has(l.id));
  c.questions = all(`select id, ord, text, options ${forEdit ? ", correct" : ""} from quiz_questions where course_id=? and active=1 order by ord, id`, id).map(q => ({ ...q, options: J(q.options) }));
  c.best = get("select max(score) score, max(passed) passed, count(*) attempts from course_results where course_id=? and user_id=?", id, ctx.user.id);
  const total = c.lessons.length, doneN = c.lessons.filter(l => l.done).length;
  c.progress = { total, done: doneN, pct: total ? Math.round(doneN / total * 100) : 0, quiz_required: c.questions.length > 0, passed: !!c.best?.passed, completed: total > 0 && doneN === total && (c.questions.length === 0 || !!c.best?.passed) };
  return c;
}
route("GET", "/courses", (ctx) => {
  need(ctx, "university", 0); const u = ctx.user;
  const list = all(`select c.*, (select count(*) from lessons l where l.course_id=c.id and l.active=1) lessons, (select count(*) from quiz_questions q where q.course_id=c.id and q.active=1) questions,
    (select count(*) from lesson_progress p join lessons l on l.id=p.lesson_id where l.course_id=c.id and l.active=1 and p.user_id=?) done,
    (select max(passed) from course_results r where r.course_id=c.id and r.user_id=?) passed
    from courses c ${ctx.query.all && net(ctx) ? "" : "where c.active=1"} order by c.mandatory desc, c.category, c.title`, u.id, u.id);
  return list.filter(c => (ctx.query.all && net(ctx)) || audienceOk(c, u)).map(c => ({ ...c, unit_ids: J(c.unit_ids), pct: c.lessons ? Math.round(c.done / c.lessons * 100) : 0, completed: c.lessons > 0 && c.done === c.lessons && (c.questions === 0 || !!c.passed) }));
});
route("GET", "/courses/report", (ctx) => { // franqueadora: situação por usuário
  need(ctx, "university", 2); onlyHQ(ctx);
  const courses = all("select * from courses where active=1 order by mandatory desc, title");
  const users = all("select u.id,u.name,u.role_key,u.unit_id,un.name unit_name from users u left join units un on un.id=u.unit_id where u.active=1 and u.approval='aprovado' order by un.name, u.name");
  const lessons = all("select id, course_id from lessons where active=1"); const prog = all("select user_id, lesson_id from lesson_progress"); const res = all("select course_id, user_id, max(passed) passed, max(score) score from course_results group by course_id, user_id");
  const qn = Object.fromEntries(all("select course_id, count(*) n from quiz_questions where active=1 group by course_id").map(x => [x.course_id, x.n]));
  const views = all("select v.*, l.title lesson_title, l.course_id, c.title course_title, c.category from lesson_views v join lessons l on l.id=v.lesson_id join courses c on c.id=l.course_id order by v.last_at desc, v.rowid desc");
  const rows = [], folders = [];
  for (const u of users) {
    const mine = courses.filter(c => audienceOk(c, u)); const perFolder = {};
    for (const c of mine) {
      const ls = lessons.filter(l => l.course_id === c.id); const done = ls.filter(l => prog.some(p => p.user_id === u.id && p.lesson_id === l.id)).length;
      const r = res.find(x => x.course_id === c.id && x.user_id === u.id); const lv = views.find(v => v.user_id === u.id && v.course_id === c.id);
      const row = { user_id: u.id, user_name: u.name, role_key: u.role_key, unit_name: u.unit_name, course_id: c.id, course_title: c.title, category: c.category || "Geral", mandatory: c.mandatory, lessons: ls.length, done, pct: ls.length ? Math.round(done / ls.length * 100) : 0, quiz: !!qn[c.id], passed: !!r?.passed, score: r?.score ?? null, completed: ls.length > 0 && done === ls.length && (!qn[c.id] || !!r?.passed), last_lesson: lv?.lesson_title || null, last_at: lv?.last_at || null, started: !!lv || done > 0 };
      rows.push(row);
      const f = (perFolder[row.category] ||= { user_id: u.id, user_name: u.name, unit_name: u.unit_name, category: row.category, courses: 0, courses_done: 0, lessons: 0, done: 0, last_at: null, last_where: null });
      f.courses++; if (row.completed) f.courses_done++; f.lessons += ls.length; f.done += done;
      if (lv && (!f.last_at || lv.last_at > f.last_at)) { f.last_at = lv.last_at; f.last_where = `${c.title} › ${lv.lesson_title}`; }
    }
    for (const f of Object.values(perFolder)) folders.push({ ...f, pct: f.lessons ? Math.round(f.done / f.lessons * 100) : 0 });
    const last = views.find(v => v.user_id === u.id);
    u.last_at = last?.last_at || null; u.last_where = last ? `${last.category || "Geral"} › ${last.course_title} › ${last.lesson_title}` : null;
  }
  return { courses, rows, folders, users };
});
route("GET", "/courses/:id", (ctx) => { need(ctx, "university", 0); return courseFull(ctx, ctx.params.id, !!ctx.query.edit && net(ctx)); });
function saveLessons(courseId, lessons) {
  const keep = [];
  (lessons || []).forEach((l, i) => {
    if (!l.title?.trim()) return; const kind = LESSON_KINDS.includes(l.kind) ? l.kind : "text";
    const v = [i, l.title.trim(), kind, (l.content || "").trim() || null, l.file_id ? int(l.file_id) : null, l.duration_min ? int(l.duration_min) : null];
    if (l.id && get("select 1 from lessons where id=? and course_id=?", l.id, courseId)) { run("update lessons set ord=?,title=?,kind=?,content=?,file_id=?,duration_min=?,active=1 where id=?", ...v, l.id); keep.push(l.id); }
    else { const r = run("insert into lessons(course_id,ord,title,kind,content,file_id,duration_min) values(?,?,?,?,?,?,?)", courseId, ...v); keep.push(r.lastInsertRowid); if (v[4]) run("update files set ref_id=? where id=? and kind='lesson'", r.lastInsertRowid, v[4]); }
  });
  run(`update lessons set active=0 where course_id=? ${keep.length ? `and id not in (${keep.map(() => "?").join(",")})` : ""}`, courseId, ...keep);
}
function saveQuestions(courseId, questions) {
  const keep = [];
  (questions || []).forEach((q, i) => {
    const opts = (q.options || []).map(o => String(o).trim()).filter(Boolean); if (!q.text?.trim() || opts.length < 2) return;
    const correct = Math.max(0, Math.min(opts.length - 1, int(q.correct)));
    if (q.id && get("select 1 from quiz_questions where id=? and course_id=?", q.id, courseId)) { run("update quiz_questions set ord=?,text=?,options=?,correct=?,active=1 where id=?", i, q.text.trim(), JSON.stringify(opts), correct, q.id); keep.push(q.id); }
    else { const r = run("insert into quiz_questions(course_id,ord,text,options,correct) values(?,?,?,?,?)", courseId, i, q.text.trim(), JSON.stringify(opts), correct); keep.push(r.lastInsertRowid); }
  });
  run(`update quiz_questions set active=0 where course_id=? ${keep.length ? `and id not in (${keep.map(() => "?").join(",")})` : ""}`, courseId, ...keep);
}
const courseBody = (b) => { if (!b.title?.trim()) bad("Informe o título do curso."); const aud = ["all", "franqueado", "tecnico", "unidade", "franqueadora", "units"].includes(b.audience) ? b.audience : "all";
  const ids = aud === "units" ? [...new Set((b.unit_ids || []).map(Number).filter(Boolean))] : []; if (aud === "units" && !ids.length) bad("Selecione ao menos uma unidade.");
  return [b.title.trim(), b.description || null, (b.category || "").trim() || "Geral", aud, b.mandatory ? 1 : 0, Math.max(0, Math.min(100, int(b.pass_score, 70))), JSON.stringify(ids)]; };
route("POST", "/courses", (ctx) => {
  need(ctx, "university", 1); onlyHQ(ctx, "Apenas a franqueadora cria cursos."); const b = ctx.body; const v = courseBody(b);
  const r = run("insert into courses(title,description,category,audience,mandatory,pass_score,unit_ids,created_by) values(?,?,?,?,?,?,?,?)", ...v, ctx.user.id);
  saveLessons(r.lastInsertRowid, b.lessons); saveQuestions(r.lastInsertRowid, b.questions);
  log(ctx.user.id, null, "universidade", `Curso criado: ${v[0]}`);
  if (b.notify !== false) { const c = get("select * from courses where id=?", r.lastInsertRowid); const to = recipients.byRole(x => audienceOk(c, x));
    enqueue(to, `Novo treinamento: ${c.title}`, layout(`Novo treinamento disponível${c.mandatory ? " (obrigatório)" : ""}`, `<p>A franqueadora publicou o curso <b>${E(c.title)}</b> na pasta <b>${E(c.category)}</b>.</p>${c.description ? `<p>${E(c.description)}</p>` : ""}<p>${(b.lessons || []).filter(l => l.title).length} aula(s)${(b.questions || []).length ? " · com prova" : ""}.</p>`, { label: "Acessar a Universidade" }), null, `course:${c.id}`); }
  return courseFull(ctx, r.lastInsertRowid, true);
});
route("PUT", "/courses/:id", (ctx) => {
  need(ctx, "university", 2); onlyHQ(ctx); const b = ctx.body; const c = get("select * from courses where id=?", ctx.params.id); if (!c) throw new HttpError(404, "Curso não encontrado."); const v = courseBody(b);
  run("update courses set title=?,description=?,category=?,audience=?,mandatory=?,pass_score=?,unit_ids=?,active=? where id=?", ...v, b.active === false ? 0 : 1, c.id);
  if (Array.isArray(b.lessons)) saveLessons(c.id, b.lessons); if (Array.isArray(b.questions)) saveQuestions(c.id, b.questions);
  return courseFull(ctx, c.id, true);
});
route("DELETE", "/courses/:id", (ctx) => {
  need(ctx, "university", 3); onlyHQ(ctx); const c = get("select * from courses where id=?", ctx.params.id); if (!c) throw new HttpError(404, "Curso não encontrado.");
  for (const f of all("select * from files where kind='lesson' and id in (select file_id from lessons where course_id=? and file_id is not null)", c.id)) { run("delete from files where id=?", f.id); try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored)); } catch {} }
  run("delete from lesson_progress where lesson_id in (select id from lessons where course_id=?)", c.id); run("delete from lesson_views where lesson_id in (select id from lessons where course_id=?)", c.id);
  run("delete from course_results where course_id=?", c.id); run("delete from quiz_questions where course_id=?", c.id); run("delete from lessons where course_id=?", c.id); run("delete from courses where id=?", c.id);
  log(ctx.user.id, null, "universidade", `Curso excluído: ${c.title}`);
});
route("POST", "/courses/:id/lessons/:lid/view", (ctx) => { // registra visualização (onde o usuário está/parou)
  need(ctx, "university", 0); const c = courseFull(ctx, ctx.params.id); const l = c.lessons.find(x => x.id === int(ctx.params.lid)); if (!l) throw new HttpError(404, "Aula não encontrada.");
  run("insert into lesson_views(user_id,lesson_id) values(?,?) on conflict(user_id,lesson_id) do update set views=views+1, last_at=datetime('now')", ctx.user.id, l.id);
});
route("POST", "/courses/:id/lessons/:lid/done", (ctx) => {
  need(ctx, "university", 0); const c = courseFull(ctx, ctx.params.id); const l = c.lessons.find(x => x.id === int(ctx.params.lid)); if (!l) throw new HttpError(404, "Aula não encontrada.");
  if (ctx.body.undo) run("delete from lesson_progress where user_id=? and lesson_id=?", ctx.user.id, l.id); else run("insert or ignore into lesson_progress(user_id,lesson_id) values(?,?)", ctx.user.id, l.id);
  const after = courseFull(ctx, c.id);
  if (after.progress.completed && !c.progress.completed) log(ctx.user.id, ctx.user.unit_id, "universidade", `Curso concluído: ${c.title}`, `course:${c.id}`);
  return after;
});
route("POST", "/courses/:id/quiz", (ctx) => {
  need(ctx, "university", 0); const c = courseFull(ctx, ctx.params.id); if (!c.questions.length) bad("Este curso não tem prova.");
  if (c.progress.done < c.progress.total) bad("Conclua todas as aulas antes da prova.");
  const qs = all("select id, correct from quiz_questions where course_id=? and active=1 order by ord, id", c.id); const ans = ctx.body.answers || {};
  const hits = qs.filter(q => int(ans[q.id], -1) === q.correct).length; const score = Math.round(hits / qs.length * 100); const passed = score >= c.pass_score ? 1 : 0;
  run("insert into course_results(course_id,user_id,score,passed) values(?,?,?,?)", c.id, ctx.user.id, score, passed);
  if (passed && !c.best?.passed) log(ctx.user.id, ctx.user.unit_id, "universidade", `Aprovado na prova de "${c.title}" (${score}%)`, `course:${c.id}`);
  return { score, passed: !!passed, hits, total: qs.length, pass_score: c.pass_score, review: qs.map(q => ({ id: q.id, correct: q.correct, yours: int(ans[q.id], -1) })) };
});
