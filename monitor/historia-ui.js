/* Historial: gráficos de río, lluvia y dique, resumen en palabras y tabla de crecidas. Lee data/historia.json. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  if (!$("historial")) return;
  const RIOS = [
    { id: 98670, k: "r98670", nombre: "Puente Amuchástegui", col: "var(--chart-in)" },
    { id: 751, k: "r751", nombre: "Puente San José", col: "var(--chart-lvl)" },
    { id: 174264, k: "r174264", nombre: "Arroyo Saldán (Unquillo)", col: "var(--sediment)" },
  ];
  const fmt = (x, d = 1) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const dia = t => new Date(t).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" });
  const hora = t => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fecha = t => new Date(t).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let H = null, rng = 7, rmode = "anom";

  function serie(key, dias) {
    const useM = dias <= 7 && H.m10.s[key];
    const src = useM ? H.m10 : H.h, a = src.s[key] || [], t0 = Date.parse(src.inicio), dt = src.paso * 1000, from = Date.now() - dias * 864e5;
    const out = []; a.forEach((v, i) => { const t = t0 + i * dt; if (t >= from) out.push([t, v]); });
    return out;
  }
  function lluviaCuenca(dias) {
    const useM = dias <= 1, src = useM ? H.m10 : H.h, t0 = Date.parse(src.inicio), dt = src.paso * 1000, from = Date.now() - dias * 864e5;
    const a = src.s.p58 || [], b = src.s.p93 || [];
    const out = []; a.forEach((_, i) => { const t = t0 + i * dt; if (t < from) return; const v = [a[i], b[i]].filter(x => x != null); out.push([t, v.length ? v.reduce((x, y) => x + y, 0) / v.length : null]); });
    return { pts: out, paso: useM ? "10 min" : "hora" };
  }

  // ---------- Gráfico de serie temporal (SVG) ----------
  function chart(el, o) {
    const W = Math.max(320, el.clientWidth), Hh = el.classList.contains("short") ? 170 : 240;
    const m = { l: 46, r: o.right ? 46 : 12, t: 12, b: 26 }, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    const all = o.series.flatMap(s => s.pts).concat(o.bars ? o.bars.pts : []).filter(p => p[1] != null);
    const t1 = Date.now(), t0 = t1 - o.dias * 864e5;
    let lo = o.yMin != null ? o.yMin : Math.min(...all.map(p => p[1]), ...(o.refs || []).map(r => r.v));
    let hi = o.yMax != null ? o.yMax : Math.max(...all.map(p => p[1]), ...(o.refs || []).filter(r => r.show !== false).map(r => r.v));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * .08 || .1; lo = o.yMin != null ? lo : lo - pad; hi += pad;
    const x = t => m.l + (t - t0) / (t1 - t0) * iw, y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
    const step = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(step))), st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= step);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" role="img" aria-label="${o.aria || ""}"><defs><pattern id="gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--muted)" opacity=".28"/></pattern></defs>`;
    for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-2)"/><text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, st < 1 ? (st < .1 ? 2 : 1) : 0)}</text>`;
    // eje de tiempo: un tick por día (o cada 4 h en 24 h)
    const tickH = o.dias <= 1 ? 4 * 36e5 : o.dias <= 7 ? 864e5 : 5 * 864e5;
    const d0 = new Date(t0); d0.setHours(0, 0, 0, 0);
    const every = Math.max(1, Math.ceil(64 / (iw * tickH / (t1 - t0)))); let tk = 0;
    for (let t = d0.getTime(); t <= t1; t += tickH) { if (t < t0) continue; if (tk++ % every) continue; s += `<line x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--line-2)"/><text x="${x(t) + 3}" y="${Hh - 8}">${o.dias <= 1 ? hora(t) : dia(t)}</text>`; }
    (o.refs || []).forEach(r => { if (r.v < lo || r.v > hi) return; s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(r.v)}" y2="${y(r.v)}" stroke="${r.col}" stroke-dasharray="5 4" stroke-width="1.3"/><text x="${W - m.r - 4}" y="${y(r.v) - 4}" text-anchor="end" style="fill:${r.col}">${r.label}</text>`; });
    if (o.gaps) { const gw = iw / ((t1 - t0) / o.gaps.dt); o.gaps.pts.forEach(t => { if (t < t0) return; s += `<rect x="${x(t) - gw}" y="${m.t}" width="${Math.max(1, gw)}" height="${ih}" fill="url(#gap)"/>`; }); }
    if (o.bars) { const bw = Math.max(1, iw / ((t1 - t0) / o.bars.dt) - 1); o.bars.pts.forEach(p => { if (p[1] == null || p[1] <= 0) return; s += `<rect x="${x(p[0]) - bw}" y="${y(p[1])}" width="${bw}" height="${y(lo) - y(p[1])}" fill="${o.bars.col}"/>`; }); }
    o.series.forEach((se, si) => {
      let d = "", pen = false;
      se.pts.forEach(p => { if (p[1] == null) { pen = false; return; } d += (pen ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1); pen = true; });
      s += `<path d="${d}" fill="none" stroke="${se.col}" stroke-width="${se.w || 1.8}" stroke-linejoin="round"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""}/>`;
      if (se.peak) { const pk = se.pts.reduce((a, p) => p[1] != null && (!a || p[1] > a[1]) ? p : a, null); if (pk) s += `<circle cx="${x(pk[0])}" cy="${y(pk[1])}" r="3.5" fill="${se.col}"/><text x="${Math.min(W - m.r - 4, x(pk[0]) + 6)}" y="${Math.max(m.t + 10, y(pk[1]) - 6 - si * 13)}" text-anchor="${x(pk[0]) > W - 120 ? "end" : "start"}" style="fill:${se.col};font-weight:600">${se.peakLabel(pk, W < 560)}</text>`; }
    });
    if (o.right) {
      const rmax = Math.max(1, ...o.right.pts.map(p => p[1] || 0)) * 1.08, yr = v => m.t + ih - v / rmax * ih;
      let d = ""; o.right.pts.forEach((p, i) => d += (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + yr(p[1]).toFixed(1));
      s += `<path d="${d}" fill="none" stroke="${o.right.col}" stroke-width="1.6"/><text x="${W - m.r + 6}" y="${yr(rmax / 1.08) + 3.5}">${fmt(rmax / 1.08, 0)}</text><text x="${W - m.r + 6}" y="${yr(0) + 3.5}">0</text>`;
    }
    s += `<text x="${m.l}" y="${m.t - 2}" style="fill:var(--muted)">${o.unit}</text>`;
    s += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--ink)" stroke-width="1" opacity="0"/></svg><div class="tip" hidden></div>`;
    el.innerHTML = s;
    // Cursor: valores de todas las series en la hora señalada
    const svg = el.querySelector("svg"), xh = el.querySelector(".xh"), tip = el.querySelector(".tip");
    const near = (pts, t) => { let b = null, bd = Infinity; for (const p of pts) { const dd = Math.abs(p[0] - t); if (dd < bd) { bd = dd; b = p; } } return b; };
    const move = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left, sx = px / r.width * W;
      if (sx < m.l || sx > W - m.r) { xh.setAttribute("opacity", 0); tip.hidden = true; return; }
      const t = t0 + (sx - m.l) / iw * (t1 - t0);
      xh.setAttribute("x1", sx); xh.setAttribute("x2", sx); xh.setAttribute("opacity", .35);
      const rows = o.series.map(se => { const p = near(se.pts, t); return p && p[1] != null ? `<span><i style="background:${se.col}"></i>${se.name}: <b>${o.fmtV(p[1])}</b></span>` : ""; }).join("");
      const bar = o.bars ? near(o.bars.pts, t) : null, rp = o.right ? near(o.right.pts, t) : null;
      tip.innerHTML = `<b>${fecha(t)}</b>${rows}${bar ? `<span>Lluvia: <b>${fmt(bar[1] || 0, 1)} mm</b></span>` : ""}${rp ? `<span>Acumulado: <b>${fmt(rp[1], 0)} mm</b></span>` : ""}`;
      tip.hidden = false; tip.style.left = Math.min(r.width - 190, Math.max(0, px + 12)) + "px";
    };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", () => { xh.setAttribute("opacity", 0); tip.hidden = true; });
  }

  function render() {
    if (!H) return;
    document.querySelectorAll("[data-rng]").forEach(b => b.classList.toggle("on", +b.dataset.rng === rng));
    document.querySelectorAll("[data-rmode]").forEach(b => b.classList.toggle("on", b.dataset.rmode === rmode));
    // Río
    const anom = rmode === "anom";
    const rs = RIOS.map(r => {
      const n = H.normal[r.id], pts = serie(r.k, rng).map(p => [p[0], p[1] == null ? null : anom ? +(p[1] - n).toFixed(2) : p[1]]);
      return { name: r.nombre, col: r.col, pts, peak: true, peakLabel: (p, corto) => (anom ? (p[1] >= 0 ? "+" : "") : "") + fmt(p[1], 2) + " m" + (corto ? "" : " · " + fecha(p[0])) };
    });
    chart($("chRio"), { dias: rng, series: rs, unit: anom ? "m sobre lo normal" : "m de altura", yMin: anom ? -0.2 : null,
      refs: anom ? [{ v: .5, label: "Alerta +0,5 m", col: "var(--bad)" }, { v: 1, label: "Emergencia +1 m", col: "var(--crit)", show: false }] : [],
      fmtV: v => (anom && v >= 0 ? "+" : "") + fmt(v, 2) + " m", aria: "Altura del río en los tres sensores" });
    $("lgRio").innerHTML = RIOS.map(r => `<span><i style="background:${r.col}"></i>${r.nombre} · normal ${fmt(H.normal[r.id], 2)} m</span>`).join("");
    $("hRioNote").textContent = anom ? "Diferencia entre la altura medida y la normal de cada sensor (mediana de 7 días). La línea punteada es el umbral de Alerta (+0,5 m); el de Emergencia es +1 m." : "Altura del agua sobre el fondo del cauce en cada sensor, como la mide APRHI.";
    // Lluvia
    const lc = lluviaCuenca(rng); let acc = 0; const cum = lc.pts.map(p => [p[0], acc += p[1] || 0]);
    const dtR = lc.paso === "hora" ? 36e5 : 6e5;
    chart($("chRain"), { dias: rng, series: [], gaps: { pts: lc.pts.filter(p => p[1] == null).map(p => p[0]), dt: dtR }, bars: { pts: lc.pts, col: "var(--water)", dt: dtR }, right: { pts: cum, col: "var(--ink)" }, unit: "mm por " + lc.paso, yMin: 0, fmtV: v => fmt(v, 1) + " mm", aria: "Lluvia en la cuenca" });
    $("hRainTot").textContent = fmt(acc, 0) + " mm en " + (rng === 1 ? "24 h" : rng + " días");
    // Resumen por día (hora local de Córdoba): total, días sin lluvia y horas sin dato
    {
      const src = H.h, t0d = Date.parse(src.inicio), fromD = Date.now() - rng * 864e5, dias = new Map();
      (src.s.p58 || []).forEach((_, i) => {
        const t = t0d + i * 36e5; if (t < fromD) return;
        const k = new Date(t - 3 * 36e5).toISOString().slice(0, 10), v = [src.s.p58[i], src.s.p93[i]].filter(x => x != null);
        const d = dias.get(k) || { mm: 0, con: 0, tot: 0 }; d.tot++; if (v.length) { d.con++; d.mm += v.reduce((a, b) => a + b, 0) / v.length; } dias.set(k, d);
      });
      const arr = [...dias.entries()];
      const secos = arr.filter(([, d]) => d.con > 0 && d.mm < 0.5).length, huecos = arr.reduce((a, [, d]) => a + (d.tot - d.con), 0), totH = arr.reduce((a, [, d]) => a + d.tot, 0);
      $("rainDays").innerHTML = arr.map(([k, d]) => {
        const lab = new Date(k + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric" });
        const cls = d.con === 0 ? "nd" : d.mm >= 20 ? "wet3" : d.mm >= 5 ? "wet2" : d.mm >= 0.5 ? "wet1" : "dry";
        return `<div class="rd ${cls}" title="${lab}: ${d.con ? fmt(d.mm, 1) + " mm" : "sin datos"}${d.con < d.tot ? " · " + (d.tot - d.con) + " h sin dato" : ""}"><span>${lab}</span><b>${d.con === 0 ? "s/d" : d.mm < 0.5 ? "0" : fmt(d.mm, d.mm < 10 ? 1 : 0)}</b>${d.con < d.tot && d.con > 0 ? "<i>" + (d.tot - d.con) + " h s/d</i>" : ""}</div>`;
      }).join("");
      $("rainCover").textContent = (secos ? secos + (secos === 1 ? " día sin lluvia" : " días sin lluvia") + " (0 mm medidos, no falta de datos). " : "") + (huecos ? "Faltan datos en " + huecos + " de " + totH + " horas (rayado gris)." : "Datos completos: los pluviómetros reportaron todas las horas.");
    }
    // Tabla por estación
    const from = Date.now() - rng * 864e5, t0h = Date.parse(H.h.inicio);
    const est = [["p58", "Cuenca Alta Colanchanga", true], ["p93", "Los Hornillos", true], ["p67", "La Estancita (Salsipuedes)"], ["p390", "Aº Los Quebrachitos (Unquillo)"]];
    $("tbRain").innerHTML = "<thead><tr><th>Estación</th><th>Total</th><th>Hora más lluviosa</th><th>Cuándo</th></tr></thead><tbody>" + est.map(([k, n, c]) => {
      let tot = 0, mx = 0, mt = null; (H.h.s[k] || []).forEach((v, i) => { const t = t0h + i * 36e5; if (t < from || v == null) return; tot += v; if (v > mx) { mx = v; mt = t; } });
      return `<tr${c ? " class='hl'" : ""}><td>${n}${c ? " <span class='muted'>· cuenca</span>" : ""}</td><td class="num">${fmt(tot, 1)} mm</td><td class="num">${fmt(mx, 1)} mm</td><td class="muted">${mt ? fecha(mt) : "–"}</td></tr>`;
    }).join("") + "</tbody>";
    // Dique
    const dq = serie("dique", rng);
    chart($("chDam"), { dias: rng, series: [{ name: "Dique", col: "var(--water)", pts: dq, w: 2.2 }], unit: "m respecto del vertedero", refs: [{ v: 0, label: "vertedero", col: "var(--chart-out)", show: false }], fmtV: v => (v > 0 ? "+" : "") + fmt(v, 2) + " m", aria: "Nivel del dique" });
    const last = [...dq].reverse().find(p => p[1] != null), first = dq.find(p => p[1] != null);
    $("hDamNow").textContent = last ? fmt(last[1], 2) + " m" + (first ? " (" + (last[1] - first[1] >= 0 ? "+" : "") + fmt((last[1] - first[1]) * 100, 0) + " cm)" : "") : "";
    // Resumen en palabras
    const ev = (H.eventos || []).find(e => Date.parse(e.inicio) >= from);
    let txt = `En ${rng === 1 ? "las últimas 24 horas" : "los últimos " + rng + " días"} llovieron ${fmt(acc, 0)} mm en la cuenca del dique. `;
    if (ev) {
      const a = ev.picos.find(p => p.id === 98670), u = ev.picos.find(p => p.id === 174264);
      txt += `La mayor crecida fue el ${new Date(ev.inicio).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "numeric" })}: `;
      if (a) txt += `en Puente Amuchástegui el río subió ${fmt(a.subida * 100, 0)} cm sobre lo normal (pico de ${fmt(a.pico, 2)} m a las ${hora(a.hora)})`;
      if (a && u) { const lag = Math.round((Date.parse(u.hora) - Date.parse(a.hora)) / 6e4); txt += lag > 0 ? `, y ${lag >= 60 ? fmt(lag / 60, 1) + " h" : lag + " min"} después la crecida llegó a Unquillo con ${fmt(u.subida * 100, 0)} cm.` : `; en Unquillo subió ${fmt(u.subida * 100, 0)} cm.`; }
      else txt += ".";
    } else txt += "El río no tuvo crecidas en ese período.";
    $("hSummary").textContent = txt;
    // Crecidas
    $("tbEvents").innerHTML = "<thead><tr><th>Fecha</th><th>Lluvia en la cuenca</th>" + RIOS.map(r => `<th>${r.nombre}</th>`).join("") + "<th>Tiempo de viaje</th><th></th></tr></thead><tbody>" + ((H.eventos || []).map(e => {
      const cells = RIOS.map(r => { const p = e.picos.find(x => x.id === r.id); return p ? `<td class="num">+${fmt(p.subida * 100, 0)} cm<br><span class="muted">${fmt(p.pico, 2)} m · ${hora(p.hora)}</span></td>` : "<td>–</td>"; }).join("");
      const a = e.picos.find(p => p.id === 98670), u = e.picos.find(p => p.id === 174264), lag = a && u ? Math.round((Date.parse(u.hora) - Date.parse(a.hora)) / 6e4) : null;
      const peakT = a ? a.hora : e.inicio;
      return `<tr><td>${new Date(e.inicio).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" })}</td><td class="num">${e.lluvia} mm</td>${cells}<td class="num">${lag != null && lag > 0 ? (lag >= 60 ? fmt(lag / 60, 1) + " h" : lag + " min") : "–"}</td><td><button class="small-btn" data-ver3d="${peakT}">Ver en 3D</button></td></tr>`;
    }).join("") || "<tr><td colspan='7' class='muted'>Sin crecidas en los últimos 30 días.</td></tr>") + "</tbody>";
  }
  document.querySelectorAll("[data-rng]").forEach(b => b.addEventListener("click", () => { rng = +b.dataset.rng; render(); }));
  document.querySelectorAll("[data-rmode]").forEach(b => b.addEventListener("click", () => { rmode = b.dataset.rmode; render(); }));
  document.addEventListener("click", e => { const b = e.target.closest("[data-ver3d]"); if (!b) return; if (window.LQ_RIO3D) { window.LQ_RIO3D.irA(Date.parse(b.dataset.ver3d)); document.getElementById("rio3d").scrollIntoView({ behavior: "smooth" }); } });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  async function cargar() {
    try { const r = await fetch("data/historia.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw 0; H = await r.json(); window.LQ_HIST = H; render(); document.dispatchEvent(new CustomEvent("lq-historia", { detail: H })); }
    catch (e) { $("hSummary").textContent = "No se pudo leer el historial. Reintentando en unos minutos."; }
  }
  cargar(); setInterval(cargar, 10 * 60 * 1000);
})();
