/* Robot de monitoreo del Dique La Quebrada. Corre cada 10 minutos en GitHub Actions (Node 20+).
   Lee pluviómetros, nivel del dique y sensores del río (OHMC/APRHI), el pronóstico (Open-Meteo),
   evalúa la alerta, escribe data/estado.json y avisa al celular por ntfy cuando la alerta sube.
   Uso local: node monitor/run.js [--sin-avisos] */
"use strict";
const fs = require("fs"), path = require("path");
const motor = require("./engine.js");

const SITIO = "https://lucas22rivas.github.io/dique-la-quebrada/";
const NTFY = "https://ntfy.sh/dique-la-quebrada-4ax1kuwob5";
const OHMC = "https://estaciones-fe.ohmc.ar/api/v1/public";
const SIN_AVISOS = process.argv.includes("--sin-avisos") || process.env.SIN_AVISOS === "1";
const OUT = path.join(__dirname, "..", "data");

// Estaciones (id OHMC). cuenca: true = dentro de la cuenca del dique, cuentan para el promedio.
const PLUVIOS = [
  { id: 58, nombre: "Cuenca Alta Colanchanga", cuenca: true },
  { id: 93, nombre: "Los Hornillos", cuenca: true },
  { id: 67, nombre: "La Estancita (Salsipuedes)", cuenca: false },
  { id: 390, nombre: "Aº Los Quebrachitos (Unquillo)", cuenca: false },
  { id: 389, nombre: "Aº Chiviquín (divisoria oeste)", cuenca: false },
];
const DIQUE = { id: 75, tipo: 90, vertedero: 34.0 };
const RIOS = [
  { id: 98670, nombre: "Río Ceballos · Puente Amuchástegui" },
  { id: 751, nombre: "Río Ceballos · Puente San José" },
  { id: 174264, nombre: "Arroyo Saldán · Unquillo" },
];
const PRON = { lat: -31.15, lon: -64.38 };

