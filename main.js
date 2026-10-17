/* LifeTracker v0.4.2 · plain JS · офлайн */
const { Plugin, Modal, Notice, debounce } = require('obsidian');

/* ROADMAPS_BUNDLE_START */
const LifeTrackerRoadmaps = (() => {
const module = { exports: {} };
/* LifeTracker Roadmaps: metric adapters, condition engine, persistence and UI. */
'use strict';
const clone = value => JSON.parse(JSON.stringify(value));
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDate = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dateKey(new Date(y, m - 1, d + n)); };
const id = prefix => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && shiftDate(s, 0) === s;
const MODES = { since_activation: 'После активации', absolute: 'Вся история / текущее значение' };
const METHODS = { absolute: 'Текущее значение', sum: 'Сумма', count: 'Количество событий', days: 'Уникальные дни', streak: 'Текущий стрик', max_streak: 'Максимальный стрик', delta: 'Прирост от старта', average: 'Среднее по записанным дням', event: 'Событие / статус' };
const OPS = { '>=': '≥', '>': '>', '<=': '≤', '<': '<', '=': '=', range: 'Диапазон' };
const methodUnit = (metric, c) => ['days', 'streak', 'max_streak'].includes(c.method) ? 'дней' : c.method === 'count' ? 'событий' : c.method === 'event' ? 'да (1) / нет (0)' : metric?.unit || '';
const EVENT_METHODS = ['sum', 'count', 'days', 'streak', 'max_streak', 'average', 'event'];
class MetricRegistry {
  constructor() { this.metrics = new Map(); }
  register(metric) {
    if (!metric.key || this.metrics.has(metric.key) || typeof metric.read !== 'function') throw new Error('Некорректная или повторная метрика');
    this.metrics.set(metric.key, { methods: metric.kind === 'scalar' ? ['absolute', 'delta'] : EVENT_METHODS, ...metric });
    return this;
  }
  get(key) { return this.metrics.get(key); }
  list() { return [...this.metrics.values()]; }
}
function skillHoursForDay(skill, day) {
  const seen = new Set();
  return (skill.habitRefs || []).reduce((sum, link) => {
    if (seen.has(link.habitId)) return sum;
    seen.add(link.habitId);
    const log = (day.habitLogs || []).find(l => l.habitId === link.habitId);
    if (!log) return sum;
    if (link.hoursPerCompletion !== undefined) {
      return sum + (log.done && Number.isFinite(link.hoursPerCompletion) && link.hoursPerCompletion >= 0 ? link.hoursPerCompletion : 0);
    }
    // Legacy links keep manual logged hours and their previous weight.
    const hours = Number(log.hours) || 0, weight = link.weight ?? 1;
    return sum + (Number.isFinite(weight) ? Math.max(0, hours) * Math.max(0, weight) : 0);
  }, 0);
}
function createRegistry(h = {}) {
  const r = new MetricRegistry();
  const entities = (ctx, collection) => collection === 'tasks' || collection === 'ideas'
    ? ctx.work.items.filter(x => x.kind === (collection === 'tasks' ? 'task' : 'idea'))
    : collection === 'inventory' ? ctx.rewards.inventory || []
    : collection === 'courses' ? ctx.courses.courses || []
    : ctx.ref[collection] || [];
  const selected = (c, entityId) => !c.entityId || c.entityId === entityId;
  const available = (ctx, c, col) => !c.entityId || entities(ctx, col).some(x => x.id === c.entityId);
  const eventMetric = (key, label, source, unit, collection, getEvents, extra = {}) => r.register({
    key, label, source, unit, kind: 'events', collection,
    entities: ctx => collection ? entities(ctx, collection) : [],
    read: (ctx, c) => ({ available: !collection || available(ctx, c, collection), events: getEvents(ctx, c) }), ...extra
  });
  const scalar = (key, label, source, unit, collection, read, extra = {}) => r.register({
    key, label, source, unit, kind: 'scalar', collection,
    entities: ctx => collection ? entities(ctx, collection) : [],
    read: (ctx, c) => ({ available: !collection || available(ctx, c, collection), value: read(ctx, c) }), ...extra
  });
  const daily = (ctx, c, field, key, getValue) => ctx.days.flatMap(day => (day[field] || []).filter(log => selected(c, log[key])).map(log => ({ id: day.date + ':' + log[key], date: day.date, value: getValue(log, ctx) })));
  eventMetric('habit.done', 'Выполнения привычки', 'Привычки', 'раз', 'habits', (ctx, c) => daily(ctx, c, 'habitLogs', 'habitId', l => l.done ? 1 : 0));
  eventMetric('habit.hours', 'Часы привычки', 'Привычки', 'ч', 'habits', (ctx, c) => daily(ctx, c, 'habitLogs', 'habitId', l => Number(l.hours) || 0), { methods: ['sum', 'average', 'days'] });
  eventMetric('activity.amount', 'Объём активности (единицы из справочника)', 'Активности', 'ед.', 'activities', (ctx, c) => daily(ctx, c, 'activityLogs', 'activityId', l => Number(l.amount) || 0));
  eventMetric('activity.calories', 'Расчётные потраченные калории', 'Активности', 'ккал', 'activities', (ctx, c) => daily(ctx, c, 'activityLogs', 'activityId', (l, x) => (Number(l.amount) || 0) * (Number(x.ref.activities.find(a => a.id === l.activityId)?.kcalPerUnit) || 0)), { methods: ['sum', 'average', 'days'] });
  const finance = (type, ctx, c) => ctx.days.map(day => ({ id: day.date + ':' + type + ':' + (c.entityId || '*'), date: day.date, value: (day.financeLogs || []).reduce((sum, log) => {
    const category = ctx.ref.finCategories.find(x => x.id === log.categoryId);
    if (!category || !selected(c, log.categoryId)) return sum;
    return sum + (type === 'balance' ? (category.type === 'income' ? 1 : -1) : category.type === type ? 1 : 0) * (Number(log.amount) || 0);
  }, 0) }));
  for (const [type, label] of [['income', 'Доходы'], ['expense', 'Расходы'], ['balance', 'Баланс доходов и расходов']]) {
    eventMetric('finance.' + type, label, 'Финансы', '₽', 'finCategories', (ctx, c) => finance(type, ctx, c), { methods: ['sum', 'average'], entities: ctx => ctx.ref.finCategories.filter(x => type === 'balance' || x.type === type), signed: type === 'balance' });
  }
  if (h.dayCompletion) eventMetric('habit.completion', 'Дневной процент выполнения привычек', 'Привычки', '%', null, ctx => ctx.days.map(d => ({ id: d.date, date: d.date, value: h.dayCompletion(ctx.ref, d).pct })), { methods: ['average'] });
  const skillHours = (ctx, c) => ctx.days.flatMap(day => ctx.ref.skills.filter(sk => selected(c, sk.id)).map(sk => ({ id: day.date + ':' + sk.id, date: day.date, value: skillHoursForDay(sk, day) })));
  eventMetric('skill.hours', 'Часы развития навыка', 'Навыки', 'ч', 'skills', skillHours, { methods: ['sum', 'average', 'days'] });
  scalar('skill.level', 'Ступень навыка (0–7)', 'Навыки', 'ступень', 'skills', (ctx, c) => {
    const total = skillHours(ctx, c).reduce((s, e) => s + e.value, 0);
    return [10, 100, 500, 1000, 2500, 5000, 10000].filter(n => total >= n).length; // Existing eight named tiers: 0–7.
  }, { requireEntity: true, maxTarget: 7 });
  for (const [kind, col, source] of [['task', 'tasks', 'Задачи'], ['idea', 'ideas', 'Идеи']]) {
    scalar(kind + '.status', 'Количество элементов с выбранным статусом', source, 'шт.', col, (ctx, c) => entities(ctx, col).filter(x => selected(c, x.id) && x.status === (c.status || 'done')).length, { statuses: ['backlog', 'in_progress', 'done', 'dropped'] });
    eventMetric(kind + '.completed', 'Завершённые ' + (kind === 'task' ? 'задачи' : 'идеи'), source, 'шт.', col, (ctx, c) => {
      const seen = new Map();
      for (const item of entities(ctx, col)) if (selected(c, item.id) && item.status === 'done') {
        const date = item.completedDate || item.doneAt;
        if (isDate(date)) seen.set(item.id, { id: item.id, date, value: 1 });
      }
      for (const day of ctx.days) for (const item of day.completedWorkItems || []) if (item.kind === kind && selected(c, item.id) && !seen.has(item.id)) seen.set(item.id, { id: item.id, date: day.date, value: 1 });
      return [...seen.values()];
    }, { methods: ['count', 'days', 'event'] });
  }
  scalar('goal.status', 'Цели с выбранным статусом', 'Цели', 'шт.', 'goals', (ctx, c) => ctx.ref.goals.filter(g => selected(c, g.id) && g.status === (c.status || 'achieved')).length, { statuses: ['active', 'achieved', 'completed'] });
  eventMetric('goal.completed', 'Завершённые цели', 'Цели', 'шт.', 'goals', (ctx, c) => ctx.ref.goals.filter(g => selected(c, g.id) && ['achieved', 'completed'].includes(g.status) && isDate(g.completedDate || g.completedAt)).map(g => ({ id: g.id, date: g.completedDate || g.completedAt, value: 1 })), { methods: ['count', 'days', 'event'] });
  eventMetric('achievement.received', 'Полученные достижения', 'Игра', 'шт.', 'achievements', (ctx, c) => ctx.ref.achievements.filter(a => selected(c, a.id) && isDate(a.date)).map(a => ({ id: a.id, date: a.date, value: 1 })), { methods: ['count', 'event'] });
  scalar('achievement.owned', 'Наличие достижения', 'Игра', 'шт.', 'achievements', (ctx, c) => ctx.ref.achievements.filter(a => selected(c, a.id)).length);
  scalar('reward.owned', 'Наличие трофея', 'Игра', 'шт.', 'inventory', (ctx, c) => (ctx.rewards.inventory || []).filter(x => selected(c, x.id)).length);
  eventMetric('reward.received', 'Полученные трофеи', 'Игра', 'шт.', 'inventory', (ctx, c) => (ctx.rewards.inventory || []).filter(x => selected(c, x.id) && isDate(x.unlockedAt)).map(x => ({ id: x.id, date: x.unlockedAt, value: 1 })), { methods: ['count', 'event'] });
  scalar('player.currency', 'Текущие очки славы', 'Игра', '🪙', null, ctx => h.rewardTotals ? h.rewardTotals(h.getPlayerLevel(xp(ctx), ctx.rewards.levelingConfig).level, ctx.ref, ctx.rewards).currency : ctx.rewards.currency ?? null);
  scalar('player.slots', 'Разблокированные слоты', 'Игра', 'шт.', null, ctx => h.rewardTotals ? h.rewardTotals(h.getPlayerLevel(xp(ctx), ctx.rewards.levelingConfig).level, ctx.ref, ctx.rewards).unlockedSlots : ctx.rewards.unlockedSlots ?? null);
  const dayXP = (ctx, day) => h.computeDayXP ? h.computeDayXP(ctx.ref, day, ctx.work.items) : 0;
  const xp = ctx => ctx.days.reduce((sum, d) => sum + dayXP(ctx, d), 0) + (h.courseXPTotal ? h.courseXPTotal(ctx.courses.courses) : 0);
  if (h.computeDayXP) {
    scalar('player.xp', 'Общий XP персонажа', 'Игра', 'XP', null, xp);
    scalar('player.level', 'Уровень персонажа', 'Игра', 'ур.', null, ctx => h.getPlayerLevel(xp(ctx), ctx.rewards.levelingConfig).level);
    eventMetric('player.dailyXP', 'XP дневных действий', 'Игра', 'XP', null, ctx => ctx.days.map(d => ({ id: d.date, date: d.date, value: dayXP(ctx, d) })), { methods: ['sum', 'average'] });
  }
  if (h.computeDayStats) for (const [key, label] of h.STATS) {
    scalar('stat.' + key, 'Характеристика ' + label, 'Игра', 'очки', null, ctx => ctx.days.reduce((sum, d) => sum + h.computeDayStats(ctx.ref, d).stats[key], 0) + (h.computeCourseStats(ctx.courses.courses)[key] || 0));
  }
  eventMetric('food.calories', 'Зарегистрированные калории', 'Питание', 'ккал', null, ctx => ctx.days.map(d => ({ id: d.date, date: d.date, value: (d.meals || []).reduce((s, m) => s + (Number(m.kcal) || 0), 0) })), { methods: ['sum', 'average'] });
  eventMetric('food.rangeDays', 'Дни в диапазоне калорий', 'Питание', 'дней', null, (ctx, c) => ctx.days.map(d => {
    const kcal = (d.meals || []).reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    return { id: d.date, date: d.date, value: kcal > 0 && kcal >= c.filterMin && kcal <= c.filterMax ? 1 : 0 };
  }), { methods: ['count', 'days', 'streak', 'max_streak'], calorieFilter: true });
  eventMetric('food.meals', 'Зарегистрированные приёмы пищи', 'Питание', 'раз', null, (ctx, c) => ctx.days.flatMap(d => (d.meals || []).filter(m => (!c.slot || m.slot === c.slot) && Number(m.kcal) > 0).map(m => ({ id: d.date + ':' + m.slot, date: d.date, value: 1 }))), { methods: ['count', 'days'], slots: ['breakfast', 'lunch', 'dinner', 'snack'] });
  for (const [key, label] of h.STATES || []) {
    eventMetric('state.' + key, 'Состояние: ' + label, 'Состояние', 'балл', null, ctx => ctx.days.filter(d => Number.isFinite(d.state?.[key])).map(d => ({ id: d.date, date: d.date, value: d.state[key] })), { methods: ['average', 'sum'] });
  }
  eventMetric('substance.taken', 'Дни отмеченного приёма (не дозы)', 'Вещества', 'дней', 'substances', (ctx, c) => daily(ctx, c, 'substanceLogs', 'substanceId', l => l.taken ? 1 : 0), { methods: ['days', 'streak', 'max_streak'], requireEntity: true });
  eventMetric('course.completedPieces', 'Изученные части курса', 'Курсы', 'шт.', 'courses', (ctx, c) => ctx.courses.courses.filter(course => selected(c, course.id)).flatMap(course => (course.pieces || []).filter(p => isDate(p.firstDoneAt)).map(p => ({ id: course.id + ':' + p.id, date: p.firstDoneAt, value: 1 }))), { methods: ['count', 'days', 'event'] });
  eventMetric('course.reviews', 'Выполненные повторения курса', 'Курсы', 'раз', 'courses', (ctx, c) => ctx.courses.courses.filter(course => selected(c, course.id)).flatMap(course => (course.pieces || []).flatMap(piece => (piece.reviews || []).filter(review => isDate(review.doneAt)).map(review => ({ id: course.id + ':' + piece.id + ':' + review.offsetDays, date: review.doneAt, value: 1 })))), { methods: ['count', 'days'] });
  scalar('course.progress', 'Прогресс курса', 'Курсы', '%', 'courses', (ctx, c) => h.courseProgress ? h.courseProgress(ctx.courses.courses.find(x => x.id === c.entityId)) : null, { requireEntity: true, maxTarget: 100 });
  return r;
}
function leaves(node) { return node.kind === 'group' ? node.children.flatMap(leaves) : [node]; }
function validateTree(node, registry, ctx, seen = new Set(), depth = 0) {
  const errors = [];
  if (!node || depth > 12 || !node.id || seen.has(node.id)) return ['Некорректная структура условий'];
  seen.add(node.id);
  if (node.kind === 'group') {
    if (!['AND', 'OR'].includes(node.op) || !Array.isArray(node.children) || !node.children.length) return ['Добавьте условия в группу'];
    for (const child of node.children) errors.push(...validateTree(child, registry, ctx, seen, depth + 1));
    return errors;
  }
  const metric = registry.get(node.metric);
  if (!metric) return ['Источник метрики недоступен'];
  if (!metric.methods.includes(node.method) || !MODES[node.mode] || !OPS[node.operator]) errors.push('Несовместимый способ подсчёта, режим или оператор');
  if (metric.kind === 'scalar' && node.mode === 'since_activation' && node.method !== 'delta') errors.push('Для текущего показателя выберите абсолютный режим или прирост');
  if (node.method === 'delta' && node.mode !== 'since_activation') errors.push('Прирост требует режима после активации');
  if (!Number.isFinite(node.target) || (node.operator === 'range' && (!Number.isFinite(node.upper) || node.upper < node.target))) errors.push('Проверьте числовые пороги');
  if (metric.maxTarget !== undefined && node.target > metric.maxTarget && node.method !== 'delta') errors.push('Порог превышает существующую шкалу');
  if (metric.requireEntity && !node.entityId) errors.push('Выберите конкретный объект');
  if (ctx && node.entityId && !metric.entities(ctx).some(x => x.id === node.entityId)) errors.push('Объект удалён или недоступен');
  if (metric.statuses && !metric.statuses.includes(node.status)) errors.push('Выберите существующий статус');
  if (metric.slots && node.slot && !metric.slots.includes(node.slot)) errors.push('Неизвестный приём пищи');
  if (metric.calorieFilter && (!Number.isFinite(node.filterMin) || !Number.isFinite(node.filterMax) || node.filterMin < 0 || node.filterMax < node.filterMin)) errors.push('Проверьте диапазон калорий');
  if ((node.from && !isDate(node.from)) || (node.to && !isDate(node.to)) || (node.from && node.to && node.from > node.to)) errors.push('Проверьте период');
  if (metric.kind === 'events' && ['<=', '<', 'range'].includes(node.operator) && !node.to) errors.push('Для ограничения сверху задайте конец периода');
  if (node.kind !== 'condition') errors.push('Неизвестный вид условия');
  return errors;
}
function compare(value, operator, target, upper) {
  switch (operator) { case '>=': return value >= target; case '>': return value > target; case '<=': return value <= target; case '<': return value < target; case '=': return value === target; case 'range': return value >= target && value <= upper; default: return false; }
}
function metricSnapshot(metric, ctx, c) {
  const data = metric.read(ctx, c);
  if (!data.available) return null;
  if (metric.kind === 'scalar') return { value: Number.isFinite(data.value) ? data.value : null };
  // Stable IDs represent daily buckets or entity completion, never array positions.
  const events = {};
  for (const e of data.events || []) if (isDate(e.date) && e.date === ctx.today && Number.isFinite(e.value)) events[e.id] = { date: e.date, value: e.value };
  return { events };
}
function snapshotTree(tree, registry, ctx) {
  return Object.fromEntries(leaves(tree).map(c => [c.id, metricSnapshot(registry.get(c.metric), ctx, c)]));
}
function evaluateCondition(c, level, registry, ctx) {
  const metric = registry.get(c.metric);
  const entity = metric?.entities?.(ctx).find(x => x.id === c.entityId);
  const base = { entityName: entity?.name || entity?.title || null, id: c.id, name: c.name || metric?.label || c.metric, unit: methodUnit(metric, c), value: null, percent: null, met: false, state: 'missing' };
  const errors = validateTree(c, registry);
  if (errors.length) return { ...base, message: errors.join('; ') };
  let data;
  try { data = metric.read(ctx, c); } catch (error) { return { ...base, message: 'Ошибка источника: ' + error.message }; }
  if (!data.available) return { ...base, message: 'Исходный объект удалён или недоступен' };
  if (c.mode === 'since_activation' && !level.activatedAt) return { ...base, state: 'locked', message: 'Уровень ещё не активирован' };
  if (c.mode === 'since_activation' && c.to && c.to < level.activationDate) return { ...base, message: 'Период закончился до активации уровня' };
  const baseline = level.baselines?.[c.id];
  if (c.mode === 'since_activation' && !baseline) return { ...base, message: 'Нет базового значения. Создайте новую копию карты.' };
  let value, sampleCount = 0;
  if (metric.kind === 'scalar') {
    value = data.value;
    if (c.method === 'delta') value = Number.isFinite(value) && Number.isFinite(baseline?.value) ? value - baseline.value : null;
  } else {
    let events = [...new Map((data.events || []).map(e => [e.id, e])).values()].filter(e => isDate(e.date) && e.date <= ctx.today && (!c.from || e.date >= c.from) && (!c.to || e.date <= c.to) && Number.isFinite(e.value));
    if (c.mode === 'since_activation') {
      events = events.filter(e => e.date >= level.activationDate).map(e => {
        const old = baseline.events?.[e.id];
        // Completed/status events already present at activation never count twice.
        const subtract = old?.value || 0;
        return { ...e, value: metric.signed ? e.value - subtract : Math.max(0, e.value - subtract) };
      });
    }
    const positive = events.filter(e => e.value > 0);
    const dates = [...new Set(positive.map(e => e.date))].sort();
    sampleCount = events.length;
    if (c.method === 'sum') value = events.reduce((sum, e) => sum + e.value, 0);
    if (c.method === 'count') value = positive.length;
    if (c.method === 'days') value = dates.length;
    if (c.method === 'event') value = positive.length ? 1 : 0;
    if (c.method === 'average') {
      const byDate = new Map(); for (const e of events) byDate.set(e.date, (byDate.get(e.date) || 0) + e.value);
      value = byDate.size ? [...byDate.values()].reduce((a, b) => a + b, 0) / byDate.size : null;
    }
    if (['streak', 'max_streak'].includes(c.method)) {
      let best = 0, run = 0, previous = null;
      for (const date of dates) { run = previous && shiftDate(previous, 1) === date ? run + 1 : 1; best = Math.max(best, run); previous = date; }
      // Current streak must end on the evaluation date (or explicit period end).
      value = c.method === 'max_streak' ? best : previous === (c.to && c.to < ctx.today ? c.to : ctx.today) ? run : 0;
    }
  }
  if (!Number.isFinite(value)) return { ...base, message: 'Нет данных для расчёта' };
  const metNow = compare(value, c.operator, c.target, c.upper);
  const waiting = metric.kind === 'events' && ['<=', '<', 'range'].includes(c.operator) && c.to >= ctx.today;
  const met = metNow && !waiting;
  // Upper bounds and ranges have a pass/fail state, never an inverted progress bar.
  const percent = ['>=', '>'].includes(c.operator) && c.target > 0 ? Math.min(met ? 100 : 99.9, Math.max(0, value / c.target * 100)) : null;
  return { ...base, value, percent, met, state: waiting ? 'pending' : met ? 'met' : 'unmet', sampleCount,
    target: c.target, upper: c.upper, operator: c.operator, message: waiting ? 'Окончательная проверка после окончания периода' : metric.kind === 'events' && !sampleCount ? 'За период нет записанных событий' : '' };
}
function evaluateTree(node, level, registry, ctx) {
  if (node.kind !== 'group') return evaluateCondition(node, level, registry, ctx);
  const children = node.children.map(child => evaluateTree(child, level, registry, ctx));
  const met = children.length > 0 && (node.op === 'OR' ? children.some(c => c.met) : children.every(c => c.met));
  const values = children.map(c => c.met ? 100 : c.percent ?? 0);
  return { id: node.id, kind: 'group', op: node.op, met, children, percent: !values.length ? 0 : node.op === 'OR' ? Math.max(...values) : values.reduce((a, b) => a + b, 0) / values.length };
}
function evaluateMap(map, registry, ctx) {
  const levels = map.levels.map(level => {
    if (level.status === 'completed') return { id: level.id, status: 'completed', result: level.completion.result };
    if (!level.activatedAt) return { id: level.id, status: 'locked', result: null };
    const result = evaluateTree(level.conditions, level, registry, ctx);
    return { id: level.id, status: result.met ? 'ready' : 'active', result };
  });
  const done = levels.filter(l => l.status === 'completed').length;
  const active = levels.find(l => ['active', 'ready'].includes(l.status));
  return { levels, percent: levels.length ? Math.round((done + (active?.result?.percent || 0) / 100) / levels.length * 100) : 0,
    status: map.archived ? 'archived' : done === levels.length && levels.length ? 'completed' : map.startedAt ? 'active' : 'draft' };
}
const newGroup = () => ({ id: id('group'), kind: 'group', op: 'AND', children: [] });
const newLevel = () => ({ id: id('level'), name: 'Новый уровень', description: '', status: 'locked', activatedAt: null, completedAt: null, conditions: newGroup() });
const newMap = () => ({ id: id('roadmap'), name: 'Новая дорожная карта', description: '', icon: '🗺️', color: '#7c6fda', deadline: '', startedAt: null, archived: false, levels: [newLevel()] });
class RoadmapService {
  constructor(store, helpers = {}, clock = () => new Date()) { this.store = store; this.registry = createRegistry(helpers); this.clock = clock; this.listeners = new Set(); this.queue = Promise.resolve(); }
  async init() { return this.reload(); }
  async reload() {
    const path = this.path();
    try {
      const text = await this.store.a.exists(path) ? await this.store.a.read(path) : null;
      this.storageText = text;
      this.store.roadmapsData = text === null ? { schemaVersion: 1, maps: [] } : JSON.parse(text);
      if (this.store.roadmapsData.schemaVersion !== 1 || !Array.isArray(this.store.roadmapsData.maps)) throw new Error('Неизвестный формат дорожных карт');
      this.loadError = null;
    } catch (error) {
      this.loadError = new Error('Не удалось загрузить roadmaps.json: ' + error.message);
      this.store.roadmapsData = null; // Preserve the original file; never replace corruption with an empty map.
    }
  }
  path() { return this.store.base + '/roadmaps.json'; }
  get maps() { if (this.loadError) throw this.loadError; return this.store.roadmapsData.maps; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  invalidate() { for (const fn of this.listeners) fn(); }
  async context() {
    if (this.loadError) throw this.loadError;
    const a = this.store.a, base = this.store.base;
    const read = async (name, fallback) => await a.exists(base + '/' + name) ? JSON.parse(await a.read(base + '/' + name)) : clone(fallback);
    const [ref, work, rewards, courses, listing] = await Promise.all([
      read('reference.json', this.store.ref), read('workItems.json', this.store.work || { items: [] }),
      read('rewards.json', this.store.rewardsData || {}), read('courses.json', this.store.coursesData || { courses: [] }), a.list(base + '/journal')
    ]);
    for (const key of ['habits', 'activities', 'substances', 'skills', 'goals', 'finCategories', 'achievements', 'synergyRules']) if (!Array.isArray(ref[key])) ref[key] = [];
    const days = [];
    for (const path of listing.files.filter(p => /\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).sort()) {
      const raw = JSON.parse(await a.read(path));
      const date = path.split('/').pop().slice(0, -5);
      if (!isDate(date)) throw new Error('Некорректная дата журнала: ' + date);
      if (date > dateKey(this.clock())) continue;
      days.push({ state: {}, habitLogs: [], activityLogs: [], substanceLogs: [], meals: [], financeLogs: [], ...raw, date });
    }
    return { ref, work, rewards, courses, days, today: dateKey(this.clock()) };
  }
  async persist(data, expectedText = this.storageText) {
    if (this.loadError) throw this.loadError;
    const current = await this.store.a.exists(this.path()) ? await this.store.a.read(this.path()) : null;
    if (current !== expectedText) throw new Error('roadmaps.json изменён извне. Обновите экран и повторите действие.');
    const text = JSON.stringify(data, null, 2);
    await this.store.a.write(this.path(), text);
    this.storageText = text; this.store.roadmapsData = data; this.invalidate();
  }
  transaction(fn) {
    const job = this.queue.then(async () => { await this.reload(); if (this.loadError) throw this.loadError; const expected = this.storageText; const data = clone(this.store.roadmapsData); const result = await fn(data); await this.persist(data, expected); return result; });
    this.queue = job.catch(() => {}); return job;
  }
  async saveMap(draft) {
    return this.transaction(async data => {
      const current = data.maps.find(m => m.id === draft.id);
      const ctx = await this.context();
      if (!draft.name.trim() || !draft.levels.length) throw new Error('Нужны название и хотя бы один уровень');
      if (draft.deadline && !isDate(draft.deadline)) throw new Error('Проверьте срок');
      if (!/^#[0-9a-f]{6}$/i.test(draft.color)) throw new Error('Проверьте цвет');
      if (current?.startedAt) {
        if (JSON.stringify(current.levels) !== JSON.stringify(draft.levels)) throw new Error('Условия запущенной карты защищены. Дублируйте карту для изменения.');
        for (const key of ['name', 'description', 'icon', 'color', 'deadline']) current[key] = draft[key];
      } else {
        const ids = new Set();
        for (const level of draft.levels) {
          if (!level.name.trim() || !level.id || ids.has(level.id)) throw new Error('Проверьте названия и уровни');
          ids.add(level.id);
          const errors = validateTree(level.conditions, this.registry, ctx);
          if (errors.length) throw new Error(level.name + ': ' + errors.join('; '));
        }
        const clean = clone(draft); clean.startedAt = null; clean.archived = current?.archived || false;
        for (const l of clean.levels) { l.status = 'locked'; l.activatedAt = null; l.completedAt = null; delete l.baselines; delete l.completion; }
        if (current) data.maps[data.maps.indexOf(current)] = clean; else data.maps.push(clean);
      }
    });
  }
  async activate(level, ctx) {
    const errors = validateTree(level.conditions, this.registry, ctx);
    if (errors.length) throw new Error(errors.join('; '));
    level.activatedAt = this.clock().toISOString(); level.activationDate = dateKey(this.clock()); level.status = 'active';
    level.baselines = snapshotTree(level.conditions, this.registry, ctx);
  }
  start(mapId) { return this.transaction(async data => {
    const map = data.maps.find(m => m.id === mapId); if (!map || map.startedAt || map.archived) throw new Error('Карта недоступна для запуска');
    if (!map.levels.length) throw new Error('Добавьте уровни');
    const ctx = await this.context(); await this.activate(map.levels[0], ctx); map.startedAt = this.clock().toISOString();
  }); }
  complete(mapId, levelId) { return this.transaction(async data => {
    const map = data.maps.find(m => m.id === mapId); if (!map || map.archived) throw new Error('Карта недоступна');
    const index = map.levels.findIndex(l => l.id === levelId), level = map.levels[index];
    if (!level || level.status === 'completed' || !level.activatedAt || map.levels.slice(0, index).some(l => l.status !== 'completed')) throw new Error('Уровень заблокирован или завершён');
    const ctx = await this.context(), result = evaluateTree(level.conditions, level, this.registry, ctx);
    if (!result.met) throw new Error('Условия ещё не выполнены');
    // Next activation and completion share one consistent data snapshot and one write.
    if (map.levels[index + 1]) await this.activate(map.levels[index + 1], ctx);
    level.status = 'completed'; level.completedAt = this.clock().toISOString();
    level.completion = { completedAt: level.completedAt, conditions: clone(level.conditions), result: clone(result) };
  }); }
  duplicate(mapId) { return this.transaction(data => {
    const original = data.maps.find(m => m.id === mapId); if (!original) throw new Error('Карта не найдена');
    const copy = clone(original); copy.id = id('roadmap'); copy.name += ' (копия)'; copy.startedAt = null; copy.archived = false;
    for (const level of copy.levels) { level.id = id('level'); level.status = 'locked'; level.activatedAt = null; level.completedAt = null; delete level.activationDate; delete level.baselines; delete level.completion; for (const n of walkNodes(level.conditions)) n.id = id(n.kind); }
    data.maps.push(copy); return copy.id;
  }); }
  archive(mapId) { return this.transaction(data => { const map = data.maps.find(m => m.id === mapId); if (!map) throw new Error('Карта не найдена'); map.archived = !map.archived; }); }
  remove(mapId) { return this.transaction(data => { data.maps = data.maps.filter(m => m.id !== mapId); }); }
}
function* walkNodes(node) { yield node; if (node.kind === 'group') for (const child of node.children) yield* walkNodes(child); }

function createRoadmapModal(Modal, Notice) {
  const statusName = { draft: 'Не запущена', active: 'В работе', ready: 'Готов к завершению', locked: 'Заблокирован', completed: 'Завершён', archived: 'В архиве' };
  return class RoadmapsModal extends Modal {
    constructor(app, service) { super(app); this.service = service; this.mapId = null; this.revision = 0; this.busy = false; }
    onOpen() { this.contentEl.addClass('lt', 'lt-roadmaps'); this.off = this.service.subscribe(() => { if (!this.draft) this.render(); }); this.timer = setInterval(() => { if (!this.draft) this.render(); }, 60000); this.render(); }
    onClose() { this.off?.(); clearInterval(this.timer); this.revision++; }
    button(parent, text, action, disabled = false) {
      const b = parent.createEl('button', { text }); b.disabled = disabled;
      b.onclick = async () => {
        if (this.busy) return;
        this.busy = true; b.disabled = true;
        try { await action(); } catch (error) { new Notice(error.message, 10000); }
        finally { this.busy = false; if (b.isConnected) b.disabled = disabled; }
      };
      return b;
    }
    select(parent, label, value, options, onChange) {
      const row = parent.createEl('label', { cls: 'lt-rm-field' }); row.createEl('span', { text: label });
      const select = row.createEl('select');
      for (const [key, text] of options) select.createEl('option', { value: key, text });
      select.value = value ?? ''; select.onchange = () => onChange(select.value); return select;
    }
    input(parent, label, value, change, type = 'text') {
      const row = parent.createEl('label', { cls: 'lt-rm-field' }); row.createEl('span', { text: label });
      const input = row.createEl(type === 'textarea' ? 'textarea' : 'input', type === 'textarea' ? {} : { type });
      input.value = value ?? ''; input.oninput = () => change(type === 'number' ? (input.value.trim() ? Number(input.value) : null) : input.value); return input;
    }
    async render() {
      if (this.draft) return this.renderEditor();
      const revision = ++this.revision;
      try {
        await this.service.reload();
        const ctx = await this.service.context();
        if (revision !== this.revision || this.draft) return;
        this.ctx = ctx; const el = this.contentEl; el.empty();
        const bar = el.createDiv({ cls: 'lt-actions-bar' }); bar.createEl('h2', { text: '🗺️ Дорожные карты' });
        this.button(bar, '+ Создать', () => { this.draft = newMap(); this.renderEditor(); });
        this.button(bar, 'Обновить', () => this.render());
        if (this.mapId) this.renderDetail(el, ctx); else this.renderList(el, ctx);
      } catch (error) {
        if (revision !== this.revision) return;
        this.contentEl.empty(); this.contentEl.createDiv({ cls: 'lt-notice', text: 'Не удалось прочитать данные: ' + error.message });
        this.button(this.contentEl, 'Повторить', () => this.render());
      }
    }
    renderList(el, ctx) {
      if (!this.service.maps.length) el.createEl('p', { text: 'Создайте карту, добавьте уровни и условия, затем запустите её.' });
      for (const map of this.service.maps) {
        const view = evaluateMap(map, this.service.registry, ctx);
        const card = el.createDiv({ cls: 'lt-rm-card' }); card.style.borderLeftColor = map.color;
        card.createEl('h3', { text: (map.icon || '🗺️') + ' ' + map.name });
        card.createEl('p', { text: map.description || '' });
        const index = view.levels.findIndex(l => ['active', 'ready'].includes(l.status));
        card.createDiv({ text: `${statusName[view.status]} · ${view.percent}%` + (index >= 0 ? ' · ' + map.levels[index].name : '') });
        this.progress(card, view.percent);
        this.button(card, 'Открыть', () => { this.mapId = map.id; this.render(); });
      }
    }
    progress(el, value) { const p = el.createEl('progress'); p.max = 100; p.value = value; p.setAttribute('aria-label', 'Прогресс ' + Math.round(value) + '%'); }
    renderDetail(el, ctx) {
      const map = this.service.maps.find(m => m.id === this.mapId);
      if (!map) { this.mapId = null; return this.render(); }
      const view = evaluateMap(map, this.service.registry, ctx);
      const actions = el.createDiv({ cls: 'lt-rm-actions' });
      this.button(actions, '← Все карты', () => { this.mapId = null; this.render(); });
      this.button(actions, 'Редактировать', () => { this.draft = clone(map); this.renderEditor(); });
      this.button(actions, 'Дублировать', async () => { this.mapId = await this.service.duplicate(map.id); await this.render(); });
      this.button(actions, map.archived ? 'Из архива' : 'В архив', () => this.service.archive(map.id));
      const del = this.button(actions, 'Удалить', async () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.setText('Удалить навсегда?'); return; }
        await this.service.remove(map.id); this.mapId = null; await this.render();
      });
      el.createEl('h2', { text: (map.icon || '🗺️') + ' ' + map.name });
      el.createEl('p', { text: map.description });
      el.createDiv({ text: `${statusName[view.status]} · ${view.percent}%` + (map.deadline ? ' · Срок: ' + map.deadline : '') });
      this.progress(el, view.percent);
      if (!map.startedAt && !map.archived) this.button(el, 'Запустить дорожную карту', () => this.service.start(map.id));
      for (let i = 0; i < map.levels.length; i++) {
        const level = map.levels[i], state = view.levels[i];
        const box = el.createEl('details', { cls: 'lt-rm-level lt-rm-' + state.status });
        box.open = ['active', 'ready'].includes(state.status);
        box.createEl('summary', { text: `${i + 1}. ${level.name} · ${statusName[state.status]}` });
        box.createEl('p', { text: level.description });
        if (level.activatedAt) box.createDiv({ cls: 'lt-description', text: 'Активирован: ' + new Date(level.activatedAt).toLocaleString() });
        if (level.completedAt) box.createDiv({ cls: 'lt-description', text: 'Завершён: ' + new Date(level.completedAt).toLocaleString() + ' · Результат зафиксирован' });
        this.renderResult(box, level.conditions, state.result, ctx);
        if (state.status === 'locked') box.createDiv({ cls: 'lt-notice', text: i ? 'Откроется после выполнения условий и подтверждения завершения предыдущего уровня. Прогресс ещё не засчитывается.' : 'Откроется после запуска карты.' });
        if (state.status === 'active') box.createDiv({ cls: 'lt-description', text: 'Выполните логическую структуру условий. Для открытия следующего уровня потребуется подтверждение.' });
        if (['active', 'ready'].includes(state.status)) this.button(box, 'Завершить уровень', () => this.service.complete(map.id, level.id), state.status !== 'ready' || map.archived);
      }
    }
    renderResult(el, node, result, ctx) {
      if (node.kind === 'group') {
        const group = el.createDiv({ cls: 'lt-rm-group' });
        group.createDiv({ text: (node.op === 'AND' ? 'Все условия (AND)' : 'Любое условие (OR)') + (result?.met ? ' ✓' : '') });
        node.children.forEach((child, i) => this.renderResult(group, child, result?.children?.[i], ctx)); return;
      }
      const metric = this.service.registry.get(node.metric);
      const row = el.createDiv({ cls: 'lt-rm-condition' });
      const entity = metric?.entities?.(ctx).find(x => x.id === node.entityId);
      row.createEl('strong', { text: node.name || metric?.label || node.metric });
      if (node.entityId) row.createDiv({ text: result?.entityName || entity?.name || entity?.title || '(объект удалён)' });
      row.createDiv({ text: `${result?.met ? '✓' : result?.state === 'missing' ? '?' : '○'} ${result?.value == null ? '—' : Math.round(result.value * 100) / 100} ${result?.unit || methodUnit(metric, node)} / ${OPS[node.operator] || node.operator} ${node.target}${node.operator === 'range' ? '…' + node.upper : ''}` });
      row.createDiv({ cls: 'lt-description', text: `${MODES[node.mode]} · ${METHODS[node.method]}${node.from ? ' · с ' + node.from : ''}${node.to ? ' · по ' + node.to : ''}` });
      if (result?.percent != null) this.progress(row, result.percent);
      if (result?.message) row.createDiv({ cls: 'lt-notice', text: result.message });
    }
    renderEditor() {
      ++this.revision;
      const el = this.contentEl; el.empty(); const draft = this.draft;
      el.createEl('h2', { text: 'Редактор дорожной карты' });
      const actions = el.createDiv({ cls: 'lt-rm-actions' });
      this.button(actions, 'Сохранить', async () => { await this.service.saveMap(draft); this.mapId = draft.id; this.draft = null; await this.render(); });
      this.button(actions, 'Отмена', () => { this.draft = null; this.render(); });
      this.input(el, 'Название', draft.name, v => draft.name = v);
      this.input(el, 'Описание', draft.description, v => draft.description = v, 'textarea');
      this.input(el, 'Иконка', draft.icon, v => draft.icon = v);
      this.input(el, 'Цвет', draft.color, v => draft.color = v, 'color');
      this.input(el, 'Срок (необязательно)', draft.deadline, v => draft.deadline = v, 'date');
      if (draft.startedAt) {
        el.createDiv({ cls: 'lt-notice', text: 'Карта уже запущена. Уровни и условия защищены от изменения истории. Можно менять оформление или дублировать карту для новых условий.' });
        return;
      }
      el.createDiv({ cls: 'lt-notice', text: '«После активации» исключает уже записанный прогресс, включая день старта. Стрики считаются внутри периода уровня. Среднее — по записанным дням; дни без журнала в среднее не входят. Единицы объёма активности должны совпадать с её справочником.' });
      for (let index = 0; index < draft.levels.length; index++) {
        const level = draft.levels[index], box = el.createDiv({ cls: 'lt-rm-card' });
        box.createEl('h3', { text: 'Уровень ' + (index + 1) });
        this.input(box, 'Название', level.name, v => level.name = v);
        this.input(box, 'Описание', level.description, v => level.description = v, 'textarea');
        this.reorder(box, draft.levels, index);
        this.renderTreeEditor(box, level.conditions);
      }
      this.button(el, '+ Уровень', () => { draft.levels.push(newLevel()); this.renderEditor(); });
    }
    reorder(el, array, index) {
      const bar = el.createDiv({ cls: 'lt-rm-actions' });
      this.button(bar, '↑', () => { [array[index - 1], array[index]] = [array[index], array[index - 1]]; this.renderEditor(); }, index === 0);
      this.button(bar, '↓', () => { [array[index + 1], array[index]] = [array[index], array[index + 1]]; this.renderEditor(); }, index === array.length - 1);
      this.button(bar, 'Убрать', () => { array.splice(index, 1); this.renderEditor(); });
    }
    defaultCondition() {
      const metric = this.service.registry.list()[0];
      return { id: id('condition'), kind: 'condition', name: '', metric: metric.key, method: metric.methods[0], mode: 'since_activation', entityId: '', operator: '>=', target: 1 };
    }
    renderTreeEditor(el, node, depth = 0) {
      const group = el.createDiv({ cls: 'lt-rm-group' });
      if (node.kind === 'group') {
        this.select(group, 'Логика группы', node.op, [['AND', 'Все (AND)'], ['OR', 'Любое (OR)']], v => node.op = v);
        node.children.forEach((child, index) => {
          const wrap = group.createDiv(); this.reorder(wrap, node.children, index); this.renderTreeEditor(wrap, child, depth + 1);
        });
        this.button(group, '+ Условие', () => { node.children.push(this.defaultCondition()); this.renderEditor(); });
        this.button(group, '+ Группа AND/OR', () => { node.children.push(newGroup()); this.renderEditor(); }, depth >= 10);
        return;
      }
      const registry = this.service.registry, metric = registry.get(node.metric);
      this.input(group, 'Название условия', node.name, v => node.name = v);
      this.select(group, 'Источник', metric?.source, [...new Set(registry.list().map(m => m.source))].map(s => [s, s]), source => {
        const next = registry.list().find(m => m.source === source); this.changeMetric(node, next); this.renderEditor();
      });
      this.select(group, 'Показатель', node.metric, registry.list().filter(m => m.source === metric?.source).map(m => [m.key, m.label]), key => { this.changeMetric(node, registry.get(key)); this.renderEditor(); });
      if (!metric) return;
      if (metric.collection) this.select(group, 'Объект', node.entityId || '', [['', metric.requireEntity ? 'Выберите объект…' : 'Все объекты'], ...metric.entities(this.ctx).map(x => [x.id, x.name || x.title || '(без названия)'])], v => node.entityId = v);
      if (metric.statuses) this.select(group, 'Статус', node.status, metric.statuses.map(s => [s, ({ backlog: 'Ожидает', in_progress: 'В работе', done: 'Выполнено', dropped: 'Отброшено', active: 'Активна', achieved: 'Достигнута', completed: 'Завершена' })[s]]), v => node.status = v);
      if (metric.slots) this.select(group, 'Приём пищи', node.slot || '', [['', 'Все'], ...metric.slots.map(s => [s, ({ breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' })[s]])], v => node.slot = v);
      if (metric.calorieFilter) { this.input(group, 'Минимум ккал за день', node.filterMin, v => node.filterMin = v, 'number'); this.input(group, 'Максимум ккал за день', node.filterMax, v => node.filterMax = v, 'number'); }
      if (node.metric === 'substance.taken') group.createDiv({ cls: 'lt-notice', text: 'Учитываются только дни с отметкой приёма, не дозы и не число приёмов за день. Следуйте назначенной схеме; трекер её не задаёт.' });
      if (node.metric === 'skill.level') group.createDiv({ cls: 'lt-description', text: 'Существующие ступени: 0 Новичок, 1 Начинающий, 2 Практик, 3 Опытный, 4 Профессионал, 5 Эксперт, 6 Мастер, 7 Легенда.' });
      this.select(group, 'Способ подсчёта', node.method, metric.methods.map(m => [m, METHODS[m]]), v => {
        node.method = v; if (metric.kind === 'scalar') node.mode = v === 'delta' ? 'since_activation' : 'absolute'; this.renderEditor();
      });
      if (metric.kind === 'events') this.select(group, 'Режим', node.mode, Object.entries(MODES), v => node.mode = v);
      else group.createDiv({ cls: 'lt-description', text: MODES[node.mode] });
      this.select(group, 'Сравнение', node.operator, Object.entries(OPS), v => { node.operator = v; this.renderEditor(); });
      this.input(group, 'Цель (' + methodUnit(metric, node) + ')', node.target, v => node.target = v, 'number');
      if (node.operator === 'range') this.input(group, 'Верхняя граница', node.upper, v => node.upper = v, 'number');
      if (metric.kind === 'events') { this.input(group, 'С даты (необязательно)', node.from, v => node.from = v, 'date'); this.input(group, 'По дату включительно', node.to, v => node.to = v, 'date'); }
    }
    changeMetric(node, metric) {
      Object.assign(node, { metric: metric.key, entityId: '', method: metric.methods[0], mode: metric.kind === 'scalar' ? 'absolute' : 'since_activation', status: metric.statuses?.includes('done') ? 'done' : metric.statuses?.[0], slot: '', filterMin: 0, filterMax: 2500 });
    }
  };
}
module.exports = { skillHoursForDay, MetricRegistry, createRegistry, validateTree, evaluateCondition, evaluateTree, evaluateMap, snapshotTree, newMap, newLevel, newGroup, RoadmapService, createRoadmapModal };

return module.exports;
})();
/* ROADMAPS_BUNDLE_END */

/* ---------- даты ---------- */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/* ---------- словари метрик ---------- */
const STATS = [['intelligence','ИНТ'],['strength','СИЛ'],['endurance','ВЫН'],['charisma','ХАР'],['health','ЗД'],['energy','ЭН']];
const STATES = [['friction','Трение'],['focus','Фокус'],['attention','Внимание'],['thinkingSpeed','Скорость'],['energyState','Энергия'],['mood','Настроение']];
const MEALS = [['breakfast','З'],['lunch','О'],['dinner','У'],['snack','П']];
const zeroStats = () => Object.fromEntries(STATS.map(([k]) => [k, 0]));
const fmtStats = e => STATS.filter(([k]) => (e || {})[k]).map(([k, l]) => `${l}${e[k] > 0 ? '+' : ''}${e[k]}`).join(' ') || '—';
const fmtH = h => (Math.round(h * 100) / 100) + ' ч';

/* ---------- уровни навыков (0 → 10000 ч) ---------- */
function skillLevel(h) {
if (h < 10)    return { name: 'Новичок',      from: 0,     to: 10 };
if (h < 100)   return { name: 'Начинающий',   from: 10,    to: 100 };
if (h < 500)   return { name: 'Практик',      from: 100,   to: 500 };
if (h < 1000)  return { name: 'Опытный',      from: 500,   to: 1000 };
if (h < 2500)  return { name: 'Профессионал', from: 1000,  to: 2500 };
if (h < 5000)  return { name: 'Эксперт',      from: 2500,  to: 5000 };
if (h < 10000) return { name: 'Мастер',       from: 5000,  to: 10000 };
return                 { name: 'Легенда',      from: 10000, to: 10000 };
}
function skillProgress(h) {
const lv = skillLevel(h);
if (lv.to === lv.from) return 100;
return Math.min(100, Math.round(((h - lv.from) / (lv.to - lv.from)) * 100));
}

/* ---------- Уровни игрока (50 уровней) ---------- */
const PLAYER_LEVELS = [
{ level: 0,  name: 'Неофит' },
{ level: 1,  name: 'Искатель' },
{ level: 2,  name: 'Ученик' },
{ level: 3,  name: 'Подмастерье' },
{ level: 4,  name: 'Кэнси' },
{ level: 5,  name: 'Адепт' },
{ level: 6,  name: 'Сталкер' },
{ level: 7,  name: 'Следопыт' },
{ level: 8,  name: 'Охотник' },
{ level: 9,  name: 'Мечник' },
{ level: 10, name: 'Воин' },
{ level: 11, name: 'Боец' },
{ level: 12, name: 'Самурай' },
{ level: 13, name: 'Специалист' },
{ level: 14, name: 'Эксперт' },
{ level: 15, name: 'Профи' },
{ level: 16, name: 'Мастер' },
{ level: 17, name: 'Виртуоз' },
{ level: 18, name: 'Ветеран' },
{ level: 19, name: 'Страж' },
{ level: 20, name: 'Защитник' },
{ level: 21, name: 'Герой' },
{ level: 22, name: 'Чемпион' },
{ level: 23, name: 'Витязь' },
{ level: 24, name: 'Паладин' },
{ level: 25, name: 'Рыцарь' },
{ level: 26, name: 'Командор' },
{ level: 27, name: 'Генерал' },
{ level: 28, name: 'Тактик' },
{ level: 29, name: 'Стратег' },
{ level: 30, name: 'Лидер' },
{ level: 31, name: 'Наставник' },
{ level: 32, name: 'Учитель' },
{ level: 33, name: 'Гуру' },
{ level: 34, name: 'Легенда' },
{ level: 35, name: 'Архитектор' },
{ level: 36, name: 'Творец' },
{ level: 37, name: 'Зодчий' },
{ level: 38, name: 'Мудрец' },
{ level: 39, name: 'Философ' },
{ level: 40, name: 'Дзен-мастер' },
{ level: 41, name: 'Оракул' },
{ level: 42, name: 'Провидец' },
{ level: 43, name: 'Ясновидец' },
{ level: 44, name: 'Маг' },
{ level: 45, name: 'Чародей' },
{ level: 46, name: 'Волшебник' },
{ level: 47, name: 'Вершитель' },
{ level: 48, name: 'Повелитель' },
{ level: 49, name: 'Суверен' },
{ level: 50, name: 'Император' }
];

/* ---------- Титулы характеристик ---------- */
const INT_TITLES = [
'Наблюдатель', 'Любопытный', 'Читающий', 'Изучающий', 'Познающий',
'Мыслитель', 'Аналитик', 'Исследователь', 'Учёный', 'Философ',
'Логик', 'Стратег', 'Тактик', 'Расчётливый', 'Мудрый',
'Проницательный', 'Глубокий', 'Озарённый', 'Вдохновлённый', 'Гениальный',
'Визионер', 'Провидец', 'Мудрец', 'Наставник', 'Учитель',
'Гуру', 'Архитектор знаний', 'Хранитель мудрости', 'Вершитель идей', 'Творец концепций',
'Демиург мысли', 'Оракул', 'Ясновидец разума', 'Маг интеллекта', 'Чародей логики',
'Волшебник познания', 'Повелитель истин', 'Суверен мысли', 'Монарх разума', 'Владыка мудрости',
'Император интеллекта', 'Абсолют понимания', 'Божество знания', 'Первоисточник', 'Альфа разум',
'Омега мысль', 'Сингулярность', 'Вселенский ум', 'Космическое сознание', 'Бесконечный разум', 'Абсолютная мудрость'
];
const STR_TITLES = [
'Слабый', 'Хрупкий', 'Тонкий', 'Неокрепший', 'Начинающий',
'Крепнущий', 'Сильный', 'Мощный', 'Крепкий', 'Железный',
'Стальной', 'Титановый', 'Алмазный', 'Несокрушимый', 'Громоподобный',
'Сокрушитель', 'Разрушитель', 'Сокрушающий', 'Дробящий', 'Молот',
'Таран', 'Бастион', 'Цитадель', 'Крепость', 'Гора',
'Вулкан', 'Землетрясение', 'Ураган', 'Шторм', 'Буря',
'Левиафан', 'Кракен', 'Голиаф', 'Атлант', 'Геркулес',
'Самсон', 'Богатырь', 'Витязь', 'Паладин', 'Рыцарь силы',
'Генерал битвы', 'Владыка мощи', 'Суверен силы', 'Монарх мышц', 'Император мощи',
'Абсолют силы', 'Божество войны', 'Первоисточник ярости', 'Альфа хищник', 'Омега разрушения',
'Сингулярность мощи', 'Вселенская сила', 'Космическая энергия', 'Бесконечная мощь', 'Абсолютное превосходство'
];
const END_TITLES = [
'Истощённый', 'Утомлённый', 'Слабый', 'Неустойчивый', 'Начинающий',
'Терпящий', 'Выдерживающий', 'Стоический', 'Упорный', 'Настойчивый',
'Твёрдый', 'Крепкий', 'Жилы стальные', 'Непробиваемый', 'Бессмертный',
'Феникс', 'Возрождающийся', 'Неутомимый', 'Неостановимый', 'Вечный двигатель',
'Марафонец', 'Ультрамарафонец', 'Железный человек', 'Титан выносливости', 'Атлант持久',
'Spartan', 'Легионер', 'Centurion', 'Gladiator', 'Champion',
'Legend', 'Myth', 'Eternal', 'Immortal', 'Divine',
'Celestial', 'Cosmic', 'Infinite', 'Absolute', 'Supreme',
'Transcendent', 'Omnipotent', 'Omnipresent', 'Omniscient', 'Alpha Endurance',
'Omega Persistence', 'Singularity Stamina', 'Universal Vigor', 'Quantum Resilience', 'Absolute Immortality'
];
const CHA_TITLES = [
'Незаметный', 'Тихий', 'Скромный', 'Застенчивый', 'Нерешительный',
'Общительный', 'Дружелюбный', 'Привлекательный', 'Очаровательный', 'Харизматичный',
'Влиятельный', 'Авторитетный', 'Убеждающий', 'Вдохновляющий', 'Лидер',
'Оратор', 'Дипломат', 'Переговорщик', 'Посол', 'Представитель',
'Магнетический', 'Гипнотический', 'Неотразимый', 'Блистательный', 'Сияющий',
'Звезда', 'Икона', 'Символ', 'Легенда', 'Идол',
'Кумир', 'Божество', 'Пророк', 'Мессия', 'Спаситель',
'Владыка сердец', 'Суверен душ', 'Монарх влияния', 'Император харизмы', 'Абсолют обаяния',
'Божество красоты', 'Первоисточник вдохновения', 'Альфа лидер', 'Омега влияние', 'Сингулярность притяжения',
'Вселенская любовь', 'Космическая гармония', 'Бесконечное очарование', 'Абсолютная харизма', 'Всемогущество влияния'
];
const HLT_TITLES = [
'Болезненный', 'Слабый', 'Хрупкий', 'Уязвимый', 'Нежный',
'Выздоравливающий', 'Крепнущий', 'Здоровый', 'Крепкий', 'Сильный',
'Бодрый', 'Энергичный', 'Жизнестойкий', 'Иммунный', 'Невосприимчивый',
'Целитель', 'Врачеватель', 'Лекарь', 'Доктор', 'Медик',
'Санитар', 'Фельдшер', 'Хирург', 'Терапевт', 'Диагност',
'Биохакер', 'Нутрициолог', 'Диетолог', 'Фитнес-гуру', 'Йог',
'Дзен-мастер тела', 'Целитель души', 'Хранитель здоровья', 'Вершитель жизни', 'Творец долголетия',
'Архитектор бессмертия', 'Оракул здоровья', 'Провидец жизни', 'Маг исцеления', 'Чародей восстановления',
'Волшебник регенерации', 'Повелитель жизненной силы', 'Суверен здоровья', 'Монарх долголетия', 'Император бессмертия',
'Абсолют жизнестойкости', 'Божество исцеления', 'Первоисточник жизни', 'Альфа здоровье', 'Омега восстановление',
'Сингулярность регенерации', 'Вселенская жизненная сила', 'Космическая энергия здоровья', 'Бесконечное долголетие', 'Абсолютное бессмертие'
];
const ENR_TITLES = [
'Истощённый', 'Пустой', 'Слабый', 'Вялый', 'Апатичный',
'Пробуждающийся', 'Бодрящийся', 'Энергичный', 'Активный', 'Динамичный',
'Мотивированный', 'Вдохновлённый', 'Страстный', 'Огненный', 'Пламенный',
'Искрящийся', 'Светящийся', 'Сияющий', 'Блестящий', 'Ослепительный',
'Молниеносный', 'Стремительный', 'Быстрый', 'Скоростной', 'Реактивный',
'Турбо', 'Гипер', 'Ультра', 'Мега', 'Макси',
'Экстремальный', 'Феноменальный', 'Невероятный', 'Фантастический', 'Космический',
'Квантовый', 'Ядерный', 'Термоядерный', 'Звёздный', 'Галактический',
'Вселенский', 'Бесконечный', 'Абсолютный', 'Божественный', 'Священный',
'Первоисточник энергии', 'Альфа импульс', 'Омега мощность', 'Сингулярность силы', 'Квантовый скачок',
'Вселенский взрыв', 'Космический поток', 'Бесконечный потенциал', 'Абсолютная энергия', 'Всемогущество мотивации'
];
const STAT_TITLES = {
intelligence: INT_TITLES,
strength: STR_TITLES,
endurance: END_TITLES,
charisma: CHA_TITLES,
health: HLT_TITLES,
energy: ENR_TITLES
};

/* ---------- КРИВАЯ ТИТУЛОВ (усложнена) ----------
   Уровень титула растёт от НАКОПЛЕННОЙ суммы характеристики за все дни.
   Нужно очков = 10 · уровень^1.8:
   ур.3 ≈ 1.5–2 недели дисциплины, ур.10 ≈ 2 месяца,
   ур.~20 ≈ 5–6 месяцев устойчивой работы.            */
function statRequired(lvl, config = {}) {
const cfg = { ...DEFAULT_LEVELING_CONFIG, ...config };
if (lvl <= 0) return 0;
const base = Math.max(1, cfg.statBase ?? 10);
const power = Math.max(0.5, cfg.statPower ?? 1.8);
return Math.round(base * Math.pow(lvl, power));
}
function statLevel(total, config = {}) {
let lvl = 0;
while (lvl < 999 && statRequired(lvl + 1, config) <= total) lvl++;
return lvl;
}
async function computeTotalStats(store) {
const total = zeroStats();

for (const d of await store.listDays()) {
const day = await store.loadDay(d);
const s = computeDayStats(store.ref, day).stats;
for (const [k] of STATS) total[k] += s[k];
}

const courseStats = computeCourseStats(store.coursesData?.courses || []);
for (const [k] of STATS) total[k] += courseStats[k];

return total;
}
function getStatTitle(statKey, statValue, config = {}) {
const titles = STAT_TITLES[statKey];
if (!titles || titles.length === 0) return '';
const index = Math.min(statLevel(statValue, config), titles.length - 1);
return titles[Math.max(0, index)];
}

/* ---------- Награды и типы ---------- */
const REWARD_TYPES = {
ACCESSORY: 'accessory',
DECOR: 'decor',
TITLE: 'title',
ACCESS: 'access'
};

/* ---------- Конфигурация прогрессии по умолчанию ---------- */
const DEFAULT_LEVELING_CONFIG = {
baseXP: 100,
growthFactor: 1.5,
formula: 'quadratic',
gloryPerLevel: 1,
statBase: 10,   // кривая титулов: множитель (больше = медленнее рост)
statPower: 1.8  // кривая титулов: степень (больше = круче рост требований)
};

/* ---------- Структура наград по умолчанию ---------- */
const DEFAULT_REWARDS_DATA = {
currency: 0,
inventory: [],
slots: [],
titles: [],
accesses: [],
lastProcessedLevel: 0,
unlockedSlots: 0,
levelingConfig: { ...DEFAULT_LEVELING_CONFIG }
};

/* ---------- XP за действия ---------- */
const XP_REWARDS = {
habit: 10,
task: 20,
idea: 20,
goalBase: 40
};

/* ---------- Расчет требуемого опыта для уровня ---------- */
function xpRequiredForLevel(level, config = {}) {
const cfg = { ...DEFAULT_LEVELING_CONFIG, ...config };
const baseXP = cfg.baseXP;
const growthFactor = cfg.growthFactor;
const formula = cfg.formula;
if (level <= 0) return 0;
switch (formula) {
case 'linear':
return Math.floor(baseXP * level);
case 'exponential':
return Math.floor(baseXP * Math.pow(growthFactor, level - 1));
case 'quadratic':
default:
return Math.floor(baseXP * Math.pow(level, growthFactor));
}
}

/* ---------- Получить текущий уровень по опыту ---------- */
function getPlayerLevel(totalXP, config = {}) {
const cfg = { ...DEFAULT_LEVELING_CONFIG, ...config };
for (let i = PLAYER_LEVELS.length - 1; i >= 0; i--) {
const required = xpRequiredForLevel(i, cfg);
if (totalXP >= required) {
const nextRequired = xpRequiredForLevel(i + 1, cfg);
return {
level: i,
name: PLAYER_LEVELS[i].name,
required: required,
next: nextRequired || totalXP,
progress: totalXP - required,
remaining: nextRequired - totalXP
};
}
}
return {
level: 0,
name: PLAYER_LEVELS[0].name,
required: 0,
next: xpRequiredForLevel(1, cfg),
progress: totalXP,
remaining: xpRequiredForLevel(1, cfg) - totalXP
};
}

/* ---------- Расчет общего XP игрока ---------- */
function calculateTotalXP(store, journalData) {
let totalXP = 0;
Object.values(journalData).forEach(day => {
if (day.habitLogs) {
day.habitLogs.forEach(log => {
if (log.done) totalXP += XP_REWARDS.habit;
});
}
if (day.completedWorkItems) {
  day.completedWorkItems.forEach(item => {
    if (item.kind === 'task') {
      totalXP += XP_REWARDS.task;
    } else if (item.kind === 'idea') {
      totalXP += XP_REWARDS.idea;
    }
  });
}
});
if (store.ref && store.ref.goals) {
store.ref.goals.forEach(goal => {
if ((goal.status === 'completed' || goal.status === 'achieved') && goal.completedAt) {
const startDate = parseISO(goal.start);
const endDate = parseISO(goal.completedAt);
const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
totalXP += XP_REWARDS.goalBase * Math.max(1, days);
}
});
}
return totalXP;
}

/* ---------- стартовые данные ---------- */
function seedReference() {
return {
schemaVersion: 2,
habits: [
{ id: 'h1', name: 'Бег утром', baseEffects: { endurance: 2, health: 1, energy: -1 } },
{ id: 'h2', name: 'Чтение',    baseEffects: { intelligence: 2 } }
],
activities: [{ id: 'a1', name: 'Пробежка', kcalPerUnit: 60 }],
substances: [{ id: 's1', name: 'Омега-3' }],
skills: [{ id: 'sk1', name: 'Бег', habitRefs: [{ habitId: 'h1', weight: 1 }] }],
synergyRules: [{ id: 'r1', source: { type: 'habit', id: 'h1' }, target: { type: 'substance', id: 's1' }, bonus: { health: 1, endurance: 1 } }],
goals: [{ id: 'g1', name: '100 км за июнь', targetType: 'activity', targetId: 'a1', metric: 'km', targetValue: 100, start: iso(new Date()), status: 'active' }],
finCategories: [
{ id: 'fc1', name: 'Зарплата',  type: 'income' },
{ id: 'fc2', name: 'Продукты',  type: 'expense' },
{ id: 'fc3', name: 'Транспорт', type: 'expense' }
],
achievements: []
};
}
function seedWorkItems() {
return {
schemaVersion: 1,
items: [
{ id: 'wi1', kind: 'task', name: 'Сделать отчёт', description: '', effects: zeroStats(), status: 'backlog', createdAt: iso(new Date()) },
{ id: 'wi2', kind: 'idea', name: 'Приложение для трекинга сна', description: '', effects: zeroStats(), status: 'backlog', createdAt: iso(new Date()) }
]
};
}

/* ---------- Store ---------- */
class Store {
constructor(app) {
this.app = app;
this.a = app.vault.adapter;
this.base = 'LifeTracker';
this.ref = null;
this.work = null;
this.cache = {};
this.rewardsData = null;
this.coursesData = null;
}
async init() {
await this.a.mkdir(this.base).catch(() => {});
await this.a.mkdir(this.base + '/journal').catch(() => {});
const p = this.base + '/reference.json';
this.ref = await this.a.exists(p) ? JSON.parse(await this.a.read(p)) : seedReference();
if (!this.ref.finCategories) this.ref.finCategories = seedReference().finCategories;
if (!this.ref.achievements) this.ref.achievements = [];
if (!this.ref.schemaVersion || this.ref.schemaVersion < 2) { this.ref.schemaVersion = 2; await this.saveRef(); }
else if (!await this.a.exists(p)) await this.saveRef();
const wp = this.base + '/workItems.json';
this.work = await this.a.exists(wp) ? JSON.parse(await this.a.read(wp)) : seedWorkItems();
if (!await this.a.exists(wp)) await this.saveWorkItems();
const rp = this.base + '/rewards.json';
let rawData = await this.a.exists(rp) ? JSON.parse(await this.a.read(rp)) : { ...DEFAULT_REWARDS_DATA };
if (rawData.lastProcessedLevel === undefined) rawData.lastProcessedLevel = 0;
if (!rawData.levelingConfig) rawData.levelingConfig = { ...DEFAULT_LEVELING_CONFIG };
if (rawData.slots && !Array.isArray(rawData.slots)) rawData.slots = [];
if (!rawData.inventory || !Array.isArray(rawData.inventory)) rawData.inventory = [];
if (rawData.currency === undefined || typeof rawData.currency !== 'number') rawData.currency = 0;
if (rawData.unlockedSlots === undefined || typeof rawData.unlockedSlots !== 'number') rawData.unlockedSlots = 0;
this.rewardsData = rawData;
if (!await this.a.exists(rp)) await this.saveRewards();

const cp = this.base + '/courses.json';
this.coursesData = await this.a.exists(cp)
  ? JSON.parse(await this.a.read(cp))
  : { schemaVersion: 1, courses: [] };

if (!Array.isArray(this.coursesData.courses)) {
  this.coursesData.courses = [];
}

if (!await this.a.exists(cp)) {
  await this.saveCourses();
}
const { RoadmapService } = LifeTrackerRoadmaps;
this.roadmaps = new RoadmapService(this, { computeDayXP, getPlayerLevel, computeDayStats, computeCourseStats, courseXPTotal, courseProgress, dayCompletion, rewardTotals, STATS, STATES });
await this.roadmaps.init();
}
dayPath(d) { return this.base + '/journal/' + d + '.json'; }
workPath() { return this.base + '/workItems.json'; }
rewardsPath() { return this.base + '/rewards.json'; }
coursesPath() { return this.base + '/courses.json'; }
async saveCourses() {
  await this.a.write(this.coursesPath(), JSON.stringify(this.coursesData, null, 2));
  this.roadmaps?.invalidate();
}
emptyDay(date) {
return {
schemaVersion: 1,
date,
state: Object.fromEntries(STATES.map(([k]) => [k, 5])),
comment: '',
habitLogs: this.ref.habits.map(h => ({ habitId: h.id, done: false, hours: 0 })),
activityLogs: this.ref.activities.map(a => ({ activityId: a.id, amount: 0 })),
substanceLogs: this.ref.substances.map(s => ({ substanceId: s.id, taken: false })),
meals: MEALS.map(([slot]) => ({ slot, kcal: 0 })),
financeLogs: []
};
}
async loadDay(date) {
if (this.cache[date]) return this.cache[date];
const day = await this.a.exists(this.dayPath(date)) ? JSON.parse(await this.a.read(this.dayPath(date))) : this.emptyDay(date);
for (const h of this.ref.habits) if (!day.habitLogs.find(l => l.habitId === h.id)) day.habitLogs.push({ habitId: h.id, done: false, hours: 0 });
for (const a of this.ref.activities) if (!day.activityLogs.find(l => l.activityId === a.id)) day.activityLogs.push({ activityId: a.id, amount: 0 });
for (const s of this.ref.substances) if (!day.substanceLogs.find(l => l.substanceId === s.id)) day.substanceLogs.push({ substanceId: s.id, taken: false });
for (const [slot] of MEALS) if (!day.meals.find(m => m.slot === slot)) day.meals.push({ slot, kcal: 0 });
if (!day.financeLogs) day.financeLogs = [];
this.cache[date] = day; return day;
}
async saveDay(date) { if (this.cache[date]) { await this.a.write(this.dayPath(date), JSON.stringify(this.cache[date], null, 2)); this.roadmaps?.invalidate(); } }
async saveRef() { await this.a.write(this.base + '/reference.json', JSON.stringify(this.ref, null, 2)); this.cache = {}; this.roadmaps?.invalidate(); }
async saveWorkItems() { await this.a.write(this.workPath(), JSON.stringify(this.work, null, 2)); this.roadmaps?.invalidate(); }
async saveRewards() { await this.a.write(this.rewardsPath(), JSON.stringify(this.rewardsData, null, 2)); this.roadmaps?.invalidate(); }
async loadRewards() {
const rp = this.rewardsPath();
if (await this.a.exists(rp)) {
const rawData = JSON.parse(await this.a.read(rp));
if (rawData.lastProcessedLevel === undefined) rawData.lastProcessedLevel = 0;
if (!rawData.levelingConfig) rawData.levelingConfig = { ...DEFAULT_LEVELING_CONFIG };
if (rawData.slots && !Array.isArray(rawData.slots)) rawData.slots = [];
if (!rawData.inventory || !Array.isArray(rawData.inventory)) rawData.inventory = [];
if (rawData.currency === undefined || typeof rawData.currency !== 'number') rawData.currency = 0;
if (rawData.unlockedSlots === undefined || typeof rawData.unlockedSlots !== 'number') rawData.unlockedSlots = 0;
this.rewardsData = rawData;
} else {
this.rewardsData = { ...DEFAULT_REWARDS_DATA };
}
}
async listDays() { try { const { files } = await this.a.list(this.base + '/journal'); return files.map(f => f.split('/').pop().replace('.json', '')).sort(); } catch (e) { return []; } }
}

/* ---------- Экспорт всей сохранённой истории ---------- */
async function exportAllTime(store) {
if (store.roadmaps) await store.roadmaps.reload();
if (store.roadmaps?.loadError) throw store.roadmaps.loadError;
// Читаем журнал напрямую: loadDay добавляет современные справочники к старым дням.
// Ошибки чтения не скрываем, чтобы неполная выгрузка не выглядела успешной.
const { files } = await store.a.list(store.base + '/journal');
const paths = files.filter(p => /\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).sort();
const days = [];
for (const path of paths) {
  const date = path.split('/').pop().slice(0, -5);
  const day = JSON.parse(await store.a.read(path));
  days.push({ ...day, date });
}
const ref = store.ref;
const meta = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  period: { from: days[0]?.date || null, to: days[days.length - 1]?.date || null },
  dayCount: days.length,
  historyNote: 'Дневные записи содержат сохранённую историю. Справочники, цели, дела, навыки и награды — текущее состояние с имеющимися датами; история их изменений не велась.'
};
const named = (logs, collection, key) => (logs || []).map(log => {
  const definition = (collection || []).find(item => item.id === log[key]);
  return { ...log, name: definition?.name ?? null };
});
// Процент считаем по записям каждого дня, включая удалённые привычки.
// Пропущенный календарный день прерывает серию; ограничения в 365 дней нет.
const streaks = new Map();
const summaries = new Map();
let previousDate = null;
const habitDays = days.map(day => {
  if (previousDate && iso(addDays(parseISO(previousDate), 1)) !== day.date) streaks.clear();
  const logs = named(day.habitLogs, ref.habits, 'habitId');
  const present = new Set(logs.map(log => log.habitId));
  for (const id of streaks.keys()) if (!present.has(id)) streaks.delete(id);
  const habits = logs.map(log => {
    const streak = log.done ? (streaks.get(log.habitId) || 0) + 1 : 0;
    streaks.set(log.habitId, streak);
    const summary = summaries.get(log.habitId) || { habitId: log.habitId, name: log.name, recordedDays: 0, completedDays: 0, longestStreak: 0 };
    summary.recordedDays++;
    if (log.done) summary.completedDays++;
    summary.longestStreak = Math.max(summary.longestStreak, streak);
    summaries.set(log.habitId, summary);
    return { ...log, streak };
  });
  previousDate = day.date;
  const done = logs.filter(log => log.done).length;
  return { date: day.date, habits, completion: { done, total: logs.length, pct: logs.length ? Math.round(done / logs.length * 10000) / 100 : 0 } };
});
const habitSummary = [...summaries.values()].map(summary => ({
  ...summary, completionPercent: Math.round(summary.completedDays / summary.recordedDays * 10000) / 100,
  streakAtLastRecordedDate: streaks.get(summary.habitId) || 0
}));
const exports = {
  'finances.json': {
    ...meta, categories: ref.finCategories || [],
    days: days.map(day => ({ date: day.date, entries: (day.financeLogs || []).map(log => {
      const category = (ref.finCategories || []).find(c => c.id === log.categoryId);
      return { ...log, categoryName: category?.name ?? null, type: category?.type ?? null };
    }) }))
  },
  'activities-food-substances.json': {
    ...meta, activities: ref.activities || [], substances: ref.substances || [],
    days: days.map(day => ({ date: day.date,
      activities: named(day.activityLogs, ref.activities, 'activityId'),
      meals: day.meals || [], substances: named(day.substanceLogs, ref.substances, 'substanceId'),
      calories: dayKcal(ref, { meals: day.meals || [], activityLogs: day.activityLogs || [] })
    }))
  },
  'goals-ideas-tasks-skills-rewards.json': {
    ...meta, goals: ref.goals || [],
    ideas: (store.work?.items || []).filter(item => item.kind === 'idea'),
    tasks: (store.work?.items || []).filter(item => item.kind === 'task'),
    skills: ref.skills || [], achievements: ref.achievements || [], rewards: store.rewardsData,
    days: days.map(day => ({ date: day.date, completedWorkItems: day.completedWorkItems || [],
      skillHours: skillHoursFor(ref, [{ ...day, habitLogs: day.habitLogs || [] }])
    })),
    skillHoursTotal: skillHoursFor(ref, days.map(day => ({ ...day, habitLogs: day.habitLogs || [] })))
  },
  'roadmaps.json': { ...meta, ...(store.roadmapsData || { schemaVersion: 1, maps: [] }) },
  'habits.json': {
    ...meta, habits: ref.habits || [], synergyRules: ref.synergyRules || [],
    calculationNote: 'Проценты рассчитаны по сохранённым записям привычек. Пропущенный день или отсутствие привычки прерывает стрик. Калории и часы навыков рассчитаны по текущим справочникам.',
    summary: habitSummary, days: habitDays
  }
};
// Сериализуем всё до записи; каждый экспорт получает отдельную папку.
const contents = Object.entries(exports).map(([name, data]) => [name, JSON.stringify(data, null, 2)]);
const root = store.base + '/exports';
if (!await store.a.exists(root)) await store.a.mkdir(root);
const base = root + '/' + meta.exportedAt.replace(/[:.]/g, '-');
let folder = base, suffix = 1;
while (await store.a.exists(folder)) folder = base + '-' + suffix++;
await store.a.mkdir(folder);
for (const [name, content] of contents) await store.a.write(folder + '/' + name, content);
return folder;
}

async function notifyExport(store) {
try {
  const folder = await exportAllTime(store);
  new Notice('Экспорт готов: 5 JSON в папке хранилища ' + folder, 15000);
} catch (error) {
  console.error('LifeTracker: ошибка экспорта', error);
  new Notice('Не удалось завершить экспорт: ' + error.message, 15000);
}
}

/* ---------- Compute ---------- */
function epDone(day, ep) {
if (ep.type === 'habit')     { const l = day.habitLogs.find(x => x.habitId === ep.id); return !!(l && l.done); }
if (ep.type === 'substance') { const l = day.substanceLogs.find(x => x.substanceId === ep.id); return !!(l && l.taken); }
if (ep.type === 'activity')  { const l = day.activityLogs.find(x => x.activityId === ep.id); return !!(l && l.amount > 0); }
return false;
}
function computeDayStats(ref, day) {
const stats = zeroStats(), syn = [];
for (const h of ref.habits) { const l = day.habitLogs.find(x => x.habitId === h.id); if (l && l.done) for (const [k] of STATS) stats[k] += (h.baseEffects || {})[k] || 0; }
for (const r of ref.synergyRules) if (epDone(day, r.source) && epDone(day, r.target)) { syn.push(r); for (const [k] of STATS) stats[k] += (r.bonus || {})[k] || 0; }
return { stats, syn };
}
function dayKcal(ref, day) {
const eaten = day.meals.reduce((a, m) => a + (+m.kcal || 0), 0);
const burned = day.activityLogs.reduce((a, l) => { const act = ref.activities.find(x => x.id === l.activityId); return a + (act ? act.kcalPerUnit * (+l.amount || 0) : 0); }, 0);
return { eaten, burned, balance: eaten - burned };
}
function dayFinance(ref, day) {
const inc = day.financeLogs.filter(f => { const c = ref.finCategories.find(x => x.id === f.categoryId); return c && c.type === 'income'; }).reduce((a, f) => a + (+f.amount || 0), 0);
const exp = day.financeLogs.filter(f => { const c = ref.finCategories.find(x => x.id === f.categoryId); return c && c.type === 'expense'; }).reduce((a, f) => a + (+f.amount || 0), 0);
return { income: inc, expense: exp, balance: inc - exp };
}
function dayCompletion(ref, day) {
const total = ref.habits.length;
if (total === 0) return { done: 0, total: 0, pct: 0 };
const done = day.habitLogs.filter(l => { const h = ref.habits.find(x => x.id === l.habitId); return h && l.done; }).length;
return { done, total, pct: Math.round((done / total) * 100) };
}
function skillHoursFor(ref, days) {
const out = {};
for (const sk of ref.skills || []) out[sk.id] = days.reduce((sum, day) => sum + LifeTrackerRoadmaps.skillHoursForDay(sk, day), 0);
return out;
}
async function habitStreak(store, habitId, date) {
let d = parseISO(date);
const t = (await store.loadDay(iso(d))).habitLogs.find(x => x.habitId === habitId);
if (!(t && t.done)) d = addDays(d, -1);
let n = 0;
for (let i = 0; i < 365; i++) {
const key = iso(d);
if (!await store.a.exists(store.dayPath(key))) break;
const l = (await store.loadDay(key)).habitLogs.find(x => x.habitId === habitId);
if (l && l.done) { n++; d = addDays(d, -1); } else break;
}
return n;
}
async function goalProgress(store, g, today) {
const ref = store.ref;
/* Серия привычки: текущая длина стрика (не сумма по дням) */
if (g.targetType === 'streak') {
  if (g.targetId) return await habitStreak(store, g.targetId, today);
  let mx = 0;
  for (const h of ref.habits) mx = Math.max(mx, await habitStreak(store, h.id, today));
  return mx;
}
const from = g.start || '0000-01-01', to = (g.end && g.end < today) ? g.end : today;
const days = (await store.listDays()).filter(x => x >= from && x <= to);
let sum = 0;
/* Количество выполнений привычек (пустой объект = все привычки) */
if (g.targetType === 'habit') {
  for (const d of days) {
    const day = await store.loadDay(d);
    for (const l of day.habitLogs) {
      if (l.done && (!g.targetId || l.habitId === g.targetId)) sum += 1;
    }
  }
  return sum;
}
/* Калории: сожжено / съедено / баланс за период */
if (g.targetType === 'kcal') {
  const m = g.metric || 'burned';
  for (const d of days) sum += dayKcal(ref, await store.loadDay(d))[m] || 0;
  return sum;
}
/* Финансы: сумма по выбранной категории либо итог по типам потоков */
if (g.targetType === 'finance') {
  const m = g.metric || 'income';
  for (const d of days) {
    const day = await store.loadDay(d);
    for (const l of day.financeLogs) {
      const c = ref.finCategories.find(x => x.id === l.categoryId);
      if (!c) continue;
      const amt = +l.amount || 0;
      if (g.targetId) { if (c.id === g.targetId) sum += amt; }
      else if (m === 'income' && c.type === 'income') sum += amt;
      else if (m === 'expense' && c.type === 'expense') sum += amt;
      else if (m === 'balance') sum += (c.type === 'income' ? amt : -amt);
    }
  }
  return sum;
}
/* Прежние типы: навык (часы) и активность (кол-во; пустой объект = все активности) */
for (const d of days) {
  const day = await store.loadDay(d);
  if (g.targetType === 'skill') {
    const sk = ref.skills.find(s => s.id === g.targetId);
    if (sk) sum += LifeTrackerRoadmaps.skillHoursForDay(sk, day);
  } else {
    for (const l of day.activityLogs) if (!g.targetId || l.activityId === g.targetId) sum += +l.amount || 0;
  }
}
return sum;
}
async function weekCompletion(store, ref, today) {
const mon = mondayOf(parseISO(today));
let done = 0, total = 0;
for (let i = 0; i < 7; i++) {
const d = iso(addDays(mon, i));
if (d > today) break;
const day = await store.loadDay(d);
const r = dayCompletion(ref, day);
done += r.done; total += r.total;
}
return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/* ---------- Compute: Опыт игрока ---------- */
const XP_HABIT = XP_REWARDS.habit;
const XP_TASK_IDEA = XP_REWARDS.task;
const XP_GOAL_BASE = XP_REWARDS.goalBase;

function computeDayXP(ref, day, workItems = []) {
let xp = 0;
for (const h of ref.habits) {
const l = day.habitLogs.find(x => x.habitId === h.id);
if (l && l.done) xp += XP_HABIT;
}
for (const s of ref.substances) {
const l = day.substanceLogs.find(x => x.substanceId === s.id);
if (l && l.taken) xp += XP_HABIT;
}
for (const a of ref.activities) {
const l = day.activityLogs.find(x => x.activityId === a.id);
if (l && l.amount > 0) xp += XP_HABIT;
}
for (const item of workItems) {
if (item.status === 'done' && item.completedDate === day.date) {
if (item.kind === 'task' || item.kind === 'idea') xp += XP_TASK_IDEA;
}
}
for (const g of ref.goals || []) {
if ((g.status === 'completed' || g.status === 'achieved') && g.completedDate === day.date) {
const daysCount = g.start && g.end
? Math.max(1, Math.ceil((parseISO(g.end) - parseISO(g.start)) / (1000 * 60 * 60 * 24)))
: 1;
xp += XP_GOAL_BASE * daysCount;
}
}
return xp;
}
async function computeTotalXP(store) {
let totalXP = 0;

const days = await store.listDays();
const workItems = store.work?.items || [];

for (const date of days) {
const day = await store.loadDay(date);
totalXP += computeDayXP(store.ref, day, workItems);
}

totalXP += courseXPTotal(store.coursesData?.courses || []);

return totalXP;
}
async function getPlayerProgress(store) {
const totalXP = await computeTotalXP(store);
const cfg = store.rewardsData?.levelingConfig || DEFAULT_LEVELING_CONFIG;
return { ...getPlayerLevel(totalXP, cfg), totalXP };
}

/* ---------- ПЕРЕСЧЁТ НАГРАД (валюта и слоты всегда непротиворечивы) ----------
   🪙 очки славы = уровни × gloryPerLevel + выполненные цели − созданные трофеи
   🎯 слоты      = уровни + выполненные цели (трофеи их занимают)               */
function rewardTotals(level, ref, rewards) {
const doneGoals = (ref.goals || []).filter(g => g.status === 'achieved' || g.status === 'completed').length;
const earned = level * (rewards.levelingConfig?.gloryPerLevel ?? 1) + doneGoals;
return { currency: Math.max(0, earned - (rewards.inventory || []).length), unlockedSlots: level + doneGoals };
}
async function syncRewards(store) {
await store.loadRewards();
const rd = store.rewardsData;
const progress = await getPlayerProgress(store);
const totals = rewardTotals(progress.level, store.ref, rd);
rd.currency = totals.currency;
rd.unlockedSlots = totals.unlockedSlots;
rd.lastProcessedLevel = progress.level;
store.rewardsData = rd;
await store.saveRewards();
return progress;
}

/* ---------- АВТОПЕРЕНОС целей, выполненных на 100%, в Достижения ---------- */
async function checkCompletedGoals(store) {
try {
const ref = store.ref;
const goals = ref.goals || [];
const today = iso(new Date());
const moved = [];
for (const g of goals) {
if (g.status !== 'active') continue;
if (!g.targetValue || g.targetValue <= 0) continue;
const p = await goalProgress(store, g, today);
if (p >= g.targetValue) {
g.status = 'achieved';
g.completedAt = today;
g.completedDate = today;
if (!(ref.achievements || []).find(a => a.fromGoalId === g.id)) {
ref.achievements.push({
id: uid('ach'),
title: '🎯 ' + g.name,
description: `${g.targetValue} ${g.metric || ''} · выполнено ${today}`,
date: today,
fromGoalId: g.id
});
}
moved.push(g);
}
}
if (moved.length) {
// пишем reference.json напрямую, чтобы не сбрасывать кэш дней
await store.a.write(store.base + '/reference.json', JSON.stringify(ref, null, 2));
store.roadmaps?.invalidate();
await syncRewards(store); // выполненная цель = +1 🪙 и +1 слот
new Notice(`🏆 Цель выполнена: ${moved.map(m => m.name).join(', ')} → Достижения`);
}
return moved;
} catch (e) { return []; }
}

/* ---------- Проверка порога характеристики для задачи/идеи ---------- */
function checkStatRequirement(item, currentStats) {
if (!item || !item.minStatRequirement) return true;
const req = item.minStatRequirement;
const statValue = currentStats[req.stat] || 0;
return statValue >= req.threshold;
}

/* ---------- Обязательные привычки ---------- */
const isRequiredHabit = habit => habit.required !== false;
function requiredHabitProgress(ref, day) {
  const required = ref.habits.filter(isRequiredHabit);
  const done = required.filter(h => (day.habitLogs || []).some(log => log.habitId === h.id && log.done)).length;
  const needed = Math.ceil(required.length * 0.75);
  return { done, total: required.length, needed, unlocked: done >= needed };
}
function setHabitDone(ref, day, habit, done) {
  const log = day.habitLogs.find(log => log.habitId === habit.id);
  if (!log) return false;
  if (done && !log.done && !isRequiredHabit(habit) && !requiredHabitProgress(ref, day).unlocked) return false;
  log.done = done;
  return true;
}
function habitGateText(ref, day) {
  const p = requiredHabitProgress(ref, day);
  return `Обязательные: ${p.done}/${p.total}. Для необязательных нужно ${p.needed} (75%).`;
}
function updateHabitControl(cb, ref, day, habit) {
  const log = day.habitLogs.find(log => log.habitId === habit.id);
  cb.checked = !!log?.done;
  cb.disabled = !isRequiredHabit(habit) && !log?.done && !requiredHabitProgress(ref, day).unlocked;
  cb.title = cb.disabled ? habitGateText(ref, day) : '';
}

/* ---------- UI: ДЕНЬ ---------- */
class DayModal extends Modal {
constructor(app, store, date) { super(app); this.store = store; this.date = date; }
async onOpen() {
const { store, date } = this, ref = store.ref, day = await store.loadDay(date);
const el = this.contentEl; el.addClass('lt');
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: `📅 ${date} · ${WD[(parseISO(date).getDay() + 6) % 7]}`, style: 'font-weight: 700; font-size: 16px; flex: 1;' });
const saveBtnTop = actionsBar.createEl('button', { text: '💾 Сохранить', cls: 'mod-cta' });
saveBtnTop.style.marginLeft = '8px';
saveBtnTop.onclick = async () => { await store.saveDay(date); new Notice('Сохранено ✓'); };
actionsBar.createEl('button', { text: 'Готово ✓', cls: 'mod-cta' }).onclick = async () => { await store.saveDay(date); this.close(); };
el.createEl('h2', { text: 'Трекер дня', style: 'margin-top: 8px;' });
const footer = el.createDiv({ cls: 'lt-footer' });
const footerText = () => {
  const r = computeDayStats(ref, day), k = dayKcal(ref, day), f = dayFinance(ref, day), c = dayCompletion(ref, day);
  const xpToday = computeDayXP(ref, day, store.work?.items || []);
  return `🎯 ${c.pct}% (${c.done}/${c.total}) · ` + STATS.map(([key, lab]) => `${lab} ${r.stats[key]}`).join(' · ') +
    ` | ккал ${k.balance >= 0 ? '+' : ''}${k.balance}` +
    ` | ₽ ${f.balance >= 0 ? '+' : ''}${f.balance}` +
    (r.syn.length ? ` | синергии: ${r.syn.length} ✅` : '') +
    ` | ✨ +${xpToday} XP`;
};
// при каждом автосохранении проверяем, не выполнена ли какая-нибудь цель на 100%
const save = debounce(() => { store.saveDay(date).then(() => checkCompletedGoals(store)); footer.setText(footerText() + ' · сохранено ✓'); }, 400);
const refresh = () => { footer.setText(footerText()); save(); };
el.createEl('h3', { text: 'Привычки' });
const gate = el.createDiv({ cls: 'lt-chip' });
const habitControls = [];
const refreshHabitControls = () => { gate.setText(habitGateText(ref, day)); for (const [control, habit] of habitControls) updateHabitControl(control, ref, day, habit); };
for (const h of ref.habits) {
  const l = day.habitLogs.find(x => x.habitId === h.id);
  const row = el.createDiv({ cls: 'lt-row' });
  const cb = row.createEl('input', { type: 'checkbox' }); cb.checked = !!l.done;
  habitControls.push([cb, h]);
  cb.addEventListener('change', () => {
    if (!setHabitDone(ref, day, h, cb.checked)) new Notice(habitGateText(ref, day));
    refreshHabitControls(); refresh();
  });
  row.createEl('span', { cls: 'lt-name', text: h.name });
  row.createEl('span', { cls: 'lt-chip', text: fmtStats(h.baseEffects) });
  const sk = row.createEl('span', { cls: 'lt-chip' });
  habitStreak(store, h.id, date).then(n => sk.setText(n ? `🔥${n}` : ''));
}
refreshHabitControls();
el.createEl('h3', { text: 'Вещества' });
for (const s of ref.substances) {
  const l = day.substanceLogs.find(x => x.substanceId === s.id);
  const row = el.createDiv({ cls: 'lt-row' });
  const cb = row.createEl('input', { type: 'checkbox' }); cb.checked = !!l.taken;
  cb.addEventListener('change', () => { l.taken = cb.checked; refresh(); });
  row.createEl('span', { cls: 'lt-name', text: s.name });
}
el.createEl('h3', { text: 'Активности' });
for (const a of ref.activities) {
  const l = day.activityLogs.find(x => x.activityId === a.id);
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: a.name });
  const inp = row.createEl('input', { type: 'number', cls: 'lt-input', attr: { inputmode: 'numeric', min: '0', step: '1' } });
  inp.value = String(+l.amount || 0);
  const kc = row.createEl('span', { cls: 'lt-chip' });
  const upd = () => {
    const val = Math.max(0, +inp.value || 0);
    l.amount = val;
    kc.setText(`−${Math.round(a.kcalPerUnit * l.amount)} ккал`);
    refresh();
  };
  inp.addEventListener('input', upd);
  kc.setText(`−${Math.round(a.kcalPerUnit * (+l.amount || 0))} ккал`);
}
el.createEl('h3', { text: 'Еда (ккал)' });
const mrow = el.createDiv({ cls: 'lt-row' });
for (const [slot, lab] of MEALS) {
  const m = day.meals.find(x => x.slot === slot);
  const w = mrow.createDiv({ cls: 'lt-meal' });
  w.createEl('span', { text: lab });
  const inp = w.createEl('input', { type: 'number', attr: { inputmode: 'numeric' } });
  inp.value = String(+m.kcal || 0);
  inp.addEventListener('input', () => { m.kcal = +inp.value || 0; refresh(); });
}
el.createEl('h3', { text: 'Финансы (₽)' });
const fWrap = el.createDiv();
const renderFin = () => {
  fWrap.empty();
  for (let i = 0; i < day.financeLogs.length; i++) {
    const f = day.financeLogs[i];
    const row = fWrap.createDiv({ cls: 'lt-row' });
    const sel = row.createEl('select');
    for (const c of ref.finCategories) {
      const o = sel.createEl('option', { value: c.id, text: `${c.type === 'income' ? '↓' : '↑'} ${c.name}` });
      if (c.id === f.categoryId) o.selected = true;
    }
    sel.addEventListener('change', () => { f.categoryId = sel.value; refresh(); });
    const amt = row.createEl('input', { type: 'number', cls: 'lt-input', attr: { inputmode: 'decimal' } });
    amt.value = String(+f.amount || 0);
    amt.addEventListener('input', () => { f.amount = +amt.value || 0; refresh(); });
    row.createEl('button', { text: '✕' }).onclick = () => { day.financeLogs.splice(i, 1); renderFin(); refresh(); };
  }
  fWrap.createEl('button', { text: '+ операция', cls: 'lt-add' }).onclick = () => {
    if (ref.finCategories.length === 0) { new Notice('Сначала добавь категории в Справочниках'); return; }
    day.financeLogs.push({ categoryId: ref.finCategories[0].id, amount: 0, note: '' });
    renderFin(); refresh();
  };
  const tot = dayFinance(ref, day);
  fWrap.createDiv({ cls: 'lt-sum', text: `↓ ${tot.income} ₽  ↑ ${tot.expense} ₽  = ${tot.balance} ₽` });
};
renderFin();
el.createEl('h3', { text: 'Состояние (0–10)' });
for (const [key, lab] of STATES) {
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: lab });
  const r = row.createEl('input', { type: 'range', attr: { min: '0', max: '10', step: '1' } });
  r.value = String(day.state[key] ?? 5);
  const v = row.createEl('span', { cls: 'lt-chip', text: r.value });
  r.addEventListener('input', () => { day.state[key] = +r.value; v.setText(r.value); refresh(); });
}
el.createEl('h3', { text: 'Комментарий' });
const ta = el.createEl('textarea', { cls: 'lt-comment' }); ta.value = day.comment || '';
ta.addEventListener('input', () => { day.comment = ta.value; save(); });
footer.setText(footerText());
}
}

