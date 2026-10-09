import { all, get, run, log, UPLOAD_DIR } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { enqueue, layout, recipients, mailConfig, settings, sendTest, flush } from "./mail.js";
import { HttpError } from "./server.js";
import { sign, cookieHeader, hashPassword, checkPassword, can, isNetwork, ROLES, DEFAULT_PERMS } from "./auth.js";

export const routes = [];
export const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$"), handler, ...opts });
export const need = (ctx, mod, action = 0) => { if (!can(ctx.user, mod, action)) throw new HttpError(403, "Sem permissão para esta ação."); };
export const bad = (msg) => { throw new HttpError(400, msg); };
export const scoped = (ctx, unit_id) => { if (!isNetwork(ctx.user) && Number(unit_id) !== Number(ctx.user.unit_id)) throw new HttpError(403, "Sem acesso a este registro."); };

const E = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Auth ---------- */
route("POST", "/auth/login", (ctx) => {
  const { email, password } = ctx.body;
  const u = get("select * from users where lower(email)=lower(?)", email || "");
  const pw = u && checkPassword(password || "", u.password_hash);
  const ok = pw && u.active && u.approval === "aprovado";
  run("insert into login_history(user_id,ip,ok) values(?,?,?)", u?.id ?? null, ctx.ip, ok ? 1 : 0);
  if (pw && u.approval === "pendente") throw new HttpError(403, "Seu cadastro aguarda aprovação da franqueadora.");
  if (pw && u.approval === "recusado") throw new HttpError(403, "Seu cadastro não foi aprovado pela franqueadora.");
  if (!ok) throw new HttpError(401, "E-mail ou senha inválidos.");
  run("update users set last_login=datetime('now') where id=?", u.id);
  ctx.setCookie = cookieHeader(sign(u));
  return { ok: true };
}, { auth: false });
route("POST", "/auth/logout", (ctx) => { ctx.setCookie = cookieHeader("", true); return { ok: true }; }, { auth: false });

/* Esqueci minha senha: link por e-mail válido por 1 hora, uso único.
   A resposta é sempre a mesma, exista ou não o e-mail (não revela quem tem cadastro). */
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
route("POST", "/auth/forgot", (ctx) => {
  const email = String(ctx.body.email || "").trim().toLowerCase();
  const generic = { ok: true, message: "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha em alguns minutos." };
  if (!email) bad("Informe o e-mail.");
  const u = get("select id, name, email from users where lower(email)=? and active=1 and approval='aprovado'", email);
  if (!u) return generic;
  if (get("select count(*) n from password_resets where user_id=? and created_at>datetime('now','-1 hour')", u.id).n >= 3) return generic; // limite
  const token = crypto.randomBytes(32).toString("base64url");
  run("insert into password_resets(user_id, token_hash, ip, expires_at) values(?,?,?,datetime('now','+1 hour'))", u.id, sha(token), ctx.ip);
  const host = String(ctx.headers?.host || "").replace(/[^\w.:-]/g, "");
  const base = (host && !/^(localhost|127\.)/.test(host) ? `https://${host}` : (mailConfig().site || "")).replace(/\/$/, "");
  const link = `${base}/#reset=${token}`;
  enqueue([u.email], "Redefinição de senha — Detecta Rede", layout("Redefinir sua senha",
    `<p>Olá, ${E(u.name)}.</p><p>Recebemos um pedido para criar uma nova senha no Detecta Rede. Clique no botão abaixo; o link vale por <b>1 hora</b> e só pode ser usado uma vez.</p>
     <p style="margin:20px 0"><a href="${link}" style="background:#0e5c47;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">Criar nova senha</a></p>
     <p style="font-size:12px;color:#6b7a74">Se o botão não funcionar, copie e cole no navegador:<br>${E(link)}</p>
     <p style="font-size:12px;color:#6b7a74">Se não foi você que pediu, ignore este e-mail: sua senha atual continua valendo.</p>`),
    `Para criar uma nova senha no Detecta Rede acesse (válido por 1 hora): ${link}`, `reset:${u.id}`);
  log(u.id, null, "usuario", "Pedido de redefinição de senha enviado por e-mail");
  return generic;
}, { auth: false });
route("POST", "/auth/reset", (ctx) => {
  const { token, password } = ctx.body || {};
  if (!token || typeof token !== "string") bad("Link inválido.");
  if (!password || String(password).length < 8) bad("A nova senha precisa ter ao menos 8 caracteres.");
  const r = get("select * from password_resets where token_hash=?", sha(token));
  if (!r || r.used_at) bad("Este link já foi usado ou é inválido. Peça um novo em “Esqueci minha senha”.");
  if (get("select datetime('now') > ? x", r.expires_at).x) bad("Este link expirou. Peça um novo em “Esqueci minha senha”.");
  const u = get("select id, email from users where id=? and active=1", r.user_id); if (!u) bad("Usuário inativo.");
  run("update users set password_hash=? where id=?", hashPassword(String(password)), u.id);
  run("update password_resets set used_at=datetime('now') where user_id=? and used_at is null", u.id); // invalida todos os links pendentes
  log(u.id, null, "usuario", "Senha redefinida pelo link de e-mail");
  return { ok: true, email: u.email };
}, { auth: false });
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
    pendingUsers: net ? get("select count(*) n from users where approval='pendente'").n : 0,
  };
});

