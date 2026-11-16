/* Acceso a la API pública del OHMC (estaciones-fe.ohmc.ar).
   Desde nov/2026 cada consulta a /api/v1/public/* exige la cookie del visualizador público:
   se obtiene con POST /api/v1/public/session (dura ~15 min). Este módulo la pide, la reutiliza,
   la renueva 30 s antes de vencer y, si el servidor contesta 401 con X-Public-Session-Required,
   pide una nueva y reintenta una vez. Para cualquier otra URL se comporta como fetch. */
"use strict";
const BASE = "https://estaciones-fe.ohmc.ar";
const PUBLICA = BASE + "/api/v1/public/";
const UA = "monitor-dique-la-quebrada (+https://lucas22rivas.github.io/dique-la-quebrada/)";

let cookie = null, vence = 0, pidiendo = null, sesiones = 0;

async function sesion(forzar) {
  if (!forzar && cookie && Date.now() < vence) return cookie;
  if (pidiendo) return pidiendo;
  pidiendo = (async () => {
    const r = await fetch(PUBLICA + "session", { method: "POST", headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error("el OHMC no entregó la sesión del visor público (" + r.status + ")");
    const j = await r.json();
    const sc = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""]).find(c => /public_visualizer_session=/.test(c));
    if (!sc) throw new Error("el OHMC respondió la sesión sin cookie");
    cookie = sc.split(";")[0];
    const seg = Number.isFinite(j.expires_in) && j.expires_in > 0 ? j.expires_in : 600;
    vence = Date.now() + (seg - 30) * 1000;
    sesiones++;
    return cookie;
  })().finally(() => { pidiendo = null; });
  return pidiendo;
}

async function ohmcFetch(url, opt = {}) {
  if (!String(url).startsWith(PUBLICA)) return fetch(url, opt);
  const conCookie = c => fetch(url, { ...opt, headers: { "User-Agent": UA, ...(opt.headers || {}), Cookie: c } });
  let r = await conCookie(await sesion(false));
  if (r.status === 401 && r.headers.get("X-Public-Session-Required") === "1") r = await conCookie(await sesion(true));
  return r;
}

module.exports = { ohmcFetch, sesion, get sesiones() { return sesiones; } };
