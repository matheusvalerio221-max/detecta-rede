/* E-mail de notificações — cliente SMTP mínimo (sem dependências), fila com reenvio.
   Configuração salva em `settings` (painel Usuários e segurança → E-mail) ou via env SMTP_* / MAIL_FROM. */
import net from "node:net";
import tls from "node:tls";
import { all, get, run } from "./db.js";

export const settings = {
  get: (k, d = null) => get("select value from settings where key=?", k)?.value ?? d,
  set: (k, v) => run("insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value", k, v ?? ""),
};
export function mailConfig() {
  const c = {
    host: settings.get("smtp_host", process.env.SMTP_HOST || ""), port: Number(settings.get("smtp_port", process.env.SMTP_PORT || 587)),
    user: settings.get("smtp_user", process.env.SMTP_USER || ""), pass: settings.get("smtp_pass", process.env.SMTP_PASS || ""),
    from: settings.get("mail_from", process.env.MAIL_FROM || ""), from_name: settings.get("mail_from_name", "Detecta Rede"),
    secure: settings.get("smtp_secure", process.env.SMTP_SECURE || (Number(settings.get("smtp_port", process.env.SMTP_PORT || 587)) === 465 ? "1" : "0")) === "1",
    enabled: settings.get("mail_enabled", "1") === "1", site: settings.get("site_url", process.env.SITE_URL || ""),
  };
  c.ready = !!(c.host && c.from); return c;
}

