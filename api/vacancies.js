export default async function handler(req, res) {
  // Разрешаем запросы (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query, area = 1 } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Укажите поисковый запрос' });
  }

  try {
    // 1. Запрос к HeadHunter API
    const hhUrl = `https://api.hh.ru/vacancies?text=${encodeURIComponent(query)}&area=${area}&per_page=10`;
    const hhResponse = await fetch(hhUrl, {
      headers: {
        'User-Agent': 'JobGoApp/1.0 (contact@jobgo.app)',
        'Accept': 'application/json'
      },
    });

    if (!hhResponse.ok) {
      return res.status(hhResponse.status).json({ error: `Ошибка HH: ${hhResponse.status}` });
    }

    const hhData = await hhResponse.json();

    if (!hhData.items || hhData.items.length === 0) {
      return res.status(200).json({ vacancies: [] });
    }

    // Форматируем список вакансий
    const vacanciesList = hhData.items.map((item) => ({
      id: item.id,
      title: item.name,
      company: item.employer?.name || 'Не указана',
      salary: item.salary
        ? `${item.salary.from || ''} - ${item.salary.to || ''} ${item.salary.currency}`
        : 'З/П не указана',
      url: item.alternate_url,
      snippet: item.snippet?.requirement || '',
    }));

    // 2. Обработка через DeepSeek (если ключ задан)
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      // Если ключа нет, просто отдаем найденные вакансии
      return res.status(200).json({ vacancies: vacanciesList });
    }

    try {
      const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'Ты HR-специалист. Оцени релевантность вакансий.',
            },
            {
              role: 'user',
              content: `Пользователь ищет: "${query}". Вот вакансии: ${JSON.stringify(vacanciesList)}. Оцени их.`,
            },
          ],
        }),
      });

      if (deepseekResponse.ok) {
        const aiData = await deepseekResponse.json();
        return res.status(200).json({
          vacancies: vacanciesList,
          aiAnalysis: aiData.choices?.[0]?.message?.content || null
        });
      }
    } catch (aiErr) {
      console.error('Ошибка DeepSeek:', aiErr);
    }

    // Если запрос к ИИ сбойнул, отдаем базовые вакансии без падения сервера
    return res.status(200).json({ vacancies: vacanciesList });

  } catch (error) {
    return res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
  }
}
