/* Pronóstico inmediato de tormentas (nowcasting) a partir de los núcleos convectivos del radar RMA1 (OHMC).
   1) Sigue cada celda entre barridos consecutivos (~9 min): estima primero el movimiento general de la
      tormenta y empareja cada celda con su posición esperada.
   2) Calcula la velocidad y el rumbo de cada celda con sus últimas posiciones (mínimos cuadrados).
   3) Proyecta la trayectoria con un abanico de 15 variantes (rumbo ±15°, velocidad ±25 %): la fracción de
      variantes que tocan cada zona es la probabilidad, y sus tiempos dan el rango de llegada.
   LÍMITES: es extrapolación. Las celdas nacen, crecen, se dividen y se disipan; más allá de ~60 min la
   confianza cae mucho. La lluvia estimada (Marshall-Palmer, Z = 200 R^1,6) es solo un orden de magnitud.
   Lo usan el robot (Node) y la página del radar (navegador). */
(function (root) {
  "use strict";
  const LAT0 = -31.2, LON0 = -64.3, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
  const xy = (lat, lon) => [(lon - LON0) * KX / 1000, (lat - LAT0) * KY / 1000];       // km, x este, y norte
  const latlon = (x, y) => [+(LAT0 + y * 1000 / KY).toFixed(4), +(LON0 + x * 1000 / KX).toFixed(4)];
  const RUMBOS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const rumbo = deg => RUMBOS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  const med = a => { const v = a.slice().sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : 0; };

  // Zonas objetivo: polígonos [lat, lon]
  const OBJETIVOS = [
    { id: "cuenca", nombre: "Cuenca del Dique La Quebrada", corto: "la cuenca del dique",
      nota: "La lluvia que cae acá llena el embalse",
      poly: [[-31.115, -64.345], [-31.108, -64.39], [-31.122, -64.432], [-31.15, -64.437], [-31.176, -64.412], [-31.177, -64.37], [-31.16, -64.344]] },
    { id: "zonas", nombre: "Río Ceballos · zonas inundables", corto: "las zonas inundables de Río Ceballos",
      nota: "Barrios ribereños, incluido Barrio San José",
      poly: [[-31.1499, -64.3413], [-31.1871, -64.3265], [-31.2065, -64.3174], [-31.2153, -64.3025], [-31.2156, -64.2993], [-31.2037, -64.2958], [-31.1609, -64.3013], [-31.1422, -64.325], [-31.1423, -64.3274], [-31.1468, -64.3368]] },
  ];

  function polyXY(poly) { return poly.map(p => xy(p[0], p[1])); }
  function areaKm2(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  function dentro(p, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function distPoly(p, P) { if (dentro(p, P)) return 0; let d = Infinity; for (let i = 0; i < P.length; i++) d = Math.min(d, distSeg(p, P[i], P[(i + 1) % P.length])); return d; }
  const lluviaMMh = dbz => Math.pow(Math.pow(10, Math.min(dbz, 53) / 10) / 200, 1 / 1.6); // tope 53 dBZ por granizo

  /* Normaliza una celda: { lat, lon, maxDbz, intDbz, topKm, ring:[[lat,lon]] } → con x, y, radio (km) */
  function prepCelda(c) {
    const [x, y] = xy(c.lat, c.lon);
    let r = 3;
    if (c.ring && c.ring.length > 2) r = Math.sqrt(areaKm2(c.ring.map(p => xy(p[0], p[1]))) / Math.PI);
    return { ...c, x, y, radio: Math.max(1.5, Math.min(25, r)) };
  }

  /* scans: [{ t (ms), cells:[...] }] en cualquier orden. opts: { ahora, horizonteMin, objetivos, minDbz, maxKm } */
  function analizar(scans, opts = {}) {
    const horiz = opts.horizonteMin || 120, objetivos = (opts.objetivos || OBJETIVOS).map(o => ({ ...o, P: polyXY(o.poly) }));
    const minDbz = opts.minDbz != null ? opts.minDbz : 40, ref = xy(-31.1495, -64.3421), maxKm = opts.maxKm || 160;
    const S = scans.filter(s => s && s.cells).slice().sort((a, b) => a.t - b.t).slice(-6)
      .map(s => ({ t: s.t, cells: s.cells.filter(c => c.maxDbz >= minDbz).map(prepCelda).filter(c => Math.hypot(c.x - ref[0], c.y - ref[1]) <= maxKm + 40) }));
    if (!S.length) return { generado: opts.ahora || Date.now(), movimiento: null, celdas: [], objetivos: (opts.objetivos || OBJETIVOS).map(o => ({ id: o.id, nombre: o.nombre })) };

    // 1) Seguimiento entre barridos
    let nid = 1, tracks = [];
    S[0].cells.forEach(c => { c.tid = nid++; tracks.push({ id: c.tid, pts: [[c.x, c.y, S[0].t]] }); });
    const globales = [];
    for (let k = 1; k < S.length; k++) {
      const A = S[k - 1], B = S[k], dt = (B.t - A.t) / 36e5; if (dt <= 0 || dt > 0.5) { B.cells.forEach(c => { c.tid = nid++; tracks.push({ id: c.tid, pts: [[c.x, c.y, B.t]] }); }); continue; }
      // movimiento general: desplazamiento mediano de los vecinos más cercanos (≤ 25 km)
      const dx = [], dy = [];
      B.cells.forEach(b => { let best = null, bd = 25; A.cells.forEach(a => { const d = Math.hypot(b.x - a.x, b.y - a.y); if (d < bd) { bd = d; best = a; } }); if (best) { dx.push((b.x - best.x) / dt); dy.push((b.y - best.y) / dt); } });
      const vg = dx.length >= 3 ? [med(dx), med(dy)] : [0, 0];
      if (dx.length >= 3) globales.push(vg);
      // emparejar con la posición esperada
      const pares = [];
      A.cells.forEach(a => { const px = a.x + vg[0] * dt, py = a.y + vg[1] * dt; B.cells.forEach(b => { const d = Math.hypot(b.x - px, b.y - py), gate = 10 + 0.4 * Math.max(a.radio, b.radio); if (d <= gate) pares.push([d + Math.abs(a.radio - b.radio) * 0.3, a, b]); }); });
      pares.sort((p, q) => p[0] - q[0]);
      const usadosA = new Set(), usadosB = new Set();
      pares.forEach(([, a, b]) => { if (usadosA.has(a) || usadosB.has(b)) return; usadosA.add(a); usadosB.add(b); b.tid = a.tid; const tr = tracks.find(t => t.id === a.tid); if (tr) tr.pts.push([b.x, b.y, B.t]); });
      B.cells.forEach(c => { if (!c.tid) { c.tid = nid++; tracks.push({ id: c.tid, pts: [[c.x, c.y, B.t]] }); } });
    }
    const vGen = globales.length ? [med(globales.map(v => v[0])), med(globales.map(v => v[1]))] : null;
    const movimiento = vGen ? { kmh: +Math.hypot(vGen[0], vGen[1]).toFixed(0), haciaDeg: Math.round((Math.atan2(vGen[0], vGen[1]) * 180 / Math.PI + 360) % 360) } : null;
    if (movimiento) movimiento.hacia = rumbo(movimiento.haciaDeg);

    // 2) Velocidad por celda (último barrido)
    const ult = S[S.length - 1], ahora = opts.ahora || Date.now(), edadMin = (ahora - ult.t) / 6e4;
    const celdas = ult.cells.map(c => {
      const tr = tracks.find(t => t.id === c.tid), pts = tr ? tr.pts.slice(-5) : [[c.x, c.y, ult.t]];
      let v = vGen ? vGen.slice() : [0, 0], fuente = vGen ? "general" : "sin movimiento medido";
      if (pts.length >= 2 && (pts[pts.length - 1][2] - pts[0][2]) >= 8 * 6e4) {
        const tm = pts.map(p => (p[2] - pts[0][2]) / 36e5), mt = tm.reduce((s, x) => s + x, 0) / tm.length;
        const sl = j => { const m = pts.reduce((s, p) => s + p[j], 0) / pts.length; let n = 0, d = 0; pts.forEach((p, i) => { n += (tm[i] - mt) * (p[j] - m); d += (tm[i] - mt) ** 2; }); return d ? n / d : 0; };
        const vt = [sl(0), sl(1)], w = pts.length >= 3 ? 0.75 : 0.5;
        const desvio = vGen ? Math.hypot(vt[0] - vGen[0], vt[1] - vGen[1]) : 0;
        if (Math.hypot(vt[0], vt[1]) <= 120 && desvio <= 60) { v = vGen ? [w * vt[0] + (1 - w) * vGen[0], w * vt[1] + (1 - w) * vGen[1]] : vt; fuente = "seguida en " + pts.length + " barridos"; }
      }
      const kmh = Math.hypot(v[0], v[1]), hdg = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
      // posición actual: la del radar corrida por la edad del barrido
      const x0 = c.x + v[0] * edadMin / 60, y0 = c.y + v[1] * edadMin / 60;

      // 3) Abanico de trayectorias e impactos
      const miembros = [];
      [-15, -7.5, 0, 7.5, 15].forEach(da => [0.75, 1, 1.25].forEach(f => { const a = (hdg + da) * Math.PI / 180, s = kmh * f; miembros.push({ central: da === 0 && f === 1, vx: Math.sin(a) * s, vy: Math.cos(a) * s }); }));
      const impactos = objetivos.map(o => {
        const res = miembros.map(m => {
          let ini = null, fin = null;
          for (let t = 0; t <= horiz; t += 2) { const px = x0 + m.vx * t / 60, py = y0 + m.vy * t / 60, hit = distPoly([px, py], o.P) <= c.radio * 0.8; if (hit && ini == null) ini = t; if (hit) fin = t; else if (ini != null) break; if (kmh < 4 && t > 0) break; }
          return { ...m, ini, fin };
        });
        const hits = res.filter(r => r.ini != null), cen = res.find(r => r.central);
        if (!hits.length) return { id: o.id, nombre: o.nombre, prob: 0 };
        const etas = hits.map(r => r.ini), eta = cen && cen.ini != null ? cen.ini : med(etas);
        const dur = cen && cen.ini != null ? cen.fin - cen.ini + 2 : med(hits.map(r => r.fin - r.ini + 2));
        const mm = c.intDbz != null ? lluviaMMh(c.intDbz) * dur / 60 : null;
        return { id: o.id, nombre: o.nombre, corto: o.corto, prob: +(hits.length / res.length).toFixed(2), eta: Math.round(eta), etaMin: Math.min(...etas), etaMax: Math.max(...etas), durMin: Math.round(dur), mmEst: mm == null ? null : Math.round(mm), yaEncima: eta === 0 };
      });
      const proy = [0, 15, 30, 45, 60, 90].filter(t => t <= horiz).map(t => [...latlon(x0 + v[0] * t / 60, y0 + v[1] * t / 60), t]);
      const borde = s => [0, 15, 30, 45, 60].map(t => { const a = (hdg + s) * Math.PI / 180; return latlon(x0 + Math.sin(a) * kmh * t / 60, y0 + Math.cos(a) * kmh * t / 60); });
      const [la0, lo0] = latlon(x0, y0);
      return {
        id: c.tid, lat: la0, lon: lo0, latRadar: c.lat, lonRadar: c.lon, maxDbz: c.maxDbz, intDbz: c.intDbz, topKm: c.topKm, radioKm: +c.radio.toFixed(1),
        kmh: Math.round(kmh), haciaDeg: Math.round(hdg), hacia: rumbo(hdg), fuenteVel: fuente, barridos: pts.length,
        distDiqueKm: +Math.hypot(x0 - ref[0], y0 - ref[1]).toFixed(1),
        track: pts.map(p => latlon(p[0], p[1])), proy, cono: { izq: borde(-15), der: borde(15) },
        impactos: impactos.filter(i => i.prob > 0),
      };
    }).filter(c => c.distDiqueKm <= maxKm);
    celdas.sort((a, b) => { const ea = Math.min(...a.impactos.map(i => i.eta), 999), eb = Math.min(...b.impactos.map(i => i.eta), 999); return ea - eb || a.distDiqueKm - b.distDiqueKm; });
    return { generado: ahora, radar: ult.t, edadMin: Math.round(edadMin), barridos: S.length, movimiento, celdas, objetivos: objetivos.map(o => ({ id: o.id, nombre: o.nombre })) };
  }

  /* Convierte el GeoJSON de /tops-cores/{id}/features en celdas */
  function celdasDeFeatures(fc) {
    const fs = (fc && fc.features) || [];
    const tops = fs.filter(f => f.properties && f.properties.type === "top" && f.geometry.type === "Point");
    return fs.filter(f => f.properties && f.properties.type === "blob" && f.geometry.type === "Polygon").map(b => {
      const ring = b.geometry.coordinates[0];
      // centroide de área (más estable que el promedio de vértices cuando cambia la forma de la celda)
      let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[i + 1], k = x1 * y2 - x2 * y1; A += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k; }
      const c = Math.abs(A) > 1e-12 ? [cy / (3 * A), cx / (3 * A)] : ring.reduce((a, p) => [a[0] + p[1] / ring.length, a[1] + p[0] / ring.length], [0, 0]);
      let top = null, best = Infinity;
      tops.forEach(t => { const d = (t.geometry.coordinates[1] - c[0]) ** 2 + (t.geometry.coordinates[0] - c[1]) ** 2; if (d < best) { best = d; top = t.properties.altitude_m; } });
      return { lat: c[0], lon: c[1], maxDbz: b.properties.max_dbz != null ? b.properties.max_dbz : b.properties.intensity_dbz, intDbz: b.properties.intensity_dbz, topKm: top != null && best < 0.01 ? +(top / 1000).toFixed(1) : null, ring: ring.map(p => [p[1], p[0]]) };
    });
  }

  const api = { analizar, celdasDeFeatures, OBJETIVOS, lluviaMMh, rumbo };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LQ_NOWCAST = api;
})(typeof window !== "undefined" ? window : this);
