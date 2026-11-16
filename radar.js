/* Radar RMA1 (Córdoba, OHMC) con núcleos de tormenta y granizo, y satélite GOES-East, sobre el mapa de amenaza
   de Río Ceballos. Solo versión web. */
(function () {
  "use strict";
  const el = document.getElementById("radarMap");
  if (!el || !window.L) return;
  const API = "https://webmet.ohmc.ar/api/v1";
  const D = window.LQ_DATA;
  const DIQUE = [-31.1495, -64.3421];
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" || document.documentElement.dataset.theme === "dark";
  const $ = id => document.getElementById(id);
  const fmt = (x, d = 0) => (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hora = t => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([-31.22, -64.32], 9);
  const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  const baseUrl = () => ESRI + (dark() ? "World_Dark_Gray_Base" : "World_Light_Gray_Base") + "/MapServer/tile/{z}/{y}/{x}";
  const refUrl = () => ESRI + (dark() ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference") + "/MapServer/tile/{z}/{y}/{x}";
  const base = L.tileLayer(baseUrl(), { maxZoom: 16, attribution: "Mapa base © Esri, HERE, Garmin, © OpenStreetMap" }).addTo(map);
  map.createPane("sat"); map.getPane("sat").style.zIndex = 300;
  map.createPane("radar"); map.getPane("radar").style.zIndex = 350;
  map.createPane("storm"); map.getPane("storm").style.zIndex = 420;
  map.createPane("top"); map.getPane("top").style.zIndex = 450;
  const ref = L.tileLayer(refUrl(), { maxZoom: 16, pane: "overlayPane" }).addTo(map);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { base.setUrl(baseUrl()); ref.setUrl(refUrl()); });

  // ---------- Capas fijas: mapa municipal, dique, radar ----------
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
  }
  L.circleMarker(DIQUE, { pane: "top", radius: 7, color: "#fff", weight: 2, fillColor: "#0b7a84", fillOpacity: 1 })
    .bindTooltip("Dique La Quebrada", { permanent: true, direction: "right", className: "rv-tip" }).addTo(map);
  [20, 40].forEach(km => L.circle(DIQUE, { pane: "top", radius: km * 1000, color: "#0b7a84", weight: 1, dashArray: "3 5", fill: false, interactive: false }).addTo(map));
  L.circleMarker([-31.4414, -64.1919], { pane: "top", radius: 4, color: "#111", weight: 1, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Radar RMA1").addTo(map);

  // ---------- Pluviómetros del robot ----------
  fetch("data/estado.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(e => {
    if (!e) return;
    const coords = { 58: [-31.1389, -64.4018], 93: [-31.1635, -64.3667], 67: [-31.1223, -64.3483], 390: [-31.1996, -64.3654] };
    const grp = L.layerGroup(), dots = L.layerGroup();
    const toggle = () => { if (map.getZoom() >= 11) { map.addLayer(grp); map.removeLayer(dots); } else { map.addLayer(dots); map.removeLayer(grp); } };
    map.on("zoomend", toggle);
    e.pluviometros.forEach(p => {
      const c = coords[p.id]; if (!c) return;
      const mm = p.activa ? p.h1 : null, txt = p.nombre + (p.activa ? " · " + String(p.h1).replace(".", ",") + " mm en 1 h, " + String(p.h24).replace(".", ",") + " mm en 24 h" : " · sin datos");
      L.circleMarker(c, { pane: "top", radius: 4, color: "#fff", weight: 1.5, fillColor: "#1559a6", fillOpacity: 1 }).bindTooltip(txt).addTo(dots);
      L.marker(c, { pane: "top", icon: L.divIcon({ className: "rv-gauge", html: "<b>" + (mm == null ? "–" : String(mm).replace(".", ",")) + "</b><span>mm/h</span>", iconSize: [46, 30], iconAnchor: [23, 15] }) }).bindTooltip(txt).addTo(grp);
    });
    toggle();
  }).catch(() => {});

  // ---------- Satélite GOES-East (infrarrojo, topes fríos) ----------
  const sat = L.tileLayer("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png",
    { pane: "sat", opacity: .6, maxNativeZoom: 6, maxZoom: 16, attribution: "GOES-East · NASA GIBS" });

  // ---------- Núcleos de tormenta y granizo ----------
  function clasificar(maxDbz, topKm) {
    let c = maxDbz >= 60 ? { k: "granizo", t: "Granizo probable", col: "#d6007a", n: 3 }
      : maxDbz >= 55 ? { k: "granizo-pos", t: "Granizo posible", col: "#c8102e", n: 2 }
      : maxDbz >= 50 ? { k: "fuerte", t: "Tormenta fuerte", col: "#e3640a", n: 1 }
      : { k: "tormenta", t: "Tormenta", col: "#d9a400", n: 0 };
    if (topKm != null && topKm >= 12 && maxDbz >= 55) c = { ...c, t: c.t + " · tormenta severa" };
    return c;
  }
  const R = 6371, rad = x => x * Math.PI / 180;
  function distKm(a, b) { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]); const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  function rumbo(a, b) { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); const g = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; return ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(g / 45) % 8]; }
  const stormLayer = L.layerGroup().addTo(map);
  let records = [], featCache = {};
  async function features(rec) {
    if (featCache[rec.id]) return featCache[rec.id];
    const r = await fetch(API + "/tops-cores/" + rec.id + "/features");
    if (!r.ok) return null;
    const fc = await r.json();
    const fs = fc.features || [];
    const tops = fs.filter(f => f.properties && f.properties.type === "top" && f.geometry.type === "Point");
    const cells = fs.filter(f => f.properties && f.properties.type === "blob" && f.geometry.type === "Polygon").map(b => {
      const ring = b.geometry.coordinates[0];
      const c = ring.reduce((a, p) => [a[0] + p[1] / ring.length, a[1] + p[0] / ring.length], [0, 0]);
      let top = null, best = Infinity;
      tops.forEach(t => { const d = (t.geometry.coordinates[1] - c[0]) ** 2 + (t.geometry.coordinates[0] - c[1]) ** 2; if (d < best) { best = d; top = t.properties.altitude_m; } });
      const maxDbz = b.properties.max_dbz != null ? b.properties.max_dbz : b.properties.intensity_dbz;
      return { ring: ring.map(p => [p[1], p[0]]), c, maxDbz, topKm: top != null && best < 0.01 ? top / 1000 : null, dist: distKm(DIQUE, c), dir: rumbo(DIQUE, c), clase: clasificar(maxDbz, top != null && best < 0.01 ? top / 1000 : null) };
    });
    return featCache[rec.id] = cells;
  }
  function recordFor(t) {
    let best = null, bd = Infinity;
    records.forEach(r => { const d = Math.abs(Date.parse(r.observation_time) - t); if (d < bd) { bd = d; best = r; } });
    return bd <= 7 * 60e3 ? best : null;
  }
  let stormToken = 0;
  async function drawStorms(t, isLast) {
    const tok = ++stormToken;
    stormLayer.clearLayers();
    const rec = recordFor(t);
    const list = $("rvCells");
    if (!rec) { if (isLast) list.innerHTML = "<li class='muted'>Sin núcleos de tormenta detectados por el radar en este momento.</li>"; return; }
    let cells; try { cells = await features(rec); } catch (e) { cells = null; }
    if (tok !== stormToken || !cells) return;
    if (!$("lyrStorm").checked) cells = [];
    cells.forEach(c => {
      L.polygon(c.ring, { pane: "storm", color: c.clase.col, weight: 2, fillColor: c.clase.col, fillOpacity: .18 })
        .bindTooltip(`<b>${c.clase.t}</b><br>${fmt(c.maxDbz)} dBZ${c.topKm ? " · tope " + fmt(c.topKm, 1) + " km" : ""}<br>${fmt(c.dist)} km al ${c.dir} del dique`).addTo(stormLayer);
      if (c.clase.n >= 2) L.marker(c.c, { pane: "storm", interactive: false, icon: L.divIcon({ className: "rv-hail", html: "<span style='--c:" + c.clase.col + "'>" + (c.clase.n === 3 ? "GR" : "gr") + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(stormLayer);
    });
    if (isLast || !playing) {
      const cerca = cells.filter(c => c.dist <= 80).sort((a, b) => a.dist - b.dist).slice(0, 6);
      list.innerHTML = cerca.length ? cerca.map(c => `<li><span class="tagl" style="--lvl:${c.clase.col};--lvl-bg:color-mix(in srgb, ${c.clase.col} 14%, transparent)">${c.clase.t.split(" · ")[0]}</span><span><b>${fmt(c.dist)} km al ${c.dir}</b> del dique · ${fmt(c.maxDbz)} dBZ${c.topKm ? " · tope " + fmt(c.topKm, 1) + " km" : ""}</span></li>`).join("")
        : "<li class='muted'>No hay núcleos de tormenta a menos de 80 km del dique.</li>";
      $("rvCellsTime").textContent = "Radar de las " + hora(Date.parse(rec.observation_time));
    }
  }

  // ---------- Cuadros del radar ----------
  const tEl = $("rvTime"), aEl = $("rvAge"), playBtn = $("rvPlay"), scrub = $("rvScrub");
  let frames = [], overlays = {}, idx = 0, playing = true, timer = null;
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
    const op = $("lyrRain").checked ? .82 : 0;
    frames.forEach((c, k) => { const o = overlays[c.id]; if (o) o.setOpacity(k === idx ? op : 0); });
    overlay(frames[idx]).setOpacity(op);
    overlay(frames[(idx + 1) % frames.length]);
    const c = frames[idx], t = Date.parse(c.observation_time), last = idx === frames.length - 1;
    tEl.textContent = hora(t) + (last ? " · última imagen" : "");
    const m = Math.round((Date.now() - t) / 60000);
    aEl.textContent = (refT ? new Date(t).toLocaleDateString("es-AR") + " · " : "") + "hace " + (m < 60 ? m + " min" : Math.round(m / 60) + " h") + " · máx. " + Math.round(c.data_max) + " dBZ";
    scrub.innerHTML = frames.map((_, k) => "<i" + (k === idx ? " class='on'" : "") + "></i>").join("");
    drawStorms(t, last);
  }
  function loop() { clearInterval(timer); if (playing) timer = setInterval(() => show(idx + 1 === frames.length ? 0 : idx + 1), 800); }
  // ?radar=2026-11-14T01:30Z muestra las 2 horas previas a ese momento (para revisar tormentas pasadas)
  const refParam = new URLSearchParams(location.search).get("radar");
  const refT = refParam && !isNaN(Date.parse(refParam)) ? Date.parse(refParam) : null;
  async function load() {
    const ref = refT || Date.now(), start = new Date(ref - 2 * 36e5);
    try {
      const q = new URLSearchParams({ radar_code: "RMA1", product_key: "COLMAX", page_size: "30", vol_nr: "01", strategy: "0315", start_time: start.toISOString(), end_time: new Date(ref + 6e5).toISOString() });
      const tq = new URLSearchParams({ time_from: start.toISOString(), time_to: new Date(ref + 6e5).toISOString(), radar_codes: "RMA1" });
      const [r, rt] = await Promise.all([fetch(API + "/cogs?" + q), fetch(API + "/tops-cores?" + tq).catch(() => null)]);
      if (!r.ok) throw new Error(r.status);
      if (rt && rt.ok) records = ((await rt.json()) || []).filter(x => x.status === "available" && (x.vol_nr === "01" || !x.vol_nr));
      const cogs = ((await r.json()).cogs || []).sort((a, b) => Date.parse(a.observation_time) - Date.parse(b.observation_time));
      if (!cogs.length) { tEl.textContent = "El radar no publicó imágenes en las últimas 2 horas"; aEl.textContent = ""; return; }
      Object.keys(overlays).forEach(id => { if (!cogs.find(c => String(c.id) === id)) { map.removeLayer(overlays[id]); delete overlays[id]; } });
      frames = cogs; show(frames.length - 1); loop();
    } catch (e) { tEl.textContent = "Radar no disponible en este momento"; aEl.textContent = "Reintenta solo en 5 minutos"; }
  }
  const stop = () => { playing = false; playBtn.textContent = "Animar"; playBtn.setAttribute("aria-pressed", false); loop(); };
  playBtn.addEventListener("click", () => { playing = !playing; playBtn.textContent = playing ? "Pausar" : "Animar"; playBtn.setAttribute("aria-pressed", playing); if (!playing) show(frames.length - 1); loop(); });
  $("rvPrev").addEventListener("click", () => { stop(); show(idx - 1); });
  $("rvNext").addEventListener("click", () => { stop(); show(idx + 1); });
  $("lyrRain").addEventListener("change", () => show(idx));
  $("lyrStorm").addEventListener("change", () => show(idx));
  $("lyrSat").addEventListener("change", e => { if (e.target.checked) { sat.setUrl(sat._url.split("?")[0] + "?t=" + Date.now()); sat.addTo(map); } else map.removeLayer(sat); });
  load(); if (!refT) setInterval(load, 5 * 60 * 1000);
  setInterval(() => { if (map.hasLayer(sat)) sat.setUrl(sat._url.split("?")[0] + "?t=" + Date.now()); }, 10 * 60 * 1000);
})();