/* ---------- UI: НЕДЕЛЯ ---------- */
class WeekModal extends Modal {
constructor(app, store, date) { super(app); this.store = store; this.date = date; }
async onOpen() {
const { store } = this, ref = store.ref, el = this.contentEl; el.addClass('lt');
await checkCompletedGoals(store); // вдруг цель дозрела до 100%
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: `📅 Неделя · ${this.date}`, style: 'font-weight: 700; font-size: 16px; flex: 1;' });
const mon = mondayOf(parseISO(this.date)), today = iso(new Date());
const days = [];
for (let i = 0; i < 7; i++) { const d = iso(addDays(mon, i)); days.push({ d, future: d > today, day: d <= today ? await store.loadDay(d) : null }); }
el.createEl('h2', { text: 'Обзор недели', style: 'margin-top: 8px;' });
const wc = await weekCompletion(store, ref, today);
el.createDiv({ cls: 'lt-big' }).createEl('span', { text: `🎯 Итог недели: ${wc.pct}% (${wc.done}/${wc.total})` });
const t = el.createEl('table', { cls: 'lt-week' }), tb = t.createEl('tbody');
const hd = tb.createEl('tr'); hd.createEl('th', { text: '' });
days.forEach(x => hd.createEl('th', { text: WD[(parseISO(x.d).getDay() + 6) % 7] }));
hd.createEl('th', { text: 'Σ' });
const cell = (x, get) => x.future ? '·' : (get(x.day) ? '✓' : '✗');
const cnt = x => get => !x.future && get(x.day);
for (const h of ref.habits) {
  const r = tb.createEl('tr'); r.createEl('td', { text: h.name }); let n = 0;
  days.forEach(x => { const ok = cnt(x)(d => d.habitLogs.find(l => l.habitId === h.id && l.done)); if (ok) n++; r.createEl('td', { text: cell(x, d => d.habitLogs.find(l => l.habitId === h.id && l.done)), cls: ok ? 'lt-ok' : '' }); });
  r.createEl('td', { text: `${n}/7` });
}
for (const s of ref.substances) {
  const r = tb.createEl('tr'); r.createEl('td', { text: s.name }); let n = 0;
  days.forEach(x => { const ok = cnt(x)(d => d.substanceLogs.find(l => l.substanceId === s.id && l.taken)); if (ok) n++; r.createEl('td', { text: cell(x, d => d.substanceLogs.find(l => l.substanceId === s.id && l.taken)), cls: ok ? 'lt-ok' : '' }); });
  r.createEl('td', { text: `${n}/7` });
}
const rsy = tb.createEl('tr'); rsy.createEl('td', { text: 'Синергии' }); let synSum = 0;
days.forEach(x => { const v = x.future ? '·' : String(computeDayStats(ref, x.day).syn.length); if (!x.future) synSum += +v; rsy.createEl('td', { text: v }); });
rsy.createEl('td', { text: String(synSum) });
const rk = tb.createEl('tr'); rk.createEl('td', { text: 'Ккал баланс' }); let kSum = 0;
days.forEach(x => { const v = x.future ? '·' : String(dayKcal(ref, x.day).balance); if (!x.future) kSum += +v; rk.createEl('td', { text: v }); });
rk.createEl('td', { text: String(kSum) });
const rf = tb.createEl('tr'); rf.createEl('td', { text: '₽ баланс' }); let fSum = 0;
days.forEach(x => { const v = x.future ? '·' : String(dayFinance(ref, x.day).balance); if (!x.future) fSum += +v; rf.createEl('td', { text: v }); });
rf.createEl('td', { text: String(fSum) });
const tot = zeroStats();
days.forEach(x => { if (!x.future) { const s = computeDayStats(ref, x.day).stats; for (const [k] of STATS) tot[k] += s[k]; } });
const rtt = tb.createEl('tr'); rtt.createEl('td', { text: 'Статы за неделю' });
rtt.createEl('td', { cls: 'lt-sum', attr: { colspan: '7' }, text: fmtStats(tot) }); rtt.createEl('td', { text: '' });
el.createEl('h3', { text: 'Навыки за неделю' });
const hours = skillHoursFor(ref, days.filter(x => !x.future).map(x => x.day));
for (const sk of ref.skills) {
  const h = hours[sk.id] || 0;
  const lv = skillLevel(h);
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: sk.name });
  row.createEl('span', { cls: 'lt-chip', text: lv.name });
  row.createEl('span', { cls: 'lt-chip', text: fmtH(h) + ' / ' + lv.to + ' ч' });
  const bar = row.createDiv({ cls: 'lt-bar' });
  bar.createDiv({ cls: 'lt-bar-fill', attr: { style: `width:${skillProgress(h)}%` } });
}
el.createEl('h3', { text: 'Цели' });
for (const g of ref.goals) {
  const p = await goalProgress(store, g, today);
  const mark = (g.status === 'achieved' || g.status === 'completed') ? ' 🏆' : '';
  el.createDiv({ cls: 'lt-row' }).createEl('span', { text: `${g.name}${mark}: ${Math.round(p * 10) / 10} / ${g.targetValue} (${Math.min(999, Math.round(p / g.targetValue * 100))}%)` });
}
}
}

