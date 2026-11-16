/* Respaldo: portal de datos abiertos de APRHI (ArcGIS, portal-aprhi.opendata.arcgis.com).
   Son los mismos sensores que publica el OHMC, pero servidos por otro camino y sin sesión.
   Se usa sólo cuando el OHMC falla, y alcanza para la alerta (no para el historial de 30 días):
   - lluvia: horaria de los últimos ~10 días (Lluvia_Historico_Hs_TAB_PUB) + cada 10 min de las últimas 2 h
   - nivel de río y dique: cada 10 min de las últimas 24 h (nivel10min_ultimas24hs_tab)
   Verificado contra el OHMC (13/11/2026, Los Hornillos): el dato horario de las H:00 es la suma
   de las lecturas de H:00 a H:50, igual que en el OHMC. */
"use strict";
const B = "https://services1.arcgis.com/atxllciEI8CHWvwW/arcgis/rest/services/";
// id de estación del OHMC -> código APRHI (id_origen en el OHMC)
const CODIGO = { 58: "30238", 93: "30236", 67: "30444", 390: "30027", 389: "30026", 75: "30221", 98670: "30188", 751: "30187", 174264: "30196" };
const DIAS_MAX = 10;

async function consulta(capa, where, campos, orden) {
  const filas = [];
  for (let offset = 0; offset < 20000; offset += 2000) {
    const q = new URLSearchParams({ where, outFields: campos, orderByFields: orden, returnGeometry: "false", resultOffset: offset, resultRecordCount: 2000, f: "json" });
    const r = await fetch(B + capa + "/FeatureServer/0/query?" + q, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error("portal APRHI respondió " + r.status);
    const j = await r.json();
    if (j.error) throw new Error("portal APRHI: " + (j.error.message || "error"));
    for (const f of j.features || []) filas.push(f.attributes);
    if (!j.exceededTransferLimit) break;
  }
  return filas;
}
const ts = t => new Date(t).toISOString().replace("T", " ").slice(0, 19);

// Misma forma que serie() de run.js: [{ t, v }] ordenado por tiempo
async function serie(id, tipo, dias, now) {
  const cod = CODIGO[id];
  if (!cod) throw new Error("la estación " + id + " no está en el portal APRHI");
  if (dias > DIAS_MAX) throw new Error("el portal APRHI no guarda " + dias + " días");
  const desde = now - dias * 864e5;
  if (tipo === 4) {
    const m10 = (await consulta("lluvia_10_min_ultimas_2_hs", `codigo_estacion='${cod}'`, "fecha_medicion,medicion_lluvia_mm", "fecha_medicion"))
      .filter(a => a.medicion_lluvia_mm != null).map(a => ({ t: a.fecha_medicion, v: +a.medicion_lluvia_mm }));
    const t0 = m10.length ? m10[0].t : now;
    const hs = (await consulta("Lluvia_Historico_Hs_TAB_PUB", `Codigo='${cod}' AND Fecha >= timestamp '${ts(desde)}'`, "Fecha,Precipitacion_mm", "Fecha"))
      .filter(a => a.Precipitacion_mm != null && a.Fecha + 36e5 <= t0) // la hora entera antes del primer dato de 10 min
      .map(a => ({ t: a.Fecha + 50 * 60e3, v: +a.Precipitacion_mm }));  // fechada en su última lectura, como el OHMC
    return hs.concat(m10).filter(p => p.t > desde).sort((a, b) => a.t - b.t);
  }
  if (tipo === 26 || tipo === 90) {
    return (await consulta("nivel10min_ultimas24hs_tab", `codigo='${cod}'`, "fecha,nivel_m", "fecha"))
      .filter(a => a.nivel_m != null && a.fecha > desde).map(a => ({ t: a.fecha, v: +a.nivel_m }));
  }
  throw new Error("variable " + tipo + " no disponible en el portal APRHI");
}

module.exports = { serie, CODIGO };
