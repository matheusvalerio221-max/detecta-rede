/* Detecta Rede — frontend fase 1 */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const P = s => (typeof s === "string" && !/[TZ]/.test(s)) ? new Date(s.replace(" ", "T") + "Z") : new Date(s);
const dt = s => s ? P(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const d = s => s ? new Date(s.length === 10 ? s + "T12:00" : s).toLocaleDateString("pt-BR") : "—";
const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._x); t._x = setTimeout(() => t.classList.remove("show"), 2500); };
async function api(path, opts = {}) {
  const r = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/auth/login") { state.me = null; render(); throw new Error(j.error || "Sessão expirada"); }
  if (!r.ok) { toast(j.error || "Erro"); throw new Error(j.error || "Erro"); }
  return j;
}
const state = { me: null, view: "dash", data: {}, sel: null };
const pill = st => { const m = { aberto: "warn", aberta: "warn", andamento: "info", aguardando: "n", resolvido: "ok", concluida: "ok", ativa: "ok", implantacao: "info", inativa: "n", alta: "bad", media: "warn", baixa: "n" };
  const lbl = { concluida: "concluída", implantacao: "implantação", media: "média" }; return `<span class="pill ${m[st] || "n"}">${lbl[st] || st}</span>`; };
const can = (mod, a = 0) => !!state.me?.perms?.[mod]?.[a];
const isNet = () => state.me?.scope === "network";

const I = {
  dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  units: '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>',
  tk: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  com: '<svg viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  task: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  sec: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
  soon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  chk: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  uni: '<svg viewBox="0 0 24 24"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
};
const NAV = [
  { g: "Visão geral", items: [["dash", "Painel", I.dash, "dash"], ["units", "Unidades", I.units, "units"]] },
  { g: "Operação", items: [["tk", "Chamados (SAF)", I.tk, "tickets"], ["com", "Comunicados", I.com, "comms"], ["task", "Tarefas", I.task, "tasks"], ["chk", "Checklist", I.chk, "checklist"]] },
  { g: "Pessoas", items: [["uni", "Universidade", I.uni, "university"]] },
  { g: "Configuração", items: [["sec", "Usuários e segurança", I.sec, "users"]] },
  { g: "Próximas fases", items: [["soon", "Expansão, Implantação, Disco Virtual…", I.soon, "dash"]] },
];
const titles = Object.fromEntries(NAV.flatMap(g => g.items.map(([k, n]) => [k, n])));

/* ---------- Shell ---------- */
function render() {
  const root = $("#root");
  if (!state.me) { root.innerHTML = loginView(); bindLogin(); return; }
  root.innerHTML = `<div class="app">
    <aside class="sb" id="sb"><div class="logo"><div class="mark">D</div><div><b>Detecta Rede</b><small>Gestão da rede de franquias</small></div></div><div class="brand"><img src="/logo-detecta.png" alt="Detecta — Manejo e Controle Integrado de Pragas Urbanas"></div>
      ${NAV.map(g => { const items = g.items.filter(([k, , , mod]) => mod === "dash" || can(mod)); return items.length ? `<div class="grp"><span>${g.g}</span>${items.map(([k, n, ic]) => `<button class="nav ${k === state.view ? "on" : ""}" data-k="${k}">${ic}<span>${k === "units" && !isNet() ? "Minha unidade" : n}</span>${state.counts?.[k] ? `<span class="cnt">${state.counts[k]}</span>` : ""}</button>`).join("")}</div>` : ""; }).join("")}
      <div class="grp" style="margin-top:auto"><button class="nav" id="logout">⎋ <span>Sair</span></button></div></aside>
    <div class="overlay" id="ov"></div>
    <div class="main"><header class="top"><button class="burger" id="burger" aria-label="Menu">☰</button>
      <div class="crumb">Detecta Rede · ${esc(state.me.role_name)}${state.me.unit_name ? " · " + esc(state.me.unit_name) : ""}<b>${titles[state.view]}</b></div>
      <div class="search" style="min-width:0"></div>
      <button class="avatar" id="meBtn" title="Minha conta" style="border:0;cursor:pointer">${esc(state.me.name.split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase())}</button></header>
    <main class="content" id="view"><div class="empty">Carregando…</div></main></div></div>`;
  $("#sb").addEventListener("click", e => { const b = e.target.closest(".nav"); if (!b) return; if (b.id === "logout") return logout(); go(b.dataset.k); });
  $("#burger").onclick = () => { $("#sb").classList.add("open"); $("#ov").classList.add("open"); };
  $("#ov").onclick = closeSb; $("#meBtn").onclick = accountModal;
  loadView();
}
const closeSb = () => { $("#sb")?.classList.remove("open"); $("#ov")?.classList.remove("open"); };
function go(k, keepFilter) { if (!keepFilter) state.tkFilter = null; state.view = k; state.sel = null; closeSb(); render(); }
async function logout() { await api("/auth/logout", { method: "POST" }); state.me = null; render(); }
async function loadView() { try { await views[state.view](); } catch (e) { $("#view").innerHTML = `<div class="empty">${esc(e.message)}</div>`; } resizableTables($("#view"), state.view); }

