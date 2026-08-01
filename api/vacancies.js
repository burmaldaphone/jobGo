// api/vacancies.js
// Vercel Serverless Function (Node.js 18+, CommonJS)
// Проксирует поиск вакансий через HeadHunter API и обогащает результат
// кратким AI-анализом от DeepSeek. Если DeepSeek недоступен — просто
// возвращает aiAnalysis: null, не ломая основной поиск.

const HH_BASE_URL = "https://api.hh.ru/vacancies";
const HH_AREAS_URL = "https://api.hh.ru/suggests/areas";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const HH_USER_AGENT = "JobGoApp/1.0 (contact@jobgo.app)";

// Известные ID регионов HH.ru — для них не нужен доп. запрос.
const KNOWN_AREAS = {
  "москва": "1",
  "санкт-петербург": "2",
  "спб": "2",
  "казань": "88",
  "екатеринбург": "3",
};

/**
 * Пытается определить ID региона HH по названию города.
 * Сначала смотрит в таблицу известных городов, затем — если не нашёл —
 * обращается к suggests/areas HH.ru. Если ничего не найдено — вернёт null,
 * и город будет добавлен как обычный текст в поисковый запрос (fallback).
 */
async function resolveAreaId(cityName) {
  if (!cityName) return null;

  const normalized = cityName.trim().toLowerCase();
  if (KNOWN_AREAS[normalized]) {
    return KNOWN_AREAS[normalized];
  }

  try {
    const url = `${HH_AREAS_URL}?text=${encodeURIComponent(cityName)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": HH_USER_AGENT, Accept: "application/json" },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const match = data?.items?.[0];
    return match?.id || null;
  } catch (err) {
    console.error("resolveAreaId failed:", err?.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

/**
 * Убирает HTML-теги подсветки <highlighttext>...</highlighttext>,
 * которые HH.ru вставляет в сниппеты, оставляя только текст.
 */
function stripHighlightTags(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/<highlighttext>/gi, "")
    .replace(/<\/highlighttext>/gi, "")
    .replace(/<[^>]*>/g, "") // на всякий случай убираем остальные теги
    .trim();
}

/**
 * Форматирует валюту в человекочитаемый вид: RUR -> ₽, USD -> $, EUR -> €.
 */
function formatCurrency(currency) {
  if (!currency) return "";
  const map = {
    RUR: "₽",
    RUB: "₽",
    USD: "$",
    EUR: "€",
    KZT: "₸",
    BYR: "Br",
    UAH: "₴",
  };
  return map[currency.toUpperCase()] || currency;
}

/**
 * Форматирует диапазон зарплаты вакансии HH в читаемую строку.
 */
function formatSalary(salary) {
  if (!salary) return "Зарплата не указана";

  const symbol = formatCurrency(salary.currency);
  const from = salary.from ? salary.from.toLocaleString("ru-RU") : null;
  const to = salary.to ? salary.to.toLocaleString("ru-RU") : null;

  if (from && to) return `${from} – ${to} ${symbol}`;
  if (from) return `от ${from} ${symbol}`;
  if (to) return `до ${to} ${symbol}`;
  return "Зарплата не указана";
}

/**
 * Приводит одну вакансию из ответа HH.ru к компактному виду для фронтенда.
 */
function normalizeVacancy(item) {
  return {
    id: item.id,
    title: item.name || "Без названия",
    company: item.employer?.name || "Компания не указана",
    companyLogo: item.employer?.logo_urls?.["90"] || item.employer?.logo_urls?.original || null,
    city: item.area?.name || "",
    salary: formatSalary(item.salary),
    snippetRequirement: stripHighlightTags(item.snippet?.requirement),
    snippetResponsibility: stripHighlightTags(item.snippet?.responsibility),
    schedule: item.schedule?.name || "",
    experience: item.experience?.name || "",
    publishedAt: item.published_at || null,
    url: item.alternate_url || `https://hh.ru/vacancy/${item.id}`,
  };
}

/**
 * Собирает CORS-заголовки на ответ.
 */
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------------------------------------------------------------------------
// Запрос к HeadHunter
// ---------------------------------------------------------------------------

async function fetchVacanciesFromHH({ query, city, salary, schedule }) {
  const params = new URLSearchParams();
  params.set("per_page", "30");

  const areaId = await resolveAreaId(city);

  // Город найден как регион HH -> используем area, текст остаётся чистым
  // названием профессии (так поиск реально работает, а не возвращает пусто).
  // Город не распознан -> подстраховываемся и всё же добавляем его в текст.
  const searchText = areaId ? query : [query, city].filter(Boolean).join(" ").trim();

  if (searchText) {
    params.set("text", searchText);
  }

  if (areaId) {
    params.set("area", areaId);
  }

  if (salary) {
    const numericSalary = String(salary).replace(/[^\d]/g, "");
    if (numericSalary) {
      params.set("salary", numericSalary);
      params.set("only_with_salary", "true");
    }
  }

  if (schedule === "remote") {
    params.set("schedule", "remote");
  }

  const url = `${HH_BASE_URL}?${params.toString()}`;
  console.log("HH request URL:", url);

  const headers = {
    "User-Agent": HH_USER_AGENT,
    Accept: "application/json",
  };
  if (process.env.HH_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.HH_ACCESS_TOKEN}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`HH API вернул статус ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    found: data.found ?? items.length,
    vacancies: items.map(normalizeVacancy),
  };
}

// ---------------------------------------------------------------------------
// Запрос к DeepSeek
// ---------------------------------------------------------------------------

async function getAiAnalysis({ query, vacancies }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!vacancies || vacancies.length === 0) {
    return null;
  }

  try {
    const sample = vacancies.slice(0, 10).map((v) => ({
      title: v.title,
      company: v.company,
      salary: v.salary,
      requirement: v.snippetRequirement,
      responsibility: v.snippetResponsibility,
      experience: v.experience,
    }));

    const userPrompt = `Проанализируй эти вакансии по запросу "${query}": ${JSON.stringify(
      sample
    )}. Дай емкое резюме на 2-3 предложения: средняя вилка зарплат, самые частые требования/навыки и совет соискателю. Напиши без лишнего текста, сразу суть.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "Ты — карьерный AI-ассистент. Отвечай кратко, по делу, на русском языке, без вступлений.",
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const analysisText = data?.choices?.[0]?.message?.content?.trim();

    return analysisText || null;
  } catch (err) {
    // Любая ошибка (сеть, таймаут, парсинг) не должна ронять поиск вакансий
    console.error("DeepSeek analysis failed:", err?.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { query = "", city = "", salary = "", schedule = "" } = req.query || {};

  if (!query && !city) {
    res.status(400).json({ error: "Укажите хотя бы поисковый запрос (query) или город (city)" });
    return;
  }

  try {
    const { found, vacancies } = await fetchVacanciesFromHH({ query, city, salary, schedule });
    const aiAnalysis = await getAiAnalysis({ query, vacancies });

    res.status(200).json({
      found,
      count: vacancies.length,
      vacancies,
      aiAnalysis,
    });
  } catch (err) {
    console.error("vacancies handler error:", err?.message || err);
    res.status(502).json({
      error: err?.message || "Не удалось получить вакансии от HeadHunter",
    });
  }
};