/* ---------- CRUD справочников ---------- */
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const TITLES = { habits: 'Привычка', activities: 'Активность', substances: 'Вещество', skills: 'Навык', synergyRules: 'Синергия', goals: 'Цель', finCategories: 'Категория финансов' };
function newItem(key) {
switch (key) {
case 'habits': return { id: uid('h'), name: '', required: true, baseEffects: zeroStats() };
case 'activities': return { id: uid('a'), name: '', kcalPerUnit: 0 };
case 'substances': return { id: uid('s'), name: '' };
case 'skills': return { id: uid('sk'), name: '', description: '', habitRefs: [] };
case 'synergyRules': return { id: uid('r'), source: { type: 'habit', id: '' }, target: { type: 'substance', id: '' }, bonus: zeroStats() };
case 'goals': return { id: uid('g'), name: '', targetType: 'activity', targetId: '', metric: 'km', targetValue: 0, start: iso(new Date()), end: '', status: 'active' };
case 'finCategories': return { id: uid('fc'), name: '', type: 'expense' };
}
}
function epName(ref, ep) {
const col = ep.type === 'habit' ? 'habits' : ep.type === 'activity' ? 'activities' : ep.type === 'substance' ? 'substances' : null;
if (!col) return '?';
const it = ref[col].find(x => x.id === ep.id);
return it ? it.name : '?(удалено)';
}
function subline(ref, key, it) {
switch (key) {
case 'habits': return (isRequiredHabit(it) ? 'Обязательная' : 'Необязательная') + ' · ' + fmtStats(it.baseEffects);
case 'activities': return it.kcalPerUnit + ' ккал/ед';
case 'skills': return (it.habitRefs || []).length + ' связей';
case 'synergyRules': return fmtStats(it.bonus);
case 'goals': return it.targetValue + ' ' + it.metric;
case 'finCategories': return it.type === 'income' ? '↓ доход' : '↑ расход';
default: return '';
}
}

