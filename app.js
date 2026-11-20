/* Mesa de Diseño · Gastro BS AS (v2.2)
   Datos compartidos en Supabase; todo pasa por funciones mesa_* que validan el token de sesión.
   · Diseño (Naza, Agus): Mi trabajo (su mesa + trabajos en conjunto «x 2»), Tablero de pedidos,
     Tablero General (planilla histórica + pedidos de las áreas), lista editable, estadísticas,
     contador privado de modificaciones y panel de Perfiles y áreas.
   · Áreas solicitantes: solo sus pedidos, sus estadísticas y el formulario de nueva solicitud. */
(() => {
  "use strict";

  /* ---------- Catálogos ---------- */

  const STATUSES = [
    { key: "No iniciado", color: "#c9b79c" },
    { key: "En proceso", color: "#4f8a78" },
    { key: "Falta info", color: "#c79a3a" },
    { key: "Requiere modificación", color: "#b5573a" },
    { key: "Terminado", color: "#a68a64" },
    { key: "Finalizado", color: "#11382b" },
  ];
  const STATUS_KEYS = STATUSES.map((s) => s.key);
  const NEW = "No iniciado";
  const DONE = "Finalizado";
  const IN_PRODUCTION = ["En proceso"];
  const IN_REVIEW = ["Falta info", "Requiere modificación"];
  const PRIORITIES = ["A definir", "Urgente", "Alta", "Media", "Baja"];
  const X2 = "x 2";
  const UNASSIGNED = "Sin asignar";
  const NONE = "__none";
  const INTERNAL = "Diseño (interno)";
  const CORPORATE = "Gastro (corporativo)";
  const FACTORIES = "Fábricas";

  // Tipo de pieza → variante de etiqueta
  const PIECES = [
    ["Pieza gráfica", "ext"],
    ["Manual", "man"],
    ["Capacitación", ""],
    ["Presentación", ""],
    ["Organigrama", ""],
    ["Señalética", "ext"],
    ["Logo / identidad", "ext"],
    ["Otro", ""],
  ];
  const PIECE_CLASS = Object.fromEntries(PIECES);

  const BRANDS = [
    "Sabores Express ARG.",
    "Sabores Express España",
    "Hamburguesas Extremas",
    "Empanadas Manía",
    "Empanadas Manía Franquicias",
    "Pizza Free",
    "Bella Ragazza",
    "Puerto Milanesa",
    "Lomitos Jacks",
    "Costa",
    "Multimarca (SE/EXT/M)",
  ];

  // Color de avatar de cada perfil de Diseño, según su orden (Naza 0, Agus 1, …)
  const AV_CLASSES = ["av-n", "av-a", "av-b", "av-c", "av-d"];
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const SESSION_KEY = "mesa-diseno-sesion-v3";
  const LAST_KEY = "mesa-diseno-ultimo-ingreso";
  const POLL_MS = 30000;
  const FINAL_CAP = 20; // tarjetas visibles en «Finalizado» antes de «Mostrar todas»
  const LIST_PAGE = 60;
  const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

  /* ---------- Estado ---------- */

  const state = {
    token: null,
    me: null, // { tipo: "diseno" | "area", nombre, disenador, lider, area_id, area }
    today: null,
    team: [],
    areas: [],
    admin: null,
    items: [],
    loaded: false,
    nav: null,
    view: "board",
    scope: "mio", // alcance de Mi trabajo para el líder: mio | equipo | libres
    q: "",
    brand: "",
    designer: "",
    area: "",
    date: { mode: "", day: "", month: "", year: "", from: "", to: "" },
    showAllDone: false,
    listLimit: LIST_PAGE,
    openId: null,
    detailDirty: false,
    dMods: 0,
    keyTarget: null,
    nf: { piece: "Pieza gráfica", dest: "corporate", brand: BRANDS[0] },
    login: { disenadores: [], areas: [] },
  };

  const isDesigner = () => Boolean(state.me && state.me.tipo === "diseno");
  const isLeader = () => isDesigner() && Boolean(state.me.lider);
  const myName = () => (state.me ? state.me.nombre : "");
  const myAlias = () => (state.me ? state.me.disenador : null);
  const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const isMine = (it) => it.designer === myAlias() || it.joint;
  const activeItems = (list) => list.filter((i) => i.status !== DONE);
  const unassignedCount = () => state.items.filter((i) => !i.assignee && i.status !== DONE).length;
  const myScope = () => (state.nav === "mio" ? (isLeader() ? state.scope : "mio") : null);

  const NAVS = {
    mio: {
      label: "Mi trabajo",
      eyebrow: () => `Mesa personal · ${myAlias()}`,
      title: () => `Mi trabajo · ${myAlias()}`,
      sub: () => {
        const scope = myScope();
        if (scope === "equipo") return "Todo el equipo: las mesas de cada integrante y los trabajos en conjunto (x 2).";
        if (scope === "libres") return "Pedidos sin asignar: revisalos y derivalos a una mesa.";
        const n = unassignedCount();
        return "Tus tareas, los trabajos en conjunto (x 2) y el control de modificaciones." +
          (n ? ` Hay ${n} pedido${n > 1 ? "s" : ""} sin asignar en el Tablero General.` : "");
      },
      view: "board",
    },
    tablero: {
      label: "Tablero de pedidos",
      eyebrow: () => "De la idea a la entrega",
      title: () => "Tablero de pedidos",
      sub: () => "Cada pedido, en la etapa en la que está. Filtrá por área, marca o diseñador.",
      view: "board",
    },
    general: {
      label: "Tablero General",
      eyebrow: () => "Base centralizada",
      title: () => "Tablero General",
      sub: () => "El 100% de los proyectos: la planilla histórica, los proyectos de Diseño y los pedidos de todas las áreas.",
      view: "list",
    },
    accesos: {
      label: "Perfiles y áreas",
      eyebrow: () => "Configuración exclusiva de Diseño",
      title: () => "Perfiles y áreas",
      sub: () => "Quiénes integran Diseño, qué áreas pueden pedir y la clave de cada una. Los solicitantes no ven este panel.",
      admin: true,
    },
    area: {
      label: "Tablero del área",
      eyebrow: () => `Área · ${state.me.area}`,
      title: () => (state.view === "stats" ? "Estadísticas de mi área" : `Pedidos de ${state.me.area}`),
      sub: () => (state.view === "stats"
        ? `Los trabajos de ${state.me.area} junto al equipo de Diseño.`
        : `Hola, ${myName()}. Solo ves los pedidos de tu área; los de otras áreas quedan aislados.`),
      view: "board",
    },
  };
  const NAVS_BY_ROLE = { diseno: ["mio", "tablero", "general", "accesos"], area: ["area"] };
  const VIEWS_BY_ROLE = { diseno: ["board", "list", "stats"], area: ["board", "stats"] };

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
  const addDays = (iso, n) => {
    const [y, m, d] = iso.split("-").map(Number);
    return isoDay(new Date(y, m - 1, d + n));
  };
  const daysBetween = (a, b) => {
    const [y1, m1, d1] = a.split("-").map(Number);
    const [y2, m2, d2] = b.split("-").map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  };

  const fmtDate = (iso) => {
    if (!iso) return "—";
    const [, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]}`;
  };
  const fmtFullDate = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  };
  const fmtDay = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };
  const fmtStamp = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const monthLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    const name = MONTH_NAMES[m - 1];
    return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
  };
  const shortMonth = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  };

  const code = (n) => `DIS-${String(n).padStart(3, "0")}`;
  const isLate = (it) => it.status !== DONE && it.due && it.due < (state.today || today());
  const two = (n) => String(n).padStart(2, "0");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const num = (n, digits = 1) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // Promedios chicos (menos de 1) con dos decimales para que no queden en «0,0»
  const avgFmt = (n) => num(n, Math.abs(n) < 1 && n !== 0 ? 2 : 1);
  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

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

  // Avatar del asignado: un diseñador, «x 2» (todo el equipo) o sin asignar
  const assigneeHTML = (it) => {
    if (it.joint) {
      return `<span class="duo" aria-hidden="true">${state.team.slice(0, 2).map((d) => avatar(d.alias)).join("")}</span>${X2}`;
    }
    return `${avatar(it.designer)}${esc(it.designer || UNASSIGNED)}`;
  };

  const statusColor = (key) => (STATUSES.find((s) => s.key === key) || STATUSES[0]).color;

  const options = (list, selected) =>
    list.map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  // Opciones de asignación: Sin asignar, cada perfil activo y «x 2»
  const assigneeOptions = (selected) => {
    const aliases = state.team.map((d) => d.alias);
    if (selected && selected !== X2 && !aliases.includes(selected)) aliases.push(selected);
    return `<option value=""${!selected ? " selected" : ""}>${UNASSIGNED}</option>` +
      aliases.map((a) => `<option value="${esc(a)}"${a === selected ? " selected" : ""}>${esc(a)}</option>`).join("") +
      `<option value="${X2}"${selected === X2 ? " selected" : ""}>x 2</option>`;
  };

  // Áreas de un pedido. Si no está vinculado a un área activa, se muestra su nombre guardado.
  const areaOptions = (it) => {
    const linked = it && it.areaId && state.areas.some((a) => a.id === it.areaId);
    const internal = !it || (!it.areaId && it.area === INTERNAL);
    const legacy = it && !linked && !internal ? it.area : null;
    const selectedId = it ? (linked ? it.areaId : null) : null;
    return (legacy ? `<option value="" selected disabled>${esc(legacy)} · elegí un área</option>` : "") +
      state.areas.map((a) => `<option value="${a.id}"${a.id === selectedId ? " selected" : ""}>${esc(a.nombre)}</option>`).join("") +
      `<option value="0"${!legacy && !selectedId ? " selected" : ""}>${INTERNAL}</option>`;
  };

  let toastTimer;
  const toast = (msg, action) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("has-action", Boolean(action));
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "toast__undo";
      b.textContent = action.label || "Deshacer";
      b.addEventListener("click", () => {
        el.classList.remove("show", "has-action");
        action.run();
      }, { once: true });
      el.appendChild(b);
    }
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show", "has-action"), action ? 5200 : 3200);
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
    codigo: r.codigo,
    code: code(r.codigo),
    title: r.titulo,
    brand: r.marca,
    area: r.area,
    areaId: r.area_id,
    type: r.tipo,
    priority: r.prioridad,
    designer: r.disenador,
    joint: Boolean(r.conjunto),
    assignee: r.conjunto ? X2 : r.disenador || null,
    due: r.entrega,
    status: r.estado,
    link: r.link,
    linkFinal: r.link_final,
    description: r.descripcion,
    notes: r.observaciones ?? null,
    mods: r.modificaciones ?? 0,
    start: r.fecha_inicio,
    end: r.fecha_fin,
    origin: r.origen,
    createdBy: r.creado_por,
    comments: [],
  });

  const fetchData = async () => {
    const d = await rpc("mesa_tablero");
    state.me = d.yo;
    state.today = d.hoy || today();
    state.team = d.disenadores || [];
    state.areas = d.areas || [];
    state.admin = d.admin || null;

    const byId = new Map((d.pedidos || []).map((r) => [r.id, fromRow(r)]));
    (d.comentarios || []).forEach((r) => {
      byId.get(r.pedido_id)?.comments.push({ who: r.autor, at: r.created_at, text: r.texto, system: r.sistema });
    });
    // Los que están por borrarse (con «Deshacer» disponible) no vuelven a aparecer
    const next = [...byId.values()].filter((i) => !pendingDeletes.has(i.id));

    // Aviso de pedidos nuevos cargados por otra persona
    if (state.loaded) {
      const known = new Set(state.items.map((i) => i.id));
      const fresh = next.filter((i) => !known.has(i.id) && !sameName(i.createdBy, myName()));
      if (fresh.length === 1) toast(`Nuevo pedido de ${fresh[0].createdBy} (${fresh[0].area}): ${fresh[0].title}`);
      else if (fresh.length > 1) toast(`${fresh.length} pedidos nuevos en el tablero.`);
    }

    state.items = next;
    state.loaded = true;
    const role = state.me.tipo;
    if (!NAVS_BY_ROLE[role].includes(state.nav)) state.nav = NAVS_BY_ROLE[role][0];
    if (!VIEWS_BY_ROLE[role].includes(state.view)) state.view = "board";
    render();
    if (state.openId && detailDialog.open) {
      if (!find(state.openId)) detailDialog.close();
      else if (!state.detailDirty) renderDetail();
    }
  };

  const refresh = async () => {
    if (!state.token) return;
    try { await fetchData(); } catch (e) { handleError("actualizar los pedidos", e); }
  };

  let refreshTimer;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
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
    [detailDialog, newDialog, keyDialog].forEach((d) => { if (d.open) d.close(); });
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
    state.view = "board";
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
    // Primero se confirman los borrados pendientes; después, al tocar «Salir», se cierra la sesión en la base
    const token = state.token;
    const flushing = flushDeletes();
    if (token && !msg) flushing.then(() => sb.rpc("mesa_cerrar_sesion", { p_token: token })).then(() => {}, () => {});
    disconnectLive();
    stored.clear();
    Object.assign(state, { token: null, me: null, admin: null, items: [], loaded: false, nav: null, view: "board", openId: null });
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
      lastLogin.set(tipo === "diseno" ? { ...prev, tipo, perfil: quien } : { ...prev, tipo, area: quien, nombre });
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

  const scoped = () => {
    if (!isDesigner()) return state.items; // la base ya devuelve solo los del área
    const scope = myScope();
    if (scope === "equipo" || !scope) return state.items;
    if (scope === "libres") return state.items.filter((i) => !i.assignee);
    return state.items.filter(isMine);
  };

  const designerFilterOn = () => isDesigner() && (state.nav !== "mio" || myScope() === "equipo");

  const inDates = (it) => {
    const { mode, day, month, year, from, to } = state.date;
    if (!mode) return true;
    const s = it.start || "";
    const e = it.end || "";
    if (mode === "day") return !day || s === day || e === day;
    if (mode === "month") return !month || s.startsWith(month) || e.startsWith(month);
    if (mode === "year") return !year || s.startsWith(year) || e.startsWith(year);
    const inRange = (d) => Boolean(d) && (!from || d >= from) && (!to || d <= to);
    return inRange(s) || inRange(e);
  };

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    return scoped().filter((it) => {
      if (state.brand && it.brand !== state.brand) return false;
      if (designerFilterOn() && state.designer) {
        if (state.designer === NONE ? it.assignee : it.assignee !== state.designer) return false;
      }
      if (isDesigner() && state.area) {
        if (state.area === NONE ? it.areaId : String(it.areaId) !== state.area) return false;
      }
      if (!inDates(it)) return false;
      if (!q) return true;
      return [it.code, it.codigo, it.title, it.brand, it.area, it.type, it.assignee, it.status, it.createdBy]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  };

  // Rearma un <select> solo si cambiaron sus opciones, conservando lo elegido
  const syncSelect = (el, html, read, write) => {
    if (el.dataset.sig !== html) {
      el.dataset.sig = html;
      el.innerHTML = html;
    }
    el.value = read();
    if (el.value !== read()) write(el.value);
  };

  const syncFilters = () => {
    const brands = [...new Set([CORPORATE, FACTORIES, ...BRANDS, ...state.items.map((i) => i.brand)])].filter(Boolean);
    syncSelect($("#fBrand"), `<option value="">Todas las marcas</option>` + options(brands, ""),
      () => state.brand, (v) => { state.brand = v; });
    syncSelect($("#fDesigner"),
      `<option value="">Todo el equipo</option><option value="${NONE}">Sin asignar</option>` +
      state.team.map((d) => `<option value="${esc(d.alias)}">${esc(d.alias)}</option>`).join("") +
      `<option value="${X2}">x 2 (en conjunto)</option>`,
      () => state.designer, (v) => { state.designer = v; });
    syncSelect($("#fArea"),
      `<option value="">Todas las áreas</option>` +
      state.areas.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("") +
      `<option value="${NONE}">Sin área (histórico e internos)</option>`,
      () => state.area, (v) => { state.area = v; });

    // Meses y años con datos, del más reciente al más viejo
    const months = new Set([state.today.slice(0, 7)]);
    state.items.forEach((i) => [i.start, i.end].forEach((d) => d && months.add(d.slice(0, 7))));
    const monthList = [...months].sort().reverse();
    const years = [...new Set(monthList.map((m) => m.slice(0, 4)))];
    if (!state.date.month) state.date.month = state.today.slice(0, 7);
    if (!state.date.year) state.date.year = state.today.slice(0, 4);
    if (!state.date.day) state.date.day = state.today;
    if (!state.date.from) state.date.from = `${state.today.slice(0, 7)}-01`;
    if (!state.date.to) state.date.to = state.today;
    syncSelect($("#fMonth"), monthList.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join(""),
      () => state.date.month, (v) => { state.date.month = v; });
    syncSelect($("#fYear"), years.map((y) => `<option value="${y}">${y}</option>`).join(""),
      () => state.date.year, (v) => { state.date.year = v; });
    $("#fDay").value = state.date.day;
    $("#fFrom").value = state.date.from;
    $("#fTo").value = state.date.to;

    const mode = state.date.mode;
    $("#fDate").value = mode;
    $("#dateControls").hidden = !mode;
    $("#fDay").hidden = mode !== "day";
    $("#fMonth").hidden = mode !== "month";
    $("#fYear").hidden = mode !== "year";
    $("#fRange").hidden = mode !== "range";
    $("#dataActions").hidden = !(isDesigner() && state.nav === "general");
    $("#toolbarSub").hidden = $("#dateControls").hidden && $("#dataActions").hidden;

    const fd = $("#fDesigner");
    fd.disabled = !designerFilterOn();
    if (fd.disabled) {
      fd.value = "";
      state.designer = "";
    }
  };

  /* ---------- Render: marco ---------- */

  const renderKpis = (items) => {
    $("#stActive").textContent = two(activeItems(items).length);
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

    $$(".nav [data-nav]").forEach((b) => {
      const setView = b.dataset.setView;
      const on = b.dataset.nav === state.nav &&
        (setView ? state.view === setView : !$(`.nav [data-nav="${b.dataset.nav}"][data-set-view="${state.view}"]`));
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    $("#myCount").textContent = activeItems(state.items.filter(isMine)).length;
    $("#areaCount").textContent = activeItems(state.items).length;

    const isAdmin = Boolean(nav.admin);
    $("#workArea").hidden = isAdmin;
    $("#admin").hidden = !isAdmin;
    $("#newBtn").hidden = isAdmin;
    $("#newBtnLabel").textContent = isDesigner() ? "Nuevo proyecto" : "Nueva solicitud";
    $("#statsTabLabel").textContent = isDesigner() ? "Estadísticas" : "Estadísticas de mi área";

    const scopeBar = $("#scopeBar");
    scopeBar.hidden = !(isLeader() && state.nav === "mio");
    $$("[data-scope]", scopeBar).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.scope === state.scope)));

    $$("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    $("#board").hidden = state.view !== "board";
    $("#list").hidden = state.view !== "list";
    $("#stats").hidden = state.view !== "stats";
    $("#kpis").hidden = state.view === "stats";

    syncFilters();

    const av = $("#meAvatar");
    const meMember = isDesigner() ? teamMember(myAlias()) : null;
    av.textContent = (myName()[0] || "?").toUpperCase();
    av.className = `av ${meMember ? avClassFor(meMember.orden) : ""}`;
    $("#meName").textContent = myName();
    $("#meRole").textContent = isDesigner() ? (isLeader() ? "Diseño · Líder" : "Diseño") : state.me.area;
    $("#teamAvatars").innerHTML = state.team.map((d) => avatar(d.alias)).join("");
  };

  /* ---------- Render: tablero ---------- */

  const modsBadge = (it) =>
    isDesigner() && it.mods > 0
      ? `<span class="badge badge--mods" title="Modificaciones solicitadas (solo Diseño)"><svg class="ico" aria-hidden="true"><use href="#i-loop"/></svg>${it.mods} modif.</span>`
      : "";

  const cardHTML = (it) => {
    const late = isLate(it);
    const n = it.comments.filter((c) => !c.system).length;
    const free = isDesigner() && !it.assignee && it.status !== DONE;
    const badges = [
      it.linkFinal ? `<span class="badge badge--ok"><svg class="ico" aria-hidden="true"><use href="#i-link"/></svg>Archivo final</span>` : "",
      modsBadge(it),
    ].join("");
    return `
      <article class="card${free ? " card--free" : ""}" tabindex="0" draggable="${isDesigner()}" data-id="${it.id}" aria-label="${esc(it.code)}: ${esc(it.title)}">
        <div class="card-top"><span class="tag ${PIECE_CLASS[it.type] ?? ""}">${esc(it.type)}</span><span class="id">${esc(it.code)}</span></div>
        <h3>${esc(it.title)}</h3>
        <div class="type">${esc(it.brand)} · <b>${esc(it.area)}</b></div>
        <span class="priority" data-p="${esc(it.priority)}">Prioridad ${esc(it.priority.toLowerCase())}</span>
        ${badges ? `<div class="badges">${badges}</div>` : ""}
        <div class="card-bottom">
          <span class="who">${assigneeHTML(it)}</span>
          <span class="meta-right">
            ${n ? `<span class="comments-count" title="${n} comentario${n > 1 ? "s" : ""}"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg>${n}</span>` : ""}
            <span class="${late ? "late" : ""}" title="Fecha ideal de entrega">${late ? "Vencido · " : ""}${fmtDate(it.due)}</span>
          </span>
        </div>
      </article>`;
  };

  const byDue = (a, b) => (a.due || "9").localeCompare(b.due || "9") || b.codigo - a.codigo;
  const byEndDesc = (a, b) => (b.end || b.start || "").localeCompare(a.end || a.start || "") || b.codigo - a.codigo;

  const renderBoard = (items) => {
    const boardEl = $("#board");
    const keepLeft = boardEl.scrollLeft;
    boardEl.innerHTML = STATUSES.map((s) => {
      let col = items.filter((i) => i.status === s.key);
      col.sort(s.key === DONE ? byEndDesc : byDue);
      const total = col.length;
      let more = "";
      if (s.key === DONE && !state.showAllDone && total > FINAL_CAP) {
        col = col.slice(0, FINAL_CAP);
        more = `<button class="column-more" type="button" data-more-done>Mostrar las ${total} finalizadas</button>`;
      }
      return `
        <section class="column" data-status="${esc(s.key)}" aria-label="${esc(s.key)}">
          <div class="column-head"><span class="dot" style="--color:${s.color}"></span>${esc(s.key)}<span class="count">${total}</span></div>
          ${col.length ? col.map(cardHTML).join("") : `<div class="empty">Sin pedidos</div>`}
          ${more}
        </section>`;
    }).join("");
    boardEl.scrollLeft = keepLeft;
  };

  /* ---------- Render: lista editable (Diseño) ---------- */

  const emptyText = () => {
    if (state.items.length && scoped().length) return "No hay pedidos con estos filtros.";
    if (state.nav === "mio" && myScope() === "mio") return "Tu mesa está vacía. Tomá un pedido desde el Tablero General.";
    return "Todavía no hay pedidos. Creá el primero con el botón de arriba.";
  };

  const renderList = (items) => {
    if (!items.length) {
      $("#list").innerHTML = `<div class="empty">${emptyText()}</div>`;
      return;
    }
    // Orden fijo por código, como una planilla: cambiar el estado no mueve la fila
    const sorted = [...items].sort((a, b) => b.codigo - a.codigo);
    const shown = sorted.slice(0, state.listLimit);
    $("#list").innerHTML = `
      <table class="sheet">
        <thead><tr>
          <th scope="col">Pedido</th><th scope="col">Marca · Área</th><th scope="col">Prioridad</th><th scope="col">Estado</th>
          <th scope="col">Asignado</th><th scope="col" class="c" title="Modificaciones solicitadas (solo Diseño)">Modif.</th>
          <th scope="col">Entrega</th><th scope="col" class="r">Acciones</th>
        </tr></thead>
        <tbody>
          ${shown.map((it) => `
            <tr data-row="${it.id}">
              <td class="sheet__title"><span class="id">${esc(it.code)}</span><span class="td-title">${esc(it.title)}</span>${it.linkFinal ? `<svg class="ico ico--ok" aria-label="Tiene archivo final"><use href="#i-link"/></svg>` : ""}</td>
              <td>${esc(it.brand)} <span class="muted">· ${esc(it.area)}</span></td>
              <td><select data-edit="prioridad" aria-label="Prioridad de ${esc(it.code)}">${options(PRIORITIES, it.priority)}</select></td>
              <td><select data-edit="estado" aria-label="Estado de ${esc(it.code)}" style="--color:${statusColor(it.status)}">${options(STATUS_KEYS, it.status)}</select></td>
              <td><select data-edit="asignado" aria-label="Asignado de ${esc(it.code)}">${assigneeOptions(it.assignee)}</select></td>
              <td class="c">
                <span class="counter" role="group" aria-label="Modificaciones de ${esc(it.code)}">
                  <button type="button" data-mods="-1" aria-label="Restar una modificación"${it.mods ? "" : " disabled"}>−</button>
                  <b>${it.mods}</b>
                  <button type="button" data-mods="1" aria-label="Sumar una modificación">+</button>
                </span>
              </td>
              <td class="${isLate(it) ? "late" : ""}">${fmtDate(it.due)}</td>
              <td class="r nowrap">
                <button class="secondary sm" type="button" data-open>Editar</button>
                <button class="trash" type="button" data-del aria-label="Eliminar ${esc(it.code)}"><svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="sheet__foot">
        <span>${shown.length} de ${sorted.length} pedidos</span>
        ${sorted.length > shown.length ? `<button class="secondary sm" type="button" data-more-rows>Mostrar ${Math.min(LIST_PAGE, sorted.length - shown.length)} más</button>` : ""}
      </div>`;
  };

  /* ---------- Render: estadísticas ---------- */

  const VIZ_1 = "var(--viz-1)"; // verde: serie principal / individual
  const VIZ_2 = "var(--viz-2)"; // tierra: trabajos en conjunto

  const countBy = (list, key) => {
    const m = new Map();
    list.forEach((i) => {
      const k = typeof key === "function" ? key(i) : i[key];
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  };

  const tile = (label, value, note = "") =>
    `<div class="vtile"><small>${esc(label)}</small><strong>${value}</strong>${note ? `<span>${note}</span>` : ""}</div>`;

  // Barras horizontales ordenadas (una sola serie, un solo color)
  const rankedBars = (rows, { unit = ["proyecto", "proyectos"], fmt = (v) => v, max: maxRows = 8, total } = {}) => {
    if (!rows.length) return `<p class="viz__empty">Sin datos para estos filtros.</p>`;
    let list = rows;
    if (rows.length > maxRows) {
      const rest = rows.slice(maxRows - 1);
      list = [...rows.slice(0, maxRows - 1), { name: `Otras (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0) }];
    }
    const max = Math.max(...list.map((r) => r.value), 1);
    return `<ul class="bars">${list.map((r) => {
      const share = total ? ` · ${pct(r.value, total)}%` : "";
      const tip = `${r.name}: ${fmt(r.value)} ${r.value === 1 ? unit[0] : unit[1]}${share}${r.note ? ` · ${r.note}` : ""}`;
      return `
        <li tabindex="0" data-tip="${esc(tip)}">
          <span class="bars__name">${esc(r.name)}</span>
          <span class="bars__track"><span class="bars__bar" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span>
          <span class="bars__val">${fmt(r.value)}${r.note ? `<small>${esc(r.note)}</small>` : ""}</span>
        </li>`;
    }).join("")}</ul>`;
  };

  // Columnas por período (una sola serie)
  const columns = (points, { unit = ["proyecto", "proyectos"] } = {}) => {
    if (!points.length) return `<p class="viz__empty">Sin datos para estos filtros.</p>`;
    const max = Math.max(...points.map((p) => p.value), 1);
    const labelAll = points.length <= 14;
    const maxIdx = points.findIndex((p) => p.value === max);
    return `
      <div class="cols" style="--n:${points.length}">
        <div class="cols__plot">
          ${points.map((p, i) => `
            <div class="col" tabindex="0" data-tip="${esc(`${p.full}: ${p.value} ${p.value === 1 ? unit[0] : unit[1]}`)}">
              <span class="col__val">${labelAll || i === maxIdx ? p.value || "" : ""}</span>
              <span class="col__bar" style="height:${p.value ? Math.max(2, (p.value / max) * 100) : 0}%"></span>
            </div>`).join("")}
        </div>
        <div class="cols__axis">${points.map((p, i) => `<span>${points.length > 16 && i % 2 ? "" : esc(p.label)}</span>`).join("")}</div>
      </div>
      <details class="viz__table"><summary>Ver datos</summary>
        <table><thead><tr><th scope="col">Período</th><th scope="col" class="r">Proyectos</th></tr></thead>
        <tbody>${points.map((p) => `<tr><td>${esc(p.full)}</td><td class="r">${p.value}</td></tr>`).join("")}</tbody></table>
      </details>`;
  };

  // Barra segmentada (un total partido en dos o tres partes)
  const segmented = (parts) => {
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (!total) return `<p class="viz__empty">Sin datos para estos filtros.</p>`;
    return `
      <div class="seg" role="img" aria-label="${esc(parts.map((p) => `${p.name}: ${p.value} (${pct(p.value, total)}%)`).join(", "))}">
        ${parts.filter((p) => p.value).map((p) => {
          const share = pct(p.value, total);
          return `<span class="seg__part" tabindex="0" style="flex:${p.value};--c:${p.color}" data-tip="${esc(`${p.name}: ${p.value} (${share}%)`)}">${share >= 12 ? `${share}%` : ""}</span>`;
        }).join("")}
      </div>
      <ul class="legend">${parts.map((p) => `<li><i style="--c:${p.color}"></i>${esc(p.name)} <b>${p.value}</b></li>`).join("")}</ul>`;
  };

  const periodPoints = (list) => {
    const mode = state.date.mode;
    const dateOf = (i) => i.start || i.end;
    if (mode === "month" && state.date.month) {
      const [y, m] = state.date.month.split("-").map(Number);
      const days = new Date(y, m, 0).getDate();
      const counts = countBy(list.filter((i) => (dateOf(i) || "").startsWith(state.date.month)), (i) => Number(dateOf(i).slice(8, 10)));
      return Array.from({ length: days }, (_, k) => ({
        label: String(k + 1), full: `${k + 1} ${MONTHS[m - 1]}`, value: counts.get(k + 1) || 0,
      }));
    }
    const months = list.map(dateOf).filter(Boolean).map((d) => d.slice(0, 7)).sort();
    if (!months.length) return [];
    const counts = countBy(months.map((m) => ({ m })), "m");
    const out = [];
    let [y, m] = months[0].split("-").map(Number);
    const [ly, lm] = months[months.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${pad(m)}`;
      out.push({ label: shortMonth(key), full: monthLabel(key), value: counts.get(key) || 0 });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out.slice(-18);
  };

  const card = (title, sub, body, wide = false) =>
    `<figure class="vcard${wide ? " vcard--wide" : ""}"><figcaption><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ""}</figcaption>${body}</figure>`;

  const renderStats = (list) => {
    const design = isDesigner();
    const done = list.filter((i) => i.status === DONE);
    const timed = done.filter((i) => i.start && i.end && i.end >= i.start);
    const avgDays = timed.length ? timed.reduce((a, i) => a + daysBetween(i.start, i.end), 0) / timed.length : null;
    const joint = list.filter((i) => i.joint).length;
    const totalMods = list.reduce((a, i) => a + (i.mods || 0), 0);
    const scopeName = design
      ? (state.nav === "mio" && myScope() === "mio" ? `Mesa de ${myAlias()} (incluye x 2)` : "Todo el equipo de Diseño")
      : state.me.area;

    const tiles = [
      tile("Proyectos", list.length, esc(scopeName)),
      tile("Finalizados", done.length, `${pct(done.length, list.length)}% del total`),
      tile("Tiempo promedio", avgDays === null ? "—" : `${num(avgDays)} días`, "de inicio a finalización"),
      design
        ? tile("Trabajos x 2", joint, `${pct(joint, list.length)}% en conjunto`)
        : tile("Con archivo final", list.filter((i) => i.linkFinal).length, "listos para descargar"),
      design ? tile("Modificaciones", totalMods, "rondas de cambios (privado)") : "",
      design ? tile("Promedio por proyecto", list.length ? avgFmt(totalMods / list.length) : "—", "rondas de modificación") : "",
    ].join("");

    const toRows = (map) => [...map.entries()].map(([name, value]) => ({ name: name || "—", value })).sort((a, b) => b.value - a.value);
    const sections = [];
    const periodSub = state.date.mode === "month" ? "Proyectos por día según la fecha de inicio" : "Proyectos por mes según la fecha de inicio";
    sections.push(card("Volumen por período", periodSub, columns(periodPoints(list)), true));

    if (design) {
      sections.push(card("Modalidad", "Individual o en conjunto (x 2)", segmented([
        { name: "Individual", value: list.length - joint, color: VIZ_1 },
        { name: "x 2 (en conjunto)", value: joint, color: VIZ_2 },
      ])));
      if (!(state.nav === "mio" && myScope() === "mio")) {
        const who = countBy(list, (i) => i.assignee || UNASSIGNED);
        sections.push(card("Por asignado", "Cuántos proyectos tiene cada mesa", rankedBars(toRows(who), { total: list.length })));
      }
    } else {
      const byStatus = STATUSES.map((s) => ({ name: s.key, value: list.filter((i) => i.status === s.key).length })).filter((r) => r.value);
      sections.push(card("Estado de los pedidos", "En qué etapa está cada pedido del área", rankedBars(byStatus, { max: 6, total: list.length })));
    }

    sections.push(card("Demanda por marca", "Proyectos por marca o ámbito", rankedBars(toRows(countBy(list, "brand")), { total: list.length })));
    if (design) {
      sections.push(card("Demanda por área", "Proyectos por área solicitante", rankedBars(toRows(countBy(list, "area")), { total: list.length })));
      const rework = [...countBy(list, "area").keys()].map((name) => {
        const of = list.filter((i) => i.area === name);
        const mods = of.reduce((a, i) => a + (i.mods || 0), 0);
        return { name, value: mods / of.length, note: `${plural(mods, "modif.", "modif.")} en ${plural(of.length, "proyecto", "proyectos")}`, mods };
      }).filter((r) => r.mods > 0).sort((a, b) => b.value - a.value);
      sections.push(card("Áreas con mayor retrabajo", "Promedio de rondas de modificación por proyecto (solo Diseño)",
        rework.length
          ? rankedBars(rework, { unit: ["ronda por proyecto", "rondas por proyecto"], fmt: avgFmt })
          : `<p class="viz__empty">Todavía no hay modificaciones registradas en estos proyectos.</p>`));
    }
    sections.push(card("Tipo de pieza", "Qué formatos se piden más", rankedBars(toRows(countBy(list, (i) => (i.type || "").startsWith("Otro") ? "Otro" : i.type)), { total: list.length })));

    $("#stats").innerHTML = `<div class="vtiles">${tiles}</div><div class="vgrid">${sections.join("")}</div>`;
  };

  /* ---------- Render: administración ---------- */

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
            <strong>${esc(d.alias)}${self ? ` <em class="you">vos</em>` : ""}${d.lider ? ` <em class="you you--lead">Líder</em>` : ""}</strong>
            <small>${esc(d.nombre)}</small>
            <small>${plural(d.activos, "pedido activo", "pedidos activos")} en su mesa (con x 2)</small>
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
      ? `${plural(a.sin_area, "pedido cargado en la web no está vinculado", "pedidos cargados en la web no están vinculados")} a ningún área: solo los ve Diseño. Podés elegir su área desde el detalle de cada pedido.`
      : "";
  };

  const render = () => {
    if (!state.me) return;
    renderChrome();
    if (NAVS[state.nav].admin) return renderAdmin();
    if (!state.loaded) return;
    const items = filtered();
    renderKpis(items);
    if (state.view === "board") renderBoard(items);
    else if (state.view === "list") renderList(items);
    else renderStats(items);
  };

  /* ---------- Acciones sobre pedidos ---------- */

  const find = (id) => state.items.find((i) => i.id === Number(id));

  // Aplica en pantalla un cambio antes de que responda la base
  const applyLocal = (it, cambios) => {
    if ("estado" in cambios && cambios.estado !== it.status) {
      if (cambios.estado === "Requiere modificación" && !("modificaciones" in cambios)) it.mods += 1;
      it.status = cambios.estado;
    }
    if ("prioridad" in cambios) it.priority = cambios.prioridad;
    if ("asignado" in cambios) {
      const v = cambios.asignado || null;
      it.joint = v === X2;
      it.designer = v && v !== X2 ? v : null;
      it.assignee = v;
    }
    if ("modificaciones" in cambios) it.mods = cambios.modificaciones;
    if ("link_final" in cambios) it.linkFinal = cambios.link_final || null;
    if ("observaciones" in cambios) it.notes = cambios.observaciones || null;
  };

  const editMsg = (it, cambios) => {
    if ("estado" in cambios) return `${it.code} → ${cambios.estado}`;
    if ("asignado" in cambios) {
      const v = cambios.asignado;
      return !v ? `${it.code} sin asignar` : v === myAlias() ? `${it.code} pasó a tu mesa` : v === X2 ? `${it.code} → x 2 (en conjunto)` : `${it.code} pasó a la mesa de ${v}`;
    }
    if ("prioridad" in cambios) return `${it.code}: prioridad ${cambios.prioridad.toLowerCase()}`;
    if ("modificaciones" in cambios) return `${it.code}: ${plural(cambios.modificaciones, "modificación registrada", "modificaciones registradas")}`;
    return `${it.code} actualizado`;
  };

  // Valores previos para poder deshacer un cambio de estado, asignado o prioridad
  const undoFor = (it, cambios) => {
    const prev = {};
    if ("estado" in cambios) Object.assign(prev, { estado: it.status, modificaciones: it.mods });
    if ("asignado" in cambios) prev.asignado = it.assignee || "";
    if ("prioridad" in cambios) prev.prioridad = it.priority;
    return Object.keys(prev).length ? prev : null;
  };

  const quickEdit = async (id, cambios, { undo = true } = {}) => {
    const it = find(id);
    if (!it) return;
    if (!isDesigner()) return toast("Solo el equipo de Diseño puede hacer ese cambio.");
    const prev = undo ? undoFor(it, cambios) : null;
    applyLocal(it, cambios);
    render();
    try {
      await rpc("mesa_pedido_editar", { p_id: it.id, p_cambios: cambios });
      notify();
      toast(undo ? editMsg(it, cambios) : `${it.code}: cambio deshecho`,
        prev ? { label: "Deshacer", run: () => quickEdit(it.id, prev, { undo: false }) } : null);
      scheduleRefresh();
    } catch (e) {
      handleError("guardar el cambio", e);
      refresh();
    }
  };

  // La tarjeta desaparece al instante; la base la borra a los 5 s salvo que se toque «Deshacer»
  const pendingDeletes = new Map();

  const commitDelete = async (id) => {
    const p = pendingDeletes.get(id);
    if (!p) return;
    pendingDeletes.delete(id);
    clearTimeout(p.timer);
    try {
      await rpc("mesa_pedido_eliminar", { p_id: id });
      notify();
    } catch (e) {
      if (state.token) handleError("eliminar el pedido", e);
    }
    refresh();
  };

  const removeItem = (it) => {
    if (detailDialog.open && state.openId === it.id) detailDialog.close();
    state.items = state.items.filter((i) => i.id !== it.id);
    render();
    pendingDeletes.set(it.id, { timer: setTimeout(() => commitDelete(it.id), 5000) });
    toast(`${it.code} eliminado de todos los tableros.`, {
      label: "Deshacer",
      run: () => {
        const p = pendingDeletes.get(it.id);
        if (!p) return;
        clearTimeout(p.timer);
        pendingDeletes.delete(it.id);
        toast(`${it.code} recuperado.`);
        state.loaded = false; // que no lo anuncie como pedido nuevo
        refresh();
      },
    });
  };

  // Si se cierra o se oculta la pestaña, los borrados pendientes se confirman en el momento
  const flushDeletes = () => Promise.all([...pendingDeletes.keys()].map(commitDelete));
  window.addEventListener("pagehide", flushDeletes);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushDeletes(); });

  // Eliminación en dos pasos: el primer clic arma el botón, el segundo confirma
  const armDelete = (btn, it, label) => {
    if (btn.dataset.armed === "1") {
      btn.disabled = true;
      return removeItem(it);
    }
    btn.dataset.armed = "1";
    btn.classList.add("is-armed");
    const prev = btn.innerHTML;
    btn.innerHTML = label;
    setTimeout(() => {
      if (!btn.isConnected || btn.disabled) return;
      btn.dataset.armed = "";
      btn.classList.remove("is-armed");
      btn.innerHTML = prev;
    }, 4000);
  };

  const canDelete = (it) => isDesigner() || (it.areaId === state.me.area_id && it.status === NEW);

  /* ---------- Detalle (panel lateral) ---------- */

  const detailDialog = $("#detailDialog");

  const renderDetail = () => {
    const it = find(state.openId);
    if (!it) return;
    const late = isLate(it);
    const design = isDesigner();
    state.dMods = it.mods;
    state.detailDirty = false;
    $("#detailBody").innerHTML = `
      <div class="drawer__head">
        <div class="drawer__chips"><span class="chip chip--dark">${esc(it.code)}</span><span class="chip">${esc(it.area)}</span></div>
        <button class="close" type="button" data-close aria-label="Cerrar"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <h2 id="detailTitle">${esc(it.title)}</h2>
      <div class="detail-meta">
        <span class="pill"><b>Marca</b>${esc(it.brand)}</span>
        <span class="pill"><b>Pieza</b>${esc(it.type)}</span>
        <span class="pill"><b>Pidió</b>${esc(it.createdBy)}</span>
        <span class="pill ${late ? "late" : ""}"><b>Entrega ideal</b>${late ? "Vencido · " : ""}${fmtFullDate(it.due)}</span>
        ${it.start ? `<span class="pill"><b>Inicio</b>${fmtFullDate(it.start)}</span>` : ""}
        ${it.end ? `<span class="pill"><b>Finalizado</b>${fmtFullDate(it.end)}</span>` : ""}
        ${design ? "" : `
          <span class="pill"><span class="dot" style="--color:${statusColor(it.status)}"></span>${esc(it.status)}</span>
          <span class="pill"><b>Mesa</b>${esc(it.assignee || UNASSIGNED)}</span>
          <span class="pill"><b>Prioridad</b>${esc(it.priority)}</span>`}
      </div>
      <section class="detail-section">
        <h4>Indicaciones</h4>
        <p>${it.description ? esc(it.description) : "Sin indicaciones."}</p>
        ${it.link ? `<a class="ref" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer"><svg class="ico" aria-hidden="true"><use href="#i-file"/></svg>Ver insumos adjuntos</a>` : ""}
      </section>
      ${it.linkFinal ? `
        <a class="deliverable" href="${esc(it.linkFinal)}" target="_blank" rel="noopener noreferrer">
          <span><strong>Archivo final listo</strong><small>${esc(it.linkFinal)}</small></span>
          <span class="deliverable__go">Abrir</span>
        </a>` : ""}
      ${design ? `
      <form class="manage" id="editForm" novalidate>
        <div class="manage__head"><span>Gestión de Diseño</span><span class="private">Privado · solo Diseño</span></div>
        <div class="mods">
          <div><strong>Modificaciones solicitadas</strong><small>Registrá cada ronda de cambios pedida sobre esta pieza. Al pasar a «Requiere modificación» se suma una sola.</small></div>
          <span class="counter counter--lg" role="group" aria-label="Modificaciones solicitadas">
            <button type="button" data-dmods="-1" aria-label="Restar una modificación">−</button>
            <b id="dMods">${it.mods}</b>
            <button type="button" data-dmods="1" aria-label="Sumar una modificación">+</button>
          </span>
        </div>
        <div class="manage__grid">
          <label>Asignado<select name="asignado">${assigneeOptions(it.assignee)}</select></label>
          <label>Prioridad<select name="prioridad">${options(PRIORITIES, it.priority)}</select></label>
          <label>Estado<select name="estado">${options(STATUS_KEYS, it.status)}</select></label>
        </div>
        <label>Área solicitante<select name="area">${areaOptions(it)}</select></label>
        <label>Link al archivo final<input type="url" name="link_final" value="${esc(it.linkFinal || "")}" placeholder="https://drive.google.com/… · Canva · Figma" /></label>
        <label>Observaciones (solo Diseño)<textarea name="observaciones" maxlength="4000" placeholder="Notas internas del equipo">${esc(it.notes || "")}</textarea></label>
        <p class="auth__error" id="editError" role="alert" hidden></p>
        <button class="primary" type="submit">Guardar cambios</button>
      </form>` : `<p class="readonly-note">El estado, la prioridad y la mesa los define Diseño. Podés sumar comentarios abajo.</p>`}
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
      <div class="drawer__foot">
        ${canDelete(it) ? `<button class="danger-soft" type="button" data-delete><svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg>Eliminar tarjeta</button>` : `<span></span>`}
        <button class="secondary" type="button" data-close>Cerrar</button>
      </div>`;
  };

  const openDetail = (id) => {
    state.openId = Number(id);
    renderDetail();
    if (!detailDialog.open) detailDialog.showModal();
    detailDialog.scrollTop = 0;
  };

  detailDialog.addEventListener("close", () => {
    state.openId = null;
    state.detailDirty = false;
  });

  detailDialog.addEventListener("input", (e) => {
    if (e.target.closest("#editForm")) state.detailDirty = true;
  });

  detailDialog.addEventListener("submit", async (e) => {
    e.preventDefault();
    const it = find(state.openId);
    if (!it) return;

    if (e.target.id === "editForm") {
      const f = e.target.elements;
      const errBox = $("#editError");
      const link = f.link_final.value.trim();
      if (link && !/^https?:\/\//i.test(link)) {
        errBox.textContent = "El link al archivo final tiene que empezar con http:// o https://.";
        errBox.hidden = false;
        return;
      }
      const cambios = {};
      if (f.estado.value !== it.status) cambios.estado = f.estado.value;
      if (f.prioridad.value !== it.priority) cambios.prioridad = f.prioridad.value;
      if ((f.asignado.value || null) !== it.assignee) cambios.asignado = f.asignado.value;
      if (state.dMods !== it.mods) cambios.modificaciones = state.dMods;
      if (link !== (it.linkFinal || "")) cambios.link_final = link;
      const notes = f.observaciones.value.trim();
      if (notes !== (it.notes || "")) cambios.observaciones = notes;
      const areaVal = f.area.value;
      const areaChanged = areaVal !== "" && Number(areaVal) !== (it.areaId || 0);
      if (!Object.keys(cambios).length && !areaChanged) {
        state.detailDirty = false;
        return toast("No hay cambios para guardar.");
      }
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        if (Object.keys(cambios).length) await rpc("mesa_pedido_editar", { p_id: it.id, p_cambios: cambios });
        if (areaChanged) await rpc("mesa_pedido_area", { p_id: it.id, p_area_id: Number(areaVal) });
        notify();
        state.detailDirty = false;
        toast(`${it.code} guardado${state.dMods ? ` · ${plural(state.dMods, "modificación", "modificaciones")}` : ""}.`);
        await fetchData();
      } catch (err) {
        btn.disabled = false;
        handleError("guardar los cambios", err);
      }
      return;
    }

    if (e.target.id === "commentForm") {
      const input = $("#commentInput");
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try {
        await rpc("mesa_pedido_comentar", { p_id: it.id, p_texto: text });
        notify();
        await fetchData();
        if (state.detailDirty) {
          // El formulario tiene cambios sin guardar: se agrega el comentario sin rearmar el panel
          input.value = "";
          input.disabled = false;
          toast("Comentario guardado.");
        } else {
          $("#commentInput")?.focus();
        }
      } catch (err) {
        input.disabled = false;
        handleError("guardar el comentario", err);
      }
    }
  });

  detailDialog.addEventListener("click", (e) => {
    if (e.target === detailDialog || e.target.closest("[data-close]")) return detailDialog.close();
    const it = find(state.openId);
    if (!it) return;
    const m = e.target.closest("[data-dmods]");
    if (m) {
      state.dMods = Math.max(0, state.dMods + Number(m.dataset.dmods));
      $("#dMods").textContent = state.dMods;
      state.detailDirty = true;
      return;
    }
    const del = e.target.closest("[data-delete]");
    if (del) armDelete(del, it, `<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg>Confirmar eliminación definitiva`);
  });

  /* ---------- Nueva solicitud / Nuevo proyecto ---------- */

  const newDialog = $("#newDialog");
  const newForm = $("#newForm");
  const newError = $("#newError");

  const renderNewChips = () => {
    const nf = state.nf;
    $("#pieceChips").innerHTML = PIECES.map(([p]) =>
      `<button type="button" role="radio" aria-checked="${nf.piece === p}" data-piece="${esc(p)}">${esc(p)}</button>`).join("");
    $("#customPieceField").hidden = nf.piece !== "Otro";
    $$("#destScopes [data-dest]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.dest === nf.dest)));
    $("#brandChips").hidden = nf.dest !== "brand";
    $("#brandChips").innerHTML = BRANDS.map((b) =>
      `<button type="button" role="radio" aria-checked="${nf.brand === b}" data-brand="${esc(b)}">${esc(b)}</button>`).join("");
    const due = newForm.elements.due.value;
    $$("#dueChips [data-due]").forEach((b) => b.setAttribute("aria-pressed", String(dueFor(b.dataset.due) === due)));
  };

  // Atajos de fecha: en 48 hs, viernes de esta semana, viernes de la próxima
  const dueFor = (kind) => {
    const t = state.today || today();
    const [y, m, d] = t.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const toFriday = (5 - dow + 7) % 7;
    if (kind === "48h") return addDays(t, 2);
    if (kind === "week") return addDays(t, toFriday);
    return addDays(t, toFriday + 7);
  };

  const syncSubmit = () => {
    const needsOk = !isDesigner();
    $("#newSubmit").disabled = needsOk && !newForm.elements.approved.checked;
  };

  const openNew = () => {
    newForm.reset();
    newError.hidden = true;
    const design = isDesigner();
    const fromFactory = !design && normKey(state.me.area).includes("fabrica");
    state.nf = { piece: "Pieza gráfica", dest: fromFactory ? "fabricas" : "corporate", brand: BRANDS[0] };
    newForm.elements.due.value = addDays(state.today || today(), 7);
    $("#newEyebrow").textContent = design ? "Alta directa · Diseño" : `Nueva solicitud · ${state.me.area}`;
    $("#newTitle").textContent = design ? "Nuevo proyecto" : "¿Qué necesitás que diseñemos?";
    $("#newAreaBadge").textContent = design ? "Mesa de Diseño" : state.me.area;
    $("#designExtras").hidden = !design;
    $("#approvalBox").hidden = design;
    $("#newSubmit").textContent = design ? "Crear proyecto" : "Enviar solicitud";
    if (design) {
      newForm.elements.area.innerHTML = areaOptions(null);
      newForm.elements.assignee.innerHTML = assigneeOptions(myAlias());
      newForm.elements.priority.innerHTML = options(PRIORITIES, "Media");
    }
    renderNewChips();
    syncSubmit();
    newDialog.showModal();
    newForm.elements.title.focus();
  };

  newForm.addEventListener("click", (e) => {
    const piece = e.target.closest("[data-piece]");
    const dest = e.target.closest("[data-dest]");
    const brand = e.target.closest("[data-brand]");
    const due = e.target.closest("[data-due]");
    if (piece) state.nf.piece = piece.dataset.piece;
    else if (dest) state.nf.dest = dest.dataset.dest;
    else if (brand) state.nf.brand = brand.dataset.brand;
    else if (due) newForm.elements.due.value = dueFor(due.dataset.due);
    else return;
    renderNewChips();
    if (piece && state.nf.piece === "Otro") newForm.elements.customPiece.focus();
  });

  newForm.addEventListener("change", (e) => {
    if (e.target.name === "approved") syncSubmit();
    if (e.target.name === "due") renderNewChips();
  });

  const showNewError = (msg, field) => {
    newError.textContent = msg;
    newError.hidden = false;
    if (field) field.focus();
  };

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = newForm.elements;
    const design = isDesigner();
    const title = f.title.value.trim();
    const custom = f.customPiece.value.trim();
    const description = f.description.value.trim();
    const link = f.link.value.trim();
    if (!title) return showNewError("Poné un título para el pedido.", f.title);
    if (state.nf.piece === "Otro" && !custom) return showNewError("Contanos qué pieza necesitás.", f.customPiece);
    if (!f.due.value) return showNewError("Elegí una fecha ideal de entrega.", f.due);
    if (!design && !description) return showNewError("Escribí las indicaciones: textos, medidas o referencias.", f.description);
    if (link && !/^https?:\/\//i.test(link)) return showNewError("El link tiene que empezar con http:// o https://.", f.link);
    if (!design && !f.approved.checked) return showNewError("Confirmá que el contenido ya está aprobado por tu área.");

    const pedido = {
      titulo: title,
      tipo: state.nf.piece === "Otro" ? `Otro: ${custom}` : state.nf.piece,
      marca: state.nf.dest === "corporate" ? CORPORATE : state.nf.dest === "fabricas" ? FACTORIES : state.nf.brand,
      entrega: f.due.value,
      descripcion: description,
      link,
    };
    if (design) {
      pedido.area_id = Number(f.area.value) || null;
      pedido.asignado = f.assignee.value;
      pedido.prioridad = f.priority.value;
    }
    const btn = $("#newSubmit");
    btn.disabled = true;
    try {
      const res = await rpc("mesa_pedido_crear", { p_pedido: pedido });
      notify();
      newDialog.close();
      toast(design ? `${code(res.codigo)} creado en «No iniciado».` : `${code(res.codigo)} enviado a Diseño.`);
      await fetchData();
    } catch (err) {
      handleError("crear el pedido", err);
    } finally {
      syncSubmit();
      if (design) btn.disabled = false;
    }
  });

  newDialog.addEventListener("click", (e) => {
    if (e.target === newDialog || e.target.closest("[data-close]")) newDialog.close();
  });

  /* ---------- Exportar e importar (Diseño) ---------- */

  let xlsxPromise = null;
  const loadXlsx = () => {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = XLSX_URL;
        s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("xlsx")));
        s.onerror = () => { xlsxPromise = null; reject(new Error("xlsx")); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  };

  const exportRows = () => [...filtered()].sort((a, b) => a.codigo - b.codigo).map((it) => ({
    "ID fijo": it.codigo,
    "Tarea": it.title,
    "Marca": it.brand,
    "Área": it.area,
    "Tipo de pieza": it.type,
    "Prioridad": it.priority,
    "Estado": it.status,
    "Asignado": it.assignee || UNASSIGNED,
    "Fecha de inicio": it.start || "",
    "Fecha de finalización": it.end || "",
    "Fecha objetivo": it.due || "",
    "Modificaciones": it.mods,
    "Observaciones": it.notes || "",
    "Link archivo final": it.linkFinal || "",
    "Solicitado por": it.createdBy || "",
    "Indicaciones": it.description || "",
  }));

  // Evita que una celda que empieza con = + - @ se ejecute como fórmula al abrir el archivo
  const safeCell = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

  const download = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  const fileName = (ext) => `mesa-diseno-${state.today || today()}.${ext}`;

  $("#exportCsv").addEventListener("click", () => {
    const rows = exportRows();
    if (!rows.length) return toast("No hay pedidos para exportar con estos filtros.");
    const head = Object.keys(rows[0]);
    const cell = (v) => {
      const s = String(safeCell(v ?? ""));
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head.join(";"), ...rows.map((r) => head.map((h) => cell(r[h])).join(";"))].join("\r\n");
    download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), fileName("csv"));
    toast(`${plural(rows.length, "pedido exportado", "pedidos exportados")} a .csv`);
  });

  $("#exportXlsx").addEventListener("click", async () => {
    const rows = exportRows();
    if (!rows.length) return toast("No hay pedidos para exportar con estos filtros.");
    try {
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)]))));
      ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: k === "Tarea" || k === "Indicaciones" ? 40 : 16 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Diseños");
      XLSX.writeFile(wb, fileName("xlsx"));
      toast(`${plural(rows.length, "pedido exportado", "pedidos exportados")} a .xlsx`);
    } catch (err) {
      console.error(err);
      toast("No se pudo preparar el Excel. Probá con .csv.");
    }
  });

  $("#importXlsx").addEventListener("click", () => $("#importFile").click());

  // Lee la hoja «Diseños pendientes» (o la primera que tenga «ID fijo» y «Tarea») y la manda tal cual a la base
  const IMPORT_COLS = {
    "id fijo": "id", "tarea": "tarea", "marca / area": "marca", "marca": "marca", "prioridad": "prioridad",
    "estado": "estado", "nombre": "nombre", "asignado": "nombre", "fecha de inicio": "inicio",
    "fecha de finalizacion": "fin", "fecha de modificacion": "modificacion", "observaciones": "observaciones",
    "fecha de solicitud": "solicitud", "solicitado por": "solicitado_por", "fecha objetivo": "objetivo",
  };
  const DATE_KEYS = ["inicio", "fin", "modificacion", "solicitud", "objetivo"];

  const parseSheet = (XLSX, wb) => {
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      const h = rows.slice(0, 25).findIndex((r) => r && r.some((c) => normKey(c) === "id fijo") && r.some((c) => normKey(c) === "tarea"));
      if (h < 0) continue;
      const keys = rows[h].map((c) => IMPORT_COLS[normKey(c)] || null);
      const toDate = (v) => {
        if (typeof v === "number") {
          const d = XLSX.SSF.parse_date_code(v);
          return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
        }
        const s = String(v ?? "").trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[2])}-${pad(m[1])}`;
        return null;
      };
      return rows.slice(h + 1).map((r) => {
        const o = {};
        keys.forEach((k, i) => {
          if (!k || o[k] != null) return;
          const v = r[i];
          o[k] = DATE_KEYS.includes(k) ? toDate(v) : v == null ? null : typeof v === "number" ? v : String(v);
        });
        return o;
      }).filter((o) => o.id != null || (o.tarea && String(o.tarea).trim()));
    }
    return null;
  };

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const filas = parseSheet(XLSX, wb);
      if (!filas) return toast("No encontramos la hoja con las columnas «ID fijo» y «Tarea».");
      if (!filas.length) return toast("La planilla no tiene filas para importar.");
      if (!confirm(`Se leyeron ${filas.length} filas de «${file.name}». Se agregan solo las que todavía no estén cargadas. ¿Continuar?`)) return;
      const res = await rpc("mesa_importar", { p_filas: filas });
      notify();
      toast(`${plural(res.nuevos, "tarea nueva", "tareas nuevas")} · ${res.existentes} ya estaban cargadas.`);
      await fetchData();
    } catch (err) {
      handleError("importar la planilla", err);
    }
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
      const extra = d && d.activos ? " Sus pedidos abiertos quedan sin asignar." : "";
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

  $$(".nav [data-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      state.nav = b.dataset.nav;
      const v = b.dataset.setView || NAVS[state.nav].view;
      if (v) state.view = v;
      state.listLimit = LIST_PAGE;
      state.showAllDone = false;
      render();
    })
  );

  $$("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.view;
      render();
    })
  );

  $("#scopeBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    state.scope = b.dataset.scope;
    render();
  });

  $("#search").addEventListener("input", (e) => { state.q = e.target.value; state.listLimit = LIST_PAGE; render(); });
  $("#fBrand").addEventListener("change", (e) => { state.brand = e.target.value; render(); });
  $("#fDesigner").addEventListener("change", (e) => { state.designer = e.target.value; render(); });
  $("#fArea").addEventListener("change", (e) => { state.area = e.target.value; render(); });
  $("#fDate").addEventListener("change", (e) => { state.date.mode = e.target.value; render(); });
  $("#fDay").addEventListener("change", (e) => { state.date.day = e.target.value; render(); });
  $("#fMonth").addEventListener("change", (e) => { state.date.month = e.target.value; render(); });
  $("#fYear").addEventListener("change", (e) => { state.date.year = e.target.value; render(); });
  $("#fFrom").addEventListener("change", (e) => { state.date.from = e.target.value; render(); });
  $("#fTo").addEventListener("change", (e) => { state.date.to = e.target.value; render(); });
  $("#newBtn").addEventListener("click", openNew);

  // Tablero: abrir detalle, mostrar todas las finalizadas
  const board = $("#board");
  board.addEventListener("click", (e) => {
    if (e.target.closest("[data-more-done]")) {
      state.showAllDone = true;
      return render();
    }
    const card = e.target.closest(".card[data-id]");
    if (card) openDetail(card.dataset.id);
  });
  board.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card[data-id]");
    if (card && e.target === card) {
      e.preventDefault();
      openDetail(card.dataset.id);
    }
  });

  // Lista editable: cambios en 1 clic, contador, editar y eliminar
  const list = $("#list");
  list.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-edit]");
    const row = e.target.closest("[data-row]");
    if (sel && row) quickEdit(row.dataset.row, { [sel.dataset.edit]: sel.value });
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest("[data-more-rows]")) {
      state.listLimit += LIST_PAGE;
      return render();
    }
    const row = e.target.closest("[data-row]");
    if (!row) return;
    const it = find(row.dataset.row);
    if (!it) return;
    const m = e.target.closest("[data-mods]");
    if (m) return quickEdit(it.id, { modificaciones: Math.max(0, it.mods + Number(m.dataset.mods)) });
    if (e.target.closest("[data-open]")) return openDetail(it.id);
    const del = e.target.closest("[data-del]");
    if (del) armDelete(del, it, "¿Eliminar?");
  });

  // Arrastrar y soltar entre columnas (solo Diseño)
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
    const it = find(e.dataTransfer.getData("text/plain"));
    if (it && it.status !== col.dataset.status) quickEdit(it.id, { estado: col.dataset.status });
  });

  // Tooltip de los gráficos (mouse y teclado)
  const tip = $("#vizTip");
  const showTip = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  const statsEl = $("#stats");
  statsEl.addEventListener("pointermove", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) showTip(el, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  statsEl.addEventListener("pointerleave", () => { tip.hidden = true; });
  statsEl.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    showTip(el, r.left + r.width / 2, r.top);
  });
  statsEl.addEventListener("focusout", () => { tip.hidden = true; });

  // Al volver a la pestaña, se ponen al día los datos
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.token) scheduleRefresh();
  });

  /* ---------- Inicio ---------- */

  // Lectura para la capa visual (paleta Ctrl+K): no modifica nada
  window.MesaUI = {
    ready: () => Boolean(state.me),
    designer: () => isDesigner(),
    items: () => state.items.map((i) => ({ id: i.id, code: i.code, title: i.title, status: i.status, area: i.area })),
    open: (id) => openDetail(id),
  };

  if (!sb) {
    lock();
    showAuthError("No se pudo cargar la conexión con la base de datos. Revisá tu conexión y recargá la página.");
    return;
  }

  const saved = stored.get();
  if (saved) start(saved);
  else showLogin();
})();
