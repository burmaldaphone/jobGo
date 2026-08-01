export default async function handler(req, res) {
  // Разрешаем запросы (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query, area = 1 } = req.query; // area 1 — Москва (по умолчанию)

  if (!query) {
    return res.status(400).json({ error: 'Укажите поисковый запрос' });
  }

  try {
    // 1. Делаем запрос к HH API с правильным User-Agent (устраняет ошибку 403)
    const hhResponse = await fetch(
      `https://api.hh.ru/vacancies?text=${encodeURIComponent(query)}&area=${area}&per_page=10`,
      {
        headers: {
          'User-Agent': 'JobGoApp/1.0 (contact@jobgo.app)',
        },
      }
    );

    if (!hhResponse.ok) {
      throw new Error(`Ошибка HH: ${hhResponse.status}`);
    }

    const hhData = await hhResponse.json();

    // Форматируем список вакансий для DeepSeek
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

    // 2. Вшиваем DeepSeek API ключ из переменных окружения Vercel
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      // Если ключ ещё не настроен, возвращаем вакансии без обработки AI
      return res.status(200).json({ vacancies: vacanciesList, aiAnalysed: false });
    }

    // Запрос к DeepSeek для фильтрации и оценки вакансий
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
            content: 'Ты HR-аналитик. Оцени вакансии по запросу пользователя от 1 до 100% и дай краткий вывод в 1 предложение, почему вакансия подходит.',
          },
          {
            role: 'user',
            content: `Запрос пользователя: "${query}". Вакансии: ${JSON.stringify(vacanciesList)}. 
Верни ответ strictly в формате JSON массива объектов с полями: id, score (число), reason (строка).`,
          },
        ],
      }),
    });

    const aiData = await deepseekResponse.json();
    
    // Возвращаем результат клиенту
    return res.status(200).json({
      vacancies: vacanciesList,
      aiAnalysis: aiData.choices?.[0]?.message?.content || null,
      aiAnalysed: true
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
