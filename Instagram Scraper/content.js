/**
 * Instagram Post Scraper — Content Script v2
 * Injected into instagram.com pages.
 * Handles: finding posts, navigating between them, extracting data, reporting progress.
 */

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let scraping   = false;
let paused     = false;
let shouldStop = false;
let collectedPosts = [];

// ─────────────────────────────────────────────
// Message Listener (from popup.js)
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'start':
      if (!scraping) {
        collectedPosts = [];
        scraping   = true;
        paused     = false;
        shouldStop = false;
        startScraping(message.from, message.to, message.delay);
      }
      sendResponse({ ok: true });
      break;
    case 'pause':
      paused = true;
      sendResponse({ ok: true });
      break;
    case 'resume':
      paused = false;
      sendResponse({ ok: true });
      break;
    case 'stop':
      shouldStop = true;
      scraping   = false;
      sendResponse({ ok: true });
      break;
    case 'getStatus':
      sendResponse({ scraping, paused, count: collectedPosts.length });
      break;
  }
  return true;
});

// ─────────────────────────────────────────────
// Main Scraping Function
// ─────────────────────────────────────────────
async function startScraping(from, to, delay) {
  try {
    saveState({ status: 'starting', current: 0, total: to - from + 1, posts: [], message: 'Iniciando...' });

    // 1) Open first post in grid
    const opened = openFirstPost();
    if (!opened) {
      saveState({ status: 'error', message: 'Nenhum post encontrado. Certifique-se de estar em um perfil do Instagram com posts visíveis.' });
      scraping = false;
      return;
    }

    // 2) Wait for modal to appear
    const modal = await waitFor(() => document.querySelector('div[role="dialog"]'), 12000);
    if (!modal) {
      saveState({ status: 'error', message: 'O modal do post não abriu. Tente novamente.' });
      scraping = false;
      return;
    }

    // Wait for content to fully render
    await waitFor(() => document.querySelector('div[role="dialog"] time[datetime]'), 10000);
    await sleep(1500);

    // 3) Skip posts before "from"
    if (from > 1) {
      saveState({ status: 'skipping', current: 0, total: to - from + 1, posts: [], message: `Pulando para o post ${from}...` });
      for (let skip = 1; skip < from; skip++) {
        if (shouldStop) { finalize('stopped'); return; }
        const currentDatetime = getCurrentDatetime();
        const moved = await goToNextPost();
        if (!moved) {
          saveState({ status: 'error', message: `Não foi possível pular até o post ${from}. Só existem ${skip} posts.` });
          scraping = false;
          return;
        }
        await waitForNewPost(currentDatetime, Math.max(delay, 1000));
      }
    }

    // 4) Collect posts from "from" to "to"
    for (let i = from; i <= to; i++) {
      if (shouldStop) { finalize('stopped'); return; }

      while (paused && !shouldStop) await sleep(300);
      if (shouldStop) { finalize('stopped'); return; }

      // Ensure content is loaded before extracting
      await waitFor(() => document.querySelector('div[role="dialog"] time[datetime]'), 8000);
      await sleep(600);

      const postData = extractPostData(i);
      collectedPosts.push(postData);

      saveState({
        status: 'running',
        current: i - from + 1,
        total:   to - from + 1,
        posts:   [...collectedPosts],
        message: `Coletando post ${i - from + 1} de ${to - from + 1}...`
      });

      if (i < to) {
        const currentDatetime = getCurrentDatetime();
        const moved = await goToNextPost();
        if (!moved) {
          saveState({
            status:  'completed',
            current: collectedPosts.length,
            total:   to - from + 1,
            posts:   [...collectedPosts],
            message: `Fim dos posts no post #${i}. Total coletado: ${collectedPosts.length}`
          });
          scraping = false;
          return;
        }
        // Wait for the next post's content to appear and be different
        await waitForNewPost(currentDatetime, delay);
      }
    }

    finalize('completed');

  } catch (err) {
    saveState({ status: 'error', message: `Erro inesperado: ${err.message}`, posts: [...collectedPosts] });
    scraping = false;
  }
}

