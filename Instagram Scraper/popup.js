/**
 * Instagram Post Scraper — Popup Logic
 * Handles: UI state, communication with content.js, exports (CSV, JSON, XLSX)
 */

// ─────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const statusDot     = $('statusDot');
const statusText    = $('statusText');
const configSection = $('configSection');
const progressSect  = $('progressSection');
const resultsSect   = $('resultsSection');

const fromPost    = $('fromPost');
const toPost      = $('toPost');
const delaySlider = $('delaySlider');
const delayValue  = $('delayValue');

const startBtn    = $('startBtn');
const pauseBtn    = $('pauseBtn');
const stopBtn     = $('stopBtn');
const newScrapeBtn = $('newScrapeBtn');

const progressLabel = $('progressLabel');
const progressPct   = $('progressPct');
const progressFill  = $('progressFill');
const numCollected  = $('numCollected');
const numRemaining  = $('numRemaining');

const resultsCount  = $('resultsCount');
const messagePill   = $('messagePill');
const postsList     = $('postsList');

const copyBtn = $('copyBtn');
const csvBtn  = $('csvBtn');
const jsonBtn = $('jsonBtn');
const xlsxBtn = $('xlsxBtn');

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let isPaused = false;
let latestPosts = [];
let pollInterval = null;

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restore any in-progress state from storage
  chrome.storage.local.get('instagramScraper', ({ instagramScraper }) => {
    if (instagramScraper) {
      handleStorageUpdate(instagramScraper);
    }
  });

  // Slider live update
  delaySlider.addEventListener('input', () => {
    delayValue.textContent = `${delaySlider.value} ms`;
  });

  // Validate: "from" must be ≤ "to"
  fromPost.addEventListener('change', () => {
    if (parseInt(fromPost.value) > parseInt(toPost.value)) {
      toPost.value = fromPost.value;
    }
  });

  toPost.addEventListener('change', () => {
    if (parseInt(toPost.value) < parseInt(fromPost.value)) {
      fromPost.value = toPost.value;
    }
  });

  // Buttons
  startBtn.addEventListener('click', handleStart);
  pauseBtn.addEventListener('click', handlePause);
  stopBtn.addEventListener('click', handleStop);
  newScrapeBtn.addEventListener('click', handleNewScrape);

  // Exports
  copyBtn.addEventListener('click', handleCopy);
  csvBtn.addEventListener('click', handleExportCSV);
  jsonBtn.addEventListener('click', handleExportJSON);
  xlsxBtn.addEventListener('click', handleExportXLSX);
});

// ─────────────────────────────────────────────
// Start Scraping
// ─────────────────────────────────────────────
async function handleStart() {
  const from = parseInt(fromPost.value) || 1;
  const to   = parseInt(toPost.value)   || 10;
  const delay = parseInt(delaySlider.value) || 1500;

  if (from > to) {
    setStatus('error', 'O post inicial não pode ser maior que o final.');
    return;
  }

  // Clear old storage state
  await chrome.storage.local.remove('instagramScraper');
  latestPosts = [];
  isPaused = false;

  // Show progress UI
  show(progressSect);
  hide(configSection);
  hide(resultsSect);
  setStatus('running', 'Iniciando coleta...');
  updateProgress(0, to - from + 1);

  // Send message to content script
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    setStatus('error', 'Nenhuma aba ativa encontrada.');
    return;
  }

  const tab = tabs[0];
  if (!tab.url || !tab.url.includes('instagram.com')) {
    setStatus('error', 'Abra um perfil do Instagram primeiro.');
    show(configSection);
    hide(progressSect);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'start',
      from,
      to,
      delay
    });
  } catch (err) {
    setStatus('error', 'Erro ao conectar com a página. Tente recarregar o Instagram.');
    show(configSection);
    hide(progressSect);
    return;
  }

  // Start polling storage for updates
  startPolling();
}