/* ---------- Colunas redimensionáveis (arraste a borda do cabeçalho; duplo clique = automático; largura salva no navegador) ---------- */
function resizableTables(root, key) {
  root.querySelectorAll("table").forEach((tbl, ti) => {
    const ths = [...tbl.querySelectorAll("tr:first-child th")]; if (!ths.length || tbl.dataset.rz) return; tbl.dataset.rz = "1";
    const sk = `rz:${key}:${ti}:${ths.length}`; let saved = {}; try { saved = JSON.parse(localStorage.getItem(sk) || "{}"); } catch {}
    const apply = (i, w) => { const th = ths[i]; const cells = [...tbl.querySelectorAll(`tr > :nth-child(${i + 1})`)]; if (w) { th.style.width = th.style.minWidth = w + "px"; cells.forEach(c => c.classList.add("nw")); } else { th.style.width = th.style.minWidth = ""; cells.forEach(c => c.classList.remove("nw")); } };
    ths.forEach((th, i) => {
      th.classList.add("rzh"); const h = document.createElement("span"); h.className = "rz"; th.appendChild(h);
      if (saved[i]) apply(i, saved[i]);
      h.addEventListener("dblclick", e => { e.stopPropagation(); delete saved[i]; apply(i, 0); try { localStorage.setItem(sk, JSON.stringify(saved)); } catch {} });
      h.addEventListener("mousedown", e => {
        e.preventDefault(); e.stopPropagation(); const x0 = e.clientX, w0 = th.getBoundingClientRect().width; document.body.classList.add("rz-on");
        const mv = ev => apply(i, Math.max(50, Math.round(w0 + ev.clientX - x0)));
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); document.body.classList.remove("rz-on"); saved[i] = parseInt(th.style.width, 10) || 0; try { localStorage.setItem(sk, JSON.stringify(saved)); } catch {} };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
      });
    });
  });
}
const hd = (t, p, acts = "") => `<div class="hd"><div><h2>${t}</h2>${p ? `<p>${p}</p>` : ""}</div><div class="act">${acts}</div></div>`;

/* ---------- Login ---------- */
const authHead = `<div class="logo"><div class="mark">D</div><div><b>Detecta Rede</b><small>Gestão da rede de franquias</small></div></div><div class="brand" style="padding:0 0 14px"><img src="/logo-detecta.png" alt="Detecta — Manejo e Controle Integrado de Pragas Urbanas"></div>`;
function loginView() {
  const m = state.authMode || "login";
  if (m === "forgot") return `<div class="login"><form class="box" id="forgotForm">${authHead}
    <h3 style="font-size:16px;margin-bottom:6px">Esqueci minha senha</h3><p class="small muted" style="margin-bottom:12px">Informe o e-mail do seu acesso. Enviaremos um link para criar uma nova senha.</p>
    <div class="fg"><div><label class="f" for="femail">E-mail</label><input class="in" id="femail" type="email" autocomplete="username" required value="${esc(state.lastEmail || "")}"></div>
    <button class="btn p" style="justify-content:center">Enviar link</button></div><div id="loginErr"></div>
    <p style="text-align:center;margin-top:14px"><button type="button" class="linkbtn" id="toLogin">← Voltar para o login</button></p></form></div>`;
  if (m === "reset") return `<div class="login"><form class="box" id="resetForm">${authHead}
    <h3 style="font-size:16px;margin-bottom:6px">Criar nova senha</h3><p class="small muted" style="margin-bottom:12px">Mínimo de 8 caracteres. Evite datas e o nome da empresa.</p>
    <div class="fg"><div><label class="f" for="np1">Nova senha</label><input class="in" id="np1" type="password" autocomplete="new-password" minlength="8" required></div>
    <div><label class="f" for="np2">Repita a nova senha</label><input class="in" id="np2" type="password" autocomplete="new-password" minlength="8" required></div>
    <button class="btn p" style="justify-content:center">Salvar nova senha</button></div><div id="loginErr"></div>
    <p style="text-align:center;margin-top:14px"><button type="button" class="linkbtn" id="toLogin">Cancelar</button></p></form></div>`;
  return `<div class="login"><form class="box" id="loginForm">${authHead}
    <div class="fg"><div><label class="f" for="email">E-mail</label><input class="in" id="email" type="email" autocomplete="username" required value="${esc(state.lastEmail || "")}"></div>
    <div><label class="f" for="password">Senha</label><input class="in" id="password" type="password" autocomplete="current-password" required></div>
    <button class="btn p" style="justify-content:center">Entrar</button></div><div id="loginErr">${state.authMsg ? `<div class="okmsg">${esc(state.authMsg)}</div>` : ""}</div>
    <p style="text-align:center;margin-top:14px"><button type="button" class="linkbtn" id="toForgot">Esqueci minha senha</button></p></form></div>`;
}
function bindLogin() {
  const err = (m) => { $("#loginErr").innerHTML = `<div class="err">${esc(m)}</div>`; };
  const go2 = (mode, msg) => { state.authMode = mode; state.authMsg = msg || null; render(); };
  $("#toForgot") && ($("#toForgot").onclick = () => { state.lastEmail = $("#email").value; go2("forgot"); });
  $("#toLogin") && ($("#toLogin").onclick = () => { if (state.authMode === "reset") history.replaceState(null, "", location.pathname); state.resetToken = null; go2("login"); });
  const lf = $("#loginForm"); if (lf) lf.onsubmit = async e => { e.preventDefault(); $("#loginErr").innerHTML = ""; state.authMsg = null;
    try { await api("/auth/login", { method: "POST", body: { email: $("#email").value, password: $("#password").value } }); await boot(); }
    catch (ex) { err(ex.message); } };
  const ff = $("#forgotForm"); if (ff) ff.onsubmit = async e => { e.preventDefault(); const b = ff.querySelector("button.p"); b.disabled = true;
    try { state.lastEmail = $("#femail").value; const r = await api("/auth/forgot", { method: "POST", body: { email: state.lastEmail } }); go2("login", r.message + " Verifique também a caixa de spam."); }
    catch (ex) { err(ex.message); b.disabled = false; } };
  const rf = $("#resetForm"); if (rf) rf.onsubmit = async e => { e.preventDefault();
    if ($("#np1").value !== $("#np2").value) return err("As duas senhas não são iguais.");
    try { const r = await api("/auth/reset", { method: "POST", body: { token: state.resetToken, password: $("#np1").value } });
      history.replaceState(null, "", location.pathname); state.resetToken = null; state.lastEmail = r.email; go2("login", "Senha alterada. Entre com a nova senha."); }
    catch (ex) { err(ex.message); } };
}

