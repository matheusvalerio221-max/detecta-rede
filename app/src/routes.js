import { all, get, run, log } from "./db.js";
import { HttpError } from "./server.js";
import { sign, cookieHeader, hashPassword, checkPassword, can, isNetwork, ROLES, DEFAULT_PERMS } from "./auth.js";

export const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$"), handler, ...opts });
const need = (ctx, mod, action = 0) => { if (!can(ctx.user, mod, action)) throw new HttpError(403, "Sem permissão para esta ação."); };
const bad = (msg) => { throw new HttpError(400, msg); };
const scoped = (ctx, unit_id) => { if (!isNetwork(ctx.user) && Number(unit_id) !== Number(ctx.user.unit_id)) throw new HttpError(403, "Sem acesso a este registro."); };

/* ---------- Auth ---------- */
route("POST", "/auth/login", (ctx) => {
  const { email, password } = ctx.body;
  const u = get("select * from users where lower(email)=lower(?)", email || "");
  const ok = u && u.active && checkPassword(password || "", u.password_hash);
  run("insert into login_history(user_id,ip,ok) values(?,?,?)", u?.id ?? null, ctx.ip, ok ? 1 : 0);
  if (!ok) throw new HttpError(401, "E-mail ou senha inválidos.");
  run("update users set last_login=datetime('now') where id=?", u.id);
  ctx.setCookie = cookieHeader(sign(u));
  return { ok: true };
}, { auth: false });
route("POST", "/auth/logout", (ctx) => { ctx.setCookie = cookieHeader("", true); return { ok: true }; }, { auth: false });
route("GET", "/me", (ctx) => { const u = ctx.user; return { id: u.id, name: u.name, email: u.email, role: u.role_key, role_name: u.role_name, scope: u.scope, unit_id: u.unit_id, unit_name: u.unit_name, perms: u.perms }; });
route("POST", "/me/password", (ctx) => {
  const { current, next } = ctx.body;
  const row = get("select password_hash from users where id=?", ctx.user.id);
  if (!checkPassword(current || "", row.password_hash)) bad("Senha atual incorreta.");
  if (!next || next.length < 8) bad("A nova senha precisa ter ao menos 8 caracteres.");
  run("update users set password_hash=? where id=?", hashPassword(next), ctx.user.id);
});

/* ---------- Dashboard ---------- */
route("GET", "/dashboard", (ctx) => {
  const u = ctx.user, net = isNetwork(u);
  const uf = net ? "" : ` and unit_id=${Number(u.unit_id)}`;
  return {
    units: all("select status, count(*) n from units group by status"),
    tickets: all(`select status, count(*) n from tickets where 1=1 ${uf} group by status`),
    sla: get(`select sum(case when resolved_at is not null and resolved_at<=sla_due then 1 else 0 end) ok, sum(case when resolved_at is not null then 1 else 0 end) total,
      sum(case when status<>'resolvido' and sla_due<datetime('now') then 1 else 0 end) late from tickets where created_at>datetime('now','-30 days') ${uf}`),
    tasks: all(`select status, count(*) n from tasks where 1=1 ${net ? "" : ` and (unit_id=${Number(u.unit_id)} or assigned_to=${Number(u.id)})`} group by status`),
    comms: all(`select c.id,c.title,c.published_at,(select count(*) from communication_reads cr where cr.communication_id=c.id) reads,
      exists(select 1 from communication_reads cr where cr.communication_id=c.id and cr.user_id=?) read_by_me from communications c order by published_at desc limit 5`, u.id),
    activity: all(`select a.*, us.name user_name, un.name unit_name from activity_log a left join users us on us.id=a.user_id left join units un on un.id=a.unit_id
      ${net ? "" : ` where a.unit_id=${Number(u.unit_id)}`} order by a.at desc, a.id desc limit 12`),
    totalUsers: get("select count(*) n from users where active=1").n,
  };
});

/* ---------- Unidades ---------- */
route("GET", "/units", (ctx) => all(`select u.*, (select count(*) from users x where x.unit_id=u.id and x.active=1) users,
  (select count(*) from tickets t where t.unit_id=u.id and t.status<>'resolvido') open_tickets from units u order by is_hq desc, name`));
