/* Motor de alertas del Dique La Quebrada. Lo usan el robot (Node, GitHub Actions) y la página.
   Umbrales provisorios: calibrar con APRHI y Defensa Civil de Río Ceballos. */
(function (root) {
  "use strict";
  const A = 36.88, VSP = 3.3e6, HSP = 34, NEXP = 3.09;
  const vol = d => VSP * Math.pow(Math.max(0, HSP + d) / HSP, NEXP);
  const cnAmc = (cn, amc) => amc === 1 ? cn / (2.281 - 0.01281 * cn) : amc === 3 ? Math.min(98, cn / (0.427 + 0.00573 * cn)) : cn;
  // Modelo calibrado con 37 tormentas medidas (APRHI/OHMC, 2023–2026): CN según la lluvia antecedente (API)
  // y un escurrimiento mínimo del 3,5 % de la lluvia. Ver tools/calibrar.js.
  const CAL = { a: 34, b: 0.32, piso: 0.035, min: 30, max: 95 };
  const cnCal = api => Math.max(CAL.min, Math.min(CAL.max, CAL.a + CAL.b * (api || 0)));
  const scs = (P, cn) => { const S = 25400 / cn - 254, Ia = 0.2 * S; return P > Ia ? (P - Ia) ** 2 / (P - Ia + S) : 0; };
  const runoffMM = (P, cn) => Math.max(scs(P, cn), CAL.piso * P);
  const absorbP = (room, cn) => { if (room <= 0) return 0; const Q = room / (A * 1e3); let lo = 0, hi = 2000; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (runoffMM(m, cn) > Q) hi = m; else lo = m; } return lo; };

  const UMBRALES = {
    emergencia: { vertidoM: 0.5, lluvia1h: 40, lluvia3h: 60, subidaRio: 1.0 },
    alerta: { lluvia1h: 20, lluvia3h: 30, fraccion3h: 0.6, subidaRio: 0.5, intensidad: 30 },
    atencion: { lluvia1h: 5, fraccionPron48: 0.5, intensidad: 10 },
    humedo: 100, // lluvia antecedente (mm) desde la que la cuenca escurre mucho (CN ≥ 66)
    tormenta: { emergencia: { dbz: 60, km: 10 }, alerta: [{ dbz: 55, km: 20 }, { dbz: 60, km: 40 }], atencion: { dbz: 50, km: 40 } },
  };
  const NIVELES = ["normal", "atencion", "alerta", "emergencia"];
  // De las celdas con pronóstico de trayectoria, la más relevante que llega a la cuenca o a las zonas inundables
  function mejorTormenta(nowcast) {
    const cand = [];
    (nowcast || []).forEach(c => (c.impactos || []).forEach(i => { if ((i.id === "cuenca" || i.id === "zonas") && c.maxDbz >= 50 && i.prob >= 0.4 && i.eta <= 60) cand.push({ c, i }); }));
    cand.sort((a, b) => (b.c.maxDbz >= 55) - (a.c.maxDbz >= 55) || a.i.eta - b.i.eta || b.i.prob - a.i.prob);
    return cand[0] || null;
  }
  const ETIQUETA = { normal: "Normal", atencion: "Atención", alerta: "Alerta", emergencia: "Emergencia" };

  /* entrada: { nivelDique (m respecto del vertedero o null), lluvia: {h1,h3,h24,d5} (promedio de la cuenca, mm),
     intensidad (mm/h, máximo de los últimos 10 min ×6), rios: [{nombre, subida30, subida24}], pronostico: {h6,h24,h48} } */
  function evaluar(e) {
    const m = [];
    const subir = (n, txt) => m.push({ n, txt });
    const d = e.nivelDique;
    const api = e.lluvia.api != null ? e.lluvia.api : e.lluvia.d5 || 0;
    const amc = api >= UMBRALES.humedo ? 3 : api >= 40 ? 2 : 1;
    const cn = cnCal(api);
    const room = d == null ? null : Math.max(0, vol(0) - vol(Math.min(d, 0)));
    const absorbible = room == null ? null : absorbP(room, cn);
    const f = (x, k = 0) => x == null ? "–" : x.toFixed(k).replace(".", ",");

    // Emergencia
    if (d != null && d > UMBRALES.emergencia.vertidoM) subir(3, "El dique vierte con más de " + f(UMBRALES.emergencia.vertidoM, 1) + " m de carga (" + f(126 * d ** 1.5) + " m³/s al río)");
    if (e.lluvia.h1 >= UMBRALES.emergencia.lluvia1h) subir(3, f(e.lluvia.h1) + " mm en la última hora en la cuenca");
    if (e.lluvia.h3 >= UMBRALES.emergencia.lluvia3h) subir(3, f(e.lluvia.h3) + " mm en las últimas 3 horas en la cuenca");
    (e.rios || []).forEach(r => { if (r.subida30 != null && r.subida30 >= UMBRALES.emergencia.subidaRio) subir(3, r.nombre + ": el río subió " + f(r.subida30, 2) + " m en 30 min"); });
    // Altura del río sobre lo normal (mediana de 7 días)
    (e.rios || []).forEach(r => {
      if (r.sobreNormal == null) return;
      const t = r.nombre + ": " + Math.round(r.sobreNormal * 100) + " cm sobre lo normal";
      if (r.sobreNormal >= 1) subir(3, t); else if (r.sobreNormal >= .5) subir(2, t); else if (r.sobreNormal >= .25) subir(1, t);
    });
    // Celdas de tormenta del radar (distancia al dique)
    const T = UMBRALES.tormenta, cel = (e.celdas || []).slice().sort((a, b) => a.dist - b.dist);
    const desc = c => (c.maxDbz >= 60 ? "granizo probable" : c.maxDbz >= 55 ? "granizo posible" : "tormenta fuerte") + " a " + f(c.dist) + " km al " + c.dir + " del dique (" + f(c.maxDbz) + " dBZ" + (c.topKm ? ", tope " + f(c.topKm, 1) + " km" : "") + ")";
    const em = cel.find(c => c.maxDbz >= T.emergencia.dbz && c.dist <= T.emergencia.km);
    const al = !em && cel.find(c => T.alerta.some(u => c.maxDbz >= u.dbz && c.dist <= u.km));
    const at = !em && !al && cel.find(c => c.maxDbz >= T.atencion.dbz && c.dist <= T.atencion.km);
    if (em) subir(3, "Radar: " + desc(em));
    else if (al) subir(2, "Radar: " + desc(al));
    else if (at) subir(1, "Radar: " + desc(at));
    // Pronóstico de trayectoria (nowcast): la celda más inminente que llegaría a la cuenca o a Río Ceballos
    const tc = mejorTormenta(e.nowcast);
    if (tc) {
      const txt = "Radar: tormenta de " + f(tc.c.maxDbz) + " dBZ " + (tc.i.yaEncima ? "ya sobre " + tc.i.corto : "llegaría a " + tc.i.corto + " en ~" + tc.i.eta + " min") +
        " (probabilidad " + Math.round(tc.i.prob * 100) + " %, se mueve hacia el " + tc.c.hacia + " a " + tc.c.kmh + " km/h)";
      if (tc.c.maxDbz >= 55 && tc.i.prob >= 0.5 && tc.i.eta <= 30) subir(2, txt); else if (tc.c.maxDbz >= 50 && tc.i.prob >= 0.4 && tc.i.eta <= 60) subir(1, txt);
    }
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
    if (amc === 3) subir(1, "Suelo muy húmedo: " + f(api) + " mm de lluvia antecedente, la cuenca está escurriendo mucho más de lo habitual");

    const n = m.reduce((a, x) => Math.max(a, x.n), 0);
    m.sort((a, b) => b.n - a.n);
    return {
      nivel: NIVELES[n], etiqueta: ETIQUETA[NIVELES[n]], orden: n,
      motivos: m.map(x => ({ nivel: NIVELES[x.n], texto: x.txt })),
      amc, api: Math.round(api), cn: Math.round(cn), colchonHm3: room == null ? null : +(room / 1e6).toFixed(3), lluviaAbsorbible: absorbible == null ? null : Math.round(absorbible),
      escurrimientoPronostico48Hm3: e.pronostico ? +(runoffMM(e.pronostico.h48, cn) * A / 1e3).toFixed(3) : null,
    };
  }

  const api = { evaluar, mejorTormenta, UMBRALES, NIVELES, ETIQUETA, vol, absorbP, cnAmc, cnCal, runoffMM, CAL };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LQ_MOTOR = api;
})(typeof window !== "undefined" ? window : this);