/* ---------- Unidades ---------- */
route("GET", "/units", (ctx) => all(`select u.*, (select count(*) from users x where x.unit_id=u.id and x.active=1) users,
  (select count(*) from tickets t where t.unit_id=u.id and t.status<>'resolvido') open_tickets,
  (select count(*) from tickets t where t.unit_id=u.id and t.status='aberto') t_open,
  (select count(*) from tickets t where t.unit_id=u.id and t.status in ('andamento','aguardando')) t_progress,
  (select count(*) from tickets t where t.unit_id=u.id and t.status='resolvido') t_done from units u
  ${isNetwork(ctx.user) ? "" : "where u.id=?"} order by is_hq desc, name`, ...(isNetwork(ctx.user) ? [] : [ctx.user.unit_id])));
route("POST", "/units", (ctx) => {
  need(ctx, "units", 1); const b = ctx.body; if (!b.name) bad("Informe o nome da unidade.");
  const r = run("insert into units(name,city,state,franchisee,phone,email,cnpj,status,opened_at) values(?,?,?,?,?,?,?,?,?)",
    b.name, b.city || null, b.state || "SP", b.franchisee || null, b.phone || null, b.email || null, b.cnpj || null, b.status || "ativa", b.opened_at || null);
  log(ctx.user.id, r.lastInsertRowid, "unidade", `Unidade "${b.name}" cadastrada`);
  return get("select * from units where id=?", r.lastInsertRowid);
});
route("PUT", "/units/:id", (ctx) => {
  need(ctx, "units", 2); const b = ctx.body; scoped(ctx, ctx.params.id);
  run("update units set name=?,city=?,state=?,franchisee=?,phone=?,email=?,cnpj=?,status=?,opened_at=? where id=?",
    b.name, b.city || null, b.state || "SP", b.franchisee || null, b.phone || null, b.email || null, b.cnpj || null, b.status || "ativa", b.opened_at || null, ctx.params.id);
  return get("select * from units where id=?", ctx.params.id);
});

