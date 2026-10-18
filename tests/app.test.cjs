'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = path.join(__dirname, '../web');

class Element {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.listeners = new Map();
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.checked = false;
    this.hidden = false;
    this.children = [];
    const classes = new Set();
    this.classList = {
      add: value => classes.add(value), remove: value => classes.delete(value),
      toggle(value, force) {
        const active = force === undefined ? !classes.has(value) : force;
        active ? classes.add(value) : classes.delete(value);
      },
      contains: value => classes.has(value),
    };
  }
  addEventListener(name, callback, options) {
    const entries = this.listeners.get(name) || [];
    entries.push({ callback, once: options?.once });
    this.listeners.set(name, entries);
  }
  async fire(name, fields = {}) {
    const event = { target: this, preventDefault() {}, ...fields };
    const entries = [...(this.listeners.get(name) || [])];
    this.listeners.set(name, (this.listeners.get(name) || []).filter(entry => !entry.once));
    if (this[`on${name}`]) this[`on${name}`](event);
    return Promise.all(entries.map(entry => entry.callback(event)));
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(element) { this.children.push(element); }
  replaceChildren(...elements) { this.children = elements; }
  focus() {}
  remove() {}
  showModal() { this.open = true; }
  close() { this.open = false; return this.fire('close'); }
  click() { return this.fire('click'); }
}

