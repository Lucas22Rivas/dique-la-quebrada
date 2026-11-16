/* HIDRA · Centro de Monitoreo Hidrológico — Dique La Quebrada.
   Lee data/estado.json (alerta, evacuación, río, dique, lluvia), data/red.json (estaciones con coordenadas)
   y data/historia.json (lluvia horaria). Sensores, mapa y cronología están vinculados: al elegir un
   sensor se centra el mapa, se muestra su lectura y el gráfico del río pasa a ese sensor. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const fmt = (x, d = 1) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hora = t => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dia = t => new Date(t).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  const hoy = t => new Date(t).toDateString() === new Date().toDateString();
  const hace = t => { if (!t) return "sin datos"; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); return m < 1 ? "recién" : m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " d"; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sg = (x, d = 0, u = "") => x == null ? "" : (x > 0 ? "+" : x < 0 ? "−" : "±") + fmt(Math.abs(x), d) + u;
  const LVL = ["ok", "warn", "bad", "crit"];
  const caudalRio = h => h == null || h <= 0.1 ? 0 : 15 * Math.pow(h - 0.1, 1.8); // estimación por nivel, sin aforo
  const ZONA_SENSOR = [2123427, 751]; // sensores de Barrio San José (Orus primero)

  let E = null, R = null, H = null, sel = null, showAll = false, mapa = null, capas = {}, marcadores = {}, chLevel = null, chRain = null, modo3d = false, cargado3d = false;

  // ---------- Reloj y navegación ----------
  const reloj = () => { $("clock").textContent = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date()); };
  reloj(); setInterval(reloj, 30000);
  document.querySelectorAll("#nav [data-go]").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#nav .nav").forEach(x => x.classList.remove("active")); b.classList.add("active");
    const t = b.dataset.go; if (t === "top") window.scrollTo({ top: 0, behavior: "smooth" }); else $(t).scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $("investigate").addEventListener("click", () => { const s = masAnomalo(); if (s) seleccionar(s.id); $("investigar").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("toggleAll").addEventListener("click", () => { showAll = !showAll; $("toggleAll").textContent = showAll ? "Ver menos" : "Ver todos"; renderLista(); });

  // ---------- Datos ----------
  const leer = async u => { try { const r = await fetch(u + "?t=" + Date.now(), { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  async function cargar() {
    const [e, r, h] = await Promise.all([leer("data/estado.json"), leer("data/red.json"), leer("data/historia.json")]);
    if (e) E = e; if (r) R = r; if (h) H = h;
    if (!E) { $("bnTitle").textContent = "SIN CONEXIÓN CON LOS DATOS"; $("bnMsg").textContent = "No se pudo leer el estado. Reintentando en 1 minuto…"; return; }
    render();
  }
  cargar(); setInterval(cargar, 60 * 1000);

  // ---------- Modelo de sensores (une red.json con el detalle de estado.json) ----------
  function sensores() {
    const rios = {}; (E.rios || []).forEach(r => rios[r.id] = r);
    const pluv = {}; (E.pluviometros || []).forEach(p => pluv[p.id] = p);
    const base = (R && R.estaciones) || [];
    return base.map(s => {
      const o = { ...s };
      if (s.tipo === "rio") {
        const r = rios[s.id];
        if (r) { o.nivel = r.nivel != null ? r.nivel : o.nivel; o.subida30 = r.subida30; o.serie = r.serie; o.dato = r.dato || o.dato; o.activa = r.activa != null ? r.activa : o.activa; }
        const n = E.normalRio ? E.normalRio[s.id] : null;
        o.normal = n; o.sobre = n != null && o.nivel != null ? +(o.nivel - n).toFixed(2) : null;
        o.lvl = !o.activa ? "off" : o.sobre >= 0.5 || (o.subida30 || 0) >= 0.5 ? "crit" : o.sobre >= 0.25 || (o.subida30 || 0) >= 0.2 ? "warn" : "ok";
      } else if (s.tipo === "dique") {
        const d = E.dique; if (d) { o.nivel = d.respectoVertedero; o.cota = d.cota; o.cambio24h = d.cambio24h; o.serie = d.serie; o.dato = d.dato; }
        o.lvl = o.nivel == null ? "off" : o.nivel > 0 ? "crit" : o.nivel > -0.5 ? "warn" : "ok";
      } else {
        const p = pluv[s.id]; if (p) { o.h1 = p.h1; o.h24 = p.h24; o.intensidad = p.intensidad; }
        const it = o.intensidad != null ? o.intensidad : (o.mm10 || 0) * 6;
        o.lvl = !o.activa ? "off" : it >= 30 || (o.h1 || 0) >= 20 ? "crit" : it >= 10 || (o.h1 || 0) >= 5 ? "warn" : "ok";
      }
      o.rank = ZONA_SENSOR.includes(s.id) ? 0 : s.id === 98670 ? 1 : s.tipo === "dique" ? 2 : s.grupo === "cuenca" ? 3 : s.tipo === "rio" ? 4 : 5;
      return o;
    }).sort((a, b) => a.rank - b.rank || (b.activa - a.activa) || a.nombre.localeCompare(b.nombre));
  }
  const valor = s => s.tipo === "lluvia" ? (s.h24 != null ? fmt(s.h24, 1) + " mm" : s.mmDia != null ? fmt(s.mmDia, 1) + " mm" : "–")
    : s.tipo === "dique" ? (s.nivel != null ? sg(s.nivel, 2, " m") : "–") : (s.nivel != null ? fmt(s.nivel, 2) + " m" : "–");
  const tendencia = s => {
    if (s.tipo === "lluvia") return { t: (s.h1 != null ? fmt(s.h1, 1) + " mm última hora" : "") + (s.intensidad ? " · " + fmt(s.intensidad, 0) + " mm/h ahora" : ""), c: (s.h1 || 0) > 0 ? "up" : "" };
    if (s.tipo === "dique") return { t: s.cambio24h != null ? sg(s.cambio24h * 100, 0, " cm en 24 h") + (s.cota != null ? " · cota " + fmt(s.cota, 2) + " m" : "") : "", c: (s.cambio24h || 0) > 0.05 ? "up" : "" };
    return { t: (s.subida30 != null ? sg(s.subida30 * 100, 0, " cm / 30 min") : "") + (s.sobre != null ? " · " + sg(s.sobre * 100, 0, " cm sobre lo normal") : ""), c: (s.subida30 || 0) >= 0.05 ? "up" : (s.subida30 || 0) <= -0.05 ? "down" : "" };
  };
  const descripcion = s => {
    if (ZONA_SENSOR.includes(s.id)) return "Sensor de tu zona (Barrio San José). Es el que confirma si la crecida llegó al barrio.";
    if (s.id === 98670) return "Aguas arriba de San José: cuando sube acá, la crecida llega al barrio unos minutos después. Es la señal que da el tiempo para evacuar.";
    if (s.tipo === "dique") return "Nivel del embalse respecto del vertedero (cota 34 m). Por debajo de 0 el dique amortigua la crecida; por encima, vierte al río.";
    if (s.grupo === "cuenca") return "Pluviómetro dentro de la cuenca del dique: la lluvia que mide es la que llena el embalse.";
    if (s.tipo === "rio") return "Sensor de nivel del sistema Río Ceballos – Saldán, aguas abajo.";
    return "Pluviómetro del corredor de Sierras Chicas (fuera de la cuenca del dique): anticipa tormentas que se acercan.";
  };
  function masAnomalo() {
    const ss = sensores(); const ord = { crit: 3, warn: 2, ok: 1, off: 0 };
    return ss.slice().sort((a, b) => ord[b.lvl] - ord[a.lvl] || a.rank - b.rank)[0];
  }

  // ---------- Render general ----------
  function render() {
    const a = E.alerta || { orden: 0, motivos: [] }, lvl = LVL[a.orden] || "ok";
    const ev = E.evacuacion, ordenEv = ev ? ev.ordenMax : 0;
    // Estado de los datos
    const viejo = Date.now() - Date.parse(E.generado) > 30 * 60e3;
    $("livePill").className = "pill " + (viejo ? "" : "live"); $("livePill").textContent = viejo ? "● DATOS ATRASADOS" : "● EN VIVO";
    $("sbDot").className = "dot" + (viejo ? " bad" : "");
    $("sbTxt").textContent = viejo ? "Datos atrasados" : ordenEv >= 2 || a.orden >= 2 ? "Amenaza activa · lectura cada 2–3 min" : "Datos en vivo · cada 10 min";
    $("sbSub").innerHTML = "Actualizado " + hora(E.generado) + " (" + hace(E.generado) + ")<br>OHMC · APRHI · Open-Meteo";
    const n = (ev ? ev.zonas.filter(z => z.orden >= 1).length : 0) + (a.orden >= 1 ? 1 : 0);
    $("navCount").hidden = !n; $("navCount").textContent = n;

    renderEvac(ev);

    // Banner
    const TIT = ["NORMAL · SIN RIESGO EN LA CUENCA", "ATENCIÓN · VIGILANCIA REFORZADA", "ALERTA HIDROLÓGICA", "EMERGENCIA HIDROLÓGICA"];
    $("banner").dataset.lvl = lvl;
    $("bnTitle").textContent = TIT[a.orden] || TIT[0];
    $("bnMsg").textContent = a.orden ? (a.motivos[0] ? a.motivos[0].texto : "") : "No llueve en la cuenca y el pronóstico no compromete al dique. Vigilancia de rutina.";
    $("bnUpd").textContent = hora(E.generado);
    $("investigate").textContent = a.orden ? "Investigar evento ↗" : "Ver sensores ↗";
    $("evtPill").textContent = a.orden ? (a.etiqueta || "").toUpperCase() : "EN VIVO";

    renderMetricas();
    if (!sel || !sensores().some(s => s.id === sel)) sel = (sensores().find(s => ZONA_SENSOR.includes(s.id) && s.activa) || sensores()[0] || {}).id;
    renderLista(); renderMapa(); renderCrono(); seleccionar(sel, true); renderLluvia();
    document.title = ordenEv >= 3 ? "🚨 " + ev.zonas.find(z => z.orden === ordenEv).etiqueta.toUpperCase() + " · HIDRA" : a.orden >= 2 ? "⚠ " + (a.etiqueta || "").toUpperCase() + " · HIDRA" : "HIDRA | Centro de Monitoreo Hidrológico";
  }

  // ---------- Tu zona (alerta temprana de evacuación) ----------
  const EV_LVL = { normal: "ok", vigilancia: "warn", alerta: "bad", evacuar: "crit", peligro: "crit" };
  function renderEvac(ev) {
    const host = $("evac");
    if (!ev || !ev.zonas || !ev.zonas.length) { host.innerHTML = ""; return; }
    host.innerHTML = ev.zonas.map(z => {
      const L = z.local;
      const lectura = L && L.nivel != null ? `Río ${fmt(L.nivel, 2)} m` + (L.sobreNormal != null ? ` · ${sg(L.sobreNormal * 100, 0, " cm")} sobre lo normal` : "") + (L.subida30 != null ? ` · ${sg(L.subida30 * 100, 0, " cm/30 min")}` : "") : "Sin lectura del sensor local";
      if (z.orden === 0) return `<div class="zona calma"><span class="dot"></span><div><b>Tu zona · ${esc(z.nombre)}</b> <span class="muted">— sin riesgo de crecida ahora · ${esc(z.detalle)}</span></div><span class="r">${lectura}</span></div>`;
      const eta = !z.eta ? "" : z.eta.minutos > 0
        ? `<div class="eta"><div class="k">Llegada estimada${z.eta.medido ? " · medida" : ""}</div><div class="v">~${z.eta.minutos} min</div><div class="k">${hora(z.eta.hora)} h</div></div>`
        : `<div class="eta"><div class="k">Crecida</div><div class="v">EN CURSO</div></div>`;
      return `<div class="zona activa${z.orden >= 4 ? " peligro" : ""}" data-lvl="${EV_LVL[z.nivel] || "warn"}">
        <div class="top"><span class="chip">${esc(z.etiqueta)}</span><div class="who">Tu zona · ${esc(z.nombre)}<small>${esc(z.detalle)}</small></div>${eta}</div>
        <div class="accion">${esc(z.accion)}</div>
        <div class="por">${z.motivos.slice(0, 3).map(m => `<span>${esc(m.texto)}</span>`).join("")}</div>
        <div class="pie"><span class="r">${lectura}</span><span>Umbrales provisorios. Apoyo a la decisión: la orden de evacuar la da Defensa Civil. Ante la duda, a zona alta. Emergencias 100 / 103.</span></div>
      </div>`;
    }).join("");
  }

  // ---------- Métricas ----------
  function renderMetricas() {
    const d = E.dique, cu = E.cuenca || {}, ss = sensores();
    const rio = ss.find(s => ZONA_SENSOR.includes(s.id) && s.activa && s.nivel != null) || ss.find(s => s.tipo === "rio" && s.activa);
    const q = rio ? caudalRio(rio.nivel) : null;
    const act = ss.filter(s => s.activa).length;
    const m = [
      { k: "NIVEL DEL DIQUE", v: d ? sg(d.respectoVertedero, 2) : "–", u: "m", l: d && d.respectoVertedero > 0 ? "crit" : d && d.respectoVertedero > -0.5 ? "warn" : "", s: [d && d.cambio24h != null ? [(d.cambio24h > 0 ? "↗ " : d.cambio24h < 0 ? "↘ " : "") + sg(d.cambio24h * 100, 0, " cm en 24 h"), d.cambio24h > 0.05 ? "up" : ""] : null, ["respecto del vertedero · cota " + (d ? fmt(d.cota, 2) : "–") + " m", ""]] },
      { k: "LLUVIA EN CUENCA", v: fmt(cu.h1, 1), u: "mm", l: cu.h1 >= 20 ? "crit" : cu.h1 >= 5 ? "bad" : cu.h24 >= 30 ? "warn" : "", s: [["Acumulado última hora", ""], ["Hoy " + fmt(cu.h24, 1) + " mm · 5 días " + fmt(cu.d5, 0) + " mm", cu.h1 > 0 ? "up" : "ok"]] },
      { k: "NIVEL RÍO CEBALLOS", v: rio ? fmt(rio.nivel, 2) : "–", u: "m", l: rio ? (rio.lvl === "crit" ? "crit" : rio.lvl === "warn" ? "warn" : "") : "", s: [rio && rio.subida30 != null ? [(rio.subida30 > 0 ? "↗ " : rio.subida30 < 0 ? "↘ " : "") + sg(rio.subida30 * 100, 0, " cm / 30 min"), rio.subida30 >= 0.05 ? "up" : rio.subida30 <= -0.05 ? "down" : ""] : null, ["Puente San José · caudal est. " + fmt(q, 1) + " m³/s", ""]] },
      { k: "SENSORES EN LÍNEA", v: String(act), u: "/ " + ss.length, l: act < ss.length * 0.6 ? "warn" : "", s: [["● Datos OHMC / APRHI", "ok"], [ss.length - act ? (ss.length - act) + " sin dato reciente" : "Todos reportando", ""]] },
    ];
    $("metrics").innerHTML = m.map(x => `<article class="metric" data-lvl="${x.l}"><small>${x.k}</small><strong>${x.v} <em>${x.u}</em></strong>${x.s.filter(Boolean).map(s => `<span class="${s[1]}">${esc(s[0])}</span>`).join("")}</article>`).join("");
  }

  // ---------- Lista de sensores ----------
  function renderLista() {
    const ss = sensores(); const vis = showAll ? ss : ss.filter(s => s.rank <= 3 || s.lvl === "crit" || s.lvl === "warn").slice(0, 7);
    $("sensorList").innerHTML = vis.map(s => `<button class="sensor${s.id === sel ? " selected" : ""}" data-id="${s.id}"><span><span class="nm"><span class="st ${s.lvl}"></span>${esc(s.nombre)}</span><small>${s.tipo === "lluvia" ? "Lluvia" : s.tipo === "dique" ? "Nivel del embalse" : "Nivel del río"} · ${s.dato ? (hoy(s.dato) ? hora(s.dato) : dia(s.dato) + " " + hora(s.dato)) : "sin dato"}</small></span><strong>${valor(s)}</strong></button>`).join("");
    $("sensorList").querySelectorAll(".sensor").forEach(b => b.addEventListener("click", () => seleccionar(+b.dataset.id)));
  }

  // ---------- Selección ----------
  function seleccionar(id, silencioso) {
    const s = sensores().find(x => x.id === id); if (!s) return;
    sel = id;
    $("selectedName").textContent = s.nombre;
    $("selectedKind").textContent = (s.tipo === "lluvia" ? "LLUVIA ACUMULADA HOY" : s.tipo === "dique" ? "NIVEL DEL EMBALSE" : "NIVEL DEL RÍO") + (s.activa ? "" : " · SIN DATO RECIENTE");
    $("selectedValue").textContent = valor(s);
    const t = tendencia(s); $("selectedTrend").textContent = t.t; $("selectedTrend").className = "tr " + t.c;
    $("selectedDescription").textContent = descripcion(s) + (s.dato ? " Última lectura " + hace(s.dato) + "." : "");
    document.querySelectorAll(".sensor").forEach(el => el.classList.toggle("selected", +el.dataset.id === id));
    Object.entries(marcadores).forEach(([k, m]) => { const el = m.getElement && m.getElement(); const d = el && el.querySelector(".marker"); if (d) d.classList.toggle("active", +k === id); });
    if (mapa && !silencioso && s.lat) mapa.panTo([s.lat, s.lon], { animate: true, duration: .4 });
    if (s.tipo !== "lluvia") renderNivel(s); else if (!chLevel) renderNivel(sensores().find(x => ZONA_SENSOR.includes(x.id)) || s);
  }

  // ---------- Mapa (Leaflet, zonas de amenaza reales) ----------
  const C0 = [-64.315, -31.17], KX = 111320 * Math.cos(31.17 * Math.PI / 180), KY = 110540;
  const ll = p => [C0[1] - p[1] / KY, C0[0] + p[0] / KX]; // metros locales (x este, y sur) → [lat, lon]
  function renderMapa() {
    if (!window.L) { $("map").innerHTML = "<p class='empty' style='padding:16px'>No se pudo cargar el mapa. Verificá la conexión.</p>"; return; }
    if (!mapa) {
      mapa = L.map("map", { zoomControl: false, attributionControl: true }).setView([-31.168, -64.325], 13);
      L.control.zoom({ position: "topleft" }).addTo(mapa);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Esri, HERE, Garmin, © OpenStreetMap" }).addTo(mapa);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, opacity: .8 }).addTo(mapa);
      capas.zonas = L.layerGroup().addTo(mapa); capas.rios = L.layerGroup().addTo(mapa); capas.sensores = L.layerGroup().addTo(mapa);
      const D = window.LQ_DATA, isPt = f => f.g.length === 1 && f.g[0].length === 1;
      if (D) {
        const ZC = { "Zona de baja amenaza": ["#f4c430", .22], "Zona de moderada amenaza": ["#f57c00", .3], "Zona de alta amenaza": ["#d32f2f", .38] };
        Object.keys(ZC).forEach(k => D.feats.filter(f => f.l === k && !isPt(f)).forEach(f => L.polygon(f.g.map(r => r.map(ll)), { color: ZC[k][0], weight: 1, opacity: .8, fillColor: ZC[k][0], fillOpacity: ZC[k][1] }).bindPopup(`<strong>${esc(k)}</strong><br><small>Mapa municipal de amenaza de inundación</small>`).addTo(capas.zonas)));
        D.feats.filter(f => f.l === "Cursos de Agua" && !isPt(f)).forEach(f => f.g.forEach(r => L.polyline(r.map(ll), { color: "#4dc7ef", weight: 2.4, opacity: .85 }).addTo(capas.rios)));
        D.feats.filter(f => f.l === "Escorrentias" && !isPt(f)).forEach(f => f.g.forEach(r => L.polyline(r.map(ll), { color: "#4dc7ef", weight: 1.2, opacity: .55, dashArray: "5 5" }).addTo(capas.rios)));
        D.feats.filter(f => f.l === "Puntos de encuentro" && isPt(f)).forEach(f => L.circleMarker(ll(f.g[0][0]), { radius: 4, color: "#4fd5a0", weight: 2, fillColor: "#0b192a", fillOpacity: 1 }).bindPopup(`<strong>Punto de encuentro</strong><br>${esc(f.n || "")}<br><small>Zona segura ante evacuación</small>`).addTo(capas.zonas));
      }
      $("showSensors").addEventListener("change", e => e.target.checked ? capas.sensores.addTo(mapa) : mapa.removeLayer(capas.sensores));
      $("showZones").addEventListener("change", e => { e.target.checked ? capas.zonas.addTo(mapa) : mapa.removeLayer(capas.zonas); $("mapLegend").hidden = !e.target.checked || modo3d; });
      $("showRivers").addEventListener("change", e => e.target.checked ? capas.rios.addTo(mapa) : mapa.removeLayer(capas.rios));
    }
    // Sensores (se rehacen en cada actualización)
    capas.sensores.clearLayers(); Object.keys(marcadores).forEach(k => delete marcadores[k]);
    sensores().filter(s => s.lat).forEach(s => {
      const cls = ["marker", s.tipo === "lluvia" ? "lluvia" : s.tipo === "dique" ? "dique" : "", s.lvl === "off" ? "off" : s.lvl === "crit" ? "crit" : s.lvl === "warn" ? "warn" : "", s.id === sel ? "active" : ""].join(" ");
      const icon = L.divIcon({ html: `<div class="${cls}"></div>`, className: "", iconSize: [16, 16], iconAnchor: [8, 8] });
      const t = tendencia(s);
      marcadores[s.id] = L.marker([s.lat, s.lon], { icon, zIndexOffset: s.rank <= 2 ? 500 : 0 }).addTo(capas.sensores)
        .bindPopup(`<strong>${esc(s.nombre)}</strong><br>${valor(s)}${t.t ? "<br><small>" + esc(t.t) + "</small>" : ""}<br><small>${s.dato ? "Lectura " + hace(s.dato) : "Sin dato reciente"}</small>`)
        .on("click", () => seleccionar(s.id, true));
    });
    // Tu zona
    const ev = E.evacuacion;
    if (ev) ev.zonas.forEach(z => {
      const icon = L.divIcon({ html: `<div class="marker zona"></div>`, className: "", iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([z.lat - 0.0018, z.lon + 0.0022], { icon, zIndexOffset: 800 }).addTo(capas.sensores).bindPopup(`<strong>Tu zona · ${esc(z.nombre)}</strong><br>${esc(z.detalle)}<br><b>${esc(z.etiqueta)}</b>${z.eta && z.eta.minutos ? "<br><small>Llegada estimada ~" + z.eta.minutos + " min</small>" : ""}`);
    });
  }
  // 2D / 3D
  document.querySelectorAll(".seg [data-mode]").forEach(b => b.addEventListener("click", () => {
    modo3d = b.dataset.mode === "3d";
    document.querySelectorAll(".seg [data-mode]").forEach(x => x.classList.toggle("on", x === b));
    $("map").hidden = modo3d; $("map3d").hidden = !modo3d; $("mapLegend").hidden = modo3d || !$("showZones").checked;
    document.querySelectorAll(".layers label").forEach(l => l.style.visibility = modo3d ? "hidden" : "");
    if (modo3d && !cargado3d) { cargado3d = true; cargar3d(); }
    if (!modo3d && mapa) setTimeout(() => mapa.invalidateSize(), 50);
  }));
  function script(src) { return new Promise((ok, err) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = err; document.body.appendChild(s); }); }
  async function cargar3d() {
    const v = (document.currentScript && document.currentScript.src.split("?v=")[1]) || window.HIDRA_V || "";
    try {
      await script("https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js");
      await script("https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js");
      await script("map3d.js?v=" + v);
    } catch (e) { $("map3d").insertAdjacentHTML("beforeend", "<p class='empty' style='padding:16px'>No se pudo cargar el 3D. Recargá la página.</p>"); }
  }

  // ---------- Cronología ----------
  function renderCrono() {
    const evs = [];
    const NOM = { normal: "Vuelve a Normal", atencion: "Atención", alerta: "Alerta hidrológica", emergencia: "Emergencia hidrológica" };
    const LV = { normal: "ok", atencion: "warn", alerta: "bad", emergencia: "crit" };
    const ss = sensores();
    const sensorDe = txt => { const s = ss.find(x => txt && txt.includes(x.nombre.split("·").pop().trim())); return s ? s.id : null; };
    (E.historial || []).slice(0, 8).forEach(h => evs.push({ t: Date.parse(h.t), title: NOM[h.nivel] || h.nivel, desc: h.motivo, lvl: LV[h.nivel] || "", sensor: sensorDe(h.motivo) }));
    const c = E.ultimaCrecida;
    if (c && c.picos) c.picos.filter(p => p.subida != null && p.subida >= 0.1).forEach(p => evs.push({ t: Date.parse(p.hora), title: "Pico del río · " + p.nombre, desc: `${fmt(p.pico, 2)} m (${sg(p.subida * 100, 0, " cm")} sobre la base). Lluvia del evento: ${c.lluvia} mm.`, lvl: p.subida >= 0.5 ? "crit" : "warn", sensor: p.id }));
    const ev = E.evacuacion;
    if (ev) ev.zonas.filter(z => z.orden >= 1).forEach(z => evs.push({ t: Date.parse(ev.generado), title: "Tu zona · " + z.etiqueta, desc: z.motivos[0] ? z.motivos[0].texto : "", lvl: EV_LVL[z.nivel], sensor: ZONA_SENSOR.find(id => ss.some(s => s.id === id && s.activa)) || 751 }));
    evs.sort((a, b) => b.t - a.t);
    $("timeline").innerHTML = evs.length ? evs.slice(0, 7).map(e => `<div class="event" data-lvl="${e.lvl}" data-id="${e.sensor || ""}"><time>${hoy(e.t) ? hora(e.t) : dia(e.t)}</time><div><b>${esc(e.title)}</b><p>${esc(e.desc)}</p></div></div>`).join("") : "<div class='empty'>Sin eventos registrados.</div>";
    $("timeline").querySelectorAll(".event").forEach(el => el.addEventListener("click", () => { if (el.dataset.id) seleccionar(+el.dataset.id); }));
  }

  // ---------- Gráficos (Chart.js) ----------
  function baseChart() { if (!window.Chart) return false; Chart.defaults.color = "#9bb4c7"; Chart.defaults.borderColor = "#294155"; Chart.defaults.font.family = "Inter, system-ui, sans-serif"; Chart.defaults.font.size = 11; return true; }
  function renderNivel(s) {
    if (!baseChart() || !s) return;
    const pts = (s.serie || []).filter(x => x[1] != null).map(x => ({ x: Date.parse(x[0]), y: x[1] }));
    const esDique = s.tipo === "dique";
    $("levelSub").textContent = s.nombre + (esDique ? " · respecto del vertedero" : "") + " · últimas " + (esDique ? "72" : "24") + " h";
    const ds = [{ label: esDique ? "Nivel del embalse (m)" : "Nivel observado (m)", data: pts, borderColor: "#4dc7ef", backgroundColor: "#4dc7ef22", fill: true, tension: .3, pointRadius: 0, borderWidth: 2 }];
    let foot = "";
    if (pts.length) {
      const t0 = pts[0].x, t1 = pts[pts.length - 1].x;
      if (!esDique && s.normal != null) {
        ds.push({ label: "Normal", data: [{ x: t0, y: s.normal }, { x: t1 + 36e5, y: s.normal }], borderColor: "#7f9eb6", borderDash: [2, 4], pointRadius: 0, borderWidth: 1 });
        ds.push({ label: "Alerta (+50 cm)", data: [{ x: t0, y: s.normal + .5 }, { x: t1 + 36e5, y: s.normal + .5 }], borderColor: "#ff8491", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 });
      }
      if (esDique) ds.push({ label: "Vertedero", data: [{ x: t0, y: 0 }, { x: t1 + 36e5, y: 0 }], borderColor: "#ff8491", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 });
      const rec = pts.filter(p => p.x >= t1 - 60 * 6e4);
      if (rec.length >= 2) {
        const tasa = (rec[rec.length - 1].y - rec[0].y) / ((rec[rec.length - 1].x - rec[0].x) / 36e5 || 1);
        const last = pts[pts.length - 1];
        ds.push({ label: "Tendencia 1 h", data: [last, { x: last.x + 36e5, y: last.y + tasa }], borderColor: "#ffb855", borderDash: [5, 4], pointRadius: [3, 0], borderWidth: 2 });
        foot = `<span>Última: <b>${fmt(last.y, 2)} m</b> (${hora(last.x)})</span><span>Tendencia: <b>${sg(tasa * 100, 0, " cm/h")}</b></span>`;
      }
      if (!esDique && s.normal != null) foot += `<span>Normal: <b>${fmt(s.normal, 2)} m</b></span><span>Umbral de alerta: <b>${fmt(s.normal + .5, 2)} m</b></span>`;
    } else foot = "<span>Sin serie reciente para este sensor.</span>";
    $("levelFoot").innerHTML = foot;
    const opts = { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 2, padding: 12 } }, tooltip: { callbacks: { title: it => it.length ? hora(it[0].parsed.x) : "", label: it => it.dataset.label + ": " + fmt(it.parsed.y, 2) + " m" } } },
      scales: { x: { type: "linear", ticks: { callback: v => hora(v), maxTicksLimit: 8 }, grid: { display: false } }, y: { title: { display: true, text: "Metros" } } } };
    if (chLevel) { chLevel.data.datasets = ds; chLevel.options = opts; chLevel.update(); }
    else chLevel = new Chart($("levelChart"), { type: "line", data: { datasets: ds }, options: opts });
  }
  function renderLluvia() {
    if (!baseChart()) return;
    const lab = [], val = [];
    if (H && H.h) {
      const t0 = Date.parse(H.h.inicio), a = H.h.s.p58 || [], b = H.h.s.p93 || [];
      for (let i = Math.max(0, a.length - 12); i < a.length; i++) { const v = [a[i], b[i]].filter(x => x != null); lab.push(hora(t0 + (i + 1) * 36e5)); val.push(v.length ? +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1) : null); }
    }
    let acc = 0; const cum = val.map(v => +(acc += v || 0).toFixed(1));
    const cu = E.cuenca || {};
    $("rainFoot").innerHTML = `<span>Total 12 h: <b>${fmt(acc, 1)} mm</b></span><span>Última hora: <b>${fmt(cu.h1, 1)} mm</b></span><span>Lluvia antecedente: <b>${fmt(E.alerta && E.alerta.api, 0)} mm</b></span><span>El dique absorbe ~<b>${fmt(E.alerta && E.alerta.lluviaAbsorbible, 0)} mm</b></span>`;
    const ds = [{ type: "bar", label: "Lluvia por hora (mm)", data: val, backgroundColor: "#4dc7ef", borderRadius: 3, yAxisID: "y" },
      { type: "line", label: "Acumulada (mm)", data: cum, borderColor: "#e9f2fa", borderWidth: 1.5, pointRadius: 0, tension: .3, yAxisID: "y1" }];
    const opts = { responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 2, padding: 12 } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, suggestedMax: 5, title: { display: true, text: "mm / h" } }, y1: { beginAtZero: true, suggestedMax: 10, position: "right", grid: { display: false }, title: { display: true, text: "mm acum." } } } };
    if (chRain) { chRain.data.labels = lab; chRain.data.datasets = ds; chRain.update(); }
    else chRain = new Chart($("rainChart"), { data: { labels: lab, datasets: ds }, options: opts });
  }
})();
