export default async function handler(req, res) {
  // Настройка CORS для работы из Telegram Mini App
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Укажите поисковый запрос' });
  }

  let allVacancies = [];

  // ==========================================
  // 1. ИСТОЧНИК: Хабр Карьера (IT, Дизайн, Медиа)
  // ==========================================
  try {
    const habrRes = await fetch(
      `https://career.habr.com/api/v1/vacancies?q=${encodeURIComponent(query)}&per_page=5`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );
    if (habrRes.ok) {
      const habrData = await habrRes.json();
      if (habrData.vacancies) {
        const habrItems = habrData.vacancies.map((v) => ({
          id: `habr_${v.id}`,
          title: v.title,
          company: v.company?.title || 'Компания не указана',
          salary: v.salary ? v.salary.formatted : 'По договоренности',
          url: `https://career.habr.com${v.href}`,
          source: 'Хабр Карьера',
          snippet: v.skills?.map((s) => s.title).join(', ') || ''
        }));
        allVacancies.push(...habrItems);
      }
    }
  } catch (e) {
    console.error('Ошибка Хабр Карьеры:', e);
  }

  // ==========================================
  // 2. ИСТОЧНИК: SuperJob API
  // ==========================================
  try {
    const superjobSecret = process.env.SUPERJOB_SECRET_KEY; // Берём из Vercel (если добавлен)
    
    const sjHeaders = {
      'User-Agent': 'Mozilla/5.0'
    };
    if (superjobSecret) {
      sjHeaders['X-Api-App-Id'] = superjobSecret;
    }

    const sjRes = await fetch(
      `https://api.superjob.ru/2.0/vacancies/?keyword=${encodeURIComponent(query)}&count=5`,
      { headers: sjHeaders }
    );

    if (sjRes.ok) {
      const sjData = await sjRes.json();
      if (sjData.objects) {
        const sjItems = sjData.objects.map((v) => ({
          id: `sj_${v.id}`,
          title: v.profession,
          company: v.firm_name || 'Не указана',
          salary: v.payment_from ? `${v.payment_from} ${v.currency}` : 'По договоренности',
          url: v.link,
          source: 'SuperJob',
          snippet: v.candidat || ''
        }));
        allVacancies.push(...sjItems);
      }
    }
  } catch (e) {
    console.error('Ошибка SuperJob:', e);
  }

  // ==========================================
  // 3. ИСТОЧНИК: Агрегатор Работа.ру / Открытые RSS
  // ==========================================
  try {
    const rabotaRes = await fetch(
      `https://corsproxy.io/?${encodeURIComponent(`https://api.rabota.ru/v1/vacancies.json?query=${encodeURIComponent(query)}&limit=5`)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (rabotaRes.ok) {
      const rabotaData = await rabotaRes.json();
      if (rabotaData.vacancies) {
        const rabotaItems = rabotaData.vacancies.map((v) => ({
          id: `rabota_${v.id}`,
          title: v.title,
          company: v.company?.name || 'Работа.ру',
          salary: v.salary ? `${v.salary} руб.` : 'По договоренности',
          url: v.url || 'https://rabota.ru',
          source: 'Работа.ру',
          snippet: v.description || ''
        }));
        allVacancies.push(...rabotaItems);
      }
    }
  } catch (e) {
    console.error('Ошибка Работа.ру:', e);
  }

  // Если ни одна платформа ничего не вернула
  if (allVacancies.length === 0) {
    return res.status(200).json({ vacancies: [], message: 'Вакансии не найдены' });
  }

  // ==========================================
  // 4. АНАЛИЗ И РАНЖИРОВАНИЕ ЧЕРЕЗ DEEPSEEK
  // ==========================================
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (deepseekKey) {
    try {
      const aiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'Ты HR-специалист. Проанализируй вакансии с разных сайтов и выбери 5 наиболее релевантных.'
            },
            {
              role: 'user',
              content: `Запрос пользователя: "${query}". Список вакансий с сайтов: ${JSON.stringify(allVacancies)}.`
            }
          ]
        })
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        return res.status(200).json({
          vacancies: allVacancies,
          aiAnalysis: aiData.choices?.[0]?.message?.content || null
        });
      }
    } catch (e) {
      console.error('Ошибка DeepSeek:', e);
    }
  }

  // Возвращаем собранные вакансии (даже если ИИ не ответил)
  return res.status(200).json({ vacancies: allVacancies });
}