// ─────────────────────────────────────────────
// Pause / Resume
// ─────────────────────────────────────────────
async function handlePause() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;

  isPaused = !isPaused;

  await chrome.tabs.sendMessage(tabs[0].id, {
    action: isPaused ? 'pause' : 'resume'
  }).catch(() => {});

  if (isPaused) {
    pauseBtn.classList.add('active');
    pauseBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      Continuar`;
    setStatus('paused', 'Coleta pausada.');
  } else {
    pauseBtn.classList.remove('active');
    pauseBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      Pausar`;
    setStatus('running', 'Coleta retomada...');
  }
}

// ─────────────────────────────────────────────
// Stop
// ─────────────────────────────────────────────
async function handleStop() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length) {
    await chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' }).catch(() => {});
  }
  stopPolling();
  if (latestPosts.length > 0) {
    showResults(latestPosts, 'stopped');
  } else {
    handleNewScrape();
  }
}

// ─────────────────────────────────────────────
// New Scrape (reset UI)
// ─────────────────────────────────────────────
function handleNewScrape() {
  stopPolling();
  latestPosts = [];
  isPaused = false;
  chrome.storage.local.remove('instagramScraper');
  hide(progressSect);
  hide(resultsSect);
  show(configSection);
  setStatus('idle', 'Pronto para nova coleta.');

  // Reset pause button
  pauseBtn.classList.remove('active');
  pauseBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
    Pausar`;
}

// ─────────────────────────────────────────────
// Storage Polling
// ─────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollInterval = setInterval(() => {
    chrome.storage.local.get('instagramScraper', ({ instagramScraper }) => {
      if (instagramScraper) handleStorageUpdate(instagramScraper);
    });
  }, 600);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function handleStorageUpdate(state) {
  if (!state) return;

  const { status, current, total, posts, message } = state;

  if (posts && posts.length) latestPosts = posts;

  switch (status) {
    case 'starting':
    case 'skipping':
      setStatus('running', message || 'Preparando...');
      updateProgress(current || 0, total || 1);
      break;

    case 'running':
      setStatus('running', message || `Coletando post ${current} de ${total}...`);
      updateProgress(current, total);
      break;

    case 'completed':
      stopPolling();
      showResults(latestPosts, 'completed', message);
      break;

    case 'stopped':
      stopPolling();
      showResults(latestPosts, 'stopped', message);
      break;

    case 'error':
      stopPolling();
      setStatus('error', message || 'Ocorreu um erro.');
      show(configSection);
      hide(progressSect);
      showMessagePill(message, 'error');
      break;
  }
}

// ─────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setStatus(type, text) {
  statusDot.className = `status-dot ${type}`;
  statusText.textContent = text;
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressPct.textContent = `${pct}%`;
  progressLabel.textContent = `Coletando ${current} de ${total}`;
  numCollected.textContent = current;
  numRemaining.textContent = Math.max(0, total - current);
}

function showResults(posts, status, message) {
  hide(progressSect);
  hide(configSection);
  show(resultsSect);

  resultsCount.textContent = posts.length;

  const isSuccess = status === 'completed';
  setStatus(isSuccess ? 'done' : 'paused',
    isSuccess ? `Concluído! ${posts.length} posts coletados.` : `Interrompido. ${posts.length} posts coletados.`);

  if (message) showMessagePill(message, isSuccess ? 'success' : '');

  renderPostCards(posts);
}

function showMessagePill(msg, type) {
  messagePill.textContent = msg;
  messagePill.className = `message-pill visible${type ? ' ' + type : ''}`;
}

// ─────────────────────────────────────────────
// Render Post Cards
// ─────────────────────────────────────────────
function renderPostCards(posts) {
  postsList.innerHTML = '';
  posts.forEach((post, idx) => {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.dataset.idx = idx;

    const typeKey = (post.type || 'Foto única').toLowerCase().replace(' ', '-');
    const badgeClass = typeKey.includes('reel') ? 'badge-reel'
                     : typeKey.includes('carro') ? 'badge-carrossel'
                     : 'badge-foto';

    const shortDesc = (post.description || '').substring(0, 60);
    const hasDesc = shortDesc.length > 0;

    card.innerHTML = `
      <div class="post-card-header">
        <div class="post-card-left">
          <span class="post-index">#${post['#']}</span>
          <span class="post-type-badge ${badgeClass}">${post.type || 'Foto única'}</span>
          <span class="post-date">${post.date || '—'}</span>
        </div>
        <span class="expand-icon">▼</span>
      </div>
      <div class="post-card-body">
        <div class="post-field">
          <span class="post-field-label">Link</span>
          <span class="post-field-value">
            <a href="${escapeHtml(post.url)}" target="_blank" rel="noopener">${shortenUrl(post.url)}</a>
          </span>
        </div>
        ${post.date ? `
        <div class="post-field">
          <span class="post-field-label">Data de publicação</span>
          <span class="post-field-value">${post.date}</span>
        </div>` : ''}
        ${hasDesc ? `
        <div class="post-field">
          <span class="post-field-label">Descrição</span>
          <div class="post-description">${escapeHtml(post.description)}</div>
        </div>` : ''}
      </div>
    `;

    // Toggle expand
    card.querySelector('.post-card-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });

    postsList.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.substring(0, 30) + (u.pathname.length > 30 ? '…' : '');
  } catch { return url.substring(0, 30); }
}

// ─────────────────────────────────────────────
// Export: Copy JSON
// ─────────────────────────────────────────────
function handleCopy() {
  navigator.clipboard.writeText(JSON.stringify(latestPosts, null, 2))
    .then(() => {
      copyBtn.title = '✅ Copiado!';
      setTimeout(() => { copyBtn.title = 'Copiar JSON'; }, 2000);
    });
}

// ─────────────────────────────────────────────
// Export: CSV
// ─────────────────────────────────────────────
function handleExportCSV() {
  if (!latestPosts.length) return;

  const headers = ['#', 'URL', 'Data', 'Data ISO', 'Tipo', 'Descrição', 'Coletado em'];
  const rows = latestPosts.map(p => [
    p['#'],
    p.url,
    p.date,
    p.dateISO,
    p.type,
    (p.description || '').replace(/"/g, '""'),
    p.collectedAt
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\r\n');

  downloadFile(csv, 'instagram_posts.csv', 'text/csv;charset=utf-8;\ufeff');
}

// ─────────────────────────────────────────────
// Export: JSON
// ─────────────────────────────────────────────
function handleExportJSON() {
  if (!latestPosts.length) return;
  downloadFile(
    JSON.stringify(latestPosts, null, 2),
    'instagram_posts.json',
    'application/json'
  );
}

// ─────────────────────────────────────────────
// Export: XLSX (via SheetJS)
// ─────────────────────────────────────────────
function handleExportXLSX() {
  if (!latestPosts.length) return;
  if (typeof XLSX === 'undefined') {
    alert('Erro: biblioteca XLSX não carregada.');
    return;
  }

  const headers = ['#', 'URL', 'Data', 'Data ISO', 'Tipo', 'Descrição', 'Coletado em'];
  const rows = latestPosts.map(p => [
    p['#'],
    p.url,
    p.date || '',
    p.dateISO || '',
    p.type || '',
    p.description || '',
    p.collectedAt || ''
  ]);

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws['!cols'] = [
    { wch: 5  },  // #
    { wch: 55 },  // URL
    { wch: 22 },  // Data
    { wch: 25 },  // Data ISO
    { wch: 14 },  // Tipo
    { wch: 80 },  // Descrição
    { wch: 22 },  // Coletado em
  ];

  // Style header row (bold) — basic cell format
  headers.forEach((_, colIdx) => {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: colIdx });
    if (!ws[cellAddr]) return;
    ws[cellAddr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F3E8FF' } } };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Posts Instagram');
  XLSX.writeFile(wb, 'instagram_posts.xlsx');
}

// ─────────────────────────────────────────────
// Download helper
// ─────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