/* ---------- Olho para mostrar/ocultar senha (todos os campos de senha) ---------- */
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 19c-7 0-11-7-11-7a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/></svg>';
function addEyes(root = document) {
  root.querySelectorAll("input[type=password]:not([data-eye])").forEach(inp => {
    inp.dataset.eye = "1"; const w = document.createElement("span"); w.className = "pw"; inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
    const b = document.createElement("button"); b.type = "button"; b.className = "pw-eye"; b.tabIndex = -1; b.setAttribute("aria-label", "Mostrar senha"); b.title = "Mostrar senha"; b.innerHTML = EYE;
    b.onclick = () => { const show = inp.type === "password"; inp.type = show ? "text" : "password"; b.innerHTML = show ? EYE_OFF : EYE; b.title = show ? "Ocultar senha" : "Mostrar senha"; b.setAttribute("aria-label", b.title); inp.focus(); };
    w.appendChild(b);
  });
}
new MutationObserver(() => addEyes()).observe(document.body, { childList: true, subtree: true });

/* ---------- Modal helper ---------- */
function modal(title, body, onSave, saveLabel = "Salvar") {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<form class="modal"><h3>${title}</h3>${body}<div class="acts"><button type="button" class="btn" data-x>Cancelar</button>${onSave ? `<button class="btn p">${saveLabel}</button>` : ""}</div></form>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("[data-x]").onclick = close; bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg.querySelector("form").onsubmit = async e => { e.preventDefault(); if (!onSave) return close(); const f = new FormData(e.target); const o = Object.fromEntries(f.entries()); try { await onSave(o, e.target); close(); } catch {} };
  return bg;
}
const opt = (list, v, k = "id", n = "name") => list.map(x => `<option value="${x[k]}" ${String(x[k]) === String(v) ? "selected" : ""}>${esc(x[n])}</option>`).join("");

function accountModal() {
  modal("Minha conta", `<p class="small">${esc(state.me.name)} · ${esc(state.me.email)} · ${esc(state.me.role_name)}</p>
    <div class="fg"><div><label class="f">Senha atual</label><input class="in" name="current" type="password" required></div><div><label class="f">Nova senha (mín. 8)</label><input class="in" name="next" type="password" required minlength="8"></div></div>`,
    async o => { await api("/me/password", { method: "POST", body: o }); toast("Senha alterada"); }, "Alterar senha");
}

/* ---------- Views ---------- */
const views = {};
views.dash = async () => {
  const dd = await api("/dashboard");
  const n = (arr, k) => arr.find(x => x.status === k)?.n || 0;
  const openT = n(dd.tickets, "aberto") + n(dd.tickets, "andamento") + n(dd.tickets, "aguardando");
  const slaPct = dd.sla.total ? Math.round(dd.sla.ok / dd.sla.total * 100) : null;
  state.counts = { tk: openT, task: n(dd.tasks, "aberta") + n(dd.tasks, "andamento"), com: dd.comms.filter(c => !c.read_by_me).length, sec: dd.pendingUsers || 0 };
  $("#sb").querySelectorAll(".nav").forEach(b => { const c = state.counts[b.dataset.k]; b.querySelector(".cnt")?.remove(); if (c) b.insertAdjacentHTML("beforeend", `<span class="cnt">${c}</span>`); });
  $("#view").innerHTML = hd(isNet() ? "Painel da rede" : `Painel — ${esc(state.me.unit_name)}`, "O que precisa de atenção hoje.") +
    `<div class="grid g4">
      ${isNet() ? `<div class="card kpi"><div class="l">Unidades ativas</div><div class="v">${n(dd.units, "ativa")} <span class="muted" style="font-size:14px">${n(dd.units, "implantacao") ? "+" + n(dd.units, "implantacao") + " em implantação" : ""}</span></div><div class="d">${dd.totalUsers} usuários ativos</div></div>` : ""}
      <div class="card kpi"><div class="l">Chamados abertos</div><div class="v">${openT}</div><div class="d ${dd.sla.late ? "dn" : ""}">${dd.sla.late ? dd.sla.late + " com SLA estourado" : "SLA em dia"}</div></div>
      <div class="card kpi"><div class="l">Resolvidos no SLA (30 dias)</div><div class="v">${slaPct === null ? "—" : slaPct + "%"}</div><div class="d">${dd.sla.total || 0} resolvidos</div></div>
      <div class="card kpi"><div class="l">Tarefas em aberto</div><div class="v">${state.counts.task}</div><div class="d">${n(dd.tasks, "concluida")} concluídas</div></div>
      ${isNet() ? "" : `<div class="card kpi"><div class="l">Comunicados não lidos</div><div class="v">${state.counts.com}</div><div class="d">Confirme a leitura</div></div>`}
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h3>Últimos comunicados</h3>${dd.comms.length ? dd.comms.map(c => `<div class="post"><b>${esc(c.title)}</b><div class="m">${dt(c.published_at)} · ${c.reads} confirmações</div>${c.read_by_me ? '<span class="pill ok">Lido</span>' : `<button class="btn p s" data-ack="${c.id}">Confirmar leitura</button>`}</div>`).join("") : '<div class="empty">Nenhum comunicado ainda.</div>'}</div>
      <div class="card"><h3>Atividade recente</h3>${dd.activity.length ? `<ul class="timeline">${dd.activity.map(a => `<li>${esc(a.message)}<small>${dt(a.at)}${a.user_name ? " · " + esc(a.user_name) : ""}${a.unit_name ? " · " + esc(a.unit_name) : ""}</small></li>`).join("")}</ul>` : '<div class="empty">Sem atividade ainda.</div>'}</div>
    </div>`;
  $("#view").onclick = async e => { const b = e.target.closest("[data-ack]"); if (b) { await api(`/comms/${b.dataset.ack}/ack`, { method: "POST" }); toast("Ciência registrada"); loadView(); } };
};

