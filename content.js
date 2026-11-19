(() => {
  "use strict";

  const state = {
    sidebarHidden: false,
    blur: false,
    fabPos: null, // { right, bottom } salvo após arrastar
  };

  // ---------------------------------------------------------------------------
  // Armazenamento
  // ---------------------------------------------------------------------------
  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["sidebarHidden", "blur", "fabPos"], (data) => {
        state.sidebarHidden = !!data.sidebarHidden;
        state.blur = !!data.blur;
        state.fabPos = data.fabPos || null;
        resolve();
      });
    });
  }

  function saveState() {
    chrome.storage.local.set({
      sidebarHidden: state.sidebarHidden,
      blur: state.blur,
      fabPos: state.fabPos,
    });
  }

  // ---------------------------------------------------------------------------
  // Ação: esconder/mostrar a lateral de conversas
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

  let hiddenEl = null;

  function applySidebar() {
    if (state.sidebarHidden) {
      // Se já está escondida e ainda no DOM, nada a fazer
      if (hiddenEl && hiddenEl.isConnected) return;

      floatOpen = false;
      const col = findSidebarColumn();
      if (!col) return;
      hiddenEl = col;
      // Só esconde a coluna: o painel da conversa já tem flex-grow
      // e ocupa o espaço livre sozinho.
      col.classList.add("we-hidden-sidebar");
    } else {
      closeFloat();
      document
        .querySelectorAll(".we-hidden-sidebar")
        .forEach((el) => el.classList.remove("we-hidden-sidebar"));
      hiddenEl = null;
    }
    updateMenuLabels();
  }

  // ---------------------------------------------------------------------------
  // Lateral flutuante: hover no botão "Conversas" da barra de ícones
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

  // Primeira cor de fundo não transparente subindo na árvore
  function findBackground(el) {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return "#fff";
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
  }

  function closeFloat() {
    clearTimeout(closeTimer);
    floatOpen = false;
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

  function setupFloat() {
    document.addEventListener("mouseover", (e) => {
      if (!state.sidebarHidden || !hiddenEl) return;
      const btn = getChatsButton(e.target);
      if (btn) return openFloat(btn);
      if (!floatOpen) return;
      if (hiddenEl.contains(e.target)) clearTimeout(closeTimer);
      else scheduleClose();
    });

    document.documentElement.addEventListener("mouseleave", () => {
      if (floatOpen) scheduleClose();
    });

    // Escolheu uma conversa -> fecha
    document.addEventListener("click", (e) => {
      if (!floatOpen || !hiddenEl) return;
      const pane = document.getElementById("pane-side");
      if (pane && pane.contains(e.target)) scheduleClose(150);
    });

    // Clique fora da lateral -> fecha
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

  function toggleSidebar() {
    state.sidebarHidden = !state.sidebarHidden;
    saveState();
    applySidebar();
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
      label: () =>
        state.sidebarHidden ? "Mostrar conversas" : "Esconder conversas",
      shortcut: "Alt+S",
      key: "KeyS",
      run: toggleSidebar,
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

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
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
    setupFloat();

    // O WhatsApp recria partes da página com frequência; reaplica quando preciso
    const observer = new MutationObserver(() => {
      if (state.sidebarHidden && !(hiddenEl && hiddenEl.isConnected)) {
        applySidebar();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    applySidebar();
    applyBlur();
  }

  init();
})();
