/* Río Ceballos – arroyo Saldán en 3D con la altura del agua medida por los sensores de APRHI (historial de 7 días). */
(function () {
  "use strict";
  const box = document.getElementById("r3Canvas"), R = window.LQ_RIO;
  if (!box || !R || !window.THREE || !THREE.OrbitControls) return;
  const $ = id => document.getElementById(id);
  const S = 0.1, TEX = 1.4; // 1 unidad = 10 m; exageración del relieve
  const G = R.grid;
  const hs = (() => { const b = atob(G.hb64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Uint16Array(u.buffer); })();
  const at = (i, j) => hs[Math.max(0, Math.min(G.h - 1, j)) * G.w + Math.max(0, Math.min(G.w - 1, i))] / 4;
  function elev(x, y) { const fi = (x + G.W / 2) / G.W * (G.w - 1), fj = (y + G.H / 2) / G.H * (G.h - 1), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j; return at(i, j) * (1 - a) * (1 - b) + at(i + 1, j) * a * (1 - b) + at(i, j + 1) * (1 - a) * b + at(i + 1, j + 1) * a * b; }
  const Y = h => (h - G.min) * S * TEX;
  const fmt = (x, d = 2) => (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fecha = t => new Date(t).toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
  const lon0 = R.center[0], lat0 = R.center[1], mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110950;
  const llToXY = (lon, lat) => [(lon - lon0) * mx, (lat0 - lat) * my];

  // ---------- Textura del relieve ----------
  const TW = 1600, TH = Math.round(TW * G.H / G.W), tex = document.createElement("canvas"); tex.width = TW; tex.height = TH;
  (function () {
    const base = document.createElement("canvas"); base.width = G.w; base.height = G.h;
    const c = base.getContext("2d"), im = c.createImageData(G.w, G.h), sun = [-.6, -.6, .53];
    const ramp = [[540, [126, 152, 104]], [650, [150, 166, 108]], [760, [172, 164, 116]], [900, [160, 136, 102]], [1170, [196, 190, 182]]];
    const col = h => { for (let k = 1; k < ramp.length; k++) if (h <= ramp[k][0]) { const [h0, c0] = ramp[k - 1], [h1, c1] = ramp[k], t = (h - h0) / (h1 - h0); return c0.map((v, n) => v + (c1[n] - v) * Math.max(0, t)); } return ramp[ramp.length - 1][1]; };
    for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * G.cell), dy = (at(i, j + 1) - at(i, j - 1)) / (2 * G.cell), L = Math.hypot(dx, dy, 1);
      const sh = Math.max(0, (-dx * sun[0] + -dy * -sun[1] * -1 + sun[2]) / L), f = .5 + .7 * sh, cc = col(at(i, j)), k = (j * G.w + i) * 4;
      im.data[k] = Math.min(255, cc[0] * f); im.data[k + 1] = Math.min(255, cc[1] * f); im.data[k + 2] = Math.min(255, cc[2] * f); im.data[k + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    const t = tex.getContext("2d"); t.drawImage(base, 0, 0, TW, TH);
    const px = (x, y) => [(x + G.W / 2) / G.W * TW, (y + G.H / 2) / G.H * TH];
    // Zonas de amenaza del mapa municipal
    const D = window.LQ_DATA;
    if (D) {
      const ml0 = D.center[0], mt0 = D.center[1], mmx = 111320 * Math.cos(mt0 * Math.PI / 180), mmy = 110950;
      const conv = p => px(...llToXY(ml0 + p[0] / mmx, mt0 - p[1] / mmy));
      const zc = { "Zona de alta amenaza": "rgba(211,47,47,.42)", "Zona de moderada amenaza": "rgba(239,125,0,.35)", "Zona de baja amenaza": "rgba(227,181,5,.28)" };
      D.feats.forEach(f => { if (!zc[f.l] || (f.g.length === 1 && f.g[0].length === 1)) return; t.beginPath(); f.g.forEach(r => { r.forEach((p, i) => { const [u, v] = conv(p); i ? t.lineTo(u, v) : t.moveTo(u, v); }); t.closePath(); }); t.fillStyle = zc[f.l]; t.fill("evenodd"); });
    }
    t.beginPath(); R.eje.forEach((p, i) => { const [u, v] = px(p[0], p[1]); i ? t.lineTo(u, v) : t.moveTo(u, v); });
    t.strokeStyle = "rgba(20,70,120,.55)"; t.lineWidth = 3; t.stroke();
  })();

  // ---------- Escena ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); box.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 2, 20000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = Math.PI * .47; controls.minDistance = 30; controls.maxDistance = 2600;
  scene.add(new THREE.AmbientLight(0xffffff, .8)); const sun = new THREE.DirectionalLight(0xffffff, .45); sun.position.set(-600, 800, -500); scene.add(sun);
  const ttex = new THREE.CanvasTexture(tex); ttex.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (THREE.sRGBEncoding) ttex.encoding = THREE.sRGBEncoding;
  const geo = new THREE.PlaneGeometry(G.W * S, G.H * S, Math.floor((G.w - 1) / 1.5), Math.floor((G.h - 1) / 1.5)); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; for (let k = 0; k < pos.count; k++) pos.setY(k, Y(elev(pos.getX(k) / S, pos.getZ(k) / S))); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: ttex })));

  // ---------- Río (cinta de agua) ----------
  const N = R.eje.length;
  const base = R.eje.map((p, i) => Math.max(elev(p[0], p[1]), R.fondo[i]) + 1.2);
  const nrm = R.eje.map((p, i) => { const a = R.eje[Math.max(0, i - 1)], b = R.eje[Math.min(N - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; });
  const wpos = new Float32Array(N * 2 * 3), wcol = new Float32Array(N * 2 * 3), idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const wgeo = new THREE.BufferGeometry(); wgeo.setAttribute("position", new THREE.BufferAttribute(wpos, 3)); wgeo.setAttribute("color", new THREE.BufferAttribute(wcol, 3)); wgeo.setIndex(idx);
  const water = new THREE.Mesh(wgeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: .92 })); scene.add(water);
  const ramp = [[0.05, [0x2f, 0x7f, 0xd0]], [0.25, [0x25, 0xb9, 0xc9]], [0.5, [0xf0, 0xa0, 0x20]], [1.0, [0xd0, 0x10, 0x2e]]];
  const colorFor = a => { if (a <= ramp[0][0]) return ramp[0][1]; for (let k = 1; k < ramp.length; k++) if (a <= ramp[k][0]) { const [a0, c0] = ramp[k - 1], [a1, c1] = ramp[k], t = (a - a0) / (a1 - a0); return c0.map((v, n) => v + (c1[n] - v) * t); } return ramp[ramp.length - 1][1]; };

  // ---------- Sensores ----------
  const sens = R.sensores.map((s, k) => {
    const p = R.eje[s.i], g = Y(base[s.i]);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1, 8), new THREE.MeshBasicMaterial({ color: 0x13232b })); pole.position.set(p[0] * S, g, p[1] * S); scene.add(pole);
    const cv = document.createElement("canvas"); cv.width = 360; cv.height = 96; const st = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, depthTest: false })); spr.scale.set(66, 17.6, 1); spr.center.set(.5, 0); scene.add(spr);
    return { ...s, p, g, pole, cv, st, spr };
  });
  const damSpr = (() => { const cv = document.createElement("canvas"); cv.width = 300; cv.height = 64; const x = cv.getContext("2d"); x.fillStyle = "rgba(11,122,132,.95)"; x.fillRect(0, 0, 300, 64); x.fillStyle = "#fff"; x.font = "600 30px Barlow Condensed, sans-serif"; x.textBaseline = "middle"; x.fillText("DIQUE LA QUEBRADA", 16, 34); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })); s.scale.set(52, 11, 1); s.center.set(.5, 0); s.position.set(R.dique[0] * S, Y(elev(R.dique[0], R.dique[1])) + 12, R.dique[1] * S); scene.add(s); return s; })();
  function label(s, h, an) {
    const x = s.cv.getContext("2d"), c = colorFor(an);
    x.clearRect(0, 0, 360, 96); x.fillStyle = "rgba(13,26,32,.92)"; x.fillRect(0, 0, 360, 96);
    x.fillStyle = `rgb(${c.map(Math.round).join(",")})`; x.fillRect(0, 0, 10, 96);
    x.fillStyle = "#cfe0e5"; x.font = "500 24px Public Sans, sans-serif"; x.fillText(s.nombre, 22, 34);
    x.fillStyle = "#fff"; x.font = "700 38px IBM Plex Mono, monospace"; x.fillText(h == null ? "sin dato" : fmt(h) + " m", 22, 78);
    if (h != null) { x.fillStyle = `rgb(${c.map(Math.round).join(",")})`; x.font = "600 26px IBM Plex Mono, monospace"; x.fillText((an >= 0 ? "+" : "") + Math.round(an * 100) + " cm", 220, 76); }
    s.st.needsUpdate = true;
  }

  // ---------- Datos y estado ----------
  let Hd = null, ti = 0, ex = 40, playing = false, timer = null, T0 = 0, n = 0, vel = 1;
  const PASO_MS = { 0.5: 600, 1: 300, 2: 150, 4: 70 }; // ms por cada 10 minutos de datos
  const KEYS = ["r98670", "r751", "r174264"];
  function valAt(k, i) { const a = Hd.m10.s[k] || []; for (let d = 0; d < 6; d++) { if (a[i - d] != null) return a[i - d]; } return null; }
  function draw() {
    if (!Hd) return;
    const vals = KEYS.map(k => valAt(k, ti)), normal = R.sensores.map(s => Hd.normal[s.id]);
    const an = vals.map((v, k) => v == null || normal[k] == null ? null : v - normal[k]);
    // nivel y anomalía a lo largo del eje, interpolados entre sensores
    const si = R.sensores.map(s => s.i);
    const interp = (arr, i) => { const ok = arr.map((v, k) => v == null ? null : [si[k], v]).filter(Boolean); if (!ok.length) return 0; if (i <= ok[0][0]) return ok[0][1]; for (let k = 1; k < ok.length; k++) if (i <= ok[k][0]) { const t = (i - ok[k - 1][0]) / (ok[k][0] - ok[k - 1][0]); return ok[k - 1][1] + (ok[k][1] - ok[k - 1][1]) * t; } return ok[ok.length - 1][1]; };
    for (let i = 0; i < N; i++) {
      const h = Math.max(0, interp(vals, i)), a = interp(an, i), w = 26 + 110 * Math.max(0, a), yy = Y(base[i]) + h * ex * S, p = R.eje[i], q = nrm[i], c = colorFor(a).map(v => v / 255);
      for (let s = 0; s < 2; s++) { const sg = s ? 1 : -1, o = (i * 2 + s) * 3; wpos[o] = (p[0] + q[0] * sg * w / 2) * S; wpos[o + 1] = yy; wpos[o + 2] = (p[1] + q[1] * sg * w / 2) * S; wcol[o] = c[0]; wcol[o + 1] = c[1]; wcol[o + 2] = c[2]; }
    }
    wgeo.attributes.position.needsUpdate = true; wgeo.attributes.color.needsUpdate = true; wgeo.computeBoundingSphere();
    sens.forEach((s, k) => {
      const h = vals[k] || 0, top = s.g + h * ex * S + 6;
      s.pole.scale.y = Math.max(.1, top - s.g); s.pole.position.y = s.g + (top - s.g) / 2; s.spr.position.set(s.p[0] * S, top + 1, s.p[1] * S);
      label(s, vals[k], an[k] || 0);
    });
    const t = T0 + ti * 6e5;
    $("r3When").textContent = fecha(t) + (ti >= n - 1 ? " · último dato" : "");
    $("r3Vals").innerHTML = R.sensores.map((s, k) => `<span><i style="background:rgb(${colorFor(an[k] || 0).map(Math.round).join(",")})"></i>${s.nombre}: <b>${vals[k] == null ? "–" : fmt(vals[k]) + " m"}</b>${an[k] == null ? "" : ` <em>${an[k] >= 0 ? "+" : ""}${Math.round(an[k] * 100)} cm</em>`}</span>`).join("");
    $("r3Time").value = ti;
    const cur = $("r3Spark").querySelector(".cur"); if (cur) { cur.setAttribute("x1", ti); cur.setAttribute("x2", ti); }
    render();
  }
  function spark() {
    const sv = $("r3Spark"); sv.setAttribute("viewBox", `0 0 ${n - 1} 100`);
    const cols = ["var(--chart-in)", "var(--chart-lvl)", "var(--sediment)"];
    let s = `<line x1="0" x2="${n - 1}" y1="${100 - 50}" y2="${100 - 50}" stroke="var(--bad)" stroke-dasharray="6 6" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".6"/>`;
    KEYS.forEach((k, j) => { const nr = Hd.normal[R.sensores[j].id]; let d = "", pen = false; (Hd.m10.s[k] || []).forEach((v, i) => { if (v == null) { pen = false; return; } const yy = 100 - Math.max(-10, Math.min(98, (v - nr) * 100)); d += (pen ? "L" : "M") + i + "," + yy.toFixed(1); pen = true; }); s += `<path d="${d}" fill="none" stroke="${cols[j]}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`; });
    s += `<line class="cur" x1="${ti}" x2="${ti}" y1="0" y2="100" stroke="var(--ink)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    sv.innerHTML = s;
    $("r3Range").textContent = new Date(T0).toLocaleDateString("es-AR", { day: "numeric", month: "numeric" }) + " → " + new Date(T0 + (n - 1) * 6e5).toLocaleDateString("es-AR", { day: "numeric", month: "numeric" });
  }
  function setData(H) {
    Hd = H; T0 = Date.parse(H.m10.inicio); n = (H.m10.s.r98670 || []).length; const keep = ti && ti < n - 1;
    $("r3Time").max = n - 1; if (!keep) ti = n - 1;
    const evb = $("r3Events"); evb.querySelectorAll("[data-r3ev]").forEach(b => b.remove());
    (H.eventos || []).filter(e => Date.parse(e.inicio) >= T0).slice(0, 4).forEach(e => {
      const p = e.picos.find(x => x.id === 98670) || e.picos[0]; if (!p) return;
      const b = document.createElement("button"); b.dataset.r3ev = p.hora; b.textContent = "Crecida " + new Date(p.hora).toLocaleDateString("es-AR", { day: "numeric", month: "numeric" }); evb.appendChild(b);
    });
    spark(); draw();
  }
  function irA(t) { if (!Hd) return; stop(); const i = Math.round((t - T0) / 6e5); ti = Math.max(0, Math.min(n - 1, i - 24)); draw(); play(Math.min(n - 1, i + 48)); }
  function play(until) {
    playing = true; $("r3Play").textContent = "❚❚ Pausar"; $("r3Play").setAttribute("aria-pressed", "true");
    clearInterval(timer); const end = until != null ? until : n - 1; if (ti >= end) ti = Math.max(0, end - 300);
    timer = setInterval(() => { ti = Math.min(end, ti + 1); draw(); if (ti >= end) stop(); }, PASO_MS[vel] || 300);
  }
  function stop() { playing = false; clearInterval(timer); $("r3Play").textContent = "▶ Reproducir"; $("r3Play").setAttribute("aria-pressed", "false"); }
  window.LQ_RIO3D = { irA };
  document.querySelectorAll("[data-r3vel]").forEach(b => b.addEventListener("click", () => {
    vel = +b.dataset.r3vel; document.querySelectorAll("[data-r3vel]").forEach(x => x.classList.toggle("on", x === b));
    if (playing) { const end = +$("r3Time").max; stop(); play(end); }
  }));
  $("r3Play").addEventListener("click", () => playing ? stop() : play());
  $("r3Time").addEventListener("input", e => { stop(); ti = +e.target.value; draw(); });
  $("r3Ex").addEventListener("input", e => { ex = +e.target.value; $("r3ExOut").textContent = "×" + ex; draw(); });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-r3ev],[data-r3now]"); if (!b || !$("r3Events").contains(b)) return;
    $("r3Events").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    if (b.dataset.r3ev) irA(Date.parse(b.dataset.r3ev)); else { stop(); ti = n - 1; draw(); }
  });

  // ---------- Vistas ----------
  function view(v) {
    if (v === "todo") { camera.position.set(330, 520, 760); controls.target.set(-10, 20, 40); }
    else { const s = sens[+v]; camera.position.set(s.p[0] * S + 140, s.g + 130, s.p[1] * S + 190); controls.target.set(s.p[0] * S, s.g, s.p[1] * S); }
    controls.update(); render();
  }
  document.querySelectorAll("[data-r3view]").forEach(b => b.addEventListener("click", () => { document.querySelectorAll("[data-r3view]").forEach(x => x.classList.toggle("on", x === b)); view(b.dataset.r3view); }));

  // ---------- Render ----------
  let raf = 0; function render() { if (!raf) raf = requestAnimationFrame(loop); }
  function loop() { raf = 0; const mv = controls.update(); renderer.render(scene, camera); if (mv) render(); }
  function bg() { scene.background = new THREE.Color(css("--sky")); render(); }
  controls.addEventListener("change", render);
  new ResizeObserver(() => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; camera.aspect = w / h; camera.updateProjectionMatrix(); render(); }).observe(box);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bg);
  bg(); view("todo");
  if (window.LQ_HIST) setData(window.LQ_HIST);
  document.addEventListener("lq-historia", e => setData(e.detail));
})();