views.units = async () => {
  const units = await api("/units");
  $("#view").innerHTML = hd(isNet() ? "Unidades" : "Minha unidade", isNet() ? "Cadastro único da rede — a mesma base alimenta todos os módulos." : "Dados cadastrais da sua unidade. Para alterar, abra um chamado para a franqueadora.", can("units", 1) ? `<button class="btn p" id="newUnit">+ Nova unidade</button>` : "") +
    `<div class="card"><div class="tw"><table><tr><th>Unidade</th><th>Cidade</th><th>Franqueado</th><th>Contato</th><th>Desde</th><th>Usuários</th><th title="Chamados abertos (sem resposta)">Abertos</th><th title="Chamados em andamento ou aguardando">Em andamento</th><th title="Chamados finalizados">Finalizados</th><th>Status</th></tr>
    ${units.map(u => `<tr class="${can("units", 2) ? "rowc" : ""}" data-id="${u.id}"><td><b>${esc(u.name)}</b>${u.is_hq ? ' <span class="pill brand">matriz</span>' : ""}</td><td>${esc(u.city || "")}${u.state ? "/" + esc(u.state) : ""}</td><td>${esc(u.franchisee || "—")}</td><td class="small">${esc(u.phone || "")}<br>${esc(u.email || "")}</td><td class="num">${u.opened_at ? new Date(u.opened_at).getFullYear() : "—"}</td><td class="num">${u.users}</td><td><span class="cnt-t bad" data-tk="${u.id}|aberto">${u.t_open}</span></td><td><span class="cnt-t warn" data-tk="${u.id}|andamento">${u.t_progress}</span></td><td><span class="cnt-t ok" data-tk="${u.id}|resolvido">${u.t_done}</span></td><td>${pill(u.status)}</td></tr>`).join("")}</table></div>
    <div class="small muted" style="margin-top:8px">Chamados: <span class="cnt-t bad">abertos</span> aguardam primeira resposta · <span class="cnt-t warn">em andamento</span> inclui “aguardando” · <span class="cnt-t ok">finalizados</span>. Clique em um número para ver os chamados.</div></div>`;
  $("#view").querySelectorAll("[data-tk]").forEach(el => el.onclick = e => { e.stopPropagation(); const [uid, st] = el.dataset.tk.split("|"); state.tkFilter = { unit_id: +uid, status: st, unit_name: units.find(x => x.id === +uid)?.name }; go("tk", true); });
  const form = (u = {}) => `<div class="fg"><div><label class="f">Nome</label><input class="in" name="name" value="${esc(u.name || "")}" required></div>
    <div class="grid g2"><div><label class="f">Cidade</label><input class="in" name="city" value="${esc(u.city || "")}"></div><div><label class="f">UF</label><input class="in" name="state" value="${esc(u.state || "SP")}" maxlength="2"></div></div>
    <div><label class="f">Franqueado responsável</label><input class="in" name="franchisee" value="${esc(u.franchisee || "")}"></div>
    <div class="grid g2"><div><label class="f">Telefone</label><input class="in" name="phone" value="${esc(u.phone || "")}"></div><div><label class="f">E-mail</label><input class="in" name="email" type="email" value="${esc(u.email || "")}"></div></div>
    <div class="grid g2"><div><label class="f">CNPJ</label><input class="in" name="cnpj" value="${esc(u.cnpj || "")}"></div><div><label class="f">Inauguração</label><input class="in" name="opened_at" type="date" value="${u.opened_at ? u.opened_at.slice(0, 10) : ""}"></div></div>
    <div><label class="f">Status</label><select class="in" name="status">${["ativa", "implantacao", "inativa"].map(s => `<option value="${s}" ${u.status === s ? "selected" : ""}>${s === "implantacao" ? "implantação" : s}</option>`).join("")}</select></div></div>`;
  $("#newUnit") && ($("#newUnit").onclick = () => modal("Nova unidade", form(), async o => { await api("/units", { method: "POST", body: o }); toast("Unidade cadastrada"); loadView(); }));
  $("#view").querySelectorAll("tr.rowc").forEach(tr => tr.onclick = () => { const u = units.find(x => x.id == tr.dataset.id); modal("Editar unidade", form(u), async o => { await api(`/units/${u.id}`, { method: "PUT", body: o }); toast("Unidade atualizada"); loadView(); }); });
};