/* ---------- список справочников ---------- */
class RefModal extends Modal {
constructor(app, store) { super(app); this.store = store; }
onOpen() { this.render(); }
async render() {
await checkCompletedGoals(this.store); // достижения всегда свежие
const ref = this.store.ref, el = this.contentEl; el.empty(); el.addClass('lt');
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: '📚 Справочники', style: 'font-weight: 700; font-size: 16px; flex: 1;' });
actionsBar.createEl('button', { text: '💾 Сохранить', cls: 'mod-cta' }).onclick = async () => { await this.store.saveRef(); new Notice('Справочники сохранены ✓'); };
el.createEl('h2', { text: 'Управление справочниками', style: 'margin-top: 8px;' });
const cols = [
  ['habits', 'Привычки', h => h.name],
  ['activities', 'Активности', a => a.name],
  ['substances', 'Вещества', s => s.name],
  ['skills', 'Навыки', s => s.name],
  ['synergyRules', 'Синергии', r => epName(ref, r.source) + ' + ' + epName(ref, r.target)],
  ['goals', 'Цели', g => g.name],
  ['finCategories', 'Категории финансов', c => c.name],
];
for (const [key, label, fmt] of cols) {
  el.createEl('h3', { text: label });
  for (const item of ref[key]) {
    const row = el.createDiv({ cls: 'lt-row' });
    row.createEl('span', { cls: 'lt-name', text: fmt(item) || '(без имени)' });
    const sub = subline(ref, key, item);
    if (sub) row.createEl('span', { cls: 'lt-chip', text: sub });
    row.createEl('button', { text: key === 'skills' ? 'Редактировать навык' : '✎' }).onclick = () => new EditModal(this.app, this.store, key, item, () => this.render()).open();
    const del = row.createEl('button', { text: '🗑' });
    del.onclick = () => {
      if (del.dataset.arm) { this.store.ref[key] = this.store.ref[key].filter(x => x.id !== item.id); this.store.saveRef(); this.render(); }
      else { del.dataset.arm = '1'; del.setText('точно?'); del.addClass('lt-danger'); setTimeout(() => { if (del.isConnected) { del.setText('🗑'); delete del.dataset.arm; del.removeClass('lt-danger'); } }, 2500); }
    };
  }
  el.createEl('button', { text: '+ добавить', cls: 'lt-add' }).onclick = () => new EditModal(this.app, this.store, key, null, () => this.render()).open();
}
el.createEl('h3', { text: '📈 Уровни навыков (текущие часы)' });
const hoursMap = {};
for (const d of (await this.store.listDays())) {
  const day = await this.store.loadDay(d);
  for (const sk of ref.skills) hoursMap[sk.id] = (hoursMap[sk.id] || 0) + LifeTrackerRoadmaps.skillHoursForDay(sk, day);
}
for (const sk of ref.skills) {
  const h = hoursMap[sk.id] || 0;
  const lv = skillLevel(h);
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: sk.name });
  row.createEl('span', { cls: 'lt-chip', text: lv.name });
  row.createEl('span', { cls: 'lt-chip', text: fmtH(h) + ' / ' + lv.to + ' ч' });
  const bar = row.createDiv({ cls: 'lt-bar' });
  bar.createDiv({ cls: 'lt-bar-fill', attr: { style: `width:${skillProgress(h)}%` } });
  row.createEl('button', { text: 'Редактировать навык' }).onclick = () => new EditModal(this.app, this.store, 'skills', sk, () => this.render()).open();
  renderSkillHoursForm(el, this.store, sk, () => this.render());
}
el.createEl('h3', { text: '🏆 Достижения' });
for (const a of (ref.achievements || []).slice().reverse()) {
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: `🏆 ${a.title}` });
  row.createEl('span', { cls: 'lt-chip', text: a.date || '' });
  const del = row.createEl('button', { text: '🗑' });
  del.onclick = () => {
    if (del.dataset.arm) { ref.achievements = ref.achievements.filter(x => x.id !== a.id); this.store.saveRef(); this.render(); }
    else { del.dataset.arm = '1'; del.setText('точно?'); del.addClass('lt-danger'); setTimeout(() => { if (del.isConnected) { del.setText('🗑'); delete del.dataset.arm; del.removeClass('lt-danger'); } }, 2500); }
  };
}
el.createEl('button', { text: '+ добавить достижение', cls: 'lt-add' }).onclick = () => new AchievementEditModal(this.app, this.store, () => this.render()).open();
}
}

