window.onerror = function(msg, src, line) {
  console.log("JS ERROR:", msg, line);
};
/* =============================================================
   Number Puzzle Pro
   Pure vanilla JS sliding-puzzle game.
   Modules (IIFE compartments):
     Storage  – localStorage persistence
     Sound    – local click / win sounds
     FX       – confetti + fireworks on canvas
     Sequence – goal-order generators
     Game     – core puzzle model
     UI       – screen routing, rendering
   ============================================================= */
(() => {
'use strict';

/* -------------------- CONSTANTS -------------------- */
const SIZES        = [3, 4, 5, 6, 7];               // extendable
const SEQUENCES    = ['Classic', 'Upside Down', 'Spiral', 'Snake'];
const PHOTO_SEQ    = ['Classic'];
const MODES = ['Number', 'Photo'];

const PHOTO_PRESETS = [
    'assets/images/preset-1.jpg',
    'assets/images/preset-2.jpg',
    'assets/images/preset-3.jpg',
    'assets/images/preset-4.jpg'
];
const DIFFS        = ['Easy', 'Medium', 'Hard'];
const DIFF_SHUFFLE = { Easy: 30, Medium: 120, Hard: 300 };
const STORAGE_KEY  = 'npp.v1';

/* -------------------- STORAGE -------------------- */
const Storage = (() => {
  const DEFAULT = {
    settings:{
    size:3,
    sequence:'Classic',
    mode:'Number',
    difficulty:'Medium',
    sound:true,
    vibration:true,
    theme:'dark',
    volume:0.7,

    photoNumbers:true
},
   { size: 3, sequence: 'Classic', mode: 'Number', difficulty: 'Medium',
                sound: true, vibration: true, theme: 'dark', volume: 0.7 },
    last:     null,                 // last-saved in-progress game
    highs:    {},                   // key `${size}-${seq}-${mode}` -> {moves,time}
    stats: {
      totalGames:0, totalWins:0, totalTime:0, totalMoves:0,
      fastest:null, leastMoves:null, longestStreak:0, currentStreak:0,
      bySize:{}, byMode:{}, history:[]
    },
    achievements: {},
  };
  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT);
      const parsed = JSON.parse(raw);
      return deepMerge(structuredClone(DEFAULT), parsed);
    } catch (e) {
      console.warn('Corrupted save, resetting.', e);
      return structuredClone(DEFAULT);
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { console.warn('Save failed', e); }
  }
  function deepMerge(target, src) {
    for (const k of Object.keys(src || {})) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
        target[k] = deepMerge(target[k] || {}, src[k]);
      } else if (src[k] !== undefined) target[k] = src[k];
    }
    return target;
  }
  return {
    get: () => data,
    save,
    reset() { data = structuredClone(DEFAULT); save(); },
    exportJSON() { return JSON.stringify(data, null, 2); },
    importJSON(json) {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid file');
      data = deepMerge(structuredClone(DEFAULT), parsed);
      save();
    },
  };
})();

/* -------------------- SOUND -------------------- */
/* ----------------- SOUND (CUSTOM AUDIO FILES) ----------------- */
const Sound = (() => {
    // 1. Apni niji audio files ka path yahan set karein
    const sounds = {
        move: new Audio('assets/sound/move.wav'),
        click: new Audio('assets/sound/click.wav'),
        win: new Audio('assets/sound/win.wav'),
        err: new Audio('assets/sound/error.wav')
    };

    // 2. Sound play karne ka helper function (Settings aur Volume ke sath)
    function playFile(audioObject) {
        const s = Storage.get().settings;
        
        // Agar player ne game settings mein sound OFF ki hai toh nahi bajega
        if (!s.sound) return; 

        // Game ke main volume slider se audio volume match karna
        audioObject.volume = s.volume ?? 0.7; 

        // Audio ko shuruat se reset karna (taaki lagatar fast click par bhi sound aaye)
        audioObject.currentTime = 0; 
        
        // Sound play karna
        audioObject.play().catch(error => {
            console.log("Browser ne audio block kiya jab tak screen par click na ho:", error);
        });
    }

    // 3. Game ke purane functions ko naye files se jodna
    return {
        move: () => playFile(sounds.move),
        click: () => playFile(sounds.click),
        win:  () => playFile(sounds.win),
        err:  () => playFile(sounds.err)
    };
})();

function vibrate(ms = 12) {
  if (Storage.get().settings.vibration && navigator.vibrate) navigator.vibrate(ms);
}

