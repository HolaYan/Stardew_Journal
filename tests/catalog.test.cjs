'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../web/model.js');

const webRoot = path.resolve(__dirname, '../web');
const catalogPath = path.join(webRoot, 'game-assets/game-data.js');
const available = fs.existsSync(catalogPath);
const options = { skip: available ? false : 'Local installed-game catalog has not been extracted' };
const NOW = '2026-10-18T14:30:00.000Z';
const TODAY = '2026-10-18';
let catalog, GardenUI;
if (available) {
  const context = { window: { MeadowModel: M } };
  vm.runInNewContext(fs.readFileSync(catalogPath, 'utf8'), context, { filename: catalogPath });
  catalog = JSON.parse(JSON.stringify(context.window.GameCatalog));
  context.window.GameCatalog = catalog;
  vm.runInNewContext(fs.readFileSync(path.join(webRoot, 'garden.js'), 'utf8'), context, { filename: 'garden.js' });
  GardenUI = context.window.GardenUI;
}

function garden() {
  return { model: M, catalog, crops: new Map(catalog.crops.map(crop => [crop.id, crop])) };
}

function plantedTask(crop, id) {
  const days = { 7: 6, 30: 29, 90: 89 }[crop.tier];
  return M.normalizeTask({
    id, title: crop.name, cropId: crop.id, cropHorizon: crop.tier,
    plantedOn: TODAY, due: M.addDays(TODAY, days),
  }, { now: NOW });
}

function harvest(tasks) {
  return tasks.reduce((state, task) => M.toggleTask(state, task.id, true, { catalog, now: NOW }), {
    ...M.createState(), tasks,
  });
}

function checkSprite(item) {
  assert.match(item.texture, /^game-assets\/img\/[A-Za-z0-9_-]+\.png$/);
  const png = fs.readFileSync(path.join(webRoot, item.texture));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const textureWidth = png.readUInt32BE(16), textureHeight = png.readUInt32BE(20);
  const cellWidth = item.width || 16, cellHeight = item.height || 16;
  assert.ok(Number.isInteger(item.spriteIndex) && item.spriteIndex >= 0, item.name);
  assert.ok(Number.isInteger(item.columns) && item.columns > 0, item.name);
  assert.equal(textureWidth / cellWidth, item.columns, item.name);
  assert.ok((item.spriteIndex % item.columns + 1) * cellWidth <= textureWidth, item.name);
  assert.ok((Math.floor(item.spriteIndex / item.columns) + 1) * cellHeight <= textureHeight, item.name);
  if (item.textureWidth !== undefined) assert.equal(item.textureWidth, textureWidth);
  if (item.textureHeight !== undefined) assert.equal(item.textureHeight, textureHeight);
}

function checkRectangle(item) {
  assert.match(item.texture, /^game-assets\/img\/[A-Za-z0-9_-]+\.png$/);
  const png = fs.readFileSync(path.join(webRoot, item.texture));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(item.textureWidth, png.readUInt32BE(16));
  assert.equal(item.textureHeight, png.readUInt32BE(20));
  for (const key of ['sx', 'sy', 'width', 'height']) assert.ok(Number.isInteger(item[key]) && item[key] >= 0, key);
  assert.ok(item.width > 0 && item.height > 0);
  assert.ok(item.sx + item.width <= item.textureWidth);
  assert.ok(item.sy + item.height <= item.textureHeight);
}

