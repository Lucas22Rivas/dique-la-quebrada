/* Motor de alertas del Dique La Quebrada. Lo usan el robot (Node, GitHub Actions) y la página.
   Umbrales provisorios: calibrar con APRHI y Defensa Civil de Río Ceballos. */
(function (root) {
  "use strict";
  const A = 36.88, VSP = 3.3e6, HSP = 34, NEXP = 3.09;
  const vol = d => VSP * Math.pow(Math.max(0, HSP + d) / HSP, NEXP);
  const cnAmc = (cn, amc) => amc === 1 ? cn / (2.281 - 0.01281 * cn) : amc === 3 ? Math.min(98, cn / (0.427 + 0.00573 * cn)) : cn;
  const absorbP = (room, cn) => { if (room <= 0) return 0; const S = 25400 / cn - 254, Ia = 0.2 * S, Q = room / (A * 1e3); return (Q + Math.sqrt(Q * Q + 4 * Q * S)) / 2 + Ia; };
  const runoffMM = (P, cn) => { const S = 25400 / cn - 254, Ia = 0.2 * S; return P > Ia ? (P - Ia) ** 2 / (P - Ia + S) : 0; };

  const UMBRALES = {
    emergencia: { vertidoM: 0.5, lluvia1h: 40, lluvia3h: 60, subidaRio: 1.0 },
    alerta: { lluvia1h: 20, lluvia3h: 30, fraccion3h: 0.6, subidaRio: 0.5, intensidad: 30 },
    atencion: { lluvia1h: 5, fraccionPron48: 0.5, intensidad: 10 },
    amc: { seco: 36, saturado: 53 },
    tormenta: { emergencia: { dbz: 60, km: 10 }, alerta: [{ dbz: 55, km: 20 }, { dbz: 60, km: 40 }], atencion: { dbz: 50, km: 40 } },
  };
  const NIVELES = ["normal", "atencion", "alerta", "emergencia"];
  const ETIQUETA = { normal: "Normal", atencion: "Atención", alerta: "Alerta", emergencia: "Emergencia" };

  /* entrada: { nivelDique (m respecto del vertedero o null), lluvia: {h1,h3,h24,d5} (promedio de la cuenca, mm),
     intensidad (mm/h, máximo de los últimos 10 min ×6), rios: [{nombre, subida30, subida24}], pronostico: {h6,h24,h48} } */
  function evaluar(e) {
    const m = [];
    const subir = (n, txt) => m.push({ n, txt });
    const d = e.nivelDique;
    const amc = e.lluvia.d5 >= UMBRALES.amc.saturado ? 3 : e.lluvia.d5 >= UMBRALES.amc.seco ? 2 : 1;
    const cn = cnAmc(80, amc);
    const room = d == null ? null : Math.max(0, vol(0) - vol(Math.min(d, 0)));
    const absorbible = room == null ? null : absorbP(room, cn);
    const f = (x, k = 0) => x == null ? "–" : x.toFixed(k).replace(".", ",");

    // Emergencia
    if (d != null && d > UMBRALES.emergencia.vertidoM) subir(3, "El dique vierte con más de " + f(UMBRALES.emergencia.vertidoM, 1) + " m de carga (" + f(126 * d ** 1.5) + " m³/s al río)");
    if (e.lluvia.h1 >= UMBRALES.emergencia.lluvia1h) subir(3, f(e.lluvia.h1) + " mm en la última hora en la cuenca");
    if (e.lluvia.h3 >= UMBRALES.emergencia.lluvia3h) subir(3, f(e.lluvia.h3) + " mm en las últimas 3 horas en la cuenca");
    (e.rios || []).forEach(r => { if (r.subida30 != null && r.subida30 >= UMBRALES.emergencia.subidaRio) subir(3, r.nombre + ": el río subió " + f(r.subida30, 2) + " m en 30 min"); });
    // Celdas de tormenta del radar (distancia al dique)
    const T = UMBRALES.tormenta, cel = (e.celdas || []).slice().sort((a, b) => a.dist - b.dist);
    const desc = c => (c.maxDbz >= 60 ? "granizo probable" : c.maxDbz >= 55 ? "granizo posible" : "tormenta fuerte") + " a " + f(c.dist) + " km al " + c.dir + " del dique (" + f(c.maxDbz) + " dBZ" + (c.topKm ? ", tope " + f(c.topKm, 1) + " km" : "") + ")";
    const em = cel.find(c => c.maxDbz >= T.emergencia.dbz && c.dist <= T.emergencia.km);
    const al = !em && cel.find(c => T.alerta.some(u => c.maxDbz >= u.dbz && c.dist <= u.km));
    const at = !em && !al && cel.find(c => c.maxDbz >= T.atencion.dbz && c.dist <= T.atencion.km);
    if (em) subir(3, "Radar: " + desc(em));
    else if (al) subir(2, "Radar: " + desc(al));
    else if (at) subir(1, "Radar: " + desc(at));
    // Alerta
    if (d != null && d > 0 && d <= UMBRALES.emergencia.vertidoM) subir(2, "El dique está vertiendo (" + f(126 * d ** 1.5) + " m³/s al río)");
    if (e.lluvia.h1 >= UMBRALES.alerta.lluvia1h && e.lluvia.h1 < UMBRALES.emergencia.lluvia1h) subir(2, f(e.lluvia.h1) + " mm en la última hora en la cuenca");
    if (e.intensidad >= UMBRALES.alerta.intensidad) subir(2, "Lluvia intensa ahora: " + f(e.intensidad) + " mm/h");
    const lim3 = absorbible != null ? Math.max(UMBRALES.alerta.lluvia3h, UMBRALES.alerta.fraccion3h * absorbible) : UMBRALES.alerta.lluvia3h;
    if (e.lluvia.h3 >= lim3 && e.lluvia.h3 < UMBRALES.emergencia.lluvia3h) subir(2, f(e.lluvia.h3) + " mm en 3 horas: se está llenando el colchón del dique");
    if (absorbible != null && e.pronostico && e.pronostico.h24 >= absorbible) subir(2, "El pronóstico de 24 h (" + f(e.pronostico.h24) + " mm) supera lo que el dique puede absorber (" + f(absorbible) + " mm)");
    (e.rios || []).forEach(r => { if (r.subida30 != null && r.subida30 >= UMBRALES.alerta.subidaRio && r.subida30 < UMBRALES.emergencia.subidaRio) subir(2, r.nombre + ": el río subió " + f(r.subida30, 2) + " m en 30 min"); });
    // Atención
    if (e.lluvia.h1 >= UMBRALES.atencion.lluvia1h && e.lluvia.h1 < UMBRALES.alerta.lluvia1h) subir(1, "Llueve en la cuenca: " + f(e.lluvia.h1, 1) + " mm en la última hora");
    if (e.intensidad >= UMBRALES.atencion.intensidad && e.intensidad < UMBRALES.alerta.intensidad) subir(1, "Lluvia moderada ahora: " + f(e.intensidad) + " mm/h");
    if (absorbible != null && e.pronostico && e.pronostico.h48 >= UMBRALES.atencion.fraccionPron48 * absorbible && !(e.pronostico.h24 >= absorbible)) subir(1, "Pronóstico de 48 h: " + f(e.pronostico.h48) + " mm, más de la mitad de lo que absorbe el dique (" + f(absorbible) + " mm)");
    if (amc === 3) subir(1, "Suelo saturado: " + f(e.lluvia.d5) + " mm en 5 días, la próxima lluvia escurre casi entera");

    const n = m.reduce((a, x) => Math.max(a, x.n), 0);
    m.sort((a, b) => b.n - a.n);
    return {
      nivel: NIVELES[n], etiqueta: ETIQUETA[NIVELES[n]], orden: n,
      motivos: m.map(x => ({ nivel: NIVELES[x.n], texto: x.txt })),
      amc, cn: Math.round(cn), colchonHm3: room == null ? null : +(room / 1e6).toFixed(3), lluviaAbsorbible: absorbible == null ? null : Math.round(absorbible),
      escurrimientoPronostico48Hm3: e.pronostico ? +(runoffMM(e.pronostico.h48, cn) * A / 1e3).toFixed(3) : null,
    };
  }

  const api = { evaluar, UMBRALES, NIVELES, ETIQUETA, vol, absorbP, cnAmc };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LQ_MOTOR = api;
})(typeof window !== "undefined" ? window : this);
