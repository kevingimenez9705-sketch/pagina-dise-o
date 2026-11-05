/* Mesa de Diseño · Gastro BS AS
   Datos compartidos en Supabase (tablas mesa_*) con login y tiempo real. */
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
  const AVATAR_CLASSES = ["av-n", "av-a", "av-b"];
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  /* ---------- Estado ---------- */

  const state = {
    items: [],
    members: [],
    me: null, // fila de mesa_miembros del usuario logueado
    loaded: false,
    nav: "tablero",
    view: "board",
    q: "",
    brand: "",
    designer: "",
    openId: null,
  };

  const isDesigner = () => Boolean(state.me && state.me.es_disenador);

  const NAVS = {
    tablero: { title: () => "Tablero de pedidos", sub: () => "Cada pedido, en la etapa en la que está.", view: "board" },
    mio: {
      title: () => (isDesigner() ? "Mi trabajo" : "Mis solicitudes"),
      sub: () => (isDesigner() ? `Lo que tenés asignado, ${state.me.alias}.` : `Los pedidos que cargaste, ${state.me.alias}.`),
      view: null,
    },
    todas: { title: () => "Todas las solicitudes", sub: () => "Todo lo que estamos creando, en un solo lugar.", view: "list" },
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

  const memberOf = (alias) => state.members.find((m) => m.alias === alias);

  const avatarClass = (alias) => {
    const designers = state.members.filter((m) => m.es_disenador);
    const i = designers.findIndex((m) => m.alias === alias);
    return i >= 0 ? AVATAR_CLASSES[i % AVATAR_CLASSES.length] : "";
  };

  const avatar = (alias) =>
    alias ? `<i class="av ${avatarClass(alias)}" aria-hidden="true">${esc(alias[0])}</i>` : `<i class="av" aria-hidden="true">–</i>`;

  const statusColor = (key) => (STATUSES.find((s) => s.key === key) || STATUSES[0]).color;

  const options = (list, selected) =>
    list.map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  const designerOptions = (selected) =>
    `<option value=""${!selected ? " selected" : ""}>${UNASSIGNED}</option>` +
    state.members
      .filter((m) => m.es_disenador)
      .map((m) => `<option value="${esc(m.alias)}"${m.alias === selected ? " selected" : ""}>${esc(m.alias)} · ${esc(m.nombre)}</option>`)
      .join("");

  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  };

  const fail = (what, error) => {
    console.error(what, error);
    toast(`No se pudo ${what}. Probá de nuevo.`);
  };

  /* ---------- Supabase ---------- */

  const cfg = window.MESA_CONFIG;
  const sb = window.supabase && cfg ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  let channel = null;
  let currentUserId = null;

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

  const loadData = async () => {
    const [p, c] = await Promise.all([
      sb.from("mesa_pedidos").select("*").order("id"),
      sb.from("mesa_comentarios").select("*").order("created_at").order("id"),
    ]);
    if (p.error || c.error) return fail("cargar los pedidos", p.error || c.error);
    const byId = new Map(p.data.map((r) => [r.id, fromRow(r)]));
    c.data.forEach((r) => {
      byId.get(r.pedido_id)?.comments.push({ who: r.autor, at: r.created_at, text: r.texto, system: r.sistema });
    });
    state.items = [...byId.values()];
    state.loaded = true;
    render();
    if (state.openId && detailDialog.open) {
      if (find(state.openId)) renderDetail();
      else detailDialog.close();
    }
  };

  let reloadTimer;
  const scheduleReload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadData, 200);
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
    if (status === "SUBSCRIBED" && state.loaded) scheduleReload();
  };

  const subscribe = () => {
    if (channel) sb.removeChannel(channel);
    const onChange = (payload) => {
      if (payload.table === "mesa_pedidos" && payload.eventType === "INSERT" && payload.new.creado_por !== state.me.alias) {
        toast(`Nuevo pedido de ${payload.new.creado_por || "alguien del equipo"}: ${payload.new.titulo}`);
      }
      scheduleReload();
    };
    channel = sb
      .channel("mesa-diseno")
      .on("postgres_changes", { event: "*", schema: "public", table: "mesa_pedidos" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "mesa_comentarios" }, onChange)
      .subscribe(setLive);
  };

  /* ---------- Ingreso ---------- */

  const authEl = {
    form: $("#loginForm"),
    error: $("#authError"),
    denied: $("#authDenied"),
  };

  const lock = () => {
    document.body.classList.add("is-locked");
    if (detailDialog.open) detailDialog.close();
    if (newDialog.open) newDialog.close();
  };

  const showLogin = (msg) => {
    lock();
    authEl.denied.hidden = true;
    authEl.form.hidden = false;
    authEl.error.hidden = !msg;
    authEl.error.textContent = msg || "";
  };

  const showDenied = (email) => {
    lock();
    authEl.form.hidden = true;
    authEl.denied.hidden = false;
    $("#deniedEmail").textContent = email;
  };

  const handleSession = async (session) => {
    if (!session) {
      currentUserId = null;
      state.me = null;
      state.items = [];
      state.loaded = false;
      if (channel) { sb.removeChannel(channel); channel = null; }
      showLogin();
      return;
    }
    if (session.user.id === currentUserId) return;
    currentUserId = session.user.id;

    const email = (session.user.email || "").toLowerCase();
    const { data, error } = await sb.from("mesa_miembros").select("alias, nombre, email, es_disenador").order("alias");
    if (error) {
      currentUserId = null;
      return showLogin("No pudimos verificar tu acceso. Probá de nuevo.");
    }
    const me = data.find((m) => m.email === email);
    if (!me) return showDenied(email);

    state.members = data;
    state.me = me;
    fillStaticSelects();
    document.body.classList.remove("is-locked");
    render();
    await loadData();
    subscribe();
  };

  authEl.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = authEl.form.elements;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || !password) return showLogin("Completá tu email y tu contraseña.");
    const btn = authEl.form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Ingresando…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = "Ingresar";
    if (error) {
      const msg = /invalid login/i.test(error.message)
        ? "Email o contraseña incorrectos."
        : /not confirmed/i.test(error.message)
          ? "Tu cuenta todavía no está confirmada."
          : "No pudimos ingresar. Probá de nuevo.";
      showLogin(msg);
    } else {
      f.password.value = "";
    }
  });

  $("#logoutBtn").addEventListener("click", () => sb.auth.signOut());
  $("#deniedLogout").addEventListener("click", () => sb.auth.signOut());

  /* ---------- Filtros ---------- */

  const mine = (it) => (isDesigner() ? it.designer === state.me.alias : it.createdBy === state.me.alias);

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
    av.textContent = state.me.alias[0];
    av.className = `av ${avatarClass(state.me.alias)}`;
    $("#meName").textContent = state.me.nombre.split(" ")[0];
    $("#meName").title = state.me.nombre;
    $("#meRole").textContent = isDesigner() ? "Equipo de Diseño" : "Solicitante";

    $("#teamAvatars").innerHTML = state.members.filter((m) => m.es_disenador).map((m) => avatar(m.alias)).join("");
  };

  const cardHTML = (it) => {
    const late = isLate(it);
    const n = it.comments.filter((c) => !c.system).length;
    return `
      <article class="card" tabindex="0" draggable="true" data-id="${it.id}" aria-label="${esc(it.code)}: ${esc(it.title)}">
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

  const logChange = (pedidoId, texto) => sb.from("mesa_comentarios").insert({ pedido_id: pedidoId, texto, sistema: true });

  const moveTo = async (id, status) => {
    const it = find(id);
    if (!it || it.status === status) return;
    const prev = it.status;
    it.status = status; // respuesta inmediata en pantalla
    render();
    if (state.openId === it.id) renderDetail();
    const { error } = await sb.from("mesa_pedidos").update({ estado: status }).eq("id", it.id);
    if (error) {
      it.status = prev;
      render();
      return fail("mover el pedido", error);
    }
    await logChange(it.id, `Movió el pedido a «${status}».`);
    toast(`${it.code} → ${status}`);
    scheduleReload();
  };

  /* ---------- Detalle ---------- */

  const detailDialog = $("#detailDialog");

  const renderDetail = () => {
    const it = find(state.openId);
    if (!it) return;
    const late = isLate(it);
    const by = memberOf(it.createdBy);
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
        ${it.createdBy ? `<span class="pill"><b>Pidió</b>${esc(by ? by.nombre : it.createdBy)}</span>` : ""}
        ${it.print ? `<span class="pill">Incluye impresión</span>` : ""}
      </div>
      <div class="detail-controls">
        <label>Estado<select data-field="status">${options(STATUSES.map((s) => s.key), it.status)}</select></label>
        <label>Diseñador<select data-field="designer">${designerOptions(it.designer)}</select></label>
      </div>
      <section class="detail-section">
        <h4>Descripción</h4>
        <p>${it.description ? esc(it.description) : "Sin descripción."}</p>
      </section>
      ${it.link ? `<section class="detail-section"><h4>Referencias</h4><a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.link)}</a></section>` : ""}
      <section class="detail-section">
        <h4>Comentarios y movimientos</h4>
        ${it.comments.length ? it.comments.map((c) => `
          <div class="comment${c.system ? " comment--system" : ""}"><small>${avatar(c.who)}${esc(c.who || "Sistema")} · ${fmtStamp(c.at)}</small><span class="comment__text">${esc(c.text)}</span></div>`).join("") : `<p class="type">Todavía no hay comentarios.</p>`}
        <form class="row" id="commentForm">
          <label class="sr-only" for="commentInput">Nuevo comentario</label>
          <input id="commentInput" autocomplete="off" placeholder="Escribí un comentario como ${esc(state.me.alias)}…" maxlength="1000" />
          <button class="primary" type="submit">Comentar</button>
        </form>
      </section>
      <div class="actions">
        <button class="danger" type="button" data-delete>Eliminar solicitud</button>
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
      const { error } = await sb.from("mesa_pedidos").update({ disenador: designer }).eq("id", it.id);
      if (error) return fail("asignar el pedido", error);
      await logChange(it.id, designer ? `Asignó el pedido a ${designer}.` : "Dejó el pedido sin asignar.");
      toast(designer ? `${it.code} asignado a ${designer}` : `${it.code} sin asignar`);
      scheduleReload();
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
    const { error } = await sb.from("mesa_comentarios").insert({ pedido_id: it.id, texto: text });
    input.disabled = false;
    if (error) return fail("guardar el comentario", error);
    input.value = "";
    await loadData();
    $("#commentInput")?.focus();
  });

  detailDialog.addEventListener("click", async (e) => {
    if (e.target === detailDialog || e.target.closest("[data-close]")) return detailDialog.close();
    if (e.target.closest("[data-delete]")) {
      const it = find(state.openId);
      if (!it || !confirm(`¿Eliminar ${it.code} «${it.title}»? Se borra para todo el equipo.`)) return;
      const { error } = await sb.from("mesa_pedidos").delete().eq("id", it.id);
      if (error) return fail("eliminar el pedido", error);
      detailDialog.close();
      toast(`${it.code} eliminado`);
      await loadData();
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
    const row = {
      titulo: title,
      marca: f.brand.value,
      area: f.area.value,
      tipo: f.type.value,
      prioridad: f.priority.value,
      disenador: f.designer.value || null,
      entrega: f.due.value,
      impresion: f.print.checked,
      link: /^https?:\/\//i.test(link) ? link : null,
      descripcion: f.description.value.trim() || null,
    };
    const btn = newForm.querySelector("button[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.from("mesa_pedidos").insert(row).select().single();
    btn.disabled = false;
    if (error) return fail("crear la solicitud", error);
    await logChange(data.id, "Creó la solicitud.");
    newDialog.close();
    toast(`${code(data.id)} creado en «Nuevas»`);
    await loadData();
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

  // Arrastrar y soltar entre columnas
  const board = $("#board");
  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
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
    if (!col) return;
    e.preventDefault();
    $$(".column.drop", board).forEach((c) => c !== col && c.classList.remove("drop"));
    col.classList.add("drop");
  });
  board.addEventListener("drop", (e) => {
    const col = e.target.closest(".column");
    if (!col) return;
    e.preventDefault();
    col.classList.remove("drop");
    moveTo(e.dataTransfer.getData("text/plain"), col.dataset.status);
  });

  // Al volver a la pestaña, se ponen al día los datos
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.me) scheduleReload();
  });

  /* ---------- Inicio ---------- */

  const fillStaticSelects = () => {
    $("#fBrand").innerHTML = `<option value="">Todas las marcas</option>` + options(BRANDS, "");
    $("#fDesigner").innerHTML =
      `<option value="">Todo el equipo</option>` +
      state.members.filter((m) => m.es_disenador).map((m) => `<option value="${esc(m.alias)}">${esc(m.alias)}</option>`).join("") +
      `<option value="${NONE}">${UNASSIGNED}</option>`;
  };

  if (!sb) {
    showLogin("No se pudo cargar la conexión con la base de datos. Revisá tu conexión y recargá la página.");
    return;
  }

  // INITIAL_SESSION, SIGNED_IN, SIGNED_OUT… (se difiere para no bloquear el cliente de auth)
  sb.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0);
  });
})();
