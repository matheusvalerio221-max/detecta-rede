/* Detecta Rede — fase 2: Checklist e Universidade (carrega após app.js) */

/* ---------- utilitários ---------- */
function uploadFile(file, kind, ref, max = 10 * 1024 * 1024, onProgress) {
  if (file.size > max) { toast(`${file.name}: maior que ${max >= 1073741824 ? (max / 1073741824).toFixed(0) + " GB" : Math.round(max / 1048576) + " MB"}`); return Promise.resolve(null); }
  const q = `?kind=${kind}${ref ? `&ref=${ref}` : ""}&filename=${encodeURIComponent(file.name)}`;
  return new Promise(resolve => {
    const x = new XMLHttpRequest(); x.open("POST", `/api/files${q}`); x.withCredentials = true; x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100), e.loaded, e.total); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} if (x.status >= 200 && x.status < 300) resolve(j); else { toast(`${file.name}: ${j.error || "falha no envio"}`); resolve(null); } };
    x.onerror = () => { toast(`${file.name}: falha de rede no envio`); resolve(null); };
    x.send(file);
  });
}
const fileLink = f => f.mime.startsWith("image/")
  ? `<a href="/api/files/${f.id}" target="_blank" title="${esc(f.filename)}"><img src="/api/files/${f.id}" alt="" style="height:64px;max-width:110px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"></a>`
  : `<a class="btn s" href="/api/files/${f.id}" target="_blank">📄 ${esc(f.filename)}</a>`;
const pctPill = p => p == null ? '<span class="pill n">—</span>' : `<span class="pill ${p >= 90 ? "ok" : p >= 70 ? "warn" : "bad"}">${p}%</span>`;
const fmtDate = s => s ? P(s).toLocaleDateString("pt-BR") : "—";
const openModal = (title, body, acts = "") => { const bg = document.createElement("div"); bg.className = "modal-bg"; bg.innerHTML = `<div class="modal" style="max-width:860px"><h3>${title}</h3>${body}<div class="acts"><button type="button" class="btn" data-x>Fechar</button>${acts}</div></div>`; document.body.appendChild(bg); bg.querySelector("[data-x]").onclick = () => bg.remove(); bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); }); return bg; };

/* =====================================================================
   CHECKLIST
   ===================================================================== */
views.chk = async () => {
  const sub = state.chkTab || "runs";
  const [tpls, runs, sum, units] = await Promise.all([api(`/checklists/templates${isNet() ? "?all=1" : ""}`), api("/checklists/runs"), api("/checklists/summary"), isNet() ? api("/units") : Promise.resolve([])]);
  const tabs = [["runs", "Aplicações"], ["summary", "Evolução"], ...(isNet() ? [["tpl", "Modelos"]] : [])];
  $("#view").innerHTML = hd("Checklist", isNet() ? "Padrão da rede verificado item a item: visitas de campo, autoavaliações e planos de ação." : "Autoavaliações da sua unidade e visitas da franqueadora.",
    `${can("checklist", 1) ? '<button class="btn p" id="newRun">+ Aplicar checklist</button>' : ""}${isNet() && can("checklist", 1) ? '<button class="btn" id="newTpl">+ Novo modelo</button>' : ""}`) +
    `<div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === sub ? "on" : ""}" data-tab="${k}">${n}</button>`).join("")}</div><div id="chkBody"></div>`;
  $("#view").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.chkTab = b.dataset.tab; loadView(); });
  const body = $("#chkBody");

  if (sub === "runs") body.innerHTML = runs.length ? `<div class="card"><div class="tw"><table><tr><th>Checklist</th>${isNet() ? "<th>Unidade</th>" : ""}<th>Aplicado por</th><th>Data</th><th>Nota</th><th>Não conformes</th><th>Status</th></tr>
      ${runs.map(r => `<tr class="rowc" data-run="${r.id}"><td><b>${esc(r.template_name)}</b></td>${isNet() ? `<td>${esc(r.unit_name)}</td>` : ""}<td class="small">${esc(r.user_name || "")}</td><td class="small num">${dt(r.finished_at || r.started_at)}</td><td>${r.status === "concluido" ? pctPill(r.pct) : "—"}</td><td class="num">${r.status === "concluido" ? r.nonconform : "—"}</td><td>${r.status === "rascunho" ? '<span class="pill warn">em andamento</span>' : '<span class="pill ok">concluído</span>'}</td></tr>`).join("")}</table></div></div>`
    : `<div class="card"><div class="empty">Nenhum checklist aplicado ainda.${can("checklist", 1) ? " Use “Aplicar checklist”." : ""}</div></div>`;

  if (sub === "summary") body.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr"><div class="card"><h3>Média por unidade</h3>${sum.byUnit.length ? `<div class="tw"><table><tr><th>Unidade</th><th>Aplicações</th><th>Média</th><th>Última</th></tr>${sum.byUnit.map(u => `<tr><td>${esc(u.unit_name)}</td><td class="num">${u.runs}</td><td>${pctPill(u.avg_pct)}</td><td>${pctPill(u.last_pct)} <span class="small muted">${fmtDate(u.last_at)}</span></td></tr>`).join("")}</table></div>` : '<div class="empty">Sem dados.</div>'}</div>
    <div class="card"><h3>Últimas aplicações</h3>${sum.recent.length ? `<div class="tw"><table><tr><th>Checklist</th><th>Unidade</th><th>Nota</th><th>Data</th></tr>${sum.recent.map(r => `<tr class="rowc" data-run="${r.id}"><td>${esc(r.template_name)}</td><td class="small">${esc(r.unit_name)}</td><td>${pctPill(r.pct)}</td><td class="small num">${fmtDate(r.finished_at)}</td></tr>`).join("")}</table></div>` : '<div class="empty">Sem dados.</div>'}</div></div>`;

  if (sub === "tpl") body.innerHTML = `<div class="card"><div class="tw"><table><tr><th>Modelo</th><th>Aplicado por</th><th>Itens</th><th>Aplicações</th><th>Plano de ação</th><th>Status</th></tr>
      ${tpls.map(t => `<tr class="rowc" data-tpl="${t.id}"><td><b>${esc(t.name)}</b><br><span class="small muted">${esc(t.description || "")}</span></td><td class="small">${{ ambos: "Franqueadora e franqueado", consultor: "Franqueadora", franqueado: "Franqueado (autoavaliação)" }[t.audience]}</td><td class="num">${t.items}</td><td class="num">${t.runs}</td><td class="small">${t.create_tasks ? "gera tarefas" : "não"}</td><td>${t.active ? '<span class="pill ok">ativo</span>' : '<span class="pill n">inativo</span>'}</td></tr>`).join("") || '<tr><td colspan="6"><div class="empty">Nenhum modelo. Crie o primeiro em “Novo modelo”.</div></td></tr>'}</table></div></div>`;

  body.querySelectorAll("[data-run]").forEach(tr => tr.onclick = () => runModal(+tr.dataset.run));
  body.querySelectorAll("[data-tpl]").forEach(tr => tr.onclick = async () => tplModal(await api(`/checklists/templates/${tr.dataset.tpl}?all=1`)));
  $("#newTpl") && ($("#newTpl").onclick = () => tplModal(null));
  $("#newRun") && ($("#newRun").onclick = () => {
    const avail = tpls.filter(t => t.active && (isNet() || t.audience !== "consultor")); if (!avail.length) return toast("Nenhum modelo disponível.");
    modal("Aplicar checklist", `<div class="fg"><div><label class="f">Modelo</label><select class="in" name="template_id">${opt(avail, avail[0].id)}</select></div>
      ${isNet() ? `<div><label class="f">Unidade</label><select class="in" name="unit_id">${opt(units.filter(u => !u.is_hq), "")}</select></div>` : `<p class="small muted">Unidade: <b>${esc(state.me.unit_name)}</b></p>`}</div>`,
      async o => { const r = await api("/checklists/runs", { method: "POST", body: o }); toast("Checklist iniciado"); state.chkTab = "runs"; await loadView(); runModal(r.id); }, "Iniciar");
  });
};

