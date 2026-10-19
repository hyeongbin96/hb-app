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
    pets: normalizePets(),
  };
}

// 놀이터에 사는 친구들. 모두가 함께 키운다
const PET_IDS = ['chiikawa', 'usagi', 'momonga'];

// legacy: 치이카와 한 마리만 키우던 예전 데이터(data.pet)
function normalizePets(pets = {}, legacy = null) {
  const out = {};
  PET_IDS.forEach((id, i) => {
    const src = pets[id] || (id === 'chiikawa' && legacy) || { fedAt: Date.now() - i * 40000 }; // 배고픈 때가 엇갈리게
    out[id] = normalizePet(src);
  });
  return out;
}

// fedAt: 마지막으로 밥 먹은 시각
function normalizePet(pet = {}) {
  return {
    fedAt: Number(pet.fedAt) || Date.now(),
    fedBy: String(pet.fedBy || '').slice(0, 20),
    meals: Number(pet.meals) > 0 ? Math.floor(Number(pet.meals)) : 0,
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
    comments: Array.isArray(card.comments)
      ? card.comments.map((m) => ({
        id: m.id || uid(),
        author: String(m.author || '익명').slice(0, 20),
        text: String(m.text || '').slice(0, 500),
        at: Number(m.at) || Date.now(),
      }))
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
    pets: normalizePets(data.pets, data.pet),
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
let viewers = new Map(); // 관리자 전용: cardId → 그 카드를 보고 있는 닉네임들

function findColumn(id) {
  return state.columns.find((c) => c.id === id);
}

// 이름에 "완료/done"이 들어간 컬럼, 없으면 마지막 컬럼을 완료 컬럼으로 본다
function doneColumn() {
  return state.columns.find((c) => /완료|done/i.test(c.title)) || state.columns[state.columns.length - 1];
}

// 다른 사람이 카드를 옮겼을 수 있으니 항상 id로 전체 컬럼에서 찾는다
function findCardById(id) {
  if (!id) return null;
  for (const col of state.columns) {
    const index = col.cards.findIndex((c) => c.id === id);
    if (index >= 0) return { col, card: col.cards[index], index };
  }
  return null;
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
  renderMood();
  updatePet();
}

// 완료 컬럼의 카드는 기한이 지나도 "지남"으로 세지 않는다
function overdueCount() {
  const done = doneColumn();
  return state.columns
    .filter((c) => c !== done)
    .flatMap((c) => c.cards)
    .filter((c) => dueStatus(c.due) === 'overdue').length;
}

function renderSummary() {
  const cards = state.columns.flatMap((c) => c.cards);
  const overdue = overdueCount();
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
    const status = col === doneColumn() ? 'done' : dueStatus(card.due);
    meta.append(el('span', `badge due ${status}`, `📅 ${formatDue(card.due)}`));
  }
  if (card.checklist.length) {
    const done = card.checklist.filter((i) => i.done).length;
    const badge = el('span', 'badge check', `☑ ${done}/${card.checklist.length}`);
    badge.classList.toggle('complete', done === card.checklist.length);
    meta.append(badge);
  }
  if (card.comments.length) {
    meta.append(el('span', 'badge comment', `💬 ${card.comments.length}`));
  }
  const watching = viewers.get(card.id);
  if (watching) meta.append(el('span', 'badge viewing', `👀 ${watching.join(', ')}`));
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
  const src = findColumn(from.columnId);
  const dst = findColumn(toColumnId);
  if (!src || !dst) return;
  if (src !== dst && dst === doneColumn()) celebrate();
  update(() => {
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

  $('comment-input').value = '';

  renderLabelPicker();
  renderChecklist();
  renderComments();
  dialog.showModal();
  titleInput.focus();
  heartbeat();
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
  if (e.key === 'Enter' && !e.isComposing) {
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
    const found = findCardById(cardId);
    // 댓글은 다이얼로그를 연 동안에도 바로 저장되므로 최신 댓글을 유지한다
    if (found) found.col.cards[found.index] = { ...draft, comments: found.card.comments };
    else (findColumn(columnId) || state.columns[0])?.cards.push(draft);
  });
});

$('card-cancel').addEventListener('click', () => dialog.close());

deleteBtn.addEventListener('click', () => {
  if (!editing || !editing.cardId) return;
  const found = findCardById(editing.cardId);
  if (!found) return dialog.close();
  const { index } = found;
  const columnId = found.col.id;
  const [removed] = found.col.cards.splice(index, 1);
  pendingComments.forEach((id) => { if (removed.comments.some((m) => m.id === id)) pendingComments.delete(id); });
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

/* ---------- 닉네임 ---------- */

const NICK_STORAGE = 'kanban-nickname';
const nickDialog = $('nick-dialog');
const nickInput = $('nick-input');

const getNickname = () => localStorage.getItem(NICK_STORAGE) || '';

function renderNickname() {
  const nick = getNickname();
  $('nickname').textContent = nick ? `🐾 ${nick}` : '🐾 닉네임 정하기';
}

function openNickDialog() {
  nickInput.value = getNickname();
  nickDialog.showModal();
  nickInput.focus();
  nickInput.select();
}

// 처음 정할 때는 Esc로 닫지 못하게 한다
nickDialog.addEventListener('cancel', (e) => { if (!getNickname()) e.preventDefault(); });

$('nick-form').addEventListener('submit', (e) => {
  const nick = nickInput.value.trim().slice(0, 20);
  if (!nick) {
    e.preventDefault();
    return;
  }
  localStorage.setItem(NICK_STORAGE, nick);
  renderNickname();
  if (dialog.open) renderComments();
  heartbeat();
});

$('nickname').addEventListener('click', openNickDialog);

/* ---------- 댓글 ---------- */

const pendingComments = new Set(); // 서버 저장이 아직 확인되지 않은 내 댓글 id
const commentInput = $('comment-input');

function timeAgo(at) {
  const sec = (Date.now() - at) / 1000;
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function avatarColor(name) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${hue} 85% 86%)`;
}

function renderComments() {
  const found = editing ? findCardById(editing.cardId) : null;
  const comments = found ? found.card.comments : [];
  const me = getNickname();

  $('comment-hint').hidden = Boolean(found);
  $('comment-form').hidden = !found;
  $('comment-count').textContent = comments.length ? `${comments.length}개` : '';

  $('comments').replaceChildren(...comments.map((m) => {
    const li = el('li', m.author === me ? 'comment mine' : 'comment');
    const avatar = el('span', 'avatar', [...m.author][0] || '?');
    avatar.style.background = avatarColor(m.author);

    const head = el('div', 'comment-head');
    const time = el('time', '', timeAgo(m.at));
    time.title = new Date(m.at).toLocaleString('ko-KR');
    head.append(el('strong', '', m.author), time);
    if (m.author === me) {
      const del = el('button', 'icon-btn', '✕');
      del.type = 'button';
      del.title = '댓글 삭제';
      del.addEventListener('click', () => deleteComment(m.id));
      head.append(del);
    }

    const body = el('div', 'comment-body');
    body.append(head, el('p', '', m.text));
    li.append(avatar, body);
    return li;
  }));
}

function addComment() {
  const text = commentInput.value.trim();
  const found = editing && findCardById(editing.cardId);
  if (!text || !found) return;
  if (!getNickname()) return openNickDialog();

  const comment = { id: uid(), author: getNickname(), text, at: Date.now() };
  pendingComments.add(comment.id);
  update(() => { found.card.comments.push(comment); });
  commentInput.value = '';
  renderComments();
  const list = $('comments');
  list.scrollTop = list.scrollHeight;
}

function deleteComment(id) {
  const found = editing && findCardById(editing.cardId);
  if (!found) return;
  pendingComments.delete(id);
  update(() => { found.card.comments = found.card.comments.filter((m) => m.id !== id); });
  renderComments();
}

$('comment-add').addEventListener('click', addComment);
commentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    addComment();
  }
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

/* ---------- 캐릭터 리액션 ---------- */

const CHEERS = [
  { img: 'img/usagi.png', line: '야하!' },
  { img: 'img/usagi.png', line: '우라~!' },
  { img: 'img/chiikawa.png', line: '타쿠타쿠!' },
  { img: 'img/momonga.png', line: '뿌릿' },
];
const CONFETTI = ['🌸', '✨', '🍓', '⭐', '💖', '🎀'];

const MOODS = {
  party: '다 끝났다! 🎉',
  worried: '마감 지난 게 있어…!',
  sad: '마감이 잔뜩 지났어… 😢',
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// 카드를 완료 컬럼으로 옮기면 캐릭터가 튀어나와 축하한다
function celebrate() {
  document.querySelector('.celebrate')?.remove();
  const cheer = pick(CHEERS);
  const layer = el('div', 'celebrate');
  const pop = el('div', 'cheer');
  const img = el('img');
  img.src = cheer.img;
  img.alt = '';
  pop.append(el('div', 'bubble', cheer.line), img);
  layer.append(pop);

  if (!reduceMotion.matches) {
    for (let i = 0; i < 36; i++) {
      const bit = el('span', 'confetti', pick(CONFETTI));
      bit.style.setProperty('--x', `${(Math.random() - 0.5) * 700}px`);
      bit.style.setProperty('--y', `${-180 - Math.random() * 380}px`);
      bit.style.setProperty('--r', `${(Math.random() - 0.5) * 720}deg`);
      bit.style.animationDelay = `${Math.random() * 0.15}s`;
      layer.append(bit);
    }
  }

  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

// 보드 상태에 따라 상단 캐릭터들의 기분이 바뀐다
function renderMood() {
  const overdue = overdueCount();
  const done = doneColumn();
  const cards = state.columns.flatMap((c) => c.cards);
  const allDone = cards.length > 0 && done && done.cards.length === cards.length;

  let mood = '';
  if (overdue >= 3) mood = 'sad';
  else if (overdue > 0) mood = 'worried';
  else if (allDone) mood = 'party';

  $('mascots').dataset.mood = mood;
  const bubble = $('mood-bubble');
  bubble.hidden = !mood;
  bubble.textContent = MOODS[mood] || '';
}

/* ---------- 접속 신호 / 관리자 접속자 현황 ---------- */

const SESSION_ID = sessionStorage.getItem('kanban-session') || uid();
sessionStorage.setItem('kanban-session', SESSION_ID);

const ADMIN_STORAGE = 'kanban-admin-key';
const HEARTBEAT_MS = 15000;
const ADMIN_POLL_MS = 10000;
let adminTimer;

// 모든 접속자가 보내는 "나 여기 있어요" 신호. 목록은 관리자만 볼 수 있다.
async function heartbeat() {
  const nickname = getNickname();
  if (!nickname || document.hidden) return;
  const cardId = (dialog.open && editing?.cardId) || null;
  try {
    await api('POST', JSON.stringify({ id: SESSION_ID, nickname, cardId }), '/api/presence');
  } catch {
    // 접속 신호는 실패해도 보드 사용에는 지장이 없다
  }
}

const adminKey = () => localStorage.getItem(ADMIN_STORAGE) || '';

async function pollPresence() {
  try {
    const res = await fetch('/api/presence', { headers: { 'x-admin-key': encodeURIComponent(adminKey()) } });
    if (res.status === 401 || res.status === 403) {
      const { error } = await res.json().catch(() => ({}));
      stopAdmin();
      showToast(error || '관리자 비밀번호가 틀렸어요');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderPresence(await res.json());
  } catch (e) {
    console.warn('접속자 조회 실패', e);
  }
}

function renderPresence(list) {
  viewers = new Map();
  list.forEach((p) => {
    if (p.card_id && p.id !== SESSION_ID) viewers.set(p.card_id, [...(viewers.get(p.card_id) || []), p.nickname]);
  });

  $('presence-count').textContent = `${list.length}명`;
  $('presence-list').replaceChildren(...list.map((p) => {
    const li = el('li');
    const avatar = el('span', 'avatar', [...p.nickname][0] || '?');
    avatar.style.background = avatarColor(p.nickname);
    const info = el('div', 'presence-info');
    const found = findCardById(p.card_id);
    info.append(
      el('strong', '', p.id === SESSION_ID ? `${p.nickname} (나)` : p.nickname),
      el('span', '', found ? `「${found.card.title}」 보는 중` : '보드 보는 중'),
    );
    li.append(avatar, info);
    return li;
  }));
  if (!isBusy()) render();
}

function startAdmin() {
  $('presence').hidden = false;
  pollPresence();
  clearInterval(adminTimer);
  adminTimer = setInterval(pollPresence, ADMIN_POLL_MS);
}

function stopAdmin() {
  localStorage.removeItem(ADMIN_STORAGE);
  clearInterval(adminTimer);
  $('presence').hidden = true;
  viewers = new Map();
  render();
}

$('admin-logout').addEventListener('click', () => {
  stopAdmin();
  showToast('관리자 모드를 껐어요');
});
$('presence-toggle').addEventListener('click', () => $('presence').classList.toggle('collapsed'));
dialog.addEventListener('close', heartbeat);

// 주소 끝에 ?admin 을 붙여 접속하면 관리자 비밀번호를 묻는다
function initAdmin() {
  const params = new URLSearchParams(location.search);
  if (params.has('admin')) {
    const key = prompt('관리자 비밀번호를 입력해 주세요');
    if (key) localStorage.setItem(ADMIN_STORAGE, key);
    params.delete('admin');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  }
  if (adminKey()) startAdmin();
}

/* ---------- 펫: 먼작귀 놀이터 (치이카와·우사기·모몽가) ---------- */

const HUNGRY_AFTER_MS = 2 * 60 * 1000; // 밥 먹고 2분 지나면 배고파진다
const SLEEP_EVERY_MS = 5 * 60 * 1000;  // 5분마다 낮잠
const SLEEP_MS = 30 * 1000;            // 30초 동안 잔다
const PET_SIZE = 88;
const PET_MOTIONS = ['walking', 'running', 'hopping', 'look', 'hop', 'sigh', 'spin', 'dance', 'stretch'];
const playGap = () => (40 + Math.random() * 50) * 1000; // 40~90초마다 둘이 만나서 논다

const PET_TYPES = {
  chiikawa: {
    name: '치이카와',
    img: 'img/chiikawa-pet.png',
    speed: 1,
    lines: { hungry: '🍙 배고파…', fed: '배불러~ 💕', sleepy: '졸려… 💤', wake: '잘 잤다~ ☀️', play: '와아!', snow: '눈사람 만들자! ⛄' },
  },
  usagi: {
    name: '우사기',
    img: 'img/usagi-pet.png',
    speed: 1.4, // 우사기는 늘 신나서 빠르다
    lines: { hungry: '🍙 하아…? 배고파', fed: '야하!! 💛', sleepy: '후아암…', wake: '우라~!', play: '야하!', snow: '우라~! ⛄' },
  },
  momonga: {
    name: '모몽가',
    img: 'img/momonga-pet.png',
    speed: 1.15,
    lines: { hungry: '🍙 밥 줘! 밥!', fed: '나 칭찬해 줘! 💙', sleepy: '졸려…', wake: '나 귀엽지?', play: '놀아 줘!', snow: '눈사람 내 거야! ⛄' },
  },
};

const yardEl = $('pet-yard');
const houseEl = $('pet-house');
const pets = [];
const sleepers = new Set();     // 지금 집에서 자고 있는 펫 id
const pendingFeeds = new Set(); // 서버 저장이 아직 확인되지 않은 밥 주기 (펫 id)
let nextPlayAt = Date.now() + (20 + Math.random() * 20) * 1000;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const petRest = () => 120 + Math.random() * 300; // 동작 사이 아주 짧게만 쉰다
const petMaxX = () => Math.max(0, yardEl.clientWidth - houseEl.offsetWidth - 14 - PET_SIZE);
const doorX = () => yardEl.clientWidth - 12 - houseEl.offsetWidth / 2 - PET_SIZE / 2; // 집 문 앞

class Pet {
  constructor(id) {
    this.id = id;
    this.type = PET_TYPES[id];
    this.timer = null;
    this.busy = false; // 밥 먹기·낮잠·같이 놀기 중에는 혼자 돌아다니지 않는다
    this.sayUntil = 0;
    this.seenFedAt = this.data.fedAt;
    // 다 같이 자러 가지 않도록 첫 낮잠 시각을 엇갈리게
    this.nextSleepAt = Date.now() + SLEEP_EVERY_MS * (0.3 + Math.random() * 0.7);
    this.build();
    this.setX(Math.random() * petMaxX());
  }

  get data() {
    return state.pets[this.id];
  }

  build() {
    this.el = el('div', 'pet');
    this.bubble = el('button', 'pet-bubble');
    this.bubble.type = 'button';
    this.bubble.title = `${this.type.name}에게 밥 주기`;
    this.bubble.hidden = true;
    this.body = el('div', 'pet-body');
    this.body.title = `${this.type.name} 쓰다듬기`;
    const img = el('img');
    img.src = this.type.img;
    img.alt = this.type.name;
    const breath = el('div', 'pet-breath');
    breath.append(img);
    this.body.append(el('span', 'pet-umbrella', '☂️'), breath);
    this.el.append(this.bubble, this.body, el('span', 'pet-shadow'));
    $('pets').append(this.el);

    this.bubble.addEventListener('click', () => this.feed());
    this.body.addEventListener('click', () => this.pat());
  }

  hungry() {
    return Date.now() - this.data.fedAt > HUNGRY_AFTER_MS;
  }

  /* --- 이동과 동작 --- */

  schedule(ms, fn = () => this.next()) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  setX(x, seconds = 0) {
    this.el.style.transitionDuration = `${seconds}s`;
    this.el.style.transform = `translateX(${x}px)`;
    this.x = x;
  }

  // 하던 동작을 멈추고 지금 위치에 바로 선다
  freeze() {
    clearTimeout(this.timer);
    const { m41 } = new DOMMatrix(getComputedStyle(this.el).transform);
    this.setX(m41);
    this.body.classList.remove(...PET_MOTIONS);
  }

  // gait: walking(뒤뚱) / running(총총) / hopping(깡총깡총)
  move(x, speed, gait) {
    if (Math.abs(x - this.x) < 50) x = petMaxX() - x; // 너무 가까우면 반대편으로
    const seconds = Math.abs(x - this.x) / (speed * this.type.speed);
    this.body.classList.toggle('face-left', x < this.x);
    this.body.classList.add(gait);
    this.setX(x, seconds);
    this.schedule(seconds * 1000, () => {
      this.body.classList.remove(gait);
      this.schedule(petRest());
    });
  }

  play(className, ms) {
    this.body.classList.add(className);
    this.schedule(ms, () => {
      this.body.classList.remove(className);
      this.schedule(petRest());
    });
  }

  // 혼자 쉬지 않고 돌아다닌다. 배고프면 느릿느릿, 한숨이 늘어난다
  next() {
    if (this.busy || reduceMotion.matches) return;
    const target = Math.random() * petMaxX();
    const r = Math.random();
    if (this.hungry()) {
      if (r < 0.6) this.move(target, 28, 'walking');
      else if (r < 0.85) this.play('sigh', 1600);
      else this.play('look', 1400);
      return;
    }
    if (weather === 'snow' && r < 0.1) runPetEvent([this], () => this.buildSnowman());
    else if (r < 0.38) this.move(target, 60, 'walking');
    else if (r < 0.53) this.move(target, 140, 'running');
    else if (r < 0.68) this.move(target, 75, 'hopping');
    else if (r < 0.76) this.play('spin', 900);
    else if (r < 0.84) this.play('dance', 1600);
    else if (r < 0.92) this.play('look', 1300);
    else this.play('stretch', 1300);
  }

  // 이벤트용: 정해진 곳까지 걸어가고 끝나면 돌아온다
  async walk(x, speed = 60, gait = 'walking') {
    const seconds = Math.abs(x - this.x) / (speed * this.type.speed);
    this.body.classList.toggle('face-left', x < this.x);
    this.body.classList.add(gait);
    this.setX(x, seconds);
    await wait(seconds * 1000);
    this.body.classList.remove(gait);
  }

  async playOnce(className, ms) {
    this.body.classList.add(className);
    await wait(ms);
    this.body.classList.remove(className);
  }

  /* --- 말구름 --- */

  showBubble(text, kind) {
    this.bubble.textContent = text;
    this.bubble.className = `pet-bubble ${kind}`;
    this.bubble.hidden = false;
    this.bubble.disabled = kind !== 'hungry';
  }

  hideBubble() {
    this.bubble.hidden = true;
  }

  // 잠깐 한마디. 배고픔 말구름이 떠 있으면 그쪽이 우선이다
  say(text, ms = 2000) {
    if (!this.busy && this.hungry()) return;
    this.showBubble(text, 'say');
    this.sayUntil = Date.now() + ms;
    setTimeout(() => {
      if (Date.now() < this.sayUntil) return; // 그 사이 다른 말을 했다
      this.hideBubble();
      if (!this.busy) this.update();
    }, ms);
  }

  spawn(symbols, count) {
    for (let i = 0; i < count; i++) {
      const bit = el('span', 'pet-heart', pick(symbols));
      bit.style.setProperty('--x', `${(Math.random() - 0.5) * 90}px`);
      bit.style.setProperty('--y', `${-50 - Math.random() * 60}px`);
      bit.style.animationDelay = `${Math.random() * 0.8}s`;
      this.el.append(bit);
      setTimeout(() => bit.remove(), 2600);
    }
  }

  /* --- 밥 주기 --- */

  feed() {
    if (!this.hungry() || this.busy) return;
    const fedAt = Date.now();
    this.seenFedAt = fedAt; // 내가 준 밥을 "남이 줬다"로 착각하지 않게 먼저 표시
    pendingFeeds.add(this.id);
    this.playFed(this.type.lines.fed);
    update(() => {
      state.pets[this.id] = { fedAt, fedBy: getNickname() || '누군가', meals: this.data.meals + 1 };
    });
  }

  // 냠냠 → 배불러
  playFed(line) {
    runPetEvent([this], async () => {
      this.body.classList.remove('face-left');
      const food = el('span', 'pet-food', '🍙');
      this.el.append(food);
      this.body.classList.add('eating');
      this.showBubble('냠냠…', 'eating');
      await wait(1800);

      food.remove();
      this.body.classList.remove('eating');
      this.body.classList.add('full');
      this.showBubble(line, 'full');
      this.spawn(['💕', '💖', '✨', '🌸'], 12);
      await wait(3600);
    });
  }

  // 화면을 다시 그릴 때마다 배고픔 상태를 반영한다
  update() {
    const { fedAt, fedBy } = this.data;
    if (fedAt > this.seenFedAt) {
      this.seenFedAt = fedAt;
      // 방금 다른 사람이 밥을 줬으면 같이 기뻐한다
      if (!this.busy && Date.now() - fedAt < 30000) {
        this.playFed(`${fedBy || '누군가'}가 밥 줬어! 💕`);
        return;
      }
    }
    if (this.busy) return;
    const hungry = this.hungry();
    this.body.classList.toggle('hungry', hungry);
    if (hungry) this.showBubble(this.type.lines.hungry, 'hungry');
    else if (Date.now() >= this.sayUntil) this.hideBubble();
  }

  // 쓰다듬으면 하트 하나 뿅
  pat() {
    if (this.busy) return;
    this.spawn(['💗'], 1);
    if (!this.hungry()) {
      this.freeze();
      this.play('hop', 900);
    }
  }

  /* --- 낮잠 --- */

  async sleep() {
    this.showBubble(this.type.lines.sleepy, 'say');
    await this.walk(doorX(), 55);
    this.hideBubble();

    // 문으로 쏙 들어간다
    this.body.classList.add('entering');
    await wait(700);
    this.el.classList.add('inside');
    this.body.classList.remove('entering');
    sleepers.add(this.id);
    houseEl.classList.add('sleeping');

    await wait(SLEEP_MS);

    // 기지개 켜며 나온다
    sleepers.delete(this.id);
    houseEl.classList.toggle('sleeping', sleepers.size > 0);
    this.el.classList.remove('inside');
    this.body.classList.add('exiting');
    await wait(700);
    this.body.classList.remove('exiting');
    this.showBubble(this.type.lines.wake, 'say');
    await this.playOnce('stretch', 1300);
    this.hideBubble();
    await this.walk(Math.random() * petMaxX(), 60);
  }

  // 눈 오는 날엔 눈사람 옆에서 토닥토닥
  async buildSnowman() {
    await this.walk(50, 70);
    this.body.classList.add('face-left');
    this.say(this.type.lines.snow, 2400);
    await this.playOnce('dance', 1600);
    const snowman = $('snowman');
    snowman.classList.add('grow');
    setTimeout(() => snowman.classList.remove('grow'), 600);
  }
}

// 펫 이벤트(밥·낮잠·같이 놀기)를 실행한다. 도중에 에러가 나도 펫이 멈춘 채로 남지 않게 정리한다
async function runPetEvent(group, event) {
  group.forEach((p) => {
    p.busy = true;
    p.freeze();
    p.hideBubble();
    p.body.classList.remove('hungry');
  });
  try {
    await event();
  } catch (e) {
    console.warn('펫 이벤트 중 오류', e);
  } finally {
    group.forEach((p) => {
      p.el.classList.remove('inside');
      p.body.classList.remove('entering', 'exiting', 'eating', 'full', ...PET_MOTIONS);
      p.el.querySelector('.pet-food')?.remove();
      sleepers.delete(p.id);
      p.hideBubble();
      p.busy = false;
      p.update();
      p.schedule(petRest());
    });
    houseEl.classList.toggle('sleeping', sleepers.size > 0);
  }
}

async function bothPlay(group, className, ms) {
  group.forEach((p) => p.body.classList.add(className));
  await wait(ms);
  group.forEach((p) => p.body.classList.remove(className));
}

// a가 b에게 놀러 가서 같이 논다
async function playTogether(a, b) {
  const side = b.x > PET_SIZE ? -1 : 1;
  const spot = Math.min(Math.max(b.x + side * (PET_SIZE - 16), 0), petMaxX());
  a.say(a.type.lines.play, 1800);
  await a.walk(spot, 80, 'hopping');

  a.body.classList.toggle('face-left', b.x < a.x);
  b.body.classList.toggle('face-left', a.x < b.x);
  b.say(b.type.lines.play, 1800);
  await bothPlay([a, b], 'hop', 900);
  a.spawn(['💕', '✨', '🎵'], 6);
  await bothPlay([a, b], 'dance', 1600);
  await a.playOnce('spin', 900);
  await b.playOnce('spin', 900);
  b.spawn(['💕', '💖', '🌸'], 8);
}

// 탭을 보고 있을 때만, 차례가 된 낮잠과 같이 놀기를 시작한다
function petRoutine() {
  if (document.hidden) return;
  const now = Date.now();
  pets.forEach((p) => {
    if (p.busy || now < p.nextSleepAt) return;
    p.nextSleepAt = Infinity;
    runPetEvent([p], () => p.sleep()).then(() => { p.nextSleepAt = Date.now() + SLEEP_EVERY_MS; });
  });

  if (now < nextPlayAt) return;
  const free = pets.filter((p) => !p.busy && !p.hungry());
  if (free.length < 2) return;
  nextPlayAt = Infinity;
  const a = pick(free);
  const b = pick(free.filter((p) => p !== a));
  runPetEvent([a, b], () => playTogether(a, b)).then(() => { nextPlayAt = Date.now() + playGap(); });
}

function updatePet() {
  pets.forEach((p) => p.update());
  const meals = PET_IDS.reduce((sum, id) => sum + state.pets[id].meals, 0);
  $('pet-meals').textContent = meals ? `🍙 ${meals}` : '';
}

function initPets() {
  PET_IDS.forEach((id) => pets.push(new Pet(id)));
  updatePet();
  pets.forEach((p) => p.schedule(Math.random() * 600));
}

// 자는 동안 집을 누르면
houseEl.addEventListener('click', () => {
  if (!houseEl.classList.contains('sleeping') || houseEl.querySelector('.house-talk')) return;
  const talk = el('span', 'house-talk', pick(['쿨쿨…', '음냐음냐…', '깨우지 마…']));
  houseEl.append(talk);
  setTimeout(() => talk.remove(), 1600);
});

window.addEventListener('resize', () => {
  pets.forEach((p) => { if (!p.busy && p.x > petMaxX()) p.setX(petMaxX()); });
});

/* ---------- 펫: 날씨 (서울 실제 날씨, ?weather=rain|snow|clear|cloudy 로 미리보기) ---------- */

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=weather_code&timezone=Asia%2FSeoul';
const WEATHER_REFRESH_MS = 30 * 60 * 1000;
const WEATHERS = ['clear', 'cloudy', 'rain', 'snow'];
let weather = 'clear';

// Open-Meteo 날씨 코드 → 놀이터 날씨
function weatherFromCode(code) {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if (code >= 2) return 'cloudy';
  return 'clear';
}

function applyWeather(kind) {
  weather = kind;
  yardEl.dataset.weather = kind;

  const layer = $('weather-layer');
  layer.replaceChildren();
  if (reduceMotion.matches) return;
  if (kind === 'rain' || kind === 'snow') {
    const rain = kind === 'rain';
    for (let i = 0; i < (rain ? 60 : 40); i++) {
      const drop = el('span', rain ? 'raindrop' : 'snowflake', rain ? '' : pick(['❄', '❅', '•']));
      drop.style.left = `${Math.random() * 100}%`;
      drop.style.animationDuration = `${rain ? 0.6 + Math.random() * 0.4 : 3 + Math.random() * 3}s`;
      drop.style.animationDelay = `${-Math.random() * 6}s`;
      layer.append(drop);
    }
  } else if (kind === 'clear') {
    layer.append(el('span', 'sun', '☀️'));
  } else {
    layer.append(el('span', 'cloud', '☁️'), el('span', 'cloud small', '☁️'));
  }
}

async function loadWeather() {
  const preview = new URLSearchParams(location.search).get('weather');
  if (WEATHERS.includes(preview)) {
    applyWeather(preview);
    return;
  }
  try {
    const res = await fetch(WEATHER_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { current } = await res.json();
    applyWeather(weatherFromCode(current.weather_code));
  } catch (e) {
    console.warn('날씨를 불러오지 못했습니다.', e);
    if (!yardEl.dataset.weather) applyWeather('clear');
  }
}

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

async function api(method, body, path = '/api/board') {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(path, {
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

// 서버 상태로 바꾸되, 아직 저장이 확인되지 않은 내 댓글은 다시 붙인다
function applyRemote(remote) {
  const next = normalize(remote.data) || defaultState();
  const commentsMerged = mergePendingComments(next);
  // 내가 준 밥이 아직 저장되지 않았다면 그 기록을 유지한다
  let feedMerged = false;
  pendingFeeds.forEach((id) => {
    if (state.pets[id].fedAt > next.pets[id].fedAt) {
      next.pets[id] = state.pets[id];
      feedMerged = true;
    }
  });
  const merged = commentsMerged || feedMerged;
  state = next;
  version = remote.version;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (dialog.open) renderComments();
  return merged;
}

function mergePendingComments(next) {
  const nextCards = new Map(next.columns.flatMap((c) => c.cards).map((c) => [c.id, c]));
  let merged = false;
  for (const card of state.columns.flatMap((c) => c.cards)) {
    for (const comment of card.comments) {
      if (!pendingComments.has(comment.id)) continue;
      const target = nextCards.get(card.id);
      if (!target) {
        pendingComments.delete(comment.id); // 다른 사람이 카드를 지웠다
      } else if (!target.comments.some((m) => m.id === comment.id)) {
        target.comments.push(comment);
        target.comments.sort((a, b) => a.at - b.at);
        merged = true;
      }
    }
  }
  return merged;
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
  const sentComments = [...pendingComments];
  const sentFeeds = [...pendingFeeds];
  try {
    const res = await api('PUT', JSON.stringify({ data: state, version }));
    if (res.status === 409) {
      dirty = false;
      if (applyRemote(await res.json())) {
        scheduleSync();
        showToast('최신 내용으로 바꾸고, 내 댓글·밥 준 기록은 다시 저장할게요');
      } else {
        showToast('다른 사람이 먼저 수정해서 최신 내용으로 바꿨어요');
      }
    } else if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    } else {
      version = (await res.json()).version;
      sentComments.forEach((id) => pendingComments.delete(id));
      sentFeeds.forEach((id) => pendingFeeds.delete(id));
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
    if (remote.version !== version && !isBusy() && applyRemote(remote)) scheduleSync();
    setSync('saved');
  } catch (e) {
    console.warn('불러오기 실패', e);
    setSync('offline');
  }
}

render();
renderNickname();
if (!getNickname()) openNickDialog();
initPets();
setInterval(updatePet, 10000);
setInterval(petRoutine, 3000);
loadWeather();
setInterval(loadWeather, WEATHER_REFRESH_MS);
setSync('loading');
pull().then(() => {
  heartbeat();
  initAdmin();
});
setInterval(pull, POLL_MS);
setInterval(heartbeat, HEARTBEAT_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  pull();
  heartbeat();
});
