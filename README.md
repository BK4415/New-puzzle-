# Number Puzzle Pro

A premium sliding-puzzle web app built with **pure HTML, CSS and JavaScript** — no frameworks, no build step. Drop the folder on any static host (or open `index.html` directly) and it works.

## Highlights

- 🎯 Board sizes **3×3 → 7×7** (8×8 and custom-size hooks already in code)
- 🔢 Four sequences: **Classic**, **Upside Down**, **Spiral**, **Snake**
- 🖼 Two modes: **Number** & **Photo** (drag-drop, file picker, camera capture, auto-optimized)
- 🎮 Hint, Undo, Redo, Pause, Restart, Shuffle, Fullscreen
- ⏱ Move counter + timer (starts on first move)
- 🏆 Trophy reveal + confetti + fireworks on win
- 💾 LocalStorage: high scores per (size × sequence × mode), stats, achievements, last game
- 📊 Dashboard panel (swipe left on Home or 📊 icon)
- ℹ️ Info panel (swipe right on Home or ☰ icon)
- 🌙 Dark theme, ♿ reduced-motion aware
- 📱 PWA: installable + offline (manifest + service worker)
- ⌨️ Keyboard, touch, swipe and mouse controls
- 🔁 Export / Import / Reset data, corrupted-save recovery

## Run locally

```bash
# any static server works, e.g.
python3 -m http.server 8080
# then open http://localhost:8080
```

> Service worker, camera, and `navigator.share` require an `https://` origin (or `localhost`).

## File structure

```
/
├── index.html
├── style.css
├── script.js
├── manifest.json
├── service-worker.js
├── README.md
├── assets/
│   ├── icons/    (app icon)
│   ├── sounds/   (reserved — sounds are generated via WebAudio)
│   ├── trophies/ (reserved for future trophy art)
│   └── themes/   (reserved for future theme packs)
└── pages/
    ├── about.html
    ├── guide.html
    └── privacy.html
```

## Future expansion (already wired)

- Add to `SIZES` (e.g. `8`) — UI picker, preview, board, sequences all adapt.
- Add a generator to `SequenceGen` (e.g. `Diagonal`) and push to `SEQUENCES`.
- Add achievements to `ACHIEVEMENTS` — auto-checked after every win.
- Online leaderboard / cloud save: replace `Storage` module's `localStorage` calls with an HTTP backend.
- Theme packs: drop new CSS files in `assets/themes/` and load via `<link>`.

© 2026 Number Puzzle Pro.