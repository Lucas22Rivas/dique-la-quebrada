/* Radar de lluvia en vivo (RainViewer) sobre el mapa de amenaza de Río Ceballos. Solo versión web. */
(function () {
  "use strict";
  const el = document.getElementById("radarMap");
  if (!el || !window.L) return;
  const D = window.LQ_DATA;
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false }).setView([-31.17, -64.33], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 15, attribution: "© OpenStreetMap",
  }).addTo(map);

  // Capas del mapa municipal (coordenadas locales -> lat/lon)
  if (D) {
    const lon0 = D.center[0], lat0 = D.center[1];
    const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110950;
    const ll = p => [lat0 - p[1] / my, lon0 + p[0] / mx];
    const isPt = f => f.g.length === 1 && f.g[0].length === 1;
    const zc = { "Zona de alta amenaza": "#d32f2f", "Zona de moderada amenaza": "#f57c00", "Zona de baja amenaza": "#f4c430" };
    D.feats.forEach(f => {
      if (zc[f.l] && !isPt(f)) L.polygon(f.g.map(r => r.map(ll)), { color: zc[f.l], weight: 1, fillOpacity: .3 }).bindTooltip(f.l).addTo(map);
      else if (f.l === "Cursos de Agua") f.g.forEach(r => L.polyline(r.map(ll), { color: "#1565c0", weight: 2 }).addTo(map));
    });
    L.circleMarker(ll(D.dam), { radius: 8, color: "#fff", weight: 2, fillColor: "#0b7a8f", fillOpacity: 1 })
      .bindTooltip("Dique La Quebrada", { permanent: true, direction: "right" }).addTo(map);
  }

  // Radar
  let frames = [], layers = {}, idx = 0, playing = true, timer = null, host = "";
  const tEl = document.getElementById("rvTime"), playBtn = document.getElementById("rvPlay");
  const fmt = t => new Date(t * 1000).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  function layerFor(fr) {
    if (!layers[fr.path]) layers[fr.path] = L.tileLayer(host + fr.path + "/256/{z}/{x}/{y}/2/1_1.png", { opacity: 0, maxNativeZoom: 7, maxZoom: 15, zIndex: 5 });
    if (!map.hasLayer(layers[fr.path])) layers[fr.path].addTo(map);
    return layers[fr.path];
  }
  function show(i) {
    if (!frames.length) return;
    idx = (i + frames.length) % frames.length;
    frames.forEach((f, k) => { if (layers[f.path]) layers[f.path].setOpacity(k === idx ? .75 : 0); });
    layerFor(frames[idx]).setOpacity(.75);
    layerFor(frames[(idx + 1) % frames.length]); // precarga
    const last = idx === frames.length - 1;
    tEl.textContent = fmt(frames[idx].time) + (last ? " · último" : "");
  }
  function loop() { clearInterval(timer); if (playing) timer = setInterval(() => show(idx + 1), 700); }
  async function load() {
    try {
      const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
      const j = await r.json();
      host = j.host; const nf = (j.radar.past || []).concat(j.radar.nowcast || []);
      Object.keys(layers).forEach(p => { if (!nf.find(f => f.path === p)) { map.removeLayer(layers[p]); delete layers[p]; } });
      frames = nf; show(frames.length - 1); loop();
    } catch (e) { tEl.textContent = "Radar no disponible"; }
  }
  playBtn.addEventListener("click", () => { playing = !playing; playBtn.textContent = playing ? "Pausar" : "Animar"; playBtn.setAttribute("aria-pressed", playing); if (!playing) show(frames.length - 1); loop(); });
  document.getElementById("rvPrev").addEventListener("click", () => { playing = false; playBtn.textContent = "Animar"; loop(); show(idx - 1); });
  document.getElementById("rvNext").addEventListener("click", () => { playing = false; playBtn.textContent = "Animar"; loop(); show(idx + 1); });
  load(); setInterval(load, 5 * 60 * 1000);
})();
