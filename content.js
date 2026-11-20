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
  function findBackground(el, view = window) {
    for (let e = el; e; e = e.parentElement) {
      const bg = view.getComputedStyle(e).backgroundColor;
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
  let suspendedByDrawer = false; // pausa por painel lateral (ex.: Nova conversa)
  let layoutParent = null; // container da barra de ícones + coluna + conversa
  let layoutCol = null; // coluna da esquerda

  // Painéis como "Nova conversa" abrem numa camada própria, no lugar da
  // coluna. Com a coluna escondida eles ficavam embolados com a lista
  // flutuante/faixa de fotos. Fechada, essa camada fica vazia.
  function drawerOpen() {
    if (!layoutParent || !layoutParent.isConnected) return false;
    const box = layoutParent.getBoundingClientRect();
    const main = document.getElementById("main");
    for (const layer of layoutParent.children) {
      if (layer === layoutCol || (main && layer.contains(main))) continue;
      if (getComputedStyle(layer).position !== "absolute") continue;
      if (!layer.textContent.trim()) continue;
      for (const panel of layer.children) {
        const r = panel.getBoundingClientRect();
        // Painel lateral: alto, encostado à esquerda e não ocupa a tela toda
        // (menus são pequenos; o visualizador de fotos ocupa tudo)
        if (
          r.height >= box.height * 0.8 &&
          r.width >= 200 &&
          r.width < box.width * 0.6 &&
          r.left < box.left + 200 &&
          panel.textContent.trim()
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // Camada do painel lateral que contém o elemento (ou null)
  function drawerLayerOf(el) {
    if (!layoutParent || !el) return null;
    for (const layer of layoutParent.children) {
      if (layer === layoutCol) continue;
      if (layer.contains(el) && getComputedStyle(layer).position === "absolute") {
        return layer;
      }
    }
    return null;
  }

  // Clique numa conversa dentro de um painel (ex.: Arquivadas): se a
  // conversa abrir, fecha o painel pelo "Voltar" e os modos voltam
  function onDrawerClick(e) {
    if (!suspendedByDrawer || !e.target.closest) return;
    const row = e.target.closest('[role="row"], [role="listitem"]');
    const layer = row && drawerLayerOf(row);
    if (!layer) return;
    const before = document.getElementById("main");
    const beforeTitle = before && before.querySelector("header")?.innerText;
    let tries = 0;
    const check = () => {
      const main = document.getElementById("main");
      const title = main && main.querySelector("header")?.innerText;
      const opened = main && (main !== before || title !== beforeTitle);
      if (!opened) {
        if (++tries < 10) setTimeout(check, 150); // espera até ~1,5 s
        return;
      }
      const back = layer.querySelector(
        'button[aria-label="Voltar"], button[aria-label="Back"], [data-icon="back"], [data-icon="arrow-back"]'
      );
      const btn = back && (back.closest('button, [role="button"]') || back);
      if (btn) btn.click();
    };
    setTimeout(check, 150);
  }

  function checkDrawer() {
    if (!colHidden() || panicActive) return;
    if (suspended && !suspendedByDrawer) return; // pausado por Status/Canais
    const open = drawerOpen();
    if (open && !suspended) {
      suspended = true;
      suspendedByDrawer = true;
      hideCard();
      applySidebar();
    } else if (!open && suspendedByDrawer) {
      suspended = false;
      suspendedByDrawer = false;
      applySidebar();
    }
  }

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
    suspendedByDrawer = false;
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
    resetPopups();
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
    // "Voltar" de painéis (Arquivadas, Nova conversa) também fica à esquerda
    if (drawerLayerOf(btn)) return false;
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
      suspendedByDrawer = false;
      applySidebar();
    } else if (!chats && (!suspended || suspendedByDrawer)) {
      suspended = true;
      suspendedByDrawer = false;
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

  // Painéis soltos do WhatsApp (emojis, anexos, menus) são posicionados como
  // se a lista estivesse lá e acabam por baixo da faixa de fotos / barra de
  // ícones. Empurra para a direita até o começo da conversa.
  const shiftedPopups = new Set();
  function fixPopups() {
    if (!colHidden() || suspended) return resetPopups();
    const wrapper = document.querySelector(".app-wrapper-web");
    const main = document.getElementById("main");
    if (!wrapper || !main) return;
    const minLeft = main.getBoundingClientRect().left + 8;
    // Os painéis ficam em contêineres próprios, filhos do wrapper com
    // altura 0 (ex.: #expressions-panel-container); o app em si é alto
    // Busca só nos primeiros níveis e para no primeiro elemento posicionado
    // (o painel de emojis tem centenas de itens dentro)
    const popups = [];
    const walk = (el, depth) => {
      for (const child of el.children) {
        const pos = getComputedStyle(child).position;
        if (pos === "absolute" || pos === "fixed") popups.push(child);
        else if (depth < 4) walk(child, depth + 1);
      }
    };
    for (const box of wrapper.children) {
      if (box.getBoundingClientRect().height === 0) walk(box, 1);
    }
    for (const el of popups) {
      const shift = parseFloat(el.dataset.weShift || "0");
      const r = el.getBoundingClientRect();
      // Só painéis (tooltips são estreitos; camadas de tela cheia, largas)
      if (r.width < 200 || r.width > window.innerWidth * 0.8 || r.height === 0) continue;
      const baseLeft = r.left - shift;
      const need = Math.max(0, Math.ceil(minLeft - baseLeft));
      if (need === shift) continue;
      el.style.marginLeft = need ? need + "px" : "";
      el.dataset.weShift = String(need);
      if (need) shiftedPopups.add(el);
      else shiftedPopups.delete(el);
    }
  }

  function resetPopups() {
    for (const el of shiftedPopups) {
      el.style.marginLeft = "";
      delete el.dataset.weShift;
    }
    shiftedPopups.clear();
  }

  // root: documento ou elemento onde procurar (a janela flutuante usa o dela)
  function getChatRows(root = document) {
    const pane = root.querySelector("#pane-side");
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
    // A posição pode ter sido medida durante a animação de entrada do
    // WhatsApp (tela ampliada) e ficar fora da tela; remede sempre
    positionStrip();
    const rows = getChatRows();
    const infos = rows.map(rowInfo);

    // Só redesenha se algo mudou (evita trabalho à toa)
    const key = infos.map((i) => i.name + "|" + i.img + "|" + i.unread).join("\n");
    if (key === stripKey) return;
    stripKey = key;

    const items = rows.map((row, idx) => {
      const info = infos[idx];
      const item = makeAvatarItem(document, info);
      item.addEventListener("click", () => openChat(row, info.name));
      item.addEventListener("mouseenter", () => showCard(row, item));
      item.addEventListener("mouseleave", hideCard);
      return item;
    });

    strip.replaceChildren(...items);
  }

  // Foto (ou inicial) + contador de não lidas de uma conversa
  function makeAvatarItem(doc, info) {
    const item = doc.createElement("div");
    item.className = "we-av-item";

    if (info.img) {
      const img = doc.createElement("img");
      img.src = info.img;
      img.alt = "";
      item.appendChild(img);
    } else {
      const ini = doc.createElement("div");
      ini.className = "we-av-initials";
      ini.textContent = (info.name.trim()[0] || "?").toUpperCase();
      item.appendChild(ini);
    }

    if (info.unread) {
      const badge = doc.createElement("span");
      badge.className = "we-av-badge";
      badge.textContent = info.unread;
      item.appendChild(badge);
    }
    return item;
  }

  // O WhatsApp marca a conversa aberta com aria-selected dentro da linha
  function isSelectedRow(row) {
    return (
      row.getAttribute("aria-selected") === "true" ||
      !!row.querySelector('[aria-selected="true"]')
    );
  }

  // Abre a conversa simulando um clique na linha original (escondida)
  function openChat(row, name, root = document) {
    if (!row.isConnected && name) {
      row = getChatRows(root).find((r) => rowInfo(r).name === name) || row;
    }
    const target = row.querySelector("span[title]") || row;
    // A janela certa (aba ou janela flutuante) para o evento
    const view = target.ownerDocument.defaultView || window;
    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(
        new view.MouseEvent(type, { bubbles: true, cancelable: true, view })
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
    // Fim da animação de entrada do WhatsApp: mede a faixa de novo
    let posFrame = 0;
    const positionSoon = () => {
      if (!strip || posFrame) return;
      posFrame = requestAnimationFrame(() => {
        posFrame = 0;
        positionStrip();
      });
    };
    document.addEventListener("animationend", positionSoon, true);
    document.addEventListener("transitionend", positionSoon, true);

    // Captura antes do WhatsApp redesenhar a tela
    document.addEventListener("click", onRailClick, true);
    document.addEventListener("click", onDrawerClick, true);

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
      if (pipWin) pipWin.close();
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
  // Janela flutuante (Document Picture-in-Picture, como o Meet): mostra uma
  // cópia ao vivo da conversa aberta numa janelinha sempre por cima, com um
  // campo para responder que escreve no WhatsApp e envia.
  // ---------------------------------------------------------------------------
  const PIP_ROWS = 40; // quantas mensagens recentes mostrar
  let pipWin = null;
  let pipMode = null; // "full" (WhatsApp de verdade) | "lite" (cópia)
  let pipAppRoot = null; // raiz do WhatsApp movida para a janela
  let pipPlaceholder = null; // aviso que fica na aba enquanto isso
  let pipHeadObserver = null;
  const PIP_STRIP = 56; // largura da faixa de fotos na janela
  let pipStrip = null;
  let pipStripKey = "";
  let pipObserver = null;
  let pipTimer = null;
  let pipSig = "";

  const PIP_CSS = `
    html, body { margin: 0; height: 100%; overflow: hidden; }
    #we-pip { display: flex; flex-direction: column; height: 100vh;
      font-family: Segoe UI, Helvetica, Arial, sans-serif; }
    #we-pip-head { flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: rgba(0,0,0,.3); color: #e9edef;
      font-size: 14px; font-weight: 600; }
    #we-pip-head img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
    #we-pip-head img:not([src]), #we-pip-head img[src=""] { display: none; }
    #we-pip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #we-pip-msgs { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 6px 0; }
    #we-pip-empty { color: #8696a0; text-align: center; padding: 40px 16px; font-size: 13px; }
    #we-pip-form { flex: 0 0 auto; display: flex; align-items: flex-end; gap: 8px;
      padding: 8px; background: rgba(0,0,0,.3); }
    #we-pip-input { flex: 1; resize: none; border: none; outline: none; border-radius: 8px;
      padding: 9px 12px; max-height: 110px; background: #2a3942; color: #e9edef;
      font: 14px Segoe UI, Helvetica, Arial, sans-serif; }
    #we-pip-send { flex: 0 0 38px; height: 38px; border: none; border-radius: 50%;
      background: #00a884; color: #fff; font-size: 16px; cursor: pointer; }
    #we-pip-send:disabled { opacity: .5; cursor: default; }
    #we-pip-status { min-height: 14px; padding: 0 12px 4px; font-size: 11px; color: #8696a0;
      background: rgba(0,0,0,.3); }
  `;

  async function openPipWindow(width, height) {
    if (!("documentPictureInPicture" in window)) {
      alert("Seu Chrome não suporta janela flutuante (precisa do Chrome 116 ou mais novo).");
      return null;
    }
    try {
      return await documentPictureInPicture.requestWindow({ width, height });
    } catch (err) {
      console.warn("[Whats Edit] não foi possível abrir a janela flutuante:", err);
      return null;
    }
  }

  // Copia estilos e atributos de tema do WhatsApp para a janela
  function copyStyles(doc) {
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      copyStyleNode(node, doc);
    }
    for (const attr of document.documentElement.attributes) {
      if (attr.name !== "style") doc.documentElement.setAttribute(attr.name, attr.value);
    }
    for (const attr of document.body.attributes) {
      if (attr.name !== "style") doc.body.setAttribute(attr.name, attr.value);
    }
  }

  function copyStyleNode(node, doc) {
    if (node.tagName === "LINK") {
      const copy = node.cloneNode(true);
      copy.href = node.href;
      doc.head.appendChild(copy);
      return;
    }
    // <style>: usa as regras atuais (inclui as inseridas via JavaScript)
    const copy = doc.createElement("style");
    try {
      copy.textContent = [...node.sheet.cssRules].map((r) => r.cssText).join("\n");
    } catch {
      copy.textContent = node.textContent;
    }
    doc.head.appendChild(copy);
  }

  // ---- Modo completo: move o WhatsApp de verdade para a janela ----------

  // Raiz do app do WhatsApp: o ancestral de #app que é filho direto do body
  function findAppRoot() {
    let el = document.getElementById("app");
    while (el && el.parentElement && el.parentElement !== document.body) {
      el = el.parentElement;
    }
    return el && el.parentElement === document.body ? el : null;
  }

  async function togglePip() {
    if (pipWin) {
      pipWin.close();
      return;
    }
    const appRoot = findAppRoot();
    if (!appRoot) {
      alert("Não encontrei o WhatsApp na página. Espere carregar e tente de novo.");
      return;
    }
    if (!document.getElementById("main")) {
      alert("Abra uma conversa primeiro.");
      return;
    }
    const win = await openPipWindow(420, 640);
    if (!win) return;
    pipWin = win;
    pipMode = "full";

    const doc = win.document;
    copyStyles(doc);
    doc.title = "WhatsApp";
    const base = doc.createElement("style");
    base.textContent = `
      html, body { margin: 0; height: 100%; overflow: hidden; }
      /* Só a conversa: esconde barra de ícones e lista de conversas */
      .we-pip-hide { display: none !important; }
      /* Mesmas correções da linha branca usadas na aba (content.css) */
      .we-no-border, .we-no-border > div, .we-no-border #main {
        border-left: none !important; }
      .we-divider-hidden { visibility: hidden !important; }
      .we-divider-noborder { border-left: none !important; border-right: none !important; }
      /* Lista de conversas: fora da tela, mas com tamanho real, para o
         WhatsApp continuar carregando as conversas usadas pela faixa */
      .we-pip-offscreen { position: fixed !important; left: -10000px !important;
        top: 0 !important; width: 360px !important; height: 100vh !important;
        visibility: hidden !important; pointer-events: none !important; }
      .we-pip-layout { min-width: 0 !important; width: 100% !important; }
      /* Botão "Adicionar à lista" do topo ocupa espaço demais na janela */
      #main header :has(> button[aria-label="Adicionar à lista"]),
      #main header :has(> button[aria-label="Add to list"]),
      #main header span:has(> div > button[aria-label="Adicionar à lista"]),
      #main header span:has(> div > button[aria-label="Add to list"]) { display: none !important; }
      .we-pip-main { flex: 1 1 auto !important; width: auto !important;
        max-width: none !important; min-width: 0 !important;
        margin-left: ${PIP_STRIP}px !important; border-left: none !important;
        box-sizing: border-box !important;
        padding-bottom: var(--we-bar-h, 56px) !important; }

      /* A barra de digitar original quebra aqui dentro: fica escondida e a
         nossa barra (#we-pip-bar) envia pela aba */
      .we-pip-main footer { display: none !important; }
      #we-pip-bar { position: fixed; left: ${PIP_STRIP}px; right: 0; bottom: 0;
        z-index: 2147483000; box-sizing: border-box; padding: 8px 10px;
        display: flex; align-items: flex-end; gap: 8px; background: #f0f2f5; }
      .dark #we-pip-bar { background: #202c33; }
      #we-pip-bar textarea { flex: 1; resize: none; box-sizing: border-box;
        max-height: 120px; padding: 9px 12px; border: none; border-radius: 8px;
        outline: none; background: #fff; color: #111b21;
        font: 15px Segoe UI, Helvetica, Arial, sans-serif; line-height: 20px; }
      .dark #we-pip-bar textarea { background: #2a3942; color: #e9edef; }
      #we-pip-bar textarea.we-error { box-shadow: 0 0 0 2px #e5534b; }
      #we-pip-bar button { flex: 0 0 38px; height: 38px; border: none;
        border-radius: 50%; background: #00a884; color: #fff; font-size: 16px;
        cursor: pointer; }
      #we-pip-bar button:disabled { opacity: .5; cursor: default; }

      /* Faixa de fotos para trocar de conversa */
      /* z-index alto: as camadas do WhatsApp ficavam por cima da faixa */
      #we-pip-strip { position: fixed; left: 0; top: 0; bottom: 0; z-index: 2147483000;
        width: ${PIP_STRIP}px; box-sizing: border-box; padding: 8px 0;
        overflow-y: auto; scrollbar-width: none;
        display: flex; flex-direction: column; align-items: center; gap: 8px; }
      #we-pip-strip .we-av-item { position: relative; flex: 0 0 40px;
        width: 40px; height: 40px; border-radius: 50%; cursor: pointer; }
      #we-pip-strip .we-av-item:hover,
      #we-pip-strip .we-av-item.we-current { outline: 2px solid #00a884;
        outline-offset: 2px; }
      #we-pip-strip .we-av-item img, #we-pip-strip .we-av-initials {
        display: block; width: 40px; height: 40px; border-radius: 50%;
        object-fit: cover; }
      #we-pip-strip .we-av-initials { display: flex; align-items: center;
        justify-content: center; background: #6a7175; color: #fff;
        font: 600 16px Segoe UI, Helvetica, Arial, sans-serif; }
      #we-pip-strip .we-av-badge { position: absolute; top: -3px; right: -5px;
        box-sizing: border-box; min-width: 16px; height: 16px; padding: 0 4px;
        border-radius: 8px; background: #25d366; color: #111b21;
        font: 600 10px Segoe UI, Helvetica, Arial, sans-serif;
        display: flex; align-items: center; justify-content: center; }
    `;
    doc.head.appendChild(base);

    // Estilos que o WhatsApp carregar depois (ex.: painel de emojis)
    pipHeadObserver = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.tagName === "STYLE" || (n.tagName === "LINK" && n.rel === "stylesheet")) {
            copyStyleNode(n, doc);
          }
        }
      }
    });
    pipHeadObserver.observe(document.head, { childList: true });

    // Aviso na aba enquanto o WhatsApp está na janela
    pipPlaceholder = document.createElement("div");
    pipPlaceholder.id = "we-pip-placeholder";
    pipPlaceholder.innerHTML = `
      <div>O WhatsApp está aberto na janela flutuante</div>
      <button type="button">Trazer de volta</button>`;
    pipPlaceholder
      .querySelector("button")
      .addEventListener("click", () => pipWin && pipWin.close());

    pipAppRoot = appRoot;
    document.body.insertBefore(pipPlaceholder, appRoot);
    pipBlurComposer();
    doc.body.appendChild(appRoot);
    pipOnlyChat();
    buildPipBar(doc);
    pipScrollToEnd();

    // O WhatsApp redesenha partes da tela; reaplica "só a conversa"
    pipObserver = new MutationObserver(() => {
      if (!pipWin) return;
      pipWin.clearTimeout(pipTimer);
      pipTimer = pipWin.setTimeout(pipOnlyChat, 100);
    });
    pipObserver.observe(doc.body, { childList: true, subtree: true });

    win.addEventListener("pagehide", cleanupPip);
    updateMenuLabels();
  }

  // Na janela, deixa só o painel da conversa: no container que tem a lista
  // (#side) e a conversa (#main), esconde os outros itens do layout.
  // Camadas sobrepostas (absolute/fixed) ficam, pois hospedam menus e painéis.
  function pipOnlyChat() {
    if (!pipWin || !pipAppRoot) return;
    const main = pipAppRoot.querySelector("#main");
    const side = pipAppRoot.querySelector("#side");
    if (!main || !side) return;

    // Menor ancestral comum de #main e #side
    let layout = main.parentElement;
    while (layout && !layout.contains(side)) layout = layout.parentElement;
    if (!layout) return;

    // O layout do WhatsApp tem largura mínima (~748px) e estoura a janela
    layout.classList.add("we-pip-layout");

    const view = pipWin;
    for (const child of layout.children) {
      if (child.contains(main)) {
        child.classList.add("we-pip-main");
        continue;
      }
      if (child.contains(side)) {
        child.classList.add("we-pip-offscreen");
        continue;
      }
      const pos = view.getComputedStyle(child).position;
      if (pos === "absolute" || pos === "fixed") continue;
      child.classList.add("we-pip-hide");
    }

    renderPipStrip(side);
  }

  // Faixa de fotos dentro da janela flutuante: clicar troca a conversa
  function renderPipStrip(side) {
    const d = pipWin.document;
    if (!pipStrip || !pipStrip.isConnected) {
      pipStrip = d.createElement("div");
      pipStrip.id = "we-pip-strip";
      d.body.appendChild(pipStrip);
      pipStripKey = "";
    }
    pipStrip.style.background = findBackground(side, pipWin);

    const rows = getChatRows(pipAppRoot);
    const infos = rows.map(rowInfo);
    // Conversa aberta = linha marcada como selecionada pelo WhatsApp
    const currentRow = rows.find(isSelectedRow);
    const current = currentRow ? rowInfo(currentRow).name : "";

    // Só redesenha se algo mudou
    const key =
      current + "\n" + infos.map((i) => i.name + "|" + i.img + "|" + i.unread).join("\n");
    if (key === pipStripKey) return;
    pipStripKey = key;

    const items = rows.map((row, idx) => {
      const info = infos[idx];
      const item = makeAvatarItem(d, info);
      item.title = info.name;
      if (info.name && info.name === current) item.classList.add("we-current");
      item.addEventListener("click", () => pipSwitchChat(row, info.name));
      return item;
    });
    pipStrip.replaceChildren(...items);
  }

  // O campo de digitar do WhatsApp quebra se for criado dentro da janela
  // flutuante. Então a troca de conversa acontece na aba: o WhatsApp volta
  // para lá por um instante, abre a conversa e é levado de novo para a janela.
  // Leva o WhatsApp de volta para a aba, roda fn() lá e traz para a janela.
  // O aviso "Trazer de volta" continua por cima da aba durante isso.
  let pipBusy = false;
  async function pipInTab(fn) {
    if (!pipWin || !pipAppRoot || !pipPlaceholder || pipBusy) return undefined;
    pipBusy = true;
    try {
      document.body.insertBefore(pipAppRoot, pipPlaceholder);
      return await fn();
    } finally {
      if (pipWin && pipAppRoot) {
        const body = pipWin.document.body;
        body.insertBefore(pipAppRoot, body.firstChild);
        pipOnlyChat();
        pipScrollToEnd();
      }
      pipBusy = false;
    }
  }

  async function pipSwitchChat(row, name) {
    const before = pipAppRoot && pipAppRoot.querySelector("#main");
    await pipInTab(async () => {
      openChat(row, name, pipAppRoot);
      // Espera a conversa nova abrir com o campo de digitar (até 3 s)
      for (let i = 0; i < 30; i++) {
        await pipSleep(100);
        const main = pipAppRoot.querySelector("#main");
        const box = main && main.querySelector('footer [contenteditable="true"]');
        if (box && main !== before) break;
        if (box && isSelectedRow(row) && rowInfo(row).name === name) break;
      }
      // O WhatsApp põe o cursor na barra logo depois de abrir a conversa;
      // se isso acontecer já dentro da janela, o editor quebra. Espera
      // assentar e tira o foco antes de levar de volta.
      await pipSleep(400);
      pipBlurComposer();
    });
  }

  // Mover a conversa de janela zera a rolagem (ela voltava para o começo).
  // Rola até a última mensagem, repetindo enquanto o WhatsApp termina de
  // desenhar e carregar as mensagens.
  function pipScrollToEnd() {
    if (pipWin && pipAppRoot) scrollChatToEnd(pipWin, pipAppRoot);
  }

  // Na janela recém-aberta os estilos ainda estão carregando e a área de
  // mensagens não rola; tenta de novo até conseguir (máx. 4 s) e, depois
  // de conseguir, repete mais um pouco para as mensagens que chegam por último.
  function scrollChatToEnd(view, root) {
    const scrollOnce = () => {
      const main = root.querySelector("#main");
      if (!main || !main.isConnected) return false;
      let done = false;
      for (const el of main.querySelectorAll("div")) {
        if (el.scrollHeight <= el.clientHeight + 5) continue;
        const oy = view.getComputedStyle(el).overflowY;
        if (oy !== "auto" && oy !== "scroll") continue;
        el.scrollTop = el.scrollHeight;
        if (el.scrollTop > 0) done = true;
      }
      return done;
    };
    let tries = 0;
    let extra = 0;
    const tick = () => {
      if (view.closed) return;
      if (scrollOnce()) extra++;
      if (extra >= 3 || ++tries > 25) return;
      view.setTimeout(tick, 150);
    };
    tick();
  }

  function pipBlurComposer() {
    const active = document.activeElement;
    if (active && pipAppRoot && pipAppRoot.contains(active)) active.blur();
    const sel = window.getSelection();
    if (sel && pipAppRoot && sel.anchorNode && pipAppRoot.contains(sel.anchorNode)) {
      sel.removeAllRanges();
    }
  }

  // Barra de digitar da janela flutuante: envia pela barra original, na aba
  function buildPipBar(doc) {
    const bar = doc.createElement("form");
    bar.id = "we-pip-bar";
    bar.innerHTML = `
      <textarea rows="1" placeholder="Digite uma mensagem"></textarea>
      <button type="submit" title="Enviar">➤</button>`;
    const input = bar.querySelector("textarea");
    const btn = bar.querySelector("button");

    // Altura da barra acompanha o texto; a conversa sobe junto
    const autosize = () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
      doc.documentElement.style.setProperty("--we-bar-h", bar.offsetHeight + "px");
    };
    input.addEventListener("input", () => {
      input.classList.remove("we-error");
      autosize();
    });

    // Enter envia; Shift+Enter quebra a linha
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        bar.requestSubmit();
      }
    });

    bar.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || btn.disabled) return;
      btn.disabled = true;
      const ok = await pipInTab(async () => {
        const sent = await sendViaWhatsApp(text);
        pipBlurComposer();
        return sent;
      });
      btn.disabled = false;
      if (ok) {
        input.value = "";
      } else {
        input.classList.add("we-error");
        input.title = "Não consegui enviar. O texto ficou no campo.";
      }
      autosize();
      input.focus();
    });

    doc.body.appendChild(bar);
    autosize();
    input.focus();
  }

  // ---- Modo leve: cópia ao vivo da conversa + campo de resposta ---------

  async function toggleLitePip() {
    if (pipWin) {
      pipWin.close();
      return;
    }
    if (!document.getElementById("main")) {
      alert("Abra uma conversa primeiro.");
      return;
    }
    const win = await openPipWindow(400, 560);
    if (!win) return;
    pipWin = win;
    pipMode = "lite";

    setupPipDocument(pipWin.document);
    pipWin.addEventListener("pagehide", cleanupPip);

    // Qualquer mudança na página pode ser mensagem nova ou troca de conversa
    pipObserver = new MutationObserver(schedulePipRender);
    pipObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    renderPip(true);
    updateMenuLabels();
  }

  function cleanupPip() {
    // Modo completo: devolve o WhatsApp para a aba
    if (pipObserver) pipObserver.disconnect();
    if (pipAppRoot) {
      pipAppRoot
        .querySelectorAll(".we-pip-hide, .we-pip-main, .we-pip-offscreen, .we-pip-layout")
        .forEach((el) =>
          el.classList.remove("we-pip-hide", "we-pip-main", "we-pip-offscreen", "we-pip-layout")
        );
    }
    if (pipAppRoot && pipPlaceholder) {
      pipPlaceholder.replaceWith(pipAppRoot);
      scrollChatToEnd(window, pipAppRoot);
    }
    if (pipPlaceholder) pipPlaceholder.remove();
    pipAppRoot = null;
    pipPlaceholder = null;
    pipStrip = null;
    pipStripKey = "";
    if (pipHeadObserver) pipHeadObserver.disconnect();
    pipHeadObserver = null;

    if (pipObserver) pipObserver.disconnect();
    pipObserver = null;
    pipWin = null;
    pipMode = null;
    pipSig = "";
    updateMenuLabels();
  }

  // Timers da página ficam lentos com a aba em segundo plano; os da janela
  // flutuante (que está visível) não, então usamos os dela.
  let pipLastRender = 0;
  function schedulePipRender() {
    if (!pipWin) return;
    pipWin.clearTimeout(pipTimer);
    // Se a página não para de mudar, atualiza pelo menos 1x por segundo
    const wait = Date.now() - pipLastRender > 1000 ? 0 : 200;
    pipTimer = pipWin.setTimeout(() => {
      pipLastRender = Date.now();
      renderPip(false);
    }, wait);
  }

  function pipSleep(ms) {
    return new Promise((r) => (pipWin || window).setTimeout(r, ms));
  }

  function setupPipDocument(doc) {
    // Mesmos estilos e tema do WhatsApp, para as mensagens copiadas
    copyStyles(doc);
    const style = doc.createElement("style");
    style.textContent = PIP_CSS;
    doc.head.appendChild(style);
    doc.title = "WhatsApp";

    doc.body.innerHTML = `
      <div id="we-pip">
        <div id="we-pip-head"><img id="we-pip-avatar" alt=""><span id="we-pip-name"></span></div>
        <div id="we-pip-msgs"></div>
        <form id="we-pip-form">
          <textarea id="we-pip-input" rows="1" placeholder="Digite uma mensagem"></textarea>
          <button id="we-pip-send" type="submit" title="Enviar">➤</button>
        </form>
        <div id="we-pip-status"></div>
      </div>`;

    const form = doc.getElementById("we-pip-form");
    const input = doc.getElementById("we-pip-input");
    const send = doc.getElementById("we-pip-send");
    const status = doc.getElementById("we-pip-status");

    const autosize = () => {
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
    };
    input.addEventListener("input", autosize);

    // Enter envia; Shift+Enter quebra a linha
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      status.textContent = "Enviando...";
      const ok = await sendViaWhatsApp(text);
      send.disabled = false;
      if (ok) {
        input.value = "";
        autosize();
        status.textContent = "";
      } else {
        status.textContent = "Não consegui enviar. O texto ficou no campo.";
      }
      input.focus();
    });
  }

  function renderPip(force) {
    if (!pipWin) return;
    const d = pipWin.document;
    const msgs = d.getElementById("we-pip-msgs");
    const nameEl = d.getElementById("we-pip-name");
    const avatar = d.getElementById("we-pip-avatar");
    if (!msgs) return;

    const main = document.getElementById("main");
    if (!main) {
      if (pipSig !== "none") {
        pipSig = "none";
        nameEl.textContent = "";
        avatar.removeAttribute("src");
        msgs.innerHTML = '<div id="we-pip-empty">Nenhuma conversa aberta no WhatsApp</div>';
      }
      return;
    }

    const header = main.querySelector("header");
    const titleEl = header && header.querySelector("span[title]");
    const name = titleEl
      ? titleEl.title
      : header
      ? header.innerText.split("\n")[0]
      : "";
    const rows = [...main.querySelectorAll('[role="row"]')];
    const last = rows.slice(-PIP_ROWS);
    const tail = last.length ? last[last.length - 1].textContent : "";
    const sig = `${name}|${rows.length}|${tail.length}|${tail.slice(-60)}`;
    if (!force && sig === pipSig) return;
    const chatChanged = !pipSig.startsWith(name + "|");
    pipSig = sig;

    nameEl.textContent = name;
    const headImg = header && header.querySelector("img");
    if (headImg && headImg.src) avatar.src = headImg.src;
    else avatar.removeAttribute("src");

    const atBottom =
      msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;

    if (!last.length) {
      msgs.innerHTML = '<div id="we-pip-empty">Sem mensagens carregadas</div>';
      return;
    }

    // Copia o contêiner das mensagens (sem filhos) e as últimas mensagens
    const wrap = last[0].parentElement.cloneNode(false);
    wrap.removeAttribute("id");
    for (const row of last) {
      const copy = row.cloneNode(true);
      copy.removeAttribute("id");
      copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      copy.querySelectorAll("a[href]").forEach((a) => (a.target = "_blank"));
      wrap.appendChild(copy);
    }
    msgs.replaceChildren(wrap);
    d.body.style.background = findBackground(last[0]);

    if (force || chatChanged || atBottom) msgs.scrollTop = msgs.scrollHeight;
  }

  // Escreve no campo de mensagem do WhatsApp e envia
  async function sendViaWhatsApp(text) {
    const main = document.getElementById("main");
    const box =
      main &&
      (main.querySelector('footer [contenteditable="true"]') ||
        main.querySelector('[contenteditable="true"][role="textbox"]'));
    if (!box) return false;

    // Seleciona tudo: o texto novo substitui algum rascunho que esteja lá
    box.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);

    const probe = text.slice(0, 20);
    document.execCommand("insertText", false, text);
    // O editor do WhatsApp atualiza o campo um instante depois; conferir
    // na hora dava falso negativo e o plano B colava o texto de novo
    for (let i = 0; i < 5 && !box.textContent.includes(probe); i++) {
      await pipSleep(60);
    }
    if (!box.textContent.includes(probe)) {
      // Plano B: simula colar o texto
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      box.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
    }
    await pipSleep(150);
    if (!box.textContent.includes(probe)) return false;

    const icon = main.querySelector(
      'button[aria-label="Enviar"], button[aria-label="Send"], ' +
        '[data-icon="send"], [data-icon="wds-ic-send-filled"]'
    );
    const sendBtn = icon && (icon.closest('button, [role="button"]') || icon);
    if (sendBtn) {
      sendBtn.click();
    } else {
      box.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        })
      );
    }

    // Enviou se o campo do WhatsApp esvaziou
    for (let i = 0; i < 10; i++) {
      await pipSleep(100);
      if (!box.isConnected || !box.textContent.trim()) return true;
    }
    return false;
  }

  // Tentativa de abrir sozinha ao trocar de aba (o Chrome só permite isso
  // em alguns sites; se não permitir, nada acontece)
  function setupAutoPip() {
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", () => {
        if (!pipWin && !panicActive && document.getElementById("main")) togglePip();
      });
    } catch (err) {
      console.debug("[Whats Edit] abertura automática indisponível:", err);
    }
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
    {
      id: "pip",
      label: () => (pipWin ? "Fechar janela flutuante" : "Janela flutuante"),
      shortcut: "Alt+J",
      key: "KeyJ",
      run: togglePip,
    },
    {
      id: "pip-lite",
      label: () => "Janela flutuante leve (cópia)",
      menu: () => !pipWin, // some enquanto alguma janela está aberta
      run: toggleLitePip,
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
        .filter((a) => (typeof a.menu === "function" ? a.menu() : a.menu !== false))
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
    setupAutoPip();

    // O WhatsApp recria partes da página com frequência; reaplica quando preciso
    // Elementos da própria extensão não devem disparar o observador
    const isOurs = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return !!(
        el &&
        el.closest &&
        el.closest("#we-root, #we-strip, #we-card, #we-cover, #we-pip-placeholder")
      );
    };

    let fixTimer = null;
    let drawerTimer = null;
    const observer = new MutationObserver((records) => {
      if (!colHidden()) return;
      if (records.every((r) => isOurs(r.target))) return;

      // Painel lateral abrindo/fechando (ex.: Nova conversa)
      if (!suspended || suspendedByDrawer) {
        clearTimeout(drawerTimer);
        drawerTimer = setTimeout(checkDrawer, 80);
      }
      if (suspended) return;

      // Painel de emojis/anexos recém-aberto: corrige antes de aparecer
      requestAnimationFrame(fixPopups);

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