/* -------------------- SEQUENCE GENERATORS --------------------
   Each returns an array of length N*N whose values are the cell
   indices in visit order. Tile 1 goes at order[0], tile 2 at
   order[1], …, and the blank goes at order[N*N - 1].
   The "goal layout" is therefore a permutation of the array
   [1..N*N-1, 0] placed into board positions.
------------------------------------------------------------- */
const SequenceGen = {
  Classic(n) {
    return Array.from({ length: n * n }, (_, i) => i);
  },
  'Upside Down'(n) {
    const arr = [];
    for (let r = n - 1; r >= 0; r--) for (let c = n - 1; c >= 0; c--) arr.push(r * n + c);
    return arr;
  },
  Snake(n) {
    const arr = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(r * n + c);
      if (r % 2 === 1) row.reverse();
      arr.push(...row);
    }
    return arr;
  },
  Spiral(n) {
    const grid = Array.from({ length: n }, () => Array(n).fill(-1));
    const arr = [];
    let r = 0, c = 0, dr = 0, dc = 1;
    for (let i = 0; i < n * n; i++) {
      arr.push(r * n + c);
      grid[r][c] = 1;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n || grid[nr][nc] !== -1) {
        [dr, dc] = [dc, -dr];
      }
      r += dr; c += dc;
    }
    return arr;
  },
};

/* Build solved board (array length n*n where index = position, value = tile id, 0 = blank) */
function buildSolved(n, seqName) {
  const order = SequenceGen[seqName](n);
  const board = Array(n * n).fill(0);
  for (let i = 0; i < order.length - 1; i++) board[order[i]] = i + 1;
  board[order[order.length - 1]] = 0;
  return { board, order };
}

/* -------------------- GAME CORE -------------------- */
const Game = (() => {
  let state = null;

  function newGame(opts) {
    const { size, sequence, mode, difficulty, photoURL } = opts;
    // Photo mode is always Classic (tiles must reassemble image)
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

  /* Guaranteed solvable: shuffle by performing random valid moves from solved state */
  function shuffle(board, n, steps) {
    let blank = board.indexOf(0);
    let lastMove = -1;
    for (let i = 0; i < steps; i++) {
      const opts = neighbors(blank, n).filter(p => p !== lastMove);
      const pick = opts[Math.floor(Math.random() * opts.length)];
      board[blank] = board[pick]; board[pick] = 0;
      lastMove = blank; blank = pick;
    }
    // ensure not already solved
    if (board.every((v, i) => v === 0 || v === i + 1) && board[n*n-1] === 0) {
      return shuffle(board, n, steps);
    }
    return blank;
  }

  function neighbors(idx, n) {
    const r = Math.floor(idx / n), c = idx % n;
    const out = [];
    if (r > 0)     out.push(idx - n);
    if (r < n - 1) out.push(idx + n);
    if (c > 0)     out.push(idx - 1);
    if (c < n - 1) out.push(idx + 1);
    return out;
  }

  /* Click tile at index — slide entire row/col toward blank.
     Returns array of {from,to} for animation, or null if invalid. */
  function slideToward(tileIdx) {
    const { board, size: n, blank } = state;
    if (tileIdx === blank) return null;
    const r1 = Math.floor(tileIdx / n), c1 = tileIdx % n;
    const r0 = Math.floor(blank / n),   c0 = blank % n;
    if (r1 !== r0 && c1 !== c0) return null;

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
    state.undoStack.push({ tileIdx: blank }); // reverse: slide toward original blank
    state.redoStack.length = 0;
    if (!state.startedAt) state.startedAt = Date.now() - state.elapsed;
    return moves;
  }

  function undo() {
    const m = state.undoStack.pop();
    if (!m) return null;
    const oldBlank = state.blank;
    const moves = slideTowardInternal(m.tileIdx);
    if (moves) {
      state.redoStack.push({ tileIdx: oldBlank });
      state.moves -= 2; // slideToward incremented; undo shouldn't count → subtract both
    }
    return moves;
  }
  function redo() {
    const m = state.redoStack.pop();
    if (!m) return null;
    const oldBlank = state.blank;
    const moves = slideTowardInternal(m.tileIdx);
    if (moves) {
      state.undoStack.push({ tileIdx: oldBlank });
      state.moves -= 1;
    }
    return moves;
  }
  function slideTowardInternal(tileIdx) {
    // identical to slideToward but no undo bookkeeping side effects
    const before = state.undoStack.length;
    const moves = slideToward(tileIdx);
    if (moves) state.undoStack.length = before; // strip auto-pushed entry
    return moves;
  }

  function isSolved() {
    const { board, solved } = state;
    for (let i = 0; i < board.length; i++) if (board[i] !== solved[i]) return false;
    return true;
  }

  /* Hint: find a tile that is misplaced and adjacent to blank in same row/col */
  function hint() {
    const { board, solved, blank, size: n } = state;
    const r0 = Math.floor(blank / n), c0 = blank % n;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < board.length; i++) {
      if (i === blank || board[i] === 0) continue;
      const r = Math.floor(i / n), c = i % n;
      if (r !== r0 && c !== c0) continue;
      // score: how much this slide reduces total misplacement
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

  return { newGame, fromSaved, get, slideToward, undo, redo, isSolved, hint, neighbors };
})();

/* -------------------- FX (confetti + fireworks) -------------------- */
const FX = (() => {
  let canvas, ctx, raf, parts = [], running = false;
  function init(c) {
    canvas = c; ctx = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
  }
  function spawnConfetti(n = 140) {
    const w = canvas.width, h = canvas.height;
    const colors = ['#d9a441','#f0c870','#fff','#c0392b','#2ecc71','#3498db','#e91e63'];
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * w, y: -20 * devicePixelRatio,
        vx: (Math.random() - 0.5) * 4 * devicePixelRatio,
        vy: (2 + Math.random() * 3) * devicePixelRatio,
        size: (4 + Math.random() * 6) * devicePixelRatio,
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
        kind: 'confetti', life: 1,
      });
    }
  }
  function spawnFirework() {
    const w = canvas.width, h = canvas.height;
    const cx = Math.random() * w, cy = h * (0.25 + Math.random() * 0.4);
    const hue = Math.floor(Math.random() * 360);
    for (let i = 0; i < 60; i++) {
      const a = (Math.PI * 2 * i) / 60;
      const sp = (1 + Math.random() * 2) * devicePixelRatio;
      parts.push({
        x: cx, y: cy, vx: Math.cos(a) * sp * 2, vy: Math.sin(a) * sp * 2,
        size: 3 * devicePixelRatio, color: `hsl(${hue},90%,60%)`,
        kind: 'spark', life: 1,
      });
    }
  }
  function loop() {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.kind === 'confetti') { p.vy += 0.08 * devicePixelRatio; p.rot += p.vr; }
      else { p.vy += 0.04 * devicePixelRatio; p.life -= 0.012; }
      if ((p.kind === 'spark' && p.life <= 0) || p.y > canvas.height + 40) {
        parts.splice(i, 1); continue;
      }
      ctx.globalAlpha = p.kind === 'spark' ? Math.max(p.life, 0) : 1;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true; resize(); parts = [];
    spawnConfetti(160);
    const fwTimer = setInterval(() => running ? spawnFirework() : clearInterval(fwTimer), 600);
    setTimeout(() => clearInterval(fwTimer), 4500);
    loop();
  }
  function stop() { running = false; cancelAnimationFrame(raf); ctx && ctx.clearRect(0,0,canvas.width,canvas.height); parts = []; }
  return { init, start, stop };
})();