/* Быстрая настройка часов прямо в справочнике, отдельно для каждого навыка. */
function renderSkillHoursForm(parent, store, skill, onSaved) {
const wrap = parent.createDiv({ cls: 'lt-skill-hours' });
const original = JSON.stringify(skill.habitRefs || []);
const links = JSON.parse(original);
if (!links.length) { wrap.createDiv({ cls: 'lt-description', text: 'Связанных привычек нет. Нажмите «Редактировать навык», чтобы добавить их.' }); return; }
wrap.createDiv({ cls: 'lt-description', text: 'Часы за одно выполнение каждой привычки. Пустое поле сохраняет расчёт по журналу. Изменения пересчитают накопленные часы.' });
for (const link of links) {
  const habit = store.ref.habits.find(h => h.id === link.habitId);
  const label = wrap.createEl('label', { cls: 'lt-row' });
  label.createEl('span', { cls: 'lt-name', text: habit?.name || '(привычка удалена)' });
  label.createEl('span', { text: 'Часов за выполнение' });
  const input = label.createEl('input', { type: 'number', cls: 'lt-input', attr: { min: '0', step: 'any', inputmode: 'decimal', placeholder: 'По журналу' } });
  input.value = link.hoursPerCompletion === undefined ? '' : String(link.hoursPerCompletion);
  input.disabled = !habit;
  input.addEventListener('input', () => { if (!input.value.trim()) delete link.hoursPerCompletion; else link.hoursPerCompletion = Number(input.value); });
}
const save = wrap.createEl('button', { text: 'Сохранить часы · ' + skill.name });
save.onclick = async () => {
  if (links.some(link => link.hoursPerCompletion !== undefined && (!Number.isFinite(link.hoursPerCompletion) || link.hoursPerCompletion < 0))) { new Notice('Количество часов должно быть неотрицательным числом'); return; }
  const current = store.ref.skills.find(s => s.id === skill.id);
  if (!current || JSON.stringify(current.habitRefs || []) !== original) { new Notice('Навык изменён. Откройте справочник заново перед сохранением.'); return; }
  save.disabled = true;
  const previous = current.habitRefs;
  current.habitRefs = JSON.parse(JSON.stringify(links));
  try { await store.saveRef(); }
  catch (error) { current.habitRefs = previous; save.disabled = false; new Notice('Не удалось сохранить часы: ' + error.message); return; }
  save.disabled = false;
  new Notice('Часы навыка сохранены ✓'); await onSaved();
};
}

