/* Alerta temprana de evacuación por zonas ribereñas del Río Ceballos.
   Idea: una crecida tarda en bajar desde la cuenca/el dique hasta cada barrio. Ese tiempo de viaje
   es la ventana para evacuar. Combinamos señales que se adelantan (el dique vertiendo, los sensores
   aguas arriba subiendo, lluvia intensa sobre suelo húmedo, celdas de tormenta sobre la cuenca) con
   el sensor local del barrio para confirmar, y para cada zona damos un nivel de acción y, cuando el
   disparador viene de aguas arriba, una hora estimada de llegada de la crecida (ETA).

   LÍMITES (hay que ser honestos): los sensores OHMC/Orus informan cada ~10 min, así que el aviso
   temprano viene sobre todo de las señales de aguas arriba y de la lluvia, no del sensor local.
   La altura exacta a la que el agua llega a cada calle NO está relevada: los umbrales de etapa son
   PROVISORIOS y hay que calibrarlos con una referencia local. Es apoyo a la decisión; la orden de
   evacuación la da Defensa Civil / COE. Ante la duda en plena tormenta, ir a zona alta por las dudas. */
"use strict";

// Zonas ribereñas. Cada una: sensor local, sensores que la anticipan (aguas arriba), etapas de altura
// sobre lo normal (m, PROVISORIAS) y tasas de ascenso que disparan por sí solas. Se agregan más abajo.
const ZONAS = [
  {
    id: "san-jose",
    nombre: "Barrio San José",
    detalle: "Fray Cayetano Rodríguez y el río, Río Ceballos",
    lat: -31.1820, lon: -64.3144,
    gaugeLocal: 751,          // Río Ceballos · Puente San José (OHMC)
    usarOrus: true,           // si el sensor Orus del mismo puente está activo, se prefiere
    aguasArriba: [98670],     // Puente Amuchástegui anticipa la crecida de San José
    desdeDique: true,         // el vertido del dique también la anticipa
    // Etapas sobre el nivel normal (mediana de 7 días). PROVISORIAS — calibrar con referencia local.
    etapas: { prepararse: 0.40, evacuar: 0.80, peligro: 1.30 },
    // Ascenso que dispara por sí solo aunque no sepamos la altura absoluta.
    tasa: { evacuar30: 0.50, peligro30: 1.00, peligro10: 0.30 },
    viajeDefMin: 40,          // viaje por defecto aguas arriba → zona (min), se refina con eventos reales
  },
];

const NIVELES = ["normal", "vigilancia", "alerta", "evacuar", "peligro"];
const ETIQUETA = { normal: "Normal", vigilancia: "Vigilancia", alerta: "Alerta", evacuar: "Evacuación", peligro: "Evacuación inmediata" };
const ACCION = {
  normal: "Situación normal. Sin acciones.",
  vigilancia: "Podría formarse una crecida en las próximas horas. Preparen la mochila de emergencia, tengan cargado el celular y repasen la ruta de salida hacia zona alta.",
  alerta: "Crecida probable. Alejen los vehículos del río, aseguren lo imprescindible y estén listos para salir. Personas con movilidad reducida, bebés o personas mayores: comiencen a salir ahora.",
  evacuar: "Salgan ahora hacia zona alta por la ruta prevista. No esperen a ver el agua. No crucen el río ni los vados.",
  peligro: "Evacuación inmediata a zona alta. No crucen el río bajo ningún concepto. Si no llegan a salir, suban a la parte más alta y firme y pidan ayuda.",
};

const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

// Tiempo de viaje medido entre dos sensores, a partir del desfase entre sus picos en crecidas reales.
function viajeMedido(hist, fromId, toId) {
  const lags = [];
  ((hist && hist.eventos) || []).forEach(ev => {
    const a = (ev.picos || []).find(p => p.id === fromId), b = (ev.picos || []).find(p => p.id === toId);
    if (a && b && a.hora && b.hora) { const d = (Date.parse(b.hora) - Date.parse(a.hora)) / 6e4; if (d > 3 && d < 180) lags.push(d); }
  });
  return lags.length ? { min: Math.round(med(lags)), n: lags.length } : null;
}

// ¿El dique viene subiendo? (últimas lecturas de la serie respecto del vertedero)
function diqueSubiendo(dique) {
  if (!dique || !Array.isArray(dique.serie) || dique.serie.length < 2) return null;
  const s = dique.serie.filter(x => x[1] != null);
  if (s.length < 2) return null;
  const ult = s[s.length - 1][1], ant = s[Math.max(0, s.length - 4)][1];
  return +(ult - ant).toFixed(2); // m en las últimas ~3 lecturas
}

