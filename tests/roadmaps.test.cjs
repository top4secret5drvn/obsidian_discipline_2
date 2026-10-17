const test = require('node:test');
const assert = require('node:assert/strict');
const { RoadmapService, MetricRegistry, createRegistry, newMap, newLevel, newGroup, evaluateMap, evaluateTree, evaluateCondition, snapshotTree, validateTree, createRoadmapModal } = require('../roadmaps');
const condition = (metric, extra = {}) => ({ id: 'c_' + Math.random(), kind: 'condition', metric, entityId: '', method: 'sum', mode: 'since_activation', operator: '>=', target: 1, ...extra });
function fixture() {
  let now = new Date('2026-10-01T12:00:00Z');
  const files = new Map();
  const store = {
    base: 'LifeTracker', ref: {
      habits: [{ id: 'h', name: 'Practice' }], activities: [{ id: 'a', name: 'Run', kcalPerUnit: 50 }], substances: [{ id: 's', name: 'Supplement' }],
      finCategories: [{ id: 'f', name: 'Side income', type: 'income' }, { id: 'e', name: 'Food', type: 'expense' }],
      skills: [{ id: 'sk', name: 'Programming', habitRefs: [{ habitId: 'h', weight: 1 }] }], goals: [], achievements: [], synergyRules: []
    }, work: { items: [{ id: 't', name: 'Portfolio', kind: 'task', status: 'backlog' }, { id: 'i', name: 'Idea', kind: 'idea', status: 'in_progress' }] },
    rewardsData: { currency: 0, inventory: [] }, coursesData: { courses: [] }
  };
  store.a = { exists: async p => files.has(p), read: async p => { if (!files.has(p)) throw new Error('missing ' + p); return files.get(p); }, write: async (p, v) => files.set(p, v), list: async () => ({ files: [...files.keys()].filter(p => p.includes('/journal/')) }) };
  const service = new RoadmapService(store, {}, () => now);
  const put = (date, data = {}) => files.set('LifeTracker/journal/' + date + '.json', JSON.stringify({ habitLogs: [], activityLogs: [], substanceLogs: [], meals: [], financeLogs: [], ...data }));
  const setNow = date => now = new Date(date + 'T12:00:00Z');
  const view = async mapId => evaluateMap(service.maps.find(m => m.id === mapId), service.registry, await service.context());
  return { store, files, service, put, setNow, view };
}
test('acceptance: three sequential levels use habits, finance plus skill, tasks plus achievement; same-day prior events excluded', async () => {
  const f = fixture(); await f.service.init();
  f.put('2026-09-30', { financeLogs: [{ categoryId: 'f', amount: 9000 }] });
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: false, hours: 0 }], financeLogs: [{ categoryId: 'f', amount: 1000 }] });
  const map = newMap(); map.name = 'Independence';
  map.levels[0].conditions.children = [condition('habit.done', { entityId: 'h' })];
  const second = newLevel(); second.conditions.children = [condition('finance.income', { entityId: 'f', target: 5000 }), condition('skill.level', { entityId: 'sk', method: 'absolute', mode: 'absolute', target: 1 })];
  const third = newLevel(); third.conditions.children = [condition('task.completed', { entityId: 't', method: 'event' }), condition('achievement.owned', { method: 'absolute', mode: 'absolute', target: 1 })];
  map.levels.push(second, third); await f.service.saveMap(map); await f.service.start(map.id);
  assert.equal((await f.view(map.id)).levels[1].status, 'locked');
  await assert.rejects(f.service.complete(map.id, second.id), /заблокирован/);
  await assert.rejects(f.service.complete(map.id, map.levels[0].id), /не выполнены/);
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true, hours: 10 }], financeLogs: [{ categoryId: 'f', amount: 1000 }] });
  assert.equal((await f.view(map.id)).levels[0].status, 'ready');
  await f.service.complete(map.id, map.levels[0].id);
  let view = await f.view(map.id);
  assert.equal(view.levels[0].status, 'completed'); assert.equal(view.levels[1].result.children[0].value, 0);
  assert.equal(view.levels[1].result.children[1].value, 1);
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true, hours: 10 }], financeLogs: [{ categoryId: 'f', amount: 6000 }] });
  assert.equal((await f.view(map.id)).levels[1].status, 'ready');
  await f.service.complete(map.id, second.id);
  f.setNow('2026-10-02'); f.store.work.items[0].status = 'done'; f.store.work.items[0].completedDate = '2026-10-02';
  f.store.ref.achievements.push({ id: 'ach', title: 'First result', date: '2026-10-02' });
  assert.equal((await f.view(map.id)).levels[2].status, 'ready');
  await f.service.complete(map.id, third.id);
  assert.equal((await f.view(map.id)).status, 'completed');
  // Historical result is immutable even when journals and source entities disappear.
  f.files.delete('LifeTracker/journal/2026-10-01.json'); f.store.ref.habits = [];
  const saved = JSON.stringify(f.service.maps);
  const restored = new RoadmapService(f.store, {}, () => new Date('2026-10-03T12:00:00Z')); await restored.init();
  assert.equal(JSON.stringify(restored.maps), saved);
  assert.equal(evaluateMap(restored.maps[0], restored.registry, await restored.context()).percent, 100);
});
test('recomputation on edit/delete; zero, missing source and empty average are distinct', async () => {
  const f = fixture(); await f.service.init();
  const map = newMap(); map.levels[0].conditions.children = [condition('habit.hours', { entityId: 'h', target: 5 })];
  await f.service.saveMap(map); await f.service.start(map.id);
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', hours: 6 }] });
  assert.equal((await f.view(map.id)).levels[0].status, 'ready');
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', hours: 2 }] });
  assert.equal((await f.view(map.id)).levels[0].status, 'active');
  f.files.delete('LifeTracker/journal/2026-10-01.json');
  assert.equal((await f.view(map.id)).levels[0].result.children[0].value, 0);
  const c = condition('habit.hours', { method: 'average', mode: 'absolute', entityId: 'h' });
  assert.equal(evaluateCondition(c, {}, f.service.registry, await f.service.context()).value, null);
  f.store.ref.habits = [];
  const result = (await f.view(map.id)).levels[0].result.children[0]; assert.equal(result.state, 'missing'); assert.equal(result.value, null);
});
test('streaks stay inside activation period, gaps reset current streak, max streak survives gaps', async () => {
  const f = fixture(); await f.service.init();
  f.put('2026-09-30', { habitLogs: [{ habitId: 'h', done: true }] });
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true }] });
  const map = newMap(); map.levels[0].conditions.children = [condition('habit.done', { method: 'streak', entityId: 'h', target: 2 })];
  await f.service.saveMap(map); await f.service.start(map.id);
  for (const d of ['2026-10-02', '2026-10-03', '2026-10-05']) f.put(d, { habitLogs: [{ habitId: 'h', done: true }] });
  f.setNow('2026-10-03'); assert.equal((await f.view(map.id)).levels[0].result.children[0].value, 2);
  f.setNow('2026-10-05'); assert.equal((await f.view(map.id)).levels[0].result.children[0].value, 1);
  const level = f.service.maps[0].levels[0], c = { ...level.conditions.children[0], method: 'max_streak' };
  assert.equal(evaluateCondition(c, level, f.service.registry, await f.service.context()).value, 2);
});
test('upper bound and range wait until end of interval; no invalid percentages', async () => {
  const f = fixture(); await f.service.init();
  const c = condition('finance.expense', { entityId: 'e', operator: '<=', target: 100, to: '2026-10-02' });
  assert.equal(validateTree({ ...c, to: '' }, f.service.registry).length, 1);
  const map = newMap(); map.levels[0].conditions.children = [c]; await f.service.saveMap(map); await f.service.start(map.id);
  let result = (await f.view(map.id)).levels[0].result.children[0]; assert.equal(result.state, 'pending'); assert.equal(result.percent, null);
  f.put('2026-10-02', { financeLogs: [{ categoryId: 'e', amount: 80 }] }); f.setNow('2026-10-03');
  result = (await f.view(map.id)).levels[0].result.children[0]; assert.equal(result.met, true); assert.equal(result.value, 80);
  f.put('2026-10-02', { financeLogs: [{ categoryId: 'e', amount: 120 }] }); assert.equal((await f.view(map.id)).levels[0].status, 'active');
});
test('new metric adapter works without engine changes, nested OR/AND and delta survive reload', async () => {
  const f = fixture(); await f.service.init();
  f.service.registry.register({ key: 'custom.score', label: 'Score', source: 'Extension', kind: 'scalar', unit: 'pts', read: ctx => ({ available: true, value: ctx.rewards.currency }) });
  const group = newGroup(); group.op = 'OR'; group.children = [condition('custom.score', { method: 'delta', target: 5 }), condition('habit.done', { entityId: 'h', target: 100 })];
  const map = newMap(); map.levels[0].conditions.children = [group]; f.store.rewardsData.currency = 20;
  await f.service.saveMap(map); await f.service.start(map.id); f.store.rewardsData.currency = 25;
  assert.equal((await f.view(map.id)).levels[0].status, 'ready');
  assert.throws(() => f.service.registry.register({ key: 'custom.score', read() {} }), /повторная/);
  const edited = structuredClone(f.service.maps[0]); edited.levels[0].name = 'Changed';
  await assert.rejects(f.service.saveMap(edited), /защищены/);
  const copyId = await f.service.duplicate(map.id); const copy = f.service.maps.find(m => m.id === copyId);
  assert.equal(copy.startedAt, null); assert.notEqual(copy.levels[0].id, map.levels[0].id); assert.equal(copy.levels[0].baselines, undefined);
});
test('statuses preserve idea model; task completion events are deduplicated by stable ID', async () => {
  const f = fixture(); await f.service.init(); f.store.work.items[0].status = 'done'; f.store.work.items[0].completedDate = '2026-10-01';
  f.put('2026-10-01', { completedWorkItems: [{ id: 't', kind: 'task' }, { id: 't', kind: 'task' }] });
  const ctx = await f.service.context();
  assert.equal(evaluateCondition(condition('task.completed', { method: 'count', mode: 'absolute' }), {}, f.service.registry, ctx).value, 1);
  assert.equal(evaluateCondition(condition('idea.status', { method: 'absolute', mode: 'absolute', status: 'in_progress', entityId: 'i' }), {}, f.service.registry, ctx).met, true);
  assert.equal(evaluateCondition(condition('task.completed', { method: 'event', mode: 'absolute', entityId: 'i' }), {}, f.service.registry, ctx).state, 'missing');
});
test('validation rejects bad combinations and corrupt source aborts instead of passing', async () => {
  const f = fixture(); await f.service.init();
  assert.ok(validateTree(condition('skill.level', { method: 'absolute', entityId: 'sk' }), f.service.registry).length);
  assert.ok(validateTree(condition('unknown'), f.service.registry).length);
  assert.ok(validateTree(condition('food.calories', { to: '2026-02-30' }), f.service.registry).length);
  const map = newMap(); map.levels[0].conditions.children = [condition('habit.done')]; await f.service.saveMap(map);
  f.files.set('LifeTracker/journal/2026-10-01.json', '{');
  await assert.rejects(f.service.start(map.id), /JSON/); assert.equal(f.service.maps[0].startedAt, null);
});
test('archive, deletion and concurrent confirmation preserve a single transition', async () => {
  const f = fixture(); await f.service.init(); const map = newMap();
  map.levels[0].conditions.children = [condition('player.currency', { method: 'absolute', mode: 'absolute', target: 0 })];
  await f.service.saveMap(map); await f.service.start(map.id);
  const results = await Promise.allSettled([f.service.complete(map.id, map.levels[0].id), f.service.complete(map.id, map.levels[0].id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await f.service.archive(map.id); assert.equal((await f.view(map.id)).status, 'archived');
  await f.service.remove(map.id); assert.equal(f.service.maps.length, 0);
});
test('calories, distinct days, substances, courses and signed finance have correct values and units', async () => {
  const f = fixture(); await f.service.init(); f.store.coursesData.courses = [{ id: 'course', pieces: [{ id: 'p', firstDoneAt: '2026-10-01' }] }];
  f.put('2026-10-01', { activityLogs: [{ activityId: 'a', amount: 3 }], substanceLogs: [{ substanceId: 's', taken: true }, { substanceId: 's', taken: true }], meals: [{ slot: 'lunch', kcal: 500 }, { slot: 'snack', kcal: 150 }], financeLogs: [{ categoryId: 'f', amount: 100 }, { categoryId: 'e', amount: 150 }] });
  const ctx = await f.service.context(); const read = (metric, extra) => evaluateCondition(condition(metric, { mode: 'absolute', ...extra }), {}, f.service.registry, ctx);
  assert.equal(read('activity.calories').value, 150); assert.equal(read('finance.balance').value, -50);
  assert.equal(read('food.calories').value, 650); assert.equal(read('food.rangeDays', { method: 'days', filterMin: 500, filterMax: 700 }).value, 1);
  assert.equal(read('substance.taken', { method: 'days', entityId: 's' }).value, 1); assert.equal(read('substance.taken', { method: 'days', entityId: 's' }).unit, 'дней');
  assert.equal(read('course.completedPieces', { method: 'count' }).value, 1);
});

// Minimal Obsidian DOM contract: exercise rendered controls and their callbacks.
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.text = options.text || ''; this.children = []; this.style = {}; this.dataset = {}; this.isConnected = true; this.value = ''; this.disabled = false; }
  createEl(tag, options) { const element = new Element(tag, options); this.children.push(element); return element; }
  createDiv(options) { return this.createEl('div', options); }
  addClass() {} setAttribute() {} setText(text) { this.text = text; }
  empty() { this.children = []; }
  all() { return [this, ...this.children.flatMap(c => c.all())]; }
}
const button = (modal, label) => { const b = modal.contentEl.all().find(e => e.tag === 'button' && e.text === label); assert.ok(b, 'Missing button: ' + label); return b; };
test('UI: editor saves groups and chosen entities, list/detail renders, lifecycle and reactive update work', async () => {
  const f = fixture(); await f.service.init(); const notices = [];
  const Modal = class { constructor() { this.contentEl = new Element(); } };
  const UI = createRoadmapModal(Modal, class { constructor(message) { notices.push(message); } });
  const modal = new UI({}, f.service); await modal.render();
  await button(modal, '+ Создать').onclick();
  await button(modal, '+ Условие').onclick();
  const c = modal.draft.levels[0].conditions.children[0]; c.entityId = 'h'; c.target = 1;
  await button(modal, 'Сохранить').onclick();
  assert.equal(notices.length, 0); assert.equal(f.service.maps.length, 1);
  await button(modal, 'Запустить дорожную карту').onclick(); await modal.render();
  assert.equal(button(modal, 'Завершить уровень').disabled, true);
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true }] }); await modal.render();
  assert.equal(button(modal, 'Завершить уровень').disabled, false);
  await button(modal, 'Завершить уровень').onclick(); await modal.render();
  assert.equal(f.service.maps[0].levels[0].status, 'completed');
  await button(modal, 'Редактировать').onclick();
  assert.ok(modal.contentEl.all().some(e => e.text.includes('защищены')));
  assert.equal(modal.contentEl.all().some(e => e.text === '+ Уровень'), false);
  modal.onClose();
});
test('integration uses actual LifeTracker calculations, Store hooks, export and no fake skill XP', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8');
  const context = { module: { exports: {} }, console, require: name => name === './roadmaps' ? require('../roadmaps') : { Plugin: class {}, Modal: class {}, Notice: class {} } };
  vm.runInNewContext(source + '\nmodule.exports = { Store, computeDayXP, getPlayerLevel, computeDayStats, computeCourseStats, courseXPTotal, courseProgress, dayCompletion, STATS, STATES, exportAllTime };', context);
  const f = fixture(), helpers = context.module.exports;
  f.store.ref.habits[0].baseEffects = { intelligence: 2 };
  f.store.coursesData.courses = [{ id: 'course', pieces: [{ id: 'p', firstDoneAt: '2026-10-01', reviews: [] }] }];
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true }], state: { focus: 7 } });
  const service = new RoadmapService(f.store, helpers); await service.init();
  const ctx = await service.context();
  const read = metric => evaluateCondition(condition(metric, { mode: 'absolute', method: 'absolute' }), {}, service.registry, ctx);
  assert.equal(read('player.xp').value, 30); assert.equal(read('stat.intelligence').value, 4);
  assert.equal(evaluateCondition(condition('state.focus', { mode: 'absolute', method: 'average' }), {}, service.registry, ctx).value, 7);
  assert.equal(service.registry.get('skill.xp'), undefined);
  const dirs = new Set(); f.store.a.mkdir = async path => dirs.add(path);
  const oldExists = f.store.a.exists; f.store.a.exists = async path => dirs.has(path) || oldExists(path);
  const folder = await helpers.exportAllTime(f.store);
  assert.equal(JSON.parse(f.files.get(folder + '/roadmaps.json')).schemaVersion, 1);
  const store = new helpers.Store({ vault: { adapter: f.store.a } });
  store.cache['2026-10-01'] = { date: '2026-10-01' }; let invalidated = 0;
  store.roadmaps = { invalidate: () => invalidated++ };
  await store.saveDay('2026-10-01'); assert.equal(invalidated, 1);
});
test('open view refreshes automatically after source notification and unsubscribes on close', async () => {
  const f = fixture(); await f.service.init(); const map = newMap(); map.levels[0].conditions.children = [condition('habit.done', { entityId: 'h' })];
  await f.service.saveMap(map); await f.service.start(map.id);
  const UI = createRoadmapModal(class { constructor() { this.contentEl = new Element(); } }, class {});
  const modal = new UI({}, f.service); modal.mapId = map.id; modal.onOpen();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button(modal, 'Завершить уровень').disabled, true);
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true }] }); f.service.invalidate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button(modal, 'Завершить уровень').disabled, false);
  modal.onClose(); assert.equal(f.service.listeners.size, 0);
});
test('plugin startup uses bundled module on desktop/mobile and registers navigation', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const f = fixture(); const dirs = new Set();
  f.store.a.mkdir = async p => dirs.add(p);
  const originalExists = f.store.a.exists; f.store.a.exists = async p => dirs.has(p) || originalExists(p);
  const commands = [], icons = [];
  class Plugin {
    addCommand(c) { commands.push(c); } addRibbonIcon(icon, title) { icons.push(title); }
    registerEvent() {} registerMarkdownCodeBlockProcessor() {}
  }
  const context = { console, module: { exports: {} }, require: name => { assert.equal(name, 'obsidian'); return { Plugin, Modal: class {}, Notice: class {}, debounce: fn => fn }; } };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8'), context);
  const plugin = new context.module.exports(); plugin.app = { vault: { adapter: f.store.a, on: () => ({}) } };
  await plugin.onload();
  assert.ok(commands.some(c => c.id === 'lt-roadmaps')); assert.ok(icons.includes('LifeTracker: дорожные карты'));
  assert.equal(plugin.store.roadmapsData.schemaVersion, 1);
  // Derived currency updates from source XP without opening rewards or duplicating its formula.
  plugin.store.ref.goals.push({ id: 'g', status: 'achieved' }); await plugin.store.saveRef();
  const ctx = await plugin.store.roadmaps.context();
  const result = evaluateCondition(condition('player.currency', { method: 'absolute', mode: 'absolute' }), {}, plugin.store.roadmaps.registry, ctx);
  assert.equal(result.value, 1);
});
test('write failures keep the previous roadmap state, future journals do not advance metrics', async () => {
  const f = fixture(); await f.service.init(); const map = newMap(); map.levels[0].conditions.children = [condition('habit.done')];
  await f.service.saveMap(map); f.put('2026-10-02', { habitLogs: [{ habitId: 'h', done: true, hours: 100 }] });
  await f.service.start(map.id); assert.equal((await f.view(map.id)).levels[0].result.children[0].value, 0);
  f.store.a.write = async () => { throw new Error('disk full'); };
  await assert.rejects(f.service.archive(map.id), /disk full/); assert.equal(f.service.maps[0].archived, false);
});
test('corrupt roadmap storage stays untouched and cannot be overwritten as an empty collection', async () => {
  const f = fixture(); f.files.set('LifeTracker/roadmaps.json', '{broken'); await f.service.init();
  assert.ok(f.service.loadError);
  await assert.rejects(f.service.saveMap(newMap()), /roadmaps.json/);
  await assert.rejects(f.service.context(), /roadmaps.json/);
  assert.equal(f.files.get('LifeTracker/roadmaps.json'), '{broken');
});
test('skill hours per completion replace manual time, support fractions and zero, and keep legacy links', async () => {
  const { skillHoursForDay } = require('../roadmaps');
  const day = { habitLogs: [{ habitId: 'h', done: true, hours: 20 }] };
  assert.equal(skillHoursForDay({ habitRefs: [{ habitId: 'h', hoursPerCompletion: 0.5, weight: 0.1 }] }, day), 0.5);
  assert.equal(skillHoursForDay({ habitRefs: [{ habitId: 'h', hoursPerCompletion: 0 }] }, day), 0);
  assert.equal(skillHoursForDay({ habitRefs: [{ habitId: 'h', weight: 0.5 }] }, day), 10);
  assert.equal(skillHoursForDay({ habitRefs: [{ habitId: 'h', hoursPerCompletion: 2 }, { habitId: 'h', hoursPerCompletion: 2 }] }, day), 2);
  day.habitLogs[0].done = false;
  assert.equal(skillHoursForDay({ habitRefs: [{ habitId: 'h', hoursPerCompletion: 2 }] }, day), 0);
  const f = fixture(); await f.service.init(); f.store.ref.skills[0].habitRefs[0].hoursPerCompletion = 10;
  f.put('2026-10-01', { habitLogs: [{ habitId: 'h', done: true }] });
  const ctx = await f.service.context();
  assert.equal(evaluateCondition(condition('skill.hours', { entityId: 'sk', mode: 'absolute' }), {}, f.service.registry, ctx).value, 10);
  assert.equal(evaluateCondition(condition('skill.level', { entityId: 'sk', mode: 'absolute', method: 'absolute' }), {}, f.service.registry, ctx).value, 1);
});
test('separate roadmap JSON is reread, updated and protected against stale writes', async () => {
  const f = fixture(); await f.service.init(); const map = newMap(); map.levels[0].conditions.children = [condition('habit.done')];
  await f.service.saveMap(map);
  const external = JSON.parse(f.files.get('LifeTracker/roadmaps.json')); external.maps[0].name = 'External edit';
  f.files.set('LifeTracker/roadmaps.json', JSON.stringify(external)); await f.service.reload();
  assert.equal(f.service.maps[0].name, 'External edit');
  await f.service.archive(map.id);
  assert.equal(JSON.parse(f.files.get('LifeTracker/roadmaps.json')).maps[0].name, 'External edit');
  await assert.rejects(f.service.transaction(async () => { f.files.set('LifeTracker/roadmaps.json', JSON.stringify({ ...external, changed: true })); }), /изменён извне/);
  assert.equal(JSON.parse(f.files.get('LifeTracker/roadmaps.json')).changed, true);
});
test('task picker selects several existing tasks and live checkboxes update their real statuses', async () => {
  const f = fixture(); await f.service.init();
  f.store.work.items.push({ id: 't2', name: 'Find direction', kind: 'task', status: 'backlog' });
  f.store.saveWorkItems = async () => f.files.set('LifeTracker/workItems.json', JSON.stringify(f.store.work));
  const notices = [], UI = createRoadmapModal(class { constructor() { this.contentEl = new Element(); } }, class { constructor(text) { notices.push(text); } });
  const modal = new UI({}, f.service); await modal.render(); await button(modal, '+ Создать').onclick(); await button(modal, '+ Дела').onclick();
  const picker = modal.contentEl.all().find(e => e.children.some(c => c.text === 'Выберите дела для уровня'));
  const picks = picker.all().filter(e => e.tag === 'input'); assert.equal(picks.length, 2, 'ideas are not tasks');
  for (const check of picks) { check.checked = true; check.onchange(); }
  await button(modal, 'Добавить выбранные дела').onclick();
  assert.equal(modal.draft.levels[0].conditions.children.length, 2);
  await button(modal, 'Сохранить').onclick(); await button(modal, 'Запустить дорожную карту').onclick(); await modal.render();
  let checks = modal.contentEl.all().filter(e => e.tag === 'input'); checks[0].checked = true; await checks[0].onchange();
  assert.equal(f.store.work.items.find(x => x.id === 't').status, 'done');
  assert.equal(f.store.work.items.find(x => x.id === 't').completedDate, '2026-10-01');
  assert.equal(button(modal, 'Завершить уровень').disabled, true);
  checks = modal.contentEl.all().filter(e => e.tag === 'input'); checks[1].checked = true; await checks[1].onchange();
  assert.equal(button(modal, 'Завершить уровень').disabled, false);
  checks = modal.contentEl.all().filter(e => e.tag === 'input'); checks[0].checked = false; await checks[0].onchange();
  assert.equal(f.store.work.items.find(x => x.id === 't').status, 'in_progress');
  assert.equal(button(modal, 'Завершить уровень').disabled, true); assert.deepEqual(notices, []);
});
test('task marking respects requirements, write failures and removal; undone tasks do not count from old journal copies', async () => {
  const f = fixture(); await f.service.init(); f.store.work.items[0].minStatRequirement = { stat: 'intelligence', threshold: 5 };
  f.store.saveWorkItems = async () => f.files.set('LifeTracker/workItems.json', JSON.stringify(f.store.work));
  await assert.rejects(f.service.setTaskDone('t', true), /характеристике/);
  f.service.helpers.canCompleteTask = async () => true; await f.service.setTaskDone('t', true);
  f.put('2026-10-01', { completedWorkItems: [{ id: 't', kind: 'task' }] });
  await f.service.setTaskDone('t', false);
  const value = evaluateCondition(condition('task.completed', { entityId: 't', method: 'event', mode: 'absolute' }), {}, f.service.registry, await f.service.context());
  assert.equal(value.value, 0);
  f.store.saveWorkItems = async () => { throw new Error('disk full'); };
  await assert.rejects(f.service.setTaskDone('t', true), /disk full/); assert.equal(f.store.work.items[0].status, 'in_progress');
  await assert.rejects(f.service.setTaskDone('missing', true), /удалено/);
  await assert.rejects(f.service.setTaskDone('i', true), /удалено/);
});
