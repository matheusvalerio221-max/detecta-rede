/* Redefine a senha do administrador para o valor de ADMIN_PASSWORD do .env.
   Uso na VPS:  docker compose exec app node src/resetadmin.js
   Não imprime a senha. Reativa o usuário caso esteja inativo. */
import { migrate, get, run } from "./db.js";
import { hashPassword } from "./auth.js";

migrate();
const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
const pass = process.env.ADMIN_PASSWORD || "";
if (pass.length < 8) { console.error("ADMIN_PASSWORD ausente ou curta no .env — nada alterado."); process.exit(1); }

let u = email && get("select id, email from users where lower(email)=?", email);
if (!u) u = get("select id, email from users where role_key='admin' order by id limit 1");
if (!u) { console.error("Nenhum administrador encontrado."); process.exit(1); }

run("update users set password_hash=?, active=1, approval='aprovado' where id=?", hashPassword(pass), u.id);
run("insert into activity_log(user_id, unit_id, kind, message) values(?, null, 'usuario', 'Senha do administrador redefinida pelo servidor')", u.id);
console.log(`OK: senha de ${u.email} redefinida para a ADMIN_PASSWORD do .env.`);
