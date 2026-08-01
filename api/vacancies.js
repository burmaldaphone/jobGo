function stripHighlighttext(html) {
  if (!html) return '';
  return html.replace(/<highlighttext>/g, '').replace(/<\/highlighttext>/g, '');
}

function formatSalary(vacancy) {
  const salary = vacancy.salary;
  if (!salary) return 'Зарплата не указана';
  const currency = salary.currency === 'RUR' ? '₽' : salary.currency;
  if (salary.from && salary.to) {
    return salary.from + ' – ' + salary.to + ' ' + currency;
  }
  if (salary.from) {
    return 'от ' + salary.from + ' ' + currency;
  }
  if (salary.to) {
    return 'до ' + salary.to + ' ' + currency;
  }
  return 'Зарплата не указана';
}

function buildHhUrl(queryParams) {
  const url = new URL('https://api.hh.ru/vacancies');
  url.searchParams.set('per_page', '30');

  const query = queryParams.query || '';
  const city = queryParams.city || '';
  const searchText = (query + ' ' + city).trim();
  if (searchText) {
    url.searchParams.set('text', searchText);
  }

  const salary = queryParams.salary;
  if (salary) {
    url.searchParams.set('salary', salary);
    url.searchParams.set('only_with_salary', 'true');
  }

  const schedule = queryParams.schedule;
  if (schedule === 'remote') {
    url.searchParams.set('schedule', 'remote');
  }

  return url.toString();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  const controller = new AbortController();
  const id = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const queryParams = req.query || {};
  const hhUrl = buildHhUrl(queryParams);

  let vacancies = [];
  try {
    const hhResponse = await fetchWithTimeout(hhUrl, {
      headers: {
        'User-Agent': 'JobGoApp/1.0 (contact@jobgo.app)',
        'Accept': 'application/json',
      },
    });
    if (hhResponse.ok) {
      const data = await hhResponse.json();
      vacancies = (data.items || []).map(function (v) {
        return {
          id: v.id,
          title: v.name || 'Без названия',
          company: (v.employer && v.employer.name) || 'Неизвестная компания',
          salary: formatSalary(v),
          currency: v.salary ? v.salary.currency : null,
          area: (v.area && v.area.name) || '',
          schedule: (v.schedule && v.schedule.name) || '',
          snippet: {
            requirement: stripHighlighttext(v.snippet && v.snippet.requirement) || '',
            responsibility: stripHighlighttext(v.snippet && v.snippet.responsibility) || '',
          },
          url: v.alternate_url || '',
          publishedAt: v.published_at || '',
        };
      });
    }
  } catch (err) {
    console.error('HH API error:', err.message);
  }

  let aiAnalysis = null;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && vacancies.length > 0) {
    const query = queryParams.query || '';
    const topVacancies = vacancies.slice(0, 10);
    const vacancySummaries = topVacancies
      .map(function (v) {
        return 'Название: ' + v.title + ', Компания: ' + v.company + ', Зарплата: ' + v.salary + ', Требования: ' + v.snippet.requirement;
      })
      .join('\n');

    const deepseekPrompt = 'Проанализируй эти 5-10 вакансий по запросу \'' + query + '\'. Дай емкое резюме на 2-3 предложения: средняя вилка зарплат, самые частые требования/навыки и совет соискателю. Напиши без лишнего текста, сразу суть.';

    try {
      const dsResponse = await fetchWithTimeout(
        'https://api.deepseek.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + deepseekKey,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'user', content: deepseekPrompt },
            ],
            max_tokens: 500,
            temperature: 0.3,
          }),
        },
        10000
      );

      if (dsResponse.ok) {
        const dsData = await dsResponse.json();
        aiAnalysis = dsData.choices && dsData.choices[0] && dsData.choices[0].message && dsData.choices[0].message.content
          ? dsData.choices[0].message.content.trim()
          : null;
      }
    } catch (err) {
      console.error('DeepSeek API error:', err.message);
      aiAnalysis = null;
    }
  }

  res.status(200).json({
    vacancies: vacancies,
    aiAnalysis: aiAnalysis,
  });
}