/* --- editor de modelo --- */
function tplModal(t) {
  const items = t ? t.items.filter(i => i.active).map(i => ({ ...i })) : [{ text: "", kind: "yesno", weight: 1, required: true, allow_photo: true }];
  const KIND = { yesno: "Sim / Não", score: "Nota 0-10", text: "Texto livre" };
  const row = (it, i) => `<tr data-i="${i}"><td><input class="in" name="section" value="${esc(it.section || "")}" placeholder="Seção (opcional)" style="min-width:110px"></td><td><input class="in" name="text" value="${esc(it.text || "")}" placeholder="O que verificar" style="min-width:220px" required></td>
    <td><select class="in" name="kind">${Object.entries(KIND).map(([k, n]) => `<option value="${k}" ${it.kind === k ? "selected" : ""}>${n}</option>`).join("")}</select></td><td><input class="in num" name="weight" type="number" min="0" step="0.5" value="${it.weight ?? 1}" style="width:64px"></td>
    <td style="text-align:center"><input type="checkbox" name="required" ${it.required !== false && it.required !== 0 ? "checked" : ""}></td><td style="text-align:center"><input type="checkbox" name="allow_photo" ${it.allow_photo !== false && it.allow_photo !== 0 ? "checked" : ""}></td>
    <td class="small" style="white-space:nowrap"><button type="button" class="btn s" data-up>↑</button><button type="button" class="btn s" data-dn>↓</button><button type="button" class="btn s" data-del>✕</button></td></tr>`;
  const bg = modal(t ? "Editar modelo de checklist" : "Novo modelo de checklist", `<div class="fg"><div class="grid g2"><div><label class="f">Nome</label><input class="in" name="name" value="${esc(t?.name || "")}" required></div><div><label class="f">Quem aplica</label><select class="in" name="audience"><option value="ambos" ${t?.audience === "ambos" ? "selected" : ""}>Franqueadora e franqueado</option><option value="consultor" ${t?.audience === "consultor" ? "selected" : ""}>Somente franqueadora (visita)</option><option value="franqueado" ${t?.audience === "franqueado" ? "selected" : ""}>Somente franqueado (autoavaliação)</option></select></div></div>
    <div><label class="f">Descrição / orientações</label><textarea class="in" name="description" rows="2">${esc(t?.description || "")}</textarea></div>
    <div class="row"><label class="small"><input type="checkbox" name="create_tasks" ${!t || t.create_tasks ? "checked" : ""}> Itens não conformes geram tarefas (plano de ação) para a unidade</label>${t ? `<label class="small"><input type="checkbox" name="active" ${t.active ? "checked" : ""}> Modelo ativo</label>` : ""}</div>
    <div class="tw"><table id="tplItems"><tr><th>Seção</th><th>Item</th><th>Tipo</th><th>Peso</th><th>Obrig.</th><th>Foto</th><th></th></tr>${items.map(row).join("")}</table></div>
    <div><button type="button" class="btn s" id="addItem">+ Adicionar item</button> <span class="small muted">Nota: Sim = peso cheio, Não = 0; Nota 0-10 proporcional ao peso (abaixo de 7 = não conforme); Texto não pontua.</span></div></div>`,
    async (o, f) => {
      const its = [...f.querySelectorAll("#tplItems tr[data-i]")].map(tr => { const g = n => tr.querySelector(`[name=${n}]`); return { id: items[+tr.dataset.i]?.id, section: g("section").value, text: g("text").value, kind: g("kind").value, weight: +g("weight").value, required: g("required").checked, allow_photo: g("allow_photo").checked }; });
      const bodyReq = { name: o.name, audience: o.audience, description: o.description, create_tasks: !!o.create_tasks, active: t ? !!o.active : true, items: its };
      await api(t ? `/checklists/templates/${t.id}` : "/checklists/templates", { method: t ? "PUT" : "POST", body: bodyReq }); toast(t ? "Modelo atualizado" : "Modelo criado"); state.chkTab = "tpl"; loadView();
    });
  const tbl = bg.querySelector("#tplItems");
  bg.querySelector("#addItem").onclick = () => { items.push({ text: "", kind: "yesno", weight: 1, required: true, allow_photo: true }); tbl.insertAdjacentHTML("beforeend", row(items[items.length - 1], items.length - 1)); tbl.querySelector("tr:last-child [name=text]").focus(); };
  tbl.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-i]"); if (!tr) return;
    if (e.target.closest("[data-del]")) { if (tbl.querySelectorAll("tr[data-i]").length > 1) tr.remove(); }
    else if (e.target.closest("[data-up]") && tr.previousElementSibling?.dataset.i) tr.parentNode.insertBefore(tr, tr.previousElementSibling);
    else if (e.target.closest("[data-dn]") && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr);
  });
}

