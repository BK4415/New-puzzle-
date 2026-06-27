/**
 * PREMIUM SLIDING ENGINE
 * Focus: Smooth 60FPS multi-tile sliding, unified pointer tracking, and physics interpolation.
 */
class SlidingEngine {
    constructor() {
        this.container = document.getElementById('game-container');
        this.size = 4; // Default grid dimension (4x4)
        this.tiles = [];
        this.emptyPos = { x: 3, y: 3 };
        this.tileSize = 0;
        this.isDragging = false;
        
        // Interaction & Vector Tracking State
        this.dragData = {
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            axis: null,          // 'x' or 'y'
            affectedTiles: [],   // Array of tiles shifting simultaneously
            direction: 0,        // 1 (right/down) or -1 (left/up)
            maxDelta: 0,         // Maximum physical tracking boundary (tile width + gap)
            startTime: 0
        };

        this.setupEvents();
        this.init(4);
        this.animate(); // Starts the 60FPS rendering heartbeat
    }

    /**
     * Initializes or resets the board layout with a given grid size.
     */
    init(size) {
        this.size = size;
        this.container.innerHTML = '';
        this.container.style.setProperty('--grid-size', size);
        this.tiles = [];
        this.emptyPos = { x: size - 1, y: size - 1 };
        
        const rect = this.container.getBoundingClientRect();
        const padding = parseInt(getComputedStyle(this.container).paddingLeft) || 0;
        const gap = parseInt(getComputedStyle(this.container).gap) || 0;
        this.tileSize = (rect.width - (padding * 2) - (gap * (size - 1))) / size;

        // Populate background slots and interactive tiles
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                this.createSlot(x, y);
                if (x === size - 1 && y === size - 1) continue; // Leave the last cell vacant
                this.createTile(x, y, (y * size) + x + 1);
            }
        }
    }

    /**
     * Generates a static background slot for visual depth.
     */
    createSlot(x, y) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.style.width = `${this.tileSize}px`;
        slot.style.height = `${this.tileSize}px`;
        const pos = this.getTilePosition(x, y);
        slot.style.left = `${pos.left}px`;
        slot.style.top = `${pos.top}px`;
        this.container.appendChild(slot);
    }

    /**
     * Generates an interactive sliding tile and registers its physical tracking properties.
     */
    createTile(x, y, number) {
        const el = document.createElement('div');
        el.className = 'tile';
        el.style.width = `${this.tileSize}px`;
        el.style.height = `${this.tileSize}px`;
        el.innerHTML = `<div class="tile-number">${number}</div>`;
        
        const tile = {
            el,
            x,
            y,
            targetX: x,
            targetY: y,
            offsetX: 0, // Real-time drag displacement offset along the X axis
            offsetY: 0, // Real-time drag displacement offset along the Y axis
            currentVisualX: 0,
            currentVisualY: 0
        };
        
        this.tiles.push(tile);
        this.container.appendChild(el);
        this.updateTileDOM(tile);
    }

    /**
     * Calculates absolute bounding box positions based on matrix coordinates.
     */
    getTilePosition(x, y) {
        const gap = parseInt(getComputedStyle(this.container).gap) || 0;
        const padding = parseInt(getComputedStyle(this.container).paddingLeft) || 0;
        return {
            left: padding + x * (this.tileSize + gap),
            top: padding + y * (this.tileSize + gap)
        };
    }

    /**
     * Writes baseline positions immediately onto the element before interpolation takes over.
     */
    updateTileDOM(tile) {
        const basePos = this.getTilePosition(tile.x, tile.y);
        tile.currentVisualX = basePos.left + tile.offsetX;
        tile.currentVisualY = basePos.top + tile.offsetY;
        tile.el.style.transform = `translate3d(${tile.currentVisualX}px, ${tile.currentVisualY}px, 0)`;
    }

    /**
     * Attaches unified pointer event handlers supporting touch, mouse, and stylus devices flawlessly.
     */
    setupEvents() {
        this.container.addEventListener('pointerdown', this.onPointerDown.bind(this));
        window.addEventListener('pointermove', this.onPointerMove.bind(this));
        window.addEventListener('pointerup', this.onPointerUp.bind(this));
        window.addEventListener('pointercancel', this.onPointerUp.bind(this));
    }

    /**
     * Prepares vector boundaries and identifies affected multi-tile blocks on user interaction.
     */
    onPointerDown(e) {
        const tileEl = e.target.closest('.tile');
        if (!tileEl) return;

        const tile = this.tiles.find(t => t.el === tileEl);
        if (!tile) return;

        // Verify if the tile shares a row or a column with the empty slot
        const canMoveX = tile.y === this.emptyPos.y;
        const canMoveY = tile.x === this.emptyPos.x;

        if (!canMoveX && !canMoveY) return;

        this.isDragging = true;
        this.dragData = {
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
            axis: null,
            startTime: performance.now(),
            affectedTiles: this.getAffectedTiles(tile),
            maxDelta: this.tileSize + (parseInt(getComputedStyle(this.container).gap) || 0)
        };

        // Instantly lock vector tracking limits based on empty space relative offsets
        if (canMoveX) {
            this.dragData.axis = 'x';
            this.dragData.direction = tile.x < this.emptyPos.x ? 1 : -1;
        } else {
            this.dragData.axis = 'y';
            this.dragData.direction = tile.y < this.emptyPos.y ? 1 : -1;
        }

        tileEl.setPointerCapture(e.pointerId);
    }

    /**
     * Evaluates and aggregates all cascading tiles situated between the selection and the blank space.
     */
    getAffectedTiles(clickedTile) {
        let affected = [];
        if (clickedTile.y === this.emptyPos.y) {
            const min = Math.min(clickedTile.x, this.emptyPos.x);
            const max = Math.max(clickedTile.x, this.emptyPos.x);
            affected = this.tiles.filter(t => t.y === clickedTile.y && t.x >= min && t.x <= max);
        } else {
            const min = Math.min(clickedTile.y, this.emptyPos.y);
            const max = Math.max(clickedTile.y, this.emptyPos.y);
            affected = this.tiles.filter(t => t.x === clickedTile.x && t.y >= min && t.y <= max);
        }
        return affected;
    }

    /**
     * Drives fluid displacement changes across all grouped tiles while maintaining hardware constraints.
     */
    onPointerMove(e) {
        if (!this.isDragging) return;

        this.dragData.currentX = e.clientX;
        this.dragData.currentY = e.clientY;

        let delta = this.dragData.axis === 'x'
            ? (this.dragData.currentX - this.dragData.startX)
            : (this.dragData.currentY - this.dragData.startY);

        // Limit the dragging distance strictly between 0 and 1 full tile slot length
        if (this.dragData.direction === 1) {
            delta = Math.max(0, Math.min(delta, this.dragData.maxDelta));
        } else {
            delta = Math.min(0, Math.max(delta, -this.dragData.maxDelta));
        }

        // Apply spatial offset displacement updates across all moving elements
        this.dragData.affectedTiles.forEach(tile => {
            if (this.dragData.axis === 'x') {
                tile.offsetX = delta;
            } else {
                tile.offsetY = delta;
            }
        });
    }

    /**
     * Determines whether to commit a sliding action or snap tiles backward on pointer release.
     */
    onPointerUp(e) {
        if (!this.isDragging) return;
        this.isDragging = false;

        const time = performance.now() - this.dragData.startTime;
        let delta = this.dragData.axis === 'x' 
            ? (this.dragData.currentX - this.dragData.startX) 
            : (this.dragData.currentY - this.dragData.startY);
        
        const velocity = Math.abs(delta) / time; // Track input speed (pixels per millisecond)
        const threshold = this.dragData.maxDelta * 0.4;
        const isFlick = velocity > 0.5;
        const isHalfway = Math.abs(delta) > threshold;

        if (isFlick || isHalfway) {
            // Confirm tracking direction aligns perfectly with structural move allowances
            const correctDirection = (delta * this.dragData.direction) > 0;
            if (correctDirection) {
                this.completeMove();
                return;
            }
        }

        this.cancelMove();
    }

    /**
     * Updates underlying structural grid coordinate states once an intentional transition clears thresholds.
     */
    completeMove() {
        if (this.dragData.axis === 'x') {
            // Reposition the blank space coordinates to the origin of the swipe cascade
            this.emptyPos.x = this.dragData.direction === 1 ? 
                Math.min(...this.dragData.affectedTiles.map(t => t.x)) : 
                Math.max(...this.dragData.affectedTiles.map(t => t.x));
            
            this.dragData.affectedTiles.forEach(t => t.x += this.dragData.direction);
        } else {
            this.emptyPos.y = this.dragData.direction === 1 ? 
                Math.min(...this.dragData.affectedTiles.map(t => t.y)) : 
                Math.max(...this.dragData.affectedTiles.map(t => t.y));
                
            this.dragData.affectedTiles.forEach(t => t.y += this.dragData.direction);
        }

        this.resetOffsets();
    }

    cancelMove() {
        this.resetOffsets();
    }

    resetOffsets() {
        // Clearing tracking offsets allows the animation loop to gracefully lerp tiles to their structural homes
        this.dragData.affectedTiles.forEach(tile => {
            tile.offsetX = 0;
            tile.offsetY = 0;
        });
    }

    /**
     * Executes fully solvable configurations by back-tracking real sequential random moves.
     */
    shuffle() {
        const shuffleSteps = 200;
        for (let i = 0; i < shuffleSteps; i++) {
            // Isolate valid structural tiles immediate to the current vacant position coordinates
            const neighbors = this.tiles.filter(t => 
                (Math.abs(t.x - this.emptyPos.x) === 1 && t.y === this.emptyPos.y) ||
                (Math.abs(t.y - this.emptyPos.y) === 1 && t.x === this.emptyPos.x)
            );
            const randomTile = neighbors[Math.floor(Math.random() * neighbors.length)];
            if (!randomTile) continue;
            
            // Swap matrix coordinates cleanly
            const tx = randomTile.x;
            const ty = randomTile.y;
            randomTile.x = this.emptyPos.x;
            randomTile.y = this.emptyPos.y;
            this.emptyPos.x = tx;
            this.emptyPos.y = ty;
        }
    }

    /**
     * The Engine Heartbeat Loop
     * Runs continuous GPU-accelerated linear interpolation updates over positions independent of raw input events.
     */
    animate() {
        this.tiles.forEach(tile => {
            const base = this.getTilePosition(tile.x, tile.y);
            const targetX = base.left + tile.offsetX;
            const targetY = base.top + tile.offsetY;

            // Linear Interpolation (Lerp) calculations: Visual += (Target - Visual) * InterpolationFactor
            tile.currentVisualX += (targetX - tile.currentVisualX) * 0.2;
            tile.currentVisualY += (targetY - tile.currentVisualY) * 0.2;

            // High-precision snapping thresholds to prevent infinite micro-render calculations
            if (Math.abs(tile.currentVisualX - targetX) < 0.1) tile.currentVisualX = targetX;
            if (Math.abs(tile.currentVisualY - targetY) < 0.1) tile.currentVisualY = targetY;

            // Apply hardware-accelerated translations
            tile.el.style.transform = `translate3d(${tile.currentVisualX}px, ${tile.currentVisualY}px, 0)`;
        });

        requestAnimationFrame(this.animate.bind(this));
    }
}

// Global initialization hook
const engine = new SlidingEngine();

// Responsive viewport management
window.addEventListener('resize', () => {
    engine.init(engine.size);
});
