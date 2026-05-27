const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const RECIPES_FILE  = path.join(__dirname, 'data', 'recipes.json');
const PLAN_FILE     = path.join(__dirname, 'data', 'plan.json');
const CUSTOM_FILE   = path.join(__dirname, 'data', 'custom.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

// ── SETTINGS (API key stored here) ──
function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return { api_key: '' };
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return { api_key: '' }; }
}
function writeSettings(d) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(d, null, 2)); }

// Key priority: env variable > saved in settings file
function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || readSettings().api_key || '';
}


// ── INGREDIENT NAME NORMALIZATION (for shopping aggregation) ──
const INGR_CANONICAL = {
  'сливочного масла':'Масло сливочное','сливочное масло':'Масло сливочное',
  'масла':'Масло сливочное','масло':'Масло сливочное',
  'оливкового масла':'Масло оливковое','оливковое масло':'Масло оливковое',
  'кунжутного масла':'Масло кунжутное',
  'молока':'Молоко','молоко':'Молоко',
  'сливок':'Сливки','яиц':'Яйца','яйца':'Яйца','яйцо':'Яйца',
  'желтки':'Яичные желтки','желток':'Яичные желтки',
  'зубчиков чеснока':'Чеснок','зубчика чеснока':'Чеснок','зубчик чеснока':'Чеснок','чеснока':'Чеснок',
  'луковицы':'Лук репчатый','луковица':'Лук репчатый','лука':'Лук репчатый',
  'муки':'Мука','мука':'Мука',
  'сахара':'Сахар','пармезана':'Пармезан','моцареллы':'Моцарелла',
  'томатов':'Помидоры','помидоров':'Помидоры',
  'картофеля':'Картофель','моркови':'Морковь',
  'говяжьего фарша':'Говяжий фарш','соевого соуса':'Соевый соус',
  'мёда':'Мёд','горчицы':'Горчица','лимона':'Лимон','лайма':'Лайм',
  'имбиря':'Имбирь свежий','риса':'Рис','пасты':'Паста',
  'панировочных сухарей':'Панировочные сухари','панко сухарей':'Панко',
  'кукурузного крахмала':'Кукурузный крахмал','крахмала':'Кукурузный крахмал',
};
function normalizeIngrName(name) {
  if (!name) return '';
  const low = name.toLowerCase().trim().replace(/\s*\([^)]*\)/,'').replace(/\s+/g,' ');
  return (INGR_CANONICAL[low] || name).toLowerCase().trim();
}

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DATA HELPERS ──
function readRecipes() {
  const d = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
  return d.recipes || d;
}
function readPlan() {
  if (!fs.existsSync(PLAN_FILE)) return { weeks: {}, current_week: getCurrentWeek() };
  return JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
}
function writePlan(d) { fs.writeFileSync(PLAN_FILE, JSON.stringify(d, null, 2)); }
function readCustom() {
  if (!fs.existsSync(CUSTOM_FILE)) return { extra_shopping: [], notes: '' };
  return JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8'));
}
function writeCustom(d) { fs.writeFileSync(CUSTOM_FILE, JSON.stringify(d, null, 2)); }

function getCurrentWeek() {
  const d = new Date();
  const mon = new Date(d); mon.setDate(d.getDate() - (d.getDay() || 7) + 1);
  return mon.toISOString().split('T')[0];
}