// ─────────────────────────────────────────────
// Open First Post from Grid
// ─────────────────────────────────────────────
function openFirstPost() {
  const strategies = [
    () => document.querySelector('main article a[href*="/p/"]'),
    () => document.querySelector('main article a[href*="/reel/"]'),
    () => document.querySelector('main a[href*="/p/"]'),
    () => document.querySelector('main a[href*="/reel/"]'),
    () => {
      const links = [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')];
      return links.find(a =>
        !a.closest('nav') &&
        !a.href.includes('/liked_by/') &&
        !a.href.includes('/comments/')
      );
    }
  ];

  for (const fn of strategies) {
    const el = fn();
    if (el) { el.click(); return true; }
  }
  return false;
}

// ─────────────────────────────────────────────
// Navigate to Next Post — Multi-Strategy
// ─────────────────────────────────────────────
async function goToNextPost() {
  const dialog = document.querySelector('div[role="dialog"]');
  if (!dialog) return false;

  const currentUrl = window.location.href;
  const dialogRect  = dialog.getBoundingClientRect();

  // ── Strategy 1: aria-label em múltiplos idiomas ──
  // Instagram usa aria-labels diferentes dependendo do idioma do usuário
  const nextLabels = [
    'Next', 'Próximo', 'Siguiente', 'Avançar',
    'Weiter', 'Suivant', 'Далее', 'التالي',
    'next', 'NEXT', 'próximo'
  ];

  for (const label of nextLabels) {
    const btns = [...document.querySelectorAll(`button[aria-label="${label}"]`)]
      .filter(btn => !dialog.contains(btn));      // Fora do modal = navegação de post

    for (const btn of btns) {
      btn.click();
      if (await waitForUrlChange(currentUrl, 4000)) return true;
    }
  }

  // ── Strategy 2: Botão posicionado à direita do modal (fora do dialog) ──
  const rightBtns = [...document.querySelectorAll('button')]
    .filter(btn => {
      if (dialog.contains(btn)) return false;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // Deve estar na metade direita da tela E na altura do modal
      return r.left >= dialogRect.right - 80 &&
             r.top  >= dialogRect.top  - 50 &&
             r.bottom <= dialogRect.bottom + 50;
    })
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

  for (const btn of rightBtns) {
    btn.click();
    if (await waitForUrlChange(currentUrl, 3500)) return true;
  }

  // ── Strategy 3: Qualquer botão com SVG à direita do centro da tela ──
  const pageCenter = window.innerWidth / 2;
  const svgBtns = [...document.querySelectorAll('button')]
    .filter(btn => {
      if (dialog.contains(btn)) return false;
      const r = btn.getBoundingClientRect();
      return r.width > 0 && r.left > pageCenter && btn.querySelector('svg');
    })
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

  for (const btn of svgBtns) {
    btn.click();
    if (await waitForUrlChange(currentUrl, 3000)) return true;
  }

  // ── Strategy 4: Navegação por teclado (seta direita) ──
  // Tenta no elemento pai do dialog e no document
  const targets = [dialog.parentElement, dialog.parentElement?.parentElement, document.body];
  for (const target of targets) {
    if (!target) continue;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true
    }));
    if (await waitForUrlChange(currentUrl, 2500)) return true;
  }

  // ── Strategy 5: Clicar na área à direita do modal (overlay) ──
  // Alguns temas do Instagram usam a área em volta do modal como botão de navegação
  const rightX = Math.min(dialogRect.right + 50, window.innerWidth - 20);
  const centerY = (dialogRect.top + dialogRect.bottom) / 2;
  const elementAtRight = document.elementFromPoint(rightX, centerY);
  if (elementAtRight && elementAtRight !== dialog && !dialog.contains(elementAtRight)) {
    const clickableParent = elementAtRight.closest('button, a, [role="button"]') || elementAtRight;
    clickableParent.click();
    if (await waitForUrlChange(currentUrl, 2500)) return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// Wait for a new post to fully load
// (compara com o datetime do post anterior)
// ─────────────────────────────────────────────
async function waitForNewPost(previousDatetime, delay) {
  const start   = Date.now();
  const timeout = Math.max(delay + 5000, 8000);

  while (Date.now() - start < timeout) {
    const dialog  = document.querySelector('div[role="dialog"]');
    const timeEl  = dialog ? dialog.querySelector('time[datetime]') : null;
    const dt      = timeEl ? timeEl.getAttribute('datetime') : null;

    // Novo post carregado quando o datetime for diferente do anterior
    if (dt && dt !== previousDatetime) {
      await sleep(400); // pequena folga para renderizar o resto
      return;
    }
    await sleep(200);
  }

  // Timeout: continua mesmo assim (melhor tentar do que travar)
  await sleep(500);
}

// ─────────────────────────────────────────────
// Get current post's datetime (anchor for change detection)
// ─────────────────────────────────────────────
function getCurrentDatetime() {
  const timeEl = document.querySelector('div[role="dialog"] time[datetime]');
  return timeEl ? timeEl.getAttribute('datetime') : null;
}

// ─────────────────────────────────────────────
// Extract Post Data from Modal
// ─────────────────────────────────────────────
function extractPostData(index) {
  const dialog = document.querySelector('div[role="dialog"]');
  const url    = window.location.href;

  // ── Date ──
  let dateISO = '', dateFormatted = '';
  const timeEl = dialog
    ? dialog.querySelector('time[datetime]')
    : document.querySelector('time[datetime]');

  if (timeEl) {
    dateISO       = timeEl.getAttribute('datetime') || '';
    dateFormatted = timeEl.getAttribute('title') || timeEl.textContent.trim();
    if (dateISO && !dateFormatted) dateFormatted = formatDate(dateISO);
  }

  // ── Description / Caption ──
  let description = '';
  const captionSelectors = [
    'div[role="dialog"] h1',
    'div[role="dialog"] ul li:first-child div[dir="auto"]',
    'div[role="dialog"] ul li:first-child span[dir="auto"]',
    'div[role="dialog"] ul li:first-child span',
    'div[role="dialog"] span[dir="auto"]',
    'article[role="presentation"] h1',
  ];

  for (const sel of captionSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text.length > 0) {
        description = text;
        break;
      }
    }
  }

  // ── Post Type ──
  const type = detectPostType(url, dialog);

  return {
    '#': index,
    url,
    date: dateFormatted,
    dateISO,
    description,
    type,
    collectedAt: new Date().toLocaleString('pt-BR')
  };
}

