const STORAGE_KEY = 'kanban-state';
const MASCOTS = ['img/chiikawa.png', 'img/momonga.png', 'img/usagi.png'];

const LABELS = [
  { id: 'design', name: '디자인', color: '#ffb3c6' },
  { id: 'dev', name: '개발', color: '#9fd3ff' },
  { id: 'bug', name: '버그', color: '#ff9b9b' },
  { id: 'plan', name: '기획', color: '#ffe17a' },
  { id: 'docs', name: '문서', color: '#b5e8b0' },
  { id: 'etc', name: '기타', color: '#d7c4ff' },
];

const PRIORITIES = {
  high: { name: '높음', icon: '🔥' },
  medium: { name: '보통', icon: '🌼' },
  low: { name: '낮음', icon: '🍃' },
};

const uid = () => Math.random().toString(36).slice(2, 10);

function defaultState() {
  return {
    columns: [
      { id: uid(), title: '할 일', wip: 0, cards: [] },
      { id: uid(), title: '진행 중', wip: 0, cards: [] },
      { id: uid(), title: '완료', wip: 0, cards: [] },
    ],
  };
}

// 예전 데이터나 가져온 파일도 현재 형식으로 맞춘다
function normalizeCard(card = {}) {
  return {
    id: card.id || uid(),
    title: String(card.title || ''),
    desc: String(card.desc || ''),
    labels: Array.isArray(card.labels) ? card.labels.filter((l) => LABELS.some((x) => x.id === l)) : [],
    priority: PRIORITIES[card.priority] ? card.priority : '',
    due: /^\d{4}-\d{2}-\d{2}$/.test(card.due || '') ? card.due : '',
    checklist: Array.isArray(card.checklist)
      ? card.checklist.map((i) => ({ id: i.id || uid(), text: String(i.text || ''), done: !!i.done }))
      : [],
  };
}

function normalize(data) {
  if (!data || !Array.isArray(data.columns)) return null;
  return {
    columns: data.columns.map((col) => ({
      id: col.id || uid(),
      title: String(col.title || '컬럼'),
      wip: Number(col.wip) > 0 ? Math.floor(Number(col.wip)) : 0,
      cards: (Array.isArray(col.cards) ? col.cards : []).map(normalizeCard),
    })),
  };
}

function load() {
  try {
    const parsed = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (parsed) return parsed;
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다.', e);
  }
  return defaultState();
}

// 서버 응답 전까지는 이 브라우저에 캐시된 보드를 먼저 보여준다
let state = load();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSync();
}

function update(fn) {
  fn();
  save();
  render();
}

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const dialog = $('card-dialog');
const titleInput = $('card-title');
const descInput = $('card-desc');
const prioritySelect = $('card-priority');
const dueInput = $('card-due');
const deleteBtn = $('card-delete');
const checkInput = $('check-input');
const toastEl = $('toast');

const filters = { q: '', label: '', priority: '' };

let editing = null; // { columnId, cardId | null, draft }
let dragged = null; // { columnId, cardId }