function gatherRecipeIngredients(recipe) {
  const requirements = M.recipeRequirements(recipe, catalog);
  assert.equal(requirements.supported, true, recipe.name);
  const count = requirements.ingredients.reduce((sum, item) => sum + item.count, 0);
  const availableIds = [...catalog.crops, ...catalog.fish].map(item => item.id)
    .concat(catalog.animals.map(animal => animal.productId));
  // Let the shared resolver choose concrete fish, eggs, and milk after reserving
  // exact ingredients. Acquire only those quantities through real mutations.
  const resolved = M.resolveRecipeIngredients(recipe, catalog, Object.fromEntries(availableIds.map(id => [id, count])));
  assert.equal(resolved.canCook, true, recipe.name);
  let state = M.createState();
  for (const ingredient of resolved.ingredients) {
    const crop = catalog.crops.find(item => item.id === ingredient.id);
    const fish = catalog.fish.find(item => item.id === ingredient.id);
    const animal = catalog.animals.find(item => item.productId === ingredient.id);
    for (let index = 0; index < ingredient.count; index++) {
      if (crop) {
        const task = plantedTask(crop, `${recipe.id}-${ingredient.id}-${index}`);
        state = { ...state, tasks: [...state.tasks, task] };
        state = M.toggleTask(state, task.id, true, { catalog, now: NOW });
      } else if (fish) {
        state = M.catchFish(state, fish.id, catalog, { now: NOW });
      } else {
        assert.ok(animal, `${recipe.name}: ingredient ${ingredient.id} needs an acquisition path`);
        const today = M.addDays(TODAY, index);
        for (const action of ['feed', 'pet', 'collect']) {
          state = M.careForAnimal(state, animal.id, action, catalog, { today, now: `${today}T14:30:00.000Z` });
        }
      }
    }
  }
  assert.deepEqual(M.inventory(state), Object.fromEntries(resolved.ingredients.map(item => [item.id, item.count])), recipe.name);
  return { state, ingredients: resolved.ingredients };
}

test('local game catalog has coherent planting tiers and real, in-bounds sprites', options, () => {
  assert.ok(catalog.crops.length > 0);
  assert.equal(catalog.recipes.length, 81);
  assert.equal(new Set(catalog.crops.map(crop => crop.id)).size, catalog.crops.length);
  assert.equal(new Set(catalog.recipes.map(recipe => recipe.id)).size, catalog.recipes.length);
  for (const tier of [7, 30, 90]) assert.ok(catalog.crops.some(crop => crop.tier === tier));
  for (const crop of catalog.crops) {
    const expectedTier = crop.regrowDays > 0 || crop.growthDays >= 15 ? 90 : crop.growthDays <= 7 ? 7 : 30;
    assert.equal(crop.tier, expectedTier, crop.name);
    assert.equal(crop.growthPhases.reduce((sum, days) => sum + days, 0), crop.growthDays, crop.name);
    assert.ok(crop.seasons.length > 0, crop.name);
    assert.ok(catalog.objects[crop.id], crop.id);
    checkSprite(crop);
  }
  for (const recipe of catalog.recipes) {
    assert.ok(Number.isSafeInteger(recipe.outputCount) && recipe.outputCount > 0, recipe.name);
    assert.ok(recipe.ingredients.every(item => typeof item.id === 'string' && Number.isSafeInteger(item.count) && item.count > 0));
    assert.equal(new Set(recipe.ingredients.map(item => item.id)).size, recipe.ingredients.length, recipe.name);
    checkSprite(recipe);
  }
});

test('fishing catalog uses original fish sprites and separates algae from fish ingredients', options, () => {
  assert.ok(catalog.fish.length > 0);
  assert.equal(new Set(catalog.fish.map(item => item.id)).size, catalog.fish.length);
  assert.equal(catalog.source.fishCount, catalog.fish.length);
  for (const item of catalog.fish) {
    assert.equal(item.isFish, catalog.objects[item.id].category === -4, item.name);
    assert.ok(item.name && item.description && !item.description.includes('[LocalizedText'), item.id);
    assert.ok(['rod', 'crabPot'].includes(item.catchMethod), item.name);
    assert.ok(item.seasons.length && item.seasons.every(season => ['spring', 'summer', 'fall', 'winter'].includes(season)), item.name);
    if (item.catchMethod === 'rod') assert.ok(Number.isFinite(item.difficulty) && item.difficulty > 0, item.name);
    checkSprite(item);
  }
  for (const id of ['152', '153', '157']) assert.equal(catalog.fish.find(item => item.id === id)?.isFish, false, id);
  for (const id of ['372', '715', '716', '717', '718', '719', '720', '721', '722', '723']) {
    const item = catalog.fish.find(item => item.id === id);
    assert.equal(item?.isFish, true, id);
    assert.equal(item.catchMethod, 'crabPot', id);
  }
  for (const id of ['159', '160', '163', '682', '775', '898', '899', '900', '901', '902']) assert.equal(catalog.fish.some(item => item.id === id), false, id);
});

