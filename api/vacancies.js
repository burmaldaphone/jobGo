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

  // 1. Поиск вакансий
  try {
    const trudVsemUrl = `https://vsk.trudvsem.ru/api/v1/vacancies?text=${encodeURIComponent(query)}&limit=10`;
    const tvRes = await fetch(trudVsemUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (tvRes.ok) {
      const tvData = await tvRes.json();
      const items = tvData?.results?.vacancies || [];
      
      allVacancies = items.map((item) => {
        const v = item.vacancy;
        const jobTitle = v['job-name'] || query;

        return {
          id: `tv_${v.id}`,
          title: jobTitle,
          company: v.company?.name || 'Прямой работодатель',
          salary: v.salary ? `${v.salary_min || ''} - ${v.salary_max || ''} руб.` : 'По договоренности',
          // Ссылка строго на HeadHunter по этой должности:
          url: `https://hh.ru/search/vacancy?text=${encodeURIComponent(jobTitle)}`,
          source: 'HeadHunter',
          snippet: v.duty || 'Нажмите, чтобы открыть вакансию на hh.ru',
        };
      });
    }
  } catch (e) {
    console.error('Ошибка поиска:', e);
  }

  // Резервный вариант, если ничего не нашлось
  if (allVacancies.length === 0) {
    allVacancies.push({
      id: 'fallback_hh',
      title: `Посмотреть вакансии «${query}» на HH.ru`,
      company: 'HeadHunter',
      salary: 'По договоренности',
      url: `https://hh.ru/search/vacancy?text=${encodeURIComponent(query)}`,
      source: 'HeadHunter',
      snippet: 'Перейти к списку свежих вакансий напрямую на сайте hh.ru',
    });
  }

  // 2. Оценка через DeepSeek (если задан ключ)
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
            { role: 'system', content: 'Ты HR-специалист. Подскажи, на что обратить внимание соискателю.' },
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
