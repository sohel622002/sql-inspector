const statusEl = document.getElementById('status');
const statusTextEl = statusEl.querySelector('.status__text');
const tableListEl = document.getElementById('table-list');
const tableSearchEl = document.getElementById('table-search');
const currentTableEl = document.getElementById('current-table');
const rowCountEl = document.getElementById('row-count');
const refreshBtn = document.getElementById('refresh-btn');
const gridContainer = document.getElementById('grid-container');
const modalOverlay = document.getElementById('value-modal-overlay');
const modalContent = document.getElementById('value-modal-content');
const modalClose = document.getElementById('value-modal-close');
const valueSearchEl = document.getElementById('value-search');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIconDark = document.getElementById('theme-icon-dark');
const themeIconLight = document.getElementById('theme-icon-light');
const paginationBarEl = document.getElementById('pagination-bar');
const pageSizeEl = document.getElementById('page-size');
const pagePrevEl = document.getElementById('page-prev');
const pageNextEl = document.getElementById('page-next');
const pageStatusEl = document.getElementById('page-status');

let selectedTable = null;
let allTables = [];
let currentColumns = [];
let currentRows = [];
let filteredRows = [];
let currentPage = 1;
let pageSize = Number(pageSizeEl.value) || 10;

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    statusTextEl.textContent = data.connected ? 'App connected' : 'No app connected';
    statusEl.className = 'status ' + (data.connected ? 'status--connected' : 'status--disconnected');
    return data.connected;
  } catch {
    statusTextEl.textContent = 'Server unreachable';
    statusEl.className = 'status status--disconnected';
    return false;
  }
}

async function loadTables() {
  const connected = await refreshStatus();
  if (!connected) {
    tableListEl.innerHTML = '<p class="hint">Waiting for an app to connect…</p>';
    return;
  }

  try {
    const res = await fetch('/api/tables');
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load tables');
    const { tables } = await res.json();
    allTables = tables;

    if (!tables.length) {
      tableListEl.innerHTML = '<p class="hint">No tables found.</p>';
      return;
    }

    renderTableList(tables);
  } catch (err) {
    tableListEl.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function renderTableList(tables) {
  tableListEl.innerHTML = '';
  if (!tables.length) {
    tableListEl.innerHTML = '<p class="hint">No matching tables.</p>';
    return;
  }
  tables.forEach((name) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.className = name === selectedTable ? 'active' : '';
    btn.addEventListener('click', () => selectTable(name));
    tableListEl.appendChild(btn);
  });
}

function selectTable(name) {
  selectedTable = name;
  currentTableEl.textContent = name;
  refreshBtn.disabled = false;
  [...tableListEl.querySelectorAll('button')].forEach((btn) => {
    btn.classList.toggle('active', btn.textContent === name);
  });
  loadTableData();
}

async function loadTableData() {
  if (!selectedTable) return;
  gridContainer.innerHTML = '<p class="hint">Loading…</p>';
  rowCountEl.textContent = '';
  valueSearchEl.value = '';
  valueSearchEl.disabled = true;
  paginationBarEl.hidden = true;

  try {
    const res = await fetch(`/api/tables/${encodeURIComponent(selectedTable)}`);
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load table data');
    const { columns, rows } = await res.json();
    currentColumns = columns;
    currentRows = rows;
    valueSearchEl.disabled = columns.length === 0;
    currentPage = 1;
    applyFilterAndRender();
  } catch (err) {
    gridContainer.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function applyFilterAndRender() {
  const query = valueSearchEl.value.trim().toLowerCase();
  filteredRows = query
    ? currentRows.filter((row) =>
        currentColumns.some((col) => {
          const value = row[col];
          if (value === null || value === undefined) return false;
          return String(value).toLowerCase().includes(query);
        })
      )
    : currentRows;

  rowCountEl.textContent = `${filteredRows.length} row${filteredRows.length === 1 ? '' : 's'}`;
  renderGrid(currentColumns, filteredRows);
  renderPagination();
}

function renderPagination() {
  if (!currentColumns.length || !filteredRows.length) {
    paginationBarEl.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  paginationBarEl.hidden = false;
  pageStatusEl.textContent = `Page ${currentPage} of ${totalPages}`;
  pagePrevEl.disabled = currentPage <= 1;
  pageNextEl.disabled = currentPage >= totalPages;
}

function renderGrid(columns, rows) {
  if (!columns.length) {
    gridContainer.innerHTML = '<p class="hint">Table is empty.</p>';
    return;
  }

  if (!rows.length) {
    gridContainer.innerHTML = '<p class="hint">No matching rows.</p>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const table = document.createElement('table');
  table.className = 'data-grid';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  pageRows.forEach((row) => {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      const value = row[col];
      const isNull = value === null || value === undefined;
      const text = isNull ? 'NULL' : String(value);
      td.textContent = text;
      td.title = isNull ? '' : text;
      td.classList.toggle('is-null', isNull);

      if (typeof value === 'string' && value.length > 0) {
        td.classList.add('has-inspect');
        const btn = document.createElement('button');
        btn.className = 'cell-inspect';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Inspect value');
        btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 8v6M8 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openValueModal(col, value);
        });
        td.appendChild(btn);
      }

      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const wrap = document.createElement('div');
  wrap.className = 'grid-wrap';
  wrap.appendChild(table);

  gridContainer.innerHTML = '';
  gridContainer.appendChild(wrap);
}

function openValueModal(column, rawValue) {
  let displayValue = rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed !== null && typeof parsed === 'object') {
      displayValue = JSON.stringify(parsed, null, 2);
    }
  } catch {
    // not JSON — show as plain string
  }

  document.getElementById('value-modal-title').textContent = column;
  modalContent.textContent = displayValue;
  modalOverlay.hidden = false;
}

function closeValueModal() {
  modalOverlay.hidden = true;
  modalContent.textContent = '';
}

modalClose.addEventListener('click', closeValueModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeValueModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalOverlay.hidden) closeValueModal();
});

refreshBtn.addEventListener('click', () => {
  loadTableData();
  refreshStatus();
});

tableSearchEl.addEventListener('input', () => {
  const query = tableSearchEl.value.trim().toLowerCase();
  const filtered = allTables.filter((name) => name.toLowerCase().includes(query));
  renderTableList(filtered);
});

valueSearchEl.addEventListener('input', () => {
  currentPage = 1;
  applyFilterAndRender();
});

pageSizeEl.addEventListener('change', () => {
  pageSize = Number(pageSizeEl.value) || 10;
  currentPage = 1;
  renderGrid(currentColumns, filteredRows);
  renderPagination();
});

pagePrevEl.addEventListener('click', () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  renderGrid(currentColumns, filteredRows);
  renderPagination();
});

pageNextEl.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  if (currentPage >= totalPages) return;
  currentPage += 1;
  renderGrid(currentColumns, filteredRows);
  renderPagination();
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIconDark.hidden = theme === 'dark';
  themeIconLight.hidden = theme !== 'dark';
}

themeToggleBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('sql-inspector-theme', next);
  } catch {
    // ignore storage errors
  }
});

(function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('sql-inspector-theme');
  } catch {
    // ignore storage errors
  }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));
})();

loadTables();
setInterval(refreshStatus, 5000);
