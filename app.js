/* Mesa de Diseño · Gastro BS AS
   Prototipo interactivo: los pedidos se guardan en localStorage. */
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

  const TEAM = {
    Naza: { name: "Nazareno Devia", cls: "av-n" },
    Agus: { name: "Agustín Monteverdi", cls: "av-a" },
    Bauti: { name: "Bautista Valle", cls: "av-b" },
  };
  const UNASSIGNED = "Sin asignar";

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

  const NAVS = {
    tablero: { title: "Tablero de pedidos", sub: () => "Cada pedido, en la etapa en la que está.", view: "board" },
    mio: { title: "Mi trabajo", sub: (me) => `Lo que tenés asignado, ${me}.`, view: null },
    todas: { title: "Todas las solicitudes", sub: () => "Todo lo que estamos creando, en un solo lugar.", view: "list" },
  };

  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const KEY = "mesa-diseno-v1";
  const ME_KEY = "mesa-diseno-me";

  /* ---------- Datos de ejemplo ---------- */

  const seed = () => [
    {
      id: "DIS-001", title: "Manual de bienvenida para nuevos ingresos", brand: "Sabores Express ARG.",
      area: "Recursos Humanos", type: "Manual", priority: "Alta", designer: "Naza", due: "2026-11-06",
      status: "En progreso", print: true, link: "",
      description: "Manual para el primer día de los nuevos ingresos: historia de la marca, valores, uniforme, horarios y contactos clave.\nTiene que poder imprimirse en A5.",
      comments: [
        { who: "Naza", at: "2026-11-02T10:15", text: "Arranco con la grilla y la portada. Mañana comparto la primera versión." },
      ],
    },
    {
      id: "DIS-002", title: "Cronograma de capacitaciones · Noviembre", brand: "Empanadas Manía",
      area: "Capacitación y Cultura", type: "Capacitación", priority: "Media", designer: "Agus", due: "2026-11-09",
      status: "Nuevas", print: false, link: "",
      description: "Pieza para pantallas y WhatsApp con el cronograma mensual de capacitaciones por local.",
      comments: [],
    },
    {
      id: "DIS-003", title: "Flyer de búsqueda: cocineros y cajeros", brand: "Hamburguesas Extremas",
      area: "Selección", type: "Pieza gráfica", priority: "Urgente", designer: "Bauti", due: "2026-11-07",
      status: "En revisión", print: false, link: "",
      description: "Flyer para redes y portales de empleo. Incluir QR al formulario de postulación.",
      comments: [
        { who: "Bauti", at: "2026-11-04T17:40", text: "Subí dos versiones para que el equipo de Selección elija." },
      ],
    },
    {
      id: "DIS-004", title: "Presentación de resultados Q3", brand: "Gastro (corporativo)",
      area: "Operaciones", type: "Presentación", priority: "Media", designer: "Naza", due: "2026-11-12",
      status: "Con cambios", print: false, link: "",
      description: "Plantilla y armado de la presentación trimestral para la reunión de gerentes.",
      comments: [
        { who: "Agus", at: "2026-11-03T12:00", text: "Operaciones pidió sumar un gráfico por marca en la slide 6." },
      ],
    },
    {
      id: "DIS-005", title: "Señalética de seguridad para cocina", brand: "Pizza Free",
      area: "Seguridad e Higiene", type: "Señalética", priority: "Alta", designer: "Agus", due: "2026-11-14",
      status: "En progreso", print: true, link: "",
      description: "Set de carteles: lavado de manos, uso de EPP, matafuegos y salidas de emergencia.",
      comments: [],
    },
    {
      id: "DIS-006", title: "Organigrama actualizado de Logística", brand: "Gastro (corporativo)",
      area: "Logística y Distribución", type: "Organigrama", priority: "Baja", designer: UNASSIGNED, due: "2026-11-20",
      status: "Nuevas", print: false, link: "",
      description: "Actualizar el organigrama con los nuevos puestos del centro de distribución.",
      comments: [],
    },
    {
      id: "DIS-007", title: "Logo para el programa «Líderes en cocina»", brand: "Gastro (corporativo)",
      area: "Capacitación y Cultura", type: "Logo / identidad", priority: "Media", designer: "Bauti", due: "2026-11-10",
      status: "Aprobadas", print: false, link: "",
      description: "Identificador para el programa interno de formación de jefes de cocina.",
      comments: [
        { who: "Bauti", at: "2026-11-04T09:30", text: "Aprobado por Capacitación. Preparo las versiones finales." },
      ],
    },
    {
      id: "DIS-008", title: "Actualización del Manual de Auditoría v3", brand: "Gastro (corporativo)",
      area: "Auditoría", type: "Manual", priority: "Alta", designer: "Naza", due: "2026-11-03",
      status: "Entregadas", print: true, link: "",
      description: "Nueva versión con los checklists revisados y la sección de no conformidades.",
      comments: [],
    },
  ];

  /* ---------- Estado ---------- */

  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: sigue en memoria */ }
    },
  };

  const load = () => {
    try {
      const data = JSON.parse(storage.get(KEY));
      if (Array.isArray(data)) return data;
    } catch { /* datos corruptos: vuelve al ejemplo */ }
    return seed();
  };

  const state = {
    items: load(),
    nav: "tablero",
    view: "board",
    q: "",
    brand: "",
    designer: "",
    me: TEAM[storage.get(ME_KEY)] ? storage.get(ME_KEY) : "Agus",
    openId: null,
  };

  const save = () => storage.set(KEY, JSON.stringify(state.items));

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

  const fmtStamp = (iso) => {
    const [day, time = ""] = iso.split("T");
    return `${fmtDate(day)} · ${time.slice(0, 5)}`;
  };

  const now = () => {
    const d = new Date();
    return `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const isLate = (it) => it.status !== DONE && it.due && it.due < today();

  const avatar = (who) => {
    const t = TEAM[who];
    return t ? `<i class="av ${t.cls}" aria-hidden="true">${who[0]}</i>` : `<i class="av" aria-hidden="true">–</i>`;
  };

  const statusColor = (key) => (STATUSES.find((s) => s.key === key) || STATUSES[0]).color;

  const options = (list, selected) =>
    list.map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  const designerOptions = (selected) =>
    `<option value="${UNASSIGNED}"${selected === UNASSIGNED ? " selected" : ""}>${UNASSIGNED}</option>` +
    Object.entries(TEAM)
      .map(([k, t]) => `<option value="${k}"${k === selected ? " selected" : ""}>${esc(k)} · ${esc(t.name)}</option>`)
      .join("");

  const nextId = () => {
    const max = state.items.reduce((m, it) => Math.max(m, parseInt(String(it.id).split("-")[1], 10) || 0), 0);
    return `DIS-${String(max + 1).padStart(3, "0")}`;
  };

  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  };

  /* ---------- Filtros ---------- */

  const scoped = () => (state.nav === "mio" ? state.items.filter((it) => it.designer === state.me) : state.items);

  const filtered = () => {
    const q = state.q.trim().toLowerCase();
    return scoped().filter((it) => {
      if (state.brand && it.brand !== state.brand) return false;
      if (state.nav !== "mio" && state.designer && it.designer !== state.designer) return false;
      if (!q) return true;
      return [it.id, it.title, it.brand, it.area, it.type, it.designer, it.status].join(" ").toLowerCase().includes(q);
    });
  };

  /* ---------- Render ---------- */

  const two = (n) => String(n).padStart(2, "0");

  const renderStats = () => {
    const items = scoped();
    $("#stActive").textContent = two(items.filter((i) => i.status !== DONE).length);
    $("#stProd").textContent = two(items.filter((i) => IN_PRODUCTION.includes(i.status)).length);
    $("#stReview").textContent = two(items.filter((i) => IN_REVIEW.includes(i.status)).length);
    $("#stDone").textContent = two(items.filter((i) => i.status === DONE).length);
    $("#myCount").textContent = state.items.filter((i) => i.designer === state.me && i.status !== DONE).length;
  };

  const renderChrome = () => {
    const nav = NAVS[state.nav];
    $("#viewTitle").textContent = nav.title;
    $("#viewSub").textContent = nav.sub(state.me);
    document.title = `${nav.title} · Mesa de Diseño`;

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

    const t = TEAM[state.me];
    const av = $("#meAvatar");
    av.textContent = state.me[0];
    av.className = `av ${t.cls}`;
  };

  const cardHTML = (it) => {
    const late = isLate(it);
    const n = it.comments.filter((c) => !c.system).length;
    return `
      <article class="card" tabindex="0" draggable="true" data-id="${esc(it.id)}" aria-label="${esc(it.id)}: ${esc(it.title)}">
        <div class="card-top"><span class="tag ${TYPES[it.type] ?? ""}">${esc(it.type)}</span><span class="id">${esc(it.id)}</span></div>
        <h3>${esc(it.title)}</h3>
        <div class="type">${esc(it.brand)} · ${esc(it.area)}</div>
        <span class="priority ${esc(it.priority)}">Prioridad ${esc(it.priority.toLowerCase())}</span>
        <div class="card-bottom">
          <span class="who">${avatar(it.designer)}${esc(it.designer)}</span>
          <span class="meta-right">
            ${n ? `<span class="comments-count" title="${n} comentario${n > 1 ? "s" : ""}"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg>${n}</span>` : ""}
            <span class="${late ? "late" : ""}" title="Entrega">${late ? "Vencido · " : ""}${fmtDate(it.due)}</span>
          </span>
        </div>
      </article>`;
  };

  const renderBoard = () => {
    const items = filtered();
    $("#board").innerHTML = STATUSES.map((s) => {
      const col = items.filter((i) => i.status === s.key).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
      return `
        <section class="column" data-status="${esc(s.key)}" aria-label="${esc(s.key)}">
          <div class="column-head"><span class="dot" style="--color:${s.color}"></span>${esc(s.key)}<span class="count">${col.length}</span></div>
          ${col.length ? col.map(cardHTML).join("") : `<div class="empty">Sin pedidos</div>`}
        </section>`;
    }).join("");
  };

  const renderList = () => {
    const items = filtered().sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    if (!items.length) {
      $("#list").innerHTML = `<div class="empty">No hay pedidos con estos filtros.</div>`;
      return;
    }
    $("#list").innerHTML = `
      <table>
        <thead><tr><th scope="col">Pedido</th><th scope="col">Marca</th><th scope="col">Estado</th><th scope="col">Diseñador</th><th scope="col">Entrega</th></tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr tabindex="0" data-id="${esc(it.id)}">
              <td><span class="id">${esc(it.id)}</span><span class="td-title">${esc(it.title)}</span></td>
              <td>${esc(it.brand)}</td>
              <td><span class="status"><span class="dot" style="--color:${statusColor(it.status)}"></span>${esc(it.status)}</span></td>
              <td><span class="who">${avatar(it.designer)}${esc(it.designer)}</span></td>
              <td class="${isLate(it) ? "late" : ""}">${fmtDate(it.due)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  };

  const render = () => {
    renderChrome();
    renderStats();
    if (state.view === "board") renderBoard();
    else renderList();
  };

  /* ---------- Acciones ---------- */

  const find = (id) => state.items.find((i) => i.id === id);

  const logChange = (it, text) => it.comments.push({ who: state.me, at: now(), text, system: true });

  const moveTo = (id, status) => {
    const it = find(id);
    if (!it || it.status === status) return;
    it.status = status;
    logChange(it, `Movió el pedido a «${status}».`);
    save();
    render();
    if (state.openId === id) renderDetail();
    toast(`${it.id} → ${status}`);
  };

  /* ---------- Detalle ---------- */

  const detailDialog = $("#detailDialog");

  const renderDetail = () => {
    const it = find(state.openId);
    if (!it) return;
    const late = isLate(it);
    $("#detailBody").innerHTML = `
      <div class="modal-head">
        <div>
          <p class="eyebrow">${esc(it.id)} · ${esc(it.type)}</p>
          <h2 id="detailTitle">${esc(it.title)}</h2>
        </div>
        <button class="close" type="button" data-close aria-label="Cerrar"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="detail-meta">
        <span class="pill"><b>Marca</b>${esc(it.brand)}</span>
        <span class="pill"><b>Área</b>${esc(it.area)}</span>
        <span class="pill"><b>Prioridad</b>${esc(it.priority)}</span>
        <span class="pill ${late ? "late" : ""}"><b>Entrega</b>${late ? "Vencido · " : ""}${fmtDate(it.due)}</span>
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
          <div class="comment${c.system ? " comment--system" : ""}"><small>${avatar(c.who)}${esc(c.who)} · ${fmtStamp(c.at)}</small><span class="comment__text">${esc(c.text)}</span></div>`).join("") : `<p class="type">Todavía no hay comentarios.</p>`}
        <form class="row" id="commentForm">
          <label class="sr-only" for="commentInput">Nuevo comentario</label>
          <input id="commentInput" autocomplete="off" placeholder="Escribí un comentario como ${esc(state.me)}…" maxlength="500" />
          <button class="primary" type="submit">Comentar</button>
        </form>
      </section>
      <div class="actions">
        <button class="danger" type="button" data-delete>Eliminar solicitud</button>
        <button class="secondary" type="button" data-close>Cerrar</button>
      </div>`;
  };

  const openDetail = (id) => {
    state.openId = id;
    renderDetail();
    if (!detailDialog.open) detailDialog.showModal();
  };

  detailDialog.addEventListener("close", () => { state.openId = null; });

  detailDialog.addEventListener("change", (e) => {
    const field = e.target.dataset.field;
    const it = find(state.openId);
    if (!field || !it) return;
    if (field === "status") return moveTo(it.id, e.target.value);
    if (field === "designer") {
      it.designer = e.target.value;
      logChange(it, it.designer === UNASSIGNED ? "Dejó el pedido sin asignar." : `Asignó el pedido a ${it.designer}.`);
      save();
      render();
      renderDetail();
      toast(`${it.id} asignado a ${it.designer}`);
    }
  });

  detailDialog.addEventListener("submit", (e) => {
    if (e.target.id !== "commentForm") return;
    e.preventDefault();
    const input = $("#commentInput");
    const text = input.value.trim();
    const it = find(state.openId);
    if (!text || !it) return;
    it.comments.push({ who: state.me, at: now(), text });
    save();
    render();
    renderDetail();
    $("#commentInput").focus();
  });

  detailDialog.addEventListener("click", (e) => {
    if (e.target === detailDialog || e.target.closest("[data-close]")) return detailDialog.close();
    if (e.target.closest("[data-delete]")) {
      const it = find(state.openId);
      if (it && confirm(`¿Eliminar ${it.id} «${it.title}»?`)) {
        state.items = state.items.filter((i) => i !== it);
        save();
        detailDialog.close();
        render();
        toast(`${it.id} eliminado`);
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
      designers: designerOptions(UNASSIGNED),
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

  newForm.addEventListener("submit", (e) => {
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
    const it = {
      id: nextId(),
      title,
      brand: f.brand.value,
      area: f.area.value,
      type: f.type.value,
      priority: f.priority.value,
      designer: f.designer.value,
      due: f.due.value,
      status: "Nuevas",
      print: f.print.checked,
      link: /^https?:\/\//i.test(link) ? link : "",
      description: f.description.value.trim(),
      comments: [{ who: state.me, at: now(), text: "Creó la solicitud.", system: true }],
    };
    state.items.push(it);
    save();
    newDialog.close();
    render();
    toast(`${it.id} creado en «Nuevas»`);
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

  $("#me").addEventListener("change", (e) => {
    state.me = e.target.value;
    storage.set(ME_KEY, state.me);
    render();
    toast(`Usando la mesa como ${state.me}`);
  });

  $("#newBtn").addEventListener("click", openNew);

  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("¿Volver a los pedidos de ejemplo? Se pierden los cambios de esta demo.")) return;
    state.items = seed();
    save();
    render();
    toast("Demo restablecida");
  });

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

  /* ---------- Inicio ---------- */

  $("#fBrand").insertAdjacentHTML("beforeend", options(BRANDS, ""));
  $("#fDesigner").insertAdjacentHTML(
    "beforeend",
    Object.entries(TEAM).map(([k]) => `<option value="${k}">${k}</option>`).join("") + `<option value="${UNASSIGNED}">${UNASSIGNED}</option>`
  );
  $("#me").innerHTML = Object.keys(TEAM).map((k) => `<option value="${k}"${k === state.me ? " selected" : ""}>${k}</option>`).join("");

  render();
})();