/* --- aplicação (responder / visualizar) --- */
async function runModal(id) {
  const r = await api(`/checklists/runs/${id}`); const edit = r.status === "rascunho" && can("checklist", 1);
  let section = null;
  const itemHtml = it => { const sec = it.section !== section ? (section = it.section, it.section ? `<div class="sec">${esc(it.section)}</div>` : "") : "";
    const ctrl = it.kind === "yesno" ? ["sim", "nao", "na"].map(v => `<label class="opt ${it.value === v ? "on" : ""}"><input type="radio" name="v${it.id}" value="${v}" ${it.value === v ? "checked" : ""} ${edit ? "" : "disabled"}> ${{ sim: "Sim", nao: "Não", na: "N/A" }[v]}</label>`).join("")
      : it.kind === "score" ? `<input class="in num" type="number" name="v${it.id}" min="0" max="10" step="1" value="${it.value ?? ""}" style="width:80px" ${edit ? "" : "disabled"}> <span class="small muted">0 a 10</span>`
      : `<input class="in" name="v${it.id}" value="${esc(it.value || "")}" placeholder="Resposta" ${edit ? "" : "disabled"}>`;
    return `${sec}<div class="ci ${it.conform === 0 ? "nc" : ""}" data-item="${it.id}" data-ans="${it.answer_id}"><div class="q"><b>${esc(it.text)}</b>${it.required ? ' <span class="small muted">*</span>' : ""}${it.conform === 0 ? ' <span class="pill bad">não conforme</span>' : ""}</div>
      <div class="row" style="gap:8px">${ctrl}</div>
      <div class="row" style="gap:8px;margin-top:6px"><input class="in" name="n${it.id}" value="${esc(it.note || "")}" placeholder="Observação" style="flex:1;min-width:160px" ${edit ? "" : "disabled"}>${it.allow_photo && edit ? `<label class="btn s">📷 Foto<input type="file" accept="image/*,.pdf" multiple data-photo style="display:none"></label>` : ""}</div>
      ${it.files.length ? `<div class="row" style="gap:6px;margin-top:6px">${it.files.map(fileLink).join("")}</div>` : ""}</div>`; };
  const bg = openModal(`${esc(r.template_name)} <span class="sub">${esc(r.unit_name)} · ${esc(r.user_name || "")} · ${dt(r.started_at)}</span>`,
    `${r.template_description ? `<p class="small muted">${esc(r.template_description)}</p>` : ""}
     <div class="row" style="margin-bottom:10px"><span class="pill ${r.status === "rascunho" ? "warn" : "ok"}">${r.status === "rascunho" ? "em andamento" : "concluído"}</span>${r.pct != null ? `Nota: ${pctPill(r.pct)}` : ""}<span class="small muted">${r.items.filter(i => i.conform === 0).length} não conforme(s)</span></div>
     <div class="clist">${r.items.map(itemHtml).join("")}</div>
     <div style="margin-top:10px"><label class="f">Observações gerais</label><textarea class="in" name="notes" rows="2" ${edit ? "" : "disabled"}>${esc(r.notes || "")}</textarea></div>
     ${r.tasks.length ? `<div style="margin-top:10px"><b class="small">Plano de ação gerado</b><ul class="small" style="margin:4px 0 0 18px">${r.tasks.map(t => `<li>${esc(t.title)} — ${pill(t.status)} <span class="muted">até ${fmtDate(t.due_date)}</span></li>`).join("")}</ul></div>` : ""}`,
    edit ? `<button type="button" class="btn" id="runSave">Salvar rascunho</button><button type="button" class="btn p" id="runFinish">Concluir checklist</button>${r.user_id === state.me.id || isNet() ? '<button type="button" class="btn" id="runDel" style="color:var(--bad)">Descartar</button>' : ""}` : (isNet() && can("checklist", 3) ? '<button type="button" class="btn" id="runDel" style="color:var(--bad)">Excluir</button>' : ""));
  const collect = () => ({ notes: bg.querySelector("[name=notes]").value, answers: r.items.map(it => { const el = it.kind === "yesno" ? bg.querySelector(`[name=v${it.id}]:checked`) : bg.querySelector(`[name=v${it.id}]`); return { item_id: it.id, value: el ? el.value : null, note: bg.querySelector(`[name=n${it.id}]`).value }; }) });
  const save = async () => api(`/checklists/runs/${r.id}`, { method: "PUT", body: collect() });
  bg.querySelectorAll(".opt input").forEach(i => i.onchange = () => { i.closest(".row").querySelectorAll(".opt").forEach(o => o.classList.remove("on")); i.closest(".opt").classList.add("on"); });
  bg.querySelectorAll("[data-photo]").forEach(inp => inp.onchange = async () => { await save(); const ans = inp.closest(".ci").dataset.ans; for (const f of inp.files) await uploadFile(f, "answer", ans); toast("Foto anexada"); bg.remove(); runModal(r.id); });
  const sv = bg.querySelector("#runSave"); if (sv) sv.onclick = async () => { await save(); toast("Rascunho salvo"); bg.remove(); loadView(); };
  const fin = bg.querySelector("#runFinish"); if (fin) fin.onclick = async () => { await save(); const nc = (await api(`/checklists/runs/${r.id}`)).items.filter(i => i.conform === 0).length; if (!confirm(`Concluir o checklist?${nc && r.create_tasks ? ` ${nc} item(ns) não conforme(s) vão gerar tarefas de plano de ação para a unidade.` : ""}`)) return; const out = await api(`/checklists/runs/${r.id}/finish`, { method: "POST", body: {} }); toast(`Checklist concluído: ${out.pct ?? "—"}%${out.tasks_created ? ` · ${out.tasks_created} tarefa(s) criada(s)` : ""}`); bg.remove(); loadView(); };
  const del = bg.querySelector("#runDel"); if (del) del.onclick = async () => { if (!confirm("Excluir este checklist? Esta ação não pode ser desfeita.")) return; await api(`/checklists/runs/${r.id}`, { method: "DELETE" }); toast("Checklist excluído"); bg.remove(); loadView(); };
}

