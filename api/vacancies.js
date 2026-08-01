// api/vacancies.js
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Устанавливаем заголовки CORS, чтобы фронтенд мог делать запросы
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Получаем фильтры из фронтенда (index.html)
    const { query, city, salary, schedule } = req.query;

    // Базовый адрес API HeadHunter (per_page=50 для большего количества результатов)
    let hhUrl = `https://api.hh.ru/vacancies?per_page=50`;

    // Формируем текст запроса (Должность + Город)
    let searchText = query || '';
    if (city) {
      searchText += ` ${city}`;
    }
    hhUrl += `&text=${encodeURIComponent(searchText)}`;

    // Добавляем фильтр по зарплате (если указана)
    if (salary) {
      hhUrl += `&salary=${salary}&only_with_salary=true`;
    }

    // Добавляем фильтр по графику (удаленка)
    if (schedule === 'remote') {
      hhUrl += `&schedule=remote`;
    }

    // Делаем запрос к HeadHunter с обязательным User-Agent
    const response = await fetch(hhUrl, {
      headers: { 
        'User-Agent': 'JobGoTWA/1.0 (contact@yourdomian.com)' 
      }
    });

    if (!response.ok) {
      throw new Error(`HH API responded with status: ${response.status}`);
    }

    const data = await response.json();

    // Преобразуем формат HH под наше приложение
    const vacancies = (data.items || []).map(item => {
      // Форматирование зарплаты
      let salaryText = 'По договорённости';
      if (item.salary) {
        const from = item.salary.from ? `от ${item.salary.from.toLocaleString('ru-RU')}` : '';
        const to = item.salary.to ? `до ${item.salary.to.toLocaleString('ru-RU')}` : '';
        const curr = item.salary.currency === 'RUR' ? '₽' : item.salary.currency;
        salaryText = `${from} ${to} ${curr}`.trim();
      }

      // Форматирование описания (убираем HTML теги HH)
      const snippet = (item.snippet?.requirement || item.snippet?.responsibility || '')
        .replace(/<highlighttext>/g, '')
        .replace(/<\/highlighttext>/g, '');

      return {
        id: item.id,
        title: item.name,
        company: item.employer ? item.employer.name : 'Не указана',
        salary: salaryText,
        snippet: snippet,
        url: item.alternate_url, // Официальная ссылка на вакансию
        source: 'HeadHunter'
      };
    });

    // Отправляем готовый список вакансий фронтенду
    res.status(200).json({ vacancies });

  } catch (error) {
    console.error('Ошибка бэкенда:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера', details: error.message });
  }
};