route("POST", "/units", (ctx) => {
  need(ctx, "units", 1); const b = ctx.body; if (!b.name) bad("Informe o nome da unidade.");
  const r = run("insert into units(name,city,state,franchisee,phone,email,cnpj,status,opened_at) values(?,?,?,?,?,?,?,?,?)",
    b.name, b.city || null, b.state || "SP", b.franchisee || null, b.phone || null, b.email || null, b.cnpj || null, b.status || "ativa", b.opened_at || null);
  log(ctx.user.id, r.lastInsertRowid, "unidade", `Unidade "${b.name}" cadastrada`);
  return get("select * from units where id=?", r.lastInsertRowid);
});
route("PUT", "/units/:id", (ctx) => {
  need(ctx, "units", 2); const b = ctx.body;
  run("update units set name=?,city=?,state=?,franchisee=?,phone=?,email=?,cnpj=?,status=?,opened_at=? where id=?",
    b.name, b.city || null, b.state || "SP", b.franchisee || null, b.phone || null, b.email || null, b.cnpj || null, b.status || "ativa", b.opened_at || null, ctx.params.id);
  return get("select * from units where id=?", ctx.params.id);
});

/* ---------- Usuários / Segurança ---------- */
route("GET", "/users", (ctx) => {
  need(ctx, "users", 0);
  return all(`select u.id,u.name,u.email,u.role_key,r.name role_name,u.unit_id,un.name unit_name,u.active,u.last_login from users u join roles r on r.key=u.role_key
    left join units un on un.id=u.unit_id ${isNetwork(ctx.user) ? "" : `where u.unit_id=${Number(ctx.user.unit_id)}`} order by u.name`);
});
route("POST", "/users", (ctx) => {
  need(ctx, "users", 1); const b = ctx.body;
  if (!b.name || !b.email || !b.password || !b.role_key) bad("Nome, e-mail, senha e perfil são obrigatórios.");
  if (b.password.length < 8) bad("A senha precisa ter ao menos 8 caracteres.");
  if (!ROLES[b.role_key]) bad("Perfil inválido.");
  if (!isNetwork(ctx.user)) { b.unit_id = ctx.user.unit_id; if (ROLES[b.role_key].scope !== "unit") throw new HttpError(403, "Você só pode criar usuários da sua unidade."); }
  if (get("select 1 from users where lower(email)=lower(?)", b.email)) bad("Já existe usuário com este e-mail.");
  const r = run("insert into users(name,email,password_hash,role_key,unit_id) values(?,?,?,?,?)", b.name, b.email.toLowerCase(), hashPassword(b.password), b.role_key, b.unit_id || null);
  log(ctx.user.id, b.unit_id || null, "usuario", `Usuário "${b.name}" criado (${ROLES[b.role_key].name})`);
  return get("select id,name,email,role_key,unit_id from users where id=?", r.lastInsertRowid);
});
route("PUT", "/users/:id", (ctx) => {
  need(ctx, "users", 2); const b = ctx.body; const t = get("select * from users where id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Usuário não encontrado.");
  if (!isNetwork(ctx.user)) { scoped(ctx, t.unit_id); b.unit_id = ctx.user.unit_id; }
  if (!ROLES[b.role_key]) bad("Perfil inválido.");
  if (b.password && b.password.length < 8) bad("A senha precisa ter ao menos 8 caracteres.");
  run("update users set name=?,role_key=?,unit_id=?,active=? where id=?", b.name, b.role_key, b.unit_id || null, b.active === false ? 0 : 1, t.id);
  if (b.password) run("update users set password_hash=? where id=?", hashPassword(b.password), t.id);
  return get("select id,name,email,role_key,unit_id,active from users where id=?", t.id);
});
route("GET", "/roles", () => all("select * from roles order by key").map(x => ({ ...x, perms: { ...DEFAULT_PERMS[x.key], ...JSON.parse(x.perms || "{}") } })));
route("PUT", "/roles/:key", (ctx) => { need(ctx, "security", 2); if (ctx.params.key === "admin") bad("O perfil Administrador não pode ser alterado."); run("update roles set perms=? where key=?", JSON.stringify(ctx.body.perms || {}), ctx.params.key); });
route("GET", "/security/logins", (ctx) => { need(ctx, "security", 0); return all("select l.*, u.name, u.email from login_history l left join users u on u.id=l.user_id order by l.at desc, l.id desc limit 100"); });

