export default async function handler(req, res) {
  // Настройка CORS
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

  try {
    // Используем открытый прокси для обхода блокировок зарубежных IP Vercel со стороны HH
    const targetUrl = `https://api.hh.ru/vacancies?text=${encodeURIComponent(query)}&per_page=10`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

    const hhResponse = await fetch(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
    });

    if (!hhResponse.ok) {
      throw new Error(`Ошибка обращения к HH: ${hhResponse.status}`);
    }

    const hhData = await hhResponse.json();

    if (!hhData.items || hhData.items.length === 0) {
      return res.status(200).json({ vacancies: [] });
    }

    // Собираем результаты
    const vacanciesList = hhData.items.map((item) => ({
      id: item.id,
      title: item.name,
      company: item.employer?.name || 'Не указана',
      salary: item.salary
        ? `${item.salary.from || ''} ${item.salary.to ? '- ' + item.salary.to : ''} ${item.salary.currency || ''}`
        : 'З/П не указана',
      url: item.alternate_url,
      snippet: item.snippet?.requirement || item.snippet?.responsibility || '',
    }));

    // Проверка и оценка через DeepSeek (если DEEPSEEK_API_KEY добавлен в Vercel)
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (apiKey) {
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
              { role: 'system', content: 'Ты HR-специалист. Отсортируй вакансии и верни ТОП.' },
              { role: 'user', content: `Запрос пользователя: "${query}". Подобранные вакансии: ${JSON.stringify(vacanciesList)}` },
            ],
          }),
        });

        if (deepseekResponse.ok) {
          const aiData = await deepseekResponse.json();
          return res.status(200).json({
            vacancies: vacanciesList,
            aiAnalysis: aiData.choices?.[0]?.message?.content || null,
          });
        }
      } catch (e) {
        console.error('AI Error:', e);
      }
    }

    return res.status(200).json({ vacancies: vacanciesList });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