/* -------------------- UI -------------------- */
const UI = (() => {
  /* DOM refs */
  const $ = sel => document.querySelector(sel);
  const screens = {
    home:   $('#screen-home'),
    game:   $('#screen-game'),
    result: $('#screen-result'),
  };
  const boardEl = $('#board');
  const previewEl = $('#preview-board');
  const hudMoves = $('#hud-moves');
  const hudTime  = $('#hud-time');

  /* local state */
  let sIdx = { size: 0, sequence: 0, mode: 0, difficulty: 1 };
  let photoDataURL = null;
let presetIndex = 0;
  let timerInt = null;
  let paused = false;

  /* ---------- screen routing ---------- */
  function showScreen(name) {
    for (const k of Object.keys(screens)) screens[k].classList.toggle('active', k === name);
  }

  /* ---------- pickers ---------- */
  function syncPickers() {
    const s = Storage.get().settings;
    sIdx.size       = Math.max(0, SIZES.indexOf(s.size));
    sIdx.sequence   = Math.max(0, SEQUENCES.indexOf(s.sequence));
    sIdx.mode       = Math.max(0, MODES.indexOf(s.mode));
    sIdx.difficulty = Math.max(0, DIFFS.indexOf(s.difficulty));
    renderPickers();
  }
  function renderPickers() {
    const n = SIZES[sIdx.size];
    $('#picker-size').textContent       = `${n} × ${n}`;
    const seqList = MODES[sIdx.mode] === 'Photo' ? PHOTO_SEQ : SEQUENCES;
    if (!seqList.includes(SEQUENCES[sIdx.sequence])) sIdx.sequence = 0;
    $('#picker-sequence').textContent   = seqList[sIdx.sequence] || 'Classic';
    $('#picker-mode').textContent       = MODES[sIdx.mode];
    $('#picker-difficulty').textContent = DIFFS[sIdx.difficulty];
    $('#photo-upload-row').classList.toggle('hidden', MODES[sIdx.mode] !== 'Photo');
    persistSettings();
    renderPreview();
  }
  function persistSettings() {
    const s = Storage.get().settings;
    s.size       = SIZES[sIdx.size];
    s.sequence   = (MODES[sIdx.mode] === 'Photo' ? PHOTO_SEQ : SEQUENCES)[sIdx.sequence] || 'Classic';
    s.mode       = MODES[sIdx.mode];
    s.difficulty = DIFFS[sIdx.difficulty];
    Storage.save();
  }
   function updatePresetPreview() {

    const img = $('#preset-image');

    if(photoDataURL){
        img.src = photoDataURL;
    }else{
        img.src = PHOTO_PRESETS[presetIndex];
    }

   }

  /* ---------- preview ---------- */
   renderPreview();
  updatePresetPreview();
    const n = SIZES[sIdx.size];
    previewEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    previewEl.style.gridTemplateRows    = `repeat(${n}, 1fr)`;
    const { order } = buildSolved(n, (MODES[sIdx.mode] === 'Photo' ? 'Classic' : SEQUENCES[sIdx.sequence]));
    const labels = Array(n*n).fill(0);
    for (let i = 0; i < order.length - 1; i++) labels[order[i]] = i + 1;
    previewEl.innerHTML = '';
    for (let i = 0; i < n * n; i++) {
      const t = document.createElement('div');
      t.className = 'preview-tile';
      if (labels[i] === 0) { t.classList.add('blank'); }
      else if (MODES[sIdx.mode] === 'Photo') {
        t.classList.add('photo');
        const r = Math.floor(i / n), c = i % n;
        renderPreview();
        t.style.backgroundSize  = `${n*100}% ${n*100}%`;
        t.style.backgroundPosition = `${(c/(n-1))*100}% ${(r/(n-1))*100}%`;
         if(Storage.get().settings.photoNumbers){

    const badge=document.createElement('div');

    badge.className='photo-number';

    badge.textContent=val;

    t.appendChild(badge);

         }
      } else {
        t.textContent = labels[i];
      }
      previewEl.appendChild(t);
    }
  }

  /* ---------- board render ---------- */
  function renderBoard(animateAppear = true) {
    const st = Game.get();
    const n = st.size;
    boardEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    boardEl.innerHTML = '';
    const rect = boardEl.getBoundingClientRect();
    const pad = 8;
    const cell = (rect.width - pad * 2) / n;
    for (let i = 0; i < st.board.length; i++) {
      const val = st.board[i];
      if (val === 0) continue;
      const t = document.createElement('div');
      t.className = 'tile' + (animateAppear ? ' appear' : '');
      t.dataset.val = val;
      t.style.width  = `${cell - 6}px`;
      t.style.height = `${cell - 6}px`;
      t.style.fontSize = `${Math.max(14, cell * 0.38)}px`;
      placeTile(t, i, cell, pad);
      if (st.mode === 'Photo' && st.photoURL) {
        // tile's "home" position in the image (val-1)
        const homeIdx = val - 1;
        const hr = Math.floor(homeIdx / n), hc = homeIdx % n;
        t.classList.add('photo-tile');
        t.style.backgroundImage = `url(${st.photoURL})`;
        t.style.backgroundSize  = `${n * (cell - 6)}px ${n * (cell - 6)}px`;
        t.style.backgroundPosition = `-${hc * (cell - 6)}px -${hr * (cell - 6)}px`;
      } else {
        t.textContent = val;
      }
      t.addEventListener('click', () => handleTileClick(i));
      boardEl.appendChild(t);
    }
    updateHUD();
    updateControls();
  }
  function placeTile(t, idx, cell, pad) {
    const n = Game.get().size;
    const r = Math.floor(idx / n), c = idx % n;
    t.style.left = `${pad + c * cell + 3}px`;
    t.style.top  = `${pad + r * cell + 3}px`;
    t.dataset.pos = idx;
  }

  function repositionAfterMoves(moves) {
    const st = Game.get();
    const n = st.size;
    const rect = boardEl.getBoundingClientRect();
    const pad = 8;
    const cell = (rect.width - pad * 2) / n;
    const tiles = boardEl.querySelectorAll('.tile');
    for (const m of moves) {
      const tile = [...tiles].find(t => Number(t.dataset.pos) === m.from);
      if (tile) placeTile(tile, m.to, cell, pad);
    }
  }

  /* ---------- gameplay ---------- */
  function handleTileClick(idx) {
    if (paused || Game.get().finished) return;
    const moves = Game.slideToward(idx);
    if (!moves) { Sound.err(); return; }
    Sound.move(); vibrate(8);
    repositionAfterMoves(moves);
    saveProgress();
    updateHUD(); updateControls();
    if (Game.isSolved()) onWin();
  }

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

        const elapsed = currentElapsed();

        hudTime.textContent = formatTime(elapsed);

        updateTimerColor(elapsed);

    }, 250);

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

  /* ---------- win ---------- */
  function onWin() {
    const st = Game.get();
    st.finished = true;
    st.elapsed = currentElapsed();
    Storage.get().last = null;
    Sound.win(); vibrate([10,30,10,30,40]);
    boardEl.classList.add('win-zoom');

    // update stats + highs
    const stats = Storage.get().stats;
    stats.totalGames++; stats.totalWins++;
    stats.totalTime += st.elapsed; stats.totalMoves += st.moves;
    stats.currentStreak++; stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    if (!stats.fastest    || st.elapsed < stats.fastest)    stats.fastest = st.elapsed;
    if (!stats.leastMoves || st.moves   < stats.leastMoves) stats.leastMoves = st.moves;
    stats.bySize[st.size] = (stats.bySize[st.size] || 0) + 1;
    stats.byMode[st.mode] = (stats.byMode[st.mode] || 0) + 1;
    stats.history.unshift({ size: st.size, sequence: st.sequence, mode: st.mode,
      moves: st.moves, time: st.elapsed, at: Date.now() });
    stats.history = stats.history.slice(0, 25);

    const hsKey = `${st.size}-${st.sequence}-${st.mode}`;
    const prev  = Storage.get().highs[hsKey];
    const score = { moves: st.moves, time: st.elapsed, at: Date.now() };
    const isRecord = !prev || score.time < prev.time || (score.time === prev.time && score.moves < prev.moves);
    if (isRecord) Storage.get().highs[hsKey] = score;

    checkAchievements(st);
    Storage.save();

    setTimeout(() => showResult(st, isRecord, prev), 700);
  }
   function calculateRating(moves,time){

    let stars=5;

    if(time>60000) stars--;

    if(time>180000) stars--;

    if(moves>80) stars--;

    if(moves>140) stars--;

    return Math.max(stars,1);

      }

  function showResult(st, isRecord, prev) {
    $('#res-moves').textContent    = st.moves;
    $('#res-time').textContent     = formatTime(st.elapsed);
    $('#res-board').textContent    = `${st.size}×${st.size}`;
    $('#res-sequence').textContent = st.sequence;
    $('#res-mode').textContent     = st.mode;
    $('#res-record').textContent   = prev ? `${prev.moves} / ${formatTime(prev.time)}` : 'First!';
     const stars=calculateRating(
    st.moves,
    st.elapsed
);

$('#result-rating').textContent=
'★'.repeat(stars)+
'☆'.repeat(5-stars);
    $('#new-record-badge').classList.toggle('hidden', !isRecord);
    showScreen('result');
    FX.start();
    setTimeout(() => boardEl.classList.remove('win-zoom'), 1200);
  }

  /* ---------- achievements ---------- */
  const ACHIEVEMENTS = [
    { id: 'firstWin',    label: 'First Win',           check: st => Storage.get().stats.totalWins >= 1 },
    { id: 'wins10',      label: '10 Wins',             check: st => Storage.get().stats.totalWins >= 10 },
    { id: 'wins50',      label: '50 Wins',             check: st => Storage.get().stats.totalWins >= 50 },
    { id: 'wins100',     label: '100 Wins',            check: st => Storage.get().stats.totalWins >= 100 },
    { id: 'noHint',      label: 'Solve Without Hint',  check: st => st.hintsUsed === 0 },
    { id: 'speedy',      label: 'Solve Under 1 min',   check: st => st.elapsed < 60000 },
    { id: 'fewMoves',    label: 'Under 60 moves',      check: st => st.moves   < 60 },
    { id: 'streak5',     label: '5 in a row',          check: st => Storage.get().stats.currentStreak >= 5 },
    { id: 'allSizes',    label: 'All Board Sizes',     check: st => SIZES.every(s => Storage.get().stats.bySize[s]) },
    { id: 'allSeqs',     label: 'All Sequences',       check: st => SEQUENCES.every(s => Storage.get().stats.history.some(h => h.sequence === s)) },
  ];
  function checkAchievements(st) {
    const a = Storage.get().achievements;
    for (const x of ACHIEVEMENTS) {
      if (!a[x.id] && x.check(st)) {
        a[x.id] = { unlockedAt: Date.now() };
        toast(`🏅 Achievement: ${x.label}`);
      }
    }
  }

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    const d = Storage.get();
    const s = d.stats;
    const winRate = s.totalGames ? Math.round((s.totalWins / s.totalGames) * 100) : 0;
    const avgTime = s.totalWins ? formatTime(Math.round(s.totalTime / s.totalWins)) : '--:--';
    const avgMov  = s.totalWins ? Math.round(s.totalMoves / s.totalWins) : 0;
    const mostSize = topKey(s.bySize) || '—';
    const mostMode = topKey(s.byMode) || '—';

    const highRows = Object.entries(d.highs).map(([k, v]) =>
      `<div class="hs-row"><span class="lbl">${k}</span><span class="val">${v.moves} / ${formatTime(v.time)}</span></div>`
    ).join('') || '<p style="color:var(--muted)">No records yet — play a game!</p>';

    const historyRows = s.history.slice(0, 8).map(h =>
      `<div class="hs-row"><span class="lbl">${h.size}×${h.size} ${h.mode}</span><span class="val">${h.moves}m / ${formatTime(h.time)}</span></div>`
    ).join('') || '<p style="color:var(--muted)">No games yet</p>';

    const achList = ACHIEVEMENTS.map(a => {
      const unlocked = d.achievements[a.id];
      return `<div class="hs-row"><span class="lbl">${unlocked ? '🏅' : '🔒'} ${a.label}</span><span class="val">${unlocked ? 'Unlocked' : '—'}</span></div>`;
    }).join('');

    $('#dashboard-body').innerHTML = `
      <div class="stat-card"><h3>Overview</h3>
        <div class="stat-grid">
          <div><span>Total Games</span><strong>${s.totalGames}</strong></div>
          <div><span>Total Wins</span><strong>${s.totalWins}</strong></div>
          <div><span>Win Rate</span><strong>${winRate}%</strong></div>
          <div><span>Avg Time</span><strong>${avgTime}</strong></div>
          <div><span>Avg Moves</span><strong>${avgMov}</strong></div>
          <div><span>Longest Streak</span><strong>${s.longestStreak}</strong></div>
          <div><span>Fastest Ever</span><strong>${s.fastest ? formatTime(s.fastest) : '—'}</strong></div>
          <div><span>Least Moves</span><strong>${s.leastMoves ?? '—'}</strong></div>
          <div><span>Most Played Size</span><strong>${mostSize}</strong></div>
          <div><span>Most Played Mode</span><strong>${mostMode}</strong></div>
          <div><span>Total Play Time</span><strong>${formatTime(s.totalTime)}</strong></div>
          <div><span>Last Game</span><strong>${s.history[0] ? `${s.history[0].size}×${s.history[0].size}` : '—'}</strong></div>
        </div>
      </div>
      <div class="stat-card"><h3>High Scores</h3>${highRows}</div>
      <div class="stat-card"><h3>Recent Games</h3>${historyRows}</div>
      <div class="stat-card"><h3>Achievements</h3>${achList}</div>
    `;
  }
  function topKey(obj) {
    let best = null, max = -1;
    for (const [k, v] of Object.entries(obj || {})) if (v > max) { max = v; best = k; }
    return best;
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    $('#toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  /* ---------- confirm dialog ---------- */
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

  /* ---------- photo handling ---------- */
  function loadPhotoFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast('Unsupported format'); return;
    }
    const reader = new FileReader();
    reader.onload = e => optimizeImage(e.target.result).then(url => {
      photoDataURL = url;
updatePresetPreview();
      const dz = $('#photo-dropzone');
      dz.classList.add('has-photo');
      dz.style.backgroundImage = `url(${url})`;
      renderPreview();
    });
    reader.readAsDataURL(file);
  }
  function optimizeImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const max = 720;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
        // square crop centered
        const size = Math.min(w, h);
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const sx = (img.width  - img.width  * (size / w)) / 2;
        const sy = (img.height - img.height * (size / h)) / 2;
        const sSize = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - sSize)/2, (img.height - sSize)/2, sSize, sSize, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = src;
    });
  }

  /* ---------- swipe / touch on board ---------- */
  function attachBoardSwipe() {
    let sx = 0, sy = 0, sIdx = -1;
    boardEl.addEventListener('pointerdown', e => {
      const t = e.target.closest('.tile');
      sIdx = t ? Number(t.dataset.pos) : -1;
      sx = e.clientX; sy = e.clientY;
    });
    boardEl.addEventListener('pointerup', e => {
      if (sIdx < 0) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.hypot(dx, dy) < 12) { sIdx = -1; return; } // treated as click
      const st = Game.get(), n = st.size;
      const r = Math.floor(sIdx / n), c = sIdx % n;
      let target = sIdx;
      if (Math.abs(dx) > Math.abs(dy)) target = r * n + (dx > 0 ? Math.min(n-1, c+1) : Math.max(0, c-1));
      else                              target = (dy > 0 ? Math.min(n-1, r+1) : Math.max(0, r-1)) * n + c;
      // slide *the blank toward us* means click on tile in that line — easier: just use sIdx
      handleTileClick(sIdx);
      sIdx = -1;
    });
  }

  /* ---------- keyboard ---------- */
  function attachKeys() {
    document.addEventListener('keydown', e => {
      if (!screens.game.classList.contains('active')) return;
      const st = Game.get(); const n = st.size;
      const b = st.blank;
      let target = null;
      switch (e.key) {
        case 'ArrowUp':    target = b + n; break;
        case 'ArrowDown':  target = b - n; break;
        case 'ArrowLeft':  target = b + 1; break;
        case 'ArrowRight': target = b - 1; break;
        case 'u': case 'U': $('#btn-undo').click(); return;
        case 'r': case 'R': $('#btn-redo').click(); return;
        case 'h': case 'H': $('#btn-hint').click(); return;
        case ' ': $('#btn-pause').click(); return;
      }
      if (target != null && target >= 0 && target < n*n) {
        const tr = Math.floor(target/n), br = Math.floor(b/n);
        if (Math.abs(tr - br) + Math.abs((target%n) - (b%n)) === 1) handleTileClick(target);
      }
    });
  }

  /* ---------- side panels ---------- */
  function openPanel(id) {
    document.getElementById(id).classList.add('open');
    $('#panel-backdrop').classList.add('show');
  }
  function closePanels() {
    document.querySelectorAll('.side-panel.open').forEach(p => p.classList.remove('open'));
    $('#panel-backdrop').classList.remove('show');
  }

  /* ---------- swipe on home → open panels ---------- */
  function attachHomeSwipe() {
    let sx = 0, sy = 0;
    screens.home.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    screens.home.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 0) openPanel('info-panel');
      else        { renderDashboard(); openPanel('dashboard-panel'); }
    }, { passive: true });
  }

  /* ---------- start a game from current settings ---------- */
  function startGame() {
    const s = Storage.get().settings;
    const selectedPhoto =
    photoDataURL || PHOTO_PRESETS[presetIndex]; }
    Game.newGame({
      size: s.size, sequence: s.sequence, mode: s.mode, difficulty: s.difficulty,
      photoURL:
    s.mode === 'Photo'
        ? selectedPhoto
        : null,
    });
    paused = false;
    showScreen('game');
    setTimeout(() => { renderBoard(true); tickTimer(); }, 60);
  }

  /* ---------- init ---------- */
  function init() {
    /* pickers */
    document.querySelectorAll('.picker-arrow').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.picker;
        const dir   = Number(btn.dataset.dir);
        const list = which === 'size' ? SIZES :
                     which === 'sequence' ? (MODES[sIdx.mode] === 'Photo' ? PHOTO_SEQ : SEQUENCES) :
                     which === 'mode' ? MODES : DIFFS;
        sIdx[which] = (sIdx[which] + dir + list.length) % list.length;
        Sound.click();
        renderPickers();
         $('#preset-prev').addEventListener('click', () => {

    photoDataURL = null;

    presetIndex--;

    if(presetIndex < 0)
        presetIndex = PHOTO_PRESETS.length-1;

    updatePresetPreview();
    renderPreview();

});

$('#preset-next').addEventListener('click', () => {

    photoDataURL = null;

    presetIndex++;

    if(presetIndex >= PHOTO_PRESETS.length)
        presetIndex = 0;

    updatePresetPreview();
    renderPreview();

});
      });
    });

    /* photo upload */
    const dz = $('#photo-dropzone');
    $('#btn-pick-photo').addEventListener('click', e => { e.stopPropagation(); $('#photo-input').click(); });
    $('#btn-camera-photo').addEventListener('click', e => { e.stopPropagation(); $('#photo-camera').click(); });
    dz.addEventListener('click', () => $('#photo-input').click());
    $('#photo-input').addEventListener('change', e => loadPhotoFile(e.target.files[0]));
    $('#photo-camera').addEventListener('change', e => loadPhotoFile(e.target.files[0]));
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(ev   => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', e => loadPhotoFile(e.dataTransfer.files[0]));

    /* CTA */
    $('#btn-play').addEventListener('click', () => { Sound.click(); startGame(); });
    $('#btn-continue').addEventListener('click', () => {
      const last = Storage.get().last;
      if (!last) return;
      Game.fromSaved(last);
      paused = false; showScreen('game');
      setTimeout(() => { renderBoard(false); tickTimer(); }, 60);
    });

    /* game controls */
    $('#btn-back-home').addEventListener('click', async () => {
      if (Game.get() && !Game.get().finished && Game.get().moves > 0) {
        const ok = await confirm({ title: 'Leave game?', message: 'Progress will be saved as Continue.', okText: 'Leave' });
        if (!ok) return;
      }
      saveProgress(); clearInterval(timerInt); FX.stop(); showScreen('home'); refreshContinue();
    });
    $('#btn-hint').addEventListener('click', () => {
      const idx = Game.hint(); if (idx == null) return;
      const tile = boardEl.querySelector(`.tile[data-pos="${idx}"]`);
      tile && tile.classList.add('hint-glow');
      setTimeout(() => tile && tile.classList.remove('hint-glow'), 2000);
      toast('Try this tile');
    });
    $('#btn-undo').addEventListener('click', () => { const m = Game.undo(); if (m) { repositionAfterMoves(m); updateHUD(); updateControls(); } });
    $('#btn-redo').addEventListener('click', () => { const m = Game.redo(); if (m) { repositionAfterMoves(m); updateHUD(); updateControls(); } });
    $('#btn-shuffle').addEventListener('click', async () => {
      const ok = await confirm({ title: 'Shuffle?', message: 'Moves and timer will reset.', okText: 'Shuffle' });
      if (ok) startGame();
    });
    $('#btn-restart').addEventListener('click', async () => {
      const ok = await confirm({ title: 'Restart?', message: 'Moves and timer will reset.', okText: 'Restart' });
      if (ok) startGame();
    });
    $('#btn-fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    });
    $('#btn-pause').addEventListener('click', () => {
      paused = true;
      Game.get().elapsed = currentElapsed();
      Game.get().startedAt = 0;
      $('#pause-overlay').classList.remove('hidden');
    });
    $('#btn-resume').addEventListener('click', () => {
      paused = false;
      Game.get().startedAt = Date.now() - Game.get().elapsed;
      $('#pause-overlay').classList.add('hidden');
    });
    $('#btn-pause-restart').addEventListener('click', () => { $('#pause-overlay').classList.add('hidden'); startGame(); });
    $('#btn-pause-home').addEventListener('click', () => { $('#pause-overlay').classList.add('hidden'); clearInterval(timerInt); showScreen('home'); refreshContinue(); });

    /* result */
    $('#btn-play-again').addEventListener('click', () => { FX.stop(); startGame(); });
    $('#btn-result-home').addEventListener('click', () => { FX.stop(); showScreen('home'); refreshContinue(); });
    $('#btn-share').addEventListener('click', async () => {
      const st = Game.get();
      const text = `I solved a ${st.size}×${st.size} ${st.mode} puzzle in ${st.moves} moves & ${formatTime(st.elapsed)} on Number Puzzle Pro!`;
      try {
        if (navigator.share) await navigator.share({ title: 'Number Puzzle Pro', text });
        else { await navigator.clipboard.writeText(text); toast('Result copied'); }
      } catch {}
    });

    /* panels */
    $('#open-info').addEventListener('click', () => openPanel('info-panel'));
    $('#open-dashboard').addEventListener('click', () => { renderDashboard(); openPanel('dashboard-panel'); });
    document.querySelectorAll('[data-close-panel]').forEach(b => b.addEventListener('click', closePanels));
    $('#panel-backdrop').addEventListener('click', closePanels);

    /* data mgmt */
    $('#btn-export-data').addEventListener('click', () => {
      const blob = new Blob([Storage.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'number-puzzle-pro-backup.json'; a.click();
    });
    $('#btn-import-data').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = ev => { try { Storage.importJSON(ev.target.result); toast('Backup imported'); syncPickers(); } catch { toast('Invalid backup'); } };
      r.readAsText(f);
    });
    $('#btn-reset-data').addEventListener('click', async () => {
      const ok = await confirm({ title: 'Reset all data?', message: 'All scores, settings and achievements will be erased.', okText: 'Reset' });
      if (ok) { Storage.reset(); syncPickers(); refreshContinue(); toast('Data reset'); }
    });

    /* keyboard + swipe */
    attachBoardSwipe(); attachKeys(); attachHomeSwipe();

    /* responsive board redraw on resize */
    let rTimer;
    window.addEventListener('resize', () => {
      if (!screens.game.classList.contains('active')) return;
      clearTimeout(rTimer);
      rTimer = setTimeout(() => renderBoard(false), 120);
    });

    /* FX canvas */
    FX.init($('#fx-canvas'));

    /* init UI */
    syncPickers();
    refreshContinue();

    /* hide loader, show app */
    setTimeout(() => {
      $('#loading-screen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      showScreen('home');
    }, 350);

    /* register SW for PWA */
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(()=>{}));
    }
  }

  function refreshContinue(){

    const btn=$('#btn-continue');

    if(Storage.get().last){

        btn.hidden=false;

        btn.innerHTML=
        '<span class="resume-dot"></span>Continue';

    }
    else{

        btn.hidden=true;

    }

         }

/* expose buildSolved to UI module (defined in module scope) */
function buildSolved(n, seq) {
  const order = SequenceGen[seq](n);
  const board = Array(n * n).fill(0);
  for (let i = 0; i < order.length - 1; i++) board[order[i]] = i + 1;
  return { board, order };
}

document.addEventListener('DOMContentLoaded', UI.init);

})();