/* ---------- Usuários / Segurança ---------- */
route("GET", "/users", (ctx) => {
  need(ctx, "users", 0);
  return all(`select u.id,u.name,u.email,u.role_key,r.name role_name,u.unit_id,un.name unit_name,u.active,u.last_login,u.approval,u.created_at,rq.name requested_by_name
    from users u join roles r on r.key=u.role_key left join units un on un.id=u.unit_id left join users rq on rq.id=u.requested_by
    ${isNetwork(ctx.user) ? "" : `where u.unit_id=${Number(ctx.user.unit_id)}`} order by (u.approval='pendente') desc, u.name`);
});
route("POST", "/users", (ctx) => {
  need(ctx, "users", 1); const b = ctx.body;
  if (!b.name || !b.email || !b.password || !b.role_key) bad("Nome, e-mail, senha e perfil são obrigatórios.");
  if (b.password.length < 8) bad("A senha precisa ter ao menos 8 caracteres.");
  if (!ROLES[b.role_key]) bad("Perfil inválido.");
  if (!isNetwork(ctx.user)) { b.unit_id = ctx.user.unit_id; if (ROLES[b.role_key].scope !== "unit") throw new HttpError(403, "Você só pode criar usuários da sua unidade."); }
  if (get("select 1 from users where lower(email)=lower(?)", b.email)) bad("Já existe usuário com este e-mail.");
  const pending = !isNetwork(ctx.user); // franqueado solicita; franqueadora aprova
  const r = run("insert into users(name,email,password_hash,role_key,unit_id,active,approval,requested_by) values(?,?,?,?,?,?,?,?)",
    b.name, b.email.toLowerCase(), hashPassword(b.password), b.role_key, b.unit_id || null, pending ? 0 : 1, pending ? "pendente" : "aprovado", pending ? ctx.user.id : null);
  log(ctx.user.id, b.unit_id || null, "usuario", pending ? `Solicitação de novo usuário: "${b.name}" (${ROLES[b.role_key].name}) — aguardando aprovação` : `Usuário "${b.name}" criado (${ROLES[b.role_key].name})`);
  if (pending) enqueue(recipients.network(), `Solicitação de novo usuário: ${b.name}`, layout("Novo usuário aguardando aprovação", `<p><b>${E(ctx.user.name)}</b> (${E(ctx.user.unit_name || "")}) solicitou o cadastro de <b>${E(b.name)}</b> &lt;${E(b.email)}&gt; como <b>${E(ROLES[b.role_key].name)}</b>.</p><p>Aprove ou recuse em Usuários e segurança.</p>`, { label: "Ver solicitações" }), null, "user:req");
  else if (b.unit_id || !isNetwork(ctx.user)) enqueue([b.email], "Seu acesso ao Detecta Rede", layout("Bem-vindo ao Detecta Rede", `<p>Olá, ${E(b.name)}. Seu usuário foi criado.</p><p>E-mail de acesso: <b>${E(b.email)}</b><br>Senha inicial: informada por quem fez o cadastro. Troque a senha em "Minha conta" no primeiro acesso.</p>`, { label: "Acessar o sistema" }), null, "user:new");
  return get("select id,name,email,role_key,unit_id,approval from users where id=?", r.lastInsertRowid);
});
route("POST", "/users/:id/approval", (ctx) => {
  need(ctx, "users", 2); if (!isNetwork(ctx.user)) throw new HttpError(403, "Apenas a franqueadora aprova cadastros.");
  const t = get("select * from users where id=?", ctx.params.id); if (!t) throw new HttpError(404, "Usuário não encontrado.");
  if (t.approval !== "pendente") bad("Este cadastro já foi avaliado.");
  const approve = ctx.body.approve === true;
  run("update users set approval=?, active=? where id=?", approve ? "aprovado" : "recusado", approve ? 1 : 0, t.id);
  log(ctx.user.id, t.unit_id, "usuario", approve ? `Cadastro de "${t.name}" aprovado` : `Cadastro de "${t.name}" recusado${ctx.body.reason ? ": " + ctx.body.reason : ""}`);
  const req = get("select email, name from users where id=?", t.requested_by);
  if (approve) { enqueue([t.email], "Seu acesso ao Detecta Rede foi aprovado", layout("Acesso aprovado", `<p>Olá, ${E(t.name)}. Seu cadastro foi aprovado pela franqueadora.</p><p>Entre com o e-mail <b>${E(t.email)}</b> e a senha definida no cadastro. Troque a senha em "Minha conta".</p>`, { label: "Acessar o sistema" }), null, `user:${t.id}`); if (req) enqueue([req.email], `Cadastro de ${t.name} aprovado`, layout("Solicitação aprovada", `<p>O usuário <b>${E(t.name)}</b> que você solicitou foi aprovado e já pode acessar o sistema.</p>`), null, `user:${t.id}`); }
  else if (req) enqueue([req.email], `Cadastro de ${t.name} não aprovado`, layout("Solicitação recusada", `<p>O cadastro de <b>${E(t.name)}</b> não foi aprovado pela franqueadora.${ctx.body.reason ? `</p><p>Motivo: ${E(ctx.body.reason)}` : ""}</p>`), null, `user:${t.id}`);
  return get("select id,name,approval,active from users where id=?", t.id);
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

/* ---------- E-mail (configuração) ---------- */
const MAIL_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_secure", "mail_from", "mail_from_name", "mail_enabled", "site_url"];
route("GET", "/settings/mail", (ctx) => { need(ctx, "security", 2); const c = mailConfig(); return { ...c, pass: undefined, has_pass: !!c.pass,
  outbox: all("select id,to_email,subject,status,attempts,error,created_at,sent_at from mail_outbox order by id desc limit 40"), pending: get("select count(*) n from mail_outbox where status='pendente'").n }; });
route("PUT", "/settings/mail", (ctx) => { need(ctx, "security", 2); if (!isNetwork(ctx.user)) throw new HttpError(403, "Apenas a franqueadora.");
  for (const k of MAIL_KEYS) { if (ctx.body[k] === undefined) continue; if (k === "smtp_pass" && ctx.body[k] === "") continue; settings.set(k, String(ctx.body[k])); }
  log(ctx.user.id, null, "config", "Configuração de e-mail atualizada"); return { ok: true }; });
route("POST", "/settings/mail/test", async (ctx) => { need(ctx, "security", 2); const to = ctx.body.to || ctx.user.email; await sendTest(to); return { ok: true, to }; });
route("POST", "/settings/mail/retry", (ctx) => { need(ctx, "security", 2); run("update mail_outbox set status='pendente', attempts=0, next_at=null where status<>'enviado'"); setTimeout(() => flush().catch(() => {}), 10); });

/* ---------- Chamados ---------- */
route("GET", "/tickets/categories", (ctx) => all(`select * from ticket_categories ${ctx.query?.all && isNetwork(ctx.user) ? "" : "where active=1"} order by active desc, name`));
const catBody = (b) => { if (!b.name) bad("Informe o nome da categoria."); const h = x => Math.max(1, Math.min(720, parseInt(x, 10) || 0)) || 8; return [b.name.trim(), (b.department || "").trim() || b.name.trim(), h(b.sla_hours), h(b.sla_unit_hours), (b.description || "").trim() || null]; };
route("POST", "/tickets/categories", (ctx) => { need(ctx, "tickets", 2); if (!isNetwork(ctx.user)) throw new HttpError(403, "Apenas a franqueadora gerencia categorias."); const v = catBody(ctx.body);
  const r = run("insert into ticket_categories(name,department,sla_hours,sla_unit_hours,description) values(?,?,?,?,?)", ...v); log(ctx.user.id, null, "chamado", `Categoria de chamado criada: ${v[0]}`); return get("select * from ticket_categories where id=?", r.lastInsertRowid); });
route("PUT", "/tickets/categories/:id", (ctx) => { need(ctx, "tickets", 2); if (!isNetwork(ctx.user)) throw new HttpError(403, "Apenas a franqueadora gerencia categorias."); const v = catBody(ctx.body);
  run("update ticket_categories set name=?,department=?,sla_hours=?,sla_unit_hours=?,description=?,active=? where id=?", ...v, ctx.body.active === false ? 0 : 1, ctx.params.id); return get("select * from ticket_categories where id=?", ctx.params.id); });
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
  const t = get("select t.*, un.name unit_name, c.name category, c.department, c.sla_hours, c.sla_unit_hours, cb.role_key opener_role from tickets t left join users cb on cb.id=t.created_by join units un on un.id=t.unit_id left join ticket_categories c on c.id=t.category_id where t.id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Chamado não encontrado."); scoped(ctx, t.unit_id);
  t.messages = all(`select m.*, u.name user_name, u.role_key from ticket_messages m left join users u on u.id=m.user_id where m.ticket_id=? ${isNetwork(ctx.user) ? "" : "and m.internal=0"} order by m.created_at, m.id`, t.id);
  t.attachments = all("select a.id,a.message_id,a.filename,a.mime,a.size,a.created_at,u.name user_name from ticket_attachments a left join users u on u.id=a.user_id where a.ticket_id=? order by a.id", t.id);
  return t;
});
route("POST", "/tickets", (ctx) => {
  need(ctx, "tickets", 1); const b = ctx.body, u = ctx.user;
  const unit_id = isNetwork(u) ? (b.unit_id || u.unit_id) : u.unit_id;
  if (!b.title || !unit_id) bad("Informe o assunto e a unidade.");
  const cat = b.category_id ? get("select * from ticket_categories where id=?", b.category_id) : null;
  // SLA: franqueado abre → franqueadora responde (sla_hours); franqueadora abre → franqueado responde (sla_unit_hours)
  const slaH = isNetwork(u) ? (cat?.sla_unit_hours || 24) : (cat?.sla_hours || 8);
  const r = run("insert into tickets(title,unit_id,category_id,priority,created_by,sla_due) values(?,?,?,?,?,datetime('now',?))", b.title, unit_id, cat?.id ?? null, b.priority || "media", u.id, `+${slaH} hours`);
  if (b.body) run("insert into ticket_messages(ticket_id,user_id,body) values(?,?,?)", r.lastInsertRowid, u.id, b.body);
  log(u.id, unit_id, "chamado", `Chamado #${r.lastInsertRowid} aberto: ${b.title}`, `ticket:${r.lastInsertRowid}`);
  { const un = get("select name from units where id=?", unit_id)?.name || ""; const to = isNetwork(u) ? recipients.unit(unit_id) : recipients.network();
    enqueue(to, `Chamado #${r.lastInsertRowid}: ${b.title}`, layout(`Novo chamado #${r.lastInsertRowid}`, `<p><b>${E(u.name)}</b> abriu um chamado ${isNetwork(u) ? `para a unidade <b>${E(un)}</b>` : `da unidade <b>${E(un)}</b>`}.</p><p><b>Assunto:</b> ${E(b.title)}<br><b>Categoria:</b> ${E(cat?.name || "—")} · <b>Prioridade:</b> ${E(b.priority || "média")} · <b>Prazo (SLA):</b> ${slaH}h</p>${b.body ? `<p style="white-space:pre-wrap;border-left:3px solid #e3e8e5;padding-left:10px">${E(b.body)}</p>` : ""}`, { label: "Abrir chamado" }), null, `ticket:${r.lastInsertRowid}`); }
  return get("select * from tickets where id=?", r.lastInsertRowid);
});
/* Anexos (imagens e PDF, até 10 MB) */
const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf" };
route("POST", "/tickets/:id/attachments", (ctx) => {
  need(ctx, "tickets", 1); const t = get("select * from tickets where id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Chamado não encontrado."); scoped(ctx, t.unit_id);
  const mime = (ctx.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED[mime]) bad("Tipo de arquivo não permitido. Envie imagem (JPG, PNG, WEBP, GIF) ou PDF.");
  if (!ctx.raw || !ctx.raw.length) bad("Arquivo vazio.");
  const filename = decodeURIComponent(ctx.query.filename || "anexo").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const stored = crypto.randomUUID() + ALLOWED[mime];
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), ctx.raw);
  const r = run("insert into ticket_attachments(ticket_id,message_id,user_id,filename,mime,size,stored) values(?,?,?,?,?,?,?)", t.id, ctx.query.message_id || null, ctx.user.id, filename, mime, ctx.raw.length, stored);
  run("update tickets set updated_at=datetime('now') where id=?", t.id);
  return get("select id,message_id,filename,mime,size,created_at from ticket_attachments where id=?", r.lastInsertRowid);
}, { raw: true });
route("GET", "/tickets/:id/attachments/:aid", (ctx) => {
  const a = get("select a.*, t.unit_id from ticket_attachments a join tickets t on t.id=a.ticket_id where a.id=? and a.ticket_id=?", ctx.params.aid, ctx.params.id);
  if (!a) throw new HttpError(404, "Anexo não encontrado."); scoped(ctx, a.unit_id);
  const f = path.join(UPLOAD_DIR, a.stored); if (!fs.existsSync(f)) throw new HttpError(404, "Arquivo não encontrado no servidor.");
  return { __file: f, mime: a.mime, filename: a.filename, inline: ctx.query.dl === undefined };
});
route("POST", "/tickets/:id/messages", (ctx) => {
  need(ctx, "tickets", 1); const t = get("select * from tickets where id=?", ctx.params.id);
  if (!t) throw new HttpError(404, "Chamado não encontrado."); scoped(ctx, t.unit_id);
  const { body, internal } = ctx.body; if (!body?.trim()) bad("Escreva a mensagem.");
  const r = run("insert into ticket_messages(ticket_id,user_id,body,internal) values(?,?,?,?)", t.id, ctx.user.id, body, internal && isNetwork(ctx.user) ? 1 : 0);
  const status = isNetwork(ctx.user) && t.status === "aberto" ? "andamento" : t.status;
  run("update tickets set status=?, updated_at=datetime('now'), assigned_to=coalesce(assigned_to,?) where id=?", status, isNetwork(ctx.user) ? ctx.user.id : null, t.id);
  if (!(internal && isNetwork(ctx.user))) { const to = isNetwork(ctx.user) ? recipients.unit(t.unit_id) : recipients.network();
    enqueue(to.filter(e => e !== ctx.user.email), `Re: Chamado #${t.id}: ${t.title}`, layout(`Nova resposta no chamado #${t.id}`, `<p><b>${E(ctx.user.name)}</b> respondeu:</p><p style="white-space:pre-wrap;border-left:3px solid #e3e8e5;padding-left:10px">${E(body)}</p>`, { label: "Ver chamado" }), null, `ticket:${t.id}`); }
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
  { const aud = b.audience || "all"; const to = aud === "all" ? recipients.all() : aud === "hq" ? recipients.byRole(x => !x.unit_id) : recipients.units((b.unit_ids || []).map(Number));
    enqueue(to, `Comunicado: ${b.title}`, layout(b.title, `<div style="white-space:pre-wrap">${E(b.body)}</div><p style="color:#6b7a74;font-size:12px;margin-top:14px">Publicado por ${E(ctx.user.name)}.${b.requires_ack !== false ? " Confirme a leitura no sistema." : ""}</p>`, { label: "Confirmar leitura" }), null, `comm:${r.lastInsertRowid}`); }
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
