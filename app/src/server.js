import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import crypto from "node:crypto";
import { migrate } from "./db.js";
import { loadUser } from "./auth.js";
import { routes } from "./routes.js";
import "./modules.js"; // Checklist, Universidade, arquivos
import { startMailer } from "./mail.js";
import { resumeMedia } from "./media.js";
import { seedIfEmpty } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function parseCookies(h = "") { return Object.fromEntries(h.split(";").map(s => s.trim().split("=")).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))])); }
function readRawToFile(req, max) { // grava direto em disco (vídeos grandes)
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), "dr-up-" + crypto.randomUUID()); const ws = fs.createWriteStream(tmp); let n = 0;
    req.on("data", c => { n += c.length; if (n > max) { ws.destroy(); fs.rm(tmp, { force: true }, () => {}); reject(new HttpError(413, `Arquivo muito grande (máx. ${Math.round(max / 1e6)} MB)`)); req.destroy(); } });
    req.pipe(ws); ws.on("finish", () => resolve({ path: tmp, size: n })); ws.on("error", reject);
  });
}
function readRaw(req, max = 12e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > max) { reject(new HttpError(413, "Arquivo muito grande (máx. 10 MB)")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
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
      if (found.r.auth !== false && !user) return send(401, { error: "Faça login para continuar." });
      const raw = found.r.raw && !found.r.stream && req.method === "POST" ? await readRaw(req) : null;
      const rawFile = found.r.stream && req.method === "POST" ? await readRawToFile(req, found.r.max || 320e6) : null;
      const body = !found.r.raw && ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
      const ctx = { user, body, raw, rawFile, headers: req.headers, params: found.params, query: Object.fromEntries(url.searchParams), ip: req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress, setCookie: null };
      let out; try { out = await found.r.handler(ctx); } finally { if (rawFile) fs.rm(rawFile.path, { force: true }, () => {}); }
      if (out && out.__file) { // resposta de arquivo
        const size = fs.statSync(out.__file).size; const hdr = { "Content-Type": out.mime, "Accept-Ranges": "bytes", "Content-Disposition": `${out.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(out.filename)}`, "Cache-Control": out.cache || "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
        const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (rg) { const start = rg[1] ? +rg[1] : Math.max(0, size - +rg[2]); const end = rg[2] && rg[1] ? Math.min(+rg[2], size - 1) : size - 1;
          res.writeHead(206, { ...hdr, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 }); return fs.createReadStream(out.__file, { start, end }).pipe(res); }
        res.writeHead(200, { ...hdr, "Content-Length": size }); return fs.createReadStream(out.__file).pipe(res);
      }
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
startMailer();
resumeMedia();
server.requestTimeout = 0; // uploads grandes (vídeos) podem levar mais de 5 min
server.headersTimeout = 65000;
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Detecta Rede no ar na porta ${PORT}`));