function findColumn(id) {
  return state.columns.find((c) => c.id === id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function dueStatus(due) {
  if (!due) return '';
  const diff = Math.round((new Date(due) - new Date(todayStr())) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 2) return 'soon';
  return '';
}

function formatDue(due) {
  const [, m, d] = due.split('-');
  const status = dueStatus(due);
  if (status === 'today') return '오늘';
  return `${Number(m)}월 ${Number(d)}일`;
}

const isFiltering = () => Boolean(filters.q.trim() || filters.label || filters.priority);

function matches(card) {
  const q = filters.q.trim().toLowerCase();
  if (q && !`${card.title} ${card.desc}`.toLowerCase().includes(q)) return false;
  if (filters.label && !card.labels.includes(filters.label)) return false;
  if (filters.priority && card.priority !== filters.priority) return false;
  return true;
}

/* ---------- 렌더링 ---------- */

function render() {
  boardEl.replaceChildren(...state.columns.map(renderColumn));
  $('clear-filters').hidden = !isFiltering();
  renderSummary();
}

function renderSummary() {
  const cards = state.columns.flatMap((c) => c.cards);
  const overdue = cards.filter((c) => dueStatus(c.due) === 'overdue').length;
  const text = [`카드 ${cards.length}개`];
  if (overdue) text.push(`⏰ 기한 지남 ${overdue}개`);
  $('summary').textContent = text.join(' · ');
}

function renderColumn(col, index) {
  const colEl = el('section', 'column');
  const over = col.wip && col.cards.length > col.wip;
  colEl.classList.toggle('over-limit', Boolean(over));

  const header = el('div', 'column-header');
  const mascot = el('img', 'mascot');
  mascot.src = MASCOTS[index % MASCOTS.length];
  mascot.alt = '';

  const title = el('input', 'column-title');
  title.value = col.title;
  title.maxLength = 40;
  title.dataset.columnId = col.id;
  title.addEventListener('change', () => {
    update(() => { col.title = title.value.trim() || col.title; });
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });

  const count = el('span', 'count', col.wip ? `${col.cards.length}/${col.wip}` : String(col.cards.length));
  count.title = col.wip ? `WIP 제한 ${col.wip}개` : '카드 수';

  const wipBtn = el('button', 'icon-btn', '⚙');
  wipBtn.type = 'button';
  wipBtn.title = 'WIP 제한 설정';
  wipBtn.addEventListener('click', () => {
    const value = prompt('이 컬럼의 최대 카드 수 (0 = 제한 없음)', String(col.wip || 0));
    if (value === null) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return showToast('0 이상의 숫자를 입력해 주세요');
    update(() => { col.wip = Math.floor(n); });
  });

  const del = el('button', 'icon-btn', '✕');
  del.type = 'button';
  del.title = '컬럼 삭제';
  del.addEventListener('click', () => removeColumn(col.id));

  header.append(mascot, title, count, wipBtn, del);

  const cardsEl = el('div', 'cards');
  const visible = col.cards.filter(matches);
  visible.forEach((card) => cardsEl.append(renderCard(col, card)));
  if (!visible.length) {
    cardsEl.append(el('div', 'empty', isFiltering() ? '조건에 맞는 카드가 없어요' : '카드를 여기로 끌어오세요'));
  }

  const addBtn = el('button', 'add-card', '+ 카드 추가');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => openDialog(col.id, null));

  colEl.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    colEl.classList.add('drag-over');
  });
  colEl.addEventListener('dragleave', (e) => {
    if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('drag-over');
  });
  colEl.addEventListener('drop', (e) => {
    e.preventDefault();
    colEl.classList.remove('drag-over');
    if (dragged) moveCard(dragged, col.id, beforeCardId(cardsEl, e.clientY));
  });

  colEl.append(header, cardsEl, addBtn);
  return colEl;
}

function renderCard(col, card) {
  const cardEl = el('article', 'card');
  if (card.priority) cardEl.classList.add(`p-${card.priority}`);
  cardEl.draggable = true;
  cardEl.tabIndex = 0;
  cardEl.dataset.id = card.id;

  if (card.labels.length) {
    const labelsEl = el('div', 'card-labels');
    card.labels.forEach((id) => {
      const label = LABELS.find((l) => l.id === id);
      const chip = el('span', 'label-chip', label.name);
      chip.style.background = label.color;
      labelsEl.append(chip);
    });
    cardEl.append(labelsEl);
  }

  cardEl.append(el('h3', '', card.title));
  if (card.desc) cardEl.append(el('p', '', card.desc));

  const meta = el('div', 'card-meta');
  if (card.priority) {
    const p = PRIORITIES[card.priority];
    meta.append(el('span', `badge prio-${card.priority}`, `${p.icon} ${p.name}`));
  }
  if (card.due) {
    meta.append(el('span', `badge due ${dueStatus(card.due)}`, `📅 ${formatDue(card.due)}`));
  }
  if (card.checklist.length) {
    const done = card.checklist.filter((i) => i.done).length;
    const badge = el('span', 'badge check', `☑ ${done}/${card.checklist.length}`);
    badge.classList.toggle('complete', done === card.checklist.length);
    meta.append(badge);
  }
  if (meta.childElementCount) cardEl.append(meta);

  cardEl.addEventListener('dragstart', (e) => {
    dragged = { columnId: col.id, cardId: card.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
    requestAnimationFrame(() => cardEl.classList.add('dragging'));
  });
  cardEl.addEventListener('dragend', () => {
    dragged = null;
    cardEl.classList.remove('dragging');
  });
  cardEl.addEventListener('click', () => openDialog(col.id, card.id));
  cardEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDialog(col.id, card.id); });
  return cardEl;
}

/* ---------- 드래그앤드롭 ---------- */

// 마우스 위치 바로 아래에 있는 카드 id (없으면 맨 끝)
function beforeCardId(cardsEl, y) {
  for (const c of cardsEl.querySelectorAll('.card:not(.dragging)')) {
    const box = c.getBoundingClientRect();
    if (y < box.top + box.height / 2) return c.dataset.id;
  }
  return null;
}

function moveCard(from, toColumnId, beforeId) {
  if (from.cardId === beforeId) return;
  update(() => {
    const src = findColumn(from.columnId);
    const dst = findColumn(toColumnId);
    const i = src.cards.findIndex((c) => c.id === from.cardId);
    if (i < 0) return;
    const [card] = src.cards.splice(i, 1);
    const j = beforeId ? dst.cards.findIndex((c) => c.id === beforeId) : -1;
    dst.cards.splice(j < 0 ? dst.cards.length : j, 0, card);
  });
}

