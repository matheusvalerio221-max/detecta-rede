/* Processamento de mídia da Universidade — marca d'água gravada no arquivo.
   - Vídeo  → novo MP4 (H.264/AAC) com o logo Detecta no canto inferior direito.
   - PDF    → cada página vira JPG com o logo (o PDF original nunca vai para o aluno).
   - Imagem → JPG com o logo.
   Fila sequencial em segundo plano, com prioridade baixa (nice) para não pesar no servidor.
   Requer ffmpeg/ffprobe e pdftoppm (poppler-utils) no container. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { all, get, run, UPLOAD_DIR } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WATERMARK = path.join(__dirname, "..", "assets", "watermark.png");
export const DERIVED_DIR = path.join(UPLOAD_DIR, "derived");
fs.mkdirSync(DERIVED_DIR, { recursive: true });

const isVideo = (m) => /^video\//.test(m || "");
const isPdf = (m) => m === "application/pdf";
const isImage = (m) => /^image\//.test(m || "");
export const needsProcessing = (m) => isVideo(m) || isPdf(m) || isImage(m);

function exec(cmd, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("nice", ["-n", "15", cmd, ...args], { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    let out = "", err = "";
    if (capture) p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; if (err.length > 6000) err = err.slice(-6000); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`${cmd} saiu com código ${code}: ${err.slice(-400)}`)));
  });
}
async function probe(file) {
  const out = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], { capture: true });
  const [w, h] = out.trim().split("x").map(Number);
  if (!w || !h) throw new Error("Não foi possível ler as dimensões do arquivo.");
  return { w, h };
}
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
// vídeo em pé (celular) usa logo proporcionalmente maior; páginas usam sempre ~15% da largura
const logoSize = (w, h, page = false) => { const lw = even(page ? w * 0.15 : (w >= h ? w * 0.16 : w * 0.30)); return { lw: Math.max(lw, 110), margin: even(Math.max(12, Math.min(w, h) * 0.025)) }; };

async function watermarkImage(src, dst, maxW = 1600) {
  const { w, h } = await probe(src);
  const tw = Math.min(w, maxW), th = Math.round(h * tw / w);
  const { lw, margin } = logoSize(tw, th, true);
  await exec("ffmpeg", ["-y", "-v", "error", "-i", src, "-i", WATERMARK, "-filter_complex",
    `[0:v]scale=${tw}:-2[b];[1:v]scale=${lw}:-1[wm];[b][wm]overlay=W-w-${margin}:H-h-${margin}`, "-frames:v", "1", "-q:v", "3", dst]);
}
async function processVideo(f, srcPath) {
  const { w, h } = await probe(srcPath);
  const { lw, margin } = logoSize(w, h);
  const outName = `${crypto.randomUUID()}.wm.mp4`, tmp = path.join(DERIVED_DIR, outName + ".part");
  await exec("ffmpeg", ["-y", "-v", "error", "-i", srcPath, "-i", WATERMARK, "-filter_complex",
    `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[b];[1:v]scale=${lw}:-1[wm];[b][wm]overlay=W-w-${margin}:H-h-${margin}[v]`,
    "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "mp4", tmp]);
  fs.renameSync(tmp, path.join(DERIVED_DIR, outName));
  run("update files set wm_stored=?, pages=null where id=?", outName, f.id);
}
async function processPdf(f, srcPath) {
  const dir = path.join(DERIVED_DIR, `f${f.id}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await exec("pdftoppm", ["-png", "-scale-to-x", "1400", "-scale-to-y", "-1", srcPath, path.join(dir, "raw")]);
  const raws = fs.readdirSync(dir).filter((n) => n.startsWith("raw")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!raws.length) throw new Error("PDF sem páginas.");
  for (let i = 0; i < raws.length; i++) {
    await watermarkImage(path.join(dir, raws[i]), path.join(dir, `p-${i + 1}.jpg`), 1400);
    fs.rmSync(path.join(dir, raws[i]), { force: true });
  }
  run("update files set pages=?, wm_stored=null where id=?", raws.length, f.id);
}
async function processImage(f, srcPath) {
  const dir = path.join(DERIVED_DIR, `f${f.id}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await watermarkImage(srcPath, path.join(dir, "p-1.jpg"));
  run("update files set pages=1, wm_stored=null where id=?", f.id);
}

/* ---- fila ---- */
const queue = []; let busy = false;
export function enqueueMedia(fileId) {
  const f = get("select id, mime from files where id=? and kind='lesson'", fileId);
  if (!f || !needsProcessing(f.mime)) return;
  run("update files set proc_status='na_fila', proc_error=null where id=?", f.id);
  if (!queue.includes(f.id)) queue.push(f.id);
  setImmediate(drain);
}
async function drain() {
  if (busy) return; busy = true;
  try {
    while (queue.length) {
      const id = queue.shift(); const f = get("select * from files where id=?", id); if (!f) continue;
      const src = path.join(UPLOAD_DIR, f.stored);
      run("update files set proc_status='processando' where id=?", id);
      try {
        if (!fs.existsSync(src)) throw new Error("Arquivo original não encontrado.");
        if (isVideo(f.mime)) await processVideo(f, src); else if (isPdf(f.mime)) await processPdf(f, src); else if (isImage(f.mime)) await processImage(f, src);
        run("update files set proc_status='pronto', proc_error=null where id=?", id);
      } catch (e) {
        console.error(`[mídia] arquivo ${id}:`, e.message);
        run("update files set proc_status='erro', proc_error=? where id=?", String(e.message).slice(0, 300), id);
      }
    }
  } finally { busy = false; }
}
/* No início do servidor: processa o que ficou pendente (inclui materiais enviados antes desta versão). */
export function resumeMedia() {
  for (const f of all("select id, mime from files where kind='lesson' and (proc_status is null or proc_status in ('na_fila','processando')) order by id"))
    if (needsProcessing(f.mime)) enqueueMedia(f.id);
}
/* Remove derivados de um arquivo (ao excluir curso/aula). */
export function removeDerived(f) {
  if (f.wm_stored) fs.rmSync(path.join(DERIVED_DIR, f.wm_stored), { force: true });
  fs.rmSync(path.join(DERIVED_DIR, `f${f.id}`), { recursive: true, force: true });
}
export const pagePath = (fileId, n) => path.join(DERIVED_DIR, `f${Number(fileId)}`, `p-${Number(n)}.jpg`);
export const wmVideoPath = (f) => path.join(DERIVED_DIR, f.wm_stored);
