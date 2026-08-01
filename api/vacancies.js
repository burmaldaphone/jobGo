// api/vacancies.js
export default async function handler(req, res) {
  // Настройка заголовков для CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Получаем параметры запроса, присланные из index.html
    const { query, city, salary, schedule } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Укажите поисковый запрос' });
    }

    // Базовый адрес API HeadHunter (per_page=50 - сколько вакансий вернуть)
    let hhUrl = `https://api.hh.ru/vacancies?per_page=50`;

    // Формируем поисковый текст: "профессия + город"
    let searchText = query;
    if (city) {
      searchText += ` ${city}`; // HH хорошо понимает, когда город в тексте
    }
    hhUrl += `&text=${encodeURIComponent(searchText)}`;

    // Фильтр по зарплате
    if (salary && salary !== 'all') {
      hhUrl += `&salary=${salary}&only_with_salary=true`;
    }

    // Фильтр по удалёнке
    if (schedule === 'remote') {
      hhUrl += `&schedule=remote`;
    }

    // Делаем запрос к API HH
    const hhRes = await fetch(hhUrl, {
      headers: {
        // HH требует User-Agent для своих запросов
        'User-Agent': 'JobGoApp/1.0 (contact@example.com)'
      }
    });

    if (!hhRes.ok) {
      throw new Error(`HH API error: ${hhRes.status}`);
    }

    const data = await hhRes.json();

    // Преобразуем сложный ответ HH в простой формат для фронтенда
    const vacancies = (data.items || []).map(item => {
      let salaryText = 'По договорённости';
      if (item.salary) {
        const from = item.salary.from ? `от ${item.salary.from}` : '';
        const to = item.salary.to ? `до ${item.salary.to}` : '';
        const curr = item.salary.currency === 'RUR' ? '₽' : item.salary.currency;
        salaryText = `${from} ${to} ${curr}`.trim();
      }

      return {
        id: item.id,
        title: item.name,
        company: item.employer ? item.employer.name : 'Компания не указана',
        salary: salaryText,
        // Очищаем сниппет от HTML-тегов
        snippet: (item.snippet?.requirement || item.snippet?.responsibility || '')
          .replace(/<highlighttext>/g, '')
          .replace(/<\/highlighttext>/g, ''),
        url: item.alternate_url,
        source: 'HeadHunter'
      };
    });

    // Отправляем готовый список на фронтенд
    res.status(200).json({ vacancies });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера Vercel' });
  }
}
