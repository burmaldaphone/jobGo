const USER_AGENT = 'JobGoApp/1.0 (contact@jobgo.app)';

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
    habr: 'Хабр Карьера',
    trudvsem: 'Работа России',
  };
  return map[source] || source;
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

async function fetchHH(queryParams) {
  try {
    const hhUrl = buildHHUrl(queryParams);
    const response = await fetchWithTimeout(hhUrl, {
      headers: {
        'User-Agent': USER_AGENT,
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

// ---------------- Хабр Карьера (RSS) ----------------

function buildHabrUrl(queryParams) {
  const url = new URL('https://career.habr.com/vacancies/rss');
  url.searchParams.set('per_page', '30');
  const query = queryParams.query || '';
  if (query) {
    url.searchParams.set('q', query);
  }
  return url.toString();
}

function decodeXmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
}

function extractBetween(str, startTag, endTag) {
  const startIdx = str.indexOf(startTag);
  if (startIdx === -1) return '';
  const contentStart = startIdx + startTag.length;
  const endIdx = str.indexOf(endTag, contentStart);
  if (endIdx === -1) return '';
  return str.substring(contentStart, endIdx);
}

function extractRssItems(xml) {
  const items = [];
  let cursor = 0;
  const itemStart = '<item>';
  const itemEnd = '</item>';
  while (true) {
    const s = xml.indexOf(itemStart, cursor);
    if (s === -1) break;
    const e = xml.indexOf(itemEnd, s);
    if (e === -1) break;
    items.push(xml.substring(s, e));
    cursor = e + itemEnd.length;
  }
  return items;
}

function parseHabrSalary(text) {
  if (!text) return 'Зарплата не указана';
  const t = text.replace(/\u00a0/g, ' ');
  const pattern = /(?:от\s+[\d\s]+\s+до\s+[\d\s]+|до\s+[\d\s]+|от\s+[\d\s]+|[\d\s]+)\s?(₽|\$|€|₴)/;
  const match = t.match(pattern);
  if (match) {
    return match[0].replace(/\s+/g, ' ').replace(/\s(?=₽|\$|€|₴)/, ' ').trim();
  }
  return 'Зарплата не указана';
}

function parseHabrAreas(text) {
  if (!text) return '';
  const t = text.replace(/\u00a0/g, ' ');
  const parts = [];
  const cities = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск',
    'Нижний Новгород', 'Краснодар', 'Ростов-на-Дону', 'Уфа', 'Самара', 'Пермь', 'Воронеж',
    'Красноярск', 'Сочи', 'Тюмень', 'Томск', 'Пенза', 'Донецк', 'Луганск', 'Владивосток',
    'Алматы', 'Минск', 'Тбилиси', 'Ереван', 'Киев'];
  cities.forEach(function (c) {
    if (t.indexOf(c) !== -1 && parts.indexOf(c) === -1) parts.push(c);
  });
  return parts.slice(0, 3).join(', ');
}

async function fetchHabr(queryParams) {
  try {
    const habrUrl = buildHabrUrl(queryParams);
    const response = await fetchWithTimeout(habrUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = extractRssItems(xml);
    return items.map(function (item, index) {
      const title = decodeXmlEntities(extractBetween(item, '<title>', '</title>'));
      const description = decodeXmlEntities(extractBetween(item, '<description>', '</description>'));
      const company = decodeXmlEntities(extractBetween(item, '<author>', '</author>'));
      const link = extractBetween(item, '<link>', '</link>');
      const guid = extractBetween(item, '<guid>', '</guid>');
      const pubDate = extractBetween(item, '<pubDate>', '</pubDate>');

      const cleanTitle = title
        .replace(/^Требуется\s*«/, '')
        .replace(/»(\s*\(.*)?$/, '')
        .trim();

      return {
        id: 'habr_' + (guid || link || index),
        source: 'habr',
        sourceName: 'Хабр Карьера',
        title: cleanTitle || 'Без названия',
        company: company || 'Неизвестная компания',
        salary: parseHabrSalary(title + ' ' + description),
        currency: '₽',
        area: parseHabrAreas(title + ' ' + description),
        schedule: description.indexOf('Удалённо') !== -1 || description.indexOf('удалённо') !== -1 ? 'Удалённо' : '',
        snippet: {
          requirement: description,
          responsibility: '',
        },
        url: link || '',
        publishedAt: pubDate ? new Date(pubDate).toISOString() : '',
      };
    });
  } catch (err) {
    console.error('Habr error:', err.message);
    return [];
  }
}

// ---------------- Работа России (Trudvsem) ----------------

function buildTrudvsemUrl(queryParams) {
  const url = new URL('https://opendata.trudvsem.ru/api/v1/vacancies');
  url.searchParams.set('limit', '30');
  const query = queryParams.query || '';
  const city = queryParams.city || '';
  const searchText = (query + ' ' + city).trim();
  if (searchText) {
    url.searchParams.set('text', searchText);
  }
  return url.toString();
}

function formatTrudSalary(v) {
  const min = v.salary_min;
  const max = v.salary_max;
  if (min && max) return min + ' – ' + max + ' ₽';
  if (min) return 'от ' + min + ' ₽';
  if (max) return 'до ' + max + ' ₽';
  return 'Зарплата не указана';
}

async function fetchTrudvsem(queryParams) {
  try {
    const trudUrl = buildTrudvsemUrl(queryParams);
    const response = await fetchWithTimeout(trudUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const vacancies = data && data.results && data.results.vacancies;
    if (!Array.isArray(vacancies)) return [];
    return vacancies.map(function (entry) {
      const v = entry.vacancy || {};
      const company = (v.company && v.company.name) || 'Неизвестная компания';
      const region = (v.region && v.region.name) || '';
      let address = '';
      if (v.addresses && v.addresses.address && v.addresses.address[0]) {
        address = v.addresses.address[0].location || '';
      }
      let area = address || region;
      const requirements = v.requirements || '';
      const duty = v.duty || '';
      return {
        id: 'trud_' + (v.id || Math.random()),
        source: 'trudvsem',
        sourceName: 'Работа России',
        title: v['job-name'] || 'Без названия',
        company: company,
        salary: formatTrudSalary(v),
        currency: '₽',
        area: area,
        schedule: v.schedule || '',
        snippet: {
          requirement: (requirements + ' ' + duty).trim(),
          responsibility: '',
        },
        url: v.vac_url || '',
        publishedAt: v['creation-date'] ? new Date(v['creation-date']).toISOString() : '',
      };
    });
  } catch (err) {
    console.error('Trudvsem error:', err.message);
    return [];
  }
}

// ---------------- SuperJob (опционально, по ключу) ----------------

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
  return url.toString();
}

async function fetchSuperJob(queryParams) {
  const apiKey = process.env.SUPERJOB_API_KEY;
  if (!apiKey) {
    console.warn('SuperJob пропущен: не задан SUPERJOB_API_KEY');
    return [];
  }
  try {
    const sjUrl = buildSuperJobUrl(queryParams);
    const response = await fetchWithTimeout(sjUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'X-Api-App-Id': apiKey,
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.objects || []).map(function (v) {
      const paymentFrom = v.payment_from || 0;
      const paymentTo = v.payment_to || 0;
      let salary = 'Зарплата не указана';
      if (paymentFrom && paymentTo) salary = paymentFrom + ' – ' + paymentTo + ' ₽';
      else if (paymentFrom) salary = 'от ' + paymentFrom + ' ₽';
      else if (paymentTo) salary = 'до ' + paymentTo + ' ₽';
      return {
        id: 'sj_' + v.id,
        source: 'superjob',
        sourceName: 'SuperJob',
        title: v.profession || 'Без названия',
        company: v.firm_name || 'Неизвестная компания',
        salary: salary,
        currency: '₽',
        area: v.town ? v.town.title : '',
        schedule: v.type ? v.type.title : '',
        snippet: {
          requirement: '',
          responsibility: '',
        },
        url: v.link || '',
        publishedAt: v.date_published ? new Date(v.date_published * 1000).toISOString() : '',
      };
    });
  } catch (err) {
    console.error('SuperJob error:', err.message);
    return [];
  }
}

// ---------------- Реестр источников ----------------

const SOURCES = {
  hh: fetchHH,
  habr: fetchHabr,
  trudvsem: fetchTrudvsem,
  superjob: fetchSuperJob,
};

async function fetchAllSources(queryParams) {
  let activeKeys = Object.keys(SOURCES);
  const sources = queryParams.sources;
  if (sources && sources !== 'all') {
    const selected = sources.split(',');
    activeKeys = activeKeys.filter(function (s) { return selected.indexOf(s) !== -1; });
  }
  const results = await Promise.allSettled(
    activeKeys.map(function (key) {
      return SOURCES[key](queryParams);
    })
  );
  let allVacancies = [];
  results.forEach(function (result) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allVacancies = allVacancies.concat(result.value);
    }
  });
  allVacancies.sort(function (a, b) {
    const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return db - da;
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
      habr: vacancies.filter(function (v) { return v.source === 'habr'; }).length,
      trudvsem: vacancies.filter(function (v) { return v.source === 'trudvsem'; }).length,
    },
  });
}