views.tk = async () => {
  let [list, cats, units] = await Promise.all([api("/tickets"), api("/tickets/categories"), isNet() ? api("/units") : Promise.resolve([])]);
  const F = state.tkFilter; if (F) list = list.filter(t => t.unit_id === F.unit_id && (F.status === "andamento" ? ["andamento", "aguardando"].includes(t.status) : t.status === F.status));
  const slaLabel = t => { if (t.status === "resolvido") return pill("resolvido"); const h = (P(t.sla_due) - Date.now()) / 36e5; return h < 0 ? `<span class="pill late">SLA estourado</span>` : h < 1.5 ? `<span class="pill warn">SLA ${Math.round(h * 60)} min</span>` : `<span class="pill info">SLA ${h.toFixed(1)}h</span>`; };
  const sel = state.sel || list.find(t => t.status !== "resolvido")?.id || list[0]?.id;
  $("#view").innerHTML = hd("Chamados — SAF", F ? `Filtro: <b>${esc(F.unit_name || "unidade")}</b> · ${{ aberto: "abertos", andamento: "em andamento", resolvido: "finalizados" }[F.status]} (${list.length}) <button class="btn s" id="tkClear">Limpar filtro</button>` : "Atendimento ao franqueado com SLA por categoria. Tudo registrado e rastreável.", `${isNet() && can("tickets", 2) ? '<button class="btn" id="tkCats">Categorias e SLA</button>' : ""}${can("tickets", 1) ? `<button class="btn p" id="newTk">+ Abrir chamado</button>` : ""}`) +
    (list.length ? `<div class="tk"><div class="tl">${list.map(t => `<div class="ti ${t.id === sel ? "on" : ""}" data-tk="${t.id}"><b>#${t.id} · ${esc(t.title)}</b><div class="m"><span>${esc(t.unit_name)}</span><span>${esc(t.department || "—")}</span>${slaLabel(t)}</div></div>`).join("")}</div><div id="tkDetail" class="card"><div class="empty">Carregando…</div></div></div>` : `<div class="card"><div class="empty">Nenhum chamado. ${can("tickets", 1) ? "Abra o primeiro pelo botão acima." : ""}</div></div>`);
  const detail = async id => {
    const t = await api(`/tickets/${id}`); state.sel = id;
    $("#view").querySelectorAll(".ti").forEach(x => x.classList.toggle("on", x.dataset.tk == id));
    $("#tkDetail").innerHTML = `<h3>#${t.id} · ${esc(t.title)} <span class="sub">${esc(t.unit_name)} · ${esc(t.category || "sem categoria")} · prioridade ${t.priority} · SLA ${t.opener_role && ["franqueado", "tecnico"].includes(t.opener_role) ? `${t.sla_hours || 8}h (franqueadora responde)` : `${t.sla_unit_hours || 24}h (franqueado responde)`} · aberto ${dt(t.created_at)}</span></h3>
      ${attHtml(t, (t.attachments || []).filter(a => !a.message_id))}
      <div class="chat">${t.messages.map(m => { const mine = m.user_id === state.me.id; return `<div class="msg ${mine ? "me" : ""}" ${m.internal ? 'style="border:1px dashed var(--warn)"' : ""}>${esc(m.body)}${attHtml(t, (t.attachments || []).filter(a => a.message_id === m.id))}<small>${esc(m.user_name || "")}${m.internal ? " · nota interna" : ""} · ${dt(m.created_at)}</small></div>`; }).join("") || '<div class="empty">Sem mensagens.</div>'}</div>
      ${t.status !== "resolvido" && can("tickets", 1) ? `<form id="tkMsgForm" class="row" style="margin-top:10px;flex-wrap:wrap"><input class="in" name="body" placeholder="Escreva uma resposta…" required style="flex:1;min-width:200px">${isNet() ? '<label class="small" style="white-space:nowrap"><input type="checkbox" name="internal"> interna</label>' : ""}<label class="btn s" title="Anexar foto ou PDF">📎<input type="file" name="files" multiple accept="image/*,.pdf" style="display:none"></label><button class="btn p">Enviar</button></form>` : ""}
      <div class="row" style="margin-top:10px">${pill(t.status)}${can("tickets", 2) && t.status !== "resolvido" ? `<select class="in" id="tkStatus" style="width:auto">${["aberto", "andamento", "aguardando", "resolvido"].map(s => `<option value="${s}" ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><button class="btn s" id="tkTask">Criar tarefa</button>` : ""}${t.status === "resolvido" && can("tickets", 2) ? `<button class="btn s" id="tkReopen">Reabrir</button>` : ""}</div>`;
    const f = $("#tkMsgForm"); if (f) { const fi = f.querySelector("[name=files]"); fi.onchange = () => { fi.parentElement.textContent = fi.files.length ? `📎 ${fi.files.length}` : "📎"; fi.parentElement.appendChild(fi); };
      f.onsubmit = async e => { e.preventDefault(); const o = Object.fromEntries(new FormData(f)); const m = await api(`/tickets/${t.id}/messages`, { method: "POST", body: { body: o.body, internal: !!o.internal } }); await uploadFiles(t.id, fi.files, m.id); detail(t.id); }; }
    const s = $("#tkStatus"); if (s) s.onchange = async () => { await api(`/tickets/${t.id}`, { method: "PATCH", body: { status: s.value } }); toast("Status atualizado"); loadView(); };
    const rb = $("#tkReopen"); if (rb) rb.onclick = async () => { await api(`/tickets/${t.id}`, { method: "PATCH", body: { status: "andamento" } }); loadView(); };
    const tb = $("#tkTask"); if (tb) tb.onclick = () => taskModal({ title: `Chamado #${t.id}: ${t.title}`, source: "chamado", source_ref: `ticket:${t.id}`, unit_id: t.unit_id }, () => toast("Tarefa criada"));
  };
  if (sel) detail(sel);
  $("#view").querySelectorAll(".ti").forEach(x => x.onclick = () => detail(+x.dataset.tk));
  $("#newTk") && ($("#newTk").onclick = () => modal("Abrir chamado", `<div class="fg">${isNet() ? `<div><label class="f">Unidade</label><select class="in" name="unit_id" required>${opt(units, state.me.unit_id)}</select></div>` : ""}
      <div><label class="f">Assunto</label><input class="in" name="title" required></div>
      <div class="grid g2"><div><label class="f">Categoria</label><select class="in" name="category_id">${cats.map(c => `<option value="${c.id}">${esc(c.name)} (SLA ${isNet() ? `${c.sla_unit_hours}h p/ franqueado` : `${c.sla_hours}h p/ franqueadora`})</option>`).join("")}</select></div><div><label class="f">Prioridade</label><select class="in" name="priority"><option value="baixa">baixa</option><option value="media" selected>média</option><option value="alta">alta</option></select></div></div>
      <div><label class="f">Descrição</label><textarea class="in" name="body" rows="4" required></textarea></div>${fileInput()}</div>`,
    async (o, form) => { delete o.files; const t = await api("/tickets", { method: "POST", body: o }); await uploadFiles(t.id, form.querySelector("[name=files]").files); state.sel = t.id; toast(`Chamado #${t.id} aberto`); loadView(); }, "Abrir"));
  $("#tkCats") && ($("#tkCats").onclick = catsModal);
  $("#tkClear") && ($("#tkClear").onclick = () => { state.tkFilter = null; state.sel = null; loadView(); });
};

/* Anexos de chamado */
async function uploadFiles(ticketId, files, messageId) {
  for (const f of files || []) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name}: maior que 10 MB, ignorado`); continue; }
    const q = `?filename=${encodeURIComponent(f.name)}${messageId ? `&message_id=${messageId}` : ""}`;
    const r = await fetch(`/api/tickets/${ticketId}/attachments${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(`${f.name}: ${j.error || "falha no envio"}`); }
  }
}
const attHtml = (t, list) => list.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${list.map(a => a.mime.startsWith("image/")
  ? `<a href="/api/tickets/${t.id}/attachments/${a.id}" target="_blank" title="${esc(a.filename)}"><img src="/api/tickets/${t.id}/attachments/${a.id}" alt="${esc(a.filename)}" style="height:72px;max-width:120px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"></a>`
  : `<a class="btn s" href="/api/tickets/${t.id}/attachments/${a.id}" target="_blank">📄 ${esc(a.filename)}</a>`).join("")}</div>` : "";
const fileInput = (name = "files") => `<div><label class="f">Anexos (fotos ou PDF, até 10 MB cada)</label><input class="in" type="file" name="${name}" multiple accept="image/*,.pdf"></div>`;

/* Categorias de chamado + SLA (franqueadora) */
async function catsModal() {
  const cats = await api("/tickets/categories?all=1");
  const row = c => `<tr data-cat="${c.id || ""}"><td><input class="in" name="name" value="${esc(c.name || "")}" placeholder="Nome" style="min-width:150px"></td><td><input class="in" name="department" value="${esc(c.department || "")}" placeholder="Área"></td>
    <td><input class="in num" name="sla_hours" type="number" min="1" max="720" value="${c.sla_hours ?? 8}" style="width:70px"></td><td><input class="in num" name="sla_unit_hours" type="number" min="1" max="720" value="${c.sla_unit_hours ?? 24}" style="width:70px"></td>
    <td style="text-align:center">${c.id ? `<input type="checkbox" name="active" ${c.active ? "checked" : ""}>` : ""}</td><td><button class="btn s p" data-save>${c.id ? "Salvar" : "Criar"}</button></td></tr>`;
  modal("Categorias de chamado e SLA", `<div class="small muted" style="margin-bottom:8px"><b>SLA franqueadora</b>: prazo (horas) para a franqueadora responder um chamado aberto pelo franqueado. <b>SLA franqueado</b>: prazo para o franqueado responder um chamado aberto pela franqueadora. Categoria inativa some da lista de abertura, chamados antigos ficam.</div>
    <div class="tw"><table id="catTbl"><tr><th>Categoria</th><th>Área</th><th>SLA franqueadora (h)</th><th>SLA franqueado (h)</th><th>Ativa</th><th></th></tr>${cats.map(row).join("")}${row({})}</table></div>`, null);
  $("#catTbl").onclick = async e => {
    const b = e.target.closest("[data-save]"); if (!b) return; const tr = b.closest("tr"); const o = {}; tr.querySelectorAll("input").forEach(i => o[i.name] = i.type === "checkbox" ? i.checked : i.value);
    const id = tr.dataset.cat;
    try { await api(id ? `/tickets/categories/${id}` : "/tickets/categories", { method: id ? "PUT" : "POST", body: o }); toast(id ? "Categoria atualizada" : "Categoria criada"); document.querySelector(".modal-bg")?.remove(); loadView(); catsModal(); }
    catch (err) { toast(err.message, true); }
  };
}

views.com = async () => {
  const [list, units] = await Promise.all([api("/comms"), can("comms", 1) ? api("/units") : Promise.resolve([])]);
  $("#view").innerHTML = hd("Comunicados", "Mensagens oficiais com confirmação de leitura: a franqueadora sabe quem leu e quando.", can("comms", 1) ? `<button class="btn p" id="newCom">+ Novo comunicado</button>` : "") +
    `<div class="card">${list.length ? list.map(c => `<div class="post"><b>${esc(c.title)}</b><div class="m">${esc(c.author_name || "")} · ${dt(c.published_at)} · para: ${c.audience === "all" ? "toda a rede" : c.audience === "hq" ? "franqueadora" : "unidades selecionadas"}</div><p class="md" style="margin:0 0 8px">${esc(c.body)}</p>
      <div class="row" style="gap:8px">${can("comms", 2) ? `<div class="bar" style="width:160px"><i class="${c.reads >= c.target ? "ok" : ""}" style="width:${c.target ? Math.min(100, c.reads / c.target * 100) : 0}%"></i></div><span class="small num">${c.reads}/${c.target} confirmaram</span><button class="btn s" data-reads="${c.id}">Ver quem leu</button>` : ""}
      ${c.read_by_me ? '<span class="pill ok">✓ Ciência confirmada</span>' : `<button class="btn p s" data-ack="${c.id}">Confirmar leitura</button>`}</div></div>`).join("") : '<div class="empty">Nenhum comunicado publicado.</div>'}</div>`;
  $("#view").onclick = async e => {
    const a = e.target.closest("[data-ack]"); if (a) { await api(`/comms/${a.dataset.ack}/ack`, { method: "POST" }); toast("Ciência registrada"); return loadView(); }
    const r = e.target.closest("[data-reads]"); if (r) { const rows = await api(`/comms/${r.dataset.reads}/reads`); modal("Confirmações de leitura", `<div class="tw"><table><tr><th>Usuário</th><th>Unidade</th><th>Leu em</th></tr>${rows.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.unit_name || "Franqueadora")}</td><td>${x.read_at ? dt(x.read_at) : '<span class="pill warn">pendente</span>'}</td></tr>`).join("")}</table></div>`, null); }
  };
  $("#newCom") && ($("#newCom").onclick = () => modal("Novo comunicado", `<div class="fg"><div><label class="f">Título</label><input class="in" name="title" required></div><div><label class="f">Texto</label><textarea class="in" name="body" rows="6" required></textarea></div>
    <div><label class="f">Destinatários</label><select class="in" name="audience"><option value="all">Toda a rede</option><option value="units">Unidades selecionadas</option><option value="hq">Somente franqueadora</option></select></div>
    <div><label class="f">Unidades (se "selecionadas")</label><select class="in" name="unit_ids" multiple size="5">${units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></div></div>`,
    async (o, f) => { const ids = [...f.querySelector("[name=unit_ids]").selectedOptions].map(x => +x.value); await api("/comms", { method: "POST", body: { ...o, unit_ids: ids } }); toast("Comunicado publicado"); loadView(); }, "Publicar"));
};