/* ---------- конструктор форм ---------- */
class FormBuilder {
constructor(el, item, store) { this.el = el; this.item = item; this.store = store; }
checkbox(k, label, defaultValue = false) { const r = this.row(); const wrapper = r.createEl('label'); const i = wrapper.createEl('input', { type: 'checkbox' }); i.checked = this.item[k] ?? defaultValue; wrapper.createEl('span', { text: label }); i.addEventListener('change', () => { this.item[k] = i.checked; }); }
row(label) { const r = this.el.createDiv({ cls: 'lt-row' }); if (label) r.createEl('span', { cls: 'lt-flabel', text: label }); return r; }
text(k, label) { const r = this.row(label); const i = r.createEl('input', { type: 'text', cls: 'lt-wide' }); i.value = this.item[k] || ''; i.addEventListener('input', () => { this.item[k] = i.value; }); }
num(k, label) { const r = this.row(label); const i = r.createEl('input', { type: 'number', cls: 'lt-input' }); i.value = String(this.item[k] ?? 0); i.addEventListener('input', () => { this.item[k] = +i.value || 0; }); }
date(k, label) { const r = this.row(label); const i = r.createEl('input', { type: 'date', cls: 'lt-input' }); i.value = this.item[k] || ''; i.addEventListener('input', () => { this.item[k] = i.value; }); }
select(k, label, opts, onChange) {
const r = this.row(label); const s = r.createEl('select');
for (const [v, t] of opts) { const o = s.createEl('option', { value: v, text: t }); if (this.item[k] === v) o.selected = true; }
s.addEventListener('change', () => { this.item[k] = s.value; onChange && onChange(); });
}
stats(k, label) {
this.el.createDiv({ cls: 'lt-flabel', text: label });
const r = this.el.createDiv({ cls: 'lt-stats' });
for (const [key, lab] of STATS) {
const w = r.createDiv({ cls: 'lt-meal' }); w.createEl('span', { text: lab });
const i = w.createEl('input', { type: 'number', cls: 'lt-input' }); i.value = String(this.item[k][key] || 0);
i.addEventListener('input', () => { this.item[k][key] = +i.value || 0; });
}
}
endpoint(k, label) {
this.el.createDiv({ cls: 'lt-flabel', text: label });
const r = this.el.createDiv({ cls: 'lt-row' });
const ts = r.createEl('select');
for (const [v, t] of [['habit', 'привычка'], ['activity', 'активность'], ['substance', 'вещество']]) { const o = ts.createEl('option', { value: v, text: t }); if (this.item[k].type === v) o.selected = true; }
const is = r.createEl('select');
const fill = () => {
is.empty();
const col = this.item[k].type === 'habit' ? 'habits' : this.item[k].type === 'activity' ? 'activities' : 'substances';
for (const x of this.store.ref[col]) { const o = is.createEl('option', { value: x.id, text: x.name }); if (this.item[k].id === x.id) o.selected = true; }
this.item[k].id = is.value || '';
};
ts.addEventListener('change', () => { this.item[k].type = ts.value; fill(); });
is.addEventListener('change', () => { this.item[k].id = is.value; });
fill();
}
refs(k) {
const wrap = this.el.createDiv();
const render = () => {
wrap.empty();
this.item[k].forEach((hr, idx) => {
const r = wrap.createDiv({ cls: 'lt-row' });
const s = r.createEl('select');
for (const h of this.store.ref.habits) { const o = s.createEl('option', { value: h.id, text: h.name }); if (hr.habitId === h.id) o.selected = true; }
s.addEventListener('change', () => { hr.habitId = s.value; });
if (hr.habitId && !this.store.ref.habits.some(h => h.id === hr.habitId)) s.createEl('option', { value: hr.habitId, text: '(привычка удалена)' }).selected = true;
const label = r.createEl('label'); label.createEl('span', { text: 'Часов за выполнение: ' });
const w = label.createEl('input', { type: 'number', cls: 'lt-input', attr: { step: 'any', min: '0', inputmode: 'decimal', placeholder: 'По журналу' } });
w.value = hr.hoursPerCompletion === undefined ? '' : String(hr.hoursPerCompletion);
w.addEventListener('input', () => { if (!w.value.trim()) delete hr.hoursPerCompletion; else hr.hoursPerCompletion = Number(w.value); });
if (hr.hoursPerCompletion === undefined) r.createEl('span', { cls: 'lt-description', text: 'Пустое поле: часы журнала × прежний вес ' + (hr.weight ?? 1) });
r.createEl('button', { text: '✕' }).onclick = () => { this.item[k].splice(idx, 1); render(); };
});
wrap.createEl('button', { text: '+ связь с привычкой', cls: 'lt-add' }).onclick = () => { this.item[k].push({ habitId: this.store.ref.habits[0]?.id || '', hoursPerCompletion: 1 }); render(); };
};
render();
}
refSelect(k, label, collGetter, onRegister) {
const r = this.row(label); const s = r.createEl('select');
const fill = () => {
s.empty();
for (const x of this.store.ref[collGetter()]) { const o = s.createEl('option', { value: x.id, text: x.name }); if (this.item[k] === x.id) o.selected = true; }
this.item[k] = s.value || '';
};
fill(); onRegister && onRegister(fill);
s.addEventListener('change', () => { this.item[k] = s.value; });
}
}

/* ---------- форма элемента справочника ---------- */
class EditModal extends Modal {
constructor(app, store, collKey, item, onSaved) {
super(app); this.store = store; this.collKey = collKey; this.onSaved = onSaved;
this.isNew = !item;
this.item = item ? JSON.parse(JSON.stringify(item)) : newItem(collKey);
}
onOpen() {
const el = this.contentEl; el.addClass('lt');
const it = this.item;
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: (this.isNew ? 'Новая · ' : 'Правка · ') + TITLES[this.collKey], style: 'font-weight: 700; font-size: 16px; flex: 1;' });
actionsBar.createEl('button', { text: 'Сохранить ✓', cls: 'mod-cta' }).onclick = async () => {
  if (this.collKey !== 'synergyRules' && !it.name) { new Notice('Нужно название'); return; }
  if (this.collKey === 'synergyRules' && (!it.source.id || !it.target.id)) { new Notice('Выбери оба конца синергии'); return; }
  if (this.collKey === 'skills') {
    const ids = new Set();
    for (const link of it.habitRefs || []) {
      if (!this.store.ref.habits.some(h => h.id === link.habitId) || ids.has(link.habitId)) { new Notice('Выберите существующие привычки без повторов'); return; }
      ids.add(link.habitId);
      if (link.hoursPerCompletion !== undefined && (!Number.isFinite(link.hoursPerCompletion) || link.hoursPerCompletion < 0)) { new Notice('Количество часов должно быть неотрицательным числом'); return; }
    }
  }
  if (this.collKey === 'goals' && it.status === 'achieved') {
    if (!it.completedAt) it.completedAt = iso(new Date());
    if (!it.completedDate) it.completedDate = it.completedAt;
    const already = this.store.ref.achievements.find(a => a.fromGoalId === it.id);
    if (!already) {
      this.store.ref.achievements.push({ id: uid('ach'), title: '🎯 ' + it.name, description: '', date: iso(new Date()), fromGoalId: it.id });
      new Notice('Достижение создано: ' + it.name);
    }
  }
  const arr = this.store.ref[this.collKey];
  if (this.isNew) arr.push(it);
  else { const i = arr.findIndex(x => x.id === it.id); if (i >= 0) arr[i] = it; }
  await this.store.saveRef();
  if (this.collKey === 'goals') await syncRewards(this.store);
  this.onSaved(); this.close();
};
el.createEl('h2', { text: 'Редактирование', style: 'margin-top: 8px;' });
const F = new FormBuilder(el, it, this.store);
switch (this.collKey) {
  case 'habits': F.text('name', 'Название'); F.checkbox('required', 'Обязательная', true); F.stats('baseEffects', 'Эффекты за выполнение'); break;
  case 'activities': F.text('name', 'Название'); F.num('kcalPerUnit', 'ккал за единицу'); break;
  case 'substances': F.text('name', 'Название'); break;
  case 'skills': F.text('name', 'Название'); F.text('description', 'Описание'); F.refs('habitRefs'); break;
  case 'synergyRules': F.endpoint('source', 'Условие 1'); F.endpoint('target', 'Условие 2'); F.stats('bonus', 'Бонус, если оба в один день'); break;
  case 'goals': {
    F.text('name', 'Название');
    if (!it.targetType) it.targetType = 'activity';
    const typeRow = F.row('Тип цели');
    const typeSel = typeRow.createEl('select');
    for (const [v, t] of [
      ['activity', 'Активность (кол-во)'],
      ['skill', 'Навык (часы)'],
      ['habit', 'Привычки (выполнения)'],
      ['streak', 'Серия привычки (дней)'],
      ['kcal', 'Калории (ккал)'],
      ['finance', 'Финансы (₽)']
    ]) { const o = typeSel.createEl('option', { value: v, text: t }); if (it.targetType === v) o.selected = true; }
    const objRow = F.row('Объект');
    const objSel = objRow.createEl('select');
    const metRow = F.row('Метрика');
    const metSel = metRow.createEl('select');
    const fillMet = () => {
      metSel.empty();
      let opts = null;
      if (it.targetType === 'activity') opts = [['km', 'км'], ['count', 'кол-во']];
      else if (it.targetType === 'kcal') opts = [['burned', 'сожжено'], ['eaten', 'съедено'], ['balance', 'баланс']];
      else if (it.targetType === 'finance' && !it.targetId) opts = [['income', 'доходы'], ['expense', 'траты'], ['balance', 'баланс']];
      if (!opts) { metRow.style.display = 'none'; return; }
      metRow.style.display = '';
      for (const [v, t] of opts) metSel.createEl('option', { value: v, text: t });
      if (!opts.some(([v]) => v === it.metric)) it.metric = opts[0][0];
      metSel.value = it.metric;
    };
    const fillObj = () => {
      objSel.empty();
      let coll = null, anyLabel = null;
      if (it.targetType === 'activity') coll = 'activities';
      else if (it.targetType === 'skill') coll = 'skills';
      else if (it.targetType === 'habit') { coll = 'habits'; anyLabel = 'Все привычки'; }
      else if (it.targetType === 'streak') coll = 'habits';
      else if (it.targetType === 'finance') { coll = 'finCategories'; anyLabel = 'Все категории'; }
      if (!coll) { objRow.style.display = 'none'; it.targetId = ''; fillMet(); return; }
      objRow.style.display = '';
      if (anyLabel) objSel.createEl('option', { value: '', text: anyLabel });
      for (const x of this.store.ref[coll]) objSel.createEl('option', { value: x.id, text: x.name });
      if (!Array.from(objSel.options).some(o => o.value === it.targetId)) it.targetId = objSel.options[0] ? objSel.options[0].value : '';
      objSel.value = it.targetId;
      fillMet();
    };
    typeSel.addEventListener('change', () => { it.targetType = typeSel.value; it.targetId = ''; it.metric = ''; fillObj(); });
    objSel.addEventListener('change', () => { it.targetId = objSel.value; fillMet(); });
    metSel.addEventListener('change', () => { it.metric = metSel.value; });
    fillObj();
    F.num('targetValue', 'Целевое значение');
    F.date('start', 'Начало'); F.date('end', 'Конец (опц.)');
    F.select('status', 'Статус', [['active', 'активна'], ['achieved', 'выполнена'], ['failed', 'провалена'], ['cancelled', 'отменена']]);
    break;
  }
  case 'finCategories':
    F.text('name', 'Название');
    F.select('type', 'Тип', [['income', '↓ доход'], ['expense', '↑ расход']]);
    break;
}
}
}

/* ---------- форма достижения ---------- */
class AchievementEditModal extends Modal {
constructor(app, store, onSaved) { super(app); this.store = store; this.onSaved = onSaved; this.item = { id: uid('ach'), title: '', description: '', date: iso(new Date()) }; }
onOpen() {
const el = this.contentEl; el.addClass('lt');
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: '🏆 Новое достижение', style: 'font-weight: 700; font-size: 16px; flex: 1;' });
actionsBar.createEl('button', { text: 'Сохранить ✓', cls: 'mod-cta' }).onclick = async () => {
  if (!this.item.title) { new Notice('Нужно название'); return; }
  this.store.ref.achievements.push(this.item);
  await this.store.saveRef();
  this.onSaved(); this.close();
};
el.createEl('h2', { text: 'Достижение', style: 'margin-top: 8px;' });
const F = new FormBuilder(el, this.item, this.store);
F.text('title', 'Название');
F.text('description', 'Описание');
F.date('date', 'Дата получения');
}
}

/* ---------- UI: ДЕЛА И ИДЕИ ---------- */
class WorkItemsModal extends Modal {
constructor(app, store) { super(app); this.store = store; }
onOpen() { this.render(); }
render() {
const el = this.contentEl; el.empty(); el.addClass('lt');
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: '📋 Дела и идеи', style: 'font-weight: 700; font-size: 16px; flex: 1;' });
el.createEl('h2', { text: 'Управление задачами', style: 'margin-top: 8px;' });
const tabs = el.createDiv({ cls: 'lt-tabs' });
const kinds = [['all', 'Все'], ['task', 'Дела'], ['idea', 'Идеи'], ['done', 'Выполненные']];
let curKind = 'all';
const list = el.createDiv();
const rerender = () => {
  list.empty();
  const items = this.store.work.items.filter(it => {
    if (curKind === 'done') return it.status === 'done';
    if (curKind === 'all') return true;
    return it.kind === curKind;
  });
  if (items.length === 0) list.createDiv({ text: '— пусто —' });
  const todayStats = computeDayStats(this.store.ref, this.store.cache[iso(new Date())] || { habitLogs: [], substanceLogs: [], activityLogs: [] }).stats;
  for (const it of items) {
    const row = list.createDiv({ cls: 'lt-row' });
    const statusIcons = { backlog: '○', in_progress: '◐', done: '✓', dropped: '✕' };
    let canAccess = true;
    let reqText = '';
    if (it.minStatRequirement) {
      const [statKey, statLabel] = STATS.find(([k]) => k === it.minStatRequirement.stat) || ['', '?'];
      const statValue = todayStats[it.minStatRequirement.stat] || 0;
      canAccess = statValue >= it.minStatRequirement.threshold;
      reqText = ` (${statLabel} ${statValue}/${it.minStatRequirement.threshold})`;
    }
    const icon = canAccess ? (it.kind === 'task' ? '📝 ' : '💡 ') + (statusIcons[it.status] || '') : '🔒 ';
    row.createEl('span', { cls: 'lt-chip', text: icon });
    row.createEl('span', { cls: 'lt-name' + (it.status === 'done' ? ' lt-done' : '') + (!canAccess ? ' lt-locked' : ''), text: (it.name || '(без имени)') + reqText });
    row.createEl('button', { text: '✎' }).onclick = () => new WorkItemEditModal(this.app, this.store, it, () => this.render()).open();
    const del = row.createEl('button', { text: '🗑' });
    del.onclick = () => {
      if (del.dataset.arm) { this.store.work.items = this.store.work.items.filter(x => x.id !== it.id); this.store.saveWorkItems(); this.render(); }
      else { del.dataset.arm = '1'; del.setText('точно?'); del.addClass('lt-danger'); setTimeout(() => { if (del.isConnected) { del.setText('🗑'); delete del.dataset.arm; del.removeClass('lt-danger'); } }, 2500); }
    };
  }
};
for (const [k, l] of kinds) {
  const b = tabs.createEl('button', { text: l });
  b.onclick = () => { curKind = k; tabs.findAll('button').forEach(x => x.removeClass('is-active')); b.addClass('is-active'); rerender(); };
  if (k === 'all') b.addClass('is-active');
}
rerender();
el.createEl('button', { text: '+ дело', cls: 'lt-add' }).onclick = () => new WorkItemEditModal(this.app, this.store, null, () => this.render(), 'task').open();
el.createEl('button', { text: '+ идея', cls: 'lt-add' }).onclick = () => new WorkItemEditModal(this.app, this.store, null, () => this.render(), 'idea').open();
}
}

class WorkItemEditModal extends Modal {
constructor(app, store, item, onSaved, defaultKind) {
super(app); this.store = store; this.onSaved = onSaved;
this.isNew = !item;
this.item = item ? JSON.parse(JSON.stringify(item)) : { id: uid('wi'), kind: defaultKind || 'task', name: '', description: '', effects: zeroStats(), status: 'backlog', createdAt: iso(new Date()) };
}
onOpen() {
const el = this.contentEl; el.addClass('lt');
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: (this.isNew ? 'Новый' : 'Правка') + ' · ' + (this.item.kind === 'task' ? 'Дело' : 'Идея'), style: 'font-weight: 700; font-size: 16px; flex: 1;' });
actionsBar.createEl('button', { text: 'Сохранить ✓', cls: 'mod-cta' }).onclick = async () => {
  if (!this.item.name) { new Notice('Нужно название'); return; }
  if (this.item.status === 'done' && !this.item.doneAt) this.item.doneAt = iso(new Date());
  if (this.item.status === 'done' && !this.item.completedDate) this.item.completedDate = iso(new Date());
  if (this.isNew) this.store.work.items.push(this.item);
  else { const i = this.store.work.items.findIndex(x => x.id === this.item.id); if (i >= 0) this.store.work.items[i] = this.item; }
  await this.store.saveWorkItems();
  this.onSaved(); this.close();
};
/* 🔒 Требование к характеристике — вверху, чтобы не перекрывалось клавиатурой iOS */
const canEditRequirement = this.isNew || !this.item.minStatRequirement;
if (canEditRequirement) {
  el.createEl('h4', { text: '🔒 Требование к характеристике (после сохранения — только чтение)', style: 'margin: 10px 0 4px; font-size: 13px;' });
  const reqRow = el.createDiv({ cls: 'lt-row' });
  const statSel = reqRow.createEl('select', { cls: 'lt-big-select' });
  statSel.createEl('option', { value: '', text: 'Без требования' });
  for (const [key, label] of STATS) statSel.createEl('option', { value: key, text: label });
  if (this.item.minStatRequirement) statSel.value = this.item.minStatRequirement.stat;
  const threshInput = reqRow.createEl('input', { type: 'number', cls: 'lt-big-input', attr: { min: '0', max: '100', placeholder: 'Порог' } });
  if (this.item.minStatRequirement) threshInput.value = this.item.minStatRequirement.threshold;
  const setReqBtn = el.createEl('button', { text: '🔒 Установить требование', cls: 'mod-cta' });
  setReqBtn.onclick = () => {
    if (statSel.value) {
      this.item.minStatRequirement = { stat: statSel.value, threshold: parseInt(threshInput.value) || 0 };
      new Notice(`Требование установлено: ${STATS.find(([k]) => k === statSel.value)?.[1]} >= ${threshInput.value}`);
    } else {
      this.item.minStatRequirement = null;
      new Notice('Требование снято');
    }
  };
} else if (this.item.minStatRequirement) {
  const [statKey, statLabel] = STATS.find(([k]) => k === this.item.minStatRequirement.stat) || ['', '?'];
  el.createEl('div', { cls: 'lt-notice', text: `🔒 Требование: ${statLabel} >= ${this.item.minStatRequirement.threshold} (нельзя изменить)` });
}
el.createEl('h2', { text: 'Редактирование', style: 'margin-top: 8px;' });
const F = new FormBuilder(el, this.item, this.store);
F.text('name', 'Название');
F.text('description', 'Описание');
F.select('kind', 'Тип', [['task', 'Дело'], ['idea', 'Идея']]);
F.select('status', 'Статус', [['backlog', 'Ожидает'], ['in_progress', 'В работе'], ['done', 'Выполнено'], ['dropped', 'Отброшено']]);
F.stats('effects', 'Эффекты (опц.)');
}
}

/* ---------- UI: НАГРАДЫ И ТИТУЛЫ ---------- */
class RewardsModal extends Modal {
constructor(app, store) { super(app); this.store = store; }
async onOpen() {
const el = this.contentEl; el.addClass('lt-rewards');
const ref = this.store.ref;
// 1) выполненные на 100% цели → достижения; 2) пересчёт валюты и слотов из источника
await checkCompletedGoals(this.store);
await syncRewards(this.store);
const rewardsData = this.store.rewardsData;
const progress = await getPlayerProgress(this.store);

/* Верхняя панель: кнопка создания трофея НАВЕРХУ — клавиатура iOS её не перекрывает */
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: '🏆 Награды и титулы', style: 'font-weight: 700; font-size: 16px; flex: 1;' });
const topCreateBtn = actionsBar.createEl('button', { text: '💾 Создать трофей', cls: 'mod-cta' });
topCreateBtn.style.marginLeft = '8px';

el.createEl('h2', { text: 'Панель наград', style: 'margin-top: 8px;' });

/* ---- Форма создания трофея (наверху для iOS) ---- */
el.createEl('h3', { text: '➕ Создать трофей (1 🪙)' });
const addForm = el.createDiv({ cls: 'lt-form' });
const nameInput = addForm.createEl('input', { type: 'text', placeholder: 'Название трофея (реальный предмет)', cls: 'lt-big-input' });
const descInput = addForm.createEl('input', { type: 'text', placeholder: 'Описание трофея (необязательно)', cls: 'lt-big-input' });
const typeSelect = addForm.createEl('select', { cls: 'lt-big-select' });
typeSelect.createEl('option', { value: REWARD_TYPES.ACCESSORY, text: '📿 Аксессуар (часы, кольцо, браслет...)' });
typeSelect.createEl('option', { value: REWARD_TYPES.DECOR, text: '🏺 Декор (статуэтка, картина, грамота...)' });
const createTrophy = async () => {
    if (!nameInput.value.trim()) { new Notice('Введите название трофея'); return; }
    const rd = this.store.rewardsData;
    if (rd.currency < 1) { new Notice('Недостаточно очков славы (нужно 1 🪙)'); return; }

    rd.inventory.push({
        id: 'trophy_' + Date.now(),
        type: typeSelect.value,
        name: nameInput.value.trim(),
        description: descInput.value.trim() || '',
        unlockedAt: iso(new Date())
    });
    this.store.rewardsData = rd;

    await this.store.saveRewards();   // ✅ СНАЧАЛА сохранить на диск
    await syncRewards(this.store);    // Теперь loadRewards() увидит трофей

    new Notice('Трофей создан! Потрачено 1 🪙');
    this.close();
    new RewardsModal(this.app, this.store).open();
};
topCreateBtn.onclick = createTrophy;
addForm.createEl('button', { text: '💾 Создать трофей', cls: 'mod-cta' }).onclick = createTrophy;

/* ---- Секция 1: Уровень игрока ---- */
const levelSection = el.createDiv({ cls: 'lt-rewards-section' });
levelSection.createEl('h3', { text: `⚔️ Уровень ${progress.level} — ${progress.name}` });
levelSection.createEl('div', { text: `✨ Всего XP: ${progress.totalXP}` });
levelSection.createEl('div', { text: `📊 До следующего уровня: ${progress.remaining} XP` });
levelSection.createEl('button', { text: '🔄 Проверить цели и награды', cls: 'mod-cta' }).onclick = async () => {
  const moved = await checkCompletedGoals(this.store);
  await syncRewards(this.store);
  if (!moved.length) new Notice('Награды пересчитаны');
  this.close();
  new RewardsModal(this.app, this.store).open();
};

