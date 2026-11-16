/* Cámara Orus de Puente San José: última foto, secuencia de la última hora y último video, con altura y caudal. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  if (!$("camara")) return;
  const fmt = (x, d = 2) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hora = t => new Date(t).toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hace = t => { const m = Math.round((Date.now() - Date.parse(t)) / 6e4); return m < 1 ? "recién" : m < 60 ? "hace " + m + " min" : m < 1440 ? "hace " + Math.round(m / 60) + " h" : "hace " + Math.round(m / 1440) + " días"; };
  let C = null, modo = "foto", seqTimer = null, seqI = 0, ver = Date.now();

  function mostrar(src, cuando, que) {
    $("camEmpty").hidden = true; $("camVid").hidden = true; $("camVid").pause();
    const img = $("camImg"); img.hidden = false; img.src = src + "?v=" + ver;
    $("camWhen").textContent = cuando; $("camWhat").textContent = que;
  }
  function vista() {
    clearInterval(seqTimer);
    document.querySelectorAll("[data-cam]").forEach(b => b.classList.toggle("on", b.dataset.cam === modo));
    if (!C || !C.configurado || C.error) return;
    const fotos = C.fotos || [];
    if (modo === "video" && C.video) {
      $("camImg").hidden = true; $("camEmpty").hidden = true;
      const v = $("camVid"); v.hidden = false; if (!v.src.includes(C.video.archivo)) v.src = C.video.archivo + "?v=" + ver; v.play().catch(() => {});
      $("camWhen").textContent = hora(C.video.t) + " · video de 30 s"; $("camWhat").textContent = "Altura " + fmt(C.video.nivel) + " m · caudal " + fmt(C.video.caudal, 1) + " m³/s";
      return;
    }
    if (modo === "video") { $("camWhat").textContent = "No hay videos recientes: la cámara graba cuando el río sube."; }
    if (!fotos.length) { $("camEmpty").hidden = false; $("camImg").hidden = true; return; }
    if (modo === "secuencia" && fotos.length > 1) {
      const orden = [...fotos].reverse(); seqI = 0;
      const paso = () => { const f = orden[seqI % orden.length]; mostrar(f.archivo, hora(f.t), "Altura " + fmt(f.nivel) + " m · caudal " + fmt(f.caudal, 1) + " m³/s · " + (seqI % orden.length + 1) + "/" + orden.length); marcar(f.archivo); seqI++; };
      paso(); seqTimer = setInterval(paso, 1200); return;
    }
    const f = fotos[0]; mostrar(f.archivo, hora(f.t), "Altura " + fmt(f.nivel) + " m · caudal " + fmt(f.caudal, 1) + " m³/s"); marcar(f.archivo);
  }
  function marcar(a) { document.querySelectorAll("#camStrip button").forEach(b => b.classList.toggle("on", b.dataset.f === a)); }
  function grafico() {
    const el = $("camChart"), s = (C.serie || []).filter(x => x[1] != null);
    if (s.length < 2) { el.innerHTML = ""; return; }
    const W = Math.max(260, el.clientWidth), H = 150, m = { l: 36, r: 40, t: 14, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const t0 = Date.parse(s[0][0]), t1 = Date.parse(s[s.length - 1][0]);
    const lv = s.map(x => x[1]), q = s.map(x => x[2]).filter(v => v != null);
    const lo = Math.min(...lv), hi = Math.max(...lv) + .02, qh = q.length ? Math.max(...q) * 1.1 : 1;
    const x = t => m.l + (Date.parse(t) - t0) / (t1 - t0 || 1) * iw, y = v => m.t + ih - (v - lo) / (hi - lo || .1) * ih, yq = v => m.t + ih - v / qh * ih;
    let p = "", pq = ""; s.forEach((r, i) => { p += (i ? "L" : "M") + x(r[0]).toFixed(1) + "," + y(r[1]).toFixed(1); if (r[2] != null) pq += (pq ? "L" : "M") + x(r[0]).toFixed(1) + "," + yq(r[2]).toFixed(1); });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Altura y caudal en las últimas 48 horas"><text x="${m.l}" y="10">altura (m) y caudal (m³/s), 48 h</text><line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="var(--line)"/><text x="${m.l - 4}" y="${y(hi) + 4}" text-anchor="end">${fmt(hi)}</text><text x="${m.l - 4}" y="${y(lo) + 4}" text-anchor="end">${fmt(lo)}</text>${pq ? `<path d="${pq}" fill="none" stroke="var(--sediment)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${W - m.r + 4}" y="${yq(qh / 1.1) + 4}" style="fill:var(--sediment)">${fmt(qh / 1.1, 0)}</text>` : ""}<path d="${p}" fill="none" stroke="var(--water)" stroke-width="2"/></svg>`;
  }
  function render() {
    const sub = $("camSub"), dot = $("camDot");
    if (!C || !C.configurado) { sub.textContent = "La cámara todavía no está conectada: falta cargar las credenciales de Orus en el robot."; dot.className = "dot"; $("camEmpty").hidden = false; $("camEmpty").textContent = "Cámara pendiente de conexión."; return; }
    if (C.error) { sub.textContent = "No se pudo leer Orus: " + C.error; dot.className = "dot warn"; return; }
    const u = C.ultimo, fresca = !C.demo && u && Date.now() - Date.parse(u.t) < 40 * 6e4;
    dot.className = "dot " + (C.demo ? "warn" : fresca ? "ok pulse" : "warn");
    const banner = $("camDemo");
    if (C.demo) { if (banner) banner.hidden = false; }
    else if (banner) banner.hidden = true;
    sub.textContent = (C.demo ? "DEMO con datos de prueba de Orus (" + (C.estacion ? C.estacion.nombre : "") + ", no es el río real) · " : (C.estacion ? C.estacion.nombre + (C.estacion.rio ? " · " + C.estacion.rio : "") : "")) + (u ? "última imagen " + hace(u.t) : "") + (C.estacion && C.estacion.advertencia ? " · " + C.estacion.advertencia : "");
    const an = u && C.normal != null && u.nivel != null ? u.nivel - C.normal : null, c = an == null ? "ok" : an >= 1 ? "crit" : an >= .5 ? "bad" : an >= .25 ? "warn" : "ok";
    $("camRo").innerHTML = [
      { k: "Altura del agua", v: u ? fmt(u.nivel) + "<small>m</small>" : "–", s: an == null ? "" : (an >= 0 ? "+" : "") + Math.round(an * 100) + " cm sobre lo habitual de 48 h", c },
      { k: "Caudal", v: u && u.caudal != null ? fmt(u.caudal, 1) + "<small>m³/s</small>" : "–", s: u && u.subida30 != null ? (u.subida30 >= 0 ? "+" : "") + Math.round(u.subida30 * 100) + " cm en 30 min" : "", c: "ok" },
    ].map(t => `<div class="ro" data-lvl="${t.c}"><span class="k"><span class="flag"></span>${t.k}</span><span class="v">${t.v}</span><span class="s">${t.s}</span></div>`).join("");
    $("camStrip").innerHTML = (C.fotos || []).map(f => `<button data-f="${f.archivo}" title="${hora(f.t)}"><img src="${f.archivo}?v=${ver}" alt="Foto de las ${hora(f.t)}" loading="lazy"><span>${new Date(f.t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span></button>`).join("");
    document.querySelector('[data-cam="video"]').disabled = !C.video;
    grafico(); vista();
  }
  document.querySelectorAll("[data-cam]").forEach(b => b.addEventListener("click", () => { modo = b.dataset.cam; vista(); }));
  $("camStrip").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (!b) return; modo = "foto"; clearInterval(seqTimer); const f = C.fotos.find(x => x.archivo === b.dataset.f); document.querySelectorAll("[data-cam]").forEach(x => x.classList.toggle("on", x.dataset.cam === "foto")); mostrar(f.archivo, hora(f.t), "Altura " + fmt(f.nivel) + " m · caudal " + fmt(f.caudal, 1) + " m³/s"); marcar(f.archivo); });
  async function cargar() {
    try { const r = await fetch("data/camara/camara.json?t=" + Date.now(), { cache: "no-store" }); C = r.ok ? await r.json() : null; } catch (e) { C = null; }
    ver = Date.now(); render();
  }
  cargar(); setInterval(cargar, 60 * 1000);
})();
