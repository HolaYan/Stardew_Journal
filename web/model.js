(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.MeadowModel = model;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const VERSION = 2;
  const STORAGE_KEY = 'meadow-todo:v1';
  const DAY_MS = 86400000;
  const MAX_TITLE_LENGTH = 120;
  const MAX_NOTE_LENGTH = 2000;
  const SEASONS = ['auto', 'spring', 'summer', 'autumn', 'winter'];
  const WEATHERS = ['auto', 'sunny', 'cloudy', 'rain', 'snow', 'windy', 'storm', 'fog'];
  const CATEGORIES = ['life', 'work', 'growth'];
  const CROP_HORIZONS = [7, 30, 90];
  const MAX_FISHING_MINUTES = 180;
  const pantryIds = Object.freeze(['246', '245', '247', '419', '423']);
  const DEFAULT_SETTINGS = Object.freeze({
    season: 'auto', weather: 'auto', city: null, compact: false,
    pinned: false, showCompleted: false, reducedMotion: false,
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // A calendar day is represented at UTC midnight for arithmetic only. Display
  // dates still use the user's local timezone; DST never changes a day count.
  function calendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date : null;
  }

  function isValidDate(value) {
    return calendarDate(value) !== null;
  }

  function localDate(date = new Date()) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('无效的日期');
    const year = date.getFullYear();
    if (year < 1 || year > 9999) throw new RangeError('日期超出支持范围');
    return `${String(year).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function requireDate(value) {
    const date = calendarDate(value);
    if (!date) throw new TypeError('日期必须是有效的 YYYY-MM-DD');
    return date;
  }

  function addDays(value, count) {
    if (!Number.isSafeInteger(count)) throw new TypeError('天数必须是整数');
    const date = requireDate(value);
    date.setUTCDate(date.getUTCDate() + count);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
      throw new RangeError('日期超出支持范围');
    }
    return date.toISOString().slice(0, 10);
  }

  function dayDiff(value, today = localDate()) {
    return Math.round((requireDate(value).getTime() - requireDate(today).getTime()) / DAY_MS);
  }

  function nowISO(now) {
    const date = now === undefined ? new Date() : new Date(now);
    if (!Number.isFinite(date.getTime())) throw new TypeError('无效的当前时间');
    return date.toISOString();
  }

  function timestamp(value, fallback) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return fallback;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && isValidDate(value.slice(0, 10)) ? date.toISOString() : fallback;
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function isItemId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
      && !['__proto__', 'prototype', 'constructor'].includes(value);
  }

  // Match the calendar windows used by selectTasks. A planting keeps its tier
  // as time passes; it is based on the original planting date, not today's tab.
  function cropTier(due, plantedOn = localDate()) {
    const days = dayDiff(due, plantedOn);
    return days < 7 ? 7 : days < 30 ? 30 : 90;
  }

  function addCount(counts, id, quantity) {
    if (!isItemId(id) || !Number.isSafeInteger(quantity)) throw new Error('物品数量无效');
    const value = (counts[id] || 0) + quantity;
    if (!Number.isSafeInteger(value)) throw new Error('物品数量超出支持范围');
    if (value === 0) delete counts[id];
    else counts[id] = value;
    return counts;
  }

  function totalHarvests(state) {
    const counts = {};
    for (const event of state.harvests || []) addCount(counts, event.cropId, event.quantity);
    return counts;
  }

  function totalCatches(state) {
    const counts = {};
    for (const event of state.fishing?.catches || []) addCount(counts, event.itemId, event.quantity);
    return counts;
  }

  function totalAnimalProducts(state) {
    const counts = {};
    for (const event of state.animalProducts || []) addCount(counts, event.itemId, event.quantity);
    return counts;
  }

  function totalGathered(state) {
    const counts = totalHarvests(state);
    for (const [id, count] of Object.entries(totalCatches(state))) addCount(counts, id, count);
    for (const [id, count] of Object.entries(totalAnimalProducts(state))) addCount(counts, id, count);
    return counts;
  }

  function inventory(state) {
    const counts = totalGathered(state);
    for (const event of state.cooking || []) {
      for (const ingredient of event.ingredients) addCount(counts, ingredient.id, -ingredient.count);
    }
    return counts;
  }

  function fridge(state) {
    const counts = {};
    for (const event of state.cooking || []) addCount(counts, event.outputId, event.quantity);
    return counts;
  }

  function createFishing() {
    return { dailyLimitMinutes: 10, usage: {}, catches: [] };
  }

  function validFishingLimit(minutes) {
    return Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= MAX_FISHING_MINUTES;
  }

  function validateLedgers(source, tasks) {
    const fail = message => { throw new Error(`备份中的${message}，未导入任何内容`); };
    for (const key of ['harvests', 'cooking', 'animalProducts']) {
      if (source[key] !== undefined && !Array.isArray(source[key])) fail('收获或烹饪记录格式无效');
    }
    const eventIds = new Set();
    const harvestTaskIds = new Set();
    const taskById = new Map(tasks.map(task => [task.id, task]));
    function eventId(value) {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 128 || eventIds.has(value.trim())) {
        fail('收获、钓鱼、动物或烹饪记录 ID 无效或重复');
      }
      eventIds.add(value.trim());
      return value.trim();
    }
    function eventTime(value) {
      const at = timestamp(value, null);
      if (!at || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail('收获、钓鱼、动物或烹饪时间无效');
      return at;
    }
    const harvests = (source.harvests || []).map(event => {
      if (!isRecord(event) || !isItemId(event.cropId) || event.quantity !== 1
        || typeof event.taskId !== 'string' || !event.taskId.trim() || event.taskId.trim().length > 128) {
        fail('收获记录无效');
      }
      const taskId = event.taskId.trim();
      if (harvestTaskIds.has(taskId)) fail('同一待办存在重复收获');
      harvestTaskIds.add(taskId);
      const task = taskById.get(taskId);
      // Deleted tasks deliberately leave their harvest in the warehouse.
      if (task && (!task.completed || task.cropId !== event.cropId)) fail('收获记录与待办不一致');
      return { id: eventId(event.id), taskId, cropId: event.cropId, quantity: 1, at: eventTime(event.at) };
    });
    const cooking = (source.cooking || []).map(event => {
      if (!isRecord(event) || !isItemId(event.recipeId) || !isItemId(event.outputId)
        || !Number.isSafeInteger(event.quantity) || event.quantity < 1
        || !Array.isArray(event.ingredients) || event.ingredients.length === 0) fail('烹饪记录无效');
      const ingredientIds = new Set();
      const ingredients = event.ingredients.map(ingredient => {
        if (!isRecord(ingredient) || !isItemId(ingredient.id) || pantryIds.includes(ingredient.id)
          || !Number.isSafeInteger(ingredient.count) || ingredient.count < 1 || ingredientIds.has(ingredient.id)) {
          fail('烹饪食材无效');
        }
        ingredientIds.add(ingredient.id);
        return { id: ingredient.id, count: ingredient.count };
      });
      return {
        id: eventId(event.id), recipeId: event.recipeId, outputId: event.outputId,
        quantity: event.quantity, ingredients, at: eventTime(event.at),
      };
    });
    let fishing = createFishing();
    if (source.fishing !== undefined) {
      const data = source.fishing;
      if (!isRecord(data) || !validFishingLimit(data.dailyLimitMinutes)
        || !isRecord(data.usage) || !Array.isArray(data.catches)) fail('钓鱼设置或记录格式无效');
      const usage = {};
      for (const [day, seconds] of Object.entries(data.usage)) {
        if (!isValidDate(day) || !Number.isSafeInteger(seconds) || seconds < 0
          || seconds > MAX_FISHING_MINUTES * 60) fail('钓鱼时长记录无效');
        usage[day] = seconds;
      }
      const catches = data.catches.map(event => {
        if (!isRecord(event) || !isItemId(event.itemId) || event.quantity !== 1) fail('钓鱼收获记录无效');
        return { id: eventId(event.id), itemId: event.itemId, quantity: 1, at: eventTime(event.at) };
      });
      fishing = { dailyLimitMinutes: data.dailyLimitMinutes, usage, catches };
    }
    const animalCare = {};
    if (source.animalCare !== undefined) {
      if (!isRecord(source.animalCare)) fail('动物照料记录格式无效');
      for (const [date, day] of Object.entries(source.animalCare)) {
        if (!isValidDate(date) || !isRecord(day)) fail('动物照料日期无效');
        animalCare[date] = {};
        for (const [animalId, care] of Object.entries(day)) {
          if (!isItemId(animalId) || !isRecord(care) || ['fed', 'petted', 'collected'].some(key => typeof care[key] !== 'boolean')
            || (care.petted && !care.fed) || (care.collected && !care.petted)) fail('动物照料步骤无效');
          animalCare[date][animalId] = { fed: care.fed, petted: care.petted, collected: care.collected };
        }
      }
    }
    const collected = new Set();
    const animalProducts = (source.animalProducts || []).map(event => {
      if (!isRecord(event) || !isItemId(event.animalId) || !isItemId(event.itemId)
        || event.quantity !== 1 || !isValidDate(event.date)) fail('动物产物记录无效');
      const key = `${event.date}/${event.animalId}`;
      if (collected.has(key)) fail('同一天存在重复的动物产物');
      if (!animalCare[event.date]?.[event.animalId]?.collected) fail('动物产物与照料记录不一致');
      collected.add(key);
      return {
        id: eventId(event.id), animalId: event.animalId, itemId: event.itemId,
        quantity: 1, at: eventTime(event.at), date: event.date,
      };
    });
    for (const [date, day] of Object.entries(animalCare)) {
      for (const [animalId, care] of Object.entries(day)) {
        if (care.collected && !collected.has(`${date}/${animalId}`)) fail('动物照料记录缺少已领取的产物');
      }
    }
    const ledgers = { harvests, cooking, fishing, animalCare, animalProducts };
    if (Object.values(inventory(ledgers)).some(count => count < 0)) fail('食材消耗超过收获数量');
    fridge(ledgers); // Also rejects arithmetic overflow in dish quantities.
    return ledgers;
  }

  function toggleTask(state, id, completed, options = {}) {
    if (typeof completed !== 'boolean') throw new TypeError('完成状态必须是布尔值');
    const index = state.tasks.findIndex(task => task.id === id);
    if (index < 0) throw new Error('找不到这条待办事项');
    const task = state.tasks[index];
    const ledgers = validateLedgers(state, state.tasks);
    if (task.completed === completed) return state;
    let harvests = ledgers.harvests;
    if (completed && task.cropId) {
      const crop = options.catalog?.crops?.find(item => item.id === task.cropId);
      if (!crop || crop.tier !== task.cropHorizon) throw new Error('这颗种子不属于当前种植周期，请重新选择作物');
      if (!harvests.some(event => event.taskId === id)) {
        harvests = [...harvests, { id: makeId(), taskId: id, cropId: task.cropId, quantity: 1, at: nowISO(options.now) }];
      }
    } else if (!completed) {
      const harvest = harvests.find(event => event.taskId === id);
      if (harvest) {
        if ((inventory(ledgers)[harvest.cropId] || 0) < harvest.quantity) {
          throw new Error('这份收获已经做成料理，请先在冰箱撤销相关烹饪，再恢复待办');
        }
        harvests = harvests.filter(event => event.id !== harvest.id);
      }
    }
    return {
      ...state, version: VERSION, ...ledgers,
      tasks: state.tasks.map((item, i) => i === index ? setTaskCompleted(item, completed, options) : item),
      harvests,
    };
  }

  // Both the kitchen and the mutation use these requirements. A fish category
  // is deliberately distinct from a concrete object so algae never substitute
  // for fish, and an exact fish requirement can be reserved first.
  function recipeRequirements(recipe, catalog) {
    const fishIds = [...new Set((catalog?.fish || []).filter(item => item.isFish === true && isItemId(item.id))
      .map(item => item.id))].sort();
    const animals = (catalog?.animals || []).filter(item => isItemId(item.productId));
    const categoryIds = category => [...new Set(animals.filter(animal =>
      (animal.productCategory ?? catalog?.objects?.[animal.productId]?.category) === category).map(animal => animal.productId))].sort();
    const eggIds = categoryIds(-5), milkIds = categoryIds(-6);
    const result = { supported: false, reason: 'invalid', ingredients: [], fishIds, eggIds, milkIds };
    if (!recipe || !isItemId(recipe.id) || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length
      || !Number.isSafeInteger(recipe.outputCount) || recipe.outputCount < 1) return result;
    const availableIds = new Set([...(catalog?.crops || []), ...(catalog?.fish || [])].map(item => item.id));
    for (const animal of animals) availableIds.add(animal.productId);
    const needed = {};
    for (const ingredient of recipe.ingredients) {
      if (!isRecord(ingredient) || !isItemId(ingredient.id) || !Number.isSafeInteger(ingredient.count)
        || ingredient.count < 1) return result;
      try { addCount(needed, ingredient.id, ingredient.count); } catch (_) { return result; }
    }
    result.ingredients = Object.entries(needed).map(([id, count]) => {
      const kind = pantryIds.includes(id) ? 'pantry' : ({ '-4': 'fish', '-5': 'egg', '-6': 'milk' })[id] || 'item';
      const ids = { fish: fishIds, egg: eggIds, milk: milkIds }[kind];
      return { id, count, kind, supported: kind === 'pantry' || (ids ? ids.length > 0 : availableIds.has(id)) };
    });
    if (result.ingredients.some(item => !item.supported)) result.reason = 'unsupported';
    else if (result.ingredients.every(item => item.kind === 'pantry')) result.reason = 'pantry-only';
    else { result.supported = true; result.reason = null; }
    return result;
  }

  function resolveRecipeIngredients(recipe, catalog, stock) {
    const requirements = recipeRequirements(recipe, catalog);
    const result = { supported: requirements.supported, canCook: false, ingredients: [], requirements };
    if (!requirements.supported) return result;
    const reserved = {};
    for (const item of requirements.ingredients.filter(item => item.kind === 'item')) {
      if (!Number.isSafeInteger(stock?.[item.id]) || stock[item.id] < item.count) return result;
      addCount(reserved, item.id, item.count);
    }
    for (const item of requirements.ingredients.filter(item => ['fish', 'egg', 'milk'].includes(item.kind))) {
      let left = item.count;
      for (const id of requirements[`${item.kind}Ids`]) {
        const owned = stock?.[id];
        if (!Number.isSafeInteger(owned) || owned < 0) continue;
        const count = Math.min(left, Math.max(0, owned - (reserved[id] || 0)));
        if (count) addCount(reserved, id, count);
        left -= count;
        if (left === 0) break;
      }
      if (left > 0) return result;
    }
    result.ingredients = Object.entries(reserved).map(([id, count]) => ({ id, count }));
    result.canCook = true;
    return result;
  }

  function cookRecipe(state, recipeId, catalog, options = {}) {
    const ledgers = validateLedgers(state, state.tasks);
    const recipe = catalog?.recipes?.find(item => item.id === recipeId);
    const resolved = resolveRecipeIngredients(recipe, catalog, inventory(ledgers));
    if (resolved.requirements.reason === 'invalid') throw new Error('找不到有效的游戏食谱');
    if (resolved.requirements.reason === 'unsupported') throw new Error('这道料理需要尚未提供的食材');
    if (resolved.requirements.reason === 'pantry-only') throw new Error('请使用自己收获的食材制作料理');
    if (!resolved.canCook) throw new Error('仓库里的食材还不够，收获作物、钓鱼或照料动物可以获得更多食材');
    const cooking = [...ledgers.cooking, {
      id: makeId(), recipeId: recipe.id, outputId: recipe.id, quantity: recipe.outputCount,
      ingredients: resolved.ingredients, at: nowISO(options.now),
    }];
    fridge({ cooking });
    return { ...state, version: VERSION, ...ledgers, cooking };
  }

  function undoCooking(state, cookingId) {
    const ledgers = validateLedgers(state, state.tasks);
    if (!ledgers.cooking.some(event => event.id === cookingId)) throw new Error('找不到这份料理的烹饪记录');
    // Fridge dishes cannot be consumed or used as ingredients, so every batch
    // remains reversible and removing it returns the exact crops and fish used.
    return { ...state, version: VERSION, ...ledgers, cooking: ledgers.cooking.filter(event => event.id !== cookingId) };
  }

  function fishingStatus(state, options = {}) {
    const today = options.today || localDate();
    requireDate(today);
    const fishing = state.fishing === undefined ? createFishing() : state.fishing;
    if (!isRecord(fishing) || !validFishingLimit(fishing.dailyLimitMinutes) || !isRecord(fishing.usage)) {
      throw new Error('钓鱼设置无效');
    }
    const usedSeconds = fishing.usage[today] === undefined ? 0 : fishing.usage[today];
    if (!Number.isSafeInteger(usedSeconds) || usedSeconds < 0 || usedSeconds > MAX_FISHING_MINUTES * 60) {
      throw new Error('钓鱼时长记录无效');
    }
    const limitSeconds = fishing.dailyLimitMinutes * 60;
    return { limitSeconds, usedSeconds, remainingSeconds: Math.max(0, limitSeconds - usedSeconds) };
  }

  function setFishingLimit(state, minutes) {
    if (!validFishingLimit(minutes)) throw new Error(`每天钓鱼时间必须是 0 到 ${MAX_FISHING_MINUTES} 分钟之间的整数`);
    const ledgers = validateLedgers(state, state.tasks);
    return { ...state, version: VERSION, ...ledgers, fishing: { ...ledgers.fishing, dailyLimitMinutes: minutes } };
  }

  function spendFishingTime(state, seconds, options = {}) {
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('钓鱼时长必须是非负整数秒');
    const today = options.today || localDate();
    const ledgers = validateLedgers(state, state.tasks);
    const { usedSeconds, remainingSeconds } = fishingStatus(ledgers, { today });
    const spent = Math.min(seconds, remainingSeconds);
    if (spent === 0) return state;
    return { ...state, version: VERSION, ...ledgers, fishing: {
      ...ledgers.fishing, usage: { ...ledgers.fishing.usage, [today]: usedSeconds + spent },
    } };
  }

  function catchFish(state, itemId, catalog, options = {}) {
    if (!isItemId(itemId) || !catalog?.fish?.some(item => item.id === itemId)) throw new Error('找不到这份钓鱼收获');
    const ledgers = validateLedgers(state, state.tasks);
    return { ...state, version: VERSION, ...ledgers, fishing: {
      ...ledgers.fishing,
      catches: [...ledgers.fishing.catches, { id: makeId(), itemId, quantity: 1, at: nowISO(options.now) }],
    } };
  }

  function careForAnimal(state, animalId, action, catalog, options = {}) {
    const animal = catalog?.animals?.find(item => item.id === animalId);
    if (!isItemId(animalId) || !animal || !isItemId(animal.productId)) throw new Error('找不到这只农场动物');
    if (!['feed', 'pet', 'collect'].includes(action)) throw new Error('无效的动物照料操作');
    const at = nowISO(options.now);
    const today = options.today || localDate(new Date(at));
    requireDate(today);
    const ledgers = validateLedgers(state, state.tasks);
    const day = ledgers.animalCare[today] || {};
    const care = day[animalId] || { fed: false, petted: false, collected: false };
    const key = { feed: 'fed', pet: 'petted', collect: 'collected' }[action];
    if (care[key]) throw new Error('今天已经完成这一步照料，明天再来看看吧');
    if (action === 'pet' && !care.fed) throw new Error('请先喂食，再摸摸它');
    if (action === 'collect' && (!care.fed || !care.petted)) throw new Error('请先喂食并摸摸它，再领取今天的产物');
    const animalCare = { ...ledgers.animalCare, [today]: { ...day, [animalId]: { ...care, [key]: true } } };
    const animalProducts = action === 'collect' ? [...ledgers.animalProducts, {
      id: makeId(), animalId, itemId: animal.productId, quantity: 1, at, date: today,
    }] : ledgers.animalProducts;
    return { ...state, version: VERSION, ...ledgers, animalCare, animalProducts };
  }

  function normalizeTask(input, options = {}) {
    if (!isRecord(input) || typeof input.title !== 'string') return null;
    const title = input.title.trim().slice(0, MAX_TITLE_LENGTH);
    const due = input.due === undefined ? input.dueDate : input.due;
    if (!title || !isValidDate(due)) return null;
    const now = nowISO(options.now);
    const completed = input.completed === true;
    const createdAt = timestamp(input.createdAt, now);
    const plantedOn = isValidDate(input.plantedOn) ? input.plantedOn : localDate(new Date(createdAt));
    return {
      id: typeof input.id === 'string' && input.id.trim() ? input.id.trim().slice(0, 128) : makeId(),
      title,
      note: typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE_LENGTH) : '',
      due,
      category: CATEGORIES.includes(input.category) ? input.category : 'life',
      priority: input.priority === 'high' ? 'high' : 'normal',
      completed,
      createdAt,
      cropId: isItemId(input.cropId) ? input.cropId : null,
      plantedOn,
      cropHorizon: CROP_HORIZONS.includes(input.cropHorizon) ? input.cropHorizon : cropTier(due, plantedOn),
      completedAt: completed ? timestamp(input.completedAt, now) : null,
    };
  }

  function normalizeSeason(value) {
    return value === 'fall' ? 'autumn' : value;
  }

  function normalizeWeather(value) {
    return ({ rainy: 'rain', snowy: 'snow', stormy: 'storm' })[value] || value;
  }

  function normalizeCity(value) {
    if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) return null;
    if (!Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) return null;
    if (!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) return null;
    return { name: value.name.trim().slice(0, 80), latitude: value.latitude, longitude: value.longitude };
  }

  function normalizeSettings(input) {
    const source = isRecord(input) ? input : {};
    const season = normalizeSeason(source.season);
    const weather = normalizeWeather(source.weather);
    return {
      season: SEASONS.includes(season) ? season : DEFAULT_SETTINGS.season,
      weather: WEATHERS.includes(weather) ? weather : DEFAULT_SETTINGS.weather,
      city: normalizeCity(source.city),
      compact: source.compact === true,
      pinned: source.pinned === true,
      showCompleted: source.showCompleted === true,
      reducedMotion: source.reducedMotion === true,
    };
  }

  function createState() {
    return {
      version: VERSION, tasks: [], settings: { ...DEFAULT_SETTINGS }, harvests: [], cooking: [],
      fishing: createFishing(), animalCare: {}, animalProducts: [],
    };
  }

  function normalizeState(input, options = {}) {
    const source = Array.isArray(input) ? { tasks: input } : isRecord(input) ? input : {};
    // Future formats must not be interpreted as the current format.
    if (source.version !== undefined && (!Number.isInteger(source.version) || source.version > VERSION || source.version < 0)) {
      return createState();
    }
    const ids = new Set();
    const tasks = [];
    const now = nowISO(options.now);
    for (const candidate of Array.isArray(source.tasks) ? source.tasks : []) {
      const task = normalizeTask(candidate, { now });
      if (task && !ids.has(task.id)) {
        ids.add(task.id);
        tasks.push(task);
      }
    }
    const ledgers = validateLedgers(source, tasks);
    return { version: VERSION, tasks, settings: normalizeSettings(source.settings), ...ledgers };
  }

  function sortTasks(tasks, options = {}) {
    const today = options.today || localDate();
    requireDate(today);
    return tasks.slice().sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const dateOrder = a.due.localeCompare(b.due);
      if (dateOrder) return dateOrder;
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      const createdOrder = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      return createdOrder || a.title.localeCompare(b.title, 'zh-CN');
    });
  }

  // The window is cumulative: 7 means today and the following 6 days. All
  // overdue tasks are retained so changing horizons cannot hide unfinished work.
  function selectTasks(tasks, options = {}) {
    const today = options.today || localDate();
    const days = options.days === undefined ? 7 : options.days;
    requireDate(today);
    if (!Number.isSafeInteger(days) || days < 1) throw new TypeError('时间范围必须是正整数');
    const selected = tasks.filter(task => isValidDate(task.due) && (options.showCompleted === true || !task.completed)
      && dayDiff(task.due, today) < days);
    return sortTasks(selected, { today });
  }

  function groupTasks(tasks, options = {}) {
    const today = options.today || localDate();
    requireDate(today);
    const groups = new Map();
    for (const task of sortTasks(tasks, { today })) {
      const diff = dayDiff(task.due, today);
      const key = diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : task.due;
      if (!groups.has(key)) {
        const label = key === 'overdue' ? '已逾期' : key === 'today' ? '今天' : key === 'tomorrow' ? '明天' : task.due;
        groups.set(key, { key, label, tasks: [] });
      }
      groups.get(key).tasks.push(task);
    }
    const rank = key => key === 'overdue' ? -Infinity : key === 'today' ? 0 : key === 'tomorrow' ? 1 : dayDiff(key, today);
    return Array.from(groups.values()).sort((a, b) => rank(a.key) - rank(b.key));
  }

  function setTaskCompleted(task, completed, options = {}) {
    if (typeof completed !== 'boolean') throw new TypeError('完成状态必须是布尔值');
    const normalized = normalizeTask(task, options);
    if (!normalized) throw new TypeError('无效的待办事项');
    return {
      ...normalized,
      completed,
      completedAt: completed ? (normalized.completed ? normalized.completedAt : nowISO(options.now)) : null,
    };
  }

  function validateImportSettings(settings) {
    if (settings === undefined) return;
    if (!isRecord(settings)) throw new Error('备份中的设置格式无效');
    if (settings.season !== undefined && !SEASONS.includes(normalizeSeason(settings.season))) {
      throw new Error('备份中的季节设置无效');
    }
    if (settings.weather !== undefined && !WEATHERS.includes(normalizeWeather(settings.weather))) {
      throw new Error('备份中的天气设置无效');
    }
    for (const key of ['compact', 'pinned', 'showCompleted', 'reducedMotion']) {
      if (settings[key] !== undefined && typeof settings[key] !== 'boolean') throw new Error(`备份中的 ${key} 设置无效`);
    }
    if (settings.city !== undefined && settings.city !== null && normalizeCity(settings.city) === null) {
      throw new Error('备份中的城市设置无效');
    }
  }

  function parseBackup(json, options = {}) {
    if (typeof json !== 'string' || json.length > 10 * 1024 * 1024) throw new Error('请选择有效的 JSON 备份（最大 10 MB）');
    let input;
    try { input = JSON.parse(json); } catch (_) { throw new Error('无法读取备份：JSON 格式无效'); }
    const source = Array.isArray(input) ? { tasks: input } : input;
    if (!isRecord(source) || !Array.isArray(source.tasks)) throw new Error('备份必须包含待办事项列表');
    if (source.version !== undefined && (!Number.isInteger(source.version) || source.version < 0 || source.version > VERSION)) {
      throw new Error('此备份版本暂不受支持');
    }
    validateImportSettings(source.settings);
    const now = nowISO(options.now);
    const ids = new Set();
    const tasks = source.tasks.map((candidate, index) => {
      const error = () => new Error(`备份中的第 ${index + 1} 条待办事项无效，未导入任何内容`);
      const task = normalizeTask(candidate, { now });
      if (!task) throw error();
      // Optional legacy fields are filled in; explicitly malformed data is
      // rejected as a whole instead of silently removing a user's tasks.
      if (candidate.id !== undefined && (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.trim().length > 128)) throw error();
      if (candidate.note !== undefined && typeof candidate.note !== 'string') throw error();
      if (candidate.category !== undefined && !CATEGORIES.includes(candidate.category)) throw error();
      if (candidate.priority !== undefined && !['normal', 'high'].includes(candidate.priority)) throw error();
      if (candidate.completed !== undefined && typeof candidate.completed !== 'boolean') throw error();
      if (candidate.createdAt !== undefined && timestamp(candidate.createdAt, null) === null) throw error();
      if (candidate.completedAt !== undefined && candidate.completedAt !== null && timestamp(candidate.completedAt, null) === null) throw error();
      if (candidate.cropId !== undefined && candidate.cropId !== null && !isItemId(candidate.cropId)) throw error();
      if (candidate.plantedOn !== undefined && !isValidDate(candidate.plantedOn)) throw error();
      if (candidate.cropHorizon !== undefined && !CROP_HORIZONS.includes(candidate.cropHorizon)) throw error();
      if (ids.has(task.id)) throw new Error('备份中存在重复的待办事项 ID，未导入任何内容');
      ids.add(task.id);
      return task;
    });
    const ledgers = validateLedgers(source, tasks);
    return { version: VERSION, tasks, settings: normalizeSettings(source.settings), ...ledgers };
  }

  function exportBackup(state, options = {}) {
    // Saving uses the same atomic validation as importing: a malformed task or
    // ledger must never disappear silently from the user's next backup.
    return JSON.stringify(parseBackup(JSON.stringify(state), options), null, 2);
  }

  function loadState(storage, key = STORAGE_KEY) {
    try {
      const saved = storage.getItem(key);
      return saved === null ? createState() : normalizeState(JSON.parse(saved));
    } catch (_) {
      return createState();
    }
  }

  function saveState(storage, state, key = STORAGE_KEY) {
    try {
      storage.setItem(key, exportBackup(state));
      return true;
    } catch (_) {
      return false;
    }
  }

  return Object.freeze({
    VERSION, STORAGE_KEY, MAX_TITLE_LENGTH, MAX_NOTE_LENGTH, DEFAULT_SETTINGS,
    SEASONS: Object.freeze(SEASONS), WEATHERS: Object.freeze(WEATHERS), CATEGORIES: Object.freeze(CATEGORIES),
    isValidDate, localDate, addDays, dayDiff, normalizeTask, normalizeSettings,
    createState, normalizeState, sortTasks, selectTasks, groupTasks, setTaskCompleted,
    pantryIds, CROP_HORIZONS: Object.freeze(CROP_HORIZONS), cropTier, toggleTask, cookRecipe, undoCooking,
    inventory, fridge, totalHarvests, totalCatches, totalAnimalProducts, totalGathered, recipeRequirements, resolveRecipeIngredients,
    fishingStatus, setFishingLimit, spendFishingTime, catchFish,
    careForAnimal,
    parseBackup, exportBackup, loadState, saveState,
  });
});
