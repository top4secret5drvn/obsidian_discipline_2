const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { module: { exports: {} }, require: () => ({ Plugin: class {}, Modal: class {}, Notice: class {} }), console };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8') + '\nmodule.exports = { requiredHabitProgress, setHabitDone, updateHabitControl, newItem };', context);
const { requiredHabitProgress: progress, setHabitDone: set, updateHabitControl: control, newItem } = context.module.exports;
function fixture(count) {
  const habits = Array.from({ length: count }, (_, i) => ({ id: 'h' + i }));
  const optional = { id: 'optional', required: false };
  const ref = { habits: [...habits, optional] };
  const day = { habitLogs: ref.habits.map(h => ({ habitId: h.id, done: false })) };
  return { ref, day, habits, optional };
}
test('exact 75% unlocks optional habits and controls respond to changes', () => {
  const { ref, day, habits, optional } = fixture(4);
  const cb = {};
  assert.equal(set(ref, day, optional, true), false);
  control(cb, ref, day, optional); assert.equal(cb.disabled, true);
  habits.slice(0, 2).forEach(h => set(ref, day, h, true));
  assert.equal(progress(ref, day).unlocked, false);
  set(ref, day, habits[2], true);
  control(cb, ref, day, optional); assert.equal(cb.disabled, false);
  assert.equal(set(ref, day, optional, true), true);
  set(ref, day, habits[2], false);
  control(cb, ref, day, optional); assert.equal(cb.disabled, false);
  assert.equal(set(ref, day, optional, false), true);
  control(cb, ref, day, optional); assert.equal(cb.disabled, true);
  assert.equal(set(ref, day, optional, true), false);
});
test('threshold rounds up and deleted or optional habits never count', () => {
  const { ref, day, habits } = fixture(5);
  habits.slice(0, 3).forEach(h => set(ref, day, h, true));
  day.habitLogs.push({ habitId: 'deleted', done: true });
  day.habitLogs.find(l => l.habitId === 'optional').done = true;
  assert.equal(progress(ref, day).needed, 4);
  assert.equal(progress(ref, day).done, 3);
  assert.equal(progress(ref, day).unlocked, false);
  set(ref, day, habits[3], true); assert.equal(progress(ref, day).unlocked, true);
});
test('no mandatory habits unlocks optional habits, progress is per day', () => {
  const { ref, day, optional } = fixture(0);
  assert.equal(set(ref, day, optional, true), true);
  const f = fixture(1);
  set(f.ref, f.day, f.habits[0], true);
  assert.equal(progress(f.ref, { habitLogs: [] }).unlocked, false);
  assert.equal(newItem('habits').required, true);
});