/* ---- Секция 2: Титулы характеристик (накопительная кривая) ---- */
el.createEl('h3', { text: '📜 Титулы характеристик (накопительно)' });
const totals = await computeTotalStats(this.store);
const tCfg = rewardsData.levelingConfig || DEFAULT_LEVELING_CONFIG;
for (const [key, label] of STATS) {
  const totalVal = totals[key] || 0;
  const lvl = statLevel(totalVal, tCfg);
  const title = getStatTitle(key, totalVal, tCfg);
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: `${label} · ур. ${lvl}` });
  row.createEl('span', { cls: 'lt-chip lt-title', text: title || '—' });
  row.createEl('span', { cls: 'lt-chip', text: `${totalVal} / ${statRequired(lvl + 1, tCfg)}` });
}

/* ---- Секция 3: Очки славы ---- */
el.createEl('h3', { text: '💰 Очки славы' });
const currencyRow = el.createDiv({ cls: 'lt-rewards-currency' });
currencyRow.createEl('span', { text: `Доступно: ${rewardsData.currency} 🪙` });
const doneGoals = (ref.goals || []).filter(g => g.status === 'achieved' || g.status === 'completed').length;
currencyRow.createEl('div', { cls: 'lt-description', text: `= уровни (${progress.level}) + выполненные цели (${doneGoals}) − трофеи (${rewardsData.inventory.length})` });

/* ---- Секция 4: Инвентарь трофеев ---- */
el.createEl('h3', { text: '🎒 Инвентарь трофеев' });
if (rewardsData.inventory.length === 0) {
  el.createEl('p', { text: 'Пока нет трофеев. Создайте трофей за очки славы!' });
} else {
  for (const trophy of rewardsData.inventory) {
    const row = el.createDiv({ cls: 'lt-row' });
    const icon = trophy.type === REWARD_TYPES.ACCESSORY ? '📿' : trophy.type === REWARD_TYPES.DECOR ? '🏺' : '📜';
    row.createEl('span', { text: `${icon} ${trophy.name}` });
    if (trophy.description) row.createEl('div', { cls: 'lt-description', text: trophy.description });
    const equippedSlot = rewardsData.slots.find(s => s.trophyId === trophy.id);
    const actions = row.createDiv({ cls: 'lt-actions' });
    if (trophy.type === REWARD_TYPES.ACCESSORY || trophy.type === REWARD_TYPES.DECOR) {
      if (equippedSlot) {
        actions.createEl('button', { text: 'Снять', cls: 'mod-warning' }).onclick = async () => {
          rewardsData.slots = rewardsData.slots.filter(s => s.trophyId !== trophy.id);
          this.store.rewardsData = rewardsData;
          await this.store.saveRewards();
          this.close();
          new RewardsModal(this.app, this.store).open();
        };
      } else {
        actions.createEl('button', { text: 'Надеть', cls: 'mod-cta' }).onclick = async () => {
          const slotType = trophy.type;
          const occupiedCount = rewardsData.slots.filter(s => s.type === slotType).length;
          if (occupiedCount >= rewardsData.unlockedSlots) { new Notice('Нет свободных слотов! Повышайте уровень или выполняйте цели.'); return; }
          rewardsData.slots.push({ id: 'slot_' + Date.now(), trophyId: trophy.id, trophyName: trophy.name, type: slotType });
          this.store.rewardsData = rewardsData;
          await this.store.saveRewards();
          this.close();
          new RewardsModal(this.app, this.store).open();
        };
      }
    }
    row.createEl('span', { cls: 'lt-chip', text: new Date(trophy.unlockedAt).toLocaleDateString() });
  }
}

/* ---- Секция 5: Активные слоты ---- */
el.createEl('h3', { text: `🎯 Слоты для трофеев (${rewardsData.slots.length}/${rewardsData.unlockedSlots})` });
if (rewardsData.slots.length === 0) {
  el.createEl('p', { text: 'Нет экипированных трофеев' });
} else {
  for (const slot of rewardsData.slots) {
    const slotRow = el.createDiv({ cls: 'lt-row' });
    const icon = slot.type === REWARD_TYPES.ACCESSORY ? '📿' : '🏺';
    slotRow.createEl('span', { text: `${icon} Слот: ${slot.trophyName || 'Пустой'}` });
  }
}
}
}

/* ---------- UI: ДАШБОРД ---------- */
class DashboardModal extends Modal {
constructor(app, store) { super(app); this.store = store; }
async onOpen() {
const el = this.contentEl; el.addClass('lt-dashboard');
const today = iso(new Date());
const ref = this.store.ref;
const day = await this.store.loadDay(today);
const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });
actionsBar.createEl('span', { text: '📊 Дашборд персонажа', style: 'font-weight: 700; font-size: 16px; flex: 1;' });
actionsBar.createEl('button', { text: '🗺️ Дорожные карты' }).onclick = () => this.store.openRoadmaps?.();
const exportButton = actionsBar.createEl('button', { text: '📤 Экспорт всех данных' });
exportButton.onclick = async () => {
  exportButton.disabled = true;
  try { await notifyExport(this.store); } finally { exportButton.disabled = false; }
};
el.createEl('h2', { text: 'Обзор прогресса', style: 'margin-top: 8px;' });
// свежие данные: дозрели ли цели, корректны ли валюта/слоты
await checkCompletedGoals(this.store);
await syncRewards(this.store);
// 0. Уровень и опыт игрока
const progress = await getPlayerProgress(this.store);
const xpCurrent = progress.totalXP - progress.required;
const xpNeeded = progress.next - progress.required;
const xpPct = xpNeeded > 0 ? Math.round((xpCurrent / xpNeeded) * 100) : 100;
const levelCard = el.createDiv({ cls: 'lt-dash-card lt-level-card' });
levelCard.createEl('div', { cls: 'lt-dash-title', text: `⚔️ Уровень ${progress.level} — ${progress.name}` });
levelCard.createEl('div', { cls: 'lt-dash-value', text: `✨ ${progress.totalXP} XP` });
const xpBar = levelCard.createDiv({ cls: 'lt-bar' });
xpBar.createDiv({ cls: 'lt-bar-fill', attr: { style: `width:${xpPct}%` } });
levelCard.createEl('div', { cls: 'lt-dash-subtitle', text: `${xpCurrent}/${xpNeeded} XP до уровня ${progress.level + 1}` });
el.createEl('button', { text: '🏆 Награды и титулы', cls: 'mod-cta' }).onclick = () => { new RewardsModal(this.app, this.store).open(); };
// Настройки прогрессии уровней
el.createEl('h3', { text: '⚙️ Настройки прогрессии' });
const configForm = el.createDiv({ cls: 'lt-form' });
const formulaSelect = configForm.createEl('select', { cls: 'lt-big-select' });
const savedConfig = this.store.rewardsData.levelingConfig || DEFAULT_LEVELING_CONFIG;
formulaSelect.createEl('option', { value: 'linear', text: 'Линейная (легко)', selected: savedConfig.formula === 'linear' });
formulaSelect.createEl('option', { value: 'quadratic', text: 'Квадратичная (средне)', selected: savedConfig.formula === 'quadratic' });
formulaSelect.createEl('option', { value: 'exponential', text: 'Экспоненциальная (сложно)', selected: savedConfig.formula === 'exponential' });
const baseXPInput = configForm.createEl('input', { type: 'number', placeholder: 'Базовый XP', value: savedConfig.baseXP, cls: 'lt-big-input' });
const growthInput = configForm.createEl('input', { type: 'number', placeholder: 'Коэф. роста', value: savedConfig.growthFactor, step: '0.1', cls: 'lt-big-input' });
const gloryPerLevelInput = configForm.createEl('input', { type: 'number', placeholder: 'Очков славы за уровень', value: savedConfig.gloryPerLevel, cls: 'lt-big-input' });
const statBaseInput = configForm.createEl('input', { type: 'number', placeholder: 'Титулы: база', value: savedConfig.statBase ?? 10, step: '1', cls: 'lt-big-input' });
const statPowerInput = configForm.createEl('input', { type: 'number', placeholder: 'Титулы: степень', value: savedConfig.statPower ?? 1.8, step: '0.1', cls: 'lt-big-input' });
configForm.createEl('button', { text: 'Применить настройки', cls: 'mod-cta' }).onclick = async () => {
  this.store.rewardsData.levelingConfig = {
    formula: formulaSelect.value,
    baseXP: parseInt(baseXPInput.value) || 100,
    growthFactor: parseFloat(growthInput.value) || 1.5,
    gloryPerLevel: parseInt(gloryPerLevelInput.value) || 1,
    statBase: parseFloat(statBaseInput.value) || 10,
    statPower: parseFloat(statPowerInput.value) || 1.8
  };
  await this.store.saveRewards();
  new Notice(`Прогрессия обновлена: ${formulaSelect.value}, база ${this.store.rewardsData.levelingConfig.baseXP} XP`);
  await syncRewards(this.store); // уровень/валюта/слоты сразу по новой формуле
  this.close();
  new DashboardModal(this.app, this.store).open();
};
// 1. Сводка дня
const c = dayCompletion(ref, day);
const r = computeDayStats(ref, day);
el.createEl('h3', { text: 'Сегодня' });
const todayCard = el.createDiv({ cls: 'lt-dash-card' });
todayCard.createEl('div', { cls: 'lt-dash-title', text: `Выполнение привычек` });
todayCard.createEl('div', { cls: 'lt-dash-value', text: `${c.pct}% (${c.done}/${c.total})` });
const statsCard = el.createDiv({ cls: 'lt-dash-card' });
statsCard.createEl('div', { cls: 'lt-dash-title', text: 'Текущие статы' });
statsCard.createEl('div', { cls: 'lt-dash-value', text: fmtStats(r.stats) });
el.createEl('button', { text: 'Открыть полный трекер дня', cls: 'mod-cta' }).onclick = () => { this.close(); new DayModal(this.app, this.store, today).open(); };
// 2. Навыки (суммарно за всё время)
el.createEl('h3', { text: '📈 Навыки' });
const allDays = await this.store.listDays();
const hoursMap = {};
for (const d of allDays) {
  const dData = await this.store.loadDay(d);
  for (const sk of ref.skills) hoursMap[sk.id] = (hoursMap[sk.id] || 0) + LifeTrackerRoadmaps.skillHoursForDay(sk, dData);
}
for (const sk of ref.skills.slice(0, 5)) {
  const h = hoursMap[sk.id] || 0;
  const lv = skillLevel(h);
  const row = el.createDiv({ cls: 'lt-row' });
  row.createEl('span', { cls: 'lt-name', text: sk.name });
  row.createEl('span', { cls: 'lt-chip', text: `${lv.name} (${fmtH(h)})` });
  const bar = row.createDiv({ cls: 'lt-bar' });
  bar.createDiv({ cls: 'lt-bar-fill', attr: { style: `width:${skillProgress(h)}%` } });
}
// 3. Активные цели
const activeGoals = ref.goals.filter(g => g.status === 'active');
if (activeGoals.length > 0) {
  el.createEl('h3', { text: '🎯 Активные цели' });
  for (const g of activeGoals.slice(0, 3)) {
    const p = await goalProgress(this.store, g, today);
    const pct = Math.min(100, Math.round((p / g.targetValue) * 100));
    const row = el.createDiv({ cls: 'lt-row' });
    row.createEl('span', { cls: 'lt-name', text: g.name });
    row.createEl('span', { cls: 'lt-chip', text: `${pct}%` });
    const bar = row.createDiv({ cls: 'lt-bar' });
    bar.createDiv({ cls: 'lt-bar-fill', attr: { style: `width:${pct}%` } });
  }
}
// 4. Последние достижения
const achs = (ref.achievements || []).slice(-3).reverse();
if (achs.length > 0) {
  el.createEl('h3', { text: '🏆 Последние достижения' });
  for (const a of achs) {
    const card = el.createDiv({ cls: 'lt-dash-card' });
    card.createEl('span', { text: `🏆 ${a.title}` });
    if (a.date) card.createEl('span', { cls: 'lt-chip', text: a.date });
  }
}
}
}

/* ---------- КУРСЫ / ИЗУЧЕНИЕ МАТЕРИАЛА ---------- */

/*
Механика:
- кусок курса изучается впервые: пользователь вписывает оценку от нейросети;
- за первое выполнение: +20 XP и +2 ИНТ;
- затем включаются повторения по Эббингаузу: +1 день, +3 дня, +7 дней;
- каждое повторение даёт примерно 33% закрепления куска;
- кусок считается полностью закреплённым после 3 повторений;
- прогресс курса = среднее прогрессов всех кусков.
*/

const REVIEW_INTERVALS = [1, 3, 7];
const COURSE_XP = XP_REWARDS.task; // 20 XP, как за выполненное дело
const COURSE_STAT_BONUS = 2; // +2 к ИНТ

function emptyCourse(name = 'Новый курс') {
  return {
    id: uid('c'),
    name,
    description: '',
    createdAt: iso(new Date()),
    pieces: []
  };
}

function emptyPiece(name = '') {
  return {
    id: uid('p'),
    name,
    content: '',
    grade: '',
    firstDoneAt: null,
    xpAwarded: false,
    reviews: []
  };
}

function pieceProgress(piece) {
  if (!piece || !piece.firstDoneAt) return 0;

  const totalReviews = REVIEW_INTERVALS.length || 1;
  const doneReviews = (piece.reviews || []).filter(r => r.doneAt).length;

  return Math.round((doneReviews / totalReviews) * 100);
}

function courseProgress(course) {
  const pieces = course?.pieces || [];
  if (!pieces.length) return 0;

  const sum = pieces.reduce((acc, p) => acc + pieceProgress(p), 0);
  return Math.round(sum / pieces.length);
}

function courseXPTotal(courses) {
  let xp = 0;

  for (const course of courses || []) {
    for (const piece of course.pieces || []) {
      if (piece.firstDoneAt) {
        xp += COURSE_XP;
      }
    }
  }

  return xp;
}

function computeCourseStats(courses) {
  const stats = zeroStats();

  for (const course of courses || []) {
    for (const piece of course.pieces || []) {
      if (piece.firstDoneAt) {
        stats.intelligence += COURSE_STAT_BONUS;
      }
    }
  }

  return stats;
}

function markPieceFirstDone(piece, date) {
  if (!piece || piece.firstDoneAt) return false;

  piece.firstDoneAt = date;
  piece.xpAwarded = true;

  piece.reviews = REVIEW_INTERVALS.map(offset => ({
    offsetDays: offset,
    dueDate: iso(addDays(parseISO(date), offset)),
    doneAt: null
  }));

  return true;
}

function markNextReview(piece, date) {
  if (!piece || !piece.firstDoneAt) return false;

  const review = (piece.reviews || []).find(r => !r.doneAt);
  if (!review) return false;

  review.doneAt = date;
  return true;
}

function pieceDueToday(piece, today) {
  if (!piece.firstDoneAt) return false;

  return (piece.reviews || []).some(r => !r.doneAt && r.dueDate <= today);
}

function courseDueCount(course, today) {
  return (course?.pieces || []).filter(p => pieceDueToday(p, today)).length;
}

function findCourse(store, courseId) {
  return (store.coursesData?.courses || []).find(c => c.id === courseId);
}

function findPiece(course, pieceId) {
  return (course?.pieces || []).find(p => p.id === pieceId);
}

/* ---------- UI: список курсов ---------- */

class CoursesModal extends Modal {
  constructor(app, store) {
    super(app);
    this.store = store;
  }

  onOpen() {
    this.render();
  }

  async render() {
    await checkCompletedGoals(this.store);

    const el = this.contentEl;
    el.empty();
    el.addClass('lt');

    const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });

    actionsBar.createEl('span', {
      text: '🎓 Курсы',
      style: 'font-weight:700;font-size:16px;flex:1;'
    });

    actionsBar.createEl('button', {
      text: '+ курс',
      cls: 'mod-cta'
    }).onclick = () => {
      const course = emptyCourse();
      this.store.coursesData.courses.push(course);
      this.store.saveCourses();
      this.close();
      new CourseDetailModal(this.app, this.store, course.id).open();
    };

    el.createEl('h2', {
      text: 'Изучение материала',
      style: 'margin-top:8px;'
    });

    const courses = this.store.coursesData?.courses || [];
    const today = iso(new Date());

    if (!courses.length) {
      el.createDiv({
        cls: 'lt-notice',
        text: 'Пока нет курсов. Создай первый курс.'
      });
      return;
    }

    for (const course of courses) {
      const progress = courseProgress(course);
      const dueToday = courseDueCount(course, today);

      const row = el.createDiv({ cls: 'lt-row' });
      row.style.cursor = 'pointer';

      row.onclick = () => {
        this.close();
        new CourseDetailModal(this.app, this.store, course.id).open();
      };

      row.createEl('span', {
        cls: 'lt-name',
        text: course.name || '(без имени)'
      });

      row.createEl('span', {
        cls: 'lt-chip',
        text: `${(course.pieces || []).length} кусков`
      });

      if (dueToday > 0) {
        row.createEl('span', {
          cls: 'lt-chip',
          text: `🔁 сегодня: ${dueToday}`
        });
      }

      const bar = row.createDiv({ cls: 'lt-bar' });
      bar.createDiv({
        cls: 'lt-bar-fill',
        attr: { style: `width:${progress}%` }
      });

      row.createEl('span', {
        cls: 'lt-chip',
        text: `${progress}%`
      });

      const del = row.createEl('button', { text: '🗑' });

      del.onclick = (e) => {
        e.stopPropagation();

        if (del.dataset.arm) {
          this.store.coursesData.courses = this.store.coursesData.courses.filter(c => c.id !== course.id);
          this.store.saveCourses();
          this.render();
        } else {
          del.dataset.arm = '1';
          del.setText('точно?');
          del.addClass('lt-danger');

          setTimeout(() => {
            if (del.isConnected) {
              del.setText('🗑');
              delete del.dataset.arm;
              del.removeClass('lt-danger');
            }
          }, 2500);
        }
      };
    }
  }
}

/* ---------- UI: курс целиком ---------- */

class CourseDetailModal extends Modal {
  constructor(app, store, courseId) {
    super(app);
    this.store = store;
    this.courseId = courseId;
  }

  onOpen() {
    this.render();
  }

  render() {
    const app = this.app;
    const store = this.store;
    const course = findCourse(store, this.courseId);

    if (!course) {
      this.close();
      return;
    }

    const el = this.contentEl;
    el.empty();
    el.addClass('lt');

    const today = iso(new Date());
    const progress = courseProgress(course);
    const totalPieces = (course.pieces || []).length;
    const donePieces = (course.pieces || []).filter(p => pieceProgress(p) >= 100).length;
    const firstDoneCount = (course.pieces || []).filter(p => p.firstDoneAt).length;
    const dueToday = courseDueCount(course, today);

    const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });

    actionsBar.createEl('span', {
      text: `🎓 ${course.name || '(без имени)'}`,
      style: 'font-weight:700;font-size:16px;flex:1;'
    });

    actionsBar.createEl('button', {
      text: '← Курсы'
    }).onclick = () => {
      this.close();
      new CoursesModal(app, store).open();
    };

    actionsBar.createEl('button', {
      text: '✎ Курс'
    }).onclick = () => {
      new CourseEditModal(app, store, course.id, () => this.render()).open();
    };

    actionsBar.createEl('button', {
      text: '+ кусок',
      cls: 'mod-cta'
    }).onclick = () => {
      const piece = emptyPiece(`Кусок ${(course.pieces || []).length + 1}`);
      course.pieces.push(piece);
      store.saveCourses();
      this.close();
      new PieceModal(app, store, course.id, piece.id).open();
    };

    el.createEl('h2', {
      text: 'Курс',
      style: 'margin-top:8px;'
    });

    if (course.description) {
      el.createDiv({
        cls: 'lt-notice',
        text: course.description
      });
    }

    el.createDiv({
      cls: 'lt-big'
    }).setText(
      `📈 Прогресс курса: ${progress}% · изучено ${firstDoneCount}/${totalPieces} · закреплено ${donePieces}/${totalPieces}`
    );

    if (dueToday > 0) {
      el.createDiv({
        cls: 'lt-notice',
        text: `🔁 Сегодня нужно повторить кусков: ${dueToday}`
      });
    }

    const bar = el.createDiv({ cls: 'lt-bar' });
    bar.style.height = '12px';
    bar.style.margin = '8px 0';
    bar.createDiv({
      cls: 'lt-bar-fill',
      attr: { style: `width:${progress}%` }
    });

    el.createEl('h3', { text: 'Куски курса' });

    if (!course.pieces.length) {
      el.createDiv({ text: '— пусто —' });
      return;
    }

    for (const piece of course.pieces) {
      const piecePercent = pieceProgress(piece);
      const due = pieceDueToday(piece, today);

      const row = el.createDiv({ cls: 'lt-row' });

      let icon = '🆕';
      if (!piece.firstDoneAt) icon = '🆕';
      else if (piecePercent >= 100) icon = '✅';
      else if (due) icon = '🔁';
      else icon = '📖';

      row.createEl('span', {
        cls: 'lt-chip',
        text: icon
      });

      const nameSpan = row.createEl('span', {
        cls: 'lt-name',
        text: piece.name || '(без имени)'
      });
      nameSpan.style.cursor = 'pointer';
      nameSpan.onclick = () => {
        this.close();
        new PieceModal(app, store, course.id, piece.id).open();
      };

      if (piece.grade) {
        row.createEl('span', {
          cls: 'lt-chip',
          text: `оценка: ${piece.grade}`
        });
      }

      const pieceBar = row.createDiv({ cls: 'lt-bar' });
      pieceBar.createDiv({
        cls: 'lt-bar-fill',
        attr: { style: `width:${piecePercent}%` }
      });

      row.createEl('span', {
        cls: 'lt-chip',
        text: `${piecePercent}%`
      });

      row.createEl('button', {
        text: '📖'
      }).onclick = () => {
        this.close();
        new PieceModal(app, store, course.id, piece.id).open();
      };

      if (!piece.firstDoneAt) {
        row.createEl('button', {
          text: '✅',
          cls: 'mod-cta'
        }).onclick = () => {
          this.close();
          new PieceModal(app, store, course.id, piece.id).open();
        };
      } else if (piecePercent < 100) {
        row.createEl('button', {
          text: '🔁'
        }).onclick = () => {
          if (markNextReview(piece, today)) {
            store.saveCourses();
            new Notice('Повторение отмечено');
            this.render();
          }
        };
      }

      const del = row.createEl('button', { text: '🗑' });

      del.onclick = () => {
        if (del.dataset.arm) {
          course.pieces = course.pieces.filter(p => p.id !== piece.id);
          store.saveCourses();
          this.render();
        } else {
          del.dataset.arm = '1';
          del.setText('точно?');
          del.addClass('lt-danger');

          setTimeout(() => {
            if (del.isConnected) {
              del.setText('🗑');
              delete del.dataset.arm;
              del.removeClass('lt-danger');
            }
          }, 2500);
        }
      };
    }
  }
}

