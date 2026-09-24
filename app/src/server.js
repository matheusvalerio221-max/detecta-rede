import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./db.js";
import { loadUser } from "./auth.js";
import { routes } from "./routes.js";
import { seedIfEmpty } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function parseCookies(h = "") { return Object.fromEntries(h.split(";").map(s => s.trim().split("=")).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))])); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ""; req.on("data", c => { d += c; if (d.length > 2e6) { reject(new HttpError(413, "Corpo muito grande")); req.destroy(); } });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new HttpError(400, "JSON inválido")); } });
  });
}
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) return { r, params: m.groups || {} };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname.startsWith("/api/")) {
      const cookies = parseCookies(req.headers.cookie);
      const user = loadUser(cookies);
      const found = matchRoute(req.method, url.pathname.slice(4));
      if (!found) return send(404, { error: "Rota não encontrada" });
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
      const ctx = { user, body, params: found.params, query: Object.fromEntries(url.searchParams), ip: req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress, setCookie: null };
      if (found.r.auth !== false && !user) return send(401, { error: "Faça login para continuar." });
      const out = found.r.handler(ctx);
      return send(200, out ?? { ok: true }, ctx.setCookie ? { "Set-Cookie": ctx.setCookie } : {});
    }
    // estáticos + SPA
    let file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, ""));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error(e); send(500, { error: "Erro interno. Tente novamente." });
  }
});

migrate();
seedIfEmpty();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Detecta Rede no ar na porta ${PORT}`));