// Ascenso del sensor local en los últimos ~10 min, si la serie tiene paso fino
function subida10(rio, now) {
  if (!rio || !Array.isArray(rio.serie)) return null;
  const s = rio.serie.filter(x => x[1] != null).map(x => [Date.parse(x[0]), x[1]]);
  if (s.length < 2) return null;
  const ult = s[s.length - 1];
  const prev = [...s].reverse().find(p => p[0] <= ult[0] - 8 * 6e4 && p[0] >= ult[0] - 20 * 6e4);
  return prev ? +(ult[1] - prev[1]).toFixed(2) : null;
}

/* entrada:
   { now, iso, rios:[{id,nivel,subida30,activa,serie,dato}], dique, cuenca, pronostico, tormentas,
     hist, normales:{<id>:normal}, orus:{nivel,subida30,normal,activa,dato,serie}, model, absorbible } */
function evaluar(e) {
  const { now, iso, rios = [], dique, cuenca = {}, pronostico, tormentas, hist, normales = {}, orus, model } = e;
  const porId = {}; rios.forEach(r => { porId[r.id] = r; });
  const damD = dique && dique.respectoVertedero != null ? dique.respectoVertedero : null;
  const damSube = diqueSubiendo(dique);
  const damVierte = damD != null && damD > 0;
  const damQ = damVierte ? Math.round(126 * Math.pow(damD, 1.5)) : 0; // m³/s sobre el vertedero
  const absorbible = e.absorbible != null ? e.absorbible : null;
  const cellsCuenca = ((tormentas && tormentas.celdas) || []).filter(c => c.dist <= 25);
  const lluviaFuerte = (cuenca.h1 >= 20) || (cuenca.intensidad >= 30);
  const lluviaModerada = (cuenca.h1 >= 5) || (cuenca.intensidad >= 10) || cellsCuenca.length > 0 ||
    (absorbible != null && pronostico && (pronostico.h6 >= 0.5 * absorbible || pronostico.h24 >= absorbible));
  const f2 = x => x == null ? "–" : x.toFixed(2).replace(".", ",");
  const f0 = x => x == null ? "–" : Math.round(x).toString();

  const zonas = ZONAS.map(z => {
    // Sensor local: Orus del puente si está activo, si no el de OHMC
    const usoOrus = z.usarOrus && orus && orus.activa && orus.nivel != null;
    const local = usoOrus ? { id: "orus", nivel: orus.nivel, subida30: orus.subida30, serie: orus.serie, dato: orus.dato, nombre: "Puente San José (cámara Orus)" }
      : porId[z.gaugeLocal];
    const normalLocal = usoOrus ? (orus.normal != null ? orus.normal : null) : (normales[z.gaugeLocal] != null ? normales[z.gaugeLocal] : null);
    const sobre = local && local.nivel != null && normalLocal != null ? +(local.nivel - normalLocal).toFixed(2) : null;
    const s30 = local ? local.subida30 : null;
    const s10 = local ? subida10(local, now) : null;

    // Disparadores de aguas arriba (anticipan la crecida)
    const arriba = (z.aguasArriba || []).map(id => porId[id]).filter(r => r && r.activa);
    const arribaSube = arriba.map(r => ({ nombre: r.nombre, s30: r.subida30 })).filter(r => r.s30 != null && r.s30 >= 0.30);
    const arribaFuerte = arribaSube.some(r => r.s30 >= 0.60);
    const arribaMod = arribaSube.length > 0;
    const diqueAnticipa = z.desdeDique && damVierte;
    const diqueFuerte = diqueAnticipa && damD >= 0.30 && (damSube == null || damSube >= 0.02);
    const diqueMod = diqueAnticipa && (damSube == null || damSube >= 0.01);

    const motivos = [];
    const add = (n, texto) => motivos.push({ n, texto });

    // --- Nivel 4: peligro / evacuación inmediata (confirmado en el sensor local) ---
    if (sobre != null && sobre >= z.etapas.peligro) add(4, `El río en ${z.nombre} está ${f0(sobre * 100)} cm sobre lo normal (umbral de peligro ${f0(z.etapas.peligro * 100)} cm)`);
    if (s10 != null && s10 >= z.tasa.peligro10) add(4, `El río subió ${f2(s10)} m en ~10 min en ${z.nombre}: ascenso muy rápido`);
    if (s30 != null && s30 >= z.tasa.peligro30) add(4, `El río subió ${f2(s30)} m en 30 min en ${z.nombre}`);

    // --- Nivel 3: evacuar ---
    if (sobre != null && sobre >= z.etapas.evacuar) add(3, `El río en ${z.nombre} está ${f0(sobre * 100)} cm sobre lo normal (umbral de evacuación ${f0(z.etapas.evacuar * 100)} cm)`);
    if (s30 != null && s30 >= z.tasa.evacuar30) add(3, `El río subió ${f2(s30)} m en 30 min en ${z.nombre}`);
    if (diqueFuerte) add(3, `El dique vierte fuerte (${f0(damD * 100)} cm de carga, ${f0(damQ)} m³/s) y sigue subiendo: viene una crecida`);
    if (arribaFuerte) arribaSube.filter(r => r.s30 >= 0.60).forEach(r => add(3, `${r.nombre} subió ${f2(r.s30)} m en 30 min aguas arriba: la crecida viene en camino`));

    // --- Nivel 2: alerta ---
    if (sobre != null && sobre >= z.etapas.prepararse) add(2, `El río en ${z.nombre} está ${f0(sobre * 100)} cm sobre lo normal`);
    if (diqueMod && !diqueFuerte) add(2, `El dique está vertiendo (${f0(damQ)} m³/s al río)`);
    if (arribaMod && !arribaFuerte) arribaSube.forEach(r => add(2, `${r.nombre} subió ${f2(r.s30)} m en 30 min aguas arriba`));
    if (lluviaFuerte) add(2, `Lluvia intensa en la cuenca ahora (${f0(cuenca.h1)} mm/h, intensidad ${f0(cuenca.intensidad)} mm/h)`);

    // --- Nivel 1: vigilancia ---
    if (lluviaModerada && !lluviaFuerte) add(1, "Llueve en la cuenca y las condiciones podrían formar una crecida");
    if (absorbible != null && pronostico && pronostico.h24 >= absorbible) add(1, `El pronóstico (${f0(pronostico.h24)} mm en 24 h) supera lo que el dique puede absorber (${f0(absorbible)} mm)`);
    if (damVierte && !diqueMod) add(1, "El dique está en el vertedero o cerca");
    if (cellsCuenca.length) add(1, `Celdas de tormenta sobre la cuenca (${cellsCuenca.length}, la más cercana a ${f0(cellsCuenca[0].dist)} km)`);

    const n = motivos.reduce((a, x) => Math.max(a, x.n), 0);
    motivos.sort((a, b) => b.n - a.n);
    const nivel = NIVELES[n];

    // ETA: solo cuando el disparo viene de aguas arriba y el sensor local todavía no confirma el pico
    let eta = null;
    const confirmadoLocal = (sobre != null && sobre >= z.etapas.evacuar) || (s30 != null && s30 >= z.tasa.evacuar30) || (s10 != null && s10 >= z.tasa.peligro10);
    if (n >= 2 && !confirmadoLocal && (diqueAnticipa || arribaSube.length)) {
      // viaje: el más representativo de las fuentes activas
      let viaje = z.viajeDefMin, fuenteViaje = "estimado", medido = false;
      if (arribaSube.length) { const vm = viajeMedido(hist, z.aguasArriba[0], z.gaugeLocal); if (vm) { viaje = vm.min; fuenteViaje = `medido en ${vm.n} crecida(s)`; medido = true; } }
      eta = { minutos: viaje, hora: iso(now + viaje * 6e4), medido, fuente: fuenteViaje,
        texto: `La crecida podría llegar a ${z.nombre} alrededor de las ${new Date(now + viaje * 6e4).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} (en ~${viaje} min)` };
    } else if (n >= 3 && confirmadoLocal) {
      eta = { minutos: 0, hora: iso(now), medido: false, fuente: "en curso", texto: "La crecida ya está llegando a la zona." };
    }

    return {
      id: z.id, nombre: z.nombre, detalle: z.detalle, lat: z.lat, lon: z.lon,
      nivel, orden: n, etiqueta: ETIQUETA[nivel], accion: ACCION[nivel],
      motivos: motivos.map(x => ({ nivel: NIVELES[x.n], texto: x.texto })),
      local: local ? { fuente: local.nombre || ("sensor " + local.id), nivel: local.nivel, sobreNormal: sobre, subida30: s30, subida10: s10, dato: local.dato || null } : null,
      etapas: z.etapas, eta, calibrar: true,
    };
  });

  const ordenMax = zonas.reduce((a, z) => Math.max(a, z.orden), 0);
  return {
    generado: iso(now), ordenMax, nivelMax: NIVELES[ordenMax],
    zonas, NIVELES, ETIQUETA,
    nota: "Umbrales de etapa provisorios: calibrar con una referencia local (p. ej. a qué altura del sensor el agua llegó a la calle en una crecida conocida). Apoyo a la decisión; la orden de evacuación la da Defensa Civil / COE.",
  };
}

module.exports = { evaluar, ZONAS, NIVELES, ETIQUETA };
