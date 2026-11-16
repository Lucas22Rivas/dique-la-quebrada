/* Sensor y cámara Orus de Puente San José: altura, caudal, últimas fotos y el último video grabado.
   Credenciales: variables de entorno ORUS_USUARIO / ORUS_CLAVE (secretos de GitHub en el robot,
   o el archivo .env local de la carpeta del proyecto, que nunca se publica). */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const PUENTE = [-31.1820, -64.3144]; // Puente San José (lat, lon)
const FOTOS = 6;                     // fotos recientes para la secuencia (≈ 1 hora)

function cargarEnvLocal() {
  for (const p of [path.join(__dirname, "..", "..", ".env"), path.join(__dirname, "..", ".env")]) {
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || l.trim().startsWith("#")) continue;
      if (!process.env[m[1]] && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    break;
  }
}
const pad = n => String(n).padStart(2, "0");
const fechaOrus = t => { const d = new Date(t - 3 * 36e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const distKm = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

async function leer({ now, iso, outDir }) {
  cargarEnvLocal();
  const API = (process.env.ORUS_API || "https://api.dataview.orus.cam/api/").replace(/\/?$/, "/");
  const U = process.env.ORUS_USUARIO, P = process.env.ORUS_CLAVE;
  if (!U || !P) return { configurado: false, nota: "Faltan las credenciales de Orus (ORUS_USUARIO y ORUS_CLAVE)." };
  const pedir = async (url, opt = {}) => {
    const r = await fetch(url.startsWith("http") ? url.replace(/^http:/, "https:") : API + url, { ...opt, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Orus respondió ${r.status} en ${url.split("?")[0]}`);
    return r;
  };
  // 1. Iniciar sesión (el token no se guarda en ningún lado)
  const tok = await (await pedir("token/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: U, password: P }) })).json();
  const auth = { Authorization: "Bearer " + tok.access };
  const get = async u => (await pedir(u, { headers: auth })).json();

  // 2. Estación: la indicada o la más cercana al puente
  const geo = await get("v1/stations-geo/");
  const feats = (geo.features || []).map(f => ({ uuid: f.properties.uuid, nombre: f.properties.name, rio: f.properties.river_name, coord: [f.geometry.coordinates[1], f.geometry.coordinates[0]], last: f.properties.last_log, cadencia: f.properties.cadence }));
  let est = process.env.ORUS_ESTACION ? feats.find(f => f.uuid === process.env.ORUS_ESTACION) : null;
  if (!est && feats.length) est = feats.map(f => ({ ...f, d: distKm(PUENTE, f.coord) })).sort((a, b) => a.d - b.d)[0];
  if (!est) return { configurado: true, error: "La cuenta de Orus no tiene estaciones visibles." };
  const lejos = est.d != null && est.d > 2;

  // 3. Serie de las últimas 48 h (altura y caudal)
  const serie = await get(`v1/stations/${est.uuid}/logs/series/?created_after=${encodeURIComponent(fechaOrus(now - 48 * 36e5))}&created_before=${encodeURIComponent(fechaOrus(now + 36e5))}`);
  const filas = (Array.isArray(serie) ? serie : serie.results || []).map(l => ({ id: l.id, t: Date.parse(l.created), nivel: l.level != null ? +l.level : null, caudal: l.discharge != null ? +l.discharge : null, foto: l.with_snapshot, video: l.with_video }))
    .filter(l => Number.isFinite(l.t)).sort((a, b) => a.t - b.t);

  // 4. Fotos recientes y último video (los links de Orus vencen: se descargan y se publican copias)
  const dir = path.join(outDir, "camara"); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.(jpg|mp4)$/.test(f)) fs.unlinkSync(path.join(dir, f));
  const recientes = filas.slice(-40).reverse();
  const fotos = []; let video = null;
  for (const l of recientes) {
    if (fotos.length >= FOTOS && video) break;
    let d; try { d = await get(`v1/stations/${est.uuid}/logs/${l.id}/`); } catch (e) { continue; }
    if (fotos.length < FOTOS && d.image) {
      try { const b = Buffer.from(await (await pedir(d.image)).arrayBuffer()); const nom = `foto-${fotos.length}.jpg`; fs.writeFileSync(path.join(dir, nom), b); fotos.push({ t: iso(l.t), archivo: "data/camara/" + nom, nivel: l.nivel, caudal: l.caudal }); } catch (e) { }
    }
    if (!video && d.video_url) {
      try {
        const crudo = path.join(dir, "crudo.mp4"); fs.writeFileSync(crudo, Buffer.from(await (await pedir(d.video_url)).arrayBuffer()));
        const fin = path.join(dir, "video.mp4");
        try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", crudo, "-t", "30", "-vf", "scale=-2:540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-an", "-movflags", "+faststart", fin]); fs.unlinkSync(crudo); }
        catch (e) { fs.renameSync(crudo, fin); }
        video = { t: iso(l.t), archivo: "data/camara/video.mp4", nivel: l.nivel, caudal: l.caudal, bytes: fs.statSync(fin).size };
      } catch (e) { }
    }
  }
  const ult = filas[filas.length - 1] || null;
  const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const prev30 = ult ? [...filas].reverse().find(l => l.t <= ult.t - 30 * 6e4 && l.nivel != null) : null;
  return {
    configurado: true, generado: iso(now),
    estacion: { uuid: est.uuid, nombre: est.nombre, rio: est.rio, lat: est.coord[0], lon: est.coord[1], distanciaPuenteKm: est.d != null ? +est.d.toFixed(2) : null, advertencia: lejos ? "La estación de Orus más cercana está a más de 2 km del Puente San José: revisá ORUS_ESTACION." : null, cadenciaMin: est.cadencia || null },
    ultimo: ult && { t: iso(ult.t), nivel: ult.nivel, caudal: ult.caudal, subida30: prev30 && ult.nivel != null ? +(ult.nivel - prev30.nivel).toFixed(2) : null },
    normal: med(filas.map(l => l.nivel)),
    fotos, video,
    serie: filas.map(l => [iso(l.t), l.nivel, l.caudal]),
  };
}
module.exports = { leer };
