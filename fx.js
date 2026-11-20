/* Mesa de Diseño · Capa de micro-interacciones (solo visual).
   Tema claro/oscuro, lente del cursor, superficie magnética, chispas, rebote al soltar,
   celebración al finalizar, odómetro, transiciones, paleta Ctrl+K y vida ambiental.
   No lee ni escribe datos: escucha los mismos eventos de la página y decora el resultado. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");
  const motionOK = () => !reduce.matches;
  const PALETTE = () => (root.classList.contains("dark")
    ? ["#2ee59d", "#4cc39e", "#c5b08b", "#d1fae5"]
    : ["#0e382c", "#1a5e4b", "#2ee59d", "#c5b08b"]);
  const DONE = "Finalizado";

  /* ---------- Tema claro / oscuro (persistente) ---------- */

  const syncToggles = () => {
    const dark = root.classList.contains("dark");
    $$("[data-theme-toggle]").forEach((b) => {
      b.setAttribute("aria-pressed", String(dark));
      b.setAttribute("aria-label", dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
      const label = b.querySelector("span");
      if (label) label.textContent = dark ? "Oscuro" : "Claro";
    });
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#060908" : "#11382b";
  };

  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-toggle]")) return;
    const dark = !root.classList.contains("dark");
    root.classList.toggle("dark", dark);
    try { localStorage.setItem("mesa-tema", dark ? "dark" : "light"); } catch { /* sin almacenamiento */ }
    syncToggles();
  });
  syncToggles();

  /* ---------- Fondo vivo ---------- */

  const ambient = document.createElement("div");
  ambient.className = "fx-ambient";
  ambient.setAttribute("aria-hidden", "true");
  ambient.innerHTML = `<div class="fx-grid"></div><div class="fx-orb fx-orb--a"></div><div class="fx-orb fx-orb--b"></div>`;
  for (let i = 0; i < 10; i++) {
    const d = document.createElement("span");
    d.className = "fx-dust";
    d.style.left = `${8 + Math.random() * 88}%`;
    d.style.top = `${15 + Math.random() * 80}%`;
    d.style.animationDuration = `${9 + Math.random() * 8}s`;
    d.style.animationDelay = `${-Math.random() * 12}s`;
    ambient.appendChild(d);
  }
  document.body.prepend(ambient);

  /* ---------- Lente óptica del cursor (solo mouse) ---------- */

  const INTERACTIVE = "a, button, select, input, textarea, label, .card, [data-tip], tbody tr";
  let lens = null;
  let lx = 0, ly = 0, tx = 0, ty = 0, lensRaf = 0;

  const lensLoop = () => {
    lx += (tx - lx) * 0.18;
    ly += (ty - ly) * 0.18;
    const size = lens.classList.contains("is-hover") ? 84 : 64;
    lens.style.transform = `translate3d(${lx - size / 2}px, ${ly - size / 2}px, 0)`;
    lensRaf = Math.abs(tx - lx) + Math.abs(ty - ly) > 0.3 ? requestAnimationFrame(lensLoop) : 0;
  };

  if (finePointer.matches && motionOK()) {
    lens = document.createElement("div");
    lens.className = "fx-lens";
    lens.setAttribute("aria-hidden", "true");
    document.body.appendChild(lens);
    document.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      lens.classList.add("is-on");
      lens.classList.toggle("is-hover", Boolean(e.target.closest?.(INTERACTIVE)));
      if (!lensRaf) lensRaf = requestAnimationFrame(lensLoop);
    }, { passive: true });
    document.addEventListener("pointerleave", () => lens.classList.remove("is-on"));
    window.addEventListener("blur", () => lens.classList.remove("is-on"));
  }

  /* ---------- Superficie magnética: halo + inclinación 3D suave ---------- */

  const LIVE = ".card, .stat, .vtile, .vcard";
  const TILT = ".card, .stat:not(.stat--dark)";
  let liveEl = null;
  let pending = null;

  const resetLive = (el) => {
    if (!el) return;
    el.style.setProperty("--spot", "0");
    if (el.matches(TILT)) el.style.transform = "";
  };

  const applyLive = () => {
    const { el, x, y } = pending;
    pending = null;
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    const px = (x - r.left) / r.width;
    const py = (y - r.top) / r.height;
    el.classList.add("fx-live");
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
    el.style.setProperty("--spot", "1");
    if (motionOK() && el.matches(TILT) && !el.classList.contains("dragging")) {
      const max = el.classList.contains("card") ? 4 : 3;
      el.style.transform = `perspective(700px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateY(-2px)`;
    }
  };

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest?.(LIVE);
    if (el !== liveEl) {
      resetLive(liveEl);
      liveEl = el;
    }
    if (!el) return;
    if (!pending) requestAnimationFrame(applyLive);
    pending = { el, x: e.clientX, y: e.clientY };
  }, { passive: true });

  /* ---------- Chispas al hacer clic ---------- */

  const burstPixels = (x, y, n = 6) => {
    if (!motionOK()) return;
    const colors = PALETTE();
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "fx-px";
      p.style.left = `${x - 2}px`;
      p.style.top = `${y - 2}px`;
      p.style.background = colors[i % colors.length];
      document.body.appendChild(p);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const d = 18 + Math.random() * 16;
      p.animate([
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0.4)`, opacity: 0 },
      ], { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }).onfinish = () => p.remove();
    }
  };

  document.addEventListener("click", (e) => {
    if (e.detail === 0) return; // teclado: sin chispas
    if (e.target.closest(".card, .primary, #newBtn")) burstPixels(e.clientX, e.clientY);
  });

  /* ---------- Atracción magnética del botón principal ---------- */

  const cta = $("#newBtn");
  if (cta && finePointer.matches) {
    document.addEventListener("pointermove", (e) => {
      if (!motionOK() || cta.offsetParent === null) return;
      const r = cta.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const near = Math.hypot(dx, dy) < Math.max(r.width, r.height) * 0.9;
      cta.style.transform = near ? `translate(${dx * 0.08}px, ${dy * 0.12}px)` : "";
    }, { passive: true });
  }

  /* ---------- Celebración al pasar a «Finalizado» ---------- */

  const kpiDone = () => $("#stDone");

  const celebrate = (x, y) => {
    if (!motionOK()) return;
    const colors = PALETTE();
    for (let i = 0; i < 26; i++) {
      const c = document.createElement("span");
      c.className = "fx-confetti";
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      c.style.background = colors[i % colors.length];
      c.style.borderRadius = i % 3 === 0 ? "50%" : "1px";
      document.body.appendChild(c);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9; // abanico hacia arriba
      const d = 70 + Math.random() * 90;
      const rot = (Math.random() - 0.5) * 540;
      c.animate([
        { transform: "translate(-50%,-50%) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(${rot}deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.15}px), calc(-50% + ${Math.sin(a) * d + 60}px)) rotate(${rot * 1.4}deg)`, opacity: 0 },
      ], { duration: 1300 + Math.random() * 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }).onfinish = () => c.remove();
    }
    const seal = document.createElement("div");
    seal.className = "fx-seal";
    seal.textContent = "FINALIZADO 😉";
    seal.style.left = `${x}px`;
    seal.style.top = `${y}px`;
    document.body.appendChild(seal);
    setTimeout(() => seal.remove(), 1700);
  };

  const pointOf = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };

  // Rebote al soltar una tarjeta y destello de la columna destino
  const afterRender = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  const board = $("#board");
  let dragFrom = null;
  board?.addEventListener("dragstart", (e) => {
    dragFrom = e.target.closest(".column")?.dataset.status || null;
  });
  board?.addEventListener("drop", (e) => {
    const col = e.target.closest(".column");
    const id = e.dataTransfer?.getData("text/plain");
    if (!col || !id) return;
    const to = col.dataset.status;
    const x = e.clientX;
    const y = e.clientY;
    afterRender(() => {
      const card = board.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      card?.classList.add("fx-land");
      board.querySelector(`.column[data-status="${CSS.escape(to)}"]`)?.classList.add("fx-col-flash");
      if (to === DONE && dragFrom !== DONE) {
        celebrate(x, y);
        card?.classList.add("fx-flash");
      }
      dragFrom = null;
    });
  });

  // Lista editable: cambio de estado a Finalizado
  const list = $("#list");
  list?.addEventListener("change", (e) => {
    const sel = e.target.closest('select[data-edit="estado"]');
    if (!sel || sel.value !== DONE) return;
    const was = sel.querySelector("option[selected]")?.value;
    if (was === DONE) return;
    const [x, y] = pointOf(sel);
    celebrate(x, y);
  }, true);

  // Panel lateral: guardar con estado Finalizado
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "editForm") return;
    const sel = e.target.elements.estado;
    if (!sel || sel.value !== DONE || sel.querySelector("option[selected]")?.value === DONE) return;
    const btn = e.target.querySelector("button[type=submit]");
    const [x, y] = pointOf(btn || sel);
    celebrate(x, y);
  }, true);

  /* ---------- Odómetro: contador de modificaciones y KPIs ---------- */

  const pop = (el) => {
    if (!el || !motionOK()) return;
    el.classList.remove("fx-pop");
    void el.offsetWidth;
    el.classList.add("fx-pop");
  };

  let modsRow = null;
  list?.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mods]");
    if (m) modsRow = m.closest("[data-row]")?.dataset.row || null;
  }, true);
  if (list) {
    new MutationObserver(() => {
      if (!modsRow) return;
      pop(list.querySelector(`[data-row="${CSS.escape(modsRow)}"] .counter b`));
      modsRow = null;
    }).observe(list, { childList: true });
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-dmods]")) requestAnimationFrame(() => pop($("#dMods")));
  });

  // Los KPIs saltan cuando cambia su número
  $$("#kpis strong").forEach((el) => {
    let last = el.textContent;
    new MutationObserver(() => {
      if (el.textContent !== last) {
        if (last !== "00") pop(el);
        last = el.textContent;
      }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  /* ---------- Transiciones suaves entre vistas ---------- */

  const enterVisible = () => {
    if (!motionOK()) return;
    ["#board", "#list", "#stats", "#admin"].forEach((sel) => {
      const el = $(sel);
      if (el && !el.hidden && el.offsetParent !== null) {
        el.classList.remove("fx-enter");
        void el.offsetWidth;
        el.classList.add("fx-enter");
      }
    });
  };

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-view], .nav [data-nav], [data-scope]")) afterRender(enterVisible);
  });

  /* ---------- Tablero: arrastrar el fondo y desplazamiento automático en los bordes ---------- */

  if (board) {
    let panning = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    board.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".card, button, a, select, input")) return;
      if (board.scrollWidth <= board.clientWidth) return;
      panning = true;
      moved = false;
      startX = e.pageX;
      startLeft = board.scrollLeft;
      board.classList.add("is-panning");
    });
    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 3) moved = true;
      board.scrollLeft = startLeft - dx * 1.35;
    });
    window.addEventListener("mouseup", () => {
      if (!panning) return;
      panning = false;
      board.classList.remove("is-panning");
    });
    // Un arrastre del fondo no cuenta como clic
    board.addEventListener("click", (e) => {
      if (moved) {
        e.stopPropagation();
        moved = false;
      }
    }, true);

    // Al llevar una tarjeta cerca del borde, el tablero se desplaza solo
    let edgeSpeed = 0;
    let edgeRaf = 0;
    const edgeStep = () => {
      if (!edgeSpeed) { edgeRaf = 0; return; }
      board.scrollLeft += edgeSpeed;
      edgeRaf = requestAnimationFrame(edgeStep);
    };
    board.addEventListener("dragover", (e) => {
      const r = board.getBoundingClientRect();
      const edge = 75;
      edgeSpeed = e.clientX < r.left + edge ? -10 : e.clientX > r.right - edge ? 10 : 0;
      if (edgeSpeed && !edgeRaf) edgeRaf = requestAnimationFrame(edgeStep);
    });
    const stopEdge = () => { edgeSpeed = 0; };
    board.addEventListener("drop", stopEdge);
    board.addEventListener("dragend", stopEdge);
    board.addEventListener("dragleave", (e) => { if (!board.contains(e.relatedTarget)) stopEdge(); });
  }

  /* ---------- Paleta de comandos (Ctrl + K / Cmd + K) ---------- */

  const ui = () => window.MesaUI;
  const pal = document.createElement("div");
  pal.className = "fx-palette";
  pal.hidden = true;
  pal.innerHTML = `
    <div class="fx-palette__box" role="dialog" aria-modal="true" aria-label="Buscar o ir a">
      <input class="fx-palette__input" type="search" placeholder="Buscar pedido por ID o título, o ir a una vista…" aria-label="Buscar" autocomplete="off" />
      <ul class="fx-palette__list" role="listbox"></ul>
      <div class="fx-palette__hint"><span><kbd>↑</kbd> <kbd>↓</kbd> elegir · <kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
    </div>`;
  document.body.appendChild(pal);
  const palInput = $(".fx-palette__input", pal);
  const palList = $(".fx-palette__list", pal);
  let palItems = [];
  let palIndex = 0;

  const actions = () => {
    const click = (sel) => () => document.querySelector(sel)?.click();
    const design = ui()?.designer();
    const base = design
      ? [
          ["Mi trabajo", click('.nav [data-nav="mio"]')],
          ["Tablero de pedidos", click('.nav [data-nav="tablero"]')],
          ["Tablero General", click('.nav [data-nav="general"]')],
          ["Estadísticas", click('[data-view="stats"]')],
          ["Perfiles y áreas", click('.nav [data-nav="accesos"]')],
          ["Nuevo proyecto", click("#newBtn")],
        ]
      : [
          ["Tablero del área", click('.nav [data-nav="area"]:not([data-set-view])')],
          ["Estadísticas de mi área", click('.nav [data-set-view="stats"]')],
          ["Nueva solicitud", click("#newBtn")],
        ];
    base.push(["Cambiar modo claro / oscuro", click("[data-theme-toggle]")]);
    return base.map(([label, run]) => ({ label, hint: "Ir", run }));
  };

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const renderPalette = () => {
    const q = norm(palInput.value.trim());
    const acts = actions().filter((a) => !q || norm(a.label).includes(q));
    const peds = (ui()?.items() || [])
      .filter((i) => q && norm(`${i.code} ${i.title} ${i.area}`).includes(q))
      .slice(0, 8)
      .map((i) => ({ label: `${i.code} · ${i.title}`, hint: i.status, run: () => ui().open(i.id) }));
    palItems = [...peds, ...acts];
    palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
    palList.innerHTML = "";
    const group = (title) => {
      const li = document.createElement("li");
      li.className = "fx-palette__group";
      li.textContent = title;
      palList.appendChild(li);
    };
    palItems.forEach((it, i) => {
      if (i === 0 && peds.length) group("Pedidos");
      if (i === peds.length) group("Ir a");
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === palIndex));
      li.dataset.i = String(i);
      const label = document.createElement("span");
      label.textContent = it.label;
      const hint = document.createElement("small");
      hint.textContent = it.hint;
      li.append(label, hint);
      palList.appendChild(li);
    });
    if (!palItems.length) {
      const li = document.createElement("li");
      li.className = "fx-palette__group";
      li.textContent = "Sin resultados";
      palList.appendChild(li);
    }
  };

  const openPalette = () => {
    if (!ui()?.ready() || document.body.classList.contains("is-locked")) return;
    pal.hidden = false;
    palInput.value = "";
    palIndex = 0;
    renderPalette();
    palInput.focus();
  };
  const closePalette = () => { pal.hidden = true; };
  const runPalette = (i) => {
    const it = palItems[i];
    if (!it) return;
    closePalette();
    it.run();
  };

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (pal.hidden) openPalette();
      else closePalette();
    }
  });
  palInput.addEventListener("input", () => { palIndex = 0; renderPalette(); });
  palInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closePalette();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      palIndex = (palIndex + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
      renderPalette();
      palList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runPalette(palIndex);
    }
  });
  pal.addEventListener("click", (e) => {
    if (e.target === pal) return closePalette();
    const li = e.target.closest("li[data-i]");
    if (li) runPalette(Number(li.dataset.i));
  });
})();
