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
  for (const [kind, col, source] of [['task', 'tasks', 'Дела'], ['idea', 'ideas', 'Идеи']]) {
    scalar(kind + '.status', 'Количество элементов с выбранным статусом', source, 'шт.', col, (ctx, c) => entities(ctx, col).filter(x => selected(c, x.id) && x.status === (c.status || 'done')).length, { statuses: ['backlog', 'in_progress', 'done', 'dropped'] });
    eventMetric(kind + '.completed', 'Завершённые ' + (kind === 'task' ? 'дела' : 'идеи'), source, 'шт.', col, (ctx, c) => {
      const seen = new Map();
      for (const item of entities(ctx, col)) if (selected(c, item.id) && item.status === 'done') {
        const date = item.completedDate || item.doneAt;
        if (isDate(date)) seen.set(item.id, { id: item.id, date, value: 1 });
      }
      for (const day of ctx.days) for (const item of day.completedWorkItems || []) if (item.kind === kind && selected(c, item.id) && !seen.has(item.id) && !ctx.work.items.some(current => current.id === item.id && current.status !== 'done')) seen.set(item.id, { id: item.id, date: day.date, value: 1 });
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
  constructor(store, helpers = {}, clock = () => new Date()) { this.helpers = helpers; this.store = store; this.registry = createRegistry(helpers); this.clock = clock; this.listeners = new Set(); this.queue = Promise.resolve(); }
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
  setTaskDone(taskId, done) {
    const job = this.queue.then(async () => {
      const ctx = await this.context(), work = clone(ctx.work);
      const task = work.items.find(item => item.id === taskId && item.kind === 'task');
      if (!task) throw new Error('Дело удалено или недоступно');
      if (done && task.status !== 'done' && task.minStatRequirement && (!this.helpers.canCompleteTask || !await this.helpers.canCompleteTask(task))) throw new Error('Не выполнено требование к характеристике для этого дела');
      if (done && task.status !== 'done') {
        task.status = 'done'; task.doneAt = ctx.today; task.completedDate = ctx.today;
      } else if (!done && task.status === 'done') {
        task.status = 'in_progress'; delete task.doneAt; delete task.completedDate;
      } else return;
      const previous = this.store.work;
      this.store.work = work;
      try { await this.store.saveWorkItems(); }
      catch (error) { this.store.work = previous; throw error; }
      this.invalidate();
    });
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
        this.renderResult(box, level.conditions, state.result, ctx, state.status !== 'completed');
        if (state.status === 'locked') box.createDiv({ cls: 'lt-notice', text: i ? 'Откроется после выполнения условий и подтверждения завершения предыдущего уровня. Прогресс ещё не засчитывается.' : 'Откроется после запуска карты.' });
        if (state.status === 'active') box.createDiv({ cls: 'lt-description', text: 'Выполните логическую структуру условий. Для открытия следующего уровня потребуется подтверждение.' });
        if (['active', 'ready'].includes(state.status)) this.button(box, 'Завершить уровень', () => this.service.complete(map.id, level.id), state.status !== 'ready' || map.archived);
      }
    }
    renderResult(el, node, result, ctx, editableTasks = true) {
      if (node.kind === 'group') {
        const group = el.createDiv({ cls: 'lt-rm-group' });
        group.createDiv({ text: (node.op === 'AND' ? 'Все условия (AND)' : 'Любое условие (OR)') + (result?.met ? ' ✓' : '') });
        node.children.forEach((child, i) => this.renderResult(group, child, result?.children?.[i], ctx, editableTasks)); return;
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
      if (editableTasks && node.metric.startsWith('task.')) {
        const tasks = ctx.work.items.filter(item => item.kind === 'task' && (!node.entityId || item.id === node.entityId));
        for (const task of tasks) {
          const label = row.createEl('label', { cls: 'lt-row' });
          const check = label.createEl('input', { type: 'checkbox' }); check.checked = task.status === 'done';
          label.createEl('span', { text: task.name || '(без названия)' });
          check.onchange = async () => {
            if (this.busy) { check.checked = task.status === 'done'; return; }
            this.busy = true; check.disabled = true;
            try { await this.service.setTaskDone(task.id, check.checked); }
            catch (error) { new Notice(error.message, 10000); }
            finally { this.busy = false; await this.render(); }
          };
        }
        if (!result) row.createDiv({ cls: 'lt-description', text: 'Отметка меняет само дело. Выполнение до активации уровня не засчитывается в режим «После активации».' });
      }
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
    renderTaskPicker(parent, group) {
      const box = parent.createDiv({ cls: 'lt-rm-card' });
      box.createEl('strong', { text: 'Выберите дела для уровня' });
      const selected = new Set();
      const tasks = this.ctx.work.items.filter(item => item.kind === 'task');
      if (!tasks.length) box.createEl('p', { text: 'Дел пока нет. Добавьте их в разделе «Дела и идеи».' });
      for (const task of tasks) {
        const label = box.createEl('label', { cls: 'lt-row' });
        const check = label.createEl('input', { type: 'checkbox' });
        label.createEl('span', { text: task.name || '(без названия)' });
        check.onchange = () => { if (check.checked) selected.add(task.id); else selected.delete(task.id); };
      }
      this.button(box, 'Добавить выбранные дела', () => {
        for (const taskId of selected) {
          if (group.children.some(c => c.kind === 'condition' && c.metric === 'task.completed' && c.entityId === taskId)) continue;
          group.children.push({ id: id('condition'), kind: 'condition', name: '', metric: 'task.completed', entityId: taskId, method: 'event', mode: 'since_activation', operator: '>=', target: 1 });
        }
        this.renderEditor();
      });
      this.button(box, 'Отмена выбора', () => this.renderEditor());
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
        this.button(group, '+ Дела', () => this.renderTaskPicker(group, node));
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