const now = Date.now();
const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
const diaLocal = t => new Date(t - 3 * 3600e3).toISOString().slice(0, 10); // Córdoba UTC-3
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "monitor-dique-la-quebrada (+" + SITIO + ")" }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { if (i === tries - 1) throw e; }
    await new Promise(s => setTimeout(s, 2000 * (i + 1)));
  }
  return null;
}
async function serie(id, tipo, dias) {
  const u = `${OHMC}/mediciones?station_id=${id}&start=${iso(now - dias * 864e5)}&end=${iso(now + 6e5)}&tipo_variable_id=${tipo}&limit=10000`;
  const j = await getJSON(u);
  return ((j && j.data) || []).filter(e => e.valor != null && Number.isFinite(+e.valor))
    .map(e => ({ t: Date.parse(e.valida_en), v: +e.valor })).sort((a, b) => a.t - b.t);
}
const suma = (pts, desde) => pts.filter(p => p.t > desde).reduce((s, p) => s + p.v, 0);
const r1 = x => Math.round(x * 10) / 10;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const errores = [];

  // 1. Pluviómetros
  const lluvias = [];
  for (const p of PLUVIOS) {
    try {
      const s = await serie(p.id, 4, 7);
      const ult = s.length ? s[s.length - 1].t : null;
      const fresca = ult && now - ult < 60 * 60e3;
      const diario = {};
      for (const x of s) { const k = diaLocal(x.t); diario[k] = r1((diario[k] || 0) + x.v); }
      const max10 = Math.max(0, ...s.filter(x => x.t > now - 20 * 60e3).map(x => x.v));
      lluvias.push({ ...p, ultimoDato: ult ? iso(ult) : null, activa: !!fresca,
        h1: r1(suma(s, now - 36e5)), h3: r1(suma(s, now - 3 * 36e5)), h24: r1(suma(s, now - 24 * 36e5)), d5: r1(suma(s, now - 5 * 864e5)),
        intensidad: r1(max10 * 6), diario,
        ultimas6h: s.filter(x => x.t > now - 6 * 36e5).map(x => [iso(x.t), r1(x.v)]) });
    } catch (e) { errores.push("Pluviómetro " + p.nombre + ": " + e.message); lluvias.push({ ...p, activa: false }); }
  }
  // Si falla un pluviómetro de la cuenca, se reemplaza por el promedio de los vecinos que funcionan
  let enCuenca = lluvias.filter(l => l.cuenca && l.activa);
  if (enCuenca.length < 2) { const vec = lluvias.filter(l => !l.cuenca && l.activa); if (vec.length) enCuenca = enCuenca.concat(vec); }
  const prom = k => enCuenca.length ? r1(enCuenca.reduce((s, l) => s + l[k], 0) / enCuenca.length) : 0;
  const cuenca = { estaciones: enCuenca.length, h1: prom("h1"), h3: prom("h3"), h24: prom("h24"), d5: prom("d5"),
    intensidad: enCuenca.length ? Math.max(...enCuenca.map(l => l.intensidad)) : 0 };

  // 2. Nivel del dique
  let dique = null;
  try {
    const s = await serie(DIQUE.id, DIQUE.tipo, 3);
    const ok = s.filter(x => x.v > 15 && x.v < 40); // descarta lecturas imposibles
    if (ok.length) {
      const u = ok[ok.length - 1];
      const hace = h => { const c = ok.filter(x => x.t <= now - h * 36e5); return c.length ? c[c.length - 1].v : null; };
      const h24 = hace(24);
      dique = { cota: +u.v.toFixed(2), respectoVertedero: +(u.v - DIQUE.vertedero).toFixed(2), dato: iso(u.t), activa: now - u.t < 2 * 36e5,
        cambio24h: h24 == null ? null : +(u.v - h24).toFixed(2),
        serie: ok.filter((x, i) => i % 3 === 0 || i === ok.length - 1).map(x => [iso(x.t), +(x.v - DIQUE.vertedero).toFixed(2)]) };
    }
  } catch (e) { errores.push("Nivel del dique: " + e.message); }

  // 3. Sensores del río
  const rios = [];
  for (const r of RIOS) {
    try {
      const s = (await serie(r.id, 26, 2)).filter(x => x.v > -1 && x.v < 15);
      if (!s.length) { rios.push({ ...r, activa: false }); continue; }
      const u = s[s.length - 1];
      const prev30 = s.filter(x => x.t <= u.t - 30 * 60e3).pop();
      const min24 = Math.min(...s.filter(x => x.t > u.t - 24 * 36e5).map(x => x.v));
      rios.push({ ...r, nivel: +u.v.toFixed(2), dato: iso(u.t), activa: now - u.t < 60 * 60e3,
        subida30: prev30 ? +(u.v - prev30.v).toFixed(2) : null, subida24: +(u.v - min24).toFixed(2),
        serie: s.filter(x => x.t > now - 24 * 36e5).map(x => [iso(x.t), +x.v.toFixed(2)]) });
    } catch (e) { errores.push("Río " + r.nombre + ": " + e.message); rios.push({ ...r, activa: false }); }
  }

  // 3b. Cámara y sensor Orus de Puente San José (si hay credenciales)
  let camara = null;
  try {
    camara = await require("./orus.js").leer({ now, iso, outDir: OUT });
    fs.mkdirSync(path.join(OUT, "camara"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "camara", "camara.json"), JSON.stringify(camara));
    if (camara.configurado && camara.ultimo && camara.ultimo.nivel != null) {
      const fresca = now - Date.parse(camara.ultimo.t) < 60 * 60e3;
      rios.push({ id: "orus", nombre: "Río Ceballos · Puente San José (cámara Orus)", nivel: camara.ultimo.nivel, dato: camara.ultimo.t, activa: fresca, subida30: camara.ultimo.subida30, caudal: camara.ultimo.caudal,
        serie: camara.serie.filter(x => Date.parse(x[0]) > now - 24 * 36e5).map(x => [x[0], x[1]]) });
    }
    console.log("Orus:", camara.configurado ? (camara.error || (camara.estacion.nombre + " · " + (camara.ultimo ? camara.ultimo.nivel + " m, " + camara.ultimo.caudal + " m³/s" : "sin lecturas") + " · " + camara.fotos.length + " fotos" + (camara.video ? " · video" : ""))) : camara.nota);
  } catch (e) { errores.push("Cámara Orus: " + e.message); camara = { configurado: true, error: e.message }; }

  // 4. Pronóstico
  let pronostico = null;
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${PRON.lat}&longitude=${PRON.lon}&hourly=precipitation,precipitation_probability&forecast_days=3&timezone=UTC`);
    const t = j.hourly.time.map(x => Date.parse(x + ":00Z")), p = j.hourly.precipitation, pr = j.hourly.precipitation_probability;
    const fut = t.map((x, i) => ({ t: x, p: p[i] || 0, pr: pr ? pr[i] : null })).filter(x => x.t >= now - 36e5);
    const s = h => r1(fut.filter(x => x.t < now + h * 36e5).reduce((a, x) => a + x.p, 0));
    pronostico = { fuente: "Open-Meteo (modelos meteorológicos)", h6: s(6), h24: s(24), h48: s(48),
      horario: fut.slice(0, 48).map(x => [iso(x.t), r1(x.p), x.pr]) };
  } catch (e) { errores.push("Pronóstico: " + e.message); }

  // 4b. Celdas de tormenta del radar RMA1 (OHMC): núcleos convectivos, topes y riesgo de granizo
  let tormentas = null;
  try {
    const W = "https://webmet.ohmc.ar/api/v1";
    const recs = (await getJSON(`${W}/tops-cores?time_from=${iso(now - 30 * 60e3)}&time_to=${iso(now + 6e5)}&radar_codes=RMA1`)) || [];
    const ok = recs.filter(r => r.status === "available" && (r.vol_nr === "01" || !r.vol_nr)).sort((a, b) => Date.parse(b.observation_time) - Date.parse(a.observation_time));
    const DQ = [-31.1495, -64.3421], rad = x => x * Math.PI / 180;
    const dist = (a, b) => { const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
    const rumbo = (a, b) => { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) / 45) % 8]; };
    if (ok.length) {
      const rec = ok[0], fc = await getJSON(`${W}/tops-cores/${rec.id}/features`);
      const fs2 = (fc && fc.features) || [];
      const tops = fs2.filter(x => x.properties && x.properties.type === "top" && x.geometry.type === "Point");
      const celdas = fs2.filter(x => x.properties && x.properties.type === "blob" && x.geometry.type === "Polygon").map(b => {
        const ring = b.geometry.coordinates[0], c = ring.reduce((a, p) => [a[0] + p[1] / ring.length, a[1] + p[0] / ring.length], [0, 0]);
        let top = null, best = Infinity;
        tops.forEach(t => { const d = (t.geometry.coordinates[1] - c[0]) ** 2 + (t.geometry.coordinates[0] - c[1]) ** 2; if (d < best) { best = d; top = t.properties.altitude_m; } });
        const maxDbz = b.properties.max_dbz != null ? b.properties.max_dbz : b.properties.intensity_dbz;
        return { lat: +c[0].toFixed(4), lon: +c[1].toFixed(4), maxDbz, topKm: top != null && best < 0.01 ? +(top / 1000).toFixed(1) : null, dist: +dist(DQ, c).toFixed(1), dir: rumbo(DQ, c) };
      }).filter(c => c.dist <= 120).sort((a, b) => a.dist - b.dist);
      tormentas = { dato: iso(Date.parse(rec.observation_time)), fuente: "Radar RMA1 · núcleos convectivos (OHMC)", celdas: celdas.slice(0, 12) };
    } else tormentas = { dato: null, fuente: "Radar RMA1 · núcleos convectivos (OHMC)", celdas: [] };
  } catch (e) { errores.push("Celdas de tormenta: " + e.message); }

  // Historial de 30 días, altura normal del río y crecidas detectadas
  let hist = null;
  try {
    hist = await require("./historia.js").construir({ serie, getJSON, sitio: SITIO, now, iso });
    fs.writeFileSync(path.join(OUT, "historia.json"), JSON.stringify(hist));
    console.log("Historial:", hist.recarga ? "recarga completa (30 días)" : "actualizado", "·", hist.eventos.length, "crecidas en 30 días");
  } catch (e) { errores.push("Historial: " + e.message); }

  // Archivo histórico del año en curso: se actualiza una vez por día (o si falta)
  try {
    const y = new Date(now).getUTCFullYear();
    let arch = null; try { arch = await getJSON(SITIO + "data/archivo/" + y + ".json?t=" + now, 1); } catch (e) { }
    if (!arch) { const loc = path.join(__dirname, "..", "archivo", y + ".json"); if (fs.existsSync(loc)) arch = JSON.parse(fs.readFileSync(loc, "utf8")); }
    const viejo = !arch || !arch.hasta || now - Date.parse(arch.hasta) > 20 * 36e5;
    fs.mkdirSync(path.join(OUT, "archivo"), { recursive: true });
    if (viejo) { arch = await require("./archivo.js").actualizar(arch, now); console.log("Archivo", y, "actualizado hasta", arch.hasta); }
    if (arch) fs.writeFileSync(path.join(OUT, "archivo", y + ".json"), JSON.stringify(arch));
  } catch (e) { errores.push("Archivo histórico: " + e.message); }

  // Lluvia antecedente (API, mm): lluvia de cada uno de los últimos 20 días, que pierde un 10 % por día
  let api = null;
  if (hist) {
    const t0 = Date.parse(hist.h.inicio), a = hist.h.s.p58, b = hist.h.s.p93, dias = new Array(20).fill(0);
    a.forEach((_, i) => { const t = t0 + i * 36e5, d = Math.floor((now - t) / 864e5); if (d < 0 || d >= 20) return; const v = [a[i], b[i]].filter(x => x != null); if (v.length) dias[d] += v.reduce((x, y) => x + y, 0) / v.length; });
    api = +dias.reduce((s, r, d) => s + r * Math.pow(0.9, d), 0).toFixed(1);
    cuenca.api = api;
  }
  // Evapotranspiración de referencia en Los Hornillos (OHMC), promedio de 7 días, para la evaporación del embalse
  let evap = null;
  try { const et = await serie(93, 30, 7); if (et.length > 48) evap = +(et.reduce((s, p) => s + p.v, 0) / (et.length / 24) * (et.length > 0 ? 1 : 0)).toFixed(1); } catch (e) { errores.push("Evapotranspiración: " + e.message); }

  // 5. Evaluación
  const ev = motor.evaluar({
    nivelDique: dique && dique.activa ? dique.respectoVertedero : (dique ? dique.respectoVertedero : null),
    lluvia: cuenca, intensidad: cuenca.intensidad,
    rios: rios.filter(r => r.activa).map(r => ({ nombre: r.nombre, subida30: r.subida30, subida24: r.subida24, sobreNormal: r.id === "orus" ? (camara && camara.normal != null ? +(r.nivel - camara.normal).toFixed(2) : null) : hist && hist.normal[r.id] != null ? +(r.nivel - hist.normal[r.id]).toFixed(2) : null })),
    pronostico,
    celdas: tormentas ? tormentas.celdas : [],
  });

  // 6. Estado anterior (desde el sitio publicado) para detectar cambios
  let previo = null;
  try { previo = await getJSON(SITIO + "data/estado.json?t=" + now, 1); } catch (e) { /* primera vez */ }
  const ordenPrev = previo && previo.alerta ? previo.alerta.orden : 0;
  let historial = (previo && previo.historial) || [];
  if (!previo || previo.alerta.nivel !== ev.nivel) historial.unshift({ t: iso(now), nivel: ev.nivel, motivo: ev.motivos[0] ? ev.motivos[0].texto : "Sin novedades" });
  historial = historial.slice(0, 30);

  // 7. Avisos al celular
  let aviso = null;
  const ultimoAviso = previo && previo.ultimoAviso ? Date.parse(previo.ultimoAviso) : 0;
  const subio = ev.orden > ordenPrev;
  const bajoANormal = previo && ordenPrev >= 2 && ev.orden === 0;
  const recordatorio = ev.orden === 3 && now - ultimoAviso > 30 * 60e3;
  if ((subio && ev.orden >= 1) || bajoANormal || recordatorio) {
    const titulo = bajoANormal ? "Dique La Quebrada: vuelve a Normal" : `${ev.etiqueta.toUpperCase()} · Dique La Quebrada`;
    const nivelTxt = dique ? `Dique: ${dique.respectoVertedero > 0 ? "+" : ""}${dique.respectoVertedero.toFixed(2).replace(".", ",")} m respecto del vertedero.` : "";
    const cuerpo = (bajoANormal ? "Terminó la situación de alerta. " : "") + ev.motivos.slice(0, 3).map(m => "• " + m.texto).join("\n") +
      `\nLluvia en la cuenca: ${cuenca.h1} mm en 1 h, ${cuenca.h24} mm en 24 h. ${nivelTxt}\nSeguí las indicaciones de Defensa Civil.`;
    aviso = { titulo, cuerpo, prioridad: ev.orden === 3 ? "urgent" : ev.orden === 2 ? "high" : "default" };
    if (!SIN_AVISOS) {
      try {
        const r = await fetch(NTFY, { method: "POST", body: cuerpo, headers: {
          Title: titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "-"), Priority: aviso.prioridad,
          Tags: ev.orden === 3 ? "rotating_light" : ev.orden === 2 ? "warning" : bajoANormal ? "white_check_mark" : "cloud_with_rain",
          Click: SITIO }, signal: AbortSignal.timeout(20000) });
        aviso.enviado = r.ok;
      } catch (e) { aviso.enviado = false; errores.push("Aviso ntfy: " + e.message); }
    }
  }

  const estado = {
    generado: iso(now), sitio: SITIO, canalAvisos: NTFY,
    alerta: ev, cuenca, evapotranspiracion: evap, camara: camara && { configurado: camara.configurado, error: camara.error || null, ultimo: camara.ultimo || null, estacion: camara.estacion ? camara.estacion.nombre : null }, modelo: { cn: ev.cn, api: ev.api, formula: "CN = 34 + 0,32 × API; escurrimiento mínimo 3,5 %" }, pluviometros: lluvias, dique, rios, pronostico, tormentas, historial,
    ultimoAviso: aviso && aviso.enviado ? iso(now) : (previo && previo.ultimoAviso) || null, aviso,
    umbrales: motor.UMBRALES, errores,
    fuentes: ["OHMC / APRHI · estaciones-fe.ohmc.ar", "Open-Meteo · pronóstico", "Radar RMA1 · núcleos de tormenta (OHMC)", "Motor de alertas propio (umbrales provisorios)"],
  };
  if (hist) { estado.ultimaCrecida = hist.eventos[0] || null; estado.normalRio = hist.normal; }
  fs.writeFileSync(path.join(OUT, "estado.json"), JSON.stringify(estado));
  console.log(`[${estado.generado}] ${ev.etiqueta} · cuenca ${cuenca.h1} mm/1h ${cuenca.h24} mm/24h ${cuenca.d5} mm/5d · dique ${dique ? dique.respectoVertedero : "?"} m · pron48 ${pronostico ? pronostico.h48 : "?"} mm · aviso ${aviso ? (aviso.enviado === undefined ? "simulado" : aviso.enviado) : "no"}`);
  ev.motivos.forEach(m => console.log("  -", m.nivel, m.texto));
  if (errores.length) console.log("Errores:", errores.join(" | "));
}
main().catch(e => { console.error(e); process.exit(1); });
