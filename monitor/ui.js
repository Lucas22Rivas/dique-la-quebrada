/* Panel de monitoreo en tiempo real: lee data/estado.json (lo genera el robot cada 10 min) y hace sonar la alarma. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  if (!$("live")) return;
  const ORDEN = { normal: 0, atencion: 1, alerta: 2, emergencia: 3 };
  const CLS = ["ok", "warn", "bad", "crit"];
  const fmt = (x, d = 1) => x == null || isNaN(x) ? "–" : (+x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hora = t => t ? new Date(t).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "–";
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
  function render(e) {
    const a = e.alerta, c = CLS[a.orden];
    $("live").dataset.level = a.nivel;
    $("liveDot").className = "dot " + c;
    $("liveTitle").textContent = a.orden === 0 ? "Sin alertas en la cuenca del dique" : a.etiqueta + ": " + ((a.motivos[0] || {}).texto || "");
    $("liveSub").textContent = "Último cálculo: " + hora(e.generado) + " (" + hace(e.generado) + "). Se actualiza solo cada 10 minutos.";
    $("liveLevel").textContent = a.etiqueta; $("liveLevel").className = "lb-level c-" + c;
    $("liveBanner").className = "live-banner st-" + c;
    $("liveReasons").innerHTML = a.motivos.length ? a.motivos.map(m => `<li><span class="pill c-${CLS[ORDEN[m.nivel]]}">${esc(m.nivel === "atencion" ? "atención" : m.nivel)}</span> ${esc(m.texto)}</li>`).join("") : "<li>No llueve en la cuenca y el pronóstico no compromete al dique.</li>";
    const d = e.dique, cu = e.cuenca, p = e.pronostico;
    const tiles = [
      { e: "Nivel del dique", v: d ? (d.respectoVertedero > 0 ? "+" : "") + fmt(d.respectoVertedero, 2) + " m" : "–", s: d ? "Cota " + fmt(d.cota, 2) + " m · " + (d.cambio24h == null ? "" : (d.cambio24h >= 0 ? "+" : "") + fmt(d.cambio24h * 100, 0) + " cm en 24 h · ") + hace(d.dato) : "Sin dato", sp: d && spark(d.serie, 120, 28, "var(--water)"), c: d && d.respectoVertedero > 0 ? "bad" : "ok" },
      { e: "Lluvia en la cuenca", v: fmt(cu.h1, 1) + " mm/h", s: fmt(cu.h3, 1) + " mm en 3 h · " + fmt(cu.h24, 1) + " mm en 24 h · " + cu.estaciones + " pluviómetros", c: cu.h1 >= 20 ? "bad" : cu.h1 >= 5 ? "warn" : "ok" },
      { e: "Últimos 5 días", v: fmt(cu.d5, 0) + " mm", s: "Suelo " + ["", "seco", "normal", "saturado"][a.amc] + " · el dique absorbe ~" + fmt(a.lluviaAbsorbible, 0) + " mm", c: a.amc === 3 ? "warn" : "ok" },
      { e: "Pronóstico", v: p ? fmt(p.h24, 0) + " mm en 24 h" : "–", s: p ? fmt(p.h6, 0) + " mm en 6 h · " + fmt(p.h48, 0) + " mm en 48 h (modelo)" : "Sin dato", c: p && a.lluviaAbsorbible != null && p.h24 >= a.lluviaAbsorbible ? "bad" : "ok" },
    ];
    $("liveTiles").innerHTML = tiles.map(t => `<div class="panel tile st-${t.c}"><span class="eyebrow">${t.e}</span><span class="v">${t.v}</span><span class="s">${t.s}</span>${t.sp || ""}</div>`).join("");
    $("livePluvios").innerHTML = "<thead><tr><th>Estación</th><th>1 h</th><th>3 h</th><th>24 h</th><th>5 días</th><th>Dato</th></tr></thead><tbody>" +
      e.pluviometros.map(l => `<tr${l.cuenca ? " class='hl'" : ""}><td>${esc(l.nombre)}${l.cuenca ? " · cuenca" : ""}</td><td class="num">${l.activa ? fmt(l.h1) : "–"}</td><td class="num">${l.activa ? fmt(l.h3) : "–"}</td><td class="num">${l.activa ? fmt(l.h24) : "–"}</td><td class="num">${l.activa ? fmt(l.d5, 0) : "–"}</td><td>${l.activa ? hace(l.ultimoDato) : "<span class='c-warn'>sin datos</span>"}</td></tr>`).join("") + "</tbody>";
    $("liveRios").innerHTML = "<thead><tr><th>Sensor</th><th>Altura</th><th>30 min</th><th>24 h</th><th></th></tr></thead><tbody>" +
      e.rios.map(r => `<tr><td>${esc(r.nombre)}</td><td class="num">${r.activa ? fmt(r.nivel, 2) + " m" : "–"}</td><td class="num">${r.activa && r.subida30 != null ? (r.subida30 >= 0 ? "+" : "") + fmt(r.subida30, 2) : "–"}</td><td>${r.activa ? spark(r.serie, 90, 22, "var(--chart-in)") : "<span class='c-warn'>sin datos</span>"}</td><td>${r.activa ? hace(r.dato) : ""}</td></tr>`).join("") + "</tbody>";
    $("liveHist").innerHTML = (e.historial || []).slice(0, 8).map(h => `<li><span class="pill c-${CLS[ORDEN[h.nivel]]}">${esc(h.nivel === "atencion" ? "atención" : h.nivel)}</span> <span class="mono">${hora(h.t)}</span> ${esc(h.motivo)}</li>`).join("") || "<li>Sin cambios registrados.</li>";
    document.title = (a.orden >= 2 ? "⚠ " + a.etiqueta.toUpperCase() + " · " : "") + "Monitor Dique La Quebrada";

    // Cargar los datos reales en el resto del tablero
    if (window.LQ_APP) {
      const dias = []; const hoy = new Date(Date.parse(e.generado) - 3 * 36e5);
      for (let i = 6; i >= 0; i--) { const dd = new Date(hoy); dd.setUTCDate(dd.getUTCDate() - i); dias.push(dd.toISOString().slice(0, 10)); }
      const rows = dias.map(k => ({ date: k, v: e.pluviometros.map(l => l.diario && l.diario[k] != null ? l.diario[k] : "") }));
      const fcv = p ? Math.round(p.h48) : null;
      window.LQ_APP.setLive({ level: d ? d.respectoVertedero : null, levelNote: d ? "Sensor APRHI en vivo (OHMC), " + hora(d.dato) : null,
        date: dias[6], rows, fc: fcv == null ? null : [fcv, fcv, fcv, fcv] });
    }
    disparar(e);
  }
  async function cargar() {
    try {
      const r = await fetch("data/estado.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      render(await r.json());
    } catch (err) {
      $("liveTitle").textContent = "No se pudieron leer los datos en vivo";
      $("liveSub").textContent = "Reintentando en un minuto. Si persiste, revisá la conexión.";
    }
  }
  cargar(); setInterval(cargar, 60 * 1000);
})();
