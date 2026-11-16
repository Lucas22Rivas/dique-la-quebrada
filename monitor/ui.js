/* Panel de monitoreo en tiempo real: lee data/estado.json (lo genera el robot cada 10 min) y hace sonar la alarma. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  if (!$("live")) return;
  const ORDEN = { normal: 0, atencion: 1, alerta: 2, emergencia: 3 };
  const CLS = ["ok", "warn", "bad", "crit"];
  const fmt = (x, d = 1) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hora = t => t ? new Date(t).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hourCycle: "h23" }) : "–";
  const hace = t => { if (!t) return "sin datos"; const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 1 ? "recién" : m < 60 ? "hace " + m + " min" : "hace " + Math.round(m / 60) + " h"; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = { get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  // ---------- Alarma ----------
  let ctx = null, sirenaHasta = 0, wake = null, armada = store.get("lq_alarm", false), ultimoOrden = null;
  function sirena(seg) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime;
      o.type = "sawtooth"; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.1);
      for (let t = 0; t < seg; t += 1.2) { o.frequency.setValueAtTime(620, t0 + t); o.frequency.linearRampToValueAtTime(1180, t0 + t + 0.6); o.frequency.linearRampToValueAtTime(620, t0 + t + 1.2); }
      g.gain.setValueAtTime(0.25, t0 + seg - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t0 + seg);
      o.start(t0); o.stop(t0 + seg); sirenaHasta = Date.now() + seg * 1000;
    } catch (e) {}
  }
  async function pedirWake() { try { if (navigator.wakeLock && armada) wake = await navigator.wakeLock.request("screen"); } catch (e) {} }
  function pintarBoton() {
    const b = $("alarmBtn"); b.setAttribute("aria-pressed", armada); b.classList.toggle("on", armada);
    b.textContent = armada ? "Alarma activada: tocá para apagar" : "Activar alarma en esta pantalla";
  }
  $("alarmBtn").addEventListener("click", async () => {
    armada = !armada; store.set("lq_alarm", armada); pintarBoton();
    if (armada) {
      sirena(0.6);
      try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch (e) {}
      pedirWake();
    } else if (wake) { try { wake.release(); } catch (e) {} wake = null; }
  });
  $("alarmTest").addEventListener("click", () => sirena(3));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pedirWake(); });
  $("copyTopic").addEventListener("click", () => {
    const t = $("ntfyTopic").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { $("copyTopic").textContent = "Copiado"; }).catch(() => {
      const r = document.createRange(); r.selectNodeContents($("ntfyTopic")); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  });
  pintarBoton();
  if (armada) {
    // El navegador exige un toque antes de sonar: el primer toque en la página habilita el audio.
    document.addEventListener("pointerdown", () => { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch (e) {} pedirWake(); }, { once: true });
  }
  function disparar(e) {
    const o = ORDEN[e.alerta.nivel];
    if (ultimoOrden !== null && o > ultimoOrden && o >= 2 && armada) {
      sirena(o === 3 ? 20 : 8);
      try { if ("Notification" in window && Notification.permission === "granted") new Notification(e.alerta.etiqueta.toUpperCase() + " · Dique La Quebrada", { body: (e.alerta.motivos[0] || {}).texto || "", requireInteraction: true }); } catch (x) {}
    }
    ultimoOrden = o;
  }

  // ---------- Pintar ----------
  function spark(serie, w, h, color) {
    if (!serie || serie.length < 2) return "";
    const v = serie.map(x => x[1]), mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 0.1;
    const pts = v.map((y, i) => (i / (v.length - 1) * w).toFixed(1) + "," + (h - 2 - (y - mn) / rg * (h - 4)).toFixed(1)).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
  }
  const ROCLS = { ok: "ok", warn: "warn", bad: "bad", crit: "crit" };
  const tagl = n => `<span class="tagl" data-lvl="${CLS[ORDEN[n]]}">${n === "atencion" ? "Atención" : n[0].toUpperCase() + n.slice(1)}</span>`;
  function render(e) {
    const a = e.alerta, c = CLS[a.orden];
    $("live").dataset.level = a.nivel;
    $("liveDot").className = "dot pulse " + c;
    $("liveSub").textContent = "Último cálculo: " + hora(e.generado) + " (" + hace(e.generado) + "). Se actualiza solo cada 10 minutos.";
    $("liveReasons").innerHTML = a.motivos.length ? a.motivos.map(m => `<li>${tagl(m.nivel)}<span>${esc(m.texto)}</span></li>`).join("") : "<li>" + tagl("normal") + "<span>No llueve en la cuenca y el pronóstico no compromete al dique.</span></li>";
    const d = e.dique, cu = e.cuenca, p = e.pronostico;
    const tiles = [
      { k: "Nivel del dique", v: d ? (d.respectoVertedero > 0 ? "+" : "") + fmt(d.respectoVertedero, 2) + "<small>m</small>" : "–", s: d ? "Cota " + fmt(d.cota, 2) + " m" + (d.cambio24h == null ? "" : " · " + (d.cambio24h >= 0 ? "+" : "") + fmt(d.cambio24h * 100, 0) + " cm en 24 h") : "Sin dato", sp: d && spark(d.serie, 160, 26, "var(--water)"), c: d && d.respectoVertedero > 0 ? "bad" : "ok" },
      { k: "Lluvia en la cuenca ahora", v: fmt(cu.h1, 1) + "<small>mm/h</small>", s: fmt(cu.h3, 1) + " mm en 3 h · " + fmt(cu.h24, 1) + " mm en 24 h", c: cu.h1 >= 20 ? "bad" : cu.h1 >= 5 ? "warn" : "ok" },
      { k: "Humedad del suelo", v: fmt(a.api != null ? a.api : cu.d5, 0) + "<small>mm</small>", s: "Lluvia antecedente · suelo " + ["", "seco", "normal", "muy húmedo"][a.amc] + " · el dique absorbe ~" + fmt(a.lluviaAbsorbible, 0) + " mm", c: a.amc === 3 ? "warn" : "ok" },
      { k: "Pronóstico 24 h", v: p ? fmt(p.h24, 0) + "<small>mm</small>" : "–", s: p ? fmt(p.h6, 0) + " mm en 6 h · " + fmt(p.h48, 0) + " mm en 48 h (modelo)" : "Sin dato", c: p && a.lluviaAbsorbible != null && p.h24 >= a.lluviaAbsorbible ? "bad" : "ok" },
    ];
    $("liveTiles").innerHTML = tiles.map(t => `<div class="ro" data-lvl="${t.c}"><span class="k"><span class="flag"></span>${t.k}</span><span class="v">${t.v}</span><span class="s">${t.s}</span>${t.sp || ""}</div>`).join("");
    $("livePluvios").innerHTML = "<thead><tr><th>Estación</th><th>1 h</th><th>3 h</th><th>24 h</th><th>5 días</th><th>Dato</th></tr></thead><tbody>" +
      e.pluviometros.map(l => `<tr${l.cuenca ? " class='hl'" : ""}><td>${esc(l.nombre)}${l.cuenca ? " <span class='muted'>· cuenca</span>" : ""}</td><td class="num">${l.activa ? fmt(l.h1) : "–"}</td><td class="num">${l.activa ? fmt(l.h3) : "–"}</td><td class="num">${l.activa ? fmt(l.h24) : "–"}</td><td class="num">${l.activa ? fmt(l.d5, 0) : "–"}</td><td class="muted">${l.activa ? hace(l.ultimoDato) : "<span class='c-warn'>sin datos</span>"}</td></tr>`).join("") + "</tbody>";
    const NR = e.normalRio || {};
    $("liveRios").innerHTML = "<thead><tr><th>Sensor</th><th>Ahora</th><th>Normal</th><th>Sobre lo normal</th><th>En 30 min</th></tr></thead><tbody>" +
      e.rios.map(r => { const n = NR[r.id], an = r.activa && n != null ? r.nivel - n : null, c = an == null ? "" : an >= 1 ? "c-crit" : an >= .5 ? "c-bad" : an >= .25 ? "c-warn" : "c-ok";
        return `<tr><td>${esc(r.nombre)}</td><td class="num">${r.activa ? fmt(r.nivel, 2) + " m" : "<span class='c-warn'>sin datos</span>"}</td><td class="num muted">${n != null ? fmt(n, 2) + " m" : "–"}</td><td class="num ${c}"><b>${an == null ? "–" : (an >= 0 ? "+" : "") + Math.round(an * 100) + " cm"}</b></td><td class="num">${r.activa && r.subida30 != null ? (r.subida30 >= 0 ? "+" : "") + Math.round(r.subida30 * 100) + " cm" : "–"}</td></tr>`; }).join("") + "</tbody>";
    $("liveHist").innerHTML = (e.historial || []).slice(0, 8).map(h => `<li>${tagl(h.nivel)}<span class="mono">${hora(h.t)}</span><span>${esc(h.motivo)}</span></li>`).join("") || "<li>Sin cambios registrados.</li>";
    document.title = (a.orden >= 2 ? "⚠ " + a.etiqueta.toUpperCase() + " · " : "") + "Monitor Dique La Quebrada";

    // Cargar los datos reales en el resto del tablero (portada, barra, registro)
    if (window.LQ_APP) {
      const dias = []; const hoy = new Date(Date.parse(e.generado) - 3 * 36e5);
      for (let i = 6; i >= 0; i--) { const dd = new Date(hoy); dd.setUTCDate(dd.getUTCDate() - i); dias.push(dd.toISOString().slice(0, 10)); }
      const rows = dias.map(k => ({ date: k, v: e.pluviometros.map(l => l.diario && l.diario[k] != null ? l.diario[k] : "") }));
      const fcv = p ? Math.round(p.h48) : null;
      window.LQ_APP.setLive({ level: d ? d.respectoVertedero : null, levelNote: d ? "Sensor APRHI en vivo (OHMC), " + hora(d.dato) : null,
        date: dias[6], rows, api: a.api != null ? a.api : null, evap: e.evapotranspiracion != null ? e.evapotranspiracion : null, fc: fcv == null ? null : [fcv, fcv, fcv, fcv],
        alert: { etiqueta: a.etiqueta, motivo: a.motivos.length ? a.motivos.map(m => m.texto).slice(0, 2).join(". ") + "." : "No llueve en la cuenca y el pronóstico no compromete al dique.", src: "En vivo: pluviómetros, dique y río de APRHI (OHMC), calculado " + hace(e.generado) + "." },
        time: new Date(e.generado).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) });
    }
    disparar(e);
  }
  async function cargar() {
    try {
      const r = await fetch("data/estado.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      render(await r.json());
    } catch (err) {
      $("liveSub").textContent = "No se pudieron leer los datos en vivo. Reintentando en un minuto.";
    }
  }
  cargar(); setInterval(cargar, 60 * 1000);
})();
