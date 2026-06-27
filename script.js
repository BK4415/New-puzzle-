(() => {
  'use strict';

  /* -------------------- CONSTANTS -------------------- */
  const SIZES = [3, 4, 5, 6, 7];
  const SEQUENCES = ['Classic', 'Upside Down', 'Spiral', 'Snake'];
  const MODES = ['Number', 'Photo'];
  const DIFFS = ['Easy', 'Medium', 'Hard'];
  const DIFF_SHUFFLE = { Easy: 30, Medium: 120, Hard: 300 };
  const STORAGE_KEY = 'npp.v1';
  const PHOTO_PRESETS = [
    'assets/images/preset-1.jpg',
    'assets/images/preset-2.jpg',
    'assets/images/preset-3.jpg',
    'assets/images/preset-4.jpg'
  ];

  /* -------------------- STORAGE (FIXED) -------------------- */
  const Storage = (() => {
    const DEFAULT = {
      settings: {
        size: 3, sequence: 'Classic', mode: 'Number', difficulty: 'Medium',
        sound: true, vibration: true, theme: 'dark', volume: 0.7, photoNumbers: true
      },
      last: null,
      highs: {},
      stats: { totalGames: 0, totalWins: 0, totalTime: 0, totalMoves: 0, history: [] },
      achievements: {},
    };

    function deepMerge(target, src) {
      if (!src) return target;
      for (const k of Object.keys(src)) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          target[k] = deepMerge(target[k] || {}, src[k]);
        } else { target[k] = src[k]; }
      }
      return target;
    }

    let data;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? deepMerge(JSON.parse(JSON.stringify(DEFAULT)), JSON.parse(raw)) : JSON.parse(JSON.stringify(DEFAULT));
    } catch (e) { data = JSON.parse(JSON.stringify(DEFAULT)); }

    return {
      get: () => data,
      save: () => localStorage.setItem(STORAGE_KEY, JSON.stringify(data)),
      reset: () => { data = JSON.parse(JSON.stringify(DEFAULT)); localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    };
  })();

  /* -------------------- SOUND & FX -------------------- */
  const Sound = {
    play(key) {
      const s = Storage.get().settings;
      if (!s.sound) return;
      const audio = new Audio(`assets/sound/${key}.wav`);
      audio.volume = s.volume;
      audio.play().catch(() => {});
    }
  };

  /* -------------------- GAME CORE (SOLVABLE SHUFFLE) -------------------- */
  const Game = (() => {
    let st = null;

    return {
      newGame(opts) {
        const { size: n, sequence: seqName, mode, difficulty, photoURL } = opts;
        const order = (mode === 'Photo') ? Array.from({length: n*n}, (_, i) => i) : UI.getSequence(seqName, n);
        
        const solved = Array(n * n).fill(0);
        for (let i = 0; i < order.length - 1; i++) solved[order[i]] = i + 1;
        
        const board = [...solved];
        // Solvability guaranteed by shuffling via valid moves
        let blank = board.indexOf(0);
        const steps = DIFF_SHUFFLE[difficulty] || 100;
        for (let i = 0; i < steps; i++) {
          const r = Math.floor(blank / n), c = blank % n;
          const neighbors = [];
          if (r > 0) neighbors.push(blank - n);
          if (r < n - 1) neighbors.push(blank + n);
          if (c > 0) neighbors.push(blank - 1);
          if (c < n - 1) neighbors.push(blank + 1);
          const move = neighbors[Math.floor(Math.random() * neighbors.length)];
          [board[blank], board[move]] = [board[move], board[blank]];
          blank = move;
        }

        st = { n, board, blank, solved, moves: 0, startedAt: 0, finished: false, mode, photoURL, undoStack: [], redoStack: [] };
        return st;
      },
      get: () => st,
      getPath(idx) {
        const n = st.n, b = st.blank;
        const r1 = Math.floor(idx/n), c1 = idx%n, r0 = Math.floor(b/n), c0 = b%n;
        if (r1 !== r0 && c1 !== c0) return [];
        const path = [];
        if (r1 === r0) {
          const step = c1 < c0 ? 1 : -1;
          for (let c = c1; c !== c0; c += step) path.push(r1 * n + c);
        } else {
          const step = r1 < r0 ? 1 : -1;
          for (let r = r1; r !== r0; r += step) path.push(r * n + c1);
        }
        return path;
      },
      move(idx) {
        const path = this.getPath(idx);
        if (!path.length) return false;
        const prevBlank = st.blank;
        st.undoStack.push(prevBlank);
        st.redoStack = [];
        
        // Logical update: Shift all tiles in path
        path.forEach(pos => {
          const targetPos = pos + (idx < prevBlank ? (idx === pos ? prevBlank - pos : 0) : 0); // Simplified logic below
        });
        
        // Actual shift
        const n = st.n;
        const r1 = Math.floor(idx/n), c1 = idx%n, r0 = Math.floor(prevBlank/n), c0 = prevBlank%n;
        if (r1 === r0) {
          const step = c1 < c0 ? -1 : 1;
          for (let c = c0 + step; c !== c1 + step; c += step) {
            st.board[r0 * n + c - step] = st.board[r0 * n + c];
          }
        } else {
          const step = r1 < r0 ? -1 : 1;
          for (let r = r0 + step; r !== r1 + step; r += step) {
            st.board[(r - step) * n + c0] = st.board[r * n + c0];
          }
        }
        st.board[idx] = 0;
        st.blank = idx;
        st.moves++;
        if (!st.startedAt) st.startedAt = Date.now();
        return true;
      }
    };
  })();

  /* -------------------- PREMIUM SLIDING ENGINE (UI) -------------------- */
  const UI = (() => {
    const $ = s => document.querySelector(s);
    const boardEl = $('#board');
    let presetIdx = 0;
    let drag = { active: false, tiles: [], startX: 0, startY: 0, axis: null, dir: 0, cell: 0, delta: 0, startTime: 0 };

    function init() {
      syncPickers();
      attachEvents();
      $('#loading-screen').classList.add('hidden');
      $('#app').classList.remove('hidden');
    }

    function syncPickers() {
      const s = Storage.get().settings;
      $('#picker-size').textContent = `${s.size} × ${s.size}`;
      $('#picker-mode').textContent = s.mode;
      $('#picker-sequence').textContent = s.sequence;
      $('#picker-difficulty').textContent = s.difficulty;
      
      // REQUIREMENTS: Hide/Show Photo preset row
      const isPhoto = s.mode === 'Photo';
      $('.photo-preset-row').classList.toggle('hidden', !isPhoto);
      $('#photo-upload-row').classList.toggle('hidden', !isPhoto);
      
      updatePreview();
    }

    function updatePreview() {
      const s = Storage.get().settings;
      const n = s.size;
      const preview = $('#preview-board');
      preview.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
      preview.innerHTML = '';
      
      const seq = isPhoto() ? Array.from({length: n*n}, (_, i) => i) : getSequence(s.sequence, n);
      const board = Array(n*n).fill(0);
      for(let i=0; i<seq.length-1; i++) board[seq[i]] = i+1;

      board.forEach((val, i) => {
        const t = document.createElement('div');
        t.className = 'preview-tile' + (val === 0 ? ' blank' : '');
        if (val !== 0) {
          if (isPhoto()) {
            t.classList.add('photo');
            t.style.backgroundImage = `url(${PHOTO_PRESETS[presetIdx]})`;
            const r = Math.floor(i/n), c = i%n;
            t.style.backgroundSize = `${n*100}% ${n*100}%`;
            t.style.backgroundPosition = `${(c/(n-1))*100}% ${(r/(n-1))*100}%`;
          } else t.textContent = val;
        }
        preview.appendChild(t);
      });
      $('#preset-image').src = PHOTO_PRESETS[presetIdx];
    }

    function attachEvents() {
      // Buttons
      $('#btn-play').onclick = () => startGame();
      
      document.querySelectorAll('.picker-arrow').forEach(btn => {
        btn.onclick = () => {
          const s = Storage.get().settings;
          const p = btn.dataset.picker;
          const dir = parseInt(btn.dataset.dir);
          
          if (p === 'size') {
            const idx = SIZES.indexOf(s.size);
            s.size = SIZES[(idx + dir + SIZES.length) % SIZES.length];
          } else if (p === 'mode') {
            const idx = MODES.indexOf(s.mode);
            s.mode = MODES[(idx + dir + MODES.length) % MODES.length];
          } else if (p === 'sequence') {
            const idx = SEQUENCES.indexOf(s.sequence);
            s.sequence = SEQUENCES[(idx + dir + SEQUENCES.length) % SEQUENCES.length];
          } else if (p === 'difficulty') {
            const idx = DIFFS.indexOf(s.difficulty);
            s.difficulty = DIFFS[(idx + dir + DIFFS.length) % DIFFS.length];
          }
          
          Sound.play('click');
          syncPickers();
        };
      });

      $('#preset-prev').onclick = () => { presetIdx = (presetIdx - 1 + PHOTO_PRESETS.length) % PHOTO_PRESETS.length; updatePreview(); };
      $('#preset-next').onclick = () => { presetIdx = (presetIdx + 1) % PHOTO_PRESETS.length; updatePreview(); };

      // Sliding Engine (Pointer Events)
      boardEl.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    }

    /* -------------------- THE ENGINE -------------------- */
    function onPointerDown(e) {
      const tileEl = e.target.closest('.tile');
      const st = Game.get();
      if (!tileEl || !st || st.finished) return;

      const idx = parseInt(tileEl.dataset.pos);
      const path = Game.getPath(idx);
      if (!path.length) return;

      const cell = (boardEl.offsetWidth - 16) / st.n;
      drag = {
        active: true,
        tiles: path.map(pIdx => boardEl.querySelector(`[data-pos="${pIdx}"]`)),
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        cell: cell,
        axis: Math.floor(idx/st.n) === Math.floor(st.blank/st.n) ? 'x' : 'y',
        dir: idx < st.blank ? 1 : -1,
        delta: 0
      };
      drag.tiles.forEach(t => t.classList.add('dragging'));
      tileEl.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!drag.active) return;
      const rawDelta = drag.axis === 'x' ? e.clientX - drag.startX : e.clientY - drag.startY;
      
      // Constraint to grid gap
      let clamped = drag.dir === 1 ? Math.max(0, Math.min(rawDelta, drag.cell)) : Math.min(0, Math.max(rawDelta, -drag.cell));
      drag.delta = clamped;

      drag.tiles.forEach(t => {
        const bx = parseFloat(t.dataset.bx), by = parseFloat(t.dataset.by);
        const tx = drag.axis === 'x' ? bx + clamped : bx;
        const ty = drag.axis === 'y' ? by + clamped : by;
        t.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      });
    }

    function onPointerUp(e) {
      if (!drag.active) return;
      drag.active = false;
      drag.tiles.forEach(t => t.classList.remove('dragging'));

      const velocity = Math.abs(drag.delta) / (Date.now() - drag.startTime);
      const isFlick = velocity > 0.5;
      const isHalfway = Math.abs(drag.delta) > drag.cell * 0.4;

      if (isFlick || isHalfway) {
        const anchorIdx = parseInt(drag.tiles[0].dataset.pos);
        if (Game.move(anchorIdx)) {
          Sound.play('move');
          renderBoard(false);
          if (Game.isSolved()) onWin();
          return;
        }
      }
      renderBoard(false); // Elastic snap back
    }

    function startGame() {
      const s = Storage.get().settings;
      Game.newGame({ 
        size: s.size, sequence: s.sequence, mode: s.mode, difficulty: s.difficulty,
        photoURL: s.mode === 'Photo' ? PHOTO_PRESETS[presetIdx] : null
      });
      $('#screen-home').classList.remove('active');
      $('#screen-game').classList.add('active');
      renderBoard(true);
    }

    function renderBoard(animate) {
      const st = Game.get();
      const n = st.n;
      boardEl.innerHTML = '';
      const cell = (boardEl.offsetWidth - 16) / n;

      st.board.forEach((val, i) => {
        if (val === 0) return;
        const t = document.createElement('div');
        t.className = 'tile' + (animate ? ' appear' : '');
        t.dataset.pos = i;
        t.style.width = `${cell - 4}px`;
        t.style.height = `${cell - 4}px`;
        
        if (st.mode === 'Photo') {
          t.classList.add('photo-tile');
          t.style.backgroundImage = `url(${st.photoURL})`;
          const hIdx = val - 1, hr = Math.floor(hIdx/n), hc = hIdx%n;
          t.style.backgroundSize = `${n*(cell-4)}px ${n*(cell-4)}px`;
          t.style.backgroundPosition = `-${hc*(cell-4)}px -${hr*(cell-4)}px`;
        } else t.textContent = val;

        const x = 8 + (i % n) * cell + 2;
        const y = 8 + Math.floor(i / n) * cell + 2;
        t.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        t.dataset.bx = x; t.dataset.by = y;
        boardEl.appendChild(t);
      });
      $('#hud-moves').textContent = st.moves;
    }

    function onWin() {
      Sound.play('win');
      $('#screen-result').classList.add('active');
    }

    // Helper: Logic to get specific sequences
    function getSequence(name, n) {
      if (name === 'Upside Down') return Array.from({length: n*n}, (_, i) => i).reverse();
      if (name === 'Snake') {
        const res = [];
        for (let r=0; r<n; r++) {
          let row = Array.from({length: n}, (_, c) => r*n + c);
          if (r%2 === 1) row.reverse();
          res.push(...row);
        }
        return res;
      }
      if (name === 'Spiral') {
        const res = [], grid = Array.from({length: n}, () => Array(n).fill(-1));
        let r=0, c=0, dr=0, dc=1;
        for(let i=0; i<n*n; i++) {
          res.push(r*n+c); grid[r][c]=1;
          if (grid[r+dr]?.[c+dc] !== -1) [dr, dc] = [dc, -dr];
          r+=dr; c+=dc;
        }
        return res;
      }
      return Array.from({length: n*n}, (_, i) => i);
    }

    function isPhoto() { return Storage.get().settings.mode === 'Photo'; }

    return { init, getSequence };
  })();

  document.addEventListener('DOMContentLoaded', UI.init);
})();