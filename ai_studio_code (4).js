/* -------------------- UPDATED GAME CORE -------------------- */
const Game = (() => {
  let state = null;

  function newGame(opts) {
    const { size, sequence, mode, difficulty, photoURL } = opts;
    const seq = mode === 'Photo' ? 'Classic' : sequence;
    const { board: solved, order } = buildSolved(size, seq);
    const board = solved.slice();
    const blank = shuffle(board, size, DIFF_SHUFFLE[difficulty] || 100);
    state = {
      size, sequence: seq, mode, difficulty, photoURL: photoURL || null,
      board, blank, solved, order,
      moves: 0, startedAt: 0, elapsed: 0, finished: false,
      undoStack: [], redoStack: [], hintsUsed: 0,
    };
    return state;
  }

  function fromSaved(saved) { state = saved; return state; }
  function get() { return state; }

  // NEW: Helper to find tiles that will move when a specific tile is clicked/dragged
  function getPath(tileIdx) {
    if (state.blank === tileIdx) return [];
    const n = state.size;
    const r1 = Math.floor(tileIdx / n), c1 = tileIdx % n;
    const r0 = Math.floor(state.blank / n), c0 = state.blank % n;
    if (r1 !== r0 && c1 !== c0) return [];

    const path = [];
    if (r1 === r0) { // Same row
      const step = c1 < c0 ? 1 : -1;
      for (let c = c1; c !== c0; c += step) path.push(r1 * n + c);
    } else { // Same column
      const step = r1 < r0 ? 1 : -1;
      for (let r = r1; r !== r0; r += step) path.push(r * n + c1);
    }
    return path;
  }

  function shuffle(board, n, steps) {
    let blank = board.indexOf(0);
    let lastMove = -1;
    for (let i = 0; i < steps; i++) {
      const opts = neighbors(blank, n).filter(p => p !== lastMove);
      const pick = opts[Math.floor(Math.random() * opts.length)];
      board[blank] = board[pick]; board[pick] = 0;
      lastMove = blank; blank = pick;
    }
    if (board.every((v, i) => v === 0 || v === i + 1) && board[n*n-1] === 0) return shuffle(board, n, steps);
    return blank;
  }

  function neighbors(idx, n) {
    const r = Math.floor(idx / n), c = idx % n;
    const out = [];
    if (r > 0) out.push(idx - n);
    if (r < n - 1) out.push(idx + n);
    if (c > 0) out.push(idx - 1);
    if (c < n - 1) out.push(idx + 1);
    return out;
  }

  function slideToward(tileIdx) {
    const { board, size: n, blank } = state;
    const path = getPath(tileIdx);
    if (path.length === 0) return null;

    const r1 = Math.floor(tileIdx / n), c1 = tileIdx % n;
    const r0 = Math.floor(blank / n),   c0 = blank % n;

    const moves = [];
    if (r1 === r0) {
      const step = c1 < c0 ? -1 : 1;
      for (let c = c0 + step; c !== c1 + step; c += step) {
        const from = r0 * n + c, to = from - step;
        board[to] = board[from]; board[from] = 0;
        moves.push({ from, to });
      }
    } else {
      const step = r1 < r0 ? -1 : 1;
      for (let r = r0 + step; r !== r1 + step; r += step) {
        const from = r * n + c1, to = from - step * n;
        board[to] = board[from]; board[from] = 0;
        moves.push({ from, to });
      }
    }
    state.blank = tileIdx;
    state.moves += 1;
    state.undoStack.push({ tileIdx: blank });
    state.redoStack.length = 0;
    if (!state.startedAt) state.startedAt = Date.now() - state.elapsed;
    return moves;
  }

  function undo() {
    const m = state.undoStack.pop();
    if (!m) return null;
    const oldBlank = state.blank;
    const before = state.undoStack.length;
    const moves = slideToward(m.tileIdx);
    if (moves) {
      state.undoStack.length = before; 
      state.redoStack.push({ tileIdx: oldBlank });
      state.moves -= 2; 
    }
    return moves;
  }

  function redo() {
    const m = state.redoStack.pop();
    if (!m) return null;
    const oldBlank = state.blank;
    const before = state.undoStack.length;
    const moves = slideToward(m.tileIdx);
    if (moves) {
      state.undoStack.length = before;
      state.undoStack.push({ tileIdx: oldBlank });
      state.moves -= 1;
    }
    return moves;
  }

  function isSolved() {
    const { board, solved } = state;
    for (let i = 0; i < board.length; i++) if (board[i] !== solved[i]) return false;
    return true;
  }

  function hint() {
    const { board, solved, blank, size: n } = state;
    const r0 = Math.floor(blank / n), c0 = blank % n;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < board.length; i++) {
      if (i === blank || board[i] === 0) continue;
      const r = Math.floor(i / n), c = i % n;
      if (r !== r0 && c !== c0) continue;
      const dist = (idx, val) => {
        const target = solved.indexOf(val);
        return Math.abs(idx % n - target % n) + Math.abs(Math.floor(idx / n) - Math.floor(target / n));
      };
      const before = dist(i, board[i]);
      const after  = dist(blank, board[i]);
      const score = before - after;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    state.hintsUsed++;
    return best;
  }

  return { newGame, fromSaved, get, slideToward, undo, redo, isSolved, hint, neighbors, getPath };
})();

