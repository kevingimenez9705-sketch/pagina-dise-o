/* Mesa de Diseño · Gastro BS AS
   Datos compartidos en Supabase.
   · Diseño: cada integrante (Naza, Agus) entra con su perfil y su clave y trabaja en su propia mesa.
   · Solicitantes: eligen su área, escriben su nombre y la clave del área; ven solo los pedidos de su área.
   Todo pasa por funciones de la base (mesa_*) que validan el token de sesión en cada llamada. */
(() => {
  "use strict";

  /* ---------- Catálogos ---------- */

  const STATUSES = [
    { key: "Nuevas", color: "#c9b79c" },
    { key: "En progreso", color: "#4f8a78" },
    { key: "En revisión", color: "#a8906f" },
    { key: "Con cambios", color: "#b5573a" },
    { key: "Aprobadas", color: "#2e6a5a" },
    { key: "Entregadas", color: "#133c33" },
  ];
  const DONE = "Entregadas";
  const IN_PRODUCTION = ["En progreso", "Con cambios"];
  const IN_REVIEW = ["En revisión"];
  const UNASSIGNED = "Sin asignar";
  const NONE = "__none";
  const INTERNAL = "Diseño (interno)";

  // Color de avatar de cada perfil de Diseño, según su orden (Naza 0, Agus 1, …)
  const AV_CLASSES = ["av-n", "av-a", "av-b", "av-c", "av-d"];

  const BRANDS = [
    "Gastro (corporativo)",
    "Sabores Express ARG.",
    "Sabores Express España",
    "Hamburguesas Extremas",
    "Empanadas Manía",
    "Empanadas Manía Franquicias",
    "Pizza Free",
    "Bella Ragazza",
    "Puerto Milanesa",
    "Lomitos Jacks",
  ];

  // Tipo de pieza → variante de etiqueta
  const TYPES = {
    "Manual": "man",
    "Capacitación": "",
    "Presentación": "",
    "Organigrama": "",
    "Pieza gráfica": "ext",
    "Logo / identidad": "ext",
    "Señalética": "ext",
  };

  const PRIORITIES = ["Baja", "Media", "Alta", "Urgente"];
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const SESSION_KEY = "mesa-diseno-sesion-v3";
  const LAST_KEY = "mesa-diseno-ultimo-ingreso";
  const POLL_MS = 30000;

  /* ---------- Estado ---------- */

  const state = {
    token: null,
    me: null, // { tipo: "diseno" | "area", nombre, disenador, area_id, area }
    team: [], // perfiles de Diseño activos
    areas: [], // áreas visibles (Diseño: todas; un área: la suya)
    admin: null, // resumen de perfiles y áreas (solo Diseño)
    items: [],
    loaded: false,
    nav: null,
    view: "board",
    q: "",
    brand: "",
    designer: "",
    area: "",
    openId: null,
    keyTarget: null,
    login: { disenadores: [], areas: [] },
  };

  const isDesigner = () => Boolean(state.me && state.me.tipo === "diseno");
  const myName = () => (state.me ? state.me.nombre : "");
  const myAlias = () => (state.me ? state.me.disenador : null);
  const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  const unassignedCount = () => state.items.filter((i) => !i.designer && i.status !== DONE).length;

  const NAVS = {
    // Diseño
    mio: {
      label: "Mi mesa",
      eyebrow: () => `Mesa personal · ${myAlias()}`,
      title: () => "Mi mesa",
      sub: () => {
        const n = unassignedCount();
        return `Lo que tenés asignado, ${myAlias()}. Esta mesa es solo tuya.` +
          (n ? ` Hay ${n} pedido${n > 1 ? "s" : ""} sin asignar en «Todas las solicitudes».` : "");
      },
      view: "board",
    },
    todas: {
      label: "Todas las solicitudes",
      eyebrow: () => "De la idea a la entrega",
      title: () => "Todas las solicitudes",
      sub: () => "Los pedidos de todas las áreas y de todas las mesas.",
      view: null,
    },
    accesos: {
      label: "Perfiles y áreas",
      eyebrow: () => "Configuración exclusiva de Diseño",
      title: () => "Perfiles y áreas",
      sub: () => "Quiénes integran Diseño, qué áreas pueden pedir y la clave de cada una. Los solicitantes no ven este panel.",
      admin: true,
    },
    // Áreas solicitantes
    tablero: {
      label: "Tablero del área",
      eyebrow: () => `Área · ${state.me.area}`,
      title: () => `Solicitudes de ${state.me.area}`,
      sub: () => `Hola, ${myName()}. Solo ves los pedidos de tu área; los de otras áreas quedan aislados.`,
      view: "board",
    },
    enviados: {
      label: "Mis pedidos enviados",
      eyebrow: () => `Área · ${state.me.area}`,
      title: () => "Mis pedidos enviados",
      sub: () => `Los pedidos que cargaste vos, ${myName()}.`,
      view: null,
    },
  };
  const NAVS_BY_ROLE = { diseno: ["mio", "todas", "accesos"], area: ["tablero", "enviados"] };

  /* ---------- Almacenamiento local ---------- */

  const stores = () => {
    const out = [];
    try { out.push(window.localStorage); } catch { /* sin almacenamiento */ }
    try { out.push(window.sessionStorage); } catch { /* sin almacenamiento */ }
    return out;
  };

  // Sesión: en localStorage si se pidió mantenerla, si no solo mientras dure la pestaña
  const stored = {
    get() {
      for (const s of stores()) {
        try {
          const v = JSON.parse(s.getItem(SESSION_KEY));
          if (v && typeof v.token === "string") return v;
        } catch { /* dato inválido */ }
      }
      return null;
    },
    set(v) {
      this.clear();
      try { (v.recordar ? window.localStorage : window.sessionStorage).setItem(SESSION_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
    },
    clear() {
      stores().forEach((s) => { try { s.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ } });
    },
  };

  // Último ingreso (perfil, área y nombre; nunca la clave) para completar el formulario
  const lastLogin = {
    get() {
      try { return JSON.parse(window.localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; }
    },
    set(v) {
      try { window.localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
    },
  };

  // La versión anterior guardaba la clave en el navegador: se borra
  try { window.localStorage.removeItem("mesa-diseno-sesion"); } catch { /* sin almacenamiento */ }

  /* ---------- Utilidades ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const pad = (n) => String(n).padStart(2, "0");
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDay(new Date());

  const fmtDate = (iso) => {
    if (!iso) return "—";
    const [, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]}`;
  };

  const fmtDay = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };

  const fmtStamp = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const code = (id) => `DIS-${String(id).padStart(3, "0")}`;
  const isLate = (it) => it.status !== DONE && it.due && it.due < today();
  const two = (n) => String(n).padStart(2, "0");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Sin importar mayúsculas ni tildes: "Diseño", "diseño" y "DISENO" valen lo mismo
  const normKey = (s) => String(s || "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const avClassFor = (orden) => AV_CLASSES[Math.abs(Number(orden) || 0) % AV_CLASSES.length];

  const teamMember = (alias) =>
    state.team.find((d) => d.alias === alias) || (state.admin?.disenadores || []).find((d) => d.alias === alias);

  const avatar = (who) => {
    if (!who) return `<i class="av" aria-hidden="true">–</i>`;
    const d = teamMember(who);
    return `<i class="av ${d ? avClassFor(d.orden) : ""}" aria-hidden="true">${esc(String(who).trim()[0] || "?").toUpperCase()}</i>`;
  };

  const statusColor = (key) => (STATUSES.find((s) => s.key === key) || STATUSES[0]).color;

  const options = (list, selected) =>
    list.map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  const designerOptions = (selected) => {
    const aliases = state.team.map((d) => d.alias);
    if (selected && !aliases.includes(selected)) aliases.push(selected);
    return `<option value=""${!selected ? " selected" : ""}>${UNASSIGNED}</option>` +
      aliases.map((a) => {
        const d = teamMember(a);
        const full = d && d.nombre && d.nombre !== a ? ` · ${esc(d.nombre)}` : "";
        return `<option value="${esc(a)}"${a === selected ? " selected" : ""}>${esc(a)}${full}</option>`;
      }).join("");
  };

  // Áreas de un pedido. Si el pedido no está vinculado a un área activa, se muestra su nombre guardado.
  const areaOptions = (it) => {
    const linked = it && it.areaId && state.areas.some((a) => a.id === it.areaId);
    const internal = !it || (!it.areaId && it.area === INTERNAL);
    const legacy = it && !linked && !internal ? it.area : null;
    const selectedId = it ? (linked ? it.areaId : null) : state.areas[0]?.id ?? null;
    return (legacy ? `<option value="" selected disabled>${esc(legacy)} · elegí un área</option>` : "") +
      state.areas.map((a) => `<option value="${a.id}"${a.id === selectedId ? " selected" : ""}>${esc(a.nombre)}</option>`).join("") +
      `<option value="0"${!legacy && !selectedId ? " selected" : ""}>${INTERNAL}</option>`;
  };

  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  };

  /* ---------- Supabase ---------- */

  const cfg = window.MESA_CONFIG;
  const sb = window.supabase && cfg ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  let channel = null;
  let pollTimer = null;

  class SessionError extends Error {}

  const rpc = async (fn, args = {}) => {
    const { data, error } = await sb.rpc(fn, { p_token: state.token, ...args });
    if (error) {
      if (error.code === "28000") throw new SessionError(error.message);
      const e = new Error(error.message);
      e.code = error.code;
      throw e;
    }
    return data;
  };

  const handleError = (what, error) => {
    console.error(what, error);
    if (error instanceof SessionError) return logout("Tu sesión se cerró (cambió la clave o venció). Ingresá de nuevo.");
    if (error && error.code === "42501") return toast("Solo el equipo de Diseño puede hacer ese cambio.");
    if (error && (error.code === "P0001" || error.code === "P0002")) return toast(error.message);
    toast(`No se pudo ${what}. Probá de nuevo.`);
  };

  const fromRow = (r) => ({
    id: r.id,
    code: code(r.id),
    title: r.titulo,
    brand: r.marca,
    area: r.area,
    areaId: r.area_id,
    type: r.tipo,
    priority: r.prioridad,
    designer: r.disenador,
    due: r.entrega,
    status: r.estado,
    print: r.impresion,
    link: r.link,
    description: r.descripcion,
    createdBy: r.creado_por,
    comments: [],
  });

  const fetchData = async () => {
    const d = await rpc("mesa_tablero");
    state.me = d.yo;
    state.team = d.disenadores || [];
    state.areas = d.areas || [];
    state.admin = d.admin || null;

    const byId = new Map((d.pedidos || []).map((r) => [r.id, fromRow(r)]));
    (d.comentarios || []).forEach((r) => {
      byId.get(r.pedido_id)?.comments.push({ who: r.autor, at: r.created_at, text: r.texto, system: r.sistema });
    });
    const next = [...byId.values()];

    // Aviso de pedidos nuevos cargados por otra persona
    if (state.loaded) {
      const known = new Set(state.items.map((i) => i.id));
      const fresh = next.filter((i) => !known.has(i.id) && !sameName(i.createdBy, myName()));
      if (fresh.length) toast(`Nuevo pedido de ${fresh[0].createdBy} (${fresh[0].area}): ${fresh[0].title}`);
    }

    state.items = next;
    state.loaded = true;
    if (!NAVS_BY_ROLE[state.me.tipo].includes(state.nav)) state.nav = NAVS_BY_ROLE[state.me.tipo][0];
    render();
    if (state.openId && detailDialog.open) {
      if (find(state.openId)) renderDetail();
      else detailDialog.close();
    }
  };

  const refresh = async () => {
    if (!state.token) return;
    try { await fetchData(); } catch (e) { handleError("actualizar los pedidos", e); }
  };

  let refreshTimer;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 200);
  };

  // Avisa a las otras pantallas que hubo un cambio (no viajan datos)
  const notify = () => {
    if (channel) channel.send({ type: "broadcast", event: "cambio", payload: {} }).catch(() => {});
  };

  const setLive = (status) => {
    const el = $("#liveBadge");
    const map = {
      SUBSCRIBED: ["on", "En vivo"],
      CHANNEL_ERROR: ["error", "Sin conexión en vivo"],
      TIMED_OUT: ["error", "Sin conexión en vivo"],
      CLOSED: ["off", "Desconectado"],
    };
    const [st, label] = map[status] || ["off", "Conectando…"];
    el.dataset.state = st;
    el.textContent = label;
    if (status === "SUBSCRIBED" && state.loaded) scheduleRefresh();
  };

  const connectLive = () => {
    if (channel) sb.removeChannel(channel);
    channel = sb
      .channel("mesa-diseno", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "cambio" }, scheduleRefresh)
      .subscribe(setLive);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") scheduleRefresh();
    }, POLL_MS);
  };

  const disconnectLive = () => {
    clearInterval(pollTimer);
    pollTimer = null;
    if (channel) { sb.removeChannel(channel); channel = null; }
  };

  /* ---------- Ingreso ---------- */

  const loginForm = $("#loginForm");
  const authError = $("#authError");

  const lock = () => {
    document.body.classList.add("is-locked");
    if (detailDialog.open) detailDialog.close();
    if (newDialog.open) newDialog.close();
    if (keyDialog.open) keyDialog.close();
  };

  const showAuthError = (msg) => {
    authError.hidden = !msg;
    authError.textContent = msg || "";
  };

  const syncLoginMode = () => {
    const area = loginForm.elements.tipo.value === "area";
    $("#designFields").hidden = area;
    $("#areaFields").hidden = !area;
    $("#keyLabel").textContent = area ? "Clave del área" : "Clave personal";
  };

  const renderLoginOptions = () => {
    const { disenadores, areas } = state.login;
    const last = lastLogin.get();
    const picker = $("#designerPicker");
    const current = $('input[name="perfil"]:checked', picker)?.value || last.perfil;

    picker.innerHTML = disenadores.length
      ? disenadores.map((d) => `
          <label class="pick">
            <input type="radio" name="perfil" value="${esc(d.alias)}"${d.alias === current ? " checked" : ""} />
            <span>
              <i class="av ${avClassFor(d.orden)}" aria-hidden="true">${esc(d.alias[0].toUpperCase())}</i>
              <span class="pick__text"><strong>${esc(d.alias)}</strong><small>Mesa personal</small></span>
            </span>
          </label>`).join("")
      : `<p class="picker__note">Todavía no hay perfiles de Diseño cargados.</p>`;
    const radios = $$('input[name="perfil"]', picker);
    if (radios.length && !radios.some((r) => r.checked)) radios[0].checked = true;

    const select = $("#areaSelect");
    const currentArea = select.value || String(last.area || "");
    select.innerHTML = areas.length
      ? areas.map((a) => `<option value="${a.id}"${String(a.id) === currentArea ? " selected" : ""}>${esc(a.nombre)}</option>`).join("")
      : `<option value="">No hay áreas habilitadas</option>`;
  };

  const loadLoginOptions = async () => {
    const { data, error } = await sb.rpc("mesa_opciones_ingreso");
    if (error || !data) {
      showAuthError("No pudimos cargar los perfiles. Revisá tu conexión y recargá la página.");
      return;
    }
    state.login = { disenadores: data.disenadores || [], areas: data.areas || [] };
    renderLoginOptions();
  };

  const prefillLogin = () => {
    const last = lastLogin.get();
    const f = loginForm.elements;
    if (last.tipo === "area" || last.tipo === "diseno") f.tipo.value = last.tipo;
    if (last.nombre && !f.nombre.value) f.nombre.value = last.nombre;
    syncLoginMode();
  };

  const showLogin = (msg) => {
    lock();
    showAuthError(msg);
    prefillLogin();
    loadLoginOptions();
  };

  loginForm.addEventListener("change", (e) => {
    if (e.target.name === "tipo") {
      syncLoginMode();
      showAuthError("");
    }
  });

  $("#passToggle").addEventListener("click", (e) => {
    const input = loginForm.elements.clave;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-pressed", String(show));
    e.currentTarget.setAttribute("aria-label", show ? "Ocultar clave" : "Mostrar clave");
  });

  const start = async (session) => {
    state.token = session.token;
    state.loaded = false;
    state.nav = null;
    try {
      await fetchData();
    } catch (e) {
      state.token = null;
      state.me = null;
      if (e instanceof SessionError) stored.clear();
      showLogin(e instanceof SessionError
        ? "Tu sesión se cerró (cambió la clave o venció). Ingresá de nuevo."
        : "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
      return false;
    }
    stored.set(session);
    document.body.classList.remove("is-locked");
    render();
    connectLive();
    return true;
  };

  const logout = (msg) => {
    // Al tocar «Salir» se cierra la sesión también en la base
    if (state.token && !msg) sb.rpc("mesa_cerrar_sesion", { p_token: state.token }).then(() => {}, () => {});
    disconnectLive();
    stored.clear();
    state.token = null;
    state.me = null;
    state.admin = null;
    state.items = [];
    state.loaded = false;
    state.nav = null;
    loginForm.elements.clave.value = "";
    showLogin(msg);
  };

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = loginForm.elements;
    const tipo = f.tipo.value;
    const clave = normKey(f.clave.value);
    const recordar = f.recordar.checked;
    let quien;
    let etiqueta;
    let nombre = "";

    if (tipo === "diseno") {
      quien = $('input[name="perfil"]:checked', loginForm)?.value;
      if (!quien) return showAuthError("Elegí tu perfil.");
      etiqueta = quien;
    } else {
      quien = f.area.value;
      nombre = f.nombre.value.trim().replace(/\s+/g, " ").slice(0, 40);
      if (!quien) return showAuthError("Elegí tu área.");
      if (!nombre) return showAuthError("Escribí tu nombre y apellido: así firmás tus pedidos y comentarios.");
      etiqueta = f.area.selectedOptions[0]?.textContent || "elegida";
    }
    if (!clave) return showAuthError("Escribí la clave.");

    const btn = loginForm.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Ingresando…";
    showAuthError("");
    const { data, error } = await sb.rpc("mesa_iniciar_sesion", {
      p_tipo: tipo,
      p_quien: quien,
      p_clave: clave,
      p_nombre: nombre || null,
      p_recordar: recordar,
    });
    let ok = false;
    if (error) {
      showAuthError(error.code === "P0001" ? error.message : "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
      if (error.code === "P0001") loadLoginOptions();
    } else if (!data) {
      showAuthError(tipo === "diseno" ? `Clave incorrecta para ${etiqueta}.` : `La clave no corresponde al área ${etiqueta}.`);
    } else if (data.error === "sin_clave") {
      showAuthError(tipo === "diseno"
        ? `${etiqueta} todavía no tiene clave. Pedile a alguien de Diseño que se la ponga en «Perfiles y áreas».`
        : `${etiqueta} todavía no tiene clave. Pedísela al equipo de Diseño.`);
    } else {
      const prev = lastLogin.get();
      lastLogin.set(tipo === "diseno"
        ? { ...prev, tipo, perfil: quien }
        : { ...prev, tipo, area: quien, nombre });
      ok = await start({ token: data.token, recordar });
    }
    btn.disabled = false;
    btn.textContent = "Ingresar";
    if (ok) {
      f.clave.value = "";
      f.clave.type = "password";
    }
  });

  $("#logoutBtn").addEventListener("click", () => logout());

  /* ---------- Filtros ---------- */

  const mine = (it) => (isDesigner() ? it.designer === myAlias() : sameName(it.createdBy, myName()));

  const personal = () => state.nav === "mio" || state.nav === "enviados";

  const scoped = () => (personal() ? state.items.filter(mine) : state.items);

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    return scoped().filter((it) => {
      if (state.brand && it.brand !== state.brand) return false;
      if (state.nav !== "mio" && state.designer) {
        if (state.designer === NONE ? it.designer : it.designer !== state.designer) return false;
      }
      if (isDesigner() && state.area) {
        if (state.area === NONE ? it.areaId : String(it.areaId) !== state.area) return false;
      }
      if (!q) return true;
      return [it.code, it.title, it.brand, it.area, it.type, it.designer, it.status, it.createdBy]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  };

  // Rearma un <select> solo si cambiaron sus opciones (perfiles o áreas nuevas), conservando lo elegido
  const syncSelect = (el, html, stateKey) => {
    if (el.dataset.sig === html) return;
    el.dataset.sig = html;
    el.innerHTML = html;
    el.value = state[stateKey];
    if (el.value !== state[stateKey]) state[stateKey] = el.value;
  };

  const syncFilters = () => {
    syncSelect($("#fBrand"), `<option value="">Todas las marcas</option>` + options(BRANDS, ""), "brand");
    syncSelect($("#fDesigner"),
      `<option value="">Todo el equipo</option>` +
      state.team.map((d) => `<option value="${esc(d.alias)}">${esc(d.alias)}</option>`).join("") +
      `<option value="${NONE}">${UNASSIGNED}</option>`, "designer");
    syncSelect($("#fArea"),
      `<option value="">Todas las áreas</option>` +
      state.areas.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("") +
      `<option value="${NONE}">Sin área vinculada</option>`, "area");
  };

  /* ---------- Render ---------- */

  const renderStats = () => {
    const items = scoped();
    $("#stActive").textContent = two(items.filter((i) => i.status !== DONE).length);
    $("#stProd").textContent = two(items.filter((i) => IN_PRODUCTION.includes(i.status)).length);
    $("#stReview").textContent = two(items.filter((i) => IN_REVIEW.includes(i.status)).length);
    $("#stDone").textContent = two(items.filter((i) => i.status === DONE).length);
  };

  const renderChrome = () => {
    const nav = NAVS[state.nav];
    const tipo = state.me.tipo;
    $("#viewEyebrow").textContent = nav.eyebrow();
    $("#viewTitle").textContent = nav.title();
    $("#viewSub").textContent = nav.sub();
    document.title = `${nav.title()} · Mesa de Diseño`;
    $("#crumbs").innerHTML =
      `Espacio de trabajo <b>/</b> ${esc(isDesigner() ? "Diseño" : state.me.area)} <b>/</b> ${esc(nav.label)}`;

    $$("[data-only]").forEach((el) => { el.hidden = el.dataset.only !== tipo; });

    $$("[data-nav]").forEach((b) => {
      const on = b.dataset.nav === state.nav;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    const active = (list) => list.filter((i) => i.status !== DONE).length;
    $("#myCount").textContent = active(state.items.filter(mine));
    $("#areaCount").textContent = active(state.items);

    const isAdmin = Boolean(nav.admin);
    $("#workArea").hidden = isAdmin;
    $("#admin").hidden = !isAdmin;
    $("#newBtn").hidden = isAdmin;

    $$("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    $("#board").hidden = state.view !== "board";
    $("#list").hidden = state.view !== "list";

    syncFilters();
    const fd = $("#fDesigner");
    fd.disabled = state.nav === "mio";
    if (fd.disabled) {
      fd.value = "";
      state.designer = "";
    }

    const av = $("#meAvatar");
    const meMember = isDesigner() ? teamMember(myAlias()) : null;
    av.textContent = (myName()[0] || "?").toUpperCase();
    av.className = `av ${meMember ? avClassFor(meMember.orden) : ""}`;
    $("#meName").textContent = myName();
    $("#meRole").textContent = isDesigner() ? "Diseño" : state.me.area;
    $("#teamAvatars").innerHTML = state.team.map((d) => avatar(d.alias)).join("");
  };

  const cardHTML = (it) => {
    const late = isLate(it);
    const n = it.comments.filter((c) => !c.system).length;
    return `
      <article class="card" tabindex="0" draggable="${isDesigner()}" data-id="${it.id}" aria-label="${esc(it.code)}: ${esc(it.title)}">
        <div class="card-top"><span class="tag ${TYPES[it.type] ?? ""}">${esc(it.type)}</span><span class="id">${esc(it.code)}</span></div>
        <h3>${esc(it.title)}</h3>
        <div class="type">${esc(it.brand)} · ${esc(it.area)}</div>
        <span class="priority ${esc(it.priority)}">Prioridad ${esc(it.priority.toLowerCase())}</span>
        <div class="card-bottom">
          <span class="who">${avatar(it.designer)}${esc(it.designer || UNASSIGNED)}</span>
          <span class="meta-right">
            ${n ? `<span class="comments-count" title="${n} comentario${n > 1 ? "s" : ""}"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg>${n}</span>` : ""}
            <span class="${late ? "late" : ""}" title="Entrega">${late ? "Vencido · " : ""}${fmtDate(it.due)}</span>
          </span>
        </div>
      </article>`;
  };

  const emptyText = () => {
    if (state.items.length && scoped().length) return "No hay pedidos con estos filtros.";
    if (state.nav === "mio") return "Tu mesa está vacía. Tomá un pedido desde «Todas las solicitudes».";
    if (state.nav === "enviados") return "Todavía no cargaste pedidos. Creá el primero con «Nueva solicitud».";
    return "Todavía no hay pedidos. Creá el primero con «Nueva solicitud».";
  };

  const renderBoard = () => {
    if (!state.loaded) {
      $("#board").innerHTML = `<div class="loading">Cargando pedidos…</div>`;
      return;
    }
    const items = filtered();
    $("#board").innerHTML = STATUSES.map((s) => {
      const col = items.filter((i) => i.status === s.key).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
      return `
        <section class="column" data-status="${esc(s.key)}" aria-label="${esc(s.key)}">
          <div class="column-head"><span class="dot" style="--color:${s.color}"></span>${esc(s.key)}<span class="count">${col.length}</span></div>
          ${col.length ? col.map(cardHTML).join("") : `<div class="empty">Sin pedidos</div>`}
        </section>`;
    }).join("");
  };

  const renderList = () => {
    if (!state.loaded) {
      $("#list").innerHTML = `<div class="loading">Cargando pedidos…</div>`;
      return;
    }
    const items = filtered().sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    if (!items.length) {
      $("#list").innerHTML = `<div class="empty">${emptyText()}</div>`;
      return;
    }
    $("#list").innerHTML = `
      <table>
        <thead><tr><th scope="col">Pedido</th><th scope="col">Área</th><th scope="col">Marca</th><th scope="col">Estado</th><th scope="col">Mesa</th><th scope="col">Entrega</th></tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr tabindex="0" data-id="${it.id}">
              <td><span class="id">${esc(it.code)}</span><span class="td-title">${esc(it.title)}</span></td>
              <td>${esc(it.area)}</td>
              <td>${esc(it.brand)}</td>
              <td><span class="status"><span class="dot" style="--color:${statusColor(it.status)}"></span>${esc(it.status)}</span></td>
              <td><span class="who">${avatar(it.designer)}${esc(it.designer || UNASSIGNED)}</span></td>
              <td class="${isLate(it) ? "late" : ""}">${fmtDate(it.due)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  };

  const keyBadge = (x) => {
    if (!x.tiene_clave) return `<span class="key key--off">Sin clave · no puede ingresar</span>`;
    if (!x.clave_actualizada) return `<span class="key key--warn">Clave heredada · conviene cambiarla</span>`;
    return `<span class="key key--ok">Clave propia · desde el ${fmtDay(x.clave_actualizada)}</span>`;
  };

  const renderAdmin = () => {
    const a = state.admin;
    if (!a) return;
    const solo = a.disenadores.length <= 1;
    $("#adminDesigners").innerHTML = a.disenadores.map((d) => {
      const self = d.alias === myAlias();
      return `
        <article class="person">
          <i class="av ${avClassFor(d.orden)}" aria-hidden="true">${esc(d.alias[0].toUpperCase())}</i>
          <div class="person__text">
            <strong>${esc(d.alias)}${self ? ` <em class="you">vos</em>` : ""}</strong>
            <small>${esc(d.nombre)}</small>
            <small>${plural(d.activos, "pedido activo", "pedidos activos")} en su mesa</small>
            ${keyBadge(d)}
          </div>
          <div class="person__actions">
            <button class="secondary sm" type="button" data-key-dis="${esc(d.alias)}">${d.tiene_clave ? "Cambiar clave" : "Poner clave"}</button>
            ${self || solo ? "" : `<button class="link-danger" type="button" data-remove-dis="${esc(d.alias)}">Quitar</button>`}
          </div>
        </article>`;
    }).join("");

    $("#adminAreas").innerHTML = a.areas.length
      ? `<table>
          <thead><tr><th scope="col">Área</th><th scope="col">Clave</th><th scope="col">Pedidos</th><th scope="col" class="cell-actions">Acciones</th></tr></thead>
          <tbody>
            ${a.areas.map((x) => `
              <tr>
                <td class="td-title">${esc(x.nombre)}</td>
                <td>${keyBadge(x)}</td>
                <td>${plural(x.activos, "pedido activo", "pedidos activos")} <span class="muted">· ${x.total} en total</span></td>
                <td class="cell-actions">
                  <button class="secondary sm" type="button" data-key-area="${x.id}">${x.tiene_clave ? "Cambiar clave" : "Poner clave"}</button>
                  <button class="link-danger" type="button" data-remove-area="${x.id}">Quitar</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>`
      : `<div class="empty">Todavía no hay áreas. Creá la primera con «Nueva área».</div>`;

    const legacy = $("#adminLegacy");
    legacy.hidden = !a.sin_area;
    legacy.textContent = a.sin_area
      ? `${plural(a.sin_area, "pedido no está vinculado", "pedidos no están vinculados")} a ningún área (anteriores a este cambio o internos de Diseño): solo los ve Diseño. Podés elegir su área desde el detalle de cada pedido.`
      : "";
  };

  const render = () => {
    if (!state.me) return;
    renderChrome();
    if (NAVS[state.nav].admin) return renderAdmin();
    renderStats();
    if (state.view === "board") renderBoard();
    else renderList();
  };

  /* ---------- Acciones ---------- */

  const find = (id) => state.items.find((i) => i.id === Number(id));

  const moveTo = async (id, status) => {
    const it = find(id);
    if (!it || it.status === status) return;
    if (!isDesigner()) return toast("Solo el equipo de Diseño puede mover pedidos.");
    const prev = it.status;
    it.status = status; // respuesta inmediata en pantalla
    render();
    if (state.openId === it.id) renderDetail();
    try {
      await rpc("mesa_pedido_mover", { p_id: it.id, p_estado: status });
      notify();
      toast(`${it.code} → ${status}`);
      scheduleRefresh();
    } catch (e) {
      it.status = prev;
      render();
      handleError("mover el pedido", e);
    }
  };

  const assign = async (it, designer) => {
    try {
      await rpc("mesa_pedido_asignar", { p_id: it.id, p_disenador: designer });
      notify();
      toast(!designer ? `${it.code} sin asignar` : designer === myAlias() ? `${it.code} pasó a tu mesa` : `${it.code} pasó a la mesa de ${designer}`);
      await fetchData();
    } catch (err) {
      handleError("asignar el pedido", err);
    }
  };

  /* ---------- Detalle ---------- */

  const detailDialog = $("#detailDialog");

  const renderDetail = () => {
    const it = find(state.openId);
    if (!it) return;
    const late = isLate(it);
    const canManage = isDesigner();
    $("#detailBody").innerHTML = `
      <div class="modal-head">
        <div>
          <p class="eyebrow">${esc(it.code)} · ${esc(it.type)}</p>
          <h2 id="detailTitle">${esc(it.title)}</h2>
        </div>
        <button class="close" type="button" data-close aria-label="Cerrar"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="detail-meta">
        <span class="pill"><b>Marca</b>${esc(it.brand)}</span>
        ${canManage ? "" : `<span class="pill"><b>Área</b>${esc(it.area)}</span>`}
        <span class="pill"><b>Prioridad</b>${esc(it.priority)}</span>
        <span class="pill ${late ? "late" : ""}"><b>Entrega</b>${late ? "Vencido · " : ""}${fmtDate(it.due)}</span>
        <span class="pill"><b>Pidió</b>${esc(it.createdBy)}</span>
        ${it.print ? `<span class="pill">Incluye impresión</span>` : ""}
        ${canManage ? "" : `<span class="pill"><b>Estado</b>${esc(it.status)}</span><span class="pill"><b>Mesa</b>${esc(it.designer || UNASSIGNED)}</span>`}
      </div>
      ${canManage ? `
      <div class="detail-controls">
        <label>Estado<select data-field="status">${options(STATUSES.map((s) => s.key), it.status)}</select></label>
        <label>Mesa de<select data-field="designer">${designerOptions(it.designer)}</select></label>
        <label>Área<select data-field="area">${areaOptions(it)}</select></label>
      </div>` : `<p class="readonly-note">El estado y la mesa los maneja Diseño. Podés sumar comentarios abajo.</p>`}
      <section class="detail-section">
        <h4>Descripción</h4>
        <p>${it.description ? esc(it.description) : "Sin descripción."}</p>
      </section>
      ${it.link ? `<section class="detail-section"><h4>Referencias</h4><a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.link)}</a></section>` : ""}
      <section class="detail-section">
        <h4>Comentarios y movimientos</h4>
        ${it.comments.length ? it.comments.map((c) => `
          <div class="comment${c.system ? " comment--system" : ""}"><small>${avatar(c.who)}${esc(c.who)} · ${fmtStamp(c.at)}</small><span class="comment__text">${esc(c.text)}</span></div>`).join("") : `<p class="type">Todavía no hay comentarios.</p>`}
        <form class="row" id="commentForm">
          <label class="sr-only" for="commentInput">Nuevo comentario</label>
          <input id="commentInput" autocomplete="off" placeholder="Escribí un comentario como ${esc(myName())}…" maxlength="1000" />
          <button class="primary" type="submit">Comentar</button>
        </form>
      </section>
      <div class="actions">
        ${canManage ? `<button class="danger" type="button" data-delete>Eliminar solicitud</button>` : ""}
        ${canManage && it.designer !== myAlias() ? `<button class="secondary" type="button" data-take>Pasar a mi mesa</button>` : ""}
        <button class="secondary" type="button" data-close>Cerrar</button>
      </div>`;
  };

  const openDetail = (id) => {
    state.openId = Number(id);
    renderDetail();
    if (!detailDialog.open) detailDialog.showModal();
  };

  detailDialog.addEventListener("close", () => { state.openId = null; });

  detailDialog.addEventListener("change", async (e) => {
    const field = e.target.dataset.field;
    const it = find(state.openId);
    if (!field || !it) return;
    if (field === "status") return moveTo(it.id, e.target.value);
    if (field === "designer") return assign(it, e.target.value || null);
    if (field === "area") {
      const areaId = Number(e.target.value) || 0;
      try {
        await rpc("mesa_pedido_area", { p_id: it.id, p_area_id: areaId });
        notify();
        toast(`${it.code} → ${areaId ? e.target.selectedOptions[0].textContent : INTERNAL}`);
        await fetchData();
      } catch (err) {
        handleError("cambiar el área", err);
      }
    }
  });

  detailDialog.addEventListener("submit", async (e) => {
    if (e.target.id !== "commentForm") return;
    e.preventDefault();
    const input = $("#commentInput");
    const text = input.value.trim();
    const it = find(state.openId);
    if (!text || !it) return;
    input.disabled = true;
    try {
      await rpc("mesa_pedido_comentar", { p_id: it.id, p_texto: text });
      notify();
      await fetchData();
      $("#commentInput")?.focus();
    } catch (err) {
      input.disabled = false;
      handleError("guardar el comentario", err);
    }
  });

  detailDialog.addEventListener("click", async (e) => {
    if (e.target === detailDialog || e.target.closest("[data-close]")) return detailDialog.close();
    const it = find(state.openId);
    if (!it) return;
    if (e.target.closest("[data-take]")) return assign(it, myAlias());
    if (e.target.closest("[data-delete]")) {
      if (!confirm(`¿Eliminar ${it.code} «${it.title}»? Se borra para todo el equipo.`)) return;
      try {
        await rpc("mesa_pedido_eliminar", { p_id: it.id });
        notify();
        detailDialog.close();
        toast(`${it.code} eliminado`);
        await fetchData();
      } catch (err) {
        handleError("eliminar el pedido", err);
      }
    }
  });

  /* ---------- Nueva solicitud ---------- */

  const newDialog = $("#newDialog");
  const newForm = $("#newForm");

  const fillNewForm = () => {
    const sources = {
      brands: options(BRANDS, BRANDS[0]),
      areas: areaOptions(null),
      types: options(Object.keys(TYPES), "Pieza gráfica"),
      priorities: options(PRIORITIES, "Media"),
      designers: designerOptions(myAlias()),
    };
    $$("[data-options]", newForm).forEach((sel) => { sel.innerHTML = sources[sel.dataset.options]; });
    $("#newAreaField").hidden = !isDesigner();
    $("#newDesignerField").hidden = !isDesigner();
    $("#newEyebrow").textContent = isDesigner() ? "Nueva solicitud" : `Nueva solicitud · ${state.me.area}`;
  };

  const openNew = () => {
    newForm.reset();
    fillNewForm();
    const d = new Date();
    d.setDate(d.getDate() + 7);
    newForm.elements.due.value = isoDay(d);
    newDialog.showModal();
    newForm.elements.title.focus();
  };

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = newForm.elements;
    const title = f.title.value.trim();
    if (!title) {
      f.title.setCustomValidity("Poné un título para el pedido.");
      f.title.reportValidity();
      return;
    }
    if (!f.due.value) {
      f.due.reportValidity();
      return;
    }
    const link = f.link.value.trim();
    const pedido = {
      titulo: title,
      marca: f.brand.value,
      area_id: isDesigner() ? Number(f.area.value) || null : null,
      tipo: f.type.value,
      prioridad: f.priority.value,
      disenador: isDesigner() ? f.designer.value : "",
      entrega: f.due.value,
      impresion: f.print.checked,
      link: /^https?:\/\//i.test(link) ? link : "",
      descripcion: f.description.value.trim(),
    };
    const btn = newForm.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const id = await rpc("mesa_pedido_crear", { p_pedido: pedido });
      notify();
      newDialog.close();
      toast(isDesigner() ? `${code(id)} creado en «Nuevas»` : `${code(id)} enviado a Diseño`);
      await fetchData();
    } catch (err) {
      handleError("crear la solicitud", err);
    } finally {
      btn.disabled = false;
    }
  });

  newForm.elements.title.addEventListener("input", (e) => e.target.setCustomValidity(""));

  newDialog.addEventListener("click", (e) => {
    if (e.target === newDialog || e.target.closest("[data-close]")) newDialog.close();
  });

  /* ---------- Perfiles y áreas (solo Diseño) ---------- */

  const adminCall = async (fn, args, okMsg) => {
    try {
      await rpc(fn, args);
      notify();
      toast(okMsg);
      await fetchData();
      return true;
    } catch (err) {
      handleError("guardar el cambio", err);
      return false;
    }
  };

  const toggleForm = (id, show) => {
    const form = $(`#${id}`);
    form.hidden = show === undefined ? !form.hidden : !show;
    if (!form.hidden) form.elements[0].focus();
    else form.reset();
  };

  $("#admin").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || !state.admin) return;
    const { toggleForm: formId, keyDis, keyArea, removeDis, removeArea } = b.dataset;
    if (formId) return toggleForm(formId);
    if (keyDis) return openKeyDialog({ kind: "disenador", id: keyDis, name: keyDis });
    if (keyArea) {
      const area = state.admin.areas.find((x) => String(x.id) === keyArea);
      return openKeyDialog({ kind: "area", id: Number(keyArea), name: area ? area.nombre : "el área" });
    }
    if (removeDis) {
      const d = state.admin.disenadores.find((x) => x.alias === removeDis);
      const extra = d && d.activos ? ` Sus ${plural(d.activos, "pedido abierto queda", "pedidos abiertos quedan")} sin asignar.` : "";
      if (!confirm(`¿Quitar el perfil de ${removeDis}? Ya no va a poder ingresar.${extra}`)) return;
      return adminCall("mesa_admin_disenador", { p_accion: "quitar", p_alias: removeDis }, `Perfil de ${removeDis} quitado del ingreso.`);
    }
    if (removeArea) {
      const area = state.admin.areas.find((x) => String(x.id) === removeArea);
      const name = area ? area.nombre : "esta área";
      if (!confirm(`¿Quitar el área ${name}? Ya no va a poder ingresar ni pedir. Sus pedidos quedan guardados y Diseño los sigue viendo.`)) return;
      return adminCall("mesa_admin_area", { p_accion: "quitar", p_id: Number(removeArea) }, `Área ${name} quitada del ingreso.`);
    }
  });

  $("#formDisenador").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = form.elements;
    const alias = f.alias.value.trim().replace(/\s+/g, " ");
    const clave = normKey(f.clave.value);
    if (!alias) { f.alias.focus(); return toast("Escribí el nombre corto (así aparece en el ingreso)."); }
    if (clave.length < 4) { f.clave.focus(); return toast("La clave tiene que tener al menos 4 caracteres."); }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const ok = await adminCall("mesa_admin_disenador",
      { p_accion: "crear", p_alias: alias, p_nombre: f.nombre.value.trim() || null, p_clave: clave },
      `Perfil de ${alias} creado: ya aparece en el ingreso con su mesa.`);
    btn.disabled = false;
    if (ok) toggleForm("formDisenador", false);
  });

  $("#formArea").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = form.elements;
    const nombre = f.nombre.value.trim().replace(/\s+/g, " ");
    const clave = normKey(f.clave.value);
    if (!nombre) { f.nombre.focus(); return toast("Escribí el nombre del área."); }
    if (clave.length < 4) { f.clave.focus(); return toast("La clave tiene que tener al menos 4 caracteres."); }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const ok = await adminCall("mesa_admin_area",
      { p_accion: "crear", p_nombre: nombre, p_clave: clave },
      `Área ${nombre} creada: ya puede ingresar con su clave.`);
    btn.disabled = false;
    if (ok) toggleForm("formArea", false);
  });

  // Cambiar clave
  const keyDialog = $("#keyDialog");
  const keyForm = $("#keyForm");
  const keyError = $("#keyError");

  const openKeyDialog = (target) => {
    state.keyTarget = target;
    keyForm.reset();
    keyError.hidden = true;
    $("#keyTitle").textContent = `Nueva clave para ${target.name}`;
    $("#keyHelp").textContent = target.kind === "area"
      ? `Las personas de ${target.name} van a ingresar con esta clave. Las sesiones abiertas del área se cierran.`
      : target.id === myAlias()
        ? "Es tu clave personal. Tus otras sesiones abiertas se cierran; esta sigue activa."
        : `Es la clave personal de ${target.name}. Sus sesiones abiertas se cierran.`;
    keyDialog.showModal();
    keyForm.elements.clave.focus();
  };

  keyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = state.keyTarget;
    const clave = normKey(keyForm.elements.clave.value);
    if (!t) return;
    if (clave.length < 4) {
      keyError.textContent = "La clave tiene que tener al menos 4 caracteres.";
      keyError.hidden = false;
      return;
    }
    const btn = keyForm.querySelector("button[type=submit]");
    btn.disabled = true;
    const ok = t.kind === "area"
      ? await adminCall("mesa_admin_area", { p_accion: "clave", p_id: t.id, p_clave: clave }, `Clave de ${t.name} actualizada.`)
      : await adminCall("mesa_admin_disenador", { p_accion: "clave", p_alias: t.id, p_clave: clave }, `Clave de ${t.name} actualizada.`);
    btn.disabled = false;
    if (ok) keyDialog.close();
  });

  keyDialog.addEventListener("click", (e) => {
    if (e.target === keyDialog || e.target.closest("[data-close]")) keyDialog.close();
  });

  /* ---------- Eventos generales ---------- */

  $$("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      state.nav = b.dataset.nav;
      const v = NAVS[state.nav].view;
      if (v) state.view = v;
      render();
    })
  );

  $$("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.view;
      render();
    })
  );

  $("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
  $("#fBrand").addEventListener("change", (e) => { state.brand = e.target.value; render(); });
  $("#fDesigner").addEventListener("change", (e) => { state.designer = e.target.value; render(); });
  $("#fArea").addEventListener("change", (e) => { state.area = e.target.value; render(); });
  $("#newBtn").addEventListener("click", openNew);

  // Abrir detalle desde tarjeta o fila
  document.addEventListener("click", (e) => {
    const el = e.target.closest(".card[data-id], tbody tr[data-id]");
    if (el) openDetail(el.dataset.id);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest?.(".card[data-id], tbody tr[data-id]");
    if (el && e.target === el) {
      e.preventDefault();
      openDetail(el.dataset.id);
    }
  });

  // Arrastrar y soltar entre columnas (solo Diseño)
  const board = $("#board");
  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".card");
    if (!card || !isDesigner()) return;
    e.dataTransfer.setData("text/plain", card.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  board.addEventListener("dragend", (e) => {
    e.target.closest?.(".card")?.classList.remove("dragging");
    $$(".column.drop", board).forEach((c) => c.classList.remove("drop"));
  });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".column");
    if (!col || !isDesigner()) return;
    e.preventDefault();
    $$(".column.drop", board).forEach((c) => c !== col && c.classList.remove("drop"));
    col.classList.add("drop");
  });
  board.addEventListener("drop", (e) => {
    const col = e.target.closest(".column");
    if (!col || !isDesigner()) return;
    e.preventDefault();
    col.classList.remove("drop");
    moveTo(e.dataTransfer.getData("text/plain"), col.dataset.status);
  });

  // Al volver a la pestaña, se ponen al día los datos
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.token) scheduleRefresh();
  });

  /* ---------- Inicio ---------- */

  if (!sb) {
    lock();
    showAuthError("No se pudo cargar la conexión con la base de datos. Revisá tu conexión y recargá la página.");
    return;
  }

  const saved = stored.get();
  if (saved) start(saved);
  else showLogin();
})();