/* ---------- Chamados ---------- */
route("GET", "/tickets/categories", () => all("select * from ticket_categories order by name"));
route("POST", "/tickets/categories", (ctx) => { need(ctx, "security", 2); const b = ctx.body; const r = run("insert into ticket_categories(name,department,sla_hours) values(?,?,?)", b.name, b.department, b.sla_hours || 8); return get("select * from ticket_categories where id=?", r.lastInsertRowid); });
route("GET", "/tickets", (ctx) => {
  need(ctx, "tickets", 0); const u = ctx.user; const w = ["1=1"]; const v = [];
  if (!isNetwork(u)) { w.push("t.unit_id=?"); v.push(u.unit_id); }
  if (ctx.query.status) { w.push("t.status=?"); v.push(ctx.query.status); }
  return all(`select t.*, un.name unit_name, c.name category, c.department, cu.name created_by_name, au.name assigned_name,
    (select count(*) from ticket_messages m where m.ticket_id=t.id) messages from tickets t join units un on un.id=t.unit_id left join ticket_categories c on c.id=t.category_id
    left join users cu on cu.id=t.created_by left join users au on au.id=t.assigned_to where ${w.join(" and ")} order by (t.status='resolvido'), t.sla_due, t.created_at desc limit 300`, ...v);
});
route("GET", "/tickets/:id", (ctx) => {
  need(ctx, "tickets", 0);
  const t = get("select t.*, un.name unit_name, c.name category, c.department, c.sla_hours from tickets t join units un on un.id=t.unit_id left join ticket_categories c on c.id=t.category_id where t.id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Chamado não encontrado."); scoped(ctx, t.unit_id);
  t.messages = all(`select m.*, u.name user_name, u.role_key from ticket_messages m left join users u on u.id=m.user_id where m.ticket_id=? ${isNetwork(ctx.user) ? "" : "and m.internal=0"} order by m.created_at, m.id`, t.id);
  return t;
});
route("POST", "/tickets", (ctx) => {
  need(ctx, "tickets", 1); const b = ctx.body, u = ctx.user;
  const unit_id = isNetwork(u) ? (b.unit_id || u.unit_id) : u.unit_id;
  if (!b.title || !unit_id) bad("Informe o assunto e a unidade.");
  const cat = b.category_id ? get("select * from ticket_categories where id=?", b.category_id) : null;
  const r = run("insert into tickets(title,unit_id,category_id,priority,created_by,sla_due) values(?,?,?,?,?,datetime('now',?))", b.title, unit_id, cat?.id ?? null, b.priority || "media", u.id, `+${cat?.sla_hours || 8} hours`);
  if (b.body) run("insert into ticket_messages(ticket_id,user_id,body) values(?,?,?)", r.lastInsertRowid, u.id, b.body);
  log(u.id, unit_id, "chamado", `Chamado #${r.lastInsertRowid} aberto: ${b.title}`, `ticket:${r.lastInsertRowid}`);
  return get("select * from tickets where id=?", r.lastInsertRowid);
});
route("POST", "/tickets/:id/messages", (ctx) => {
  need(ctx, "tickets", 1); const t = get("select * from tickets where id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Chamado não encontrado."); scoped(ctx, t.unit_id);
  const { body, internal } = ctx.body; if (!body?.trim()) bad("Escreva a mensagem.");
  const r = run("insert into ticket_messages(ticket_id,user_id,body,internal) values(?,?,?,?)", t.id, ctx.user.id, body, internal && isNetwork(ctx.user) ? 1 : 0);
  const status = isNetwork(ctx.user) && t.status === "aberto" ? "andamento" : t.status;
  run("update tickets set status=?, updated_at=datetime('now'), assigned_to=coalesce(assigned_to,?) where id=?", status, isNetwork(ctx.user) ? ctx.user.id : null, t.id);
  return get("select * from ticket_messages where id=?", r.lastInsertRowid);
});
route("PATCH", "/tickets/:id", (ctx) => {
  need(ctx, "tickets", 2); const b = ctx.body; const t = get("select * from tickets where id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Chamado não encontrado."); scoped(ctx, t.unit_id);
  const status = b.status || t.status;
  run("update tickets set status=?, priority=?, assigned_to=?, resolved_at=case when ?='resolvido' then coalesce(resolved_at,datetime('now')) else null end, updated_at=datetime('now') where id=?",
    status, b.priority || t.priority, b.assigned_to ?? t.assigned_to, status, t.id);
  if (status !== t.status) log(ctx.user.id, t.unit_id, "chamado", `Chamado #${t.id} → ${status}`, `ticket:${t.id}`);
  return get("select * from tickets where id=?", t.id);
});