test('animal catalog has original products and in-bounds frames, barn and fishing rod', options, () => {
  const expected = { chicken: '176', duck: '442', cow: '184', goat: '436' };
  assert.equal(catalog.animals.length, 4);
  assert.equal(new Set(catalog.animals.map(animal => animal.id)).size, 4);
  assert.equal(catalog.source.animalCount, 4);
  for (const animal of catalog.animals) {
    assert.equal(animal.productId, expected[animal.id]);
    assert.ok(animal.name && !animal.name.includes('[LocalizedText'));
    assert.ok(catalog.objects[animal.productId]);
    assert.equal(catalog.objects[animal.productId].category, ['chicken', 'duck'].includes(animal.id) ? -5 : -6);
    checkRectangle(animal);
    checkSprite(catalog.objects[animal.productId]);
  }
  checkRectangle(catalog.ui.barn);
  checkRectangle(catalog.ui.fishingRod);
});

test('every extracted crop can be planted and harvested once in its matching horizon', options, () => {
  const tasks = catalog.crops.map(crop => plantedTask(crop, `catalog-${crop.id}`));
  const state = harvest(tasks);
  assert.equal(state.harvests.length, catalog.crops.length);
  const expected = Object.fromEntries(catalog.crops.map(crop => [crop.id, 1]));
  assert.deepEqual(M.inventory(state), expected);
  assert.deepEqual(M.totalHarvests(state), expected);
  assert.deepEqual(M.parseBackup(M.exportBackup(state)), state);
  for (const task of tasks) assert.equal(M.cropTier(task.due, task.plantedOn), task.cropHorizon);
});

test('GardenUI real recipes agree with the model on ingredients, cooking and reversal', options, () => {
  const ui = garden();
  const eligible = GardenUI.prototype.eligibleRecipes.call(ui);
  const supported = catalog.recipes.filter(recipe => M.recipeRequirements(recipe, catalog).supported);
  assert.ok(supported.length > 15, 'Fish and animal products should unlock more than the original crop-only recipes');
  assert.deepEqual(Array.from(eligible, recipe => recipe.id).sort(), supported.map(recipe => recipe.id).sort());
  for (const recipe of eligible) {
    const { state: source, ingredients } = gatherRecipeIngredients(recipe);
    assert.equal(GardenUI.prototype.canCook.call(ui, recipe, M.inventory(source)), true, recipe.name);
    const cooked = M.cookRecipe(source, recipe.id, catalog, { now: NOW });
    assert.deepEqual(cooked.cooking[0].ingredients, ingredients, recipe.name);
    assert.deepEqual(M.inventory(cooked), {}, recipe.name);
    assert.deepEqual(M.fridge(cooked), { [recipe.id]: recipe.outputCount }, recipe.name);
    assert.deepEqual(M.totalGathered(cooked), M.totalGathered(source), recipe.name);
    assert.equal(GardenUI.prototype.canCook.call(ui, recipe, M.inventory(cooked)), false, recipe.name);
    if (source.tasks.length) assert.throws(() => M.toggleTask(cooked, source.tasks[0].id, false, { catalog }), /冰箱撤销/);
    assert.deepEqual(M.parseBackup(M.exportBackup(cooked)), cooked, recipe.name);
    assert.deepEqual(M.undoCooking(cooked, cooked.cooking[0].id), source, recipe.name);
    assert.deepEqual(M.parseBackup(M.exportBackup(source)), source, recipe.name);
  }
});

test('recipes with unavailable ingredients or only pantry items cannot bypass the kitchen filter', options, () => {
  const ui = garden();
  const eligible = new Set(GardenUI.prototype.eligibleRecipes.call(ui).map(recipe => recipe.id));
  const source = harvest(catalog.crops.map(crop => plantedTask(crop, `all-${crop.id}`)));
  const unsupported = catalog.recipes.filter(recipe => !M.recipeRequirements(recipe, catalog).supported);
  assert.ok(unsupported.length > 0);
  for (const recipe of unsupported) {
    const reason = M.recipeRequirements(recipe, catalog).reason;
    assert.ok(['unsupported', 'pantry-only'].includes(reason), recipe.name);
    assert.equal(eligible.has(recipe.id), false, recipe.name);
    assert.throws(() => M.cookRecipe(source, recipe.id, catalog), reason === 'pantry-only' ? /自己收获/ : /尚未提供/);
  }
});