// ── RECIPES ──
app.get('/api/recipes', (req, res) => {
  try {
    let recipes = readRecipes();
    const { q, category, cuisine, method, difficulty, maxtime } = req.query;
    if (q) { const ql = q.toLowerCase(); recipes = recipes.filter(r => r.name.toLowerCase().includes(ql) || (r.tags||[]).some(t => t.toLowerCase().includes(ql))); }
    if (category) recipes = recipes.filter(r => r.category === category);
    if (cuisine)  recipes = recipes.filter(r => r.cuisine === cuisine);
    if (method)   recipes = recipes.filter(r => (r.method||[]).includes(method));
    if (difficulty) recipes = recipes.filter(r => r.difficulty === difficulty);
    if (maxtime)  recipes = recipes.filter(r => r.time_minutes <= parseInt(maxtime));
    res.json(recipes);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/recipes/:id', (req, res) => {
  try {
    const r = readRecipes().find(r => r.id === parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recipes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
    const recipes = data.recipes || data;
    const maxId = recipes.reduce((m, r) => Math.max(m, r.id || 0), 0);
    const recipe = { id: maxId + 1, ...req.body };
    recipes.push(recipe);
    data.recipes = recipes; data.total = recipes.length;
    fs.writeFileSync(RECIPES_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, recipe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/recipes/:id', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
    const recipes = data.recipes || data;
    const idx = recipes.findIndex(r => r.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    recipes[idx] = { ...recipes[idx], ...req.body };
    data.recipes = recipes;
    fs.writeFileSync(RECIPES_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/recipes/:id', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
    data.recipes = (data.recipes || data).filter(r => r.id !== parseInt(req.params.id));
    data.total = data.recipes.length;
    fs.writeFileSync(RECIPES_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PLAN ──
app.get('/api/plan', (req, res) => {
  try {
    const plan = readPlan();
    const week = req.query.week || plan.current_week;
    res.json({ week, slots: (plan.weeks[week] || {}), current_week: plan.current_week });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/plan/:week/:day/:meal', (req, res) => {
  try {
    const plan = readPlan();
    const { week, day, meal } = req.params;
    if (!plan.weeks[week]) plan.weeks[week] = {};
    if (!plan.weeks[week][day]) plan.weeks[week][day] = {};
    plan.weeks[week][day][meal] = req.body; // { recipe_id, people, note }
    writePlan(plan);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/plan/:week/:day/:meal', (req, res) => {
  try {
    const plan = readPlan();
    const { week, day, meal } = req.params;
    if (plan.weeks[week]?.[day]) delete plan.weeks[week][day][meal];
    writePlan(plan);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SHOPPING LIST GENERATION ──
app.get('/api/shopping/generate', (req, res) => {
  try {
    const week = req.query.week || getCurrentWeek();
    const plan = readPlan();
    const slots = plan.weeks[week] || {};
    const recipes = readRecipes();
    const custom = readCustom();

    // Aggregate ingredients
    const agg = {}; // key: name -> { ...ingredient, total_lidl, total_cont, total_pingo, sources[] }

    Object.entries(slots).forEach(([day, meals]) => {
      Object.entries(meals).forEach(([mealType, slot]) => {
        if (!slot || !slot.recipe_id) return;
        const recipe = recipes.find(r => r.id === slot.recipe_id);
        if (!recipe) return;
        const factor = (slot.people || 2) / (recipe.base_servings || 2);

        (recipe.ingredients || []).forEach(ing => {
          const key = normalizeIngrName(ing.name);
          const scaled_amount = ing.amount * factor;
          if (!agg[key]) {
            agg[key] = {
              name: ing.name.charAt(0).toUpperCase() + ing.name.slice(1), name_pt: ing.name_pt || '',
              unit: ing.unit, category: ing.category,
              total_amount: 0,
              total_lidl: 0, total_continente: 0, total_pingo_doce: 0,
              sources: []
            };
          }
          agg[key].total_amount += scaled_amount;
          agg[key].total_lidl += (ing.prices?.lidl || 0) * factor;
          agg[key].total_continente += (ing.prices?.continente || 0) * factor;
          agg[key].total_pingo_doce += (ing.prices?.pingo_doce || 0) * factor;
          agg[key].sources.push({ day, meal: mealType, recipe: recipe.name, people: slot.people || 2 });
        });
      });
    });

    // Build list
    const items = Object.values(agg).map(item => ({
      ...item,
      total_amount: Math.ceil(item.total_amount * 10) / 10,
      total_lidl: +item.total_lidl.toFixed(2),
      total_continente: +item.total_continente.toFixed(2),
      total_pingo_doce: +item.total_pingo_doce.toFixed(2),
      best_store: ['lidl','continente','pingo_doce'].reduce((a,b) =>
        (item['total_'+b] < item['total_'+a] ? b : a)),
      checked: false
    }));

    // Totals
    const totals = {
      lidl: +items.reduce((s,i) => s + i.total_lidl, 0).toFixed(2),
      continente: +items.reduce((s,i) => s + i.total_continente, 0).toFixed(2),
      pingo_doce: +items.reduce((s,i) => s + i.total_pingo_doce, 0).toFixed(2),
      optimal: +items.reduce((s,i) => s + Math.min(i.total_lidl, i.total_continente, i.total_pingo_doce), 0).toFixed(2)
    };

    const meal_count = Object.values(slots).reduce((s,d) => s + Object.keys(d).length, 0);

    res.json({ items, totals, meal_count, extra_shopping: custom.extra_shopping || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CUSTOM (extra shopping + notes) ──
app.get('/api/custom', (req, res) => { try { res.json(readCustom()); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/custom', (req, res) => { try { writeCustom({ ...readCustom(), ...req.body }); res.json({ ok: true }); } catch(e) { res.status(500).json({ error: e.message }); } });

// ── SETTINGS API ──
app.get('/api/settings', (req, res) => {
  const key = getApiKey();
  const s = readSettings();
  const masked = key ? key.slice(0,10) + '...' + key.slice(-4) : '';
  res.json({ api_key_set: !!key, api_key_masked: masked, api_key_source: process.env.ANTHROPIC_API_KEY ? 'env' : (s.api_key ? 'saved' : 'none') });
});

app.post('/api/settings', (req, res) => {
  try {
    const { api_key } = req.body;
    if (api_key === undefined) return res.status(400).json({ error: 'Missing api_key' });
    const s = readSettings();
    s.api_key = api_key.trim();
    writeSettings(s);
    res.json({ ok: true, configured: !!s.api_key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI STATUS ──
app.get('/api/ai/status', (req, res) => res.json({ configured: !!getApiKey() }));

// ── AI CHAT ──
const AI_TOOLS = [
  {
    name: 'add_recipe_to_plan',
    description: 'Назначает рецепт на определённый день и приём пищи в план недели',
    input_schema: {
      type: 'object',
      properties: {
        week: { type: 'string', description: 'Неделя в формате YYYY-MM-DD (понедельник). Если не указана — текущая.' },
        day: { type: 'string', enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] },
        meal: { type: 'string', enum: ['breakfast','lunch','dinner'] },
        recipe_id: { type: 'number', description: 'ID рецепта из базы' },
        people: { type: 'number', description: 'Количество человек (по умолчанию 2)' }
      },
      required: ['day','meal','recipe_id']
    }
  },
  {
    name: 'remove_from_plan',
    description: 'Убирает блюдо из плана',
    input_schema: {
      type: 'object',
      properties: {
        day: { type: 'string', enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] },
        meal: { type: 'string', enum: ['breakfast','lunch','dinner'] }
      },
      required: ['day','meal']
    }
  },
  {
    name: 'create_recipe',
    description: 'Создаёт новый рецепт и добавляет в базу',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        emoji: { type: 'string' },
        cuisine: { type: 'string', enum: ['european','italian','mediterranean','american','asian','other'] },
        category: { type: 'string', enum: ['breakfast','lunch','dinner','soup','snack'] },
        method: { type: 'array', items: { type: 'string', enum: ['stovetop','oven','airfryer','grill','raw'] } },
        difficulty: { type: 'string', enum: ['easy','medium','hard'] },
        time_minutes: { type: 'number' },
        base_servings: { type: 'number' },
        calories_per_serving: { type: 'number' },
        batch: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        ingredients_text: { type: 'string', description: 'Ингредиенты с количествами в свободном формате' },
        steps: { type: 'string', description: 'Шаги приготовления' }
      },
      required: ['name','category','method','steps']
    }
  },
  {
    name: 'suggest_menu',
    description: 'Возвращает предложения рецептов для меню на неделю или часть недели',
    input_schema: {
      type: 'object',
      properties: {
        requirements: { type: 'string', description: 'Пожелания пользователя' }
      },
      required: ['requirements']
    }
  }
];

app.post('/api/ai/chat', async (req, res) => {
  if (!getApiKey()) return res.status(400).json({ error: 'API ключ не настроен. Добавь ANTHROPIC_API_KEY=' });
  try {
    const { messages, context } = req.body;
    const recipes = readRecipes();
    const plan = readPlan();
    const week = getCurrentWeek();
    const slots = plan.weeks[week] || {};

    const systemPrompt = `Ты — умный помощник в приложении планирования еды.

ПРОФИЛЬ:
- Он: 90 кг, 192 см, 38 лет, спорт 2-3×/нед → ~2950 ккал/день
- Она: 50 кг, 163 см, 32 года, спорт 1-2×/нед → ~1650 ккал/день
- НЕ едят: рыбу и грибы
- Есть Ninja Air Fryer, уличный гриль, духовка
- Живут в Португалии

ТЕКУЩАЯ НЕДЕЛЯ: ${week}

ПЛАН НА ЭТУ НЕДЕЛЮ:
${JSON.stringify(slots, null, 1)}

БАЗА РЕЦЕПТОВ (${recipes.length} рецептов):
Категории: breakfast, lunch, dinner, soup, snack
Методы: stovetop, oven, airfryer, grill, raw
Кухни: european, italian, mediterranean, american, asian

Первые 30 рецептов для справки:
${recipes.slice(0,30).map(r => `#${r.id} "${r.name}" [${r.category}, ${r.method.join('/')}]`).join('\n')}
...и ещё ${recipes.length-30} рецептов.

ПРАВИЛА:
- Отвечай по-русски
- Когда добавляешь рецепты в план — используй реальные ID из базы
- Если рецепт не найден в базе — предложи создать новый с create_recipe
- При предложении меню — учитывай разнообразие методов готовки
- Для одного человека — people=1, для двоих — people=2`;

    let currentMessages = [...messages];
    const changes = [];

    for (let i = 0; i < 6; i++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 2048, system: systemPrompt, tools: AI_TOOLS, messages: currentMessages })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `API ${response.status}`);

      if (data.stop_reason === 'end_turn') {
        const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        return res.json({ reply: text, changes });
      }

      if (data.stop_reason === 'tool_use') {
        currentMessages.push({ role: 'assistant', content: data.content });
        const toolResults = [];

        for (const block of data.content) {
          if (block.type !== 'tool_use') continue;
          let result = 'ok';

          if (block.name === 'add_recipe_to_plan') {
            const { day, meal, recipe_id, people, week: w } = block.input;
            const useWeek = w || week;
            const planData = readPlan();
            if (!planData.weeks[useWeek]) planData.weeks[useWeek] = {};
            if (!planData.weeks[useWeek][day]) planData.weeks[useWeek][day] = {};
            planData.weeks[useWeek][day][meal] = { recipe_id, people: people || 2 };
            writePlan(planData);
            const rec = recipes.find(r => r.id === recipe_id);
            changes.push({ type: 'plan', text: `${day} ${meal}: ${rec?.name || '#'+recipe_id}` });
            result = `Добавлено: ${rec?.name}`;

          } else if (block.name === 'remove_from_plan') {
            const { day, meal } = block.input;
            const planData = readPlan();
            if (planData.weeks[week]?.[day]) delete planData.weeks[week][day][meal];
            writePlan(planData);
            changes.push({ type: 'plan', text: `Убрано: ${day} ${meal}` });

          } else if (block.name === 'create_recipe') {
            const inp = block.input;
            const recData = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
            const recs = recData.recipes || recData;
            const maxId = recs.reduce((m,r) => Math.max(m,r.id||0), 0);
            const newRec = {
              id: maxId+1, name: inp.name, emoji: inp.emoji||'🍽️',
              cuisine: inp.cuisine||'european', category: inp.category||'dinner',
              method: inp.method||['stovetop'], difficulty: inp.difficulty||'medium',
              time_minutes: inp.time_minutes||30, base_servings: inp.base_servings||2,
              calories_per_serving: inp.calories_per_serving||400,
              batch: inp.batch||false, tags: inp.tags||[],
              ingredients: [], steps: inp.steps||'', ingredients_text: inp.ingredients_text||''
            };
            recs.push(newRec);
            recData.recipes = recs; recData.total = recs.length;
            fs.writeFileSync(RECIPES_FILE, JSON.stringify(recData, null, 2));
            changes.push({ type: 'recipe', text: `Создан рецепт: ${newRec.name} #${newRec.id}` });
            result = `Создан рецепт #${newRec.id}: ${newRec.name}`;

          } else if (block.name === 'suggest_menu') {
            const sample = recipes.filter(r => !['breakfast'].includes(r.category)).slice(0, 50);
            result = `Вот рецепты для предложений: ${sample.map(r=>`#${r.id} ${r.name} [${r.method}]`).join(', ')}`;
          }

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) });
        }
        currentMessages.push({ role: 'user', content: toolResults });
      } else break;
    }
    res.json({ reply: 'Готово!', changes });
  } catch(e) {
    console.error('AI error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍽️  Meal Planner v2 → http://0.0.0.0:${PORT}`);
  console.log(`📖  Рецептов в базе: ${readRecipes().length}`);
  console.log(`🤖  AI: ${getApiKey() ? 'активен' : 'нет ключа (добавь в приложении)'}`);
});

// ── FRIDGE ──
const FRIDGE_FILE = path.join(__dirname, 'data', 'fridge.json');
function readFridge() {
  if (!fs.existsSync(FRIDGE_FILE)) return { items: [] };
  return JSON.parse(fs.readFileSync(FRIDGE_FILE, 'utf8'));
}
function writeFridge(d) { fs.writeFileSync(FRIDGE_FILE, JSON.stringify(d, null, 2)); }

app.get('/api/fridge', (req, res) => { try { res.json(readFridge()); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/fridge', (req, res) => { try { writeFridge({ items: req.body.items || [] }); res.json({ ok: true }); } catch(e) { res.status(500).json({ error: e.message }); } });

// Match recipes to fridge ingredients
app.get('/api/fridge/matches', (req, res) => {
  try {
    const fridge = readFridge();
    const fridgeNames = (fridge.items || []).map(i => i.name.toLowerCase().trim());
    if (!fridgeNames.length) return res.json([]);

    const recipes = readRecipes();
    const results = [];

    recipes.forEach(recipe => {
      const ings = recipe.ingredients || [];
      if (!ings.length && !recipe.ingredients_text) return;

      let matched = 0, total = 0;
      const matchedNames = [];
      const missingNames = [];

      if (ings.length) {
        total = ings.length;
        ings.forEach(ing => {
          const ingLow = ing.name.toLowerCase();
          const found = fridgeNames.some(f => ingLow.includes(f) || f.includes(ingLow.split(' ')[0]));
          if (found) { matched++; matchedNames.push(ing.name); }
          else { missingNames.push(ing.name); }
        });
      } else if (recipe.ingredients_text) {
        const lines = recipe.ingredients_text.split('\n').filter(Boolean);
        total = lines.length;
        lines.forEach(line => {
          const found = fridgeNames.some(f => line.toLowerCase().includes(f));
          if (found) { matched++; matchedNames.push(line.trim()); }
          else { missingNames.push(line.trim()); }
        });
      }

      if (total > 0 && matched > 0) {
        results.push({
          recipe,
          matched,
          total,
          percent: Math.round(matched / total * 100),
          matchedIngredients: matchedNames,
          missingIngredients: missingNames
        });
      }
    });

    results.sort((a, b) => b.percent - a.percent || b.matched - a.matched);
    res.json(results.slice(0, 40));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RATINGS ──
const RATINGS_FILE = path.join(__dirname, 'data', 'ratings.json');
function readRatings() { try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8')); } catch { return {}; } }
function writeRatings(d) { fs.writeFileSync(RATINGS_FILE, JSON.stringify(d, null, 2)); }

app.get('/api/ratings', (req, res) => res.json(readRatings()));
app.put('/api/ratings/:id', (req, res) => {
  try {
    const d = readRatings();
    d[req.params.id] = { ...d[req.params.id], ...req.body, updated: new Date().toISOString() };
    writeRatings(d);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEFTOVERS ──
const LEFTOVERS_FILE = path.join(__dirname, 'data', 'leftovers.json');
function readLeftovers() { try { return JSON.parse(fs.readFileSync(LEFTOVERS_FILE, 'utf8')); } catch { return []; } }
function writeLeftovers(d) { fs.writeFileSync(LEFTOVERS_FILE, JSON.stringify(d, null, 2)); }

app.get('/api/leftovers', (req, res) => res.json(readLeftovers()));
app.post('/api/leftovers', (req, res) => {
  try {
    const d = readLeftovers();
    d.unshift({ id: Date.now(), ...req.body, date: new Date().toISOString() });
    writeLeftovers(d.slice(0, 50)); // keep last 50
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/leftovers/:id', (req, res) => {
  try {
    const d = readLeftovers();
    const idx = d.findIndex(x => x.id == req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    d[idx] = { ...d[idx], ...req.body };
    if (d[idx].portions <= 0) d.splice(idx, 1);
    writeLeftovers(d);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/leftovers/:id', (req, res) => {
  try {
    writeLeftovers(readLeftovers().filter(x => x.id != req.params.id));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── HISTORY (past weeks from plan) ──
app.get('/api/history', (req, res) => {
  try {
    const plan = readPlan();
    const recipes = readRecipes();
    const ratings = readRatings();
    const weeks = Object.entries(plan.weeks || {})
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12) // last 12 weeks
      .map(([week, days]) => {
        const meals = [];
        Object.entries(days).forEach(([day, mealTypes]) => {
          Object.entries(mealTypes).forEach(([meal, slot]) => {
            if (!slot?.recipe_id) return;
            const r = recipes.find(r => r.id === slot.recipe_id);
            if (r) meals.push({ day, meal, recipe: r, people: slot.people || 2, rating: ratings[r.id] });
          });
        });
        return { week, meals, count: meals.length };
      })
      .filter(w => w.count > 0);
    res.json(weeks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POPULAR RECIPES ──
app.get('/api/popular', (req, res) => {
  try {
    const plan = readPlan();
    const recipes = readRecipes();
    const ratings = readRatings();
    const counts = {};
    Object.values(plan.weeks || {}).forEach(days => {
      Object.values(days).forEach(meals => {
        Object.values(meals).forEach(slot => {
          if (slot?.recipe_id) counts[slot.recipe_id] = (counts[slot.recipe_id] || 0) + 1;
        });
      });
    });
    const popular = recipes
      .map(r => ({
        ...r,
        times_planned: counts[r.id] || 0,
        rating: ratings[r.id]?.stars || 0,
        score: (counts[r.id] || 0) * 2 + (ratings[r.id]?.stars || 0)
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    res.json(popular);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── URL IMPORT ──
app.post('/api/import-url', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(400).json({ error: 'Нужен API ключ' });
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Нет URL' });
    // Fetch the page
    const https = require('https');
    const http = require('http');
    const lib = url.startsWith('https') ? https : http;
    const pageText = await new Promise((resolve, reject) => {
      const req2 = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => resolve(data));
      });
      req2.on('error', reject);
      req2.on('timeout', () => req2.destroy());
    });
    // Strip HTML
    const text = pageText
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 8000);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 2000,
        messages: [{ role: 'user', content: `Извлеки рецепт из этого текста страницы и верни ТОЛЬКО JSON без markdown:
{"name":"...","emoji":"🍽️","cuisine":"european|italian|mediterranean|american|asian|other","category":"breakfast|lunch|dinner|soup|snack","method":["stovetop|oven|airfryer|grill|raw"],"difficulty":"easy|medium|hard","time_minutes":30,"base_servings":2,"calories_per_serving":400,"batch":false,"tags":["тег"],"ingredients_text":"ингредиент 1\\nингредиент 2","steps":"1. Шаг.\\n2. Шаг.","source_label":"название сайта","source_url":"${url}"}

Текст страницы:
${text}

Если это не рецепт — верни {"error":"не рецепт"}.
Переведи название и шаги на русский язык.
Не включай рыбу и грибы.` }]
      })
    });
    const aiData = await aiRes.json();
    const raw = (aiData.content?.[0]?.text || '').replace(/```json?/g,'').replace(/```/g,'').trim();
    const recipe = JSON.parse(raw);
    if (recipe.error) return res.status(400).json({ error: recipe.error });
    res.json(recipe);
  } catch(e) {
    res.status(500).json({ error: 'Не удалось разобрать рецепт: ' + e.message });
  }
});

// ── OPTIMAL SHOPPING SPLIT ──
app.get('/api/shopping/optimal', (req, res) => {
  try {
    const week = req.query.week || getCurrentWeek();
    const plan = readPlan();
    const slots = plan.weeks[week] || {};
    const recipes = readRecipes();
    const agg = {};
    Object.values(slots).forEach(days => {
      Object.values(days).forEach(slot => {
        if (!slot?.recipe_id) return;
        const recipe = recipes.find(r => r.id === slot.recipe_id);
        if (!recipe) return;
        const factor = (slot.people || 2) / (recipe.base_servings || 2);
        (recipe.ingredients || []).forEach(ing => {
          const key = normalizeIngrName(ing.name);
          if (!agg[key]) agg[key] = { name: ing.name, name_pt: ing.name_pt, unit: ing.unit, category: ing.category, total_amount: 0, lidl: 0, continente: 0, pingo_doce: 0 };
          agg[key].total_amount += ing.amount * factor;
          agg[key].lidl += (ing.prices?.lidl || 0) * factor;
          agg[key].continente += (ing.prices?.continente || 0) * factor;
          agg[key].pingo_doce += (ing.prices?.pingo_doce || 0) * factor;
        });
      });
    });
    const items = Object.values(agg).map(i => ({
      ...i, total_amount: +(i.total_amount).toFixed(1),
      lidl: +i.lidl.toFixed(2), continente: +i.continente.toFixed(2), pingo_doce: +i.pingo_doce.toFixed(2),
      best: i.lidl <= i.continente && i.lidl <= i.pingo_doce ? 'lidl' : i.continente <= i.pingo_doce ? 'continente' : 'pingo_doce'
    }));
    const byStore = { lidl: [], continente: [], pingo_doce: [] };
    items.forEach(i => byStore[i.best].push(i));
    const totals = {
      lidl: +byStore.lidl.reduce((s,i) => s+i.lidl, 0).toFixed(2),
      continente: +byStore.continente.reduce((s,i) => s+i.continente, 0).toFixed(2),
      pingo_doce: +byStore.pingo_doce.reduce((s,i) => s+i.pingo_doce, 0).toFixed(2),
      all_lidl: +items.reduce((s,i) => s+i.lidl, 0).toFixed(2),
      optimal: +items.reduce((s,i) => s+Math.min(i.lidl,i.continente,i.pingo_doce), 0).toFixed(2)
    };
    res.json({ byStore, totals, savings: +(totals.all_lidl - totals.optimal).toFixed(2) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