async function taskModal(pre = {}, after) {
  const [users, units] = await Promise.all([can("users") ? api("/users") : Promise.resolve([]), isNet() ? api("/units") : Promise.resolve([])]);
  modal(pre.id ? "Editar tarefa" : "Nova tarefa", `<div class="fg"><div><label class="f">Título</label><input class="in" name="title" value="${esc(pre.title || "")}" required></div>
    <div><label class="f">Descrição</label><textarea class="in" name="description" rows="3">${esc(pre.description || "")}</textarea></div>
    <div class="grid g2"><div><label class="f">Responsável</label><select class="in" name="assigned_to"><option value="">Eu</option>${opt(users, pre.assigned_to)}</select></div><div><label class="f">Prazo</label><input class="in" name="due_date" type="date" value="${pre.due_date ? String(pre.due_date).slice(0, 10) : ""}"></div></div>
    <div class="grid g2"><div><label class="f">Prioridade</label><select class="in" name="priority">${["baixa", "media", "alta"].map(p => `<option value="${p}" ${(pre.priority || "media") === p ? "selected" : ""}>${p === "media" ? "média" : p}</option>`).join("")}</select></div>
    ${isNet() ? `<div><label class="f">Unidade</label><select class="in" name="unit_id"><option value="">—</option>${opt(units, pre.unit_id)}</select></div>` : ""}</div>
    ${pre.id ? `<div><label class="f">Status</label><select class="in" name="status">${["aberta", "andamento", "concluida"].map(s => `<option value="${s}" ${pre.status === s ? "selected" : ""}>${s === "concluida" ? "concluída" : s}</option>`).join("")}</select></div>` : ""}</div>`,
    async o => { const body = { ...o, source: pre.source, source_ref: pre.source_ref, assigned_to: o.assigned_to || null, unit_id: o.unit_id || pre.unit_id || null, due_date: o.due_date || null };
      if (pre.id) await api(`/tasks/${pre.id}`, { method: "PATCH", body }); else await api("/tasks", { method: "POST", body }); after && after(); });
}
views.task = async () => {
  const list = await api("/tasks");
  const late = t => t.status !== "concluida" && t.due_date && new Date(t.due_date) < new Date(new Date().toDateString());
  $("#view").innerHTML = hd("Tarefas", "Planos de ação e pendências, com prazo e responsável. Chamados geram tarefas aqui.", can("tasks", 1) ? `<button class="btn p" id="newTask">+ Tarefa</button>` : "") +
    `<div class="card">${list.length ? `<div class="tw"><table><tr><th></th><th>Tarefa</th><th>Origem</th><th>Unidade</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th>Status</th></tr>
    ${list.map(t => `<tr class="rowc" data-id="${t.id}"><td><input type="checkbox" data-done="${t.id}" ${t.status === "concluida" ? "checked" : ""} ${can("tasks", 2) ? "" : "disabled"} style="accent-color:var(--brand);width:16px;height:16px"></td><td ${t.status === "concluida" ? 'style="text-decoration:line-through;color:var(--ink-3)"' : ""}>${esc(t.title)}</td><td><span class="pill n">${esc(t.source)}</span></td><td class="small">${esc(t.unit_name || "—")}</td><td>${esc(t.assigned_name || "—")}</td><td class="num ${late(t) ? "" : ""}">${late(t) ? `<span class="pill late">${d(t.due_date)}</span>` : d(t.due_date)}</td><td>${pill(t.priority)}</td><td>${pill(t.status)}</td></tr>`).join("")}</table></div>` : '<div class="empty">Nenhuma tarefa.</div>'}</div>`;
  $("#view").onclick = async e => {
    const cb = e.target.closest("[data-done]"); if (cb) { e.stopPropagation(); await api(`/tasks/${cb.dataset.done}`, { method: "PATCH", body: { status: cb.checked ? "concluida" : "aberta" } }); return loadView(); }
    const tr = e.target.closest("tr.rowc"); if (tr && can("tasks", 2)) taskModal(list.find(t => t.id == tr.dataset.id), () => { toast("Tarefa atualizada"); loadView(); });
  };
  $("#newTask") && ($("#newTask").onclick = () => taskModal({}, () => { toast("Tarefa criada"); loadView(); }));
};

