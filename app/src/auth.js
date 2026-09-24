import crypto from "node:crypto";
import { get } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-troque-em-producao";
export const COOKIE = "dr_session";
const TTL = 12 * 3600;

export const ROLES = {
  admin:      { name: "Administrador",          scope: "network" },
  gestor:     { name: "Gestor da franqueadora", scope: "network" },
  consultor:  { name: "Consultor de campo",     scope: "network" },
  franqueado: { name: "Franqueado",             scope: "unit" },
  tecnico:    { name: "Técnico da unidade",     scope: "unit" },
};
// [ver, inserir, editar, excluir]
export const DEFAULT_PERMS = {
  admin:      { units:[1,1,1,1], users:[1,1,1,1], tickets:[1,1,1,1], comms:[1,1,1,1], tasks:[1,1,1,1], security:[1,1,1,1] },
  gestor:     { units:[1,1,1,0], users:[1,1,1,0], tickets:[1,1,1,0], comms:[1,1,1,0], tasks:[1,1,1,0], security:[1,0,0,0] },
  consultor:  { units:[1,0,0,0], users:[1,0,0,0], tickets:[1,1,1,0], comms:[1,0,0,0], tasks:[1,1,1,0], security:[0,0,0,0] },
  franqueado: { units:[1,0,0,0], users:[1,0,0,0], tickets:[1,1,1,0], comms:[1,0,0,0], tasks:[1,1,1,0], security:[0,0,0,0] },
  tecnico:    { units:[0,0,0,0], users:[0,0,0,0], tickets:[1,1,0,0], comms:[1,0,0,0], tasks:[1,0,1,0], security:[0,0,0,0] },
};

/* senhas: scrypt */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
}
export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const h = crypto.scryptSync(pw, salt, 64);
  const s = Buffer.from(hash, "hex");
  return h.length === s.length && crypto.timingSafeEqual(h, s);
}

/* sessão: token assinado (HMAC) */
export function sign(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
export function verify(token) {
  try {
    const [payload, sig] = token.split(".");
    const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
}
export function cookieHeader(token, clear = false) {
  const secure = process.env.SECURE_COOKIES === "1" ? "; Secure" : "";
  return `${COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${clear ? 0 : TTL}`;
}
export function loadUser(cookies) {
  const t = cookies[COOKIE]; if (!t) return null;
  const data = verify(t); if (!data) return null;
  const u = get(`select u.id,u.name,u.email,u.role_key,u.unit_id,u.active,r.name as role_name,r.scope,r.perms,un.name as unit_name
    from users u join roles r on r.key=u.role_key left join units un on un.id=u.unit_id where u.id=?`, data.id);
  if (!u || !u.active) return null;
  u.perms = { ...DEFAULT_PERMS[u.role_key], ...JSON.parse(u.perms || "{}") };
  return u;
}
export const can = (user, module, action = 0) => !!(user?.perms?.[module] || [0,0,0,0])[action];
export const isNetwork = (u) => u.scope === "network";
