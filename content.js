(() => {
  "use strict";

  const state = {
    sidebarMode: "visible", // "visible" | "hidden" | "avatars"
    blur: false,
    fabPos: null, // { right, bottom } salvo após arrastar
  };

  const isHidden = () => state.sidebarMode === "hidden";
  const isAvatars = () => state.sidebarMode === "avatars";
  // Nos dois modos a coluna original do WhatsApp fica escondida
  const colHidden = () => isHidden() || isAvatars();

  // ---------------------------------------------------------------------------
  // Armazenamento
  // ---------------------------------------------------------------------------
  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ["sidebarMode", "sidebarHidden", "blur", "fabPos"],
        (data) => {
          // Compatível com a versão antiga (sidebarHidden: true/false)
          state.sidebarMode =
            data.sidebarMode || (data.sidebarHidden ? "hidden" : "visible");
          state.blur = !!data.blur;
          state.fabPos = data.fabPos || null;
          resolve();
        }
      );
    });
  }

  function saveState() {
    chrome.storage.local.set({
      sidebarMode: state.sidebarMode,
      blur: state.blur,
      fabPos: state.fabPos,
    });
  }

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------

  // Encontra a coluna esquerda inteira a partir de #side, subindo na árvore
  // até o ponto em que o elemento pai fica bem mais largo que a coluna
  // (ou seja, o pai também contém o painel da conversa).
  function findSidebarColumn() {
    const side = document.getElementById("side");
    if (!side) return null;

    let el = side;
    while (el.parentElement && el.parentElement !== document.body) {
      const parent = el.parentElement;
      const w = el.getBoundingClientRect().width;
      const pw = parent.getBoundingClientRect().width;
      if (pw - w > 100) return el;
      el = parent;
    }
    return null;
  }

  // Primeira cor de fundo não transparente subindo na árvore
  function findBackground(el) {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return "#fff";
  }

  function removeClasses(...classes) {
    const sel = classes.map((c) => "." + c).join(",");
    document
      .querySelectorAll(sel)
      .forEach((el) => el.classList.remove(...classes));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ---------------------------------------------------------------------------
  // Modo lateral: aplica o modo atual e desfaz os outros
  // ---------------------------------------------------------------------------
  function applySidebar() {
    if (!isAvatars()) clearAvatars();
    if (!colHidden()) clearHidden();
    if (colHidden()) applyHidden();
    if (isAvatars()) applyAvatars();
    updateMenuLabels();
  }

  // Proteção: se o WhatsApp recriar a coluna em loop, desliga o modo
  const reapplyTimes = [];
  function loopDetected() {
    const now = Date.now();
    reapplyTimes.push(now);
    while (reapplyTimes.length && now - reapplyTimes[0] > 5000) {
      reapplyTimes.shift();
    }
    if (reapplyTimes.length > 15) {
      console.warn("[Whats Edit] loop detectado; voltando ao modo visível");
      reapplyTimes.length = 0;
      state.sidebarMode = "visible";
      saveState();
      clearAvatars();
      clearHidden();
      updateMenuLabels();
      return true;
    }
    return false;
  }

  function setSidebarMode(mode) {
    state.sidebarMode = mode;
    saveState();
    applySidebar();
  }

  // ---------------------------------------------------------------------------
  // Modo "escondida": coluna some por completo
  // ---------------------------------------------------------------------------
  let hiddenEl = null;
  let hiddenEdge = null; // posição x onde a lista terminava

  function applyHidden() {
    // Se já está escondida e ainda no DOM, nada a fazer
    if (hiddenEl && hiddenEl.isConnected) return;

    floatOpen = false;
    const col = findSidebarColumn();
    if (!col) return;
    if (loopDetected()) return;
    hiddenEl = col;
    // Guarda onde a lista terminava (bordas soltas ficam nessa posição)
    hiddenEdge = col.getBoundingClientRect().right;
    // Só esconde a coluna: o painel da conversa já tem flex-grow
    // e ocupa o espaço livre sozinho.
    col.classList.add("we-hidden-sidebar");

    // Remove a borda que separa a lista da conversa (vira uma linha solta)
    for (const sib of col.parentElement.children) {
      if (sib !== col && parseFloat(getComputedStyle(sib).flexGrow) > 0) {
        sib.classList.add("we-no-border");
      }
    }
    requestAnimationFrame(hideDividers);
  }

  function clearHidden() {
    closeFloat();
    removeClasses("we-divider-hidden", "we-divider-noborder");
    removeClasses("we-no-border");
    removeClasses("we-hidden-sidebar");
    hiddenEl = null;
  }

  // Esconde divisórias soltas que ficam no meio da tela onde a lista
  // terminava: elementos finos e altos, ou caixas com borda nessa posição
  // (ex.: camadas de painéis do WhatsApp que ficam por cima da lista).
  function hideDividers() {
    if (!colHidden() || !hiddenEl || !hiddenEl.isConnected) return;
    const root = hiddenEl.parentElement;
    const main = document.getElementById("main");
    const minHeight = window.innerHeight * 0.4;
    const near = (x) => hiddenEdge !== null && Math.abs(x - hiddenEdge) <= 3;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) =>
        el === hiddenEl || el === main ? NodeFilter.FILTER_REJECT
                                        : NodeFilter.FILTER_ACCEPT,
    });
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      const r = el.getBoundingClientRect();
      if (r.height < minHeight || r.width === 0) continue;

      if (r.width <= 6 && !el.classList.contains("we-divider-hidden")) {
        el.classList.add("we-divider-hidden");
        console.debug("[Whats Edit] divisória fina escondida:", el);
        continue;
      }

      const cs = getComputedStyle(el);
      const borderRight = parseFloat(cs.borderRightWidth) > 0 && near(r.right);
      const borderLeft = parseFloat(cs.borderLeftWidth) > 0 && near(r.left);
      if ((borderRight || borderLeft) && !el.classList.contains("we-divider-noborder")) {
        el.classList.add("we-divider-noborder");
        console.debug("[Whats Edit] borda removida:", el);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Modo "escondida": lateral flutuante ao passar o mouse no botão "Conversas"
  // ---------------------------------------------------------------------------
  let floatOpen = false;
  let closeTimer = null;

  // O botão "Conversas" fica na barra de ícones (irmã da coluna escondida)
  function getChatsButton(target) {
    if (!hiddenEl || !target || !target.closest) return null;
    const btn = target.closest('button, [role="button"], a');
    if (!btn || hiddenEl.contains(btn)) return null;
    if (!hiddenEl.parentElement.contains(btn)) return null;
    const main = document.getElementById("main");
    if (main && main.contains(btn)) return null;

    const label = btn.getAttribute("aria-label") || btn.title || "";
    if (/conversas|chats/i.test(label)) return btn;
    const icon = btn.querySelector("[data-icon]");
    if (icon && /^chats?(-|$)/i.test(icon.dataset.icon)) return btn;
    return null;
  }

  function openFloat(btn) {
    clearTimeout(closeTimer);
    if (floatOpen || !hiddenEl) return;

    const parent = hiddenEl.parentElement;
    const rail = [...parent.children].find((c) => c.contains(btn)) || btn;
    const railRect = rail.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    hiddenEl.style.setProperty("--we-left", railRect.right + "px");
    hiddenEl.style.setProperty("--we-top", parentRect.top + "px");
    hiddenEl.style.setProperty("--we-height", parentRect.height + "px");
    hiddenEl.style.background = findBackground(hiddenEl);
    hiddenEl.classList.add("we-float");
    floatOpen = true;

    // Modo só fotos: a lista completa ocupa o lugar da faixa de fotos
    hideCard();
    if (strip) strip.classList.add("we-strip-off");
  }

  function closeFloat() {
    clearTimeout(closeTimer);
    floatOpen = false;
    if (strip) strip.classList.remove("we-strip-off");
    document.querySelectorAll(".we-float").forEach((el) => {
      el.classList.remove("we-float");
      el.style.removeProperty("--we-left");
      el.style.removeProperty("--we-top");
      el.style.removeProperty("--we-height");
      el.style.background = "";
    });
  }

  // Mantém aberto enquanto o usuário digita na busca da lateral
  function isTypingInFloat() {
    const a = document.activeElement;
    return (
      hiddenEl &&
      hiddenEl.contains(a) &&
      a.matches('input, textarea, [contenteditable="true"]')
    );
  }

  function scheduleClose(delay = 300) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!isTypingInFloat()) closeFloat();
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Modo "só fotos": a coluna original fica escondida (como no modo
  // escondida) e a extensão desenha a própria faixa de fotos, copiando os
  // dados das conversas que o WhatsApp tem na página. Não mexe na largura
  // da coluna do WhatsApp.
  // ---------------------------------------------------------------------------
  const STRIP_WIDTH = 72;
  let strip = null;
  let stripKey = "";
  let stripTimer = null;
  let card = null;
  let cardRow = null;

  function applyAvatars() {
    if (!hiddenEl) return;
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "we-strip";
      document.body.appendChild(strip);
    }
    // Abre espaço à esquerda do painel da conversa para a faixa
    for (const sib of hiddenEl.parentElement.children) {
      if (sib !== hiddenEl && parseFloat(getComputedStyle(sib).flexGrow) > 0) {
        sib.classList.add("we-avatar-space");
      }
    }
    positionStrip();
    renderStrip();
  }

  function clearAvatars() {
    hideCard();
    clearTimeout(stripTimer);
    removeClasses("we-avatar-space");
    if (strip) strip.remove();
    strip = null;
    stripKey = "";
  }

  // Coloca a faixa colada na barra de ícones da esquerda
  function positionStrip() {
    if (!strip || !hiddenEl || !hiddenEl.isConnected) return;
    const parent = hiddenEl.parentElement;
    const pRect = parent.getBoundingClientRect();
    let left = pRect.left + 64;
    for (const sib of parent.children) {
      if (sib === hiddenEl) continue;
      const r = sib.getBoundingClientRect();
      const pos = getComputedStyle(sib).position;
      if (pos !== "absolute" && pos !== "fixed" && r.width > 20 && r.width < 120) {
        left = r.right;
        break;
      }
    }
    Object.assign(strip.style, {
      left: left + "px",
      top: pRect.top + "px",
      height: pRect.height + "px",
      width: STRIP_WIDTH + "px",
      background: findBackground(hiddenEl),
    });
  }

  function scheduleStrip() {
    clearTimeout(stripTimer);
    stripTimer = setTimeout(renderStrip, 400);
  }

  function getChatRows() {
    const pane = document.getElementById("pane-side");
    if (!pane) return [];
    let rows = [...pane.querySelectorAll('[role="listitem"]')];
    if (!rows.length) rows = [...pane.querySelectorAll('[role="row"]')];
    // A lista é virtualizada: a ordem visual vem do translateY
    const y = (el) => {
      const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform || "");
      return m ? parseFloat(m[1]) : 0;
    };
    return rows.sort((a, b) => y(a) - y(b));
  }

  function rowInfo(row) {
    const nameEl = row.querySelector("span[title]");
    const img = row.querySelector("img");
    const unreadEl = row.querySelector(
      '[aria-label*="não lida" i], [aria-label*="unread" i]'
    );
    return {
      name: nameEl ? nameEl.title : "",
      img: img && img.src ? img.src : "",
      unread: unreadEl ? unreadEl.textContent.trim() : "",
    };
  }

  function renderStrip() {
    if (!strip || !isAvatars()) return;
    const rows = getChatRows();
    const infos = rows.map(rowInfo);

    // Só redesenha se algo mudou (evita trabalho à toa)
    const key = infos.map((i) => i.name + "|" + i.img + "|" + i.unread).join("\n");
    if (key === stripKey) return;
    stripKey = key;

    const items = rows.map((row, idx) => {
      const info = infos[idx];
      const item = document.createElement("div");
      item.className = "we-av-item";
      item.title = "";

      if (info.img) {
        const img = document.createElement("img");
        img.src = info.img;
        img.alt = "";
        item.appendChild(img);
      } else {
        const ini = document.createElement("div");
        ini.className = "we-av-initials";
        ini.textContent = (info.name.trim()[0] || "?").toUpperCase();
        item.appendChild(ini);
      }

      if (info.unread) {
        const badge = document.createElement("span");
        badge.className = "we-av-badge";
        badge.textContent = info.unread;
        item.appendChild(badge);
      }

      item.addEventListener("click", () => openChat(row, info.name));
      item.addEventListener("mouseenter", () => showCard(row, item));
      item.addEventListener("mouseleave", hideCard);
      return item;
    });

    strip.replaceChildren(...items);
  }

  // Abre a conversa simulando um clique na linha original (escondida)
  function openChat(row, name) {
    if (!row.isConnected && name) {
      row = getChatRows().find((r) => rowInfo(r).name === name) || row;
    }
    const target = row.querySelector("span[title]") || row;
    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
      );
    }
  }

  function showCard(row, anchor) {
    if (row === cardRow) return;
    cardRow = row;

    if (!card) {
      card = document.createElement("div");
      card.id = "we-card";
      document.body.appendChild(card);
    }

    // Copia a linha da conversa (nome, hora, última mensagem, contador)
    const clone = row.cloneNode(true);
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    clone.removeAttribute("id");
    Object.assign(clone.style, {
      position: "relative",
      transform: "none",
      top: "0",
      left: "0",
      width: "100%",
    });

    card.replaceChildren(clone);
    card.style.background = findBackground(row);

    const aRect = anchor.getBoundingClientRect();
    const sRect = strip.getBoundingClientRect();
    card.style.left = sRect.right + 6 + "px";
    card.classList.add("we-show");
    const top = clamp(
      aRect.top + aRect.height / 2 - card.offsetHeight / 2,
      4,
      window.innerHeight - card.offsetHeight - 4
    );
    card.style.top = top + "px";
  }

  function hideCard() {
    cardRow = null;
    if (card) {
      card.classList.remove("we-show");
      card.replaceChildren();
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos de mouse/teclado da lateral (os dois modos)
  // ---------------------------------------------------------------------------
  function setupSidebarEvents() {
    document.addEventListener("mouseover", (e) => {
      // Lateral flutuante (modo escondida e modo só fotos)
      if (!colHidden() || !hiddenEl) return;
      const btn = getChatsButton(e.target);
      if (btn) return openFloat(btn);
      if (!floatOpen) return;
      if (hiddenEl.contains(e.target)) clearTimeout(closeTimer);
      else scheduleClose();
    });

    document.documentElement.addEventListener("mouseleave", () => {
      if (floatOpen) scheduleClose();
      hideCard();
    });

    // A faixa rola por baixo do cartão: esconde para não ficar desalinhado
    document.addEventListener("wheel", () => hideCard(), { passive: true });

    window.addEventListener("resize", positionStrip);

    // Clique fora da lateral flutuante -> fecha
    document.addEventListener("mousedown", (e) => {
      if (!floatOpen || !hiddenEl) return;
      if (!hiddenEl.contains(e.target) && !getChatsButton(e.target)) {
        closeFloat();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (floatOpen && e.key === "Escape") closeFloat();
    });
  }

  // ---------------------------------------------------------------------------
  // Ação: modo desfocado (texto só aparece com o mouse em cima)
  // ---------------------------------------------------------------------------
  function applyBlur() {
    document.documentElement.classList.toggle("we-blur", state.blur);
    updateMenuLabels();
  }

  function toggleBlur() {
    state.blur = !state.blur;
    saveState();
    applyBlur();
  }

  // ---------------------------------------------------------------------------
  // Lista de ações do menu (adicione novas aqui)
  // ---------------------------------------------------------------------------
  const actions = [
    {
      id: "toggle-sidebar",
      label: () => (isHidden() ? "Mostrar conversas" : "Esconder conversas"),
      shortcut: "Alt+S",
      key: "KeyS",
      run: () => setSidebarMode(isHidden() ? "visible" : "hidden"),
    },
    {
      id: "toggle-avatars",
      label: () => (isAvatars() ? "Mostrar conversas" : "Só fotos"),
      shortcut: "Alt+A",
      key: "KeyA",
      run: () => setSidebarMode(isAvatars() ? "visible" : "avatars"),
    },
    {
      id: "toggle-blur",
      label: () => (state.blur ? "Desativar desfoque" : "Desfocar textos"),
      shortcut: "Alt+B",
      key: "KeyB",
      run: toggleBlur,
    },
  ];

  // ---------------------------------------------------------------------------
  // UI: botão flutuante + menu
  // ---------------------------------------------------------------------------
  let root, fab, menu;

  function buildUI() {
    root = document.createElement("div");
    root.id = "we-root";

    menu = document.createElement("div");
    menu.id = "we-menu";

    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "we-item";
      btn.dataset.action = action.id;
      btn.innerHTML = `<span class="we-label"></span><span class="we-kbd">${action.shortcut || ""}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action.run();
        closeMenu();
      });
      menu.appendChild(btn);
    }

    fab = document.createElement("button");
    fab.id = "we-fab";
    fab.title = "Whats Edit";
    fab.textContent = "⚙";

    root.appendChild(menu);
    root.appendChild(fab);
    document.body.appendChild(root);

    if (state.fabPos) {
      root.style.right = state.fabPos.right + "px";
      root.style.bottom = state.fabPos.bottom + "px";
    }

    setupDrag();
    updateMenuLabels();

    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) closeMenu();
    });
  }

  function updateMenuLabels() {
    if (!menu) return;
    for (const action of actions) {
      const el = menu.querySelector(`[data-action="${action.id}"] .we-label`);
      if (el) el.textContent = action.label();
    }
  }

  function toggleMenu() {
    const rect = root.getBoundingClientRect();
    root.classList.toggle("we-menu-down", rect.top < window.innerHeight / 2);
    root.classList.toggle("we-open");
  }

  function closeMenu() {
    root.classList.remove("we-open");
  }

  // Arrastar o botão; um clique sem movimento abre o menu
  function setupDrag() {
    let startX, startY, startRight, startBottom, moved;

    fab.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      fab.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      const rect = root.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      moved = false;
    });

    fab.addEventListener("pointermove", (e) => {
      if (startX === undefined) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      closeMenu();
      const right = clamp(startRight - dx, 0, window.innerWidth - 44);
      const bottom = clamp(startBottom - dy, 0, window.innerHeight - 44);
      root.style.right = right + "px";
      root.style.bottom = bottom + "px";
    });

    fab.addEventListener("pointerup", () => {
      if (startX === undefined) return;
      startX = undefined;
      if (moved) {
        state.fabPos = {
          right: parseInt(root.style.right, 10),
          bottom: parseInt(root.style.bottom, 10),
        };
        saveState();
      } else {
        toggleMenu();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Atalhos de teclado
  // ---------------------------------------------------------------------------
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      const action = actions.find((a) => a.key === e.code);
      if (action) {
        e.preventDefault();
        action.run();
      }
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------------------
  async function init() {
    await loadState();
    buildUI();
    setupSidebarEvents();

    // O WhatsApp recria partes da página com frequência; reaplica quando preciso
    // Elementos da própria extensão não devem disparar o observador
    const isOurs = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return !!(el && el.closest && el.closest("#we-root, #we-strip, #we-card"));
    };

    let fixTimer = null;
    const observer = new MutationObserver((records) => {
      if (!colHidden()) return;
      if (records.every((r) => isOurs(r.target))) return;

      if (!(hiddenEl && hiddenEl.isConnected)) applySidebar();
      // A divisória pode ser recriada (ex.: ao trocar de conversa)
      clearTimeout(fixTimer);
      fixTimer = setTimeout(hideDividers, 300);
      // A lista de conversas mudou (mensagem nova, ordem, foto...)
      if (isAvatars()) scheduleStrip();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    applySidebar();
    applyBlur();
  }

  init();
})();
