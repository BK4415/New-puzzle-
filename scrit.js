/* =============================================================
   Number Puzzle Pro — Full Fix & Premium Sliding Engine
   ============================================================= */
(() => {
  'use strict';

  /* -------------------- CONSTANTS -------------------- */
  const SIZES = [3, 4, 5, 6, 7];
  const SEQUENCES = ['Classic', 'Upside Down', 'Spiral', 'Snake'];
  const PHOTO_SEQ = ['Classic'];
  const MODES = ['Number', 'Photo'];
  const PHOTO_PRESETS = [
    'assets/images/preset-1.jpg',
    'assets/images/preset-2.jpg',
    'assets/images/preset-3.jpg',
    'assets/images/preset-4.jpg'
  ];
  const DIFFS = ['Easy', 'Medium', 'Hard'];
  const DIFF_SHUFFLE = { Easy: 30, Medium: 120, Hard: 300 };
  const STORAGE_KEY = 'npp.v1';

  /* -------------------- STORAGE (FIXED SYNTAX) -------------------- */
  const Storage = (() => {
    const DEFAULT = {
      settings: {
        size: 3, sequence: 'Classic', mode: 'Number', difficulty: 'Medium',
        sound: true, vibration: true, theme: 'dark', volume: 0.7, photoNumbers: true
      },
      last: null,
      highs: {},
      stats: {
        totalGames: 0, totalWins: 0, totalTime: 0, totalMoves: 0,
        fastest: null, leastMoves: null, longestStreak: 0, currentStreak: 0,
        bySize: {}, byMode: {}, history: []
      },
      achievements: {},
    };

    let data = load();

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT));
        const parsed = JSON.parse(raw);
        return deepMerge(JSON.parse(JSON.stringify(DEFAULT)), parsed);
      } catch (e) {
        return JSON.parse(JSON.stringify(DEFAULT));
      }
    }

    function save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
      catch (e) { console.error('Save failed', e); }
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
      reset() { data = JSON.parse(JSON.stringify(DEFAULT)); save(); },
      exportJSON() { return JSON.stringify(data, null, 2); },
      importJSON(json) {
        const parsed = JSON.parse(json);
        data = deepMerge(JSON.parse(JSON.stringify(DEFAULT)), parsed);
        save();
      }
    };
  })();

  /* -------------------- SOUND -------------------- */
  const Sound = (() => {
    const sounds = {
      move: new Audio('assets/sound/move.wav'),
      click: new Audio('assets/sound/click.wav'),
      win: new Audio('assets/sound/win.wav'),
      err: new Audio('assets/sound/error.wav')
    };

    function playFile(audio) {
      const s = Storage.get().settings;
      if (!s.sound) return;
      audio.volume = s.volume || 0.7;
      audio.currentTime = 0;
      audio.play().catch(() => { });
    }

    return {
      move: () => playFile(sounds.move),
      click: () => playFile(sounds.click),
      win: () => playFile(sounds.win),
      err: () => playFile(sounds.err)
    };
  })();

  function vibrate(ms = 12) {
    if (Storage.get().settings.vibration && navigator.vibrate) navigator.vibrate(ms);
  }

  /* -------------------- SEQUENCE GEN -------------------- */
  const SequenceGen = {
    Classic: (n) => Array.from({ length: n * n }, (_, i) => i),
    'Upside Down': (n) => {
      const arr = [];
      for (let r = n - 1; r >= 0; r--) for (let c = n - 1; c >= 0; c--) arr.push(r * n + c);
      return arr;
    },
    Snake: (n) => {
      const arr = [];
      for (let r = 0; r < n; r++) {
        let row = [];
        for (let c = 0; c < n; c++) row.push(r * n + c);
        if (r % 2 === 1) row.reverse();
        arr.push(...row);
      }
      return arr;
    },
    Spiral: (n) => {
      const grid = Array.from({ length: n }, () => Array(n).fill(-1));
      const arr = [];
      let r = 0, c = 0, dr = 0, dc = 1;
      for (let i = 0; i < n * n; i++) {
        arr.push(r * n + c);
        grid[r][c] = 1;
        let nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || grid[nr][nc] !== -1) {
          [dr, dc] = [dc, -dr];
        }
        r += dr; c += dc;
      }
      return arr;
    }
  };

  function buildSolved(n, seqName) {
    const order = SequenceGen[seqName] ? SequenceGen[seqName](n) : SequenceGen.Classic(n);
    const board = Array(n * n).fill(0);
    for (let i = 0; i < order.length - 1; i++) board[order[i]] = i + 1;
    return { board, order };
  }

  /* -------------------- PREMIUM GAME CORE -------------------- */
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

    function shuffle(board, n, steps) {
      let blank = board.indexOf(0);
      let lastMove = -1;
      for (let i = 0; i < steps; i++) {
        const r = Math.floor(blank / n), c = blank % n;
        const opts = [];
        if (r > 0) opts.push(blank - n);
        if (r < n - 1) opts.push(blank + n);
        if (c > 0) opts.push(blank - 1);
        if (c < n - 1) opts.push(blank + 1);
        const valid = opts.filter(p => p !== lastMove);
        const pick = valid[Math.floor(Math.random() * valid.length)];
        board[blank] = board[pick]; board[pick] = 0;
        lastMove = blank; blank = pick;
      }
      return blank;
    }

    function getPath(tileIdx) {
      if (!state || state.blank === tileIdx) return [];
      const n = state.size;
      const r1 = Math.floor(tileIdx / n), c1 = tileIdx % n;
      const r0 = Math.floor(state.blank / n), c0 = state.blank % n;
      if (r1 !== r0 && c1 !== c0) return [];

      const path = [];
      if (r1 === r0) { // Same Row
        const step = c1 < c0 ? 1 : -1;
        for (let c = c1; c !== c0; c += step) path.push(r1 * n + c);
      } else { // Same Column
        const step = r1 < r0 ? 1 : -1;
        for (let r = r1; r !== r0; r += step) path.push(r * n + c1);
      }
      return path;
    }

    function slideToward(tileIdx) {
      if (!state || state.finished) return null;
      const { board, size: n, blank } = state;
      const path = getPath(tileIdx);
      if (path.length === 0) return null;

      const r1 = Math.floor(tileIdx / n), c1 = tileIdx % n;
      const r0 = Math.floor(blank / n), c0 = blank % n;

      if (r1 === r0) {
        const step = c1 < c0 ? -1 : 1;
        for (let c = c0 + step; c !== c1 + step; c += step) {
          const from = r0 * n + c, to = from - step;
          board[to] = board[from]; board[from] = 0;
        }
      } else {
        const step = r1 < r0 ? -1 : 1;
        for (let r = r0 + step; r !== r1 + step; r += step) {
          const from = r * n + c1, to = from - step * n;
          board[to] = board[from]; board[from] = 0;
        }
      }

      const oldBlank = blank;
      state.blank = tileIdx;
      state.moves++;
      state.undoStack.push({ tileIdx: oldBlank });
      state.redoStack = [];
      if (!state.startedAt) state.startedAt = Date.now() - state.elapsed;
      return true;
    }

    return { 
      newGame, fromSaved: (s) => state = s, get: () => state, 
      getPath, slideToward, 
      isSolved: () => state.board.every((v, i) => v === state.solved[i]),
      hint: () => {
        const { board, solved, blank, size: n } = state;
        const r0 = Math.floor(blank / n), c0 = blank % n;
        let best = null, bestScore = -Infinity;
        for (let i = 0; i < board.length; i++) {
          if (i === blank) continue;
          const r = Math.floor(i / n), c = i % n;
          if (r !== r0 && c !== c0) continue;
          const target = solved.indexOf(board[i]);
          const distBefore = Math.abs(i % n - target % n) + Math.abs(Math.floor(i / n) - Math.floor(target / n));
          const distAfter = Math.abs(blank % n - target % n) + Math.abs(Math.floor(blank / n) - Math.floor(target / n));
          if (distBefore - distAfter > bestScore) { bestScore = distBefore - distAfter; best = i; }
        }
        state.hintsUsed++; return best;
      }
    };
  })();

  /* -------------------- FX & SOUND -------------------- */
  const FX = (() => {
    let canvas, ctx, parts = [], running = false;
    function init(c) { canvas = c; ctx = c.getContext('2d'); }
    function loop() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.1;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
        if (p.y > canvas.height) parts.splice(i, 1);
      });
      requestAnimationFrame(loop);
    }
    return {
      init,
      start: () => {
        running = true; parts = [];
        for (let i = 0; i < 100; i++) parts.push({ x: canvas.width / 2, y: canvas.height / 2, vx: Math.random() * 10 - 5, vy: Math.random() * -10, size: 5, color: '#d9a441' });
        loop();
      },
      stop: () => running = false
    };
  })();

  /* -------------------- UI MODULE (PREMIUM ENGINE) -------------------- */
  const UI = (() => {
    const $ = sel => document.querySelector(sel);
    const boardEl = $('#board');
    const previewEl = $('#preview-board');

    let sIdx = { size: 0, sequence: 0, mode: 0, difficulty: 1 };
    let photoDataURL = null;
    let presetIndex = 0;
    let timerInt = null;
    let paused = false;

    // Drag State
    let drag = { active: false, path: [], axis: null, dir: 0, startX: 0, startY: 0, currentDelta: 0, maxDist: 0 };

    function formatTime(ms) {
      const s = Math.floor(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
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
      
      const s = Storage.get().settings;
      s.size = n; s.sequence = seqList[sIdx.sequence]; s.mode = MODES[sIdx.mode]; s.difficulty = DIFFS[sIdx.difficulty];
      Storage.save();
      renderPreview();
    }

    function renderPreview() {
      const n = SIZES[sIdx.size];
      previewEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
      const seq = MODES[sIdx.mode] === 'Photo' ? 'Classic' : SEQUENCES[sIdx.sequence];
      const { board } = buildSolved(n, seq);
      previewEl.innerHTML = '';
      board.forEach((val, i) => {
        const t = document.createElement('div');
        t.className = 'preview-tile' + (val === 0 ? ' blank' : '');
        if (val !== 0) {
          if (MODES[sIdx.mode] === 'Photo') {
            t.classList.add('photo');
            const url = photoDataURL || PHOTO_PRESETS[presetIndex];
            t.style.backgroundImage = `url(${url})`;
            const r = Math.floor(i / n), c = i % n;
            t.style.backgroundSize = `${n * 100}% ${n * 100}%`;
            t.style.backgroundPosition = `${(c / (n - 1)) * 100}% ${(r / (n - 1)) * 100}%`;
          } else t.textContent = val;
        }
        previewEl.appendChild(t);
      });
      const img = $('#preset-image');
      img.src = photoDataURL || PHOTO_PRESETS[presetIndex];
    }

    function renderBoard(animate = true) {
      const st = Game.get();
      const n = st.size;
      boardEl.innerHTML = '';
      const cell = (boardEl.offsetWidth - 16) / n;

      st.board.forEach((val, i) => {
        if (val === 0) return;
        const t = document.createElement('div');
        t.className = 'tile' + (animate ? ' appear' : '');
        t.dataset.val = val;
        t.dataset.pos = i;
        t.style.width = `${cell - 6}px`;
        t.style.height = `${cell - 6}px`;
        t.style.position = 'absolute';
        
        if (st.mode === 'Photo' && st.photoURL) {
          t.classList.add('photo-tile');
          t.style.backgroundImage = `url(${st.photoURL})`;
          const homeIdx = val - 1;
          const hr = Math.floor(homeIdx / n), hc = homeIdx % n;
          t.style.backgroundSize = `${n * (cell - 6)}px ${n * (cell - 6)}px`;
          t.style.backgroundPosition = `-${hc * (cell - 6)}px -${hr * (cell - 6)}px`;
          if (Storage.get().settings.photoNumbers) {
            const b = document.createElement('div'); b.className = 'photo-number'; b.textContent = val; t.appendChild(b);
          }
        } else t.textContent = val;

        placeTile(t, i, cell);
        boardEl.appendChild(t);
      });
      updateHUD();
    }

    function placeTile(t, idx, cell, fast = false) {
      const n = Game.get().size;
      const r = Math.floor(idx / n), c = idx % n;
      const x = 8 + c * cell + 3;
      const y = 8 + r * cell + 3;
      t.style.transition = fast ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
      t.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      t.dataset.bx = x; t.dataset.by = y;
    }

    function attachBoardSwipe() {
      boardEl.addEventListener('pointerdown', e => {
        if (paused || Game.get().finished) return;
        const t = e.target.closest('.tile');
        if (!t) return;
        const idx = Number(t.dataset.pos);
        const path = Game.getPath(idx);
        if (!path.length) return;

        const n = Game.get().size;
        const cell = (boardEl.offsetWidth - 16) / n;
        const blank = Game.get().blank;

        drag = {
          active: true, path, cell, startX: e.clientX, startY: e.clientY, startTime: Date.now(),
          axis: Math.floor(idx/n) === Math.floor(blank/n) ? 'x' : 'y',
          dir: idx < blank ? 1 : -1, maxDist: cell
        };
        t.setPointerCapture(e.pointerId);
      });

      boardEl.addEventListener('pointermove', e => {
        if (!drag.active) return;
        const delta = drag.axis === 'x' ? e.clientX - drag.startX : e.clientY - drag.startY;
        const clamped = drag.dir === 1 ? Math.max(0, Math.min(delta, drag.maxDist)) : Math.min(0, Math.max(delta, -drag.maxDist));
        drag.currentDelta = clamped;

        drag.path.forEach(idx => {
          const el = boardEl.querySelector(`[data-pos="${idx}"]`);
          const tx = drag.axis === 'x' ? parseFloat(el.dataset.bx) + clamped : el.dataset.bx;
          const ty = drag.axis === 'y' ? parseFloat(el.dataset.by) + clamped : el.dataset.by;
          el.style.transition = 'none';
          el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        });
      });

      boardEl.addEventListener('pointerup', e => {
        if (!drag.active) return;
        drag.active = false;
        const duration = Date.now() - drag.startTime;
        const velocity = Math.abs(drag.currentDelta) / duration;
        
        if (Math.abs(drag.currentDelta) > drag.maxDist * 0.4 || velocity > 0.5) {
          handleTileClick(drag.path[0]);
        } else {
          renderBoard(false);
        }
      });
    }

    function handleTileClick(idx) {
      if (Game.slideToward(idx)) {
        Sound.move(); vibrate(8);
        renderBoard(false);
        if (Game.isSolved()) onWin();
      }
    }

    function updateHUD() {
      const st = Game.get();
      $('#hud-moves').textContent = st.moves;
      $('#hud-time').textContent = formatTime(st.startedAt ? Date.now() - st.startedAt : st.elapsed);
    }

    function onWin() {
      const st = Game.get(); st.finished = true;
      st.elapsed = Date.now() - st.startedAt;
      clearInterval(timerInt);
      Sound.win(); FX.start();
      $('#res-moves').textContent = st.moves;
      $('#res-time').textContent = formatTime(st.elapsed);
      $('#screen-result').classList.add('active');
    }

    function startGame() {
      const s = Storage.get().settings;
      Game.newGame({
        size: s.size, sequence: s.sequence, mode: s.mode, difficulty: s.difficulty,
        photoURL: s.mode === 'Photo' ? (photoDataURL || PHOTO_PRESETS[presetIndex]) : null
      });
      paused = false;
      $('#screen-home').classList.remove('active');
      $('#screen-game').classList.add('active');
      renderBoard();
      clearInterval(timerInt);
      timerInt = setInterval(updateHUD, 500);
    }

    function init() {
      // Event Listeners
      document.querySelectorAll('.picker-arrow').forEach(btn => {
        btn.onclick = () => {
          const type = btn.dataset.picker;
          const dir = parseInt(btn.dataset.dir);
          if (type === 'size') sIdx.size = (sIdx.size + dir + SIZES.length) % SIZES.length;
          if (type === 'mode') sIdx.mode = (sIdx.mode + dir + MODES.length) % MODES.length;
          if (type === 'difficulty') sIdx.difficulty = (sIdx.difficulty + dir + DIFFS.length) % DIFFS.length;
          if (type === 'sequence') sIdx.sequence = (sIdx.sequence + dir + SEQUENCES.length) % SEQUENCES.length;
          renderPickers();
        };
      });

      $('#preset-next').onclick = () => { presetIndex = (presetIndex + 1) % PHOTO_PRESETS.length; photoDataURL = null; renderPreview(); };
      $('#preset-prev').onclick = () => { presetIndex = (presetIndex - 1 + PHOTO_PRESETS.length) % PHOTO_PRESETS.length; photoDataURL = null; renderPreview(); };
      $('#btn-play').onclick = startGame;
      $('#btn-back-home').onclick = () => { $('#screen-game').classList.remove('active'); $('#screen-home').classList.add('active'); clearInterval(timerInt); };
      
      $('#btn-hint').onclick = () => {
        const h = Game.hint();
        if (h !== null) {
          const el = boardEl.querySelector(`[data-pos="${h}"]`);
          el.classList.add('hint-glow');
          setTimeout(() => el.classList.remove('hint-glow'), 1000);
        }
      };

      syncPickers();
      attachBoardSwipe();
      FX.init($('#fx-canvas'));

      // Hide Loader
      setTimeout(() => {
        $('#loading-screen').classList.add('hidden');
        $('#app').classList.remove('hidden');
      }, 500);
    }

    return { init };
  })();

  document.addEventListener('DOMContentLoaded', UI.init);
})();
