'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const model = require('../web/model.js');

const NOW = '2026-10-18T14:30:00.000Z';
const TODAY = '2026-10-18';
function task(id, diff = 0, extra = {}) {
  return model.normalizeTask({ id, title: id, due: model.addDays(TODAY, diff), ...extra }, { now: NOW });
}

test('localDate uses local calendar fields rather than UTC date', () => {
  const result = execFileSync(process.execPath, ['-e', `const m = require(${JSON.stringify(require.resolve('../web/model.js'))}); process.stdout.write(m.localDate(new Date('2026-01-01T02:00:00Z')));`], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
  });
  assert.equal(result, '2025-12-31');
});

test('date arithmetic handles leap days, centuries and year transitions', () => {
  assert.equal(model.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(model.addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(model.addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(model.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(model.addDays('0099-12-31', 1), '0100-01-01');
  assert.equal(model.isValidDate('2000-02-29'), true);
  assert.equal(model.isValidDate('1900-02-29'), false);
  for (const invalid of ['2025-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-01', '', null]) {
    assert.equal(model.isValidDate(invalid), false);
    assert.throws(() => model.addDays(invalid, 1));
  }
  assert.throws(() => model.addDays('9999-12-31', 1));
  assert.throws(() => model.addDays(TODAY, 0.5));
});

test('DST spring and autumn dates remain one calendar day apart', () => {
  const result = execFileSync(process.execPath, ['-e', `const m = require(${JSON.stringify(require.resolve('../web/model.js'))}); process.stdout.write(JSON.stringify([m.dayDiff('2026-03-09', '2026-03-08'), m.dayDiff('2026-11-02', '2026-11-01'), m.addDays('2026-03-08', 1)]));`], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(result), [1, 1, '2026-03-09']);
});

for (const days of [7, 30, 90]) {
  test(`${days}-day horizon includes today, last day and all overdue; excludes first outside day`, () => {
    const tasks = [task('outside', days), task('last', days - 1), task('overdue', -500), task('today'), task('done', 1, { completed: true })];
    assert.deepEqual(model.selectTasks(tasks, { days, today: TODAY }).map(t => t.id), ['overdue', 'today', 'last']);
    assert.deepEqual(model.selectTasks(tasks, { days, today: TODAY, showCompleted: true }).map(t => t.id), ['overdue', 'today', 'last', 'done']);
    assert.equal(tasks[0].id, 'outside', 'selection does not mutate source order');
  });
}

test('horizons are cumulative and dates sort before within-date priority', () => {
  const tasks = [task('90-only', 89), task('30-only', 29), task('7-only', 6), task('high', 0, { priority: 'high' }), task('normal'), task('overdue', -1)];
  const week = model.selectTasks(tasks, { days: 7, today: TODAY });
  const month = model.selectTasks(tasks, { days: 30, today: TODAY });
  const quarter = model.selectTasks(tasks, { days: 90, today: TODAY });
  assert.deepEqual(week.map(t => t.id), ['overdue', 'high', 'normal', '7-only']);
  assert.equal(week.every(t => month.some(m => m.id === t.id)), true);
  assert.equal(month.every(t => quarter.some(q => q.id === t.id)), true);
});

test('normalization rejects missing title and impossible due dates and caps text', () => {
  assert.equal(model.normalizeTask({ title: '  ', due: TODAY }), null);
  assert.equal(model.normalizeTask({ title: 'Valid', due: '2026-02-30' }), null);
  assert.equal(model.normalizeTask(null), null);
  const actual = task('long', 0, { title: '  ' + 'a'.repeat(150), note: 'b'.repeat(2500), priority: 'unknown', category: 'unknown' });
  assert.equal(actual.title.length, 120);
  assert.equal(actual.note.length, 2000);
  assert.equal(actual.priority, 'normal');
  assert.equal(actual.category, 'life');
  assert.equal(actual.createdAt, NOW);
  assert.equal(actual.completedAt, null);
});

test('completion creates a timestamp, preserves it on repeated completion and clears on reopen', () => {
  const source = task('a');
  const completed = model.setTaskCompleted(source, true, { now: NOW });
  assert.equal(source.completed, false);
  assert.equal(completed.completed, true);
  assert.equal(completed.completedAt, NOW);
  assert.equal(model.setTaskCompleted(completed, true, { now: '2026-10-19T12:00:00Z' }).completedAt, NOW);
  assert.equal(model.setTaskCompleted(completed, false).completedAt, null);
  assert.equal(task('pending', 0, { completedAt: NOW }).completedAt, null);
  assert.equal(task('done', 0, { completed: true, completedAt: 'garbage' }).completedAt, NOW);
});

test('legacy state migration is tolerant and settings use known defaults', () => {
  const state = model.normalizeState({
    version: 0,
    tasks: [task('a'), { title: 'legacy', dueDate: TODAY }, { title: 'invalid', due: '2026-02-30' }, task('a')],
    settings: { season: 'fall', weather: 'rainy', compact: true, pinned: 'false', reducedMotion: true, city: { name: '纽约', latitude: 40.71, longitude: -74.01 } },
  }, { now: NOW });
  assert.equal(state.tasks.length, 2);
  assert.equal(state.version, 2);
  assert.equal(state.settings.season, 'autumn');
  assert.equal(state.settings.weather, 'rain');
  assert.equal(state.settings.pinned, false);
  assert.equal(state.settings.reducedMotion, true);
  assert.equal(state.settings.city.name, '纽约');
  assert.deepEqual(model.normalizeState({ version: 3, tasks: [task('a')] }), model.createState());
  const first = model.createState();
  first.settings.compact = true;
  assert.equal(model.createState().settings.compact, false);
});

test('backup export/import round trip preserves data and accepts legacy task arrays', () => {
  const state = { ...model.createState(), tasks: [task('a'), task('b', 30, { completed: true, note: '<script>alert(1)</script>' })] };
  const json = model.exportBackup(state);
  assert.deepEqual(model.parseBackup(json), state);
  assert.deepEqual(model.parseBackup(JSON.stringify(state.tasks)).tasks, state.tasks);
  assert.equal(model.parseBackup(json).tasks[1].note, '<script>alert(1)</script>', 'content remains inert text');
});

test('malformed imports reject the entire input without mutating current state', () => {
  const current = { ...model.createState(), tasks: [task('preserved')] };
  const snapshot = JSON.stringify(current);
  const invalid = ['not json', 'null', '{}', '{"tasks":{}}', JSON.stringify({ version: 8, tasks: [] }),
    JSON.stringify({ tasks: [task('valid'), { title: 'bad', due: '2026-02-30' }] }),
    JSON.stringify({ tasks: [task('same'), task('same')] }),
    JSON.stringify({ tasks: [{ ...task('a'), completed: 'false' }] }),
    JSON.stringify({ tasks: [task('a')], settings: { weather: 'lava' } }),
    JSON.stringify({ tasks: [task('a')], settings: { city: { name: 'bad', latitude: 500, longitude: 0 } } }),
    JSON.stringify({ tasks: [task('a')], settings: { showCompleted: 'true' } }),
  ];
  for (const json of invalid) {
    assert.throws(() => model.parseBackup(json));
    assert.equal(JSON.stringify(current), snapshot);
  }
});

test('groups combine overdue tasks and label today and tomorrow', () => {
  const groups = model.groupTasks([task('future', 3), task('old', -4), task('today'), task('older', -8), task('tomorrow', 1)], { today: TODAY });
  assert.deepEqual(groups.map(g => g.key), ['overdue', 'today', 'tomorrow', '2026-10-21']);
  assert.equal(groups[0].tasks.length, 2);
  assert.equal(groups[1].label, '今天');
  const withCompleted = model.groupTasks([task('future', 3), task('old-done', -4, { completed: true })], { today: TODAY });
  assert.deepEqual(withCompleted.map(g => g.key), ['overdue', '2026-10-21']);
});

test('storage helpers fail safely on blocked, full or malformed storage without deleting saved data', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const state = { ...model.createState(), tasks: [task('a')] };
  assert.equal(model.saveState(storage, state), true);
  assert.deepEqual(model.loadState(storage), state);
  entries.set(model.STORAGE_KEY, 'broken json');
  assert.deepEqual(model.loadState(storage), model.createState());
  assert.equal(entries.get(model.STORAGE_KEY), 'broken json');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.deepEqual(model.loadState(blocked), model.createState());
  assert.equal(model.saveState(blocked, state), false);
});
