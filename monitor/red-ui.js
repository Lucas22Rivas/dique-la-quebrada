/* Panel de red en vivo: mapa + tablas de pluviómetros, río y dique del corredor. Lee data/red.json. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  if (!$("red") || !window.L) return;
  const fmt = (x, d = 1) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hace = t => { if (!t) return "sin datos"; const m = Math.round((Date.now() - Date.parse(t)) / 6e4); return m < 1 ? "recién" : m < 60 ? "hace " + m + " min" : "hace " + Math.round(m / 60) + " h"; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" || document.documentElement.dataset.theme === "dark";

  const map = L.map("redMap", { zoomControl: true, scrollWheelZoom: false }).setView([-31.18, -64.35], 11);
  const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  const baseUrl = () => ESRI + (dark() ? "World_Dark_Gray_Base" : "World_Light_Gray_Base") + "/MapServer/tile/{z}/{y}/{x}";
  const base = L.tileLayer(baseUrl(), { maxZoom: 15, attribution: "© Esri · OSM" }).addTo(map);
  const ref = L.tileLayer(ESRI + (dark() ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference") + "/MapServer/tile/{z}/{y}/{x}", { maxZoom: 15 }).addTo(map);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { base.setUrl(baseUrl()); });
  let capa = L.layerGroup().addTo(map);

  const colorLluvia = mm => mm == null ? "#9aa4a8" : mm >= 4 ? "#c8102e" : mm >= 2 ? "#ef7d00" : mm >= 0.5 ? "#e3b505" : mm > 0 ? "#2f9e44" : "#4a7fb0";
  const colorNivel = (an) => an == null ? "#9aa4a8" : an >= 1 ? "#c8102e" : an >= .5 ? "#ef7d00" : an >= .25 ? "#e3b505" : "#2f7fd0";

  function pintarMapa(est, normalRio) {
    capa.clearLayers();
    est.forEach(e => {
      if (e.lat == null) return;
      let color, r = 7, forma;
      if (e.tipo === "lluvia") { color = e.activa ? colorLluvia(e.mm10) : "#9aa4a8"; forma = "circle"; r = 6 + (e.mm10 ? Math.min(8, e.mm10 * 2) : 0); }
      else { const nr = normalRio[e.id], an = nr != null && e.nivel != null ? e.nivel - nr : null; color = e.activa ? colorNivel(an) : "#9aa4a8"; forma = e.tipo === "dique" ? "rect" : "tri"; }
      const tip = `<b>${esc(e.nombre)}</b><br>${e.tipo === "lluvia" ? (e.activa ? fmt(e.mm10) + " mm ahora · " + fmt(e.mmDia) + " mm hoy" : "sin datos") : e.tipo === "dique" ? (e.activa ? (e.nivel > 0 ? "+" : "") + fmt(e.nivel, 2) + " m del vertedero" : "sin datos") : (e.activa ? fmt(e.nivel, 2) + " m" : "sin datos")}<br>${hace(e.dato)}`;
      const m = forma === "circle"
        ? L.circleMarker([e.lat, e.lon], { radius: r, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: .9 })
        : L.marker([e.lat, e.lon], { icon: L.divIcon({ className: "red-mk", html: `<span class="${forma}" style="--c:${color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] }) });
      m.bindTooltip(tip).addTo(capa);
    });
  }

  function render(R, normalRio) {
    const est = R.estaciones || [], act = est.filter(e => e.activa);
    $("redDot").className = "dot " + (act.length ? "ok pulse" : "warn");
    $("redSub").textContent = act.length + " de " + est.length + " estaciones activas · actualizado " + hace(R.generado) + " · se renueva cada 10 min";
    const lluvias = est.filter(e => e.tipo === "lluvia"), rios = est.filter(e => e.tipo !== "lluvia");
    const mmAhora = Math.max(0, ...lluvias.filter(e => e.activa && e.mm10 != null).map(e => e.mm10));
    const mmHoy = Math.max(0, ...lluvias.filter(e => e.activa && e.mmDia != null).map(e => e.mmDia));
    const rioMax = rios.filter(e => e.tipo === "rio" && e.activa && e.nivel != null && normalRio[e.id] != null).map(e => e.nivel - normalRio[e.id]);
    const subMax = rioMax.length ? Math.max(...rioMax) : null;
    $("redTiles").innerHTML = [
      { k: "Lluvia máxima ahora", v: fmt(mmAhora) + "<small>mm/10min</small>", s: (lluvias.filter(e => e.activa).length) + " pluviómetros", c: mmAhora >= 4 ? "bad" : mmAhora >= 1 ? "warn" : "ok" },
      { k: "Máximo acumulado hoy", v: fmt(mmHoy, 0) + "<small>mm</small>", s: "en el corredor", c: mmHoy >= 40 ? "warn" : "ok" },
      { k: "Río más crecido", v: subMax == null ? "–" : (subMax >= 0 ? "+" : "") + fmt(subMax * 100, 0) + "<small>cm</small>", s: "sobre lo normal", c: subMax == null ? "ok" : subMax >= 1 ? "crit" : subMax >= .5 ? "bad" : subMax >= .25 ? "warn" : "ok" },
    ].map(t => `<div class="ro" data-lvl="${t.c}"><span class="k"><span class="flag"></span>${t.k}</span><span class="v">${t.v}</span><span class="s">${t.s}</span></div>`).join("");
    // Tabla lluvia
    $("redLluvia").innerHTML = "<thead><tr><th>Estación</th><th>Ahora</th><th>Hoy</th><th>Dato</th></tr></thead><tbody>" +
      lluvias.map(e => `<tr${e.grupo === "cuenca" ? " class='hl'" : ""}><td>${esc(e.nombre)}${e.grupo === "cuenca" ? " <span class='muted'>· cuenca</span>" : ""}</td><td class="num">${e.activa ? fmt(e.mm10) : "–"}</td><td class="num">${e.activa ? fmt(e.mmDia, 0) : "–"}</td><td class="muted">${e.activa ? hace(e.dato) : "<span class='c-warn'>sin datos</span>"}</td></tr>`).join("") + "</tbody>";
    // Tabla río + dique
    $("redRio").innerHTML = "<thead><tr><th>Sensor</th><th>Nivel</th><th>Sobre normal</th><th>Dato</th></tr></thead><tbody>" +
      rios.map(e => { const nr = normalRio[e.id], an = e.tipo === "rio" && nr != null && e.nivel != null ? e.nivel - nr : null;
        return `<tr${e.tipo === "dique" ? " class='hl'" : ""}><td>${esc(e.nombre)}</td><td class="num">${e.activa ? (e.tipo === "dique" ? (e.nivel > 0 ? "+" : "") + fmt(e.nivel, 2) : fmt(e.nivel, 2)) + " m" : "–"}</td><td class="num">${an == null ? "–" : (an >= 0 ? "+" : "") + fmt(an * 100, 0) + " cm"}</td><td class="muted">${e.activa ? hace(e.dato) : "<span class='c-warn'>sin datos</span>"}</td></tr>`; }).join("") + "</tbody>";
    pintarMapa(est, normalRio);
  }

  async function cargar() {
    let normalRio = {};
    try { const h = await fetch("data/historia.json?t=" + Date.now()); if (h.ok) { const H = await h.json(); normalRio = H.normal || {}; } } catch (e) { }
    try { const r = await fetch("data/red.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw 0; render(await r.json(), normalRio); }
    catch (e) { $("redSub").textContent = "No se pudo leer la red de estaciones. Reintentando."; }
  }
  cargar(); setInterval(cargar, 60 * 1000);
})();