function boot(options = {}) {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [`#${match[1]}`, new Element()]));
  nodes.set('.brand', new Element());
  nodes.set('.landscape', new Element());
  nodes.set('#task-form [type=submit]', new Element());
  const days = [7, 30, 90].map(value => new Element({ days: String(value) }));
  days.forEach(element => nodes.set(`[data-days="${element.dataset.days}"]`, element));
  const categories = ['all', 'life', 'work', 'growth'].map(value => new Element({ category: value }));
  const selectors = {
    '[data-icon]': [], '[data-close]': [], '[data-offset]': [],
    '[data-days]': days, '[data-category]': categories, '.filter': categories,
  };
  const document = new Element();
  document.body = new Element();
  document.hidden = false;
  document.querySelector = selector => selector === 'dialog[open]'
    ? [...nodes.entries()].find(([key, element]) => key.endsWith('-dialog') && element.open)?.[1] || null
    : nodes.get(selector) || null;
  document.querySelectorAll = selector => selectors[selector] || [];
  document.getElementById = id => nodes.get(`#${id}`);
  document.createElement = () => new Element();
  const entries = new Map();
  const writes = [];
  const messages = [];
  if (options.stored !== undefined) entries.set('meadow-todo:v1', options.stored);
  const window = new Element();
  window.innerWidth = 1000;
  window.localStorage = {
    getItem: key => entries.get(key) ?? null,
    setItem(key, value) {
      if (options.failStorage || (options.failRecoveryOnly && key.startsWith('meadow-recovery:'))) throw new Error('quota exceeded');
      entries.set(key, value); writes.push({ key, value });
    },
  };
  if (options.native) {
    window.__MEADOW_NATIVE__ = true;
    window.__MEADOW_INITIAL_DATA__ = options.initial ?? null;
    window.__MEADOW_NATIVE_STATE__ = { compact: false, pinned: false };
    window.webkit = { messageHandlers: { meadow: { postMessage: message => messages.push(message) } } };
  }
  let nextID = 0;
  const context = vm.createContext({
    window, document, console,
    crypto: { randomUUID: () => `test-${++nextID}` },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    AbortController, fetch: async () => { throw new Error('offline'); },
  });
  vm.runInContext(fs.readFileSync(path.join(web, 'model.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(web, 'app.js'), 'utf8'), context);
  const $ = id => nodes.get(`#${id}`);
  const saved = () => JSON.parse(entries.get(window.MeadowModel.STORAGE_KEY));
  async function submit(title, due, fields = {}) {
    $('task-title').value = title;
    $('task-due').value = due;
    $('task-category').value = fields.category || 'life';
    $('task-note').value = fields.note || '';
    $('task-priority').checked = fields.priority === 'high';
    await $('task-form').fire('submit');
  }
  function taskClick(action, id) {
    return $('task-list').fire('click', {
      target: { closest: selector => selector === `[data-${action}]` ? { dataset: { [action]: id } } : null },
    });
  }
  return { $, days, categories, saved, submit, taskClick, entries, writes, messages, window, M: window.MeadowModel };
}

test('app handlers create, edit, complete, undo and delete a persisted task', async () => {
  const app = boot();
  const today = app.M.localDate();
  await app.$('add-button').click();
  await app.submit('读一章书', today, { note: '睡前阅读', category: 'growth' });
  const original = app.saved().tasks[0];
  assert.equal(original.title, '读一章书');
  assert.equal(original.category, 'growth');
  assert.equal(app.$('task-dialog').open, false);
  await app.taskClick('edit', original.id);
  await app.submit('读两章书', today, { category: 'growth', priority: 'high' });
  assert.equal(app.saved().tasks.length, 1);
  assert.equal(app.saved().tasks[0].id, original.id);
  assert.equal(app.saved().tasks[0].priority, 'high');
  await app.taskClick('toggle', original.id);
  assert.equal(app.saved().tasks[0].completed, true);
  assert.ok(app.saved().tasks[0].completedAt);
  assert.equal(app.$('task-list').innerHTML.includes('读两章书'), false);
  await app.$('toast-action').click();
  assert.equal(app.saved().tasks[0].completed, false);
  assert.equal(app.saved().tasks[0].completedAt, null);
  await app.taskClick('edit', original.id);
  await app.$('delete-task').click();
  assert.equal(app.saved().tasks.length, 0);
  await app.$('toast-action').click();
  assert.equal(app.saved().tasks[0].id, original.id);
});

test('app changes horizon for a distant new task and applies category and completion filters', async () => {
  const app = boot();
  await app.$('add-button').click();
  await app.submit('百日后的计划', app.M.addDays(app.M.localDate(), 100), { category: 'work' });
  assert.match(app.$('range-label').textContent, /所有日期/);
  assert.match(app.$('task-list').innerHTML, /百日后的计划/);
  await app.days[2].click();
  assert.doesNotMatch(app.$('task-list').innerHTML, /百日后的计划/);
  await app.$('all-tasks').click();
  await app.categories[1].click();
  assert.doesNotMatch(app.$('task-list').innerHTML, /百日后的计划/);
  await app.categories[2].click();
  assert.match(app.$('task-list').innerHTML, /百日后的计划/);
  await app.taskClick('toggle', app.saved().tasks[0].id);
  app.$('show-completed').checked = true;
  await app.$('show-completed').fire('change');
  assert.match(app.$('task-list').innerHTML, /百日后的计划/);
});

test('undoing a reopened historical task preserves its original completion date', async () => {
  const completedAt = '2020-01-02T12:30:00.000Z';
  const app = boot({stored:JSON.stringify({version:1,tasks:[{id:'historical',title:'以前完成的事',due:'2020-01-02',completed:true,completedAt,createdAt:'2020-01-01T12:00:00.000Z'}]})});
  await app.taskClick('toggle','historical');
  assert.equal(app.saved().tasks[0].completed,false);
  await app.$('toast-action').click();
  assert.equal(app.saved().tasks[0].completedAt,completedAt);
  assert.equal(app.saved().harvests.length,0);
});

test('crop detail harvest action saves edits before completing the task', async () => {
  const app = boot();
  await app.$('add-button').click();
  await app.submit('原始待办',app.M.localDate());
  const task=app.saved().tasks[0];
  await app.taskClick('edit',task.id);
  assert.equal(app.$('harvest-task').hidden,false);
  app.$('task-title').value='更新后收获';
  await app.$('task-form').fire('submit',{submitter:{id:'harvest-task'}});
  assert.equal(app.saved().tasks[0].title,'更新后收获');
  assert.equal(app.saved().tasks[0].completed,true);
});

test('app treats markup in titles and notes as inert text', async () => {
  const app = boot();
  await app.$('add-button').click();
  await app.submit('<img src=x onerror=alert(1)>', app.M.localDate(), { note: '<script>bad()</script>' });
  const rendered = app.$('task-list').innerHTML;
  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(rendered, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /<img src=x|<script>/);
});

test('app rejects malformed imported tasks without replacing saved data', async () => {
  const app = boot();
  await app.$('add-button').click();
  await app.submit('保留我的计划', app.M.localDate());
  const before = app.entries.get(app.M.STORAGE_KEY);
  const writes = app.writes.length;
  await app.window.fire('meadow:import', { detail: { text: '{"tasks":[{"title":"错误日期","due":"2026-02-30"}]}' } });
  assert.equal(app.entries.get(app.M.STORAGE_KEY), before);
  assert.equal(app.writes.length, writes);
  assert.match(app.$('toast-message').textContent, /未导入任何内容/);
  assert.notEqual(app.$('confirm-dialog').open, true);
});

test('valid backup replacement requires confirmation and supports undo', async () => {
  const app = boot();
  await app.$('add-button').click();
  await app.submit('原有计划', app.M.localDate());
  const backup = app.M.exportBackup({ ...app.M.createState(), tasks: [app.M.normalizeTask({ title: '导入计划', due: app.M.localDate() })] });
  const pending = app.window.fire('meadow:import', { detail: { text: backup } });
  assert.equal(app.$('confirm-dialog').open, true);
  assert.equal(app.saved().tasks[0].title, '原有计划');
  await app.$('confirm-ok').click();
  await pending;
  assert.equal(app.saved().tasks[0].title, '导入计划');
  await app.$('toast-action').click();
  assert.equal(app.saved().tasks[0].title, '原有计划');
});

test('native app saves tasks through the bridge without saving on native window state notifications', async () => {
  const app = boot({ native: true });
  await app.$('add-button').click();
  await app.submit('桌面计划', app.M.localDate());
  assert.equal(app.writes.length, 0);
  assert.equal(app.messages.at(-1).action, 'save');
  assert.equal(app.messages.at(-1).data.tasks[0].title, '桌面计划');
  const savesBefore = app.messages.length;
  app.window.innerWidth = 480;
  await app.window.fire('meadow:native-state', { detail: { pinned: true, compact: true } });
  assert.equal(app.messages.length, savesBefore);
  assert.equal(app.$('compact-button').attributes['aria-pressed'], 'true');
  assert.equal(app.$('pin-button').attributes['aria-pressed'], 'true');
  app.window.innerWidth = 920;
  await app.window.fire('resize');
  assert.equal(app.$('compact-button').attributes['aria-pressed'], 'false');
  assert.equal(app.messages.length, savesBefore);
});

test('unsupported native startup state is preserved until a valid import is explicitly confirmed', async () => {
  const original = { version: 99, tasks: [{ title: '来自未来版本的重要计划', due: '2026-10-19' }] };
  const app = boot({ native: true, initial: original });
  await app.window.fire('meadow:native-state', { detail: { pinned: true, compact: false } });
  await app.$('add-button').click();
  await app.submit('临时计划', app.M.localDate());
  assert.equal(app.messages.filter(message => message.action === 'save').length, 0);
  await app.$('export-button').click();
  assert.deepEqual(JSON.parse(app.messages.at(-1).data), original);
  const backup = app.M.exportBackup({ ...app.M.createState(), tasks: [app.M.normalizeTask({ title: '恢复后的计划', due: app.M.localDate() })] });
  const pending = app.window.fire('meadow:import', { detail: { text: backup } });
  assert.equal(app.messages.filter(message => message.action === 'save').length, 0);
  await app.$('confirm-ok').click();
  await pending;
  const saves = app.messages.filter(message => message.action === 'save');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].data.tasks[0].title, '恢复后的计划');
});

test('browser recovery failure cannot overwrite the original unreadable state', async () => {
  const original = '{broken data containing original notes';
  const app = boot({ stored: original, failRecoveryOnly: true });
  await app.$('add-button').click();
  await app.submit('新计划', app.M.localDate());
  assert.equal(app.entries.get(app.M.STORAGE_KEY), original);
  assert.equal(app.writes.length, 0);
  assert.match(app.$('save-status').innerHTML, /保存失败/);
});
