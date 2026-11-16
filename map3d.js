/* Mapa 3D de amenaza de inundación — Río Ceballos.
   Relieve: AWS Terrain Tiles (Terrarium, z13). Capas: "Mapa de amenaza de inundación", Municipalidad de Río Ceballos. */
(function () {
  "use strict";
  const box = document.getElementById("map3d");
  const D = window.LQ_DATA;
  if (!box || !D) return;
  if (!window.THREE || !THREE.OrbitControls) {
    box.innerHTML = "<p class='note' style='padding:16px'>No se pudo cargar la librería 3D. Recargá la página.</p>";
    return;
  }
  const S = 0.1; // 1 unidad = 10 m
  const G = D.grid;
  const hs = (function () {
    const bin = atob(G.hb64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Uint16Array(u8.buffer);
  })();
  const elevAtIJ = (i, j) => hs[Math.max(0, Math.min(G.h - 1, j)) * G.w + Math.max(0, Math.min(G.w - 1, i))] / 2;
  function elevAt(x, y) { // metros locales (x este, y sur)
    const fi = (x + G.W / 2) / G.W * (G.w - 1), fj = (y + G.H / 2) / G.H * (G.h - 1);
    const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
    return elevAtIJ(i, j) * (1 - a) * (1 - b) + elevAtIJ(i + 1, j) * a * (1 - b) + elevAtIJ(i, j + 1) * (1 - a) * b + elevAtIJ(i + 1, j + 1) * a * b;
  }
  const isPt = f => f.g.length === 1 && f.g[0].length === 1;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";

  // ---------- Lago: relleno desde el pie del dique hacia el oeste ----------
  const LAKE_Z = 807;
  const lake = new Uint8Array(G.w * G.h);
  (function () {
    const di = Math.round((D.dam[0] + G.W / 2) / G.W * (G.w - 1)), dj = Math.round((D.dam[1] + G.H / 2) / G.H * (G.h - 1));
    let best = null;
    for (let j = dj - 8; j <= dj + 8; j++) for (let i = di - 22; i <= di; i++) { const h = elevAtIJ(i, j); if (!best || h < best[2]) best = [i, j, h]; }
    if (!best || best[2] > LAKE_Z) return;
    const st = [[best[0], best[1]]], R = 70;
    while (st.length) {
      const [i, j] = st.pop();
      if (i < 0 || j < 0 || i >= G.w || j >= G.h || Math.abs(i - di) > R || Math.abs(j - dj) > R) continue;
      if (i > di + 1) continue; // aguas abajo de la presa no
      const k = j * G.w + i; if (lake[k] || elevAtIJ(i, j) > LAKE_Z) continue;
      lake[k] = 1; st.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
    }
  })();

  // ---------- Capas ----------
  const LAYERS = [
    { id: "alta", label: "Zona de alta amenaza", match: "Zona de alta amenaza", kind: "zone", color: "#d32f2f", alpha: .55, on: true },
    { id: "mod", label: "Zona de moderada amenaza", match: "Zona de moderada amenaza", kind: "zone", color: "#f57c00", alpha: .45, on: true },
    { id: "baja", label: "Zona de baja amenaza", match: "Zona de baja amenaza", kind: "zone", color: "#f4c430", alpha: .35, on: true },
    { id: "rios", label: "Ríos y arroyos", match: "Cursos de Agua", kind: "line", color: "#1565c0", width: 5, on: true },
    { id: "esc", label: "Escorrentías", match: "Escorrentias", kind: "line", color: "#4fa3e0", width: 3, dash: [10, 7], on: true },
    { id: "vial", label: "Calles principales", match: "Red Vial", kind: "line", color: "#5d5d5d", width: 2, on: false },
    { id: "enc", label: "Puntos de encuentro", match: "Puntos de encuentro", kind: "point", color: "#2e7d32", on: true },
    { id: "cruce", label: "Puentes, vados y pasarelas", match: "Puentes, Vados y Pasarelas", kind: "point", color: "#ef6c00", on: true },
    { id: "edu", label: "Escuelas", match: "Institutos Educativos", kind: "point", color: "#7b1fa2", on: false },
  ];
  const state = { exag: 1.6, layers: {} };
  LAYERS.forEach(l => state.layers[l.id] = l.on);

  // ---------- Textura ----------
  const TW = 2400, TH = Math.round(TW * G.H / G.W);
  const tex = document.createElement("canvas"); tex.width = TW; tex.height = TH;
  const base = document.createElement("canvas"); base.width = G.w; base.height = G.h;
  (function drawBase() {
    const c = base.getContext("2d"), im = c.createImageData(G.w, G.h);
    const cell = G.W / (G.w - 1), sun = [-0.6, -0.6, 0.53]; // luz desde el noroeste
    const ramp = [[540, [116, 150, 96]], [700, [150, 168, 104]], [850, [176, 166, 112]], [1000, [160, 132, 96]], [1150, [140, 118, 100]], [1340, [196, 190, 182]]];
    const col = h => { for (let k = 1; k < ramp.length; k++) if (h <= ramp[k][0]) { const [h0, c0] = ramp[k - 1], [h1, c1] = ramp[k], t = (h - h0) / (h1 - h0); return c0.map((v, n) => v + (c1[n] - v) * t); } return ramp[ramp.length - 1][1]; };
    for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) {
      const dx = (elevAtIJ(i + 1, j) - elevAtIJ(i - 1, j)) / (2 * cell), dy = (elevAtIJ(i, j + 1) - elevAtIJ(i, j - 1)) / (2 * cell);
      const n = [-dx, dy, 1], L = Math.hypot(n[0], n[1], n[2]);
      const shade = Math.max(0, (n[0] * sun[0] + n[1] * -sun[1] + n[2] * sun[2]) / L);
      const k = (j * G.w + i) * 4;
      let c3 = col(elevAtIJ(i, j)); const f = 0.45 + 0.75 * shade;
      if (lake[j * G.w + i]) c3 = [40, 110, 150];
      im.data[k] = Math.min(255, c3[0] * f); im.data[k + 1] = Math.min(255, c3[1] * f); im.data[k + 2] = Math.min(255, c3[2] * f); im.data[k + 3] = 255;
    }
    c.putImageData(im, 0, 0);
  })();
  const px = (x, y) => [(x + G.W / 2) / G.W * TW, (y + G.H / 2) / G.H * TH];
  function drawTexture() {
    const c = tex.getContext("2d");
    c.imageSmoothingEnabled = true; c.drawImage(base, 0, 0, TW, TH);
    LAYERS.filter(l => l.kind !== "point" && state.layers[l.id]).sort((a, b) => (a.kind === "zone" ? 0 : 1) - (b.kind === "zone" ? 0 : 1)).forEach(l => {
      D.feats.filter(f => f.l === l.match && !isPt(f)).forEach(f => {
        if (l.kind === "zone") {
          c.beginPath();
          f.g.forEach(ring => { ring.forEach((p, i) => { const [u, v] = px(p[0], p[1]); i ? c.lineTo(u, v) : c.moveTo(u, v); }); c.closePath(); });
          c.globalAlpha = l.alpha; c.fillStyle = l.color; c.fill("evenodd"); c.globalAlpha = .95; c.lineWidth = 2.5; c.strokeStyle = l.color; c.stroke(); c.globalAlpha = 1;
          return;
        }
        f.g.forEach(ring => {
          c.beginPath(); ring.forEach((p, i) => { const [u, v] = px(p[0], p[1]); i ? c.lineTo(u, v) : c.moveTo(u, v); });
          c.setLineDash(l.dash || []); c.lineWidth = l.width; c.lineJoin = c.lineCap = "round"; c.strokeStyle = l.color; c.stroke(); c.setLineDash([]);
        });
      });
    });
    texture.needsUpdate = true;
  }

  // ---------- Escena ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 5, 20000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 120; controls.maxDistance = 3200;
  scene.add(new THREE.AmbientLight(0xffffff, .78));
  const sunL = new THREE.DirectionalLight(0xffffff, .5); sunL.position.set(-800, 900, -600); scene.add(sunL);

  const texture = new THREE.CanvasTexture(tex);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
  const segW = Math.floor((G.w - 1) / 2), segH = Math.floor((G.h - 1) / 2);
  const geo = new THREE.PlaneGeometry(G.W * S, G.H * S, segW, segH);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  const mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
  const yOf = h => (h - G.min) * S * state.exag;
  function applyHeights() {
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) { const x = pos.getX(k) / S, y = pos.getZ(k) / S; pos.setY(k, yOf(elevAt(x, y))); }
    pos.needsUpdate = true; geo.computeVertexNormals();
    markers.forEach(m => { m.position.y = yOf(elevAt(m.userData.x, m.userData.y)) + m.userData.lift; m.userData.stem && updateStem(m); });
  }

  // ---------- Marcadores ----------
  const markers = [];
  const dotCache = {};
  function dotTex(color, ring) {
    const key = color + ring; if (dotCache[key]) return dotCache[key];
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
    x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill();
    x.beginPath(); x.arc(32, 32, 20, 0, Math.PI * 2); x.fillStyle = color; x.fill();
    if (ring) { x.beginPath(); x.arc(32, 32, 8, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill(); }
    return dotCache[key] = new THREE.CanvasTexture(c);
  }
  function labelTex(text) {
    const c = document.createElement("canvas"), x = c.getContext("2d"); const f = "600 34px Archivo, system-ui, sans-serif";
    x.font = f; const w = Math.ceil(x.measureText(text).width) + 36; c.width = w; c.height = 56;
    x.font = f; x.fillStyle = "rgba(19,42,51,.88)"; x.beginPath(); x.roundRect ? x.roundRect(0, 0, w, 56, 10) : x.rect(0, 0, w, 56); x.fill();
    x.fillStyle = "#fff"; x.textBaseline = "middle"; x.fillText(text, 18, 29);
    const t = new THREE.CanvasTexture(c); t.userData = { aspect: w / 56 }; return t;
  }
  function updateStem(m) { const s = m.userData.stem, g = yOf(elevAt(m.userData.x, m.userData.y)); s.position.y = g + (m.position.y - g) / 2; s.scale.y = Math.max(.01, m.position.y - g); }
  function addMarker(layer, f, color, size, lift, label) {
    const [x, y] = f.g[0][0];
    const kind = /^Vado/i.test(f.n) ? "vado" : /^Puente/i.test(f.n) ? "puente" : /^Pasarela/i.test(f.n) ? "pasarela" : "";
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex(color, kind === "vado"), depthTest: true }));
    spr.scale.set(size, size, 1);
    spr.userData = { x, y, lift, layer, name: f.n || "", kind };
    spr.position.set(x * S, 0, y * S);
    scene.add(spr); markers.push(spr);
    if (label) {
      const t = labelTex(label), ls = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
      ls.scale.set(20 * t.userData.aspect, 20, 1); ls.center.set(.5, -0.6);
      ls.userData = { x, y, lift: lift, layer: "label" }; ls.position.set(x * S, 0, y * S); scene.add(ls); markers.push(ls);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, 1, 6), new THREE.MeshBasicMaterial({ color: 0x132a33 }));
      stem.position.set(x * S, 0, y * S); scene.add(stem); spr.userData.stem = stem;
    }
    return spr;
  }
  LAYERS.filter(l => l.kind === "point").forEach(l => {
    D.feats.filter(f => f.l === l.match && isPt(f)).forEach(f => {
      let color = l.color;
      if (l.id === "cruce") color = /^Vado/i.test(f.n) ? "#e65100" : /^Puente/i.test(f.n) ? "#546e7a" : "#8d6e63";
      addMarker(l.id, f, color, l.id === "enc" ? 15 : 12, 8, null);
    });
  });
  addMarker("dam", { g: [[D.dam]], n: "Dique La Quebrada" }, "#0b7a8f", 22, 45, "Dique La Quebrada");
  // etiqueta del pueblo: centro de los puntos de encuentro
  const town = (function () {
    const pts = D.feats.filter(f => f.l === "Puntos de encuentro" && isPt(f)).map(f => f.g[0][0]);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    addMarker("town", { g: [[[cx, cy]]], n: "Río Ceballos" }, "#132a33", 10, 60, "Río Ceballos");
    return [cx * S, cy * S];
  })();

  function applyVisibility() {
    markers.forEach(m => { const l = m.userData.layer; if (l in state.layers) m.visible = state.layers[l]; });
  }

  // ---------- Interacción ----------
  const info = document.getElementById("mapInfo");
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const NAMES = { enc: "Punto de encuentro", cruce: "Cruce sobre el río", edu: "Escuela", dam: "Presa", town: "Ciudad" };
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(markers.filter(m => m.visible && m.userData.layer !== "label"))[0];
    if (hit) {
      const u = hit.object.userData; const h = Math.round(elevAt(u.x, u.y));
      let extra = "";
      if (u.layer === "cruce") extra = u.kind === "vado" ? " · se corta con lluvia" : "";
      if (u.layer === "dam") extra = " · presa de hormigón de 47,8 m";
      info.innerHTML = "<b>" + (u.name || NAMES[u.layer]) + "</b><span>" + (NAMES[u.layer] || "") + (u.kind ? " · " + u.kind : "") + extra + " · " + h + " m s.n.m.</span>";
      return;
    }
    const t = ray.intersectObject(mesh)[0];
    if (t) {
      const x = t.point.x / S, y = t.point.z / S, h = Math.round(elevAt(x, y));
      const zone = zoneAt(x, y);
      info.innerHTML = "<b>" + (zone || "Fuera de las zonas de amenaza") + "</b><span>" + h + " m s.n.m.</span>";
    }
  }
  function inRing(x, y, ring) { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
  function zoneAt(x, y) {
    for (const z of ["Zona de alta amenaza", "Zona de moderada amenaza", "Zona de baja amenaza"]) {
      if (D.feats.some(f => f.l === z && !isPt(f) && f.g.filter(r => inRing(x, y, r)).length % 2 === 1)) return z;
    }
    return null;
  }
  let down = null;
  renderer.domElement.addEventListener("pointerdown", e => down = [e.clientX, e.clientY]);
  renderer.domElement.addEventListener("pointerup", e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) pick(e); down = null; });

  // ---------- Controles UI ----------
  const lg = document.getElementById("mapLayers");
  lg.innerHTML = LAYERS.map(l => {
    const sw = l.kind === "zone" ? "<i class='sw' style='background:" + l.color + ";opacity:.75'></i>" : l.kind === "line" ? "<i class='sw ln' style='background:" + l.color + "'></i>" : "<i class='sw pt' style='background:" + l.color + "'></i>";
    return "<label class='lyr'><input type='checkbox' id='lyr_" + l.id + "' " + (l.on ? "checked" : "") + ">" + sw + l.label + "</label>";
  }).join("");
  LAYERS.forEach(l => document.getElementById("lyr_" + l.id).addEventListener("change", e => { state.layers[l.id] = e.target.checked; if (l.kind === "point") applyVisibility(); else drawTexture(); render(); }));
  const ex = document.getElementById("mapExag"), exo = document.getElementById("mapExagOut");
  ex.addEventListener("input", () => { state.exag = +ex.value; exo.textContent = "×" + state.exag.toFixed(1); applyHeights(); render(); });
  const VIEWS = {
    ciudad: { p: [town[0] + 260, 330, town[1] + 330], t: [town[0] - 20, 20, town[1] - 40] },
    dique: { p: [D.dam[0] * S + 210, 230, D.dam[1] * S + 90], t: [D.dam[0] * S - 60, yOf(800), D.dam[1] * S] },
    cuenca: { p: [D.dam[0] * S + 650, 1100, D.dam[1] * S + 900], t: [D.dam[0] * S - 250, 0, D.dam[1] * S] },
    planta: { p: [0, 2300, 1], t: [0, 0, 0] },
  };
  function goto(v) { const V = VIEWS[v]; camera.position.set(...V.p); controls.target.set(...V.t); controls.update(); render(); }
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { document.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("on", x === b)); goto(b.dataset.view); }));

  // ---------- Render ----------
  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix(); render();
  }
  function setBg() { scene.background = new THREE.Color(css("--sky")); }
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(loop); }
  function loop() { raf = 0; const moving = controls.update(); renderer.render(scene, camera); if (moving) render(); }
  controls.addEventListener("change", render);
  new ResizeObserver(resize).observe(box);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { setBg(); render(); });
  new MutationObserver(() => { setBg(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  setBg(); drawTexture(); applyHeights(); applyVisibility(); goto("ciudad"); resize();
})();
