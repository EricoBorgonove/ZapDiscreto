(() => {
  "use strict";

  const state = {
    sidebarMode: "visible", // "visible" | "hidden" | "avatars"
    blur: false,
    fabPos: null, // { right, bottom } salvo após arrastar
    btnSize: 44, // diâmetro do botão verde em px (o amarelo acompanha)
    // Botão de pânico: se aparece e o que ele faz
    panic: { enabled: true, blur: true, hide: true, cover: false },
  };

  // Pânico ativo não é salvo: guarda o estado anterior para restaurar
  let panicActive = false;
  let panicPrev = null;

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
        ["sidebarMode", "sidebarHidden", "blur", "fabPos", "panic", "btnSize"],
        (data) => {
          if (data.btnSize) state.btnSize = data.btnSize;
          state.panic = { ...state.panic, ...(data.panic || {}) };
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
    // Durante o pânico, salva o estado de antes (o pânico é temporário)
    const saved = panicActive ? panicPrev : state;
    chrome.storage.local.set({
      sidebarMode: saved.sidebarMode,
      blur: saved.blur,
      fabPos: state.fabPos,
      btnSize: state.btnSize,
      panic: state.panic,
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
  // Pausa: o usuário abriu outra seção da barra de ícones (Status, Canais,
  // Comunidades, Configurações...). O WhatsApp funciona normalmente até
  // ele voltar para Conversas; o modo salvo não muda.
  let suspended = false;
  let layoutParent = null; // container da barra de ícones + coluna + conversa
  let layoutCol = null; // coluna da esquerda

  function applySidebar() {
    if (suspended) {
      clearAvatars();
      clearHidden();
      updateMenuLabels();
      return;
    }
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
    if (panicActive) setPanic(false);
    suspended = false;
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
    layoutCol = col;
    layoutParent = col.parentElement;
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
    return isChatsLabel(btn) ? btn : null;
  }

  function isChatsLabel(btn) {
    const label = btn.getAttribute("aria-label") || btn.title || "";
    if (/conversas|chats/i.test(label)) return true;
    const icon = btn.querySelector("[data-icon]");
    return !!(icon && /^chats?(-|$)/i.test(icon.dataset.icon));
  }

  // Botão da barra de ícones da esquerda (fora da coluna e da conversa)
  function isRailButton(btn) {
    if (!layoutParent || !layoutParent.contains(btn)) return false;
    if (layoutCol && layoutCol.contains(btn)) return false;
    const main = document.getElementById("main");
    if (main && main.contains(btn)) return false;
    const r = btn.getBoundingClientRect();
    const p = layoutParent.getBoundingClientRect();
    return r.width > 0 && r.right <= p.left + 120;
  }

  // Clique em Status/Canais/etc. pausa; clique em Conversas retoma
  function onRailClick(e) {
    if (!colHidden() || !e.target.closest) return;
    if (!layoutParent || !layoutParent.isConnected) {
      const col = findSidebarColumn();
      if (!col) return;
      layoutCol = col;
      layoutParent = col.parentElement;
    }
    const btn = e.target.closest('button, [role="button"], a');
    if (!btn || !isRailButton(btn)) return;

    const chats = isChatsLabel(btn);
    if (chats && suspended) {
      suspended = false;
      applySidebar();
    } else if (!chats && !suspended) {
      suspended = true;
      applySidebar();
    }
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
      if (panicActive || !colHidden() || !hiddenEl) return;
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

    // Captura antes do WhatsApp redesenhar a tela
    document.addEventListener("click", onRailClick, true);

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
    if (panicActive) setPanic(false);
    state.blur = !state.blur;
    saveState();
    applyBlur();
  }

  // ---------------------------------------------------------------------------
  // Botão de pânico: aplica na hora o que estiver configurado
  // (desfocar, esconder conversas, cobrir a tela) e restaura ao desligar
  // ---------------------------------------------------------------------------
  let cover = null;

  function setPanic(on) {
    if (on === panicActive) return;
    if (on) {
      panicPrev = { blur: state.blur, sidebarMode: state.sidebarMode };
      panicActive = true;
      closeFloat();
      hideCard();
      if (state.panic.blur) state.blur = true;
      if (state.panic.hide) {
        state.sidebarMode = "hidden";
        suspended = false;
      }
      if (state.panic.cover) showCover();
    } else {
      panicActive = false;
      state.blur = panicPrev.blur;
      state.sidebarMode = panicPrev.sidebarMode;
      panicPrev = null;
      hideCover();
    }
    applyBlur();
    applySidebar();
    updatePanicButton();
  }

  function togglePanic() {
    if (!state.panic.enabled && !panicActive) return;
    setPanic(!panicActive);
  }

  function showCover() {
    if (!cover) {
      cover = document.createElement("div");
      cover.id = "we-cover";
      cover.textContent = "Clique no botão amarelo ou aperte Alt+P para voltar";
    }
    document.body.appendChild(cover);
  }

  function hideCover() {
    if (cover) cover.remove();
  }

  function updatePanicButton() {
    if (!panicBtn) return;
    panicBtn.hidden = !state.panic.enabled && !panicActive;
    panicBtn.classList.toggle("we-active", panicActive);
    panicBtn.title = panicActive
      ? "Sair do modo pânico (Alt+P)"
      : "Modo pânico (Alt+P)";
  }

  // Liga/desliga uma opção do pânico e reaplica se ele estiver ativo
  function togglePanicOption(key) {
    state.panic[key] = !state.panic[key];
    saveState();
    if (panicActive) {
      setPanic(false);
      setPanic(true);
    }
    updatePanicButton();
  }

  // ---------------------------------------------------------------------------
  // Lista de ações do menu (adicione novas aqui)
  // ---------------------------------------------------------------------------
  const actions = [
    {
      id: "panic",
      label: () => "Pânico",
      shortcut: "Alt+P",
      key: "KeyP",
      menu: false, // só atalho; no menu fica o submenu de configuração
      run: togglePanic,
    },
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
  let root, fab, menu, panicBtn;
  let menuView = "main"; // "main" | "panic"

  const PANIC_ICON = `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 3.5 21.5 20h-19z" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M12 10v4.2" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round"/>
      <circle cx="12" cy="17" r="1.3" fill="currentColor"/>
    </svg>`;

  // Itens de cada tela do menu
  function menuItems() {
    if (menuView === "panic") {
      const check = (key, label) => ({
        label,
        checked: state.panic[key],
        keepOpen: true,
        run: () => togglePanicOption(key),
      });
      return [
        { label: "‹ Botão de pânico", back: true, keepOpen: true,
          run: () => (menuView = "main") },
        check("enabled", "Mostrar botão de pânico"),
        { separator: "Ao ativar o pânico" },
        check("blur", "Desfocar textos"),
        check("hide", "Esconder conversas"),
        check("cover", "Cobrir a tela inteira"),
      ];
    }
    return [
      ...actions
        .filter((a) => a.menu !== false)
        .map((a) => ({ label: a.label(), shortcut: a.shortcut, run: a.run })),
      { separator: "" },
      { label: "Botão de pânico", submenu: true, keepOpen: true,
        run: () => (menuView = "panic") },
      { slider: true },
    ];
  }

  // ---------------------------------------------------------------------------
  // Tamanho dos botões (controle deslizante no menu)
  // ---------------------------------------------------------------------------
  const BTN_MIN = 28;
  const BTN_MAX = 72;
  let sizeSaveTimer = null;

  function applyBtnSize() {
    if (root) root.style.setProperty("--we-size", state.btnSize + "px");
  }

  function setBtnSize(px) {
    state.btnSize = clamp(Math.round(px), BTN_MIN, BTN_MAX);
    applyBtnSize();
    keepRootOnScreen();
    // Salva só quando parar de arrastar
    clearTimeout(sizeSaveTimer);
    sizeSaveTimer = setTimeout(saveState, 300);
  }

  // Botões maiores não podem sair da tela
  function keepRootOnScreen() {
    const r = root.getBoundingClientRect();
    if (r.left < 0) {
      root.style.right = window.innerWidth - root.offsetWidth + "px";
    }
    if (r.top < 0) {
      root.style.bottom = window.innerHeight - root.offsetHeight + "px";
    }
  }

  function buildSizeSlider() {
    const row = document.createElement("div");
    row.className = "we-slider-row";

    const label = document.createElement("div");
    label.className = "we-slider-label";
    const name = document.createElement("span");
    name.textContent = "Tamanho dos botões";
    const value = document.createElement("span");
    value.className = "we-kbd";
    value.textContent = state.btnSize + "px";
    label.append(name, value);

    const input = document.createElement("input");
    input.type = "range";
    input.min = BTN_MIN;
    input.max = BTN_MAX;
    input.step = 1;
    input.value = state.btnSize;
    input.addEventListener("input", () => {
      setBtnSize(Number(input.value));
      value.textContent = state.btnSize + "px";
    });

    // Interagir com o controle não fecha nem redesenha o menu
    for (const ev of ["click", "pointerdown", "mousedown"]) {
      row.addEventListener(ev, (e) => e.stopPropagation());
    }

    row.append(label, input);
    return row;
  }

  function renderMenu() {
    if (!menu) return;
    const els = menuItems().map((item) => {
      if (item.slider) return buildSizeSlider();
      if ("separator" in item) {
        const sep = document.createElement("div");
        sep.className = "we-sep";
        sep.textContent = item.separator;
        return sep;
      }
      const btn = document.createElement("button");
      btn.className = "we-item" + (item.back ? " we-back" : "");

      const label = document.createElement("span");
      label.className = "we-label";
      if ("checked" in item) {
        const box = document.createElement("span");
        box.className = "we-check" + (item.checked ? " we-on" : "");
        box.textContent = item.checked ? "✓" : "";
        label.appendChild(box);
      }
      label.appendChild(document.createTextNode(item.label));
      btn.appendChild(label);

      const right = document.createElement("span");
      right.className = "we-kbd";
      right.textContent = item.submenu ? "›" : item.shortcut || "";
      btn.appendChild(right);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        item.run();
        if (item.keepOpen) renderMenu();
        else closeMenu();
      });
      return btn;
    });
    menu.replaceChildren(...els);
  }

  function buildUI() {
    root = document.createElement("div");
    root.id = "we-root";

    menu = document.createElement("div");
    menu.id = "we-menu";

    panicBtn = document.createElement("button");
    panicBtn.id = "we-panic";
    panicBtn.innerHTML = PANIC_ICON;
    panicBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanic();
    });

    fab = document.createElement("button");
    fab.id = "we-fab";
    fab.title = "Whats Edit";
    fab.textContent = "⚙";

    root.appendChild(menu);
    root.appendChild(panicBtn);
    root.appendChild(fab);
    document.body.appendChild(root);
    applyBtnSize();
    updatePanicButton();

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
    renderMenu();
  }

  function toggleMenu() {
    const rect = root.getBoundingClientRect();
    root.classList.toggle("we-menu-down", rect.top < window.innerHeight / 2);
    menuView = "main";
    renderMenu();
    root.classList.toggle("we-open");
  }

  function closeMenu() {
    root.classList.remove("we-open");
    menuView = "main";
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
      const right = clamp(startRight - dx, 0, window.innerWidth - root.offsetWidth);
      const bottom = clamp(startBottom - dy, 0, window.innerHeight - root.offsetHeight);
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
      return !!(
        el && el.closest && el.closest("#we-root, #we-strip, #we-card, #we-cover")
      );
    };

    let fixTimer = null;
    const observer = new MutationObserver((records) => {
      if (!colHidden() || suspended) return;
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
