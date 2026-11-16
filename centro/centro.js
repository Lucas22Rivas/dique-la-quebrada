/* Centro de Monitoreo — arma la navegación y llena la pantalla principal con los datos en vivo
   (data/estado.json, data/historia.json). Las otras pestañas abren el tablero detallado. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const A = 36.88, HSP = 34, VSP = 3.3e6, NEXP = 3.09;
  const vol = d => VSP * Math.pow(Math.max(0, HSP + d) / HSP, NEXP);
  const fmt = (x, d = 1) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hora = t => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fechaHora = t => new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hace = t => { if (!t) return "sin datos"; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); return m < 1 ? "recién" : m < 60 ? "hace " + m + " min" : "hace " + Math.round(m / 60) + " h"; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const CLS = ["ok", "warn", "bad", "crit"], ORD = { normal: 0, atencion: 1, alerta: 2, emergencia: 3 };
  const caudalRio = h => h == null || h <= 0.1 ? 0 : 15 * Math.pow(h - 0.1, 1.8); // estimación por nivel, sin aforo

  // ---------- Navegación ----------
  const ic = {
    resumen: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', mapa: '<path d="M9 4l6 2 6-2v16l-6 2-6-2-6 2V6z"/><path d="M9 4v16M15 6v16"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-4"/>', sensores: '<path d="M5 12a7 7 0 0114 0"/><path d="M8 12a4 4 0 018 0"/><circle cx="12" cy="12" r="1"/>',
    alertas: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>', pronostico: '<path d="M7 16a5 5 0 01-1-9.9A6 6 0 0118 8a4 4 0 01-1 8"/>', historico: '<path d="M4 5h16v14H4z"/><path d="M4 10h16M9 5v14"/>',
    simulacion: '<path d="M3 20l6-10 4 5 3-4 5 9z"/>', camaras: '<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M16 11l5-3v8l-5-3z"/>', reportes: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 12h6M9 16h6"/>'
  };
  const T = "tablero.html";
  const NAV = [
    { id: "monitoreo", label: "Resumen", top: "Monitoreo", icon: "resumen", view: true },
    { id: "mapa", label: "Mapa", icon: "mapa", href: T + "#mapa" },
    { id: "radar", label: "Radar", icon: "radar", href: T + "#radar" },
    { id: "sensores", label: "Sensores", icon: "sensores", href: T + "#red" },
    { id: "alertas", label: "Alertas", icon: "alertas", view: true, alert: true, badge: true },
    { id: "pronostico", label: "Pronóstico", icon: "pronostico", href: T + "#parte" },
    { id: "historico", label: "Histórico", icon: "historico", href: T + "#historial" },
    { id: "simulacion", label: "Simulador 3D", icon: "simulacion", href: T + "#rio3d" },
    { id: "camaras", label: "Cámaras", icon: "camaras", href: T + "#camara" },
    { id: "reportes", label: "Reportes", icon: "reportes", href: T + "#fuentes" },
  ];
  const TABS = ["monitoreo", "alertas", "pronostico", "sensores", "historico", "simulacion", "camaras"];
  let orden = 0;
  function goMonitoreo(which) { $("topTitle").textContent = which === "alertas" ? "Alertas" : "Monitoreo"; $("topSub").textContent = which === "alertas" ? "Eventos y cronología" : "Estado general del sistema"; marcar(which); if (which === "alertas") $("timeline").scrollIntoView({ behavior: "smooth", block: "center" }); }
  function marcar(id) { document.querySelectorAll("#navSide button,#navTop button").forEach(b => b.classList.toggle("on", b.dataset.id === id)); }
  function item(n, top) {
    const b = document.createElement("button"); b.dataset.id = n.id; b.className = (n.alert ? "alrt " : "");
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ic[n.icon] || ""}</svg>`;
    b.innerHTML = top ? `${n.label}${n.badge ? ' <span class="badge" data-badge hidden>1</span>' : ""}` : `${svg}<span>${n.label}</span>${n.badge ? ' <span class="badge" data-badge hidden style="margin-left:auto">1</span>' : ""}`;
    b.onclick = () => { if (n.view) goMonitoreo(n.id); else location.href = n.href; };
    return b;
  }
  NAV.forEach(n => $("navSide").appendChild(item(n, false)));
  NAV.filter(n => TABS.includes(n.id)).sort((a, b) => TABS.indexOf(a.id) - TABS.indexOf(b.id)).forEach(n => $("navTop").appendChild(item(n, true)));
  marcar("monitoreo");

  // ---------- Reloj ----------
  const relojes = () => { const d = new Date(); const s = d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); $("clk").textContent = s.charAt(0).toUpperCase() + s.slice(1) + " · " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); };
  relojes(); setInterval(relojes, 30000);

  // ---------- Datos ----------
  let E = null, H = null;
  async function cargar() {
    try { const r = await fetch("data/estado.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) E = await r.json(); } catch (e) { }
    try { const r = await fetch("data/historia.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) H = await r.json(); } catch (e) { }
    if (E) render();
    else { $("bnMsg").textContent = "No se pudieron leer los datos en vivo. Reintentando…"; }
  }
  cargar(); setInterval(cargar, 60 * 1000);

  function render() {
    const a = E.alerta, c = CLS[a.orden], d = E.dique, cu = E.cuenca, p = E.pronostico;
    const subio = a.orden > orden; orden = a.orden;
    // Estado del sistema
    const viejo = Date.now() - Date.parse(E.generado) > 30 * 60e3, hayError = (E.errores || []).length > 0;
    $("sysState").className = "sysok" + (viejo || hayError ? " bad" : "");
    $("sysState").querySelector("span").textContent = viejo ? "Datos atrasados" : hayError ? "Con avisos" : "Sistema operativo";
    // Clima (de la cuenca / Los Hornillos si estuviera; si no, lluvia)
    $("wx").innerHTML = `<div class="t">${a.api != null ? fmt(a.api, 0) + " mm" : "–"}</div><small>Lluvia antecedente · suelo ${["", "seco", "normal", "muy húmedo"][a.amc] || "–"}</small>`;

    // Banner
    const bn = $("banner"); bn.dataset.lvl = c;
    const etiqMap = { ok: "Normal", warn: "Atención", bad: "Alerta", crit: "Emergencia" };
    $("bnLvl").firstChild.textContent = (a.etiqueta || etiqMap[c]) + " ";
    const pillTxt = { ok: "SIN RIESGO", warn: "NIVEL AMARILLO", bad: "NIVEL NARANJA", crit: "NIVEL ROJO" }[c];
    $("bnPill").textContent = pillTxt; $("bnPill").style.display = a.orden ? "" : "none";
    $("bnMsg").textContent = a.orden ? (a.motivos[0] ? a.motivos[0].texto : "") : "No llueve en la cuenca y el pronóstico no compromete al dique. Vigilancia de rutina.";
    $("bnUpd").textContent = fechaHora(E.generado);
    // Tiempo de viaje al valle (si hay río en ascenso)
    const subiendo = (E.rios || []).some(r => r.activa && r.subida30 != null && r.subida30 >= 0.1);
    $("bnEtaWrap").hidden = !(subiendo && a.orden >= 2);
    $("bnEta").textContent = "≈ 60–90 min";

    // Tarjetas
    const sobre = r => { if (!r) return null; if (r.id === "orus" && E.camara && typeof E.camara.normal === "number" && r.nivel != null) return +(r.nivel - E.camara.normal).toFixed(2); const n = E.normalRio && E.normalRio[r.id]; return n != null && r.nivel != null ? +(r.nivel - n).toFixed(2) : null; };
    const rioAbajo = (E.rios || []).find(r => r.id === "orus" && r.activa)
      || (E.rios || []).filter(r => r.activa && [751, 174264].includes(r.id)).sort((x, y) => (y.nivel || 0) - (x.nivel || 0))[0]
      || (E.rios || []).find(r => r.activa);
    const snAbajo = sobre(rioAbajo);
    const qEst = rioAbajo ? caudalRio(rioAbajo.nivel) : null;
    const qPrev = rioAbajo && rioAbajo.serie ? (() => { const s = rioAbajo.serie.filter(x => x[1] != null); const h1 = s.find(x => Date.parse(x[0]) <= Date.now() - 55 * 60e3); return h1 ? caudalRio(h1[1]) : null; })() : null;
    const dcambio = d && d.cambio24h != null ? d.cambio24h : null;
    const cards = [
      { lvl: d && d.respectoVertedero > 0 ? "crit" : d && d.respectoVertedero > -1 ? "warn" : "ok", ic: '<path d="M4 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M4 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/>', h: "Nivel del dique", v: d ? (d.respectoVertedero > 0 ? "+" : "") + fmt(d.respectoVertedero, 2) + '<small> m</small>' : "–", s: d ? "Cota " + fmt(d.cota, 2) + " m" : "", tr: dcambio != null ? (dcambio >= 0 ? "↑ +" : "↓ ") + fmt(Math.abs(dcambio) * 100, 0) + " cm (24 h)" : "" },
      { lvl: cu.h1 >= 20 ? "crit" : cu.h1 >= 5 ? "bad" : cu.d5 >= 50 ? "warn" : "ok", ic: '<path d="M7 16a5 5 0 01-1-9.9A6 6 0 0118 8a4 4 0 01-1 8"/><path d="M8 18l1 3M12 18l1 3M16 18l1 3"/>', h: "Lluvia (cuenca)", v: fmt(cu.h1, 1) + '<small> mm/h</small>', s: "Acum. 3 h: " + fmt(cu.h3, 1) + " mm · hoy " + fmt(cu.h24, 0) + " mm", tr: "" },
      { lvl: snAbajo == null ? "ok" : (snAbajo >= 1 ? "crit" : snAbajo >= .5 ? "bad" : snAbajo >= .25 ? "warn" : "ok"), ic: '<path d="M4 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/>', h: "Río Ceballos (aguas abajo)", v: rioAbajo ? fmt(rioAbajo.nivel, 2) + '<small> m</small>' : "–", s: rioAbajo ? esc(rioAbajo.nombre.split("·").pop().trim()) : "sin datos", tr: rioAbajo && rioAbajo.subida30 != null ? (rioAbajo.subida30 >= 0 ? "↑ +" : "↓ ") + fmt(Math.abs(rioAbajo.subida30) * 100, 0) + " cm (30 min)" : "" },
      { lvl: qEst >= 40 ? "crit" : qEst >= 15 ? "bad" : qEst >= 5 ? "warn" : "ok", ic: '<path d="M12 3c3 4 6 7 6 11a6 6 0 01-12 0c0-4 3-7 6-11z"/>', h: "Caudal estimado", v: qEst == null ? "–" : fmt(qEst, 1) + '<small> m³/s</small>', s: "estimado por nivel (sin aforo)", tr: qEst != null && qPrev != null && qPrev > 0 ? (qEst >= qPrev ? "↑ +" : "↓ ") + fmt(Math.abs((qEst / qPrev - 1) * 100), 0) + " % (1 h)" : "" },
    ];
    $("cards").innerHTML = cards.map(k => `<div class="card" data-lvl="${k.lvl}"><div class="h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${k.ic}</svg>${k.h}</div><div class="v">${k.v}</div><div class="s">${k.s}</div>${k.tr ? `<div class="trend c-${k.lvl}">${k.tr}</div>` : ""}</div>`).join("");

    // Callouts sobre el mapa
    const cells = (E.tormentas && E.tormentas.celdas || []).filter(x => x.dist <= 60).sort((x, y) => x.dist - y.dist)[0];
    const co = [];
    if (cells) co.push({ pos: "left:12px;top:12px", lvl: cells.maxDbz >= 55 ? "crit" : "bad", k: "⛈ Tormenta activa", v: fmt(cells.maxDbz, 0) + " dBZ", s: fmt(cells.dist, 0) + " km al " + cells.dir + (cells.topKm ? " · tope " + fmt(cells.topKm, 1) + " km" : "") });
    if (d) co.push({ pos: "right:12px;top:64px", lvl: d.respectoVertedero > 0 ? "crit" : "ok", k: "Nivel dique", v: (d.respectoVertedero > 0 ? "+" : "") + fmt(d.respectoVertedero, 2) + " m", s: d.cambio24h != null ? (d.cambio24h >= 0 ? "↑ +" : "↓ ") + fmt(Math.abs(d.cambio24h) * 100, 0) + " cm/24 h" : "" });
    if (rioAbajo) co.push({ pos: "right:12px;bottom:14px", lvl: snAbajo != null && snAbajo >= .5 ? "bad" : "ok", k: "Río aguas abajo", v: fmt(rioAbajo.nivel, 2) + " m", s: rioAbajo.subida30 != null ? (rioAbajo.subida30 >= 0 ? "↑ +" : "↓ ") + fmt(Math.abs(rioAbajo.subida30) * 100, 0) + " cm/30 min" : "" });
    $("calloutHost").innerHTML = co.map(x => `<div class="callout${x.k[0] === "⛈" ? " storm" : ""}" data-lvl="${x.lvl}" style="${x.pos}"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="s">${x.s}</div></div>`).join("");

    // Impacto estimado
    const zonasAlta = 7; // mapa INA: zonas de alta amenaza en el corredor
    const imp = a.orden >= 2
      ? [["home", "Sectores en riesgo", zonasAlta + " zonas de alta amenaza"], ["users", "Población expuesta (est.)", "barrios ribereños del río Ceballos"], ["bridge", "Infraestructura", "vados y pasarelas sobre el río"]]
      : [["home", "Colchón del dique", fmt(a.colchonHm3, 2) + " hm³ · absorbe ~" + fmt(a.lluviaAbsorbible, 0) + " mm"], ["users", "Agua potable", "~50.000 personas abastecidas"], ["bridge", "Vados y pasarelas", "transitables · sin cortes"]];
    const impIc = { home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><path d="M16 6a3 3 0 010 6"/>', bridge: '<path d="M3 10v8M21 10v8M3 14h18"/><path d="M3 10a9 9 0 0118 0"/>' };
    $("impacto").innerHTML = imp.map(r => `<div class="row" data-lvl="${c}"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${impIc[r[0]]}</svg></span><span class="lbl">${r[1]}</span><span class="val"><b>${r[2].match(/^[\d.,]+/) ? r[2].split(" ")[0] : ""}</b>${r[2].match(/^[\d.,]+/) ? " " + r[2].split(" ").slice(1).join(" ") : r[2]}</span></div>`).join("");

    // Recomendaciones
    const okIc = '<path d="M20 6L9 17l-5-5"/>', recs = a.orden >= 2
      ? ["Evitar la circulación por vados y zonas bajas.", "Mantenerse informado por canales oficiales.", "Tener a mano la mochila de emergencia y el plan familiar.", { w: 1, t: "Ante una crecida, no intentar cruzar el río." }]
      : a.orden === 1
        ? ["Seguir el pronóstico y el radar durante el día.", "Revisar desagües y cauces antes de la tormenta.", { w: 1, t: "Si el suelo está húmedo, la próxima lluvia escurre más." }]
        : ["Situación normal: vigilancia de rutina.", "Lectura diaria de pluviómetros y nivel del dique.", "Mantener el nivel guía de temporada."];
    $("recs").innerHTML = recs.map(r => typeof r === "string"
      ? `<div class="rec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${okIc}</svg><span>${r}</span></div>`
      : `<div class="rec warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg><span>${r.t}</span></div>`).join("");

    // Cronología
    const hist = (E.historial || []).slice(0, 6);
    $("timeline").innerHTML = hist.length ? hist.map(h => `<div class="it" data-lvl="${CLS[ORD[h.nivel]]}"><span class="t">${hora(h.t)}</span><span class="dot"></span><div class="c"><b>${{ normal: "Normal", atencion: "Atención", alerta: "ALERTA", emergencia: "EMERGENCIA" }[h.nivel] || h.nivel}</b><span>${esc(h.motivo)}</span></div></div>`).join("") : '<div class="note">Sin cambios de alerta registrados.</div>';
    if (subio && a.orden >= 2) document.title = "⚠ " + (a.etiqueta || "").toUpperCase() + " · Dique La Quebrada";
    else document.title = "Centro de Monitoreo · Dique La Quebrada";

    // Gráficos
    if (rioAbajo) { $("rioSensor").textContent = rioAbajo.nombre.split("·").pop().trim(); chartRio(rioAbajo); }
    chartLluvia();
  }

  // Gráfico de evolución del nivel del río con tendencia
  function chartRio(r) {
    const s = (r.serie || []).filter(x => x[1] != null).map(x => [Date.parse(x[0]), x[1]]);
    const svg = $("chRio2"); if (s.length < 2) { svg.innerHTML = ""; return; }
    const W = 640, Hh = 230, m = { l: 44, r: 12, t: 14, b: 26 }, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    const t1 = Date.now(), t0 = Math.min(s[0][0], t1 - 24 * 36e5);
    const nr = E.normalRio ? E.normalRio[r.id] : null, umb = nr != null ? nr + 0.5 : null;
    const vals = s.map(x => x[1]).concat(umb != null ? [umb] : []);
    let lo = Math.min(...vals) - .05, hi = Math.max(...vals) + .08;
    const x = t => m.l + (t - t0) / (t1 - t0) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
    let g = "";
    const step = (hi - lo) / 4;
    for (let i = 0; i <= 4; i++) { const v = lo + step * i; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line2)"/><text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, 2)}</text>`; }
    const d0 = new Date(t0); d0.setMinutes(0, 0, 0); for (let t = d0.getTime(); t <= t1; t += 3 * 36e5) if (t >= t0) g += `<text x="${x(t)}" y="${Hh - 8}" text-anchor="middle">${hora(t)}</text>`;
    if (umb != null && umb < hi) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(umb)}" y2="${y(umb)}" stroke="var(--crit)" stroke-dasharray="5 4"/><text x="${W - m.r - 2}" y="${y(umb) - 4}" text-anchor="end" style="fill:var(--crit)">alerta +50 cm</text>`;
    const path = s.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join("");
    g += `<path d="${path}L${x(s[s.length - 1][0])},${y(lo)}L${x(s[0][0])},${y(lo)}Z" fill="var(--acc)" opacity=".1"/>`;
    g += `<path d="${path}" fill="none" stroke="var(--acc)" stroke-width="2.4"/>`;
    // Tendencia: últimos 60 min extrapolados 60 min
    const rec = s.filter(p => p[0] >= s[s.length - 1][0] - 60 * 60e3);
    if (rec.length >= 2) { const dt = (rec[rec.length - 1][0] - rec[0][0]) / 6e4, dv = rec[rec.length - 1][1] - rec[0][1], tasa = dt ? dv / dt : 0; const last = s[s.length - 1], fx = last[0] + 60 * 60e3, fy = Math.max(lo, last[1] + tasa * 60); g += `<path d="M${x(last[0])},${y(last[1])}L${x(fx)},${y(fy)}" fill="none" stroke="var(--bad)" stroke-width="2.2" stroke-dasharray="6 4"/>`; const lbl = fmt(last[1], 2) + " m" + (Math.abs(tasa) > 0.0005 ? " (" + (tasa >= 0 ? "+" : "") + fmt(tasa * 60, 2) + "/h)" : ""); g += `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="var(--acc)"/><text x="${x(last[0])}" y="${y(last[1]) - 10}" text-anchor="middle" style="fill:var(--ink);font-weight:600;font-size:12px">${lbl}</text>`; }
    svg.innerHTML = g;
  }

  // Gráfico de lluvia por hora (de la cuenca) + acumulado
  function chartLluvia() {
    const svg = $("chLlu2");
    let pts = [];
    if (H) { const t0 = Date.parse(H.h.inicio), a = H.h.s.p58 || [], b = H.h.s.p93 || []; const from = Date.now() - 6.5 * 36e5; a.forEach((_, i) => { const t = t0 + i * 36e5; if (t < from) return; const v = [a[i], b[i]].filter(x => x != null); pts.push([t, v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0]); }); }
    const W = 520, Hh = 230, m = { l: 36, r: 10, t: 14, b: 26 }, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    const mx = Math.max(10, ...pts.map(p => p[1])) * 1.15;
    const t1 = Date.now(), t0 = t1 - 6.5 * 36e5;
    const x = t => m.l + (t - t0) / (t1 - t0) * iw, y = v => m.t + ih - v / mx * ih;
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = mx / 4 * i; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line2)"/><text x="${m.l - 5}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, 0)}</text>`; }
    const bw = Math.max(4, iw / (pts.length || 1) - 5);
    let acc = 0; const cum = [];
    pts.forEach(p => { acc += p[1]; cum.push([p[0], acc]); if (p[1] > 0) g += `<rect x="${x(p[0]) - bw / 2}" y="${y(p[1])}" width="${bw}" height="${Math.max(0, y(0) - y(p[1]))}" rx="2" fill="var(--acc)"/>`; g += `<text x="${x(p[0])}" y="${Hh - 8}" text-anchor="middle">${hora(p[0])}</text>`; });
    const cmx = Math.max(1, acc), yc = v => m.t + ih - v / cmx * ih;
    if (cum.length) g += `<path d="${cum.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + yc(p[1]).toFixed(1)).join("")}" fill="none" stroke="var(--ink)" stroke-width="1.6" opacity=".7"/>`;
    svg.innerHTML = g;
    const cu = E.cuenca;
    $("llu6").textContent = fmt(acc, 1) + " mm"; $("llu1").textContent = fmt(cu.h1, 1) + " mm"; $("lluApi").textContent = fmt(E.alerta.api != null ? E.alerta.api : cu.d5, 0) + " mm";
  }
})();