/* =====================================================================
   UNIVERSIDADE
   ===================================================================== */
const AUD = { all: "Toda a rede", units: "Unidades selecionadas", franqueado: "Todos os franqueados", tecnico: "Todos os técnicos", unidade: "Todas as unidades (franqueado + técnico)", franqueadora: "Equipe da franqueadora" };
const MAX_VIDEO = 2 * 1024 * 1024 * 1024; // 2 GB
const LK = { video: "🎬 Vídeo", text: "📝 Texto", pdf: "📄 Arquivo", link: "🔗 Link" };
views.uni = async () => {
  const sub = state.uniTab || "courses";
  const courses = await api(`/courses${isNet() && sub === "manage" ? "?all=1" : ""}`);
  const tabs = [["courses", "Meus cursos"], ...(isNet() && can("university", 2) ? [["manage", "Gerenciar"], ["report", "Relatório"]] : [])];
  const folders = [...new Set(courses.map(c => c.category || "Geral"))].sort((a, b) => a.localeCompare(b));
  $("#view").innerHTML = hd("Universidade Corporativa", isNet() ? "Treinamentos por pasta: vídeos, textos e arquivos, com prova e acompanhamento de conclusão." : "Seus treinamentos. Conclua as aulas e faça a prova quando houver.",
    `${isNet() && can("university", 1) ? '<button class="btn p" id="newCourse">+ Novo curso</button>' : ""}`) +
    `<div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === sub ? "on" : ""}" data-tab="${k}">${n}</button>`).join("")}</div><div id="uniBody"></div>`;
  $("#view").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.uniTab = b.dataset.tab; loadView(); });
  const body = $("#uniBody");
  const card = c => `<div class="course ${c.completed ? "done" : ""}" data-course="${c.id}"><div class="row" style="justify-content:space-between;align-items:flex-start"><b>${esc(c.title)}</b><span>${c.mandatory ? '<span class="pill brand">obrigatório</span> ' : ""}${isNet() && c.audience === "units" ? `<span class="pill n" title="Unidades selecionadas">${(c.unit_ids || []).length} unid.</span>` : ""}</span></div>
    <p class="small muted" style="margin:4px 0 8px">${esc(c.description || "")}</p>
    <div class="row small" style="gap:10px"><span>${c.lessons} aula${c.lessons === 1 ? "" : "s"}</span>${c.questions ? `<span>prova${c.passed ? " ✓" : ""}</span>` : ""}${!c.active ? '<span class="pill n">inativo</span>' : ""}<span style="margin-left:auto">${c.completed ? '<span class="pill ok">concluído</span>' : `${c.pct}%`}</span></div>
    <div class="bar" style="margin-top:6px"><i class="${c.completed ? "ok" : ""}" style="width:${c.pct}%"></i></div></div>`;
  if (sub === "courses" || sub === "manage") {
    body.innerHTML = courses.length ? folders.map(f => `<div class="folder"><h3>📁 ${esc(f)} <span class="sub">${courses.filter(c => (c.category || "Geral") === f).length} curso(s)</span></h3><div class="courses">${courses.filter(c => (c.category || "Geral") === f).map(card).join("")}</div></div>`).join("")
      : `<div class="card"><div class="empty">${isNet() ? "Nenhum curso ainda. Crie o primeiro em “Novo curso” — ele entra na pasta que você digitar (ex.: Treinamento Operacional, Comercial)." : "Nenhum treinamento disponível para o seu perfil ainda."}</div></div>`;
    body.querySelectorAll("[data-course]").forEach(el => el.onclick = () => sub === "manage" ? courseEditor(+el.dataset.course) : courseModal(+el.dataset.course));
  }
  if (sub === "report") {
    const rep = await api("/courses/report"); const byUser = {};
    for (const u of rep.users) byUser[u.id] = { ...u, folders: rep.folders.filter(f => f.user_id === u.id), rows: rep.rows.filter(r => r.user_id === u.id) };
    const list = Object.values(byUser).filter(u => u.rows.length);
    body.innerHTML = `<div class="card"><h3>Acompanhamento por usuário <span class="sub">${rep.rows.filter(r => r.completed).length}/${rep.rows.length} curso-usuário concluídos · clique no usuário para detalhar</span></h3><div class="tw"><table><tr><th>Usuário</th><th>Unidade</th><th>% por pasta</th><th>Obrig. pendentes</th><th>Onde parou</th><th>Último acesso</th></tr>
      ${list.map(u => `<tr class="rowc" data-u="${u.id}"><td><b>${esc(u.name)}</b></td><td class="small">${esc(u.unit_name || "Franqueadora")}</td>
        <td>${u.folders.map(f => `<div class="row small" style="gap:6px;margin:2px 0"><span style="min-width:150px">📁 ${esc(f.category)}</span><div class="bar" style="width:90px"><i class="${f.pct === 100 ? "ok" : ""}" style="width:${f.pct}%"></i></div><span class="num">${f.pct}%</span></div>`).join("")}</td>
        <td>${(() => { const n = u.rows.filter(r => r.mandatory && !r.completed).length; return n ? `<span class="pill bad">${n}</span>` : '<span class="pill ok">0</span>'; })()}</td>
        <td class="small">${u.last_where ? esc(u.last_where) : '<span class="muted">não iniciou</span>'}</td><td class="small num">${dt(u.last_at)}</td></tr>`).join("") || '<tr><td colspan="6"><div class="empty">Sem usuários/cursos.</div></td></tr>'}</table></div></div>`;
    body.querySelectorAll("[data-u]").forEach(tr => tr.onclick = () => { const u = byUser[+tr.dataset.u];
      openModal(`${esc(u.name)} <span class="sub">${esc(u.unit_name || "Franqueadora")}</span>`, u.folders.map(f => `<div class="folder"><h3>📁 ${esc(f.category)} <span class="sub">${f.pct}% · ${f.done}/${f.lessons} aulas · ${f.courses_done}/${f.courses} cursos${f.last_where ? ` · parou em: ${esc(f.last_where)} (${dt(f.last_at)})` : ""}</span></h3>
        <div class="tw"><table><tr><th>Curso</th><th>Aulas</th><th>Prova</th><th>Última aula vista</th><th>Visto em</th><th>Status</th></tr>${u.rows.filter(r => r.category === f.category).map(r => `<tr><td>${esc(r.course_title)}${r.mandatory ? ' <span class="pill brand">obrig.</span>' : ""}</td><td><div class="row small" style="gap:6px"><div class="bar" style="width:80px"><i class="${r.pct === 100 ? "ok" : ""}" style="width:${r.pct}%"></i></div>${r.done}/${r.lessons}</div></td><td class="small">${r.quiz ? (r.passed ? `<span class="pill ok">aprovado ${r.score}%</span>` : r.score != null ? `<span class="pill bad">reprovado ${r.score}%</span>` : '<span class="pill n">pendente</span>') : "—"}</td><td class="small">${esc(r.last_lesson || "—")}</td><td class="small num">${dt(r.last_at)}</td><td>${r.completed ? '<span class="pill ok">concluído</span>' : r.started ? '<span class="pill warn">em andamento</span>' : '<span class="pill n">não iniciou</span>'}</td></tr>`).join("")}</table></div></div>`).join("")); });
  }
  $("#newCourse") && ($("#newCourse").onclick = () => courseEditor(null, folders));
};

/* --- assistir curso --- */
async function courseModal(id) {
  const c = await api(`/courses/${id}`); let cur = state.lesson?.[id] ?? (c.lessons.find(l => !l.done)?.id ?? c.lessons[0]?.id);
  const render = () => {
    const l = c.lessons.find(x => x.id === cur);
    const content = !l ? '<div class="empty">Este curso ainda não tem aulas.</div>'
      : l.kind === "video" ? (l.embed ? `<div class="vid"><iframe src="${l.embed}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : l.file_id ? `<video controls preload="metadata" style="width:100%;border-radius:10px;background:#000" src="/api/files/${l.file_id}"></video>` : `<a class="btn" href="${esc(l.content)}" target="_blank">Abrir vídeo</a>`)
      : l.kind === "pdf" ? (l.file_id ? (l.file_mime?.startsWith("image/") ? `<img src="/api/files/${l.file_id}" style="max-width:100%;border-radius:10px">` : l.file_mime?.startsWith("video/") ? `<video controls preload="metadata" style="width:100%;border-radius:10px;background:#000" src="/api/files/${l.file_id}"></video>` : l.file_mime?.startsWith("audio/") ? `<audio controls style="width:100%" src="/api/files/${l.file_id}"></audio>` : `<iframe src="/api/files/${l.file_id}" style="width:100%;height:60vh;border:1px solid var(--line);border-radius:10px"></iframe><p class="small"><a class="btn s" href="/api/files/${l.file_id}?dl=1">Baixar ${esc(l.file_name || "arquivo")}</a></p>`) : '<div class="empty">Arquivo não enviado.</div>')
      : l.kind === "link" ? `<p><a class="btn p" href="${esc(l.content)}" target="_blank" rel="noopener">Abrir material ↗</a></p><p class="small muted">${esc(l.content)}</p>`
      : `<div class="md" style="line-height:1.6">${esc(l.content || "")}</div>`;
    bg.querySelector("#lesson").innerHTML = l ? `<h3 style="margin-bottom:8px">${esc(l.title)} <span class="sub">${LK[l.kind]}${l.duration_min ? ` · ${l.duration_min} min` : ""}</span></h3>${content}
      <div class="row" style="margin-top:12px"><button class="btn ${l.done ? "" : "p"}" id="lessonDone">${l.done ? "✓ Concluída (desfazer)" : "Marcar aula como concluída"}</button>${c.lessons[c.lessons.findIndex(x => x.id === l.id) + 1] ? '<button class="btn" id="lessonNext">Próxima aula →</button>' : ""}</div>` : content;
    bg.querySelectorAll("[data-l]").forEach(b => b.classList.toggle("on", +b.dataset.l === cur));
    if (l) fetch(`/api/courses/${c.id}/lessons/${l.id}/view`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    const d = bg.querySelector("#lessonDone"); if (d) d.onclick = async () => { const upd = await api(`/courses/${c.id}/lessons/${l.id}/done`, { method: "POST", body: { undo: l.done } }); Object.assign(c, upd); bg.querySelector("#progress").innerHTML = progressHtml(); bg.querySelectorAll("[data-l]").forEach(b => b.querySelector("i").textContent = c.lessons.find(x => x.id === +b.dataset.l).done ? "✓" : ""); const ni = c.lessons.findIndex(x => x.id === l.id) + 1; if (!l.done && c.lessons[ni]) cur = c.lessons[ni].id; render(); if (upd.progress.completed) toast("Curso concluído! 🎉"); };
    const nx = bg.querySelector("#lessonNext"); if (nx) nx.onclick = () => { cur = c.lessons[c.lessons.findIndex(x => x.id === l.id) + 1].id; render(); };
    const qz = bg.querySelector("#quizBtn"); if (qz) qz.onclick = () => quizModal(c, () => { bg.remove(); courseModal(id); });
  };
  const progressHtml = () => `<div class="bar" style="margin:6px 0"><i class="${c.progress.completed ? "ok" : ""}" style="width:${c.progress.pct}%"></i></div><div class="small muted">${c.progress.done}/${c.progress.total} aulas${c.progress.quiz_required ? ` · prova: ${c.best?.passed ? `aprovado (${c.best.score}%)` : c.best?.attempts ? `reprovado (${c.best.score}%), tente de novo` : "pendente"}` : ""}${c.progress.completed ? ' · <span class="pill ok">concluído</span>' : ""}</div>
    ${c.progress.quiz_required ? `<button class="btn ${c.progress.done === c.progress.total && !c.best?.passed ? "p" : ""} s" id="quizBtn" ${c.progress.done < c.progress.total ? "disabled title='Conclua as aulas antes'" : ""}>${c.best?.passed ? "Refazer prova" : "Fazer prova"} (${c.questions.length} questões, mínimo ${c.pass_score}%)</button>` : ""}`;
  const bg = openModal(`${esc(c.title)} <span class="sub">📁 ${esc(c.category || "Geral")}${c.mandatory ? " · obrigatório" : ""}</span>`,
    `${c.description ? `<p class="small muted">${esc(c.description)}</p>` : ""}<div id="progress">${progressHtml()}</div>
     <div class="uni"><div class="llist">${c.lessons.map((l, i) => `<button class="li" data-l="${l.id}"><span class="n">${i + 1}</span><span>${esc(l.title)}<small>${LK[l.kind]}${l.duration_min ? ` · ${l.duration_min} min` : ""}</small></span><i>${l.done ? "✓" : ""}</i></button>`).join("")}</div><div id="lesson" class="card"></div></div>`);
  bg.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { cur = +b.dataset.l; (state.lesson ||= {})[id] = cur; render(); });
  render();
}
function quizModal(c, after) {
  const bg = modal(`Prova — ${esc(c.title)}`, `<p class="small muted">${c.questions.length} questões · aprovação com ${c.pass_score}% de acertos.</p><div class="fg">${c.questions.map((q, i) => `<div class="card" style="padding:12px"><b>${i + 1}. ${esc(q.text)}</b><div class="fg" style="margin-top:6px;gap:4px">${q.options.map((o, j) => `<label class="small"><input type="radio" name="q${q.id}" value="${j}" required> ${esc(o)}</label>`).join("")}</div></div>`).join("")}</div>`,
    async o => { const answers = {}; c.questions.forEach(q => answers[q.id] = o[`q${q.id}`]); const r = await api(`/courses/${c.id}/quiz`, { method: "POST", body: { answers } });
      openModal(r.passed ? "Aprovado! 🎉" : "Não foi dessa vez", `<p>Você acertou <b>${r.hits}/${r.total}</b> (${r.score}%). Mínimo: ${r.pass_score}%.</p>${r.passed ? "" : "<p class='small muted'>Revise as aulas e tente novamente quando quiser.</p>"}
        <ol class="small" style="margin:8px 0 0 18px">${c.questions.map(q => { const rv = r.review.find(x => x.id === q.id); return `<li>${esc(q.text)} — ${rv.yours === rv.correct ? '<span class="pill ok">certo</span>' : `<span class="pill bad">errado</span> <span class="muted">correta: ${esc(q.options[rv.correct])}</span>`}</li>`; }).join("")}</ol>`);
      after && after(); }, "Enviar respostas");
}

