export default async function handler(req, res) {
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

  // 1. ИСТОЧНИК: Хабр Карьера (IT, Дизайн, Медиа, Монтаж)
  try {
    const habrRes = await fetch(
      `https://career.habr.com/api/v1/vacancies?q=${encodeURIComponent(query)}&per_page=10`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    
    if (habrRes.ok) {
      const habrData = await habrRes.json();
      if (habrData.vacancies && habrData.vacancies.length > 0) {
        const habrItems = habrData.vacancies.map((v) => ({
          id: `habr_${v.id}`,
          title: v.title,
          company: v.company?.title || 'Компания не указана',
          salary: v.salary ? v.salary.formatted : 'По договоренности',
          url: `https://career.habr.com${v.href}`,
          source: 'Хабр Карьера',
          snippet: v.skills?.map((s) => s.title).join(', ') || 'Подробности на сайте',
        }));
        allVacancies.push(...habrItems);
      }
    }
  } catch (e) {
    console.error('Ошибка Хабра:', e);
  }

  // 2. ИСТОЧНИК: Работа в России (Госуслуги / ТрудВсем)
  try {
    const trudVsemUrl = `https://vsk.trudvsem.ru/api/v1/vacancies?text=${encodeURIComponent(query)}&limit=10`;
    const tvRes = await fetch(trudVsemUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    if (tvRes.ok) {
      const tvData = await tvRes.json();
      const items = tvData?.results?.vacancies || [];
      
      const tvItems = items.map((item) => {
        const v = item.vacancy;
        return {
          id: `tv_${v.id}`,
          title: v['job-name'] || query,
          company: v.company?.name || 'Прямой работодатель',
          salary: v.salary ? `${v.salary_min || ''} - ${v.salary_max || ''} руб.` : 'По договоренности',
          url: v['vac_url'] || `https://trudvsem.ru/vacancy/search?text=${encodeURIComponent(query)}`,
          source: 'Работа в России',
          snippet: v.duty || 'Описание доступно по ссылке',
        };
      });
      allVacancies.push(...tvItems);
    }
  } catch (e) {
    console.error('Ошибка ТрудВсем:', e);
  }

  // 3. ИСТОЧНИК: Прямой переход на HeadHunter (как резерв)
  if (allVacancies.length === 0) {
    allVacancies.push({
      id: 'fallback_hh',
      title: `Посмотреть вакансии «${query}» на HH.ru`,
      company: 'HeadHunter',
      salary: 'По договоренности',
      url: `https://hh.ru/search/vacancy?text=${encodeURIComponent(query)}`,
      source: 'HeadHunter',
      snippet: 'Перейти к результатам поиска напрямую на сайте HeadHunter.',
    });
  }

  // 4. Оценка через DeepSeek (если задан DEEPSEEK_API_KEY)
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (deepseekKey && allVacancies.length > 0) {
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
            { role: 'system', content: 'Ты HR-специалист. Дай краткую оценку найденным вакансиям.' },
            { role: 'user', content: `Запрос: "${query}". Вакансии: ${JSON.stringify(allVacancies)}` }
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
      console.error('AI Error:', e);
    }
  }

  return res.status(200).json({ vacancies: allVacancies });
}