/* ---------- 컬럼 ---------- */

function addColumn() {
  update(() => { state.columns.push({ id: uid(), title: '새 컬럼', wip: 0, cards: [] }); });
  const inputs = boardEl.querySelectorAll('.column-title');
  const last = inputs[inputs.length - 1];
  last.scrollIntoView({ behavior: 'smooth', inline: 'end' });
  last.focus();
  last.select();
}

function removeColumn(columnId) {
  const index = state.columns.findIndex((c) => c.id === columnId);
  const [removed] = state.columns.splice(index, 1);
  save();
  render();
  showToast(`"${removed.title}" 컬럼을 삭제했어요`, () => {
    update(() => { state.columns.splice(Math.min(index, state.columns.length), 0, removed); });
  });
}

/* ---------- 카드 편집 다이얼로그 ---------- */

function openDialog(columnId, cardId) {
  const card = cardId ? findColumn(columnId).cards.find((c) => c.id === cardId) : null;
  editing = { columnId, cardId, draft: card ? structuredClone(card) : normalizeCard() };

  $('dialog-title').textContent = card ? '카드 수정' : '카드 추가';
  titleInput.value = editing.draft.title;
  descInput.value = editing.draft.desc;
  prioritySelect.value = editing.draft.priority;
  dueInput.value = editing.draft.due;
  checkInput.value = '';
  deleteBtn.hidden = !card;

  renderLabelPicker();
  renderChecklist();
  dialog.showModal();
  titleInput.focus();
}

function renderLabelPicker() {
  const picker = $('label-picker');
  picker.replaceChildren(...LABELS.map((label) => {
    const btn = el('button', 'label-toggle', label.name);
    btn.type = 'button';
    btn.style.setProperty('--c', label.color);
    btn.classList.toggle('on', editing.draft.labels.includes(label.id));
    btn.addEventListener('click', () => {
      const labels = editing.draft.labels;
      editing.draft.labels = labels.includes(label.id)
        ? labels.filter((l) => l !== label.id)
        : LABELS.map((l) => l.id).filter((id) => id === label.id || labels.includes(id));
      renderLabelPicker();
    });
    return btn;
  }));
}

function renderChecklist() {
  const items = editing.draft.checklist;
  const done = items.filter((i) => i.done).length;
  $('check-count').textContent = items.length ? `${done}/${items.length}` : '';
  $('check-progress').style.width = items.length ? `${(done / items.length) * 100}%` : '0';

  $('checklist').replaceChildren(...items.map((item) => {
    const li = el('li', item.done ? 'done' : '');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = item.done;
    box.addEventListener('change', () => { item.done = box.checked; renderChecklist(); });
    const text = el('span', '', item.text);
    const del = el('button', 'icon-btn', '✕');
    del.type = 'button';
    del.title = '항목 삭제';
    del.addEventListener('click', () => {
      editing.draft.checklist = items.filter((i) => i.id !== item.id);
      renderChecklist();
    });
    li.append(box, text, del);
    return li;
  }));
}

function addChecklistItem() {
  const text = checkInput.value.trim();
  if (!text) return;
  editing.draft.checklist.push({ id: uid(), text, done: false });
  checkInput.value = '';
  renderChecklist();
}

$('check-add').addEventListener('click', addChecklistItem);
checkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addChecklistItem();
  }
});

$('card-form').addEventListener('submit', () => {
  const title = titleInput.value.trim();
  if (!title || !editing) return;
  const { columnId, cardId, draft } = editing;
  Object.assign(draft, {
    title,
    desc: descInput.value.trim(),
    priority: prioritySelect.value,
    due: dueInput.value,
  });
  update(() => {
    const col = findColumn(columnId);
    const i = cardId ? col.cards.findIndex((c) => c.id === cardId) : -1;
    if (i >= 0) col.cards[i] = draft;
    else col.cards.push(draft);
  });
});

$('card-cancel').addEventListener('click', () => dialog.close());

deleteBtn.addEventListener('click', () => {
  if (!editing || !editing.cardId) return;
  const { columnId, cardId } = editing;
  const col = findColumn(columnId);
  const index = col.cards.findIndex((c) => c.id === cardId);
  const [removed] = col.cards.splice(index, 1);
  save();
  render();
  dialog.close();
  showToast(`"${removed.title}" 카드를 삭제했어요`, () => {
    update(() => {
      const target = findColumn(columnId) || state.columns[0];
      if (target) target.cards.splice(Math.min(index, target.cards.length), 0, removed);
    });
  });
});

/* ---------- 토스트 ---------- */

let toastTimer;