/* -------------------- PREMIUM SLIDING UI -------------------- */
const UI = (() => {
  const $ = sel => document.querySelector(sel);
  const screens = { home: $('#screen-home'), game: $('#screen-game'), result: $('#screen-result') };
  const boardEl = $('#board');
  const previewEl = $('#preview-board');
  const hudMoves = $('#hud-moves');
  const hudTime  = $('#hud-time');

  let sIdx = { size: 0, sequence: 0, mode: 0, difficulty: 1 };
  let photoDataURL = null;
  let presetIndex = 0;
  let timerInt = null;
  let paused = false;

  // Interaction State for Sliding Engine
  let drag = {
    active: false,
    path: [],
    axis: null, // 'x' or 'y'
    dir: 0,     // 1 or -1
    startTime: 0,
    startX: 0, startY: 0,
    maxDist: 0,
    currentDelta: 0,
    cell: 0
  };

  function showScreen(name) {
    for (const k of Object.keys(screens)) screens[k].classList.toggle('active', k === name);
  }

  function syncPickers() {
    const s = Storage.get().settings;
    sIdx.size = Math.max(0, SIZES.indexOf(s.size));
    sIdx.sequence = Math.max(0, SEQUENCES.indexOf(s.sequence));
    sIdx.mode = Math.max(0, MODES.indexOf(s.mode));
    sIdx.difficulty = Math.max(0, DIFFS.indexOf(s.difficulty));
    renderPickers();
  }

  function renderPickers() {
    const n = SIZES[sIdx.size];
    $('#picker-size').textContent = `${n} × ${n}`;
    const seqList = MODES[sIdx.mode] === 'Photo' ? PHOTO_SEQ : SEQUENCES;
    if (!seqList.includes(SEQUENCES[sIdx.sequence])) sIdx.sequence = 0;
    $('#picker-sequence').textContent = seqList[sIdx.sequence] || 'Classic';
    $('#picker-mode').textContent = MODES[sIdx.mode];
    $('#picker-difficulty').textContent = DIFFS[sIdx.difficulty];
    $('#photo-upload-row').classList.toggle('hidden', MODES[sIdx.mode] !== 'Photo');
    persistSettings();
    renderPreview();
  }

  function persistSettings() {
    const s = Storage.get().settings;
    s.size = SIZES[sIdx.size];
    s.sequence = (MODES[sIdx.mode] === 'Photo' ? PHOTO_SEQ : SEQUENCES)[sIdx.sequence] || 'Classic';
    s.mode = MODES[sIdx.mode];
    s.difficulty = DIFFS[sIdx.difficulty];
    Storage.save();
  }

  function renderPreview() {
    const n = SIZES[sIdx.size];
    previewEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    const seq = MODES[sIdx.mode] === 'Photo' ? 'Classic' : SEQUENCES[sIdx.sequence];
    const { board } = buildSolved(n, seq);
    previewEl.innerHTML = '';
    
    board.forEach((val, i) => {
      const t = document.createElement('div');
      t.className = 'preview-tile';
      if (val === 0) { t.classList.add('blank'); }
      else if (MODES[sIdx.mode] === 'Photo') {
        t.classList.add('photo');
        const homeIdx = val - 1;
        const hr = Math.floor(homeIdx / n), hc = homeIdx % n;
        const url = photoDataURL || PHOTO_PRESETS[presetIndex];
        t.style.backgroundImage = `url(${url})`;
        t.style.backgroundSize = `${n * 100}% ${n * 100}%`;
        t.style.backgroundPosition = `${(hc / (n - 1)) * 100}% ${(hr / (n - 1)) * 100}%`;
      } else {
        t.textContent = val;
      }
      previewEl.appendChild(t);
    });
  }

  function renderBoard(animateAppear = true) {
    const st = Game.get();
    const n = st.size;
    boardEl.innerHTML = '';
    const rect = boardEl.getBoundingClientRect();
    const pad = 8;
    const cell = (rect.width - pad * 2) / n;
    
    st.board.forEach((val, i) => {
      if (val === 0) return;
      const t = document.createElement('div');
      t.className = 'tile' + (animateAppear ? ' appear' : '');
      t.dataset.val = val;
      t.dataset.pos = i; 
      
      t.style.width = `${cell - 6}px`;
      t.style.height = `${cell - 6}px`;
      t.style.fontSize = `${Math.max(14, cell * 0.35)}px`;
      t.style.position = 'absolute';
      t.style.willChange = 'transform';

      if (st.mode === 'Photo' && st.photoURL) {
        const homeIdx = val - 1;
        const hr = Math.floor(homeIdx / n), hc = homeIdx % n;
        t.classList.add('photo-tile');
        t.style.backgroundImage = `url(${st.photoURL})`;
        t.style.backgroundSize = `${n * (cell - 6)}px ${n * (cell - 6)}px`;
        t.style.backgroundPosition = `-${hc * (cell - 6)}px -${hr * (cell - 6)}px`;
        if (Storage.get().settings.photoNumbers) {
            const badge = document.createElement('div');
            badge.className = 'photo-number';
            badge.textContent = val;
            t.appendChild(badge);
        }
      } else {
        t.textContent = val;
      }
      
      placeTile(t, i, cell, pad, false);
      boardEl.appendChild(t);
    });
    updateHUD();
    updateControls();
  }

  function placeTile(t, idx, cell, pad, animate = true) {
    const n = Game.get().size;
    const r = Math.floor(idx / n), c = idx % n;
    const x = pad + c * cell + 3;
    const y = pad + r * cell + 3;

    t.style.transition = animate ? 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    t.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    t.dataset.bx = x; // Base X
    t.dataset.by = y; // Base Y
    t.dataset.pos = idx;
  }

  /* -------------------- THE SLIDING ENGINE -------------------- */
  function attachBoardSwipe() {
    boardEl.style.touchAction = 'none';

    boardEl.addEventListener('pointerdown', e => {
      if (paused || Game.get().finished) return;
      const tileEl = e.target.closest('.tile');
      if (!tileEl) return;

      const idx = Number(tileEl.dataset.pos);
      const path = Game.getPath(idx);
      if (path.length === 0) return;

      const st = Game.get();
      const rect = boardEl.getBoundingClientRect();
      const cell = (rect.width - 16) / st.size;

      drag.active = true;
      drag.path = path;
      drag.cell = cell;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startTime = performance.now();
      drag.maxDist = cell;
      
      const blank = st.blank;
      drag.axis = (Math.floor(idx / st.size) === Math.floor(blank / st.size)) ? 'x' : 'y';
      drag.dir = (idx < blank) ? 1 : -1;

      tileEl.setPointerCapture(e.pointerId);
    });

    boardEl.addEventListener('pointermove', e => {
      if (!drag.active) return;

      const delta = drag.axis === 'x' ? (e.clientX - drag.startX) : (e.clientY - drag.startY);
      let clamped = drag.dir === 1 ? Math.max(0, Math.min(delta, drag.maxDist)) : Math.min(0, Math.max(delta, -drag.maxDist));
      drag.currentDelta = clamped;

      drag.path.forEach(idx => {
        const el = boardEl.querySelector(`[data-pos="${idx}"]`);
        if (!el) return;
        const bx = parseFloat(el.dataset.bx);
        const by = parseFloat(el.dataset.by);
        const tx = drag.axis === 'x' ? bx + clamped : bx;
        const ty = drag.axis === 'y' ? by + clamped : by;
        el.style.transition = 'none';
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      });
    });

    boardEl.addEventListener('pointerup', e => {
      if (!drag.active) return;
      drag.active = false;

      const time = performance.now() - drag.startTime;
      const velocity = Math.abs(drag.currentDelta) / time;
      const isFlick = velocity > 0.4;
      const isHalfway = Math.abs(drag.currentDelta) > drag.maxDist * 0.4;

      if (isFlick || isHalfway) {
        handleTileClick(drag.path[0]); // Anchor tile
      } else {
        drag.path.forEach(idx => {
          const el = boardEl.querySelector(`[data-pos="${idx}"]`);
          if (el) placeTile(el, idx, drag.cell, 8, true);
        });
      }
    });
  }

  function handleTileClick(idx) {
    if (paused || Game.get().finished) return;
    const moves = Game.slideToward(idx);
    if (!moves) { Sound.err(); return; }
    
    Sound.move(); 
    vibrate(8);
    renderBoard(false);
    
    saveProgress();
    if (Game.isSolved()) onWin();
  }

  /* -------------------- STATS & HELPERS -------------------- */
  function updateHUD() {
    const st = Game.get();
    hudMoves.textContent = st.moves;
    hudTime.textContent = formatTime(currentElapsed());
  }

  function currentElapsed() {
    const st = Game.get();
    if (!st.startedAt) return st.elapsed || 0;
    if (paused || st.finished) return st.elapsed;
    return Date.now() - st.startedAt;
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }

  function tickTimer() {
    clearInterval(timerInt);
    timerInt = setInterval(() => {
        if (paused || Game.get().finished) return;
        hudTime.textContent = formatTime(currentElapsed());
    }, 500);
  }

  function updateControls() {
    const st = Game.get();
    $('#btn-undo').disabled = !st.undoStack.length;
    $('#btn-redo').disabled = !st.redoStack.length;
  }

  function saveProgress() {
    const st = Game.get();
    if (!st || st.finished) { Storage.get().last = null; Storage.save(); return; }
    st.elapsed = currentElapsed();
    Storage.get().last = { ...st, undoStack: st.undoStack.slice(-50), redoStack: [] };
    Storage.save();
  }

  function onWin() {
    const st = Game.get();
    st.finished = true;
    st.elapsed = currentElapsed();
    Storage.get().last = null;
    Sound.win(); vibrate([10,30,10,30,40]);
    boardEl.classList.add('win-zoom');

    const stats = Storage.get().stats;
    stats.totalGames++; stats.totalWins++;
    stats.totalTime += st.elapsed; stats.totalMoves += st.moves;
    stats.currentStreak++; stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    if (!stats.fastest || st.elapsed < stats.fastest) stats.fastest = st.elapsed;
    if (!stats.leastMoves || st.moves < stats.leastMoves) stats.leastMoves = st.moves;
    stats.bySize[st.size] = (stats.bySize[st.size] || 0) + 1;
    stats.byMode[st.mode] = (stats.byMode[st.mode] || 0) + 1;
    stats.history.unshift({ size: st.size, sequence: st.sequence, mode: st.mode, moves: st.moves, time: st.elapsed, at: Date.now() });
    stats.history = stats.history.slice(0, 25);

    const hsKey = `${st.size}-${st.sequence}-${st.mode}`;
    const prev  = Storage.get().highs[hsKey];
    const score = { moves: st.moves, time: st.elapsed, at: Date.now() };
    const isRecord = !prev || score.time < prev.time;
    if (isRecord) Storage.get().highs[hsKey] = score;

    checkAchievements(st);
    Storage.save();
    setTimeout(() => showResult(st, isRecord, prev), 700);
  }

  function showResult(st, isRecord, prev) {
    $('#res-moves').textContent = st.moves;
    $('#res-time').textContent = formatTime(st.elapsed);
    $('#res-board').textContent = `${st.size}×${st.size}`;
    $('#res-sequence').textContent = st.sequence;
    $('#res-mode').textContent = st.mode;
    $('#res-record').textContent = prev ? `${prev.moves} / ${formatTime(prev.time)}` : 'First!';
    
    let stars = 5;
    if(st.elapsed > 60000) stars--;
    if(st.elapsed > 180000) stars--;
    if(st.moves > 100) stars--;
    $('#result-rating').textContent = '★'.repeat(Math.max(1, stars)) + '☆'.repeat(Math.max(0, 5-stars));
    
    $('#new-record-badge').classList.toggle('hidden', !isRecord);
    showScreen('result');
    FX.start();
    setTimeout(() => boardEl.classList.remove('win-zoom'), 1200);
  }

  function checkAchievements(st) {
    const a = Storage.get().achievements;
    ACHIEVEMENTS.forEach(x => {
      if (!a[x.id] && x.check(st)) {
        a[x.id] = { unlockedAt: Date.now() };
        toast(`🏅 Achievement: ${x.label}`);
      }
    });
  }

  function renderDashboard() {
    const d = Storage.get();
    const s = d.stats;
    const winRate = s.totalGames ? Math.round((s.totalWins / s.totalGames) * 100) : 0;

    $('#dashboard-body').innerHTML = `
      <div class="stat-card"><h3>Overview</h3>
        <div class="stat-grid">
          <div><span>Total Wins</span><strong>${s.totalWins}</strong></div>
          <div><span>Win Rate</span><strong>${winRate}%</strong></div>
          <div><span>Avg Time</span><strong>${s.totalWins ? formatTime(s.totalTime/s.totalWins) : '--'}</strong></div>
          <div><span>Streak</span><strong>${s.currentStreak}</strong></div>
        </div>
      </div>
    `;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    $('#toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function confirm({ title, message, okText = 'Confirm' }) {
    return new Promise(resolve => {
      const dlg = $('#confirm-dialog');
      $('#confirm-title').textContent = title;
      $('#confirm-message').textContent = message;
      $('#confirm-ok').textContent = okText;
      dlg.classList.remove('hidden');
      const cleanup = (v) => { dlg.classList.add('hidden'); resolve(v); };
      $('#confirm-ok').onclick = () => cleanup(true);
      $('#confirm-cancel').onclick = () => cleanup(false);
    });
  }

  function loadPhotoFile(file) {
    if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = e => optimizeImage(e.target.result).then(url => {
      photoDataURL = url;
      $('#photo-dropzone').style.backgroundImage = `url(${url})`;
      renderPreview();
    });
    reader.readAsDataURL(file);
  }

  function optimizeImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const size = 512;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.src = src;
    });
  }

  function attachKeys() {
    document.addEventListener('keydown', e => {
      if (!screens.game.classList.contains('active')) return;
      const st = Game.get(), n = st.size, b = st.blank;
      let target = null;
      if (e.key === 'ArrowUp') target = b + n;
      else if (e.key === 'ArrowDown') target = b - n;
      else if (e.key === 'ArrowLeft') target = b + 1;
      else if (e.key === 'ArrowRight') target = b - 1;
      if (target !== null && target >= 0 && target < n*n) handleTileClick(target);
    });
  }

  function openPanel(id) {
    document.getElementById(id).classList.add('open');
    $('#panel-backdrop').classList.add('show');
  }

  function closePanels() {
    document.querySelectorAll('.side-panel.open').forEach(p => p.classList.remove('open'));
    $('#panel-backdrop').classList.remove('show');
  }

  function startGame() {
    const s = Storage.get().settings;
    Game.newGame({
      size: s.size, sequence: s.sequence, mode: s.mode, difficulty: s.difficulty,
      photoURL: s.mode === 'Photo' ? (photoDataURL || PHOTO_PRESETS[presetIndex]) : null
    });
    paused = false;
    showScreen('game');
    setTimeout(() => { renderBoard(true); tickTimer(); }, 60);
  }

  function init() {
    /* Event Listeners */
    document.querySelectorAll('.picker-arrow').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.picker;
        const dir = Number(btn.dataset.dir);
        const list = which === 'size' ? SIZES : which === 'sequence' ? (MODES[sIdx.mode] === 'Photo' ? PHOTO_SEQ : SEQUENCES) : which === 'mode' ? MODES : DIFFS;
        sIdx[which] = (sIdx[which] + dir + list.length) % list.length;
        Sound.click();
        renderPickers();
      });
    });

    $('#preset-prev').onclick = () => { presetIndex = (presetIndex-1+PHOTO_PRESETS.length)%PHOTO_PRESETS.length; photoDataURL=null; renderPreview(); };
    $('#preset-next').onclick = () => { presetIndex = (presetIndex+1)%PHOTO_PRESETS.length; photoDataURL=null; renderPreview(); };

    $('#btn-play').onclick = () => { Sound.click(); startGame(); };
    $('#btn-continue').onclick = () => {
        const last = Storage.get().last;
        if (!last) return;
        Game.fromSaved(last);
        paused = false; showScreen('game');
        setTimeout(() => { renderBoard(false); tickTimer(); }, 60);
    };

    $('#btn-back-home').onclick = async () => {
      if (Game.get() && !Game.get().finished && Game.get().moves > 0) {
        const ok = await confirm({ title: 'Leave?', message: 'Progress is saved.' });
        if (!ok) return;
      }
      saveProgress(); clearInterval(timerInt); showScreen('home'); refreshContinue();
    };

    $('#btn-undo').onclick = () => { const m = Game.undo(); if(m) { renderBoard(false); updateHUD(); updateControls(); }};
    $('#btn-redo').onclick = () => { const m = Game.redo(); if(m) { renderBoard(false); updateHUD(); updateControls(); }};
    $('#btn-pause').onclick = () => { paused = true; $('#pause-overlay').classList.remove('hidden'); };
    $('#btn-resume').onclick = () => { paused = false; $('#pause-overlay').classList.add('hidden'); };

    attachBoardSwipe(); attachKeys();
    syncPickers(); refreshContinue();
    FX.init($('#fx-canvas'));
    
    setTimeout(() => {
        $('#loading-screen').classList.add('hidden');
        $('#app').classList.remove('hidden');
        showScreen('home');
    }, 400);
  }

  function refreshContinue() {
    const btn = $('#btn-continue');
    btn.hidden = !Storage.get().last;
  }

  return { init };
})();

function buildSolved(n, seq) {
  const order = SequenceGen[seq](n);
  const board = Array(n * n).fill(0);
  for (let i = 0; i < order.length - 1; i++) board[order[i]] = i + 1;
  return { board, order };
}

document.addEventListener('DOMContentLoaded', UI.init);