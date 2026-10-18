'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/model.js');
const NOW = '2026-10-18T14:30:00.000Z';
const TODAY = '2026-10-18';
const catalog = {
  crops: [{ id: '24', tier: 7 }],
  fish: [{ id: '128', isFish: true }, { id: '129', isFish: true }, { id: '152', isFish: false }],
  recipes: [
    { id: '227', outputCount: 1, ingredients: [{ id: '-4', count: 1 }, { id: '152', count: 1 }, { id: '423', count: 1 }] },
    { id: 'combo', outputCount: 2, ingredients: [{ id: '-4', count: 1 }, { id: '128', count: 1 }] },
    { id: 'exact', outputCount: 1, ingredients: [{ id: '129', count: 1 }] },
    { id: 'seaweed', outputCount: 1, ingredients: [{ id: '152', count: 1 }] },
  ],
};
const caught = ids => ids.reduce((state, id) => M.catchFish(state, id, catalog, { now: NOW }), M.createState());

test('old backups migrate with an unused daily fishing budget and no invented catches', () => {
  const state = M.parseBackup(JSON.stringify({ version: 2, tasks: [], harvests: [], cooking: [] }));
  assert.deepEqual(state.fishing, { dailyLimitMinutes: 10, usage: {}, catches: [] });
  assert.deepEqual(M.fishingStatus(state, { today: TODAY }), { limitSeconds: 600, usedSeconds: 0, remainingSeconds: 600 });
  assert.deepEqual(M.parseBackup(M.exportBackup(state)), state);
});

test('fishing time survives reload and never exceeds the daily limit', () => {
  const source = M.setFishingLimit(M.createState(), 1);
  const snapshot = JSON.stringify(source);
  const spent = M.spendFishingTime(source, 13, { today: TODAY });
  assert.equal(JSON.stringify(source), snapshot);
  const restored = M.parseBackup(M.exportBackup(spent));
  assert.deepEqual(M.fishingStatus(restored, { today: TODAY }), { limitSeconds: 60, usedSeconds: 13, remainingSeconds: 47 });
  const exhausted = M.spendFishingTime(restored, 1000, { today: TODAY });
  assert.deepEqual(M.fishingStatus(exhausted, { today: TODAY }), { limitSeconds: 60, usedSeconds: 60, remainingSeconds: 0 });
  assert.equal(M.spendFishingTime(exhausted, 1, { today: TODAY }), exhausted);
});

test('changing the limit or disabling fishing keeps time already spent', () => {
  const used = M.spendFishingTime(M.createState(), 95, { today: TODAY });
  const reduced = M.setFishingLimit(used, 1);
  assert.deepEqual(M.fishingStatus(reduced, { today: TODAY }), { limitSeconds: 60, usedSeconds: 95, remainingSeconds: 0 });
  const disabled = M.setFishingLimit(used, 0);
  assert.deepEqual(M.fishingStatus(disabled, { today: TODAY }), { limitSeconds: 0, usedSeconds: 95, remainingSeconds: 0 });
  assert.equal(M.spendFishingTime(disabled, 3, { today: TODAY }), disabled);
  const raised = M.setFishingLimit(disabled, 3);
  assert.deepEqual(M.fishingStatus(raised, { today: TODAY }), { limitSeconds: 180, usedSeconds: 95, remainingSeconds: 85 });
});

test('a new local calendar date starts a fresh budget without erasing the previous date', () => {
  const used = M.spendFishingTime(M.setFishingLimit(M.createState(), 1), 60, { today: TODAY });
  assert.deepEqual(M.fishingStatus(used, { today: '2026-10-19' }), { limitSeconds: 60, usedSeconds: 0, remainingSeconds: 60 });
  const nextDay = M.spendFishingTime(used, 4, { today: '2026-10-19' });
  assert.deepEqual(nextDay.fishing.usage, { '2026-10-18': 60, '2026-10-19': 4 });
  assert.equal(M.fishingStatus(nextDay, { today: TODAY }).remainingSeconds, 0);
});

test('fishing limits and elapsed seconds reject invalid values and dates', () => {
  const state = M.createState();
  for (const value of [-1, 181, 1.5, NaN, Infinity, '10', null]) {
    assert.throws(() => M.setFishingLimit(state, value));
  }
  for (const value of [-1, 0.2, Number.MAX_SAFE_INTEGER + 1, NaN, '1']) {
    assert.throws(() => M.spendFishingTime(state, value, { today: TODAY }));
  }
  assert.equal(M.setFishingLimit(state, 180).fishing.dailyLimitMinutes, 180);
  assert.throws(() => M.fishingStatus(state, { today: '2026-02-30' }));
  assert.throws(() => M.spendFishingTime(state, 1, { today: '__proto__' }));
});

test('a catch adds one original item and can settle on the last already-paid second', () => {
  const state = M.spendFishingTime(M.setFishingLimit(M.createState(), 1), 60, { today: TODAY });
  const snapshot = JSON.stringify(state);
  const next = M.catchFish(state, '128', catalog, { now: NOW });
  assert.equal(JSON.stringify(state), snapshot);
  assert.deepEqual(M.inventory(next), { 128: 1 });
  assert.deepEqual(M.totalCatches(next), { 128: 1 });
  assert.deepEqual(M.totalHarvests(next), {});
  assert.equal(next.fishing.catches[0].at, NOW);
  assert.equal(next.fishing.catches[0].quantity, 1);
  assert.equal(M.fishingStatus(next, { today: TODAY }).remainingSeconds, 0);
  assert.throws(() => M.catchFish(next, '24', catalog));
  assert.throws(() => M.catchFish(next, '__proto__', catalog));
  assert.deepEqual(M.parseBackup(M.exportBackup(next)), next);
});

