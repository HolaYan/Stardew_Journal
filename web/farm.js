/* Local Stardew Valley sprites, imported from the user's installed game assets.
 * Sprite coordinates follow Stardew Desk (MIT; see THIRD_PARTY.md).
 * Game artwork is loaded at runtime from the ignored game-assets directory. */
(function () {
  'use strict';
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const WEATHER = ['sunny', 'cloudy', 'rain', 'snow', 'windy', 'storm', 'fog'];
  const SEASON_FILE = { spring: 'spring', summer: 'summer', autumn: 'fall', winter: 'winter' };
  const BASE_ASSETS = ['houses', 'coop', 'mailbox', 'shipping_bin', 'chicken_white', 'chicken_brown', 'pet_cat0', 'grass', 'emotes', 'flooring', 'flooring_winter', 'fence_wood', 'crops', 'craftables', 'springobjects', 'hoedirt', 'hoedirt_snow'];
  const ASSETS = BASE_ASSETS.concat(['spring', 'summer', 'fall', 'winter'].flatMap(s => [`${s}_outdoorsTileSheet`, `${s}_outdoorsTileSheet2`, `tree1_${s}`, `tree2_${s}`, `tree3_${s}`, `board_${s}`]));
  const imageCache = new Map();
  const random = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const loadImage = url => {
    if (!imageCache.has(url)) imageCache.set(url, new Promise(resolve => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = url;
    }));
    return imageCache.get(url);
  };

  class FarmScene {
    constructor(canvas, options = {}) {
      if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('FarmScene needs a canvas element.');
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: false });
      this.surface = document.createElement('canvas');
      this.ctx = this.surface.getContext('2d', { alpha: false });
      this.options = { season: 'spring', weather: 'sunny', night: false, room: 'outdoors', tasks: [], catalog: null, assetPath: 'game-assets/img/', ...options };
      this.images = {}; this.elapsed = 0; this.confetti = 0; this.visible = true; this.destroyed = false; this.loaded = false;
      this.host = canvas.parentElement;
      this.hotspots = document.createElement('div');
      this.hotspots.className = 'farm-hotspots';
      this.hotspots.setAttribute('aria-label', '可互动农场');
      this.host?.classList.add('farm-interactive');
      this.host?.append(this.hotspots);
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.onVisibility = () => this._restart(); this.onMotion = () => this._restart();
      this.motionQuery.addEventListener('change', this.onMotion);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.resizeObserver = new ResizeObserver(() => { this._resize(); this._draw(); });
      this.resizeObserver.observe(canvas);
      if ('IntersectionObserver' in window) {
        this.intersectionObserver = new IntersectionObserver(entries => {
          this.visible = entries[0]?.isIntersecting ?? true; this._restart();
        });
        this.intersectionObserver.observe(canvas);
      }
      this._resize(); this.setOptions(options);
      this.ready = Promise.all(ASSETS.map(async name => {
        this.images[name] = await loadImage(`${this.options.assetPath}${name}.png`);
      })).then(() => {
        if (this.destroyed) return;
        this.loaded = true;
        this.canvas.dataset.gameAssets = this.images.houses ? 'ready' : 'missing';
        this._draw(); this._syncHotspots();
      });
    }
    get reducedMotion() { return this.options.reducedMotion ?? this.motionQuery.matches; }
    setOptions(options = {}) {
      if (this.destroyed) return;
      this.options = { ...this.options, ...options };
      if (!SEASONS.includes(this.options.season)) this.options.season = 'spring';
      if (!WEATHER.includes(this.options.weather)) this.options.weather = 'sunny';
      if (!['outdoors', 'kitchen'].includes(this.options.room)) this.options.room = 'outdoors';
      this.pendingTasks = (Array.isArray(this.options.tasks) ? this.options.tasks : []).filter(task => task && !task.completed)
        .slice().sort((a, b) => String(b.createdAt || b.plantedOn || '').localeCompare(String(a.createdAt || a.plantedOn || '')) || String(a.id).localeCompare(String(b.id)));
      this.cropById = new Map((this.options.catalog?.crops || []).map(crop => [crop.id, crop]));
      this.host?.classList.toggle('farm-room-kitchen', this.options.room === 'kitchen');
      this._loadCatalogImages();
      this._syncHotspots();
      this._restart();
    }
    celebrate() { if (!this.destroyed) { this.confetti = this.reducedMotion ? 0 : 2.3; this._draw(); } }
    destroy() {
      this.destroyed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
      this.intersectionObserver?.disconnect();
      this.motionQuery.removeEventListener('change', this.onMotion);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.hotspots.remove(); this.host?.classList.remove('farm-interactive', 'farm-room-kitchen');
    }
    _resize() {
      const b = this.canvas.getBoundingClientRect();
      const width = Math.max(1, b.width || 1000), height = Math.max(1, b.height || 250);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
      this.W = width < 620 ? 480 : 640;
      this.H = Math.max(140, Math.min(280, Math.round(this.W * height / width)));
      this.surface.width = this.W; this.surface.height = this.H;
      this.context.imageSmoothingEnabled = false; this.ctx.imageSmoothingEnabled = false;
      this.displayWidth = width;
      this._syncHotspots();
    }
    _loadCatalogImages() {
      const catalog = this.options.catalog || {};
      const urls = new Set([
        ...(catalog.crops || []).flatMap(crop => [crop.cropTexture, crop.texture]),
        ...Object.values(catalog.ui || {}).map(item => item?.texture)
      ].filter(Boolean));
      for (const url of urls) {
        if (this.images[url] !== undefined) continue;
        this.images[url] = null;
        loadImage(url).then(img => { if (!this.destroyed) { this.images[url] = img; this._draw(); } });
      }
    }
    _layout() {
      const compact = this.W < 600;
      const cell = Math.max(26, Math.round(32 * this.W / this.displayWidth));
      const cols = compact ? 4 : 6, rows = compact ? 3 : 2;
      const house = { x: compact ? 306 : 422, y: compact ? 22 : 5, scale: compact ? .68 : .75 };
      house.porch = house.y + 144 * house.scale;
      const field = { x: compact ? 130 : 244, y: this.H - rows * cell - 10, cols, rows, cell };
      const chest = { x: house.x + 12, y: house.porch - 22, scale: .95 };
      const room = { x: (this.W - (compact ? 380 : 408)) / 2, y: 10, width: compact ? 380 : 408, height: this.H - 20 };
      const kitchenScale = compact ? 1.8 : 1.35;
      const kitchen = { x: this.W / 2 - 30, y: 22, scale: kitchenScale };
      const pond = {x: compact ? 69 : 118, y: this.H - 83, tile: compact ? 9 : 12};
      const barn = {x: compact ? 240 : 282, y: 6, scale: compact ? .38 : .40};
      const coop = {x: compact ? 186 : 192, y: compact ? Math.min(30,field.y-60) : 10, scale: compact ? .46 : .5};
      return { compact, field, house, chest, room, kitchen, pond, barn, coop };
    }
    _plantings() {
      return this.pendingTasks || [];
    }
    _syncHotspots() {
      if (!this.hotspots || !this.W || !this.H || !this.displayWidth) return;
      const focused = this.hotspots.contains(document.activeElement) ? document.activeElement?.dataset.farmKey : null;
      this.hotspots.replaceChildren();
      if (typeof this.options.onActivate !== 'function') return;
      const { field, house, chest, room, kitchen, pond, barn, coop } = this._layout();
      const restoreRoomFocus = () => {
        if (focused && !Array.from(this.hotspots.children).some(button => button.dataset.farmKey === focused)) {
          this.hotspots.querySelector('button')?.focus({ preventScroll: true });
        }
      };
      const add = (key, bounds, label, payload, kind = 'place', permanent = label) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = `farm-hotspot farm-hotspot-${kind}`;
        button.dataset.farmKey = key;
        button.setAttribute('aria-label', label); button.title = label;
        button.style.left = `${bounds.x / this.W * 100}%`; button.style.top = `${bounds.y / this.H * 100}%`;
        button.style.width = `${bounds.width / this.W * 100}%`; button.style.height = `${bounds.height / this.H * 100}%`;
        const caption = document.createElement('span'); caption.className = 'farm-hotspot-label'; caption.textContent = permanent;
        button.append(caption);
        button.addEventListener('click', () => this.options.onActivate?.(payload));
        this.hotspots.append(button);
        if (focused === key) button.focus({ preventScroll: true });
      };
      if (this.options.room === 'kitchen') {
        const scale = kitchen.scale;
        add('kitchen-stove', { x: kitchen.x + 27 * scale, y: kitchen.y + 15 * scale, width: 29 * scale, height: 34 * scale }, '灶台 · 用仓库食材烹饪', { type: 'place', place: 'kitchen' }, 'place', '做饭');
        add('kitchen-fridge', { x: kitchen.x + 62 * scale, y: kitchen.y, width: 22 * scale, height: 48 * scale }, '冰箱 · 查看做好的料理', { type: 'place', place: 'fridge' }, 'place', '冰箱');
        add('kitchen-storage', { x: room.x + 30, y: 46, width: 42, height: 48 }, '仓库 · 查看累计收获和现有食材', { type: 'place', place: 'storage' }, 'place', '仓库');
        const exitHeight = Math.max(25, Math.ceil(28 * this.W / this.displayWidth));
        add('kitchen-exit', { x: room.x + 6, y: this.H - exitHeight - 7, width: 99, height: exitHeight }, '走出屋子，回到农田', { type: 'place', place: 'field' }, 'exit', '← 回到农田');
        restoreRoomFocus();
        return;
      }
      const tasks = this._plantings(), limit = field.cols * field.rows;
      const crops = new Map((this.options.catalog?.crops || []).map(crop => [crop.id, crop]));
      const caption = `农田 · ${tasks.length} 件${tasks.length > limit ? ' ↗' : ''}`;
      add('field', { x: field.x - 2, y: Math.max(43, field.y - 24), width: field.cols * field.cell + (tasks.length >= limit ? -28 : 4), height: 22 }, `查看全部 ${tasks.length} 件待办${tasks.length > limit ? `，还有 ${tasks.length - limit} 件未在场景中显示` : ''}`, { type: 'place', place: 'field', all: true }, 'field', caption);
      for (let i = 0; i < limit; i++) {
        const task = tasks[i], crop = task && crops.get(task.cropId);
        const bounds = { x: field.x + i % field.cols * field.cell + 1, y: field.y + Math.floor(i / field.cols) * field.cell + 1, width: field.cell - 2, height: field.cell - 2 };
        if (task) {
          const label = `${task.title}${crop ? ` · ${crop.name}` : ''} · ${task.due}，点击照料这件待办`;
          add(`task-${task.id}`, bounds, label, { type: 'task', taskId: task.id }, 'crop', task.title);
        } else add(`plot-${i}`, bounds, '空地 · 种下一件新待办', { type: 'plant' }, 'empty', '+');
      }
      if (tasks.length >= limit) add('plant-more', { x: field.x + field.cols * field.cell - 28, y: Math.max(43, field.y - 24), width: 28, height: 22 }, '再种下一件待办', { type: 'plant' }, 'plant', '+');
      add('pond', {x:pond.x+pond.tile,y:pond.y+pond.tile,width:pond.tile*4,height:pond.tile*4}, '鱼塘 · 钓鱼与每日娱乐时间', {type:'fishing'}, 'place', '钓鱼');
      const barnArt = this.options.catalog?.ui?.barn;
      if (barnArt) add('barn', {x:barn.x,y:barn.y+20*barn.scale,width:barnArt.width*barn.scale,height:(barnArt.height-20)*barn.scale}, '畜棚 · 照料牛羊、收取牛奶羊奶', {type:'animals',house:'Barn'}, 'place', '畜棚');
      add('coop', {x:coop.x,y:coop.y,width:96*coop.scale,height:112*coop.scale}, '鸡舍 · 照料鸡鸭、收取鸡蛋', {type:'animals',house:'Coop'}, 'place', '鸡舍');
      add('house', { x: house.x + 61 * house.scale, y: house.y + 82 * house.scale, width: 46 * house.scale, height: 58 * house.scale }, '进屋 · 打开厨房', { type: 'place', place: 'kitchen' }, 'place', '进屋');
      add('storage', { x: chest.x - 5, y: chest.y - 3, width: 30, height: 37 }, '仓库 · 查看累计收获和现有食材', { type: 'place', place: 'storage' }, 'place', '仓库');
      restoreRoomFocus();
    }
    _restart() {
      cancelAnimationFrame(this.frame); if (this.destroyed) return;
      this.lastFrame = 0; this._draw();
      if (!this.reducedMotion && !document.hidden && this.visible) this.frame = requestAnimationFrame(t => this._tick(t));
    }
    _tick(time) {
      if (this.destroyed || document.hidden || !this.visible || this.reducedMotion) return;
      if (!this.lastFrame || time - this.lastFrame >= 1000 / 15) {
        const dt = this.lastFrame ? Math.min(.2, (time - this.lastFrame) / 1000) : 0;
        this.elapsed += dt; this.confetti = Math.max(0, this.confetti - dt); this.lastFrame = time; this._draw();
      }
      this.frame = requestAnimationFrame(t => this._tick(t));
    }
    _rect(x, y, w, h, color) { this.ctx.fillStyle = color; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    _sprite(name, sx, sy, sw, sh, x, y, scale = 1, flip = false) {
      const img = this.images[name]; if (!img) return;
      const w = Math.round(sw * scale), h = Math.round(sh * scale); x = Math.round(x); y = Math.round(y);
      if (flip) {
        this.ctx.save(); this.ctx.translate(x + w, y); this.ctx.scale(-1, 1);
        this.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h); this.ctx.restore();
      } else this.ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }
    _tile(index, x, y, size = 16, sheet = 1) {
      const cols = sheet === 2 ? 16 : 25;
      this._sprite(`${this.season}_outdoorsTileSheet${sheet === 2 ? '2' : ''}`, index % cols * 16, Math.floor(index / cols) * 16, 16, 16, x, y, size / 16);
    }
    _object(index, x, y, scale = 1) { this._sprite('springobjects', index % 24 * 16, Math.floor(index / 24) * 16, 16, 16, x, y, scale); }
    _craft(index, x, y, scale = 1) { this._sprite('craftables', index % 8 * 16, Math.floor(index / 8) * 32, 16, 32, x, y, scale); }
    _tree(x, bottom, kind, scale = .8, flip = false) {
      const name = `tree${kind}_${this.season}`;
      this._sprite(name, 32, 96, 16, 32, x + 16 * scale, bottom - 32 * scale, scale);
      this._sprite(name, 0, 0, 48, 96, x, bottom - 96 * scale, scale, flip);
    }
    _grass(x, y, variant) {
      const row = { spring: 0, summer: 20, fall: 40, winter: 80 }[this.season];
      const sway = this.options.weather === 'windy' ? Math.round(Math.sin(this.time * 2 + x)) : 0;
      this._sprite('grass', variant * 15, row, 15, 20, x + sway, y, .85);
    }
    _fence(x, y, count, size = 12) {
      for (let i = 0; i < count; i++) {
        const p = i === 0 ? 0 : i === count - 1 ? 2 : 7;
        this._sprite('fence_wood', p % 3 * 16, Math.floor(p / 3) * 32, 16, 32, x + i * size, y - size, size / 16);
      }
    }
    _path(x, y, length, direction = 'vertical', tile = 12) {
      const name = this.season === 'winter' ? 'flooring_winter' : 'flooring';
      for (let i = 0; i < length; i++) {
        const sx = direction === 'vertical' ? 64 : 64 + (i === 0 ? 16 : i === length - 1 ? 48 : 32);
        const sy = direction === 'vertical' ? (i === 0 ? 16 : i === length - 1 ? 48 : 32) : 48;
        this._sprite(name, sx, sy, 16, 16, x + (direction === 'horizontal' ? i * tile : 0), y + (direction === 'vertical' ? i * tile : 0), tile / 16);
      }
    }
    _catalogSprite(item, x, y, scale = 1) {
      if (!item) return;
      const width = item.width || 16, height = item.height || 16;
      const columns = item.columns || Math.max(1, Math.floor((item.textureWidth || 384) / width));
      const sx = item.sx ?? (item.spriteIndex % columns * width);
      const sy = item.sy ?? (Math.floor(item.spriteIndex / columns) * height);
      this._sprite(item.texture, sx, sy, width, height, x, y, scale);
    }
    _growthStage(task, crop) {
      const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const planted = Date.parse(`${task.plantedOn || today}T12:00:00Z`), due = Date.parse(`${task.due || today}T12:00:00Z`);
      const total = due - planted, elapsed = Date.parse(`${today}T12:00:00Z`) - planted;
      const fraction = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;
      return 1 + Math.floor(fraction * Math.max(1, (crop.phaseCount || 4) - 1));
    }
    _taskField({ x, y, cols, rows, cell: tile }) {
      const soil = this.season === 'winter' ? 'hoedirt_snow' : 'hoedirt', ox = this.season === 'winter' ? 0 : 64;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const cx = col === 0 ? 1 : col === cols - 1 ? 3 : 2, cy = row === 0 ? 0 : row === rows - 1 ? 2 : 1;
        this._sprite(soil, ox + cx * 16, cy * 16, 16, 16, x + col * tile, y + row * tile, tile / 16);
      }
      const tasks = this._plantings();
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const task = tasks[row * cols + col]; if (!task) continue;
        const crop = this.cropById?.get(task.cropId), scale = Math.max(.9, Math.min(1.3, tile / 27));
        const px = x + col * tile + (tile - 16 * scale) / 2, py = y + (row + 1) * tile - 32 * scale - 2;
        if (crop && Number.isInteger(crop.cropSpriteIndex)) {
          const frame = this._growthStage(task, crop), index = crop.cropSpriteIndex;
          this._sprite(crop.cropTexture, index % 2 * 128 + frame * 16, Math.floor(index / 2) * 32, 16, 32, px, py, scale);
          this._catalogSprite(crop, x + (col + 1) * tile - 12, y + row * tile + 2, .6);
        } else this._object(472, px, y + row * tile + tile / 4, scale);
      }
    }
    _drawKitchen() {
      const c = this.ctx, { room, kitchen } = this._layout(), ui = this.options.catalog?.ui || {};
      this._rect(0, 0, this.W, this.H, '#725239');
      this._rect(room.x - 5, room.y - 4, room.width + 10, room.height + 8, '#382c28');
      c.save(); c.beginPath(); c.rect(room.x, room.y, room.width, room.height); c.clip();
      this._rect(room.x, room.y, room.width, room.height, '#deb579');
      for (let y = room.y + 40; y < this.H; y += 32) for (let x = room.x; x < room.x + room.width; x += 32) this._catalogSprite(ui.indoorFloor, x, y);
      for (let x = room.x; x < room.x + room.width; x += 16) this._catalogSprite(ui.indoorWall, x, room.y);
      this._catalogSprite(ui.kitchenUnit, kitchen.x, kitchen.y, kitchen.scale);
      this._catalogSprite(ui.chest, room.x + 42, 52, 1.1);
      this._sprite('pet_cat0', 0, 7 * 32, 32, 32, room.x + room.width * .44, this.H - 48, .8);
      c.restore();
      if (!this.images[ui.kitchenUnit?.texture]) {
        c.fillStyle = '#68492b'; c.font = '11px system-ui'; c.textAlign = 'center';
        c.fillText('正在打开厨房…', this.W / 2, this.H / 2);
      }
      this.context.drawImage(this.surface, 0, 0, this.canvas.width, this.canvas.height);
    }
    _pond(x, y, tile = 12) {
      // The game's small farm pond: water bed and animated shoreline are separate layers.
      const bed = [[1243,1244,1244,1244,1245,587],[1268,1269,1269,1269,1270,1245],[1246,1299,1246,1272,1267,1270],[-867,1322,1246,1246,1246,1249],[-883,1249,1271,1271,1271,1271],[587,1271,1248,1299,1271,587]];
      const banks = [[[183,1182],[184,1183],[211,1210],[184,1183],[185,1184],null],[[208,1207],[1293,1294,1295,1296],[209,1208],[209,1208],[284,1313],[185,1184]],[[-898],null,null,null,null,[210,1209]],[[-930,-931],null,null,null,null,[235,1290]],[[258,1257],[308,1316],null,[1293,1294,1295,1296],[309,1317],[260,1315]],[null,[258,1257],[259],[259],[260,1315],null]];
      bed.forEach((row, r) => row.forEach((id, col) => this._tile(Math.abs(id), x + col * tile, y + r * tile, tile, id < 0 ? 2 : 1)));
      banks.forEach((row, r) => row.forEach((frames, col) => {
        if (!frames) return; const id = frames[Math.floor(this.time * 1.5) % frames.length];
        this._tile(Math.abs(id), x + col * tile, y + r * tile, tile, id < 0 ? 2 : 1);
      }));
    }
    _animal(name, x, y, direction, offset = 0) {
      const walking = Math.sin(this.time * .28 + offset) > .2;
      const frame = walking ? Math.floor(this.time * 5 + offset) % 4 : 0;
      const row = walking ? (direction > 0 ? 1 : 3) : 0;
      const wander = Math.round(Math.sin(this.time * .35 + offset) * 5);
      this._sprite(name, frame * 16, row * 16, 16, 16, x + wander, y, .95, !walking && direction > 0);
    }
    _draw() {
      if (this.destroyed || !this.context || !this.ctx) return;
      const c = this.ctx, w = this.W, h = this.H; c.globalAlpha = 1;
      this.season = SEASON_FILE[this.options.season]; this.time = this.reducedMotion ? 0 : this.elapsed;
      if (this.options.room === 'kitchen') { this._drawKitchen(); return; }
      this._rect(0, 0, w, h, this.season === 'winter' ? '#c5dae9' : '#c99a54');
      if (!this.images.houses) {
        c.fillStyle = '#655239'; c.font = '12px system-ui'; c.textAlign = 'center';
        c.fillText(this.loaded ? '请先导入本机星露谷游戏素材' : '正在打开农场…', w / 2, h / 2);
        this.context.drawImage(this.surface, 0, 0, this.canvas.width, this.canvas.height); return;
      }
      const { compact, field, house, chest, pond, barn, coop } = this._layout(), dirt = [587,587,587,587,153,226,587,513,587,488];
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        const border = x < 64 || x > w - 66 || y < 25 || y > h - 10;
        this._tile(border ? 351 : dirt[Math.floor(random(x * 7 + y) * dirt.length)], x, y);
      }
      for (let x = 64; x < w - 64; x += 16) this._tile(376, x, 23);
      for (let y = 40; y < h; y += 16) { this._tile(350, 48, y); this._tile(352, w - 64, y); }
      const houseX = house.x, houseY = house.y, houseScale = house.scale;
      const porchY = house.porch;
      this._pond(pond.x, pond.y, pond.tile);
      this._path(houseX + 79 * houseScale, porchY - 4, Math.max(2, Math.ceil((h - porchY) / 12) + 1));
      this._path(compact ? 173 : 205, h - 16, compact ? 16 : 25, 'horizontal', 10);
      this._fence(compact ? 166 : 205, 64, compact ? 10 : 16, 12);
      this._fence(houseX + 130 * houseScale, porchY - 2, compact ? 3 : 5, 12);
      [[-9,88,3,.98],[24,67,1,.85],[59,61,2,.78],[w-87,71,1,.85],[w-53,84,2,.95],[w-19,70,3,.9]].forEach(([x,y,k,s]) => this._tree(x,y,k,s,Boolean(k%2)));
      const coopX = coop.x, coopY = coop.y, coopScale = coop.scale;
      this._sprite('coop', 0, 0, 96, 112, coopX, coopY, coopScale);
      this._sprite('coop', 16, 112, 16, 16, coopX + 32 * coopScale, coopY + 96 * coopScale, coopScale);
      this._catalogSprite(this.options.catalog?.ui?.barn, barn.x, barn.y, barn.scale);
      this._sprite('houses', 0, 0, 160, 144, houseX, houseY, houseScale);
      this._sprite('mailbox', 0, 0, 16, 32, houseX + 143 * houseScale, porchY - 24, .78);
      this._sprite('shipping_bin', 0, 0, 32, 32, houseX + 146 * houseScale, porchY - 51, .75);
      this._taskField(field);
      this._craft(10, compact ? 414 : 555, h - 40, .8);
      this._craft(130, chest.x, chest.y, chest.scale);
      this._craft(152, houseX - 15, porchY - 30, .8);
      const petFrame = this.options.night || ['rain','snow','storm'].includes(this.options.weather)
        ? 28 + Math.floor(this.time / 1.6) % 2 : 17 + (Math.floor(this.time / 3) % 7 === 0 ? 1 : 0);
      this._sprite('pet_cat0', petFrame % 4 * 32, Math.floor(petFrame / 4) * 32, 32, 32, houseX + 95 * houseScale, porchY - 15, .8);
      this._animal('chicken_white', compact ? 104 : 208, h - 107, 1);
      this._animal('chicken_brown', compact ? 110 : 217, h - 30, -1, 2);
      if (!compact) this._animal('chicken_white', 219, h - 18, -1, 4);
      [[4,h+20,1,1.03],[43,h+10,2,.86],[w-38,h+17,3,1.08]].forEach(([x,y,k,s]) => this._tree(x,y,k,s));
      for (let i = 0; i < 35; i++) {
        const x = i < 17 ? random(i + 40) * 88 : w - 77 + random(i + 19) * 75;
        this._grass(x, 55 + random(i + 91) * (h - 55), i % 3);
      }
      [[82,h-25,343],[w-95,h-19,450],[76,77,294]].forEach(([x,y,id]) => this._object(id,x,y,.8));
      this._weather();
      if (this.options.night) {
        c.globalAlpha = .48; this._rect(0,0,w,h,'#14294f'); c.globalAlpha = 1;
        [[houseX+80*houseScale,houseY+87*houseScale,20],[houseX+104*houseScale,houseY+87*houseScale,15],[houseX-8,porchY-20,16]].forEach(([x,y,r]) => {
          const glow=c.createRadialGradient(x,y,0,x,y,r); glow.addColorStop(0,'#ffd479b0'); glow.addColorStop(.3,'#f8be5c60'); glow.addColorStop(1,'#ffd47900');
          c.fillStyle=glow; c.fillRect(x-r,y-r,r*2,r*2);
        });
        for(let i=0;i<7;i++) if(Math.sin(this.time+i)>0) this._rect(80+random(i+50)*(w-160),45+random(i+8)*(h-50),1,1,'#f3f5a0');
      }
      if (this.confetti > 0) {
        const f=20+Math.floor(this.time*6)%4;
        this._sprite('emotes',f%4*16,Math.floor(f/4)*16,16,16,houseX+84,porchY-42,1.1);
      }
      this.context.drawImage(this.surface,0,0,this.canvas.width,this.canvas.height);
    }
    _weather() {
      const { weather }=this.options,t=this.time,w=this.W,h=this.H,c=this.ctx;
      if(weather==='rain'||weather==='storm') {
        c.globalAlpha=weather==='storm'?.28:.16;this._rect(0,0,w,h,'#263d65');c.globalAlpha=.6;
        for(let i=0;i<(weather==='storm'?85:50);i++) {
          const x=((random(i+60)*w-t*16)%w+w)%w,y=(random(i+321)*(h+20)+t*88)%(h+20)-12;
          this._rect(x,y,1,5,'#bdcfee');this._rect(x-1,y+5,1,3,'#bdcfee');
        }
        c.globalAlpha=1;
      } else if(weather==='snow') {
        for(let i=0;i<50;i++) {
          const x=(random(i+5)*(w+20)+Math.sin(t*.45+i)*5+t*3)%(w+20)-10,y=(random(i+321)*(h+12)+t*(7+random(i)*7))%(h+12)-4;
          this._rect(x,y,i%3?1:2,i%3?1:2,'#fff7e5');
        }
      } else if(weather==='windy'||this.season==='fall'&&weather==='sunny') {
        for(let i=0;i<(weather==='windy'?16:6);i++) {
          const x=(random(i+47)*(w+20)+t*(8+random(i)*6))%(w+20)-10,y=random(i+100)*h+Math.sin(t*.8+i)*5;
          this._rect(x,y,2+Math.round(Math.sin(t+i)),1,this.season==='fall'?'#e4a135':'#c7dc64');
        }
      }
      if(weather==='fog') {
        for(let i=0;i<6;i++) {c.globalAlpha=.12;this._rect(0,h*.06+i*h*.16+Math.sin(t*.1+i)*3,w,9+i,'#eff0db');}c.globalAlpha=1;
      } else if(weather==='cloudy') {c.globalAlpha=.12;this._rect(0,0,w,h,'#657687');c.globalAlpha=1;}
    }
  }
  FarmScene.assetNames = ASSETS.slice();
  window.FarmScene = FarmScene;
})();