views.sec = async () => {
  const [users, roles, units] = await Promise.all([api("/users"), api("/roles"), api("/units")]);
  const mods = [["units", "Unidades"], ["users", "Usuários"], ["tickets", "Chamados"], ["comms", "Comunicados"], ["tasks", "Tarefas"], ["checklist", "Checklist"], ["university", "Universidade"], ["security", "Segurança"]];
  const roleSel = state.roleSel || "franqueado"; const role = roles.find(r => r.key === roleSel);
  $("#view").innerHTML = hd("Usuários e segurança", "Cada usuário vê apenas as telas e a unidade da sua função.", `${can("security") ? '<button class="btn" id="logins">Histórico de login</button>' : ""}${can("users", 1) ? `<button class="btn p" id="newUser">${isNet() ? "+ Usuário" : "+ Solicitar usuário"}</button>` : ""}`) +
    `<div class="grid" style="grid-template-columns:${can("security") ? "1.2fr 1fr" : "1fr"}"><div class="card"><h3>Usuários <span class="sub">${users.length}</span></h3><div class="tw"><table><tr><th>Nome</th><th>Perfil</th><th>Escopo</th><th>Último acesso</th><th></th></tr>
      ${users.map(u => `<tr class="${can("users", 2) ? "rowc" : ""}" data-id="${u.id}"><td><b>${esc(u.name)}</b><br><span class="small muted">${esc(u.email)}</span></td><td>${esc(u.role_name)}</td><td class="small">${esc(u.unit_name || "Franqueadora")}</td><td class="small num">${dt(u.last_login)}</td><td>${u.approval === "pendente" ? `<span class="pill warn">pendente</span>${isNet() && can("users", 2) ? ` <button class="btn s" data-ap="${u.id}|1">Aprovar</button> <button class="btn s" data-ap="${u.id}|0">Recusar</button>` : ""}` : u.approval === "recusado" ? '<span class="pill n">recusado</span>' : u.active ? "" : '<span class="pill n">inativo</span>'}</td></tr>`).join("")}</table></div>
      ${isNet() ? "" : '<div class="small muted" style="margin-top:8px">Usuários solicitados ficam <b>pendentes</b> até a franqueadora aprovar. O usuário só consegue entrar após a aprovação.</div>'}</div>
    ${can("security") ? `<div class="card"><h3>Permissões por perfil <span class="sub"><select class="in" id="roleSel" style="width:auto;padding:3px 8px">${roles.map(r => `<option value="${r.key}" ${r.key === roleSel ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></span></h3>
      <div class="perm"><div class="h" style="text-align:left">Módulo</div><div class="h">Ver</div><div class="h">Inserir</div><div class="h">Editar</div><div class="h">Excluir</div>
      ${mods.map(([k, n]) => `<div>${n}</div>${[0, 1, 2, 3].map(i => `<div style="text-align:center"><input type="checkbox" data-perm="${k}|${i}" ${role.perms[k]?.[i] ? "checked" : ""} ${can("security", 2) && roleSel !== "admin" ? "" : "disabled"}></div>`).join("")}`).join("")}</div>
      <div class="small muted" style="margin-top:8px">Regra por dados: perfis de <b>unidade</b> (Franqueado, Técnico) só enxergam a própria unidade.</div></div>` : ""}</div>`;
  const form = (u = {}) => `<div class="fg"><div><label class="f">Nome</label><input class="in" name="name" value="${esc(u.name || "")}" required></div>
    <div><label class="f">E-mail</label><input class="in" name="email" type="email" value="${esc(u.email || "")}" ${u.id ? "disabled" : "required"}></div>
    <div><label class="f">${u.id ? "Nova senha (deixe em branco para manter)" : "Senha"}</label><input class="in" name="password" type="text" ${u.id ? "" : "required minlength=8"}></div>
    <div class="grid g2"><div><label class="f">Perfil</label><select class="in" name="role_key">${roles.filter(r => isNet() || r.scope === "unit").map(r => `<option value="${r.key}" ${u.role_key === r.key ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>
    <div><label class="f">Unidade</label><select class="in" name="unit_id" ${isNet() ? "" : "disabled"}><option value="">Franqueadora (sem unidade)</option>${opt(units, u.unit_id ?? (isNet() ? "" : state.me.unit_id))}</select></div></div>
    ${u.id ? `<div><label class="small"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Usuário ativo</label></div>` : ""}</div>`;
  $("#newUser") && ($("#newUser").onclick = () => modal(isNet() ? "Novo usuário" : "Solicitar novo usuário", form(), async o => { await api("/users", { method: "POST", body: { ...o, unit_id: o.unit_id || null } }); toast(isNet() ? "Usuário criado" : "Solicitação enviada à franqueadora"); loadView(); }));
  $("#view").querySelectorAll("[data-ap]").forEach(b => b.onclick = async (ev) => { ev.stopPropagation(); const [id, ap] = b.dataset.ap.split("|"); let reason = null; if (ap === "0") { reason = prompt("Motivo da recusa (opcional):"); if (reason === null) return; } await api(`/users/${id}/approval`, { method: "POST", body: { approve: ap === "1", reason } }); toast(ap === "1" ? "Cadastro aprovado" : "Cadastro recusado"); loadView(); });
  $("#view").querySelectorAll("tr.rowc").forEach(tr => tr.onclick = () => { const u = users.find(x => x.id == tr.dataset.id); modal("Editar usuário", form(u), async o => { await api(`/users/${u.id}`, { method: "PUT", body: { ...o, unit_id: o.unit_id || null, active: !!o.active } }); toast("Usuário atualizado"); loadView(); }); });
  const rs = $("#roleSel"); if (rs) rs.onchange = () => { state.roleSel = rs.value; loadView(); };
  $("#view").querySelectorAll("[data-perm]").forEach(cb => cb.onchange = async () => { const [k, i] = cb.dataset.perm.split("|"); role.perms[k] = role.perms[k] || [0, 0, 0, 0]; role.perms[k][+i] = cb.checked ? 1 : 0; await api(`/roles/${role.key}`, { method: "PUT", body: { perms: role.perms } }); toast(`Permissão atualizada: ${role.name}`); });
  const lg = $("#logins"); if (lg) lg.onclick = async () => { const rows = await api("/security/logins"); modal("Histórico de login", `<div class="tw"><table><tr><th>Quando</th><th>Usuário</th><th>IP</th><th></th></tr>${rows.map(x => `<tr><td class="small num">${dt(x.at)}</td><td>${esc(x.name || x.email || "—")}</td><td class="small num">${esc(x.ip || "")}</td><td>${x.ok ? '<span class="pill ok">ok</span>' : '<span class="pill bad">falha</span>'}</td></tr>`).join("")}</table></div>`, null); };
};

/* ---------- Boot ---------- */
async function boot() {
  const m = location.hash.match(/reset=([\w-]{20,})/);
  if (m) { state.resetToken = m[1]; state.authMode = "reset"; state.me = null; return render(); } // link do e-mail
  try { state.me = await api("/me"); } catch { state.me = null; }
  render();
}
boot();
