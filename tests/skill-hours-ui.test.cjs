const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.text = options.text || ''; this.children = []; this.listeners = {}; this.value = ''; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  all() { return [this, ...this.children.flatMap(c => c.all())]; }
}
function fixture() {
  const notices = [], context = { module: { exports: {} }, console, require: () => ({ Plugin: class {}, Modal: class {}, Notice: class { constructor(text) { notices.push(text); } } }) };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../main.js'), 'utf8') + '\nmodule.exports = { renderSkillHoursForm, skillHoursFor };', context);
  let writes = 0, refreshed = 0;
  const skill = { id: 'sk', name: 'Programming', habitRefs: [{ habitId: 'h1', hoursPerCompletion: 1 }, { habitId: 'h2', weight: 0.5 }] };
  const store = { ref: { skills: [skill], habits: [{ id: 'h1', name: 'Practice' }, { id: 'h2', name: 'Read' }] }, saveRef: async () => writes++ };
  const el = new Element(); context.module.exports.renderSkillHoursForm(el, store, skill, async () => refreshed++);
  return { el, store, skill, notices, helpers: context.module.exports, counts: () => ({ writes, refreshed }), inputs: el.all().filter(e => e.tag === 'input'), save: el.all().find(e => e.tag === 'button') };
}
test('inline hours are independently editable, saved and immediately used by totals', async () => {
  const f = fixture(); f.inputs[0].value = '0.5'; f.inputs[0].listeners.input();
  f.inputs[1].value = '2.25'; f.inputs[1].listeners.input();
  assert.equal(f.skill.habitRefs[0].hoursPerCompletion, 1, 'draft must not change live settings');
  await f.save.onclick();
  assert.deepEqual(f.counts(), { writes: 1, refreshed: 1 });
  assert.equal(f.skill.habitRefs[0].hoursPerCompletion, 0.5); assert.equal(f.skill.habitRefs[1].hoursPerCompletion, 2.25);
  const days = [{ habitLogs: [{ habitId: 'h1', done: true }, { habitId: 'h2', done: true }] }];
  assert.equal(f.helpers.skillHoursFor(f.store.ref, days).sk, 2.75);
});
test('negative values cannot be saved; failed persistence restores original settings', async () => {
  const f = fixture(); f.inputs[0].value = '-1'; f.inputs[0].listeners.input(); await f.save.onclick();
  assert.equal(f.counts().writes, 0); assert.equal(f.skill.habitRefs[0].hoursPerCompletion, 1);
  f.inputs[0].value = '3'; f.inputs[0].listeners.input(); f.store.saveRef = async () => { throw new Error('disk full'); };
  await f.save.onclick(); assert.equal(f.skill.habitRefs[0].hoursPerCompletion, 1);
  assert.ok(f.notices.some(text => text.includes('disk full'))); assert.equal(f.save.disabled, false);
});
test('empty field restores legacy hours and concurrent changes are protected', async () => {
  const f = fixture(); f.inputs[0].value = ''; f.inputs[0].listeners.input(); await f.save.onclick();
  assert.equal(f.skill.habitRefs[0].hoursPerCompletion, undefined);
  assert.equal(f.helpers.skillHoursFor(f.store.ref, [{ habitLogs: [{ habitId: 'h1', hours: 2 }, { habitId: 'h2', hours: 4 }] }]).sk, 4);
  await f.save.onclick(); assert.equal(f.counts().writes, 1);
  assert.ok(f.notices.some(text => text.includes('Навык изменён')));
});
