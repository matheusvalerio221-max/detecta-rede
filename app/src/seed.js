import { get, run } from "./db.js";
import { ROLES, hashPassword } from "./auth.js";

export function seedIfEmpty() {
  for (const [key, r] of Object.entries(ROLES)) run("insert or ignore into roles(key,name,scope) values(?,?,?)", key, r.name, r.scope);
  if (get("select count(*) n from users").n > 0) return;

  const adminEmail = process.env.ADMIN_EMAIL || "admin@detecta.com.br";
  const adminPass = process.env.ADMIN_PASSWORD || "Detecta@2026";

  const hq = run("insert into units(name,city,state,franchisee,status,is_hq,opened_at) values('Detecta Campinas (Matriz)','Campinas','SP','Matriz','ativa',1,'2012-01-01')").lastInsertRowid;
  for (const [name, city, opened] of [["Detecta Americana", "Americana", "2019-03-01"], ["Detecta Salto", "Salto", "2021-06-01"], ["Detecta Botucatu", "Botucatu", "2022-02-01"], ["Detecta Cosmópolis", "Cosmópolis", "2023-05-01"], ["Detecta Pedreira / Poços de Caldas", "Pedreira", "2024-04-01"]])
    run("insert into units(name,city,state,status,opened_at) values(?,?,'SP','ativa',?)", name, city, opened);

  const admin = run("insert into users(name,email,password_hash,role_key) values(?,?,?,'admin')", "Administrador", adminEmail, hashPassword(adminPass)).lastInsertRowid;

  for (const [name, dept, sla] of [["Suporte técnico", "Suporte técnico", 4], ["Sistemas (SmartCip)", "TI", 2], ["Marketing", "Marketing", 8], ["Jurídico / Contratos", "Jurídico", 24], ["Compras e fornecedores", "Compras", 8], ["Financeiro", "Financeiro", 8]])
    run("insert into ticket_categories(name,department,sla_hours) values(?,?,?)", name, dept, sla);

  run("insert into communications(title,body,author_id,audience) values(?,?,?,'all')", "Bem-vindos ao Detecta Rede",
    "Este é o novo sistema de gestão da rede Detecta. Aqui você abre chamados para a franqueadora, recebe comunicados oficiais, acompanha tarefas e planos de ação. Confirme a leitura deste comunicado para registrar sua ciência.", admin);
  run("insert into activity_log(user_id,unit_id,kind,message) values(?,?,'sistema','Sistema instalado e usuário administrador criado')", admin, hq);
  console.log(`Seed concluído. Login inicial: ${adminEmail}`);
}