/* --- editor de curso (franqueadora) --- */
async function courseEditor(id, folders = []) {
  const [c, units] = await Promise.all([id ? api(`/courses/${id}?edit=1`) : Promise.resolve({ title: "", category: "", audience: "all", mandatory: 0, pass_score: 70, active: 1, lessons: [], questions: [], unit_ids: [] }), api("/units")]);
  const lessons = c.lessons.filter(l => l.active !== 0).map(l => ({ ...l })); const questions = c.questions.map(q => ({ ...q }));
  const lrow = (l, i) => `<tr data-i="${i}"><td><input class="in" name="title" value="${esc(l.title || "")}" placeholder="Título da aula" style="min-width:180px" required></td>
    <td><select class="in" name="kind">${Object.entries(LK).map(([k, n]) => `<option value="${k}" ${l.kind === k ? "selected" : ""}>${n}</option>`).join("")}</select></td>
    <td class="lcontent" style="min-width:260px">${lcontent(l)}</td><td><input class="in num" name="duration_min" type="number" min="0" value="${l.duration_min ?? ""}" placeholder="min" style="width:64px"></td>
    <td style="white-space:nowrap"><button type="button" class="btn s" data-up>↑</button><button type="button" class="btn s" data-dn>↓</button><button type="button" class="btn s" data-del>✕</button></td></tr>`;
  function lcontent(l) {
    if (l.kind === "video") return `<input class="in" name="content" value="${esc(l.content || "")}" placeholder="Link YouTube/Vimeo (ou envie o arquivo →)"><div class="row small" style="gap:6px;margin-top:4px"><label class="btn s">⬆ Enviar MP4<input type="file" accept="video/mp4,video/webm,video/quicktime" data-file style="display:none"></label><span data-fname class="muted">${l.file_id ? `arquivo: ${esc(l.file_name || "enviado")}` : ""}</span><input type="hidden" name="file_id" value="${l.file_id || ""}"></div>`;
    if (l.kind === "pdf") return `<div class="row small" style="gap:6px"><label class="btn s">⬆ Enviar arquivo<input type="file" accept=".pdf,image/*,video/mp4,audio/mpeg" data-file style="display:none"></label><span data-fname class="muted">${l.file_id ? `arquivo: ${esc(l.file_name || "enviado")}` : "PDF, imagem, vídeo ou áudio"}</span><input type="hidden" name="file_id" value="${l.file_id || ""}"><input type="hidden" name="content" value=""></div>`;
    if (l.kind === "link") return `<input class="in" name="content" value="${esc(l.content || "")}" placeholder="https://…">`;
    return `<textarea class="in" name="content" rows="3" placeholder="Texto da aula">${esc(l.content || "")}</textarea>`;
  }
  const qrow = (q, i) => `<div class="card" data-q="${i}" style="padding:10px"><div class="row"><input class="in" name="qtext" value="${esc(q.text || "")}" placeholder="Pergunta" style="flex:1" required><button type="button" class="btn s" data-qdel>✕</button></div>
    <div class="fg" style="margin-top:6px;gap:4px">${[0, 1, 2, 3].map(j => `<label class="row small" style="gap:6px"><input type="radio" name="qc${i}" value="${j}" ${(q.correct ?? 0) === j ? "checked" : ""} title="Correta"><input class="in" name="qo${j}" value="${esc(q.options?.[j] || "")}" placeholder="Alternativa ${j + 1}${j > 1 ? " (opcional)" : ""}" style="flex:1"></label>`).join("")}</div><div class="small muted">Marque a alternativa correta.</div></div>`;
  const bg = modal(id ? "Editar curso" : "Novo curso", `<div class="fg"><div class="grid g2"><div><label class="f">Título</label><input class="in" name="ctitle" value="${esc(c.title)}" required></div>
    <div><label class="f">Pasta</label><input class="in" name="category" list="folders" value="${esc(c.category || "")}" placeholder="Ex.: Treinamento Operacional, Comercial" required><datalist id="folders">${folders.map(f => `<option value="${esc(f)}">`).join("")}</datalist></div></div>
    <div><label class="f">Descrição</label><textarea class="in" name="description" rows="2">${esc(c.description || "")}</textarea></div>
    <div class="grid g2"><div><label class="f">Público</label><select class="in" name="audience">${Object.entries(AUD).map(([k, n]) => `<option value="${k}" ${c.audience === k ? "selected" : ""}>${n}</option>`).join("")}</select></div><div><label class="f">Nota mínima na prova (%)</label><input class="in num" name="pass_score" type="number" min="0" max="100" value="${c.pass_score}"></div></div>
    <div id="unitPick" style="${c.audience === "units" ? "" : "display:none"}"><label class="f">Unidades que recebem este curso</label><div class="row" style="gap:6px 14px">${units.filter(u => !u.is_hq).map(u => `<label class="small" style="white-space:nowrap"><input type="checkbox" name="unit_ids" value="${u.id}" ${(c.unit_ids || []).includes(u.id) ? "checked" : ""}> ${esc(u.name)}</label>`).join("")}</div></div>
    <div class="row"><label class="small"><input type="checkbox" name="mandatory" ${c.mandatory ? "checked" : ""}> Curso obrigatório</label>${id ? `<label class="small"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> Curso ativo (visível)</label>` : ""}</div>
    <h3 style="margin-top:6px">Aulas</h3><div class="tw"><table id="lessons"><tr><th>Título</th><th>Tipo</th><th>Conteúdo</th><th>Duração</th><th></th></tr>${lessons.map(lrow).join("")}</table></div><div><button type="button" class="btn s" id="addLesson">+ Adicionar aula</button> <span class="small muted">Vídeo: cole o link do YouTube/Vimeo ou envie o arquivo MP4 (até 2 GB; aguarde a barra chegar a 100% antes de salvar).</span></div>
    <h3 style="margin-top:6px">Prova (opcional)</h3><div id="questions" class="fg">${questions.map(qrow).join("")}</div><div><button type="button" class="btn s" id="addQ">+ Adicionar questão</button></div></div>`,
    async (o, f) => {
      const ls = [...f.querySelectorAll("#lessons tr[data-i]")].map(tr => { const g = n => tr.querySelector(`[name=${n}]`); return { id: lessons[+tr.dataset.i]?.id, title: g("title").value, kind: g("kind").value, content: g("content")?.value || "", file_id: g("file_id")?.value || null, duration_min: g("duration_min").value || null }; });
      const qs = [...f.querySelectorAll("#questions [data-q]")].map(d => ({ id: questions[+d.dataset.q]?.id, text: d.querySelector("[name=qtext]").value, options: [0, 1, 2, 3].map(j => d.querySelector(`[name=qo${j}]`).value).filter(Boolean), correct: +(d.querySelector("input[type=radio]:checked")?.value ?? 0) }));
      if (ls.some(l => l.kind === "video" && !l.content && !l.file_id)) throw (toast("Aula de vídeo sem link nem arquivo."), new Error("x"));
      if (ls.some(l => l.kind === "pdf" && !l.file_id)) throw (toast("Aula de arquivo sem arquivo enviado."), new Error("x"));
      const unit_ids = [...f.querySelectorAll("[name=unit_ids]:checked")].map(i => +i.value);
      await api(id ? `/courses/${id}` : "/courses", { method: id ? "PUT" : "POST", body: { title: o.ctitle, category: o.category, description: o.description, audience: o.audience, unit_ids, pass_score: +o.pass_score, mandatory: !!o.mandatory, active: id ? !!o.active : true, lessons: ls, questions: qs } });
      toast(id ? "Curso atualizado" : "Curso criado"); state.uniTab = "manage"; loadView();
    });
  bg.querySelector(".modal").style.maxWidth = "960px";
  bg.querySelector("[name=audience]").onchange = e => { bg.querySelector("#unitPick").style.display = e.target.value === "units" ? "" : "none"; };
  const tbl = bg.querySelector("#lessons"), qdiv = bg.querySelector("#questions");
  bg.querySelector("#addLesson").onclick = () => { lessons.push({ title: "", kind: "video" }); tbl.insertAdjacentHTML("beforeend", lrow(lessons[lessons.length - 1], lessons.length - 1)); };
  bg.querySelector("#addQ").onclick = () => { questions.push({ text: "", options: [], correct: 0 }); qdiv.insertAdjacentHTML("beforeend", qrow(questions[questions.length - 1], questions.length - 1)); };
  tbl.addEventListener("change", async e => {
    const tr = e.target.closest("tr[data-i]"); if (!tr) return;
    if (e.target.name === "kind") { const l = lessons[+tr.dataset.i] || {}; l.kind = e.target.value; tr.querySelector(".lcontent").innerHTML = lcontent({ ...l, content: "", file_id: null }); }
    if (e.target.matches("[data-file]")) { const file = e.target.files[0]; if (!file) return; const nm = tr.querySelector("[data-fname]"); const saveBtn = bg.querySelector(".acts .btn.p"); saveBtn.disabled = true;
      nm.innerHTML = `<span class="up"><span class="bar" style="width:140px;display:inline-block;vertical-align:middle"><i style="width:0%"></i></span> <b>0%</b> ${esc(file.name)} (${(file.size / 1048576).toFixed(0)} MB)</span>`;
      const up = await uploadFile(file, "lesson", null, MAX_VIDEO, (p) => { const i = nm.querySelector("i"), b = nm.querySelector("b"); if (i) i.style.width = p + "%"; if (b) b.textContent = p + "%"; });
      saveBtn.disabled = false; if (up) { tr.querySelector("[name=file_id]").value = up.id; nm.textContent = `arquivo: ${up.filename} (${(up.size / 1048576).toFixed(0)} MB)`; } else nm.textContent = "falha no envio"; }
  });
  tbl.addEventListener("click", e => { const tr = e.target.closest("tr[data-i]"); if (!tr) return; if (e.target.closest("[data-del]")) tr.remove(); else if (e.target.closest("[data-up]") && tr.previousElementSibling?.dataset.i) tr.parentNode.insertBefore(tr, tr.previousElementSibling); else if (e.target.closest("[data-dn]") && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr); });
  qdiv.addEventListener("click", e => { if (e.target.closest("[data-qdel]")) e.target.closest("[data-q]").remove(); });
}

