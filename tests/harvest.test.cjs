'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/model.js');
const NOW = '2026-10-18T14:30:00.000Z';
const catalog = {
  crops: [{ id: '24', tier: 7 }, { id: '192', tier: 7 }, { id: '276', tier: 30 }, { id: '258', tier: 90 }],
  recipes: [
    { id: '199', ingredients: [{ id: '24', count: 1 }, { id: '246', count: 1 }, { id: '245', count: 1 }], outputCount: 1 },
    { id: '202', ingredients: [{ id: '24', count: 2 }, { id: '192', count: 1 }], outputCount: 2 },
    { id: '216', ingredients: [{ id: '246', count: 1 }], outputCount: 1 },
    { id: '194', ingredients: [{ id: '176', count: 1 }], outputCount: 1 },
  ],
};
function task(id = 'a', extra = {}) {
  return M.normalizeTask({ id, title: id, due: '2026-10-21', cropId: '24', ...extra }, { now: NOW });
}
function planted(tasks = [task()]) {
  return { ...M.createState(), tasks };
}
function harvestAll(state) {
  return state.tasks.reduce((next, item) => M.toggleTask(next, item.id, true, { catalog, now: NOW }), state);
}

test('version 1 migration keeps every original task and gives no retroactive harvest', () => {
  const original = {
    id: 'old', title: '保留我的待办', note: '我的文字', due: '2026-11-18', category: 'work',
    priority: 'high', completed: true, createdAt: NOW, completedAt: NOW,
  };
  const state = M.parseBackup(JSON.stringify({ version: 1, tasks: [original], settings: { compact: true } }));
  for (const [key, value] of Object.entries(original)) assert.equal(state.tasks[0][key], value);
  assert.equal(state.version, 2);
  assert.equal(state.tasks[0].cropId, null);
  assert.equal(state.tasks[0].plantedOn, '2026-10-18');
  assert.equal(state.tasks[0].cropHorizon, 90);
  assert.deepEqual(state.harvests, []);
  assert.deepEqual(state.cooking, []);
  assert.deepEqual(M.totalHarvests(state), {});
  assert.equal(state.settings.compact, true);
});

test('planting tier follows calendar windows and stays stable on normalization', () => {
  for (const [offset, tier] of [[-1, 7], [0, 7], [6, 7], [7, 30], [29, 30], [30, 90], [300, 90]]) {
    assert.equal(M.cropTier(M.addDays('2026-10-18', offset), '2026-10-18'), tier);
  }
  const source = task('a', { due: '2026-11-18', cropHorizon: 90 });
  const restored = M.normalizeTask(source, { now: '2026-11-17T12:00:00Z' });
  assert.equal(restored.plantedOn, '2026-10-18');
  assert.equal(restored.cropHorizon, 90);
});

test('completion creates exactly one harvest and never mutates its input', () => {
  const source = planted();
  const snapshot = JSON.stringify(source);
  const completed = harvestAll(source);
  assert.equal(JSON.stringify(source), snapshot);
  assert.equal(completed.tasks[0].completed, true);
  assert.equal(completed.harvests.length, 1);
  assert.equal(completed.harvests[0].at, NOW);
  assert.deepEqual(M.inventory(completed), { 24: 1 });
  const repeated = M.toggleTask(completed, 'a', true, { catalog, now: '2026-10-19T12:00:00Z' });
  assert.deepEqual(repeated, completed);
  assert.deepEqual(M.totalHarvests(repeated), { 24: 1 });
});

test('reopening returns a harvest, repeated toggles cannot duplicate crops', () => {
  let state = planted();
  for (let index = 0; index < 5; index += 1) {
    state = harvestAll(state);
    assert.deepEqual(M.inventory(state), { 24: 1 });
    state = M.toggleTask(state, 'a', false, { catalog, now: NOW });
    assert.deepEqual(M.inventory(state), {});
    assert.equal(state.harvests.length, 0);
    assert.equal(state.tasks[0].completedAt, null);
  }
});

test('completion rejects an unknown crop or crop from another planting tier', () => {
  for (const cropId of ['missing', '276']) {
    const source = planted([task('a', { cropId })]);
    assert.throws(() => harvestAll(source), /种植周期/);
    assert.equal(source.tasks[0].completed, false);
    assert.deepEqual(source.harvests, []);
  }
  assert.throws(() => M.toggleTask(planted(), 'missing', true, { catalog }), /找不到/);
  assert.throws(() => M.toggleTask(planted(), 'a', 'true', { catalog }), /布尔值/);
});

