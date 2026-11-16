/* Archivo histórico horario por año (data/archivo/AAAA.json): lluvia, río y dique desde que hay datos en el OHMC.
   Uso local, para armar todo el archivo:  node monitor/archivo.js completo
   El robot llama a actualizar() una vez por día para sumar los últimos días al año en curso. */
"use strict";
const fs = require("fs"), path = require("path");
const OHMC = "https://estaciones-fe.ohmc.ar/api/v1/public";
const { ohmcFetch } = require("./ohmc.js");
const SERIES = [
  { k: "p58", id: 58, tipo: 4, desde: "2021-01-01", agg: "suma", esc: 10 },
  { k: "p93", id: 93, tipo: 4, desde: "2021-01-01", agg: "suma", esc: 10 },
  { k: "p67", id: 67, tipo: 4, desde: "2021-01-01", agg: "suma", esc: 10 },
  { k: "p390", id: 390, tipo: 4, desde: "2021-01-01", agg: "suma", esc: 10 },
  { k: "r98670", id: 98670, tipo: 26, desde: "2026-04-01", agg: "max", esc: 100 },
  { k: "r751", id: 751, tipo: 26, desde: "2026-04-01", agg: "max", esc: 100 },
  { k: "r174264", id: 174264, tipo: 26, desde: "2026-04-01", agg: "max", esc: 100 },
  { k: "dique", id: 75, tipo: 90, desde: "2023-06-01", agg: "ultimo", esc: 100, off: 34 },
];
const H = 36e5, iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
const valido = (s, v) => s.tipo === 4 ? v >= 0 && v < 80 : s.tipo === 26 ? v > -1 && v < 15 : v > 15 && v < 40;
const pausa = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await ohmcFetch(url, { signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch (e) { }
    await pausa(3000 * (i + 1));
  }
  throw new Error("OHMC no responde: " + url);
}
// Devuelve un Map hora -> valor agregado, pidiendo en ventanas de 30 días
async function horario(s, t1, t2) {
  const acc = new Map();
  for (let a = t1; a < t2; a += 30 * 864e5) {
    const b = Math.min(t2, a + 30 * 864e5);
    const j = await getJSON(`${OHMC}/mediciones?station_id=${s.id}&start=${iso(a)}&end=${iso(b)}&tipo_variable_id=${s.tipo}&limit=10000`);
    for (const e of (j && j.data) || []) {
      const v = +e.valor, t = Date.parse(e.valida_en); if (!Number.isFinite(v) || !valido(s, v)) continue;
      const h = Math.floor((t - 1) / H) * H, prev = acc.get(h);
      if (s.agg === "suma") acc.set(h, (prev || 0) + v);
      else if (s.agg === "max") acc.set(h, prev == null ? v : Math.max(prev, v));
      else acc.set(h, v - (s.off || 0));
    }
    await pausa(250);
  }
  return acc;
}
function vacio(year) {
  const t0 = Date.UTC(year, 0, 1), n = Math.round((Date.UTC(year + 1, 0, 1) - t0) / H);
  const s = {}; SERIES.forEach(x => s[x.k] = new Array(n).fill(null));
  return { version: 1, anio: year, inicio: iso(t0), paso: 3600, escala: Object.fromEntries(SERIES.map(x => [x.k, x.esc])), s, hasta: null };
}
// Quita picos imposibles del nivel del dique: más de 0,6 m de diferencia con la mediana de 24 h
function limpiarDique(arr) {
  const out = arr.slice();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    const w = []; for (let j = Math.max(0, i - 12); j <= Math.min(arr.length - 1, i + 12); j++) if (arr[j] != null) w.push(arr[j]);
    w.sort((a, b) => a - b); const med = w[Math.floor(w.length / 2)];
    if (Math.abs(arr[i] - med) > 60) out[i] = null;
  }
  return out;
}
function volcar(arch, k, mapa, esc) {
  const t0 = Date.parse(arch.inicio), n = arch.s[k].length;
  for (const [h, v] of mapa) { const i = Math.round((h - t0) / H); if (i >= 0 && i < n) arch.s[k][i] = Math.round(v * esc); }
}
async function completo(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ahora = Date.now(), y0 = 2021, y1 = new Date(ahora).getUTCFullYear();
  for (let y = y0; y <= y1; y++) {
    const arch = vacio(y), a = Date.UTC(y, 0, 1), b = Math.min(ahora, Date.UTC(y + 1, 0, 1));
    for (const s of SERIES) {
      const desde = Math.max(a, Date.parse(s.desde)); if (desde >= b) continue;
      process.stdout.write(`${y} ${s.k} … `);
      const m = await horario(s, desde, b); volcar(arch, s.k, m, s.esc); console.log(m.size + " h");
    }
    arch.s.dique = limpiarDique(arch.s.dique);
    arch.hasta = iso(b);
    fs.writeFileSync(path.join(outDir, y + ".json"), JSON.stringify(arch));
  }
}
// Suma los últimos días al año en curso. prev = archivo publicado (o del repositorio)
async function actualizar(prev, ahora) {
  const y = new Date(ahora).getUTCFullYear();
  const arch = prev && prev.anio === y ? prev : vacio(y);
  const desde = Math.max(Date.UTC(y, 0, 1), arch.hasta ? Date.parse(arch.hasta) - 2 * 864e5 : Date.UTC(y, 0, 1));
  for (const s of SERIES) { if (Date.parse(s.desde) >= ahora) continue; const m = await horario(s, Math.max(desde, Date.parse(s.desde)), ahora); volcar(arch, s.k, m, s.esc); }
  arch.s.dique = limpiarDique(arch.s.dique);
  arch.hasta = iso(ahora);
  return arch;
}
module.exports = { actualizar, SERIES, limpiarDique };
if (require.main === module && process.argv[2] === "completo") completo(process.argv[3] || path.join(__dirname, "..", "archivo")).then(() => console.log("listo"));