/* ---- SMTP (sequencial: cada comando aguarda a resposta completa) ---- */
function smtpSend(cfg, to, subject, html, text) {
  return new Promise((resolve, reject) => {
    let sock, buf = "", waiter = null, finished = false;
    const timer = setTimeout(() => fail(new Error("Tempo esgotado ao falar com o servidor SMTP")), 30000);
    const fail = (e) => { if (finished) return; finished = true; clearTimeout(timer); try { sock?.destroy(); } catch {} reject(e); };
    const onData = (d) => { buf += d.toString("utf8"); // resposta completa = última linha "NNN " (espaço) ou "NNN" só
      const m = buf.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: [^\r\n]*)?\r\n/); if (m && waiter) { const w = waiter; waiter = null; const full = buf.slice(0, m[0].length); buf = buf.slice(m[0].length); w([parseInt(m[1], 10), full.trim()]); } };
    const attach = (s) => { sock = s; s.on("data", onData); s.on("error", fail); s.on("close", () => { if (!finished) fail(new Error("Conexão SMTP encerrada antes de concluir")); }); };
    const read = () => new Promise(r => { waiter = r; onData(Buffer.alloc(0)); });
    const cmd = async (line, codes) => { if (line !== null) sock.write(line + "\r\n"); const [code, resp] = await read(); if (!codes.includes(code)) throw new Error(`SMTP ${resp.split("\r\n").pop()}`); return resp; };
    const b64 = s => Buffer.from(s, "utf8").toString("base64");
    const wrap = s => s.replace(/(.{76})/g, "$1\r\n");
    const boundary = "b" + Date.now().toString(36);
    const msg = [
      `From: ${cfg.from_name ? `=?UTF-8?B?${b64(cfg.from_name)}?= <${cfg.from}>` : cfg.from}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@detecta-rede>`, "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
      `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(text)),
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(html)),
      `--${boundary}--`, "",
    ].join("\r\n").replace(/\r\n\./g, "\r\n..");
    (async () => {
      attach(cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port }));
      await cmd(null, [220]);
      let ehlo = await cmd("EHLO detecta-rede", [250]);
      if (!cfg.secure && /STARTTLS/i.test(ehlo)) {
        await cmd("STARTTLS", [220]);
        const plain = sock; plain.removeAllListeners("data"); plain.removeAllListeners("close"); plain.removeAllListeners("error");
        await new Promise((res, rej) => { const t = tls.connect({ socket: plain, servername: cfg.host }, () => { attach(t); res(); }); t.once("error", rej); });
        ehlo = await cmd("EHLO detecta-rede", [250]);
      }
      if (cfg.user) {
        if (/AUTH[^\r\n]*LOGIN/i.test(ehlo) || !/AUTH[^\r\n]*PLAIN/i.test(ehlo)) { await cmd("AUTH LOGIN", [334]); await cmd(b64(cfg.user), [334]); await cmd(b64(cfg.pass), [235]); }
        else await cmd("AUTH PLAIN " + b64(`\0${cfg.user}\0${cfg.pass}`), [235]);
      }
      await cmd(`MAIL FROM:<${cfg.from}>`, [250]); await cmd(`RCPT TO:<${to}>`, [250, 251]); await cmd("DATA", [354]);
      await cmd(msg + "\r\n.", [250]);
      try { await cmd("QUIT", [221]); } catch {}
      finished = true; clearTimeout(timer); try { sock.end(); } catch {} resolve(true);
    })().catch(fail);
  });
}

/* ---- fila ---- */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function layout(title, bodyHtml, cta) {
  const site = mailConfig().site;
  return `<!doctype html><html><body style="margin:0;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;color:#1d2a25">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e8e5">
    <div style="background:#0e5c47;color:#fff;padding:16px 22px;font-weight:bold;font-size:16px">Detecta Rede</div>
    <div style="padding:22px;font-size:14px;line-height:1.55"><h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${bodyHtml}
    ${cta && site ? `<p style="margin:20px 0 6px"><a href="${site}${cta.path || ""}" style="background:#0e5c47;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">${esc(cta.label || "Abrir no sistema")}</a></p>` : ""}</div>
    <div style="padding:12px 22px;color:#6b7a74;font-size:11px;border-top:1px solid #e3e8e5">Mensagem automática do sistema de gestão da rede Detecta.${site ? ` Acesse: ${site}` : ""}</div></div></body></html>`;
}
export function enqueue(toList, subject, html, text, ref = null) {
  const cfg = mailConfig(); if (!cfg.enabled) return 0;
  const seen = new Set(); let n = 0;
  for (const to of toList) { const e = String(to || "").trim().toLowerCase(); if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || seen.has(e)) continue; seen.add(e);
    run("insert into mail_outbox(to_email,subject,html,text,ref) values(?,?,?,?,?)", e, subject, html, text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), ref); n++; }
  setTimeout(flush, 50); return n;
}
let flushing = false;
export async function flush() {
  if (flushing) return; const cfg = mailConfig(); if (!cfg.ready || !cfg.enabled) return; flushing = true;
  try {
    const batch = all("select * from mail_outbox where status='pendente' and attempts<6 and (next_at is null or next_at<=datetime('now')) order by id limit 20");
    for (const m of batch) {
      try { await smtpSend(cfg, m.to_email, m.subject, m.html, m.text); run("update mail_outbox set status='enviado', sent_at=datetime('now'), attempts=attempts+1, error=null where id=?", m.id); }
      catch (e) { const a = m.attempts + 1; run("update mail_outbox set attempts=?, error=?, status=?, next_at=datetime('now', ?) where id=?", a, String(e.message).slice(0, 300), a >= 6 ? "falhou" : "pendente", `+${Math.min(60, 2 ** a)} minutes`, m.id); }
    }
  } finally { flushing = false; }
}
export async function sendTest(to) { const cfg = mailConfig(); if (!cfg.ready) throw new Error("Configure servidor SMTP e remetente primeiro."); await smtpSend(cfg, to, "Teste de e-mail — Detecta Rede", layout("Teste de e-mail", "<p>Se você recebeu esta mensagem, o envio de e-mails do Detecta Rede está funcionando.</p>"), "Teste de e-mail do Detecta Rede: envio funcionando."); }
export function startMailer() { setInterval(() => flush().catch(() => {}), 30000); setTimeout(() => flush().catch(() => {}), 3000); }

/* ---- destinatários ---- */
export const recipients = {
  network: () => all("select email from users where active=1 and approval='aprovado' and unit_id is null and role_key in ('admin','gestor')").map(x => x.email),
  unit: (unit_id) => all("select email from users where active=1 and approval='aprovado' and unit_id=?", unit_id).map(x => x.email),
  user: (id) => all("select email from users where id=? and active=1", id).map(x => x.email),
  all: () => all("select email from users where active=1 and approval='aprovado'").map(x => x.email),
  units: (ids) => ids.length ? all(`select email from users where active=1 and approval='aprovado' and unit_id in (${ids.map(() => "?").join(",")})`, ...ids).map(x => x.email) : all("select email from users where active=1 and approval='aprovado' and unit_id is not null").map(x => x.email),
  byRole: (pred) => all("select email, role_key, unit_id from users where active=1 and approval='aprovado'").filter(pred).map(x => x.email),
};