test('category recipes consume actual fish and exact seaweed, with exact undo', () => {
  const source = caught(['129', '128', '152']);
  const recipe = catalog.recipes[0];
  const requirements = M.recipeRequirements(recipe, catalog);
  assert.equal(requirements.supported, true);
  assert.deepEqual(requirements.fishIds, ['128', '129']);
  assert.equal(requirements.ingredients.find(item => item.id === '-4').kind, 'fish');
  const result = M.resolveRecipeIngredients(recipe, catalog, M.inventory(source));
  assert.equal(result.canCook, true);
  assert.deepEqual(result.ingredients, [{ id: '128', count: 1 }, { id: '152', count: 1 }]);
  const cooked = M.cookRecipe(source, recipe.id, catalog, { now: NOW });
  assert.deepEqual(M.inventory(cooked), { 129: 1 });
  assert.deepEqual(M.totalGathered(cooked), { 128: 1, 129: 1, 152: 1 });
  assert.deepEqual(M.fridge(cooked), { 227: 1 });
  assert.equal(cooked.cooking[0].ingredients.some(item => item.id === '-4'), false);
  assert.deepEqual(M.parseBackup(M.exportBackup(cooked)), cooked);
  assert.deepEqual(M.undoCooking(cooked, cooked.cooking[0].id), source);
});

test('exact fish are reserved before any-fish ingredients regardless of recipe order', () => {
  const source = caught(['128', '129']);
  const recipe = catalog.recipes.find(item => item.id === 'combo');
  const tooLittle = caught(['128']);
  assert.equal(M.resolveRecipeIngredients(recipe, catalog, M.inventory(tooLittle)).canCook, false);
  assert.throws(() => M.cookRecipe(tooLittle, recipe.id, catalog), /食材还不够/);
  const cooked = M.cookRecipe(source, recipe.id, catalog, { now: NOW });
  assert.deepEqual(cooked.cooking[0].ingredients, [{ id: '128', count: 1 }, { id: '129', count: 1 }]);
  assert.deepEqual(M.inventory(cooked), {});
  assert.deepEqual(M.fridge(cooked), { combo: 2 });
  assert.deepEqual(M.undoCooking(cooked, cooked.cooking[0].id), source);
});

test('seaweed never substitutes for the fish category but can be used as an exact ingredient', () => {
  const source = caught(['152', '152']);
  assert.equal(M.resolveRecipeIngredients(catalog.recipes[0], catalog, M.inventory(source)).canCook, false);
  const cooked = M.cookRecipe(source, 'seaweed', catalog, { now: NOW });
  assert.deepEqual(M.inventory(cooked), { 152: 1 });
  assert.deepEqual(M.fridge(cooked), { seaweed: 1 });
});

test('duplicate category requirements aggregate and unavailable categories stay unsupported', () => {
  const repeated = { id: 'twice', outputCount: 1, ingredients: [{ id: '-4', count: 1 }, { id: '-4', count: 1 }] };
  assert.deepEqual(M.recipeRequirements(repeated, catalog).ingredients, [{ id: '-4', count: 2, kind: 'fish', supported: true }]);
  assert.equal(M.resolveRecipeIngredients(repeated, catalog, { 128: 1 }).canCook, false);
  assert.equal(M.resolveRecipeIngredients(repeated, catalog, { 128: 1, 129: 1 }).canCook, true);
  const unsupported = { ...repeated, ingredients: [{ id: '-7', count: 1 }] };
  assert.equal(M.recipeRequirements(unsupported, catalog).reason, 'unsupported');
});

test('malformed fishing backups and impossible consumption fail atomically', () => {
  const source = M.cookRecipe(caught(['129']), 'exact', catalog, { now: NOW });
  const corruptions = [
    state => { state.fishing = null; },
    state => { state.fishing.dailyLimitMinutes = -1; },
    state => { state.fishing.dailyLimitMinutes = 181; },
    state => { state.fishing.dailyLimitMinutes = 0.5; },
    state => { state.fishing.usage = []; },
    state => { state.fishing.usage[TODAY] = -1; },
    state => { state.fishing.usage[TODAY] = 0.5; },
    state => { state.fishing.usage[TODAY] = 10801; },
    state => { state.fishing.usage['2026-02-30'] = 1; },
    state => { state.fishing.catches = null; },
    state => { state.fishing.catches[0].id = state.cooking[0].id; },
    state => { state.fishing.catches.push({ ...state.fishing.catches[0] }); },
    state => { state.fishing.catches[0].itemId = '__proto__'; },
    state => { state.fishing.catches[0].quantity = 2; },
    state => { state.fishing.catches[0].at = '2026-02-30T12:00:00Z'; },
    state => { state.fishing.catches[0].at = '2026-10-18T12:00:00'; },
    state => { state.fishing.catches = []; },
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
