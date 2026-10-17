const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8');
function fixture() {
  const data = new Map([
    ['LifeTracker/journal/2025-01-02.json', JSON.stringify({ habitLogs: [{ habitId: 'h1', done: true, hours: 2 }], activityLogs: [{ activityId: 'a1', amount: 3 }], substanceLogs: [{ substanceId: 's1', taken: true }], meals: [{ slot: 'lunch', kcal: 400 }], financeLogs: [{ categoryId: 'income', amount: 100 }, { categoryId: 'deleted', amount: 20 }], completedWorkItems: [{ id: 't1', kind: 'task' }] })],
    ['LifeTracker/journal/2024-12-31.json', JSON.stringify({ habitLogs: [{ habitId: 'gone', done: false }], financeLogs: [{ categoryId: 'expense', amount: 50 }] })]
  ]);
  const dirs = new Set(['LifeTracker', 'LifeTracker/journal']);
  const store = { base: 'LifeTracker', ref: { habits: [{ id: 'h1', name: 'Read' }], activities: [{ id: 'a1', name: 'Run', kcalPerUnit: 50 }], substances: [{ id: 's1', name: 'Vitamin' }], finCategories: [{ id: 'income', name: 'Salary', type: 'income' }, { id: 'expense', name: 'Food', type: 'expense' }], skills: [{ id: 'sk1', name: 'Reading', habitRefs: [{ habitId: 'h1', weight: 0.5 }] }], goals: [{ id: 'g1', start: '2024-12-31', completedAt: '2025-01-02' }], achievements: [{ date: '2025-01-02' }] }, work: { items: [{ id: 't1', kind: 'task', createdAt: '2024-12-31' }, { id: 'i1', kind: 'idea' }] }, rewardsData: { inventory: [{ id: 'r1' }] } };
  store.a = { list: async () => ({ files: [...data.keys()].reverse().concat('LifeTracker/journal/readme.txt') }), read: async p => data.get(p), exists: async p => dirs.has(p) || data.has(p), mkdir: async p => { assert(!dirs.has(p)); dirs.add(p); }, write: async (p, content) => data.set(p, content) };
  const context = { module: { exports: {} }, require: () => ({ Plugin: class {}, Modal: class {}, Notice: class {} }), console };
  vm.runInNewContext(source + '\nmodule.exports = exportAllTime;', context);
  return { store, data, dirs, run: context.module.exports };
}
test('exports all four groups, dates, unknown IDs and weighted skill hours without modifying source', async () => {
  const { store, data, run } = fixture();
  const original = JSON.stringify(store.ref);
  const journal = [...data.entries()];
  const folder = await run(store);
  const read = name => JSON.parse(data.get(folder + '/' + name));
  assert.equal([...data.keys()].filter(p => p.startsWith(folder + '/')).length, 5);
  const finance = read('finances.json');
  assert.deepEqual(finance.period, { from: '2024-12-31', to: '2025-01-02' });
  assert.equal(finance.days[0].entries[0].type, 'expense');
  assert.equal(finance.days[1].entries[0].type, 'income');
  assert.equal(finance.days[1].entries[1].categoryId, 'deleted');
  assert.equal(finance.days[1].entries[1].type, null);
  const health = read('activities-food-substances.json').days[1];
  assert.equal(health.activities[0].amount, 3);
  assert.equal(health.substances[0].taken, true);
  assert.equal(health.meals[0].kcal, 400);
  const progress = read('goals-ideas-tasks-skills-rewards.json');
  assert.equal(progress.goals[0].completedAt, '2025-01-02');
  assert.equal(progress.tasks.length, 1);
  assert.equal(progress.ideas.length, 1);
  assert.equal(progress.rewards.inventory.length, 1);
  assert.equal(progress.days[1].skillHours.sk1, 1);
  assert.equal(progress.skillHoursTotal.sk1, 1);
  assert.equal(progress.days[1].completedWorkItems[0].id, 't1');
  assert.equal(read('habits.json').days[0].habits[0].name, null);
  assert.equal(read('habits.json').days[1].habits[0].done, true);
  assert.equal(JSON.stringify(store.ref), original);
  for (const [p, content] of journal) assert.equal(data.get(p), content);
  assert.notEqual(await run(store), folder);
});
test('empty journal exports valid empty groups', async () => {
  const { store, data, run } = fixture(); data.clear();
  const folder = await run(store);
  const result = JSON.parse(data.get(folder + '/habits.json'));
  assert.equal(result.dayCount, 0);
  assert.deepEqual(result.period, { from: null, to: null });
  assert.deepEqual(result.days, []);
});
test('corrupt journal or failed listing aborts before creating export files', async () => {
  const { store, data, dirs, run } = fixture();
  data.set('LifeTracker/journal/2025-01-02.json', '{');
  await assert.rejects(run(store), /JSON/);
  assert.equal(dirs.size, 2);
  store.a.list = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(run(store), /disk unavailable/);
});
test('write failures propagate instead of claiming success', async () => {
  const { store, run } = fixture();
  store.a.write = async () => { throw new Error('disk full'); };
  await assert.rejects(run(store), /disk full/);
});

test('habit percentages include deleted habits and missing days break streaks', async () => {
  const { store, data, run } = fixture();
  for (const date of ['2025-01-01', '2025-01-03', '2025-01-05']) {
    data.set('LifeTracker/journal/' + date + '.json', JSON.stringify({ habitLogs: [{ habitId: 'h1', done: true }, { habitId: 'gone', done: false }] }));
  }
  const folder = await run(store);
  const habits = JSON.parse(data.get(folder + '/habits.json'));
  assert.deepEqual(habits.days.map(d => d.habits.find(h => h.habitId === 'h1')?.streak || 0), [0, 1, 2, 3, 1]);
  assert.equal(habits.days[1].completion.pct, 50);
  assert.equal(habits.summary.find(h => h.habitId === 'h1').longestStreak, 3);
  const health = JSON.parse(data.get(folder + '/activities-food-substances.json'));
  assert.deepEqual(health.days[2].calories, { eaten: 400, burned: 150, balance: 250 });
});
test('streaks continue beyond 365 days', async () => {
  const { store, data, run } = fixture(); data.clear();
  for (let i = 0; i < 400; i++) {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    data.set('LifeTracker/journal/' + date + '.json', JSON.stringify({ habitLogs: [{ habitId: 'h1', done: true }] }));
  }
  const folder = await run(store);
  const habits = JSON.parse(data.get(folder + '/habits.json'));
  assert.equal(habits.summary[0].longestStreak, 400);
  assert.equal(habits.days[399].habits[0].streak, 400);
});
test('roadmaps export separately and configured completion hours replace weighted manual hours', async () => {
  const { store, data, run } = fixture();
  store.ref.skills[0].habitRefs[0].hoursPerCompletion = 0.75;
  store.roadmapsData = { schemaVersion: 1, maps: [{ id: 'road', name: 'Map', levels: [] }] };
  const folder = await run(store);
  const progress = JSON.parse(data.get(folder + '/goals-ideas-tasks-skills-rewards.json'));
  assert.equal(progress.skillHoursTotal.sk1, 0.75);
  assert.equal(progress.roadmaps, undefined);
  assert.equal(JSON.parse(data.get(folder + '/roadmaps.json')).maps[0].id, 'road');
});
