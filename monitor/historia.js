/* Historial de 30 días (horario) y 7 días (cada 10 min) de pluviómetros, río y dique, con detección de crecidas.
   Para no cargar al OHMC, reutiliza el historial publicado y solo pide las últimas horas. */
"use strict";
const H = 36e5, M10 = 6e5;
const PLUVIOS = [58, 93, 67, 390], CUENCA = [58, 93];
const RIOS = [98670, 751, 174264];
const NOMBRE_RIO = { 98670: "Puente Amuchástegui", 751: "Puente San José", 174264: "Arroyo Saldán (Unquillo)" };

async function construir({ serie, getJSON, sitio, now, iso }) {
  const t0h = Math.floor(now / H) * H - 30 * 24 * H, t0m = Math.floor(now / M10) * M10 - 7 * 24 * H;
  let prev = null;
  try { prev = await getJSON(sitio + "data/historia.json?t=" + now, 1); } catch (e) { /* primera vez */ }
  const fresco = prev && prev.version === 2 && now - Date.parse(prev.generado) < 2 * 24 * H;
  const dias = fresco ? 0.3 : 30; // 7 h o 30 días

  // Mapas t -> valor (10 min) reconstruidos desde el historial previo
  const m10 = {}; const keys = [...PLUVIOS.map(id => "p" + id), ...RIOS.map(id => "r" + id), "dique"];
  keys.forEach(k => m10[k] = new Map());
  const hor = {}; keys.forEach(k => hor[k] = new Map());
  if (fresco) {
    const pm = Date.parse(prev.m10.inicio), ph = Date.parse(prev.h.inicio);
    keys.forEach(k => {
      (prev.m10.s[k] || []).forEach((v, i) => { if (v != null) m10[k].set(pm + i * M10, v); });
      (prev.h.s[k] || []).forEach((v, i) => { if (v != null) hor[k].set(ph + i * H, v); });
    });
  }
  // Pedir lo nuevo
  const pedir = async (k, id, tipo, filtro) => {
    const s = (await serie(id, tipo, dias)).filter(filtro);
    s.forEach(p => m10[k].set(Math.round(p.t / M10) * M10, p.v));
    return s;
  };
  const nuevos = {};
  for (const id of PLUVIOS) nuevos["p" + id] = await pedir("p" + id, id, 4, p => p.v >= 0 && p.v < 80);
  for (const id of RIOS) nuevos["r" + id] = await pedir("r" + id, id, 26, p => p.v > -1 && p.v < 15);
  nuevos.dique = (await serie(75, 90, dias)).filter(p => p.v > 15 && p.v < 40);
  nuevos.dique.forEach(p => m10.dique.set(Math.round(p.t / M10) * M10, +(p.v - 34).toFixed(2)));

  // Recalcular las horas afectadas a partir de los datos de 10 min (lluvia: suma; río: máximo; dique: último)
  const desde = fresco ? Math.floor((now - dias * 24 * H) / H) * H - H : t0h;
  keys.forEach(k => {
    const agg = new Map();
    for (const [t, v] of m10[k]) {
      if (t < desde) continue;
      const hh = Math.floor((t - 1) / H) * H; // el dato de 10:00 cuenta para la hora 09–10
      const a = agg.get(hh);
      if (k[0] === "p") agg.set(hh, (a || 0) + v);
      else if (k[0] === "r") agg.set(hh, a == null ? v : Math.max(a, v));
      else agg.set(hh, v);
    }
    for (const [hh, v] of agg) hor[k].set(hh, +v.toFixed(2));
  });

  // Serializar en series de paso fijo
  const nh = Math.floor(now / H) - Math.floor(t0h / H) + 1, nm = Math.floor(now / M10) - Math.floor(t0m / M10) + 1;
  const h = { inicio: iso(t0h), paso: 3600, s: {} }, m = { inicio: iso(t0m), paso: 600, s: {} };
  keys.forEach(k => {
    h.s[k] = Array.from({ length: nh }, (_, i) => { const v = hor[k].get(t0h + i * H); return v == null ? null : v; });
    m.s[k] = Array.from({ length: nm }, (_, i) => { const v = m10[k].get(t0m + i * M10); return v == null ? null : +(+v).toFixed(2); });
  });
  // La lluvia de 10 min solo hace falta para la cuenca; el resto se resume por hora
  [67, 390].forEach(id => delete m.s["p" + id]);

  // Valor normal del río: mediana de los últimos 7 días
  const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const normal = {}; RIOS.forEach(id => normal[id] = med(m.s["r" + id]));

  // Detección de crecidas en el horario de 30 días
  const eventos = [];
  const lluviaCuenca = i => { const v = CUENCA.map(id => h.s["p" + id][i]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  let i = 0;
  while (i < nh) {
    const sobre = RIOS.some(id => { const v = h.s["r" + id][i], b = med(h.s["r" + id].slice(Math.max(0, i - 72), Math.max(1, i - 6))); return v != null && b != null && v - b >= 0.25; });
    if (!sobre) { i++; continue; }
    let j = i; while (j < nh && RIOS.some(id => { const v = h.s["r" + id][j], b = med(h.s["r" + id].slice(Math.max(0, i - 72), Math.max(1, i - 6))); return v != null && b != null && v - b >= 0.12; })) j++;
    const ev = { inicio: iso(t0h + i * H), fin: iso(t0h + j * H), picos: [], lluvia: 0 };
    for (let k = Math.max(0, i - 12); k < j; k++) ev.lluvia += lluviaCuenca(k);
    ev.lluvia = Math.round(ev.lluvia);
    RIOS.forEach(id => {
      const arr = h.s["r" + id], base = med(arr.slice(Math.max(0, i - 72), Math.max(1, i - 6)));
      let pk = null, pt = null; for (let k = i; k < Math.min(nh, j + 6); k++) if (arr[k] != null && (pk == null || arr[k] > pk)) { pk = arr[k]; pt = k; }
      if (pk != null) ev.picos.push({ id, nombre: NOMBRE_RIO[id], pico: pk, hora: iso(t0h + pt * H), base, subida: base == null ? null : +(pk - base).toFixed(2) });
    });
    eventos.push(ev); i = j + 6;
  }
  // Afinar la hora de los picos con los datos de 10 min cuando están disponibles
  eventos.forEach(ev => ev.picos.forEach(p => {
    const t1 = Date.parse(ev.inicio) - 2 * H, t2 = Date.parse(ev.fin) + 6 * H, a = m.s["r" + p.id];
    let pk = null, pt = null;
    for (let k = 0; k < a.length; k++) { const t = t0m + k * M10; if (t < t1 || t > t2 || a[k] == null) continue; if (pk == null || a[k] > pk) { pk = a[k]; pt = t; } }
    if (pk != null) { p.pico = pk; p.hora = iso(pt); if (p.base != null) p.subida = +(pk - p.base).toFixed(2); p.fino = true; }
  }));

  return { version: 2, generado: iso(now), nombres: { p58: "Cuenca Alta Colanchanga", p93: "Los Hornillos", p67: "La Estancita (Salsipuedes)", p390: "Aº Los Quebrachitos (Unquillo)", r98670: NOMBRE_RIO[98670], r751: NOMBRE_RIO[751], r174264: NOMBRE_RIO[174264], dique: "Nivel del dique (m respecto del vertedero)" },
    h, m10: m, normal, eventos: eventos.reverse(), recarga: !fresco };
}
module.exports = { construir };