/* ---------- Comunicados ---------- */
const audienceMatch = (c, u) => c.audience === "all" || (c.audience === "units" && u.unit_id && (JSON.parse(c.unit_ids).length === 0 || JSON.parse(c.unit_ids).includes(u.unit_id))) || (c.audience === "hq" && !u.unit_id);
route("GET", "/comms", (ctx) => {
  need(ctx, "comms", 0); const u = ctx.user;
  const users = all("select id, unit_id from users where active=1");
  return all(`select c.*, a.name author_name, (select count(*) from communication_reads cr where cr.communication_id=c.id) reads,
    exists(select 1 from communication_reads cr where cr.communication_id=c.id and cr.user_id=?) read_by_me from communications c left join users a on a.id=c.author_id order by c.published_at desc, c.id desc limit 200`, u.id)
    .filter(c => isNetwork(u) || audienceMatch(c, u)).map(c => ({ ...c, unit_ids: JSON.parse(c.unit_ids), target: users.filter(x => audienceMatch(c, x)).length }));
});
route("POST", "/comms", (ctx) => {
  need(ctx, "comms", 1); const b = ctx.body; if (!b.title || !b.body) bad("Informe título e texto.");
  const r = run("insert into communications(title,body,author_id,audience,unit_ids,requires_ack) values(?,?,?,?,?,?)", b.title, b.body, ctx.user.id, b.audience || "all", JSON.stringify(b.unit_ids || []), b.requires_ack === false ? 0 : 1);
  log(ctx.user.id, null, "comunicado", `Comunicado publicado: ${b.title}`, `comm:${r.lastInsertRowid}`);
  return get("select * from communications where id=?", r.lastInsertRowid);
});
route("POST", "/comms/:id/ack", (ctx) => { run("insert or ignore into communication_reads(communication_id,user_id) values(?,?)", ctx.params.id, ctx.user.id); });
route("GET", "/comms/:id/reads", (ctx) => {
  need(ctx, "comms", 2); const c = get("select * from communications where id=?", ctx.params.id); if (!c) throw new HttpError(404, "Não encontrado.");
  return all(`select u.id,u.name,u.unit_id,un.name unit_name,cr.read_at from users u left join units un on un.id=u.unit_id left join communication_reads cr on cr.user_id=u.id and cr.communication_id=? where u.active=1 order by cr.read_at is null desc, u.name`, c.id)
    .filter(x => audienceMatch(c, x));
});

/* ---------- Tarefas ---------- */
route("GET", "/tasks", (ctx) => {
  need(ctx, "tasks", 0); const u = ctx.user;
  return all(`select t.*, un.name unit_name, au.name assigned_name, cu.name created_by_name from tasks t left join units un on un.id=t.unit_id left join users au on au.id=t.assigned_to left join users cu on cu.id=t.created_by
    where ${isNetwork(u) ? "1=1" : "(t.assigned_to=? or t.unit_id=?)"} order by (t.status='concluida'), t.due_date is null, t.due_date, t.created_at desc limit 300`, ...(isNetwork(u) ? [] : [u.id, u.unit_id]));
});
route("POST", "/tasks", (ctx) => {
  need(ctx, "tasks", 1); const b = ctx.body; if (!b.title) bad("Informe o título da tarefa.");
  const unit_id = isNetwork(ctx.user) ? (b.unit_id || null) : ctx.user.unit_id;
  const r = run("insert into tasks(title,description,source,source_ref,unit_id,assigned_to,created_by,priority,due_date) values(?,?,?,?,?,?,?,?,?)",
    b.title, b.description || null, b.source || "manual", b.source_ref || null, unit_id, b.assigned_to || ctx.user.id, ctx.user.id, b.priority || "media", b.due_date || null);
  log(ctx.user.id, unit_id, "tarefa", `Tarefa criada: ${b.title}`, `task:${r.lastInsertRowid}`);
  return get("select * from tasks where id=?", r.lastInsertRowid);
});
route("PATCH", "/tasks/:id", (ctx) => {
  need(ctx, "tasks", 2); const b = ctx.body; const t = get("select * from tasks where id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Tarefa não encontrada.");
  if (!isNetwork(ctx.user) && t.unit_id !== ctx.user.unit_id && t.assigned_to !== ctx.user.id) throw new HttpError(403, "Sem acesso.");
  const status = b.status || t.status;
  run("update tasks set title=?,description=?,status=?,priority=?,assigned_to=?,due_date=?,done_at=case when ?='concluida' then coalesce(done_at,datetime('now')) else null end where id=?",
    b.title ?? t.title, b.description ?? t.description, status, b.priority ?? t.priority, b.assigned_to ?? t.assigned_to, b.due_date ?? t.due_date, status, t.id);
  return get("select * from tasks where id=?", t.id);
});
