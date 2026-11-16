/* Red de estaciones del corredor de Sierras Chicas (OHMC): pluviómetros, río y dique, snapshot en vivo.
   Una sola llamada al mapa del OHMC por corrida. Escribe data/red.json. */
"use strict";
// id OHMC -> { nombre, tipo, grupo }. tipo: lluvia | rio | dique.
const EST = [
  { id: 58, nombre: "Cuenca Alta Colanchanga", tipo: "lluvia", grupo: "cuenca" },
  { id: 93, nombre: "Los Hornillos", tipo: "lluvia", grupo: "cuenca" },
  { id: 75, nombre: "Dique La Quebrada", tipo: "dique", grupo: "cuenca" },
  { id: 67, nombre: "La Estancita (Salsipuedes)", tipo: "lluvia", grupo: "corredor" },
  { id: 25, nombre: "Agua de Oro", tipo: "lluvia", grupo: "corredor" },
  { id: 31, nombre: "Ascochinga", tipo: "lluvia", grupo: "corredor" },
  { id: 53, nombre: "Camino Ascochinga–La Cumbre", tipo: "lluvia", grupo: "corredor" },
  { id: 556, nombre: "Casa Grande", tipo: "lluvia", grupo: "corredor" },
  { id: 389, nombre: "Aº Chiviquín (Unquillo)", tipo: "lluvia", grupo: "corredor" },
  { id: 390, nombre: "Aº Los Quebrachitos (Unquillo)", tipo: "lluvia", grupo: "corredor" },
  { id: 574, nombre: "EPEC Mendiolaza", tipo: "lluvia", grupo: "corredor" },
  { id: 98670, nombre: "Río Ceballos · Puente Amuchástegui", tipo: "rio", grupo: "rio" },
  { id: 751, nombre: "Río Ceballos · Puente San José", tipo: "rio", grupo: "rio" },
  { id: 174264, nombre: "Arroyo Saldán · Unquillo", tipo: "rio", grupo: "rio" },
  { id: 746, nombre: "Río Saldán · Saldán", tipo: "rio", grupo: "rio" },
  { id: 2123427, nombre: "Río Ceballos · Puente San José (Orus)", tipo: "rio", grupo: "rio" },
];
const VERTEDERO = 34;

async function leer({ now, iso, getJSON }) {
  let mapa;
  try { mapa = await getJSON("https://estaciones-fe.ohmc.ar/api/v1/public/mapa?page_size=2000&operativa=true&visible=true"); }
  catch (e) { return { error: "No se pudo leer el mapa del OHMC: " + e.message }; }
  const porId = {}; (mapa.data || []).forEach(s => porId[s.station_id] = s);
  const v = (lm, t) => { const m = lm.find(x => x.tipo_variable_id === t); return m && m.valor != null ? { valor: +m.valor, t: Date.parse(m.valida_en) } : null; };
  const estaciones = EST.map(e => {
    const s = porId[e.id]; if (!s) return { ...e, activa: false };
    const lm = s.latest_measurements || [], [lon, lat] = s.geom.coordinates;
    const p10 = v(lm, 4), pdia = v(lm, 5), rio = v(lm, 26), dique = v(lm, 90);
    const ref = e.tipo === "lluvia" ? p10 : e.tipo === "dique" ? dique : rio;
    const dato = ref ? iso(ref.t) : null, activa = ref ? now - ref.t < 90 * 60e3 : false;
    const o = { id: e.id, nombre: e.nombre, tipo: e.tipo, grupo: e.grupo, lat: +lat.toFixed(4), lon: +lon.toFixed(4), dato, activa };
    if (e.tipo === "lluvia") { o.mm10 = p10 ? +p10.valor.toFixed(1) : null; o.mmDia = pdia ? +pdia.valor.toFixed(1) : null; }
    else if (e.tipo === "dique") { o.cota = dique ? +dique.valor.toFixed(2) : null; o.nivel = dique ? +(dique.valor - VERTEDERO).toFixed(2) : null; }
    else { o.nivel = rio ? +rio.valor.toFixed(2) : null; }
    return o;
  });
  return { generado: iso(now), fuente: "OHMC · estaciones de APRHI y Laboratorio de Hidráulica (UNC)", estaciones };
}
module.exports = { leer };