/* ---------- UI: редактирование курса ---------- */

class CourseEditModal extends Modal {
  constructor(app, store, courseId, onSaved) {
    super(app);
    this.store = store;
    this.onSaved = onSaved;
    this.isNew = !courseId;

    if (this.isNew) {
      this.item = emptyCourse();
    } else {
      const course = findCourse(store, courseId);
      this.item = course ? JSON.parse(JSON.stringify(course)) : emptyCourse();
    }
  }

  onOpen() {
    const el = this.contentEl;
    el.addClass('lt');

    const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });

    actionsBar.createEl('span', {
      text: this.isNew ? 'Новый курс' : 'Правка курса',
      style: 'font-weight:700;font-size:16px;flex:1;'
    });

    actionsBar.createEl('button', {
      text: 'Сохранить ✓',
      cls: 'mod-cta'
    }).onclick = async () => {
      if (!this.item.name) {
        new Notice('Нужно название курса');
        return;
      }

      if (this.isNew) {
        this.store.coursesData.courses.push(this.item);
      } else {
        const index = this.store.coursesData.courses.findIndex(c => c.id === this.item.id);
        if (index >= 0) {
          this.store.coursesData.courses[index] = this.item;
        }
      }

      await this.store.saveCourses();

      if (this.onSaved) this.onSaved();
      this.close();
    };

    el.createEl('h2', {
      text: 'Курс',
      style: 'margin-top:8px;'
    });

    const F = new FormBuilder(el, this.item, this.store);
    F.text('name', 'Название');
    F.text('description', 'Описание');
  }
}

/* ---------- UI: кусок курса ---------- */

class PieceModal extends Modal {
  constructor(app, store, courseId, pieceId) {
    super(app);
    this.store = store;
    this.courseId = courseId;
    this.pieceId = pieceId;
  }

  onOpen() {
    this.render();
  }

  render() {
    const app = this.app;
    const store = this.store;
    const course = findCourse(store, this.courseId);
    const piece = course ? findPiece(course, this.pieceId) : null;

    if (!course || !piece) {
      this.close();
      return;
    }

    const el = this.contentEl;
    el.empty();
    el.addClass('lt');

    const today = iso(new Date());
    const progress = pieceProgress(piece);

    const actionsBar = el.createDiv({ cls: 'lt-actions-bar' });

    actionsBar.createEl('span', {
      text: `📄 ${piece.name || 'Кусок курса'}`,
      style: 'font-weight:700;font-size:16px;flex:1;'
    });

    actionsBar.createEl('button', {
      text: '← Курс'
    }).onclick = async () => {
      await this.saveInputs();
      this.close();
      new CourseDetailModal(app, store, this.courseId).open();
    };

    actionsBar.createEl('button', {
      text: '💾 Сохранить',
      cls: 'mod-cta'
    }).onclick = async () => {
      await this.saveInputs();
      new Notice('Сохранено ✓');
      this.render();
    };

    el.createEl('h2', {
      text: 'Кусок курса',
      style: 'margin-top:8px;'
    });

    const bar = el.createDiv({ cls: 'lt-bar' });
    bar.style.height = '10px';
    bar.style.margin = '8px 0';
    bar.createDiv({
      cls: 'lt-bar-fill',
      attr: { style: `width:${progress}%` }
    });

    const progressLabel = el.createDiv({
      cls: 'lt-chip',
      text: `Прогресс закрепления: ${progress}%`
    });
    progressLabel.style.marginBottom = '8px';

    el.createEl('h3', { text: 'Название' });

    this.nameInput = el.createEl('input', {
      type: 'text',
      cls: 'lt-wide'
    });
    this.nameInput.value = piece.name || '';

    el.createEl('h3', { text: 'Теория и задания' });

    this.contentInput = el.createEl('textarea', {
      cls: 'lt-comment'
    });
    this.contentInput.value = piece.content || '';
    this.contentInput.style.minHeight = '160px';

    el.createEl('h3', { text: 'Оценка от нейросети' });

    this.gradeInput = el.createEl('input', {
      type: 'text',
      cls: 'lt-wide',
      placeholder: 'Например: 8/10, зачёт, хорошо и т.п.'
    });
    this.gradeInput.value = piece.grade || '';

    el.createEl('h3', { text: 'Прогресс' });

    if (!piece.firstDoneAt) {
      const btn = el.createEl('button', {
        text: '✅ Отметить первое выполнение (+20 XP, +2 ИНТ)',
        cls: 'mod-cta'
      });

      btn.onclick = async () => {
        await this.saveInputs();

        if (!(piece.grade || '').toString().trim()) {
          new Notice('Сначала впиши оценку от нейросети');
          return;
        }

        if (markPieceFirstDone(piece, today)) {
          await store.saveCourses();
          await syncRewards(store);

          new Notice('🎉 Кусок изучен! +20 XP, +2 ИНТ. Назначены повторения: +1, +3, +7 дней.');

          this.render();
        }
      };
    } else {
      el.createDiv({
        cls: 'lt-notice',
        text: `Первое выполнение: ${piece.firstDoneAt}. Повторения по Эббингаузу: +1 день, +3 дня, +7 дней.`
      });

      for (const review of (piece.reviews || [])) {
        const row = el.createDiv({ cls: 'lt-row' });

        row.createEl('span', {
          cls: 'lt-name',
          text: `Повторение через ${review.offsetDays} дн.`
        });

        row.createEl('span', {
          cls: 'lt-chip',
          text: `план: ${review.dueDate}`
        });

        if (review.doneAt) {
          row.createEl('span', {
            cls: 'lt-chip',
            text: `✓ выполнено ${review.doneAt}`
          });
        } else {
          const overdue = review.dueDate < today;

          const btn = row.createEl('button', {
            text: overdue ? 'Отметить повторение (просрочено)' : 'Отметить повторение',
            cls: 'mod-cta'
          });

          btn.onclick = async () => {
            await this.saveInputs();

            review.doneAt = today;
            await store.saveCourses();

            new Notice('Повторение отмечено');
            this.render();
          };
        }
      }

      if (progress >= 100) {
        el.createDiv({
          cls: 'lt-notice',
          text: '🏆 Кусок закреплён полностью!'
        });
      }
    }
  }

  async saveInputs() {
    const store = this.store;
    const course = findCourse(store, this.courseId);
    const piece = course ? findPiece(course, this.pieceId) : null;

    if (!piece) return;

    if (this.nameInput) piece.name = this.nameInput.value;
    if (this.contentInput) piece.content = this.contentInput.value;
    if (this.gradeInput) piece.grade = this.gradeInput.value;

    await store.saveCourses();
  }
}

/* ---------- Плагин ---------- */
module.exports = class LifeTracker extends Plugin {
async onload() {
this.store = new Store(this.app);
await this.store.init();
const RoadmapsModal = LifeTrackerRoadmaps.createRoadmapModal(Modal, Notice);
this.store.openRoadmaps = () => new RoadmapsModal(this.app, this.store.roadmaps).open();
this.addRibbonIcon('map', 'LifeTracker: дорожные карты', this.store.openRoadmaps);
this.addCommand({ id: 'lt-roadmaps', name: 'LT: дорожные карты', callback: this.store.openRoadmaps });
// Adapter writes notify directly; Vault events cover edits made outside the plugin.
const metricsChanged = file => {
  if (file?.path === this.store.roadmaps.path()) { this.store.roadmaps.reload().then(() => this.store.roadmaps.invalidate()); return; }
  if (file?.path?.startsWith(this.store.base + '/') && file.path !== this.store.roadmaps.path() && !file.path.startsWith(this.store.base + '/exports/')) this.store.roadmaps.invalidate();
};
for (const event of ['create', 'modify', 'delete', 'rename']) this.registerEvent(this.app.vault.on(event, metricsChanged));
const today = () => iso(new Date());
this.addRibbonIcon('bar-chart', 'LifeTracker: день', () => new DayModal(this.app, this.store, today()).open());
this.addRibbonIcon('calendar-range', 'LifeTracker: неделя', () => new WeekModal(this.app, this.store, today()).open());
this.addRibbonIcon('gear', 'LifeTracker: справочники', () => new RefModal(this.app, this.store).open());
this.addRibbonIcon('check-square', 'LifeTracker: дела', () => new WorkItemsModal(this.app, this.store).open());
this.addRibbonIcon('layout-dashboard', 'LifeTracker: дашборд', () => new DashboardModal(this.app, this.store).open());
this.addCommand({ id: 'lt-day', name: 'LT: открыть сегодня', callback: () => new DayModal(this.app, this.store, today()).open() });
this.addCommand({ id: 'lt-week', name: 'LT: открыть неделю', callback: () => new WeekModal(this.app, this.store, today()).open() });
this.addCommand({ id: 'lt-ref', name: 'LT: справочники', callback: () => new RefModal(this.app, this.store).open() });
this.addCommand({ id: 'lt-work', name: 'LT: дела и идеи', callback: () => new WorkItemsModal(this.app, this.store).open() });
this.addCommand({ id: 'lt-dashboard', name: 'LT: открыть дашборд', callback: () => new DashboardModal(this.app, this.store).open() });
this.addCommand({ id: 'lt-export-all', name: 'LT: экспорт всех данных в JSON', callback: () => notifyExport(this.store) });

this.addRibbonIcon('book-open', 'LifeTracker: курсы', () => new CoursesModal(this.app, this.store).open());

this.addCommand({
  id: 'lt-courses',
  name: 'LT: открыть курсы',
  callback: () => new CoursesModal(this.app, this.store).open()
});

/* Код-блок ```lifetracker-day [дата] */
this.registerMarkdownCodeBlockProcessor('lifetracker-day', async (source, el, ctx) => {
const store = this.store, ref = store.ref;
let targetDate = source.trim() || iso(new Date());

/* Ближайший скролл-контейнер заметки — чтобы при перерисовке экран не уезжал вверх */
const getScroller = () => {
  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    try {
      const cs = getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(cs.overflow + cs.overflowY) && node.scrollHeight > node.clientHeight) return node;
    } catch (e) {}
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};
/* сохранение дня + фоновая проверка целей на 100% */
const saveNow = async () => { await store.saveDay(targetDate); checkCompletedGoals(store); };

const render = async () => {
el.empty();
const day = await store.loadDay(targetDate);
const c = dayCompletion(ref, day);
const r = computeDayStats(ref, day);
const k = dayKcal(ref, day);
const f = dayFinance(ref, day);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const bar = v => '▰'.repeat(v) + '▱'.repeat(10 - v);

/* ========== ПАНЕЛЬ 1: СТАТИЧНАЯ ASCII (справочная) ========== */
const ascii = el.createDiv({ cls: 'lt-ascii' });
const line = (text, cls) => ascii.createDiv({ cls: 'lt-ascii-line' + (cls ? ' ' + cls : ''), text });

/* --- НАВИГАЦИЯ ПО ДНЯМ: ◀ [дата] ▶ сегодня --- */
const nav = ascii.createDiv({ cls: 'lt-ascii-nav' });
const navBtn = (txt, fn) => {
  const b = nav.createEl('button', { cls: 'lt-ascii-btn', text: txt });
  b.addEventListener('click', ev => { ev.preventDefault(); fn(); });
  return b;
};
navBtn('◀', () => { targetDate = iso(addDays(parseISO(targetDate), -1)); rerender(); });
const dateInp = nav.createEl('input', { type: 'date', cls: 'lt-ascii-date' });
dateInp.value = targetDate;
dateInp.addEventListener('change', () => { if (dateInp.value) { targetDate = dateInp.value; rerender(); } });
navBtn('▶', () => { targetDate = iso(addDays(parseISO(targetDate), 1)); rerender(); });
navBtn('⌂ сегодня', () => { targetDate = iso(new Date()); rerender(); });

line(`┌─ ДЕНЬ · ${targetDate} · ${WD[(parseISO(targetDate).getDay() + 6) % 7]} · 🎯 ${c.pct}% (${c.done}/${c.total}) ─────`, 'lt-a-head');
const habitGroups = [
  { title: 'ОБЯЗАТЕЛЬНЫЕ ПРИВЫЧКИ', habits: ref.habits.filter(isRequiredHabit) },
  { title: 'ДОПОЛНИТЕЛЬНЫЕ ПРИВЫЧКИ', habits: ref.habits.filter(h => !isRequiredHabit(h)) }
];
const wH = Math.max(10, ...ref.habits.map(h => h.name.length)) + 1;
for (const group of habitGroups) {
line('│ ' + group.title, 'lt-a-sec');
if (!group.habits.length) line('│  —');
for (const h of group.habits) {
  const l = day.habitLogs.find(x => x.habitId === h.id);
  const streak = await habitStreak(store, h.id, targetDate);
  const eff = fmtStats(h.baseEffects);
  line(`│  [${l.done ? '✓' : ' '}] ${pad(h.name, wH)}${eff === '—' ? '' : eff + '  '}${fmtH(l.hours || 0)}${streak ? '  🔥' + streak : ''}`);
}
}
if (ref.substances.length) {
  line('│ ВЕЩЕСТВА', 'lt-a-sec');
  for (const s of ref.substances) {
    const l = day.substanceLogs.find(x => x.substanceId === s.id);
    line(`│  [${l.taken ? '✓' : ' '}] ${s.name}`);
  }
}
if (ref.activities.length) {
  line('│ АКТИВНОСТИ', 'lt-a-sec');
  for (const a of ref.activities) {
    const l = day.activityLogs.find(x => x.activityId === a.id);
    const kc = Math.round(a.kcalPerUnit * (+l.amount || 0));
    line(`│  ${pad(a.name + ' ×' + (+l.amount || 0), wH)}${kc ? '−' + kc + ' ккал' : ''}`);
  }
}
line('│ ЕДА', 'lt-a-sec');
line(`│  ${MEALS.map(([slot, lab]) => `${lab} ${(day.meals.find(m => m.slot === slot) || {}).kcal || 0}`).join(' · ')}  Σ ${k.eaten}`);
if (day.financeLogs.length) {
  line('│ ФИНАНСЫ', 'lt-a-sec');
  line(`│  ↓ ${f.income} · ↑ ${f.expense}  = ${f.balance >= 0 ? '+' : ''}${f.balance} ₽`);
}
line('│ СОСТОЯНИЕ', 'lt-a-sec');
const wS = Math.max(10, ...STATES.map(([, l]) => l.length)) + 1;
for (const [key, lab] of STATES) {
  const v = day.state[key] ?? 5;
  line(`│  ${pad(lab, wS)}${bar(v)} ${v}`);
}
if (day.comment) line(`│ ЗАМЕТКА  «${day.comment}»`, 'lt-a-com');
line(`│ ИТОГ  ${fmtStats(r.stats)}  ·  ккал ${k.balance >= 0 ? '+' : ''}${k.balance}  ·  ₽ ${f.balance >= 0 ? '+' : ''}${f.balance}${r.syn.length ? '  ·  синергии ' + r.syn.length + ' ✅' : ''}`, 'lt-a-total');
line('└' + '─'.repeat(46), 'lt-a-head');

/* ========== ПАНЕЛЬ 2: ИНТЕРАКТИВНАЯ (тач) ========== */
const touch = el.createDiv({ cls: 'lt-touch' });
touch.createEl('h4', { cls: 'lt-touch-title', text: '✏️ ЗАПОЛНИТЬ' });
const act = fn => async () => { fn(); await saveNow(); await rerender(); };
const bigBtn = (parent, txt, fn) => { const b = parent.createEl('button', { cls: 'lt-big-btn', text: txt }); b.onclick = act(fn); return b; };
const head = t => touch.createEl('h4', { text: t });

touch.createDiv({ cls: 'lt-chip', text: habitGateText(ref, day) });
for (const group of habitGroups) {
head(group.title);
if (!group.habits.length) touch.createDiv({ text: '—' });
for (const h of group.habits) {
  const l = day.habitLogs.find(x => x.habitId === h.id);
  const row = touch.createDiv({ cls: 'lt-touch-row' });
  const cb = row.createEl('input', { type: 'checkbox', cls: 'lt-big-check' });
  cb.checked = !!l.done;
  updateHabitControl(cb, ref, day, h);
  cb.onchange = act(() => { if (!setHabitDone(ref, day, h, cb.checked)) new Notice(habitGateText(ref, day)); });
  row.createEl('span', { cls: 'lt-touch-name', text: h.name });
}
}
if (ref.substances.length) {
  head('Вещества');
  for (const s of ref.substances) {
    const l = day.substanceLogs.find(x => x.substanceId === s.id);
    const row = touch.createDiv({ cls: 'lt-touch-row' });
    const cb = row.createEl('input', { type: 'checkbox', cls: 'lt-big-check' });
    cb.checked = !!l.taken;
    cb.onchange = act(() => { l.taken = cb.checked; });
    row.createEl('span', { cls: 'lt-touch-name', text: s.name });
  }
}
if (ref.activities.length) {
  head('Активности');
  for (const a of ref.activities) {
    const l = day.activityLogs.find(x => x.activityId === a.id);
    const row = touch.createDiv({ cls: 'lt-touch-row' });
    row.createEl('span', { cls: 'lt-touch-name', text: a.name });
    /* поле ввода как у калорий (вместо степперов − / +) */
    const inp = row.createEl('input', { type: 'number', cls: 'lt-big-input', attr: { inputmode: 'decimal', min: '0', step: 'any' } });
    inp.value = String(+l.amount || 0);
    const sub = row.createEl('span', { cls: 'lt-touch-sub', text: `−${Math.round(a.kcalPerUnit * (+l.amount || 0))} ккал` });
    inp.addEventListener('input', () => {
      l.amount = Math.max(0, +inp.value || 0);
      sub.setText(`−${Math.round(a.kcalPerUnit * l.amount)} ккал`);
    });
    inp.addEventListener('change', act(() => { l.amount = Math.max(0, +inp.value || 0); }));
  }
}
head('Еда (ккал)');
const mrow = touch.createDiv({ cls: 'lt-touch-meals' });
for (const [slot, lab] of MEALS) {
  const m = day.meals.find(x => x.slot === slot);
  const w = mrow.createDiv({ cls: 'lt-touch-meal' });
  w.createEl('span', { text: lab });
  const inp = w.createEl('input', { type: 'number', cls: 'lt-big-input', attr: { inputmode: 'numeric' } });
  inp.value = String(+m.kcal || 0);
  inp.onchange = act(() => { m.kcal = +inp.value || 0; });
}
head('Финансы (₽)');
for (let i = 0; i < day.financeLogs.length; i++) {
  const fin = day.financeLogs[i];
  const row = touch.createDiv({ cls: 'lt-touch-row' });
  const sel = row.createEl('select', { cls: 'lt-big-select' });
  for (const fc of ref.finCategories) {
    const o = sel.createEl('option', { value: fc.id, text: `${fc.type === 'income' ? '↓' : '↑'} ${fc.name}` });
    if (fc.id === fin.categoryId) o.selected = true;
  }
  sel.onchange = act(() => { fin.categoryId = sel.value; });
  const amt = row.createEl('input', { type: 'number', cls: 'lt-big-input', attr: { inputmode: 'decimal' } });
  amt.value = String(+fin.amount || 0);
  amt.onchange = act(() => { fin.amount = +amt.value || 0; });
  bigBtn(row, '✕', () => { day.financeLogs.splice(i, 1); });
}
const addB = touch.createEl('button', { cls: 'lt-big-btn lt-wide-btn', text: '+ операция' });
addB.onclick = act(() => {
  if (!ref.finCategories.length) { new Notice('Сначала добавь категории в Справочниках'); return; }
  day.financeLogs.push({ categoryId: ref.finCategories[0].id, amount: 0, note: '' });
});
head('Состояние (0–10)');
for (const [key, lab] of STATES) {
  const row = touch.createDiv({ cls: 'lt-touch-row' });
  row.createEl('span', { cls: 'lt-touch-name', text: lab });
  const step = row.createDiv({ cls: 'lt-touch-step' });
  bigBtn(step, '−', () => { day.state[key] = Math.max(0, (day.state[key] ?? 5) - 1); });
  step.createEl('span', { cls: 'lt-touch-val', text: String(day.state[key] ?? 5) });
  bigBtn(step, '+', () => { day.state[key] = Math.min(10, (day.state[key] ?? 5) + 1); });
}
head('Комментарий');
const ta = touch.createEl('textarea', { cls: 'lt-touch-comment', attr: { placeholder: 'комментарий дня…' } });
ta.value = day.comment || '';
ta.onchange = act(() => { day.comment = ta.value; });
touch.createDiv({ cls: 'lt-touch-hint', text: '💾 автосохранение после каждого изменения' });
};

/* Перерисовка с сохранением позиции скролла (фикс «экран уезжает вверх» на iOS) */
const rerender = async () => {
  const scroller = getScroller();
  const y = scroller ? scroller.scrollTop : 0;
  await render();
  requestAnimationFrame(() => {
    if (scroller) scroller.scrollTop = y;
    setTimeout(() => { if (scroller) scroller.scrollTop = y; }, 80);
  });
};

render();
});
}
};
