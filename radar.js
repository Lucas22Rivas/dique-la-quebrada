/* Radar RMA1 (Córdoba) del OHMC sobre el mapa de amenaza de Río Ceballos. Solo versión web. */
(function () {
  "use strict";
  const el = document.getElementById("radarMap");
  if (!el || !window.L) return;
  const API = "https://webmet.ohmc.ar/api/v1";
  const D = window.LQ_DATA;
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" || document.documentElement.dataset.theme === "dark";

  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([-31.22, -64.32], 9);
  const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  const baseUrl = () => ESRI + (dark() ? "World_Dark_Gray_Base" : "World_Light_Gray_Base") + "/MapServer/tile/{z}/{y}/{x}";
  const refUrl = () => ESRI + (dark() ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference") + "/MapServer/tile/{z}/{y}/{x}";
  const base = L.tileLayer(baseUrl(), { maxZoom: 16, attribution: "Mapa base © Esri, HERE, Garmin, © OpenStreetMap" }).addTo(map);
  const ref = L.tileLayer(refUrl(), { maxZoom: 16, pane: "overlayPane" }).addTo(map);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { base.setUrl(baseUrl()); ref.setUrl(refUrl()); });
  map.createPane("radar"); map.getPane("radar").style.zIndex = 350;
  map.createPane("top"); map.getPane("top").style.zIndex = 450;

  // Capas del mapa municipal
  if (D) {
    const lon0 = D.center[0], lat0 = D.center[1];
    const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110950;
    const ll = p => [lat0 - p[1] / my, lon0 + p[0] / mx];
    const isPt = f => f.g.length === 1 && f.g[0].length === 1;
    const zc = { "Zona de alta amenaza": "#d32f2f", "Zona de moderada amenaza": "#ef7d00", "Zona de baja amenaza": "#e3b505" };
    D.feats.forEach(f => {
      if (zc[f.l] && !isPt(f)) L.polygon(f.g.map(r => r.map(ll)), { pane: "top", color: zc[f.l], weight: 1, fillOpacity: .28 }).bindTooltip(f.l).addTo(map);
      else if (f.l === "Cursos de Agua") f.g.forEach(r => L.polyline(r.map(ll), { pane: "top", color: "#1559a6", weight: 1.6, opacity: .9 }).addTo(map));
    });
    L.circleMarker(ll(D.dam), { pane: "top", radius: 7, color: "#fff", weight: 2, fillColor: "#0b7a84", fillOpacity: 1 })
      .bindTooltip("Dique La Quebrada", { permanent: true, direction: "right", className: "rv-tip" }).addTo(map);
  }
  // Radar RMA1 y anillo de 240 km
  L.circleMarker([-31.4414, -64.1919], { pane: "top", radius: 4, color: "#111", weight: 1, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Radar RMA1").addTo(map);

  // Pluviómetros del robot (valor de la última hora)
  fetch("data/estado.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(e => {
    if (!e) return;
    const coords = { 58: [-31.1389, -64.4018], 93: [-31.1635, -64.3667], 67: [-31.1223, -64.3483], 390: [-31.1996, -64.3654] };
    const grp = L.layerGroup(), dots = L.layerGroup();
    const toggle = () => { const z = map.getZoom(); if (z >= 11) { map.addLayer(grp); map.removeLayer(dots); } else { map.addLayer(dots); map.removeLayer(grp); } };
    map.on("zoomend", toggle);
    e.pluviometros.forEach(p => {
      const c0 = coords[p.id]; if (c0) L.circleMarker(c0, { pane: "top", radius: 4, color: "#fff", weight: 1.5, fillColor: "#1559a6", fillOpacity: 1 }).bindTooltip(p.nombre + (p.activa ? " · " + String(p.h1).replace(".", ",") + " mm en 1 h" : " · sin datos")).addTo(dots);
    });
    e.pluviometros.forEach(p => {
      const c = coords[p.id]; if (!c) return;
      const mm = p.activa ? p.h1 : null;
      L.marker(c, { pane: "top", icon: L.divIcon({ className: "rv-gauge", html: "<b>" + (mm == null ? "–" : String(mm).replace(".", ",")) + "</b><span>mm/h</span>", iconSize: [46, 30], iconAnchor: [23, 15] }) })
        .bindTooltip(p.nombre + (p.activa ? " · " + String(p.h24).replace(".", ",") + " mm en 24 h" : " · sin datos")).addTo(grp);
    });
    toggle();
  }).catch(() => {});

  // Cuadros del radar
  const tEl = document.getElementById("rvTime"), aEl = document.getElementById("rvAge"), playBtn = document.getElementById("rvPlay"), scrub = document.getElementById("rvScrub");
  let frames = [], overlays = {}, idx = 0, playing = true, timer = null;
  const hora = t => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function overlay(c) {
    if (!overlays[c.id]) {
      const b = c.bbox;
      overlays[c.id] = L.imageOverlay(API + "/frames/" + c.id + "/image.png", [[b.min_lat, b.min_lon], [b.max_lat, b.max_lon]], { pane: "radar", opacity: 0, interactive: false, className: "rv-img" }).addTo(map);
    }
    return overlays[c.id];
  }
  function show(i) {
    if (!frames.length) return;
    idx = (i + frames.length) % frames.length;
    frames.forEach((c, k) => { const o = overlays[c.id]; if (o) o.setOpacity(k === idx ? .82 : 0); });
    overlay(frames[idx]).setOpacity(.82);
    overlay(frames[(idx + 1) % frames.length]);
    const c = frames[idx], t = Date.parse(c.observation_time), last = idx === frames.length - 1;
    tEl.textContent = hora(t) + (last ? " · última imagen" : "");
    const m = Math.round((Date.now() - t) / 60000);
    aEl.textContent = "hace " + (m < 60 ? m + " min" : Math.round(m / 60) + " h") + " · máx. " + Math.round(c.data_max) + " dBZ";
    scrub.innerHTML = frames.map((_, k) => "<i" + (k === idx ? " class='on'" : "") + "></i>").join("");
  }
  function loop() { clearInterval(timer); if (playing) timer = setInterval(() => show(idx + 1 === frames.length ? 0 : idx + 1), idx === frames.length - 1 ? 1400 : 650); }
  async function load() {
    try {
      const start = new Date(Date.now() - 2 * 36e5).toISOString();
      const q = new URLSearchParams({ radar_code: "RMA1", product_key: "COLMAX", page_size: "30", vol_nr: "01", strategy: "0315", start_time: start });
      const r = await fetch(API + "/cogs?" + q);
      if (!r.ok) throw new Error(r.status);
      const cogs = ((await r.json()).cogs || []).sort((a, b) => Date.parse(a.observation_time) - Date.parse(b.observation_time));
      if (!cogs.length) { tEl.textContent = "El radar no publicó imágenes en las últimas 2 horas"; aEl.textContent = ""; return; }
      Object.keys(overlays).forEach(id => { if (!cogs.find(c => String(c.id) === id)) { map.removeLayer(overlays[id]); delete overlays[id]; } });
      frames = cogs; show(frames.length - 1); loop();
    } catch (e) { tEl.textContent = "Radar no disponible en este momento"; aEl.textContent = "Reintenta solo en 5 minutos"; }
  }
  playBtn.addEventListener("click", () => { playing = !playing; playBtn.textContent = playing ? "Pausar" : "Animar"; playBtn.setAttribute("aria-pressed", playing); if (!playing) show(frames.length - 1); loop(); });
  document.getElementById("rvPrev").addEventListener("click", () => { playing = false; playBtn.textContent = "Animar"; playBtn.setAttribute("aria-pressed", false); loop(); show(idx - 1); });
  document.getElementById("rvNext").addEventListener("click", () => { playing = false; playBtn.textContent = "Animar"; playBtn.setAttribute("aria-pressed", false); loop(); show(idx + 1); });
  load(); setInterval(load, 5 * 60 * 1000);
})();
