/* LifeTracker v0.2.6 · plain JS · офлайн */
const { Plugin, Modal, Notice, debounce } = require('obsidian');

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
}
dayPath(d) { return this.base + '/journal/' + d + '.json'; }
workPath() { return this.base + '/workItems.json'; }
rewardsPath() { return this.base + '/rewards.json'; }
coursesPath() { return this.base + '/courses.json'; }
async saveCourses() {
  await this.a.write(this.coursesPath(), JSON.stringify(this.coursesData, null, 2));
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
async saveDay(date) { if (this.cache[date]) await this.a.write(this.dayPath(date), JSON.stringify(this.cache[date], null, 2)); }
async saveRef() { await this.a.write(this.base + '/reference.json', JSON.stringify(this.ref, null, 2)); this.cache = {}; }
async saveWorkItems() { await this.a.write(this.workPath(), JSON.stringify(this.work, null, 2)); }
async saveRewards() { await this.a.write(this.rewardsPath(), JSON.stringify(this.rewardsData, null, 2)); }
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
for (const sk of ref.skills) { let t = 0; for (const hr of sk.habitRefs || []) for (const d of days) { const l = d.habitLogs.find(x => x.habitId === hr.habitId); if (l && l.hours) t += l.hours * (hr.weight ?? 1); } out[sk.id] = t; }
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
    if (sk) for (const hr of sk.habitRefs || []) { const l = day.habitLogs.find(x => x.habitId === hr.habitId); if (l && l.hours) sum += l.hours * (hr.weight ?? 1); }
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
async function syncRewards(store) {
await store.loadRewards();
const rd = store.rewardsData;
const cfg = rd.levelingConfig || DEFAULT_LEVELING_CONFIG;
const progress = await getPlayerProgress(store);
const doneGoals = (store.ref.goals || []).filter(g => g.status === 'achieved' || g.status === 'completed').length;
const spent = (rd.inventory || []).length; // каждый трофей стоит 1 🪙
const earned = progress.level * (cfg.gloryPerLevel ?? 1) + doneGoals;
rd.currency = Math.max(0, earned - spent);
rd.unlockedSlots = progress.level + doneGoals;
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
for (const h of ref.habits) {
  const l = day.habitLogs.find(x => x.habitId === h.id);
  const row = el.createDiv({ cls: 'lt-row' });
  const cb = row.createEl('input', { type: 'checkbox' }); cb.checked = !!l.done;
  cb.addEventListener('change', () => { l.done = cb.checked; refresh(); });
  row.createEl('span', { cls: 'lt-name', text: h.name });
  row.createEl('span', { cls: 'lt-chip', text: fmtStats(h.baseEffects) });
  const sk = row.createEl('span', { cls: 'lt-chip' });
  habitStreak(store, h.id, date).then(n => sk.setText(n ? `🔥${n}` : ''));
}
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
case 'habits': return { id: uid('h'), name: '', baseEffects: zeroStats() };
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
case 'habits': return fmtStats(it.baseEffects);
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
    row.createEl('button', { text: '✎' }).onclick = () => new EditModal(this.app, this.store, key, item, () => this.render()).open();
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
  for (const sk of ref.skills) for (const hr of sk.habitRefs || []) {
    const l = day.habitLogs.find(x => x.habitId === hr.habitId);
    if (l && l.hours) hoursMap[sk.id] = (hoursMap[sk.id] || 0) + l.hours * (hr.weight ?? 1);
  }
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

/* ---------- конструктор форм ---------- */
class FormBuilder {
constructor(el, item, store) { this.el = el; this.item = item; this.store = store; }
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
const w = r.createEl('input', { type: 'number', cls: 'lt-input', attr: { step: '0.1', min: '0', max: '1' } });
w.value = String(hr.weight ?? 1);
w.addEventListener('input', () => { hr.weight = +w.value || 0; });
r.createEl('button', { text: '✕' }).onclick = () => { this.item[k].splice(idx, 1); render(); };
});
wrap.createEl('button', { text: '+ связь с привычкой', cls: 'lt-add' }).onclick = () => { this.item[k].push({ habitId: this.store.ref.habits[0]?.id || '', weight: 1 }); render(); };
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
  case 'habits': F.text('name', 'Название'); F.stats('baseEffects', 'Эффекты за выполнение'); break;
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
  for (const sk of ref.skills) {
    for (const hr of sk.habitRefs || []) {
      const l = dData.habitLogs.find(x => x.habitId === hr.habitId);
      if (l && l.hours) hoursMap[sk.id] = (hoursMap[sk.id] || 0) + l.hours * (hr.weight ?? 1);
    }
  }
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
line('│ ПРИВЫЧКИ', 'lt-a-sec');
const wH = Math.max(10, ...ref.habits.map(h => h.name.length)) + 1;
for (const h of ref.habits) {
  const l = day.habitLogs.find(x => x.habitId === h.id);
  const streak = await habitStreak(store, h.id, targetDate);
  const eff = fmtStats(h.baseEffects);
  line(`│  [${l.done ? '✓' : ' '}] ${pad(h.name, wH)}${eff === '—' ? '' : eff + '  '}${fmtH(l.hours || 0)}${streak ? '  🔥' + streak : ''}`);
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

head('Привычки');
for (const h of ref.habits) {
  const l = day.habitLogs.find(x => x.habitId === h.id);
  const row = touch.createDiv({ cls: 'lt-touch-row' });
  const cb = row.createEl('input', { type: 'checkbox', cls: 'lt-big-check' });
  cb.checked = !!l.done;
  cb.onchange = act(() => { l.done = cb.checked; });
  row.createEl('span', { cls: 'lt-touch-name', text: h.name });
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