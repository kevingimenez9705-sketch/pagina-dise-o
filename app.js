/* Mesa de Diseño · Gastro BS AS
   Datos compartidos en Supabase. Ingreso con clave: "Naza" (Diseño) o "Miembro".
   Todo pasa por funciones de la base (mesa_*) que validan la clave en cada llamada. */
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

  const TEAM = {
    Naza: { name: "Nazareno Devia", cls: "av-n" },
    Agus: { name: "Agustín Monteverdi", cls: "av-a" },
    Bauti: { name: "Bautista Valle", cls: "av-b" },
  };

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

  const AREAS = [
    "Operaciones",
    "Recursos Humanos",
    "Capacitación y Cultura",
    "Legales",
    "Auditoría",
    "Mantenimiento",
    "Sistemas",
    "Logística y Distribución",
    "Fábricas",
    "Franquicias",
    "Selección",
    "Seguridad e Higiene",
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
  const SESSION_KEY = "mesa-diseno-sesion";
  const POLL_MS = 30000;

  /* ---------- Estado ---------- */

  const state = {
    items: [],
    me: null, // { rol: "naza" | "miembro", clave, nombre }
    loaded: false,
    nav: "tablero",
    view: "board",
    q: "",
    brand: "",
    designer: "",
    openId: null,
  };

  const isDesigner = () => Boolean(state.me && state.me.rol === "naza");
  const myName = () => (isDesigner() ? "Naza" : state.me.nombre);
  const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  const NAVS = {
    tablero: { title: () => "Tablero de pedidos", sub: () => "Cada pedido, en la etapa en la que está.", view: "board" },
    mio: {
      title: () => (isDesigner() ? "Mi trabajo" : "Mis solicitudes"),
      sub: () => (isDesigner() ? "Lo que tenés asignado, Naza." : `Los pedidos que cargaste, ${state.me.nombre}.`),
      view: null,
    },
    todas: { title: () => "Todas las solicitudes", sub: () => "Todo lo que estamos creando, en un solo lugar.", view: "list" },
  };

  // Sesión recordada en este navegador
  const remembered = {
    get() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
    },
    set(v) {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
    },
    clear() {
      try { localStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
    },
  };

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

  const fmtStamp = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const code = (id) => `DIS-${String(id).padStart(3, "0")}`;
  const isLate = (it) => it.status !== DONE && it.due && it.due < today();
  const two = (n) => String(n).padStart(2, "0");

  const avatar = (who) => {
    if (!who) return `<i class="av" aria-hidden="true">–</i>`;
    const cls = TEAM[who] ? TEAM[who].cls : "";
    return `<i class="av ${cls}" aria-hidden="true">${esc(who.trim()[0] || "?").toUpperCase()}</i>`;
  };

  const statusColor = (key) => (STATUSES.find((s) => s.key === key) || STATUSES[0]).color;

  const options = (list, selected) =>
    list.map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  const designerOptions = (selected) =>
    `<option value=""${!selected ? " selected" : ""}>${UNASSIGNED}</option>` +
    Object.entries(TEAM)
      .map(([k, t]) => `<option value="${k}"${k === selected ? " selected" : ""}>${esc(k)} · ${esc(t.name)}</option>`)
      .join("");

  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  };

  /* ---------- Supabase ---------- */

  const cfg = window.MESA_CONFIG;
  const sb = window.supabase && cfg ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  let channel = null;
  let pollTimer = null;

  class KeyError extends Error {}

  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, { p_clave: state.me.clave, ...args });
    if (error) {
      if (error.code === "28000") throw new KeyError(error.message);
      const e = new Error(error.message);
      e.code = error.code;
      throw e;
    }
    return data;
  };

  const handleError = (what, error) => {
    console.error(what, error);
    if (error instanceof KeyError) return logout("La clave cambió. Ingresá de nuevo.");
    if (error && error.code === "42501") return toast("Solo Diseño (Naza) puede hacer ese cambio.");
    toast(`No se pudo ${what}. Probá de nuevo.`);
  };

  const fromRow = (r) => ({
    id: r.id,
    code: code(r.id),
    title: r.titulo,
    brand: r.marca,
    area: r.area,
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
    const d = await rpc("mesa_datos");
    const byId = new Map((d.pedidos || []).map((r) => [r.id, fromRow(r)]));
    (d.comentarios || []).forEach((r) => {
      byId.get(r.pedido_id)?.comments.push({ who: r.autor, at: r.created_at, text: r.texto, system: r.sistema });
    });
    const next = [...byId.values()];

    // Aviso de pedidos nuevos cargados por otra persona
    if (state.loaded) {
      const known = new Set(state.items.map((i) => i.id));
      const fresh = next.filter((i) => !known.has(i.id) && !sameName(i.createdBy, myName()));
      if (fresh.length) toast(`Nuevo pedido de ${fresh[0].createdBy}: ${fresh[0].title}`);
    }

    state.items = next;
    state.loaded = true;
    render();
    if (state.openId && detailDialog.open) {
      if (find(state.openId)) renderDetail();
      else detailDialog.close();
    }
  };

  const refresh = async () => {
    if (!state.me) return;
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
  };

  const showLogin = (msg) => {
    lock();
    authError.hidden = !msg;
    authError.textContent = msg || "";
    syncNameField();
  };

  const syncNameField = () => {
    const miembro = loginForm.elements.rol.value === "miembro";
    $("#nameField").hidden = !miembro;
  };

  loginForm.addEventListener("change", (e) => {
    if (e.target.name === "rol") syncNameField();
  });

  const start = async (me) => {
    state.me = me;
    state.loaded = false;
    try {
      await fetchData();
    } catch (e) {
      state.me = null;
      remembered.clear();
      showLogin(e instanceof KeyError ? "La clave cambió. Ingresá de nuevo." : "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
      return false;
    }
    remembered.set(me);
    document.body.classList.remove("is-locked");
    fillStaticSelects();
    render();
    connectLive();
    return true;
  };

  const logout = (msg) => {
    disconnectLive();
    remembered.clear();
    state.me = null;
    state.items = [];
    state.loaded = false;
    loginForm.reset();
    showLogin(msg);
  };

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = loginForm.elements;
    const rol = f.rol.value;
    // Sin importar mayúsculas ni tildes: "Diseño", "diseño" y "DISENO" valen lo mismo
    const clave = f.clave.value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const nombre = f.nombre.value.trim().slice(0, 40);
    if (rol === "miembro" && !nombre) return showLogin("Escribí tu nombre: así firmás tus pedidos y comentarios.");
    if (!clave) return showLogin("Escribí la clave.");

    const btn = loginForm.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Ingresando…";
    const { data: real, error } = await sb.rpc("mesa_ingresar", { p_clave: clave });
    let ok = false;
    if (error) showLogin("No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
    else if (!real) showLogin("Clave incorrecta.");
    else if (real !== rol) showLogin(real === "naza" ? "Esa es la clave de Naza: elegí «Naza»." : "Esa es la clave de Miembro: elegí «Miembro» y escribí tu nombre.");
    else ok = await start({ rol, clave, nombre: rol === "naza" ? "Naza" : nombre });
    btn.disabled = false;
    btn.textContent = "Ingresar";
    if (ok) f.clave.value = "";
  });

  $("#logoutBtn").addEventListener("click", () => logout());

  /* ---------- Filtros ---------- */

  const mine = (it) => (isDesigner() ? it.designer === "Naza" : sameName(it.createdBy, state.me.nombre));

  const scoped = () => (state.nav === "mio" ? state.items.filter(mine) : state.items);

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    return scoped().filter((it) => {
      if (state.brand && it.brand !== state.brand) return false;
      if (state.nav !== "mio" && state.designer) {
        if (state.designer === NONE ? it.designer : it.designer !== state.designer) return false;
      }
      if (!q) return true;
      return [it.code, it.title, it.brand, it.area, it.type, it.designer, it.status, it.createdBy]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  };

  /* ---------- Render ---------- */

  const renderStats = () => {
    const items = scoped();
    $("#stActive").textContent = two(items.filter((i) => i.status !== DONE).length);
    $("#stProd").textContent = two(items.filter((i) => IN_PRODUCTION.includes(i.status)).length);
    $("#stReview").textContent = two(items.filter((i) => IN_REVIEW.includes(i.status)).length);
    $("#stDone").textContent = two(items.filter((i) => i.status === DONE).length);
    $("#myCount").textContent = state.items.filter((i) => mine(i) && i.status !== DONE).length;
  };

  const renderChrome = () => {
    const nav = NAVS[state.nav];
    $("#viewTitle").textContent = nav.title();
    $("#viewSub").textContent = nav.sub();
    document.title = `${nav.title()} · Mesa de Diseño`;
    $('[data-nav="mio"] .nav__label').textContent = isDesigner() ? "Mi trabajo" : "Mis solicitudes";

    $$("[data-nav]").forEach((b) => {
      const on = b.dataset.nav === state.nav;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    $$("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    $("#board").hidden = state.view !== "board";
    $("#list").hidden = state.view !== "list";

    const fd = $("#fDesigner");
    fd.disabled = state.nav === "mio";
    if (fd.disabled) fd.value = "";

    const av = $("#meAvatar");
    av.textContent = myName()[0].toUpperCase();
    av.className = `av ${isDesigner() ? TEAM.Naza.cls : ""}`;
    $("#meName").textContent = isDesigner() ? "Naza" : state.me.nombre;
    $("#meRole").textContent = isDesigner() ? "Diseño" : "Miembro";
    $("#teamAvatars").innerHTML = Object.keys(TEAM).map(avatar).join("");
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
      $("#list").innerHTML = `<div class="empty">${state.items.length ? "No hay pedidos con estos filtros." : "Todavía no hay pedidos. Creá el primero con «Nueva solicitud»."}</div>`;
      return;
    }
    $("#list").innerHTML = `
      <table>
        <thead><tr><th scope="col">Pedido</th><th scope="col">Marca</th><th scope="col">Estado</th><th scope="col">Diseñador</th><th scope="col">Entrega</th></tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr tabindex="0" data-id="${it.id}">
              <td><span class="id">${esc(it.code)}</span><span class="td-title">${esc(it.title)}</span></td>
              <td>${esc(it.brand)}</td>
              <td><span class="status"><span class="dot" style="--color:${statusColor(it.status)}"></span>${esc(it.status)}</span></td>
              <td><span class="who">${avatar(it.designer)}${esc(it.designer || UNASSIGNED)}</span></td>
              <td class="${isLate(it) ? "late" : ""}">${fmtDate(it.due)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  };

  const render = () => {
    if (!state.me) return;
    renderChrome();
    renderStats();
    if (state.view === "board") renderBoard();
    else renderList();
  };

  /* ---------- Acciones ---------- */

  const find = (id) => state.items.find((i) => i.id === Number(id));

  const moveTo = async (id, status) => {
    const it = find(id);
    if (!it || it.status === status) return;
    if (!isDesigner()) return toast("Solo Diseño (Naza) puede mover pedidos.");
    const prev = it.status;
    it.status = status; // respuesta inmediata en pantalla
    render();
    if (state.openId === it.id) renderDetail();
    try {
      await rpc("mesa_mover", { p_id: it.id, p_estado: status });
      notify();
      toast(`${it.code} → ${status}`);
      scheduleRefresh();
    } catch (e) {
      it.status = prev;
      render();
      handleError("mover el pedido", e);
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
        <span class="pill"><b>Área</b>${esc(it.area)}</span>
        <span class="pill"><b>Prioridad</b>${esc(it.priority)}</span>
        <span class="pill ${late ? "late" : ""}"><b>Entrega</b>${late ? "Vencido · " : ""}${fmtDate(it.due)}</span>
        <span class="pill"><b>Pidió</b>${esc(it.createdBy)}</span>
        ${it.print ? `<span class="pill">Incluye impresión</span>` : ""}
        ${canManage ? "" : `<span class="pill"><b>Estado</b>${esc(it.status)}</span><span class="pill"><b>Diseñador</b>${esc(it.designer || UNASSIGNED)}</span>`}
      </div>
      ${canManage ? `
      <div class="detail-controls">
        <label>Estado<select data-field="status">${options(STATUSES.map((s) => s.key), it.status)}</select></label>
        <label>Diseñador<select data-field="designer">${designerOptions(it.designer)}</select></label>
      </div>` : `<p class="readonly-note">El estado y el diseñador los maneja Diseño. Podés sumar comentarios abajo.</p>`}
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
    if (field === "designer") {
      const designer = e.target.value || null;
      try {
        await rpc("mesa_asignar", { p_id: it.id, p_disenador: designer });
        notify();
        toast(designer ? `${it.code} asignado a ${designer}` : `${it.code} sin asignar`);
        scheduleRefresh();
      } catch (err) {
        handleError("asignar el pedido", err);
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
      await rpc("mesa_comentar", { p_nombre: state.me.nombre, p_id: it.id, p_texto: text });
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
    if (e.target.closest("[data-delete]")) {
      const it = find(state.openId);
      if (!it || !confirm(`¿Eliminar ${it.code} «${it.title}»? Se borra para todo el equipo.`)) return;
      try {
        await rpc("mesa_eliminar", { p_id: it.id });
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
      areas: options(AREAS, AREAS[0]),
      types: options(Object.keys(TYPES), "Pieza gráfica"),
      priorities: options(PRIORITIES, "Media"),
      designers: designerOptions(null),
    };
    $$("[data-options]", newForm).forEach((sel) => { sel.innerHTML = sources[sel.dataset.options]; });
    $("#newDesignerField").hidden = !isDesigner();
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
      area: f.area.value,
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
      const id = await rpc("mesa_crear_pedido", { p_nombre: state.me.nombre, p_pedido: pedido });
      notify();
      newDialog.close();
      toast(`${code(id)} creado en «Nuevas»`);
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
    if (document.visibilityState === "visible" && state.me) scheduleRefresh();
  });

  /* ---------- Inicio ---------- */

  const fillStaticSelects = () => {
    $("#fBrand").innerHTML = `<option value="">Todas las marcas</option>` + options(BRANDS, "");
    $("#fDesigner").innerHTML =
      `<option value="">Todo el equipo</option>` +
      Object.keys(TEAM).map((k) => `<option value="${k}">${k}</option>`).join("") +
      `<option value="${NONE}">${UNASSIGNED}</option>`;
  };

  if (!sb) {
    showLogin("No se pudo cargar la conexión con la base de datos. Revisá tu conexión y recargá la página.");
    return;
  }

  const saved = remembered.get();
  if (saved && saved.clave && (saved.rol === "naza" || saved.rol === "miembro")) start(saved);
  else showLogin();
})();
