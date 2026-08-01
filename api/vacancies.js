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

function normalizeSource(source) {
  const map = {
    hh: 'HeadHunter',
    superjob: 'SuperJob',
    rbctalant: 'RBC Talant',
  };
  return map[source] || source;
}

function buildHHUrl(queryParams) {
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
  } else if (schedule === 'office') {
    url.searchParams.set('schedule', 'office');
  }
  return url.toString();
}

function buildSuperJobUrl(queryParams) {
  const url = new URL('https://api.superjob.ru/2.0/vacancies/');
  url.searchParams.set('count', '30');
  const query = queryParams.query || '';
  const city = queryParams.city || '';
  if (query) {
    url.searchParams.set('keyword', query);
  }
  if (city) {
    url.searchParams.set('town', city);
  }
  const salary = queryParams.salary;
  if (salary) {
    url.searchParams.set('payment_from', salary);
  }
  const schedule = queryParams.schedule;
  if (schedule === 'remote') {
    url.searchParams.set('type', 'remote');
  } else if (schedule === 'office') {
    url.searchParams.set('type', 'office');
  }
  url.searchParams.set('app_id', 'v3rg2hU5UvE1k0k5k2k4k6k8k0k2k4k6');
  return url.toString();
}

function buildRBCUrl(queryParams) {
  const url = new URL('https://api.rbc.ru/vacancy-search');
  const query = queryParams.query || '';
  const city = queryParams.city || '';
  const salary = queryParams.salary;
  const schedule = queryParams.schedule;
  const body = {
    query: {
      text: query,
      area: city ? { name: city } : undefined,
      salary: salary ? { from: parseInt(salary, 10) } : undefined,
      schedule: schedule ? { name: schedule === 'remote' ? 'remote' : 'office' } : undefined,
    },
    page: 0,
    count: 30,
  };
  if (!body.query.area) delete body.query.area;
  if (!body.query.salary) delete body.query.salary;
  if (!body.query.schedule) delete body.query.schedule;
  return { url: url.toString(), body: body };
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

async function fetchHH(queryParams) {
  try {
    const hhUrl = buildHHUrl(queryParams);
    const response = await fetchWithTimeout(hhUrl, {
      headers: {
        'User-Agent': 'JobGoApp/1.0 (contact@jobgo.app)',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.items || []).map(function (v) {
      return {
        id: 'hh_' + v.id,
        source: 'hh',
        sourceName: 'HeadHunter',
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
  } catch (err) {
    console.error('HH error:', err.message);
    return [];
  }
}

async function fetchSuperJob(queryParams) {
  try {
    const sjUrl = buildSuperJobUrl(queryParams);
    const response = await fetchWithTimeout(sjUrl, {
      headers: {
        'User-Agent': 'JobGoApp/1.0 (contact@jobgo.app)',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.objects || []).map(function (v) {
      return {
        id: 'sj_' + v.id,
        source: 'superjob',
        sourceName: 'SuperJob',
        title: v.profession || 'Без названия',
        company: v.firm_name || 'Неизвестная компания',
        salary: v.payment_from && v.payment_to
          ? v.payment_from + ' – ' + v.payment_to + ' ₽'
          : v.payment_from
            ? 'от ' + v.payment_from + ' ₽'
            : v.payment_to
              ? 'до ' + v.payment_to + ' ₽'
              : 'Зарплата не указана',
        currency: '₽',
        area: v.town ? v.town.title : '',
        schedule: v.type ? v.type.title : '',
        snippet: {
          requirement: v.currency || '',
          responsibility: '',
        },
        url: v.link || '',
        publishedAt: v.created || '',
      };
    });
  } catch (err) {
    console.error('SuperJob error:', err.message);
    return [];
  }
}

async function fetchRBC(queryParams) {
  try {
    const rbcReq = buildRBCUrl(queryParams);
    const response = await fetchWithTimeout(rbcReq.url, {
      method: 'POST',
      headers: {
        'User-Agent': 'JobGoApp/1.0 (contact@jobgo.app)',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(rbcReq.body),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.items || []).map(function (v) {
      return {
        id: 'rbc_' + v.id,
        source: 'rbctalant',
        sourceName: 'RBC Talant',
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
  } catch (err) {
    console.error('RBC error:', err.message);
    return [];
  }
}

async function fetchAllSources(queryParams) {
  const sources = queryParams.sources;
  let activeSources = ['hh', 'superjob', 'rbctalant'];
  if (sources && sources !== 'all') {
    const selected = sources.split(',');
    activeSources = activeSources.filter(function (s) { return selected.indexOf(s) !== -1; });
  }
  const results = await Promise.allSettled(
    activeSources.map(function (src) {
      if (src === 'hh') return fetchHH(queryParams);
      if (src === 'superjob') return fetchSuperJob(queryParams);
      if (src === 'rbctalant') return fetchRBC(queryParams);
      return Promise.resolve([]);
    })
  );
  let allVacancies = [];
  results.forEach(function (result) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allVacancies = allVacancies.concat(result.value);
    }
  });
  allVacancies.sort(function (a, b) {
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
  return allVacancies;
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
  const vacancies = await fetchAllSources(queryParams);
  let aiAnalysis = null;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && vacancies.length > 0) {
    const query = queryParams.query || '';
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
    sources: {
      total: vacancies.length,
      hh: vacancies.filter(function (v) { return v.source === 'hh'; }).length,
      superjob: vacancies.filter(function (v) { return v.source === 'superjob'; }).length,
      rbctalant: vacancies.filter(function (v) { return v.source === 'rbctalant'; }).length,
    },
  });
}