test('legacy tasks without a crop complete without inventing a harvest', () => {
  const completed = harvestAll(planted([task('legacy', { cropId: null })]));
  assert.equal(completed.tasks[0].completed, true);
  assert.deepEqual(M.inventory(completed), {});
});

test('deleting a completed task retains its earned crop across save and import', () => {
  const state = { ...harvestAll(planted()), tasks: [] };
  const restored = M.parseBackup(M.exportBackup(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(M.inventory(restored), { 24: 1 });
  assert.deepEqual(M.totalHarvests(restored), { 24: 1 });
});

test('cooking spends harvested ingredients, uses pantry basics and fills the fridge', () => {
  const source = harvestAll(planted());
  const snapshot = JSON.stringify(source);
  const cooked = M.cookRecipe(source, '199', catalog, { now: NOW });
  assert.equal(JSON.stringify(source), snapshot);
  assert.deepEqual(M.inventory(cooked), {});
  assert.deepEqual(M.totalHarvests(cooked), { 24: 1 });
  assert.deepEqual(M.fridge(cooked), { 199: 1 });
  assert.deepEqual(cooked.cooking[0].ingredients, [{ id: '24', count: 1 }]);
  assert.equal(cooked.cooking[0].at, NOW);
  assert.deepEqual(M.parseBackup(M.exportBackup(cooked)), cooked);
  assert.throws(() => M.cookRecipe(cooked, '199', catalog), /食材还不够/);
});

test('recipes enforce exact ingredient quantities and preserve multiple dish yields', () => {
  const source = harvestAll(planted([task('a'), task('b'), task('c', { cropId: '192' })]));
  const cooked = M.cookRecipe(source, '202', catalog, { now: NOW });
  assert.deepEqual(M.inventory(cooked), {});
  assert.deepEqual(M.fridge(cooked), { 202: 2 });
  const restored = M.undoCooking(cooked, cooked.cooking[0].id);
  assert.deepEqual(M.inventory(restored), { 24: 2, 192: 1 });
  assert.deepEqual(M.fridge(restored), {});
  assert.deepEqual(restored, source);
});

test('cooking prevents pantry-only recipes and unsupported ingredients', () => {
  const source = harvestAll(planted());
  assert.throws(() => M.cookRecipe(source, '216', catalog), /自己收获/);
  assert.throws(() => M.cookRecipe(source, '194', catalog), /尚未提供/);
  assert.throws(() => M.cookRecipe(source, 'missing', catalog), /有效的游戏食谱/);
});

test('consumed crops block reopening until cooking is undone', () => {
  const source = harvestAll(planted());
  const cooked = M.cookRecipe(source, '199', catalog, { now: NOW });
  const snapshot = JSON.stringify(cooked);
  assert.throws(() => M.toggleTask(cooked, 'a', false, { catalog }), /冰箱撤销/);
  assert.equal(JSON.stringify(cooked), snapshot);
  const uncooked = M.undoCooking(cooked, cooked.cooking[0].id);
  const reopened = M.toggleTask(uncooked, 'a', false, { catalog });
  assert.deepEqual(M.inventory(reopened), {});
  assert.deepEqual(M.fridge(reopened), {});
  assert.equal(reopened.tasks[0].completed, false);
  assert.throws(() => M.undoCooking(uncooked, cooked.cooking[0].id), /找不到/);
});

test('another unspent unit permits reopening without producing negative inventory', () => {
  const source = harvestAll(planted([task('a'), task('b')]));
  const cooked = M.cookRecipe(source, '199', catalog, { now: NOW });
  const reopened = M.toggleTask(cooked, 'a', false, { catalog });
  assert.deepEqual(M.inventory(reopened), {});
  assert.deepEqual(M.fridge(reopened), { 199: 1 });
  assert.deepEqual(M.totalHarvests(reopened), { 24: 1 });
  assert.throws(() => M.toggleTask(reopened, 'b', false, { catalog }), /冰箱撤销/);
});

test('strict import rejects corrupt ledgers atomically instead of dropping events', () => {
  const base = M.cookRecipe(harvestAll(planted()), '199', catalog, { now: NOW });
  const corruptions = [
    state => { state.harvests = {}; },
    state => { state.cooking = null; },
    state => { state.harvests.push({ ...state.harvests[0], id: 'another' }); },
    state => { state.harvests[0].quantity = 2; },
    state => { state.harvests[0].cropId = '__proto__'; },
    state => { state.harvests[0].at = '2026-02-30T00:00:00Z'; },
    state => { state.harvests[0].at = '2026-10-18T14:30:00'; },
    state => { state.tasks[0].completed = false; },
    state => { state.tasks[0].cropId = '192'; },
    state => { state.tasks[0].cropHorizon = 8; },
    state => { state.tasks[0].plantedOn = '2026-02-30'; },
    state => { state.cooking[0].ingredients[0].count = 2; },
    state => { state.cooking[0].ingredients[0].count = 0.5; },
    state => { state.cooking[0].ingredients[0].count = -1; },
    state => { state.cooking[0].ingredients.push({ ...state.cooking[0].ingredients[0] }); },
    state => { state.cooking[0].ingredients = []; },
    state => { state.cooking[0].ingredients[0].id = '246'; },
    state => { state.cooking[0].id = state.harvests[0].id; },
    state => { state.cooking[0].quantity = 0; },
    state => { state.cooking[0].quantity = Number.MAX_SAFE_INTEGER + 1; },
  ];
  for (const corrupt of corruptions) {
    const state = JSON.parse(JSON.stringify(base));
    corrupt(state);
    assert.throws(() => M.parseBackup(JSON.stringify(state)));
    assert.throws(() => M.exportBackup(state), undefined, 'corrupt state must not be silently saved');
  }
  assert.deepEqual(M.parseBackup(M.exportBackup(base)), base);
});

test('duplicate recipe ingredients are combined before checking available quantities', () => {
  const repeated = { ...catalog, recipes: [{ id: '199', outputCount: 1, ingredients: [{ id: '24', count: 1 }, { id: '24', count: 1 }] }] };
  assert.throws(() => M.cookRecipe(harvestAll(planted()), '199', repeated), /食材还不够/);
  const source = harvestAll(planted([task('a'), task('b')]));
  const cooked = M.cookRecipe(source, '199', repeated, { now: NOW });
  assert.deepEqual(cooked.cooking[0].ingredients, [{ id: '24', count: 2 }]);
  assert.deepEqual(M.inventory(cooked), {});
});

const animalCatalog = {
  ...catalog,
  fish: [{ id: '128', isFish: true }],
  animals: [
    { id: 'chicken', productId: '176' }, { id: 'duck', productId: '442' },
    { id: 'cow', productId: '184' }, { id: 'goat', productId: '436' },
  ],
  objects: { 176: { category: -5 }, 442: { category: -5 }, 184: { category: -6 }, 436: { category: -6 } },
  recipes: [
    { id: 'omelet', outputCount: 1, ingredients: [{ id: '-5', count: 1 }, { id: '-6', count: 1 }] },
    { id: 'mixed', outputCount: 1, ingredients: [{ id: '-5', count: 1 }, { id: '176', count: 1 }, { id: '-6', count: 1 }, { id: '184', count: 1 }, { id: '-4', count: 1 }, { id: '24', count: 1 }, { id: '247', count: 1 }] },
  ],
};
function careAll(state, animalId, today = '2026-10-18') {
  return ['feed', 'pet', 'collect'].reduce((next, action) => M.careForAnimal(next, animalId, action, animalCatalog, { today, now: NOW }), state);
}

test('animal care persists each ordered step and allows one product per animal per day', () => {
  let state = M.createState();
  const initial = JSON.stringify(state);
  assert.throws(() => M.careForAnimal(state, 'chicken', 'pet', animalCatalog, { now: NOW }), /先喂食/);
  assert.throws(() => M.careForAnimal(state, 'chicken', 'collect', animalCatalog, { now: NOW }), /先喂食/);
  for (const action of ['feed', 'pet', 'collect']) {
    state = M.parseBackup(M.exportBackup(M.careForAnimal(state, 'chicken', action, animalCatalog, { today: '2026-10-18', now: NOW })));
    assert.throws(() => M.careForAnimal(state, 'chicken', action, animalCatalog, { today: '2026-10-18', now: NOW }), /今天已经完成/);
  }
  assert.equal(initial, JSON.stringify(M.createState()));
  assert.deepEqual(state.animalCare['2026-10-18'].chicken, { fed: true, petted: true, collected: true });
  assert.deepEqual(M.inventory(state), { 176: 1 });
  assert.deepEqual(M.totalAnimalProducts(state), { 176: 1 });
  assert.deepEqual(M.totalGathered(state), { 176: 1 });
  assert.deepEqual(M.totalHarvests(state), {});
  assert.equal(state.animalProducts[0].date, '2026-10-18');
  const nextDay = careAll(state, 'chicken', '2026-10-19');
  assert.deepEqual(M.inventory(nextDay), { 176: 2 });
  assert.equal(nextDay.animalProducts.length, 2);
  assert.deepEqual(nextDay.animalCare['2026-10-18'], state.animalCare['2026-10-18']);
  assert.throws(() => M.careForAnimal(nextDay, 'missing', 'feed', animalCatalog), /找不到/);
  assert.throws(() => M.careForAnimal(nextDay, 'cow', 'other', animalCatalog), /无效/);
});

test('egg and milk category recipes consume and restore the actual original animal products', () => {
  const source = careAll(careAll(M.createState(), 'duck'), 'goat');
  const requirements = M.recipeRequirements(animalCatalog.recipes[0], animalCatalog);
  assert.equal(requirements.supported, true);
  assert.deepEqual(requirements.eggIds, ['176', '442']);
  assert.deepEqual(requirements.milkIds, ['184', '436']);
  const cooked = M.cookRecipe(source, 'omelet', animalCatalog, { now: NOW });
  assert.deepEqual(cooked.cooking[0].ingredients, [{ id: '436', count: 1 }, { id: '442', count: 1 }]);
  assert.deepEqual(M.inventory(cooked), {});
  assert.deepEqual(M.totalAnimalProducts(cooked), { 436: 1, 442: 1 });
  assert.deepEqual(M.fridge(cooked), { omelet: 1 });
  assert.deepEqual(M.parseBackup(M.exportBackup(cooked)), cooked);
  assert.deepEqual(M.undoCooking(cooked, cooked.cooking[0].id), source);
  assert.throws(() => M.careForAnimal(cooked, 'duck', 'collect', animalCatalog, { today: '2026-10-18', now: NOW }), /今天已经完成/);
});

test('mixed crop, fish, egg and milk recipes reserve exact ingredients before category choices', () => {
  let source = harvestAll(planted());
  for (const animal of animalCatalog.animals) source = careAll(source, animal.id);
  source = M.catchFish(source, '128', animalCatalog, { now: NOW });
  const snapshot = JSON.stringify(source);
  const cooked = M.cookRecipe(source, 'mixed', animalCatalog, { now: NOW });
  assert.equal(JSON.stringify(source), snapshot);
  assert.deepEqual(M.inventory(cooked), {});
  assert.deepEqual(cooked.cooking[0].ingredients, [
    { id: '24', count: 1 }, { id: '128', count: 1 }, { id: '176', count: 1 },
    { id: '184', count: 1 }, { id: '436', count: 1 }, { id: '442', count: 1 },
  ]);
  assert.throws(() => M.toggleTask(cooked, 'a', false, { catalog }), /冰箱撤销/);
  assert.deepEqual(M.undoCooking(cooked, cooked.cooking[0].id), source);
  const onlyExact = careAll(careAll(harvestAll(planted()), 'chicken'), 'cow');
  assert.equal(M.resolveRecipeIngredients(animalCatalog.recipes[1], animalCatalog, M.inventory(onlyExact)).canCook, false);
});

test('strict import rejects broken care order, duplicate daily products and mismatched ledgers', () => {
  const source = M.cookRecipe(careAll(careAll(M.createState(), 'chicken'), 'cow'), 'omelet', animalCatalog, { now: NOW });
  const corruptions = [
    state => { state.animalCare = null; },
    state => { state.animalCare['2026-02-30'] = {}; },
    state => { state.animalCare['2026-10-18'].chicken.fed = false; },
    state => { state.animalCare['2026-10-18'].chicken.petted = false; },
    state => { state.animalCare['2026-10-18'].chicken.collected = false; },
    state => { state.animalCare['2026-10-18'].chicken.fed = 1; },
    state => { delete state.animalCare['2026-10-18'].chicken; },
    state => { state.animalProducts = {}; },
    state => { state.animalProducts = []; },
    state => { state.animalProducts[0].id = state.cooking[0].id; },
    state => { state.animalProducts[0].date = '2026-10-19'; },
    state => { state.animalProducts[0].itemId = '__proto__'; },
    state => { state.animalProducts[0].animalId = '__proto__'; },
    state => { state.animalProducts[0].quantity = 2; },
    state => { state.animalProducts[0].at = '2026-02-30T12:00:00Z'; },
    state => { state.animalProducts.push({ ...state.animalProducts[0], id: 'different' }); },
    state => { state.cooking[0].ingredients[0].count = 2; },
  ];
  for (const corrupt of corruptions) {
    const state = JSON.parse(JSON.stringify(source));
    corrupt(state);
    assert.throws(() => M.parseBackup(JSON.stringify(state)));
    assert.throws(() => M.exportBackup(state));
  }
  assert.deepEqual(M.parseBackup(M.exportBackup(source)), source);
});