/* =====================================================================
   E-MAIL (configuração) — card dentro de Usuários e segurança
   ===================================================================== */
async function mailCard() {
  if (!isNet() || !can("security", 2)) return;
  const grid = $("#view .grid"); if (!grid) return;
  const m = await api("/settings/mail");
  const card = document.createElement("div"); card.className = "card"; card.style.gridColumn = "1 / -1";
  card.innerHTML = `<h3>E-mail de notificações <span class="sub">${m.ready ? (m.enabled ? '<span class="pill ok">ativo</span>' : '<span class="pill n">desligado</span>') : '<span class="pill warn">não configurado</span>'} · ${m.pending} na fila</span></h3>
    <p class="small muted" style="margin-bottom:10px">Avisa por e-mail: comunicados (para o público escolhido), novos cursos, chamados abertos e respondidos, solicitações e aprovações de usuário. Use uma conta SMTP da empresa (Google Workspace: smtp.gmail.com, porta 587, senha de app; HostGator: mail.seudominio, porta 465) ou um serviço de envio.</p>
    <form id="mailForm" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
      <div><label class="f">Servidor SMTP</label><input class="in" name="smtp_host" value="${esc(m.host)}" placeholder="smtp.gmail.com"></div>
      <div><label class="f">Porta</label><input class="in num" name="smtp_port" type="number" value="${m.port}"></div>
      <div><label class="f">Conexão</label><select class="in" name="smtp_secure"><option value="0" ${!m.secure ? "selected" : ""}>STARTTLS (587)</option><option value="1" ${m.secure ? "selected" : ""}>SSL/TLS (465)</option></select></div>
      <div><label class="f">Usuário</label><input class="in" name="smtp_user" value="${esc(m.user)}" placeholder="sistema@detecta.com.br"></div>
      <div><label class="f">Senha ${m.has_pass ? '<span class="muted">(salva — deixe em branco para manter)</span>' : ""}</label><input class="in" name="smtp_pass" type="password" autocomplete="new-password"></div>
      <div><label class="f">Remetente (e-mail)</label><input class="in" name="mail_from" value="${esc(m.from)}" placeholder="sistema@detecta.com.br"></div>
      <div><label class="f">Nome do remetente</label><input class="in" name="mail_from_name" value="${esc(m.from_name)}"></div>
      <div><label class="f">Endereço do sistema (link nos e-mails)</label><input class="in" name="site_url" value="${esc(m.site)}" placeholder="https://sistema.detecta.eco.br"></div>
      <div style="display:flex;align-items:end"><label class="small"><input type="checkbox" name="mail_enabled" ${m.enabled ? "checked" : ""}> Envio ativo</label></div>
    </form>
    <div class="row" style="margin-top:10px"><button class="btn p" id="mailSave">Salvar</button><input class="in" id="mailTestTo" type="email" value="${esc(state.me.email)}" placeholder="destinatário do teste" style="width:260px"><button class="btn" id="mailTest">Enviar e-mail de teste</button>${m.outbox.some(o => o.status !== "enviado" && o.error) ? '<button class="btn" id="mailRetry">Tentar reenviar agora</button>' : ""}</div>
    ${m.outbox.length ? `<details style="margin-top:10px"><summary class="small" style="cursor:pointer">Últimos envios (${m.outbox.length})</summary><div class="tw"><table><tr><th>Para</th><th>Assunto</th><th>Status</th><th>Data</th><th>Erro</th></tr>${m.outbox.map(o => `<tr><td class="small">${esc(o.to_email)}</td><td class="small">${esc(o.subject)}</td><td>${o.status === "enviado" ? '<span class="pill ok">enviado</span>' : o.status === "falhou" ? '<span class="pill bad">falhou</span>' : `<span class="pill warn">pendente (${o.attempts})</span>`}</td><td class="small num">${dt(o.sent_at || o.created_at)}</td><td class="small muted">${esc(o.error || "")}</td></tr>`).join("")}</table></div></details>` : ""}`;
  grid.appendChild(card);
  const collect = () => { const f = $("#mailForm"); const o = Object.fromEntries(new FormData(f)); o.mail_enabled = f.querySelector("[name=mail_enabled]").checked ? "1" : "0"; return o; };
  $("#mailSave").onclick = async () => { await api("/settings/mail", { method: "PUT", body: collect() }); toast("Configuração de e-mail salva"); loadView(); };
  $("#mailTest").onclick = async () => { await api("/settings/mail", { method: "PUT", body: collect() }); $("#mailTest").disabled = true; $("#mailTest").textContent = "Enviando…"; try { const r = await api("/settings/mail/test", { method: "POST", body: { to: $("#mailTestTo").value } }); toast(`E-mail de teste enviado para ${r.to}`); } finally { loadView(); } };
  const rt = $("#mailRetry"); if (rt) rt.onclick = async () => { await api("/settings/mail/retry", { method: "POST", body: {} }); toast("Reenvio agendado"); setTimeout(loadView, 1500); };
}
const _sec = views.sec; views.sec = async () => { await _sec(); await mailCard(); };