function hideToast() {
  toastEl.classList.remove('show');
}

function showToast(message, undo) {
  toastEl.replaceChildren(el('span', '', message));
  if (undo) {
    const btn = el('button', '', '되돌리기');
    btn.type = 'button';
    btn.addEventListener('click', () => { undo(); hideToast(); });
    toastEl.append(btn);
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

/* ---------- 필터 ---------- */

LABELS.forEach((l) => $('filter-label').append(new Option(l.name, l.id)));
Object.entries(PRIORITIES).forEach(([id, p]) => {
  $('filter-priority').append(new Option(`${p.icon} ${p.name}`, id));
  prioritySelect.append(new Option(`${p.icon} ${p.name}`, id));
});

$('search').addEventListener('input', (e) => { filters.q = e.target.value; render(); });
$('filter-label').addEventListener('change', (e) => { filters.label = e.target.value; render(); });
$('filter-priority').addEventListener('change', (e) => { filters.priority = e.target.value; render(); });
$('clear-filters').addEventListener('click', () => {
  filters.q = filters.label = filters.priority = '';
  $('search').value = $('filter-label').value = $('filter-priority').value = '';
  render();
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select') || dialog.open;
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('search').focus();
  }
});

/* ---------- 내보내기 / 가져오기 ---------- */

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kanban-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data = null;
  try {
    data = normalize(JSON.parse(await file.text()));
  } catch {
    data = null;
  }
  if (!data) return showToast('올바른 칸반 파일이 아니에요');
  if (!confirm('지금 보드를 가져온 파일로 바꿀까요?')) return;
  const previous = state;
  update(() => { state = data; });
  showToast('보드를 가져왔어요', () => update(() => { state = previous; }));
});

$('add-column').addEventListener('click', addColumn);

/* ---------- 서버 동기화 ---------- */

const KEY_STORAGE = 'kanban-key';
const POLL_MS = 4000;

let version = 0;      // 마지막으로 서버와 맞춘 버전
let dirty = false;    // 아직 서버에 보내지 않은 변경이 있음
let inflight = false; // 저장 요청 진행 중
let syncTimer;

const SYNC_TEXT = {
  loading: '불러오는 중…',
  saving: '저장 중…',
  saved: '☁ 저장됨',
  offline: '⚠ 서버에 연결할 수 없어요',
};

function setSync(status) {
  const node = $('sync');
  node.textContent = SYNC_TEXT[status];
  node.dataset.status = status;
}

async function api(method, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('/api/board', {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-board-key': encodeURIComponent(localStorage.getItem(KEY_STORAGE) || ''),
      },
      body,
    });
    if (res.status !== 401) return res;
    const key = prompt(attempt ? '비밀번호가 틀렸어요. 다시 입력해 주세요' : '보드 비밀번호를 입력해 주세요');
    if (key === null) break;
    localStorage.setItem(KEY_STORAGE, key);
  }
  throw new Error('unauthorized');
}

function applyRemote(remote) {
  state = normalize(remote.data) || defaultState();
  version = remote.version;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

// 드래그 중이거나 컬럼 이름을 고치는 중에는 화면을 갈아엎지 않는다
function isBusy() {
  return Boolean(dragged) || document.activeElement?.classList.contains('column-title');
}

function scheduleSync() {
  dirty = true;
  setSync('saving');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flush, 400);
}

async function flush() {
  if (inflight) {
    syncTimer = setTimeout(flush, 300);
    return;
  }
  if (!dirty) return;
  inflight = true;
  dirty = false;
  try {
    const res = await api('PUT', JSON.stringify({ data: state, version }));
    if (res.status === 409) {
      dirty = false;
      applyRemote(await res.json());
      showToast('다른 사람이 먼저 수정해서 최신 내용으로 바꿨어요');
    } else if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    } else {
      version = (await res.json()).version;
    }
    setSync(dirty ? 'saving' : 'saved');
  } catch (e) {
    console.warn('저장 실패', e);
    dirty = true;
    setSync('offline');
    syncTimer = setTimeout(flush, 5000);
  } finally {
    inflight = false;
  }
}

async function pull() {
  if (dirty || inflight || document.hidden) return;
  try {
    const res = await api('GET');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    // 응답을 기다리는 사이 내가 수정했다면 내 변경을 우선한다
    if (dirty || inflight) return;
    if (remote.data === null) {
      // 처음 쓰는 보드: 지금 화면의 보드를 서버에 올린다
      version = remote.version;
      scheduleSync();
      return;
    }
    if (remote.version !== version && !isBusy()) applyRemote(remote);
    setSync('saved');
  } catch (e) {
    console.warn('불러오기 실패', e);
    setSync('offline');
  }
}

render();
setSync('loading');
pull();
setInterval(pull, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