// ─────────────────────────────────────────────
// Detect Post Type: Reel / Carrossel / Foto única
// ─────────────────────────────────────────────
function detectPostType(url, dialog) {
  if (url.includes('/reel/')) return 'Reel';

  if (dialog) {
    if (dialog.querySelector('video')) return 'Reel';

    // Carrossel: botão "Next" (ou equivalente) DENTRO do dialog para slides
    const innerNextBtns = dialog.querySelectorAll('button[aria-label]');
    for (const btn of innerNextBtns) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('next') || label.includes('próximo') || label.includes('seguinte')) {
        return 'Carrossel';
      }
    }

    // Pontos indicadores de slide
    const dots = dialog.querySelectorAll('div[role="listbox"] div[role="option"], span[aria-label*="slide"]');
    if (dots.length > 0) return 'Carrossel';
  }

  return 'Foto única';
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function waitFor(conditionFn, timeout = 8000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      const result = conditionFn();
      if (result)                      return resolve(result);
      if (Date.now() - start >= timeout) return resolve(null);
      setTimeout(check, 200);
    };
    check();
  });
}

function waitForUrlChange(previousUrl, timeout = 5000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (window.location.href !== previousUrl) return resolve(true);
      if (Date.now() - start >= timeout)         return resolve(false);
      setTimeout(check, 100);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return isoStr; }
}

function saveState(data) {
  chrome.storage.local.set({
    instagramScraper: { ...data, updatedAt: Date.now() }
  });
}

function finalize(status) {
  saveState({
    status,
    current: collectedPosts.length,
    total:   collectedPosts.length,
    posts:   [...collectedPosts],
    message: status === 'completed'
      ? `✅ Coleta concluída! ${collectedPosts.length} posts coletados.`
      : `⏹ Coleta interrompida. ${collectedPosts.length} posts coletados.`
  });
  scraping = false;
}
