const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
require('dotenv').config();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const notion = notionToken ? new Client({ auth: notionToken, maxRetries: 0, logLevel: 'error' }) : null;
const PORT = Number(process.env.PORT);
const NOTION_TIMEOUT_MS = 5000;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const MONTH_LINES_REFRESH_MS = 10 * 60 * 1000;
const CACHE_DIR = path.join(__dirname, 'cache');
const MONTH_LINES_CACHE_FILE = path.join(CACHE_DIR, 'month-lines.json');
let cachedSearchResponse = null;
let cachedSearchExpiresAt = 0;
let cachedMonthLinesPayload = null;
let cachedMonthLinesUpdatedAt = null;
let monthLinesRefreshTimer = null;
const EXCLUDED_TITLES = new Set(['Project Brahman', 'Moving pictures', 'Art', 'Music', 'Rest', 'Sports']);

function formatMonthYear(date) {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function getCurrentAndPreviousMonthYear() {
  const now = new Date();
  const currentMonthYear = formatMonthYear(now);
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthYear = formatMonthYear(previousDate);
  return { currentMonthYear, previousMonthYear };
}

function getTextFromRichText(richText = []) {
  return richText.map((segment) => segment.plain_text || '').join('');
}

function getTextFromBlock(block) {
  if (!block || !block.type) return '';

  switch (block.type) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'quote':
    case 'callout':
    case 'toggle':
    case 'code':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'to_do':
    case 'bookmark':
      return getTextFromRichText(block[block.type].rich_text || block[block.type].text || block[block.type].title);
    case 'child_page':
      return block.child_page.title || '';
    case 'child_database':
      return block.child_database.title || '';
    default:
      return '';
  }
}

async function collectPageLines(blockId, lines = []) {
  if (!notion) return lines;

  let cursor = undefined;

  do {
    const response = await withTimeout(
      notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor,
      }),
      NOTION_TIMEOUT_MS,
      { results: [], has_more: false, next_cursor: undefined }
    );

    for (const block of response.results) {
      const text = getTextFromBlock(block).trim();
      if (text) {
        lines.push(...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      }

      if (block.has_children) {
        await collectPageLines(block.id, lines);
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return lines;
}

async function collectLeafPageLines(blockId, lines = []) {
  if (!notion) return lines;

  let cursor = undefined;

  do {
    const response = await withTimeout(
      notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor,
      }),
      NOTION_TIMEOUT_MS,
      { results: [], has_more: false, next_cursor: undefined }
    );

    for (const block of response.results) {
      if (block.has_children) {
        // traverse only to find leaf nodes, do not include parent text
        await collectLeafPageLines(block.id, lines);
      } else {
        const text = getTextFromBlock(block).trim();
        if (text) {
          lines.push(...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        }
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return lines;
}

async function getWorkspacePages(searchTerms = []) {
  if (!notion) return [];

  const pages = [];
  const seenPageIds = new Set();
  const queries = Array.from(new Set([searchTerms.join(' '), ...searchTerms].filter(Boolean)));

  for (const query of queries) {
    let cursor = undefined;

    do {
      const response = await withTimeout(
        notion.search({
          query,
          filter: {
            value: 'page',
            property: 'object',
          },
          page_size: 10,
          start_cursor: cursor,
        }),
        NOTION_TIMEOUT_MS,
        { results: [], has_more: false, next_cursor: undefined }
      );

      for (const result of response.results || []) {
        if (result.object !== 'page') continue;
        if (!seenPageIds.has(result.id)) {
          seenPageIds.add(result.id);
          pages.push(result);
        }
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor && pages.length < 20);
  }

  return pages;
}

async function getAllWorkspacePages() {
  if (!notion) return [];

  const pages = [];
  let cursor = undefined;

  do {
    const response = await withTimeout(
      notion.search({
        query: '',
        filter: { value: 'page', property: 'object' },
        page_size: 100,
        start_cursor: cursor,
      }),
      NOTION_TIMEOUT_MS,
      { results: [], has_more: false, next_cursor: undefined }
    );

    for (const result of response.results || []) {
      if (result.object !== 'page') continue;
      pages.push(result);
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

function extractTitle(properties) {
  if (!properties || typeof properties !== 'object') return '';
  for (const value of Object.values(properties)) {
    if (value && value.type === 'title' && Array.isArray(value.title)) {
      return value.title.map((segment) => segment.plain_text).join('');
    }
  }
  return '';
}

async function getPageTitle(pageId) {
  if (!notion) return pageId;

  try {
    const page = await withTimeout(
      notion.pages.retrieve({ page_id: pageId }),
      NOTION_TIMEOUT_MS,
      null
    );

    if (!page) return pageId;
    return extractTitle(page.properties) || pageId;
  } catch (error) {
    return pageId;
  }
}

async function findPageByTitle(title) {
  if (!notion) return null;

  let cursor = undefined;
  do {
    const response = await withTimeout(
      notion.search({
        query: title,
        filter: { value: 'page', property: 'object' },
        page_size: 20,
        start_cursor: cursor,
      }),
      NOTION_TIMEOUT_MS,
      { results: [], has_more: false, next_cursor: undefined }
    );

    for (const result of response.results || []) {
      if (result.object !== 'page') continue;
      if (extractTitle(result.properties).trim() === title) {
        return result;
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return null;
}

async function getPageParentName(parent) {
  if (!parent) return null;
  if (parent.type === 'workspace') return 'Workspace';
  if (parent.type === 'page_id') {
    const parentPage = await withTimeout(
      notion.pages.retrieve({ page_id: parent.page_id }),
      NOTION_TIMEOUT_MS,
      null
    );
    if (!parentPage) return parent.page_id;
    return extractTitle(parentPage.properties) || parent.page_id;
  }
  if (parent.type === 'database_id') return `Database ${parent.database_id}`;
  return parent.type;
}

async function getPageLocation(page) {
  if (!page || !page.parent) return { path: 'Unknown', chain: [] };

  const chain = [];
  let current = page;

  while (current && current.parent) {
    const parent = current.parent;
    if (parent.type === 'workspace') {
      chain.unshift('Workspace');
      break;
    }

    const parentName = await getPageParentName(parent);
    chain.unshift(parentName || parent.page_id || parent.database_id || parent.type);

    if (parent.type === 'page_id') {
      current = await withTimeout(
        notion.pages.retrieve({ page_id: parent.page_id }),
        NOTION_TIMEOUT_MS,
        null
      );
    } else {
      break;
    }
  }

  return { path: chain.join(' / '), chain };
}

function normalizeForSearch(text) {
  return text.toLowerCase();
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallbackValue), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

function makeMatchRegex(currentMonthYear, previousMonthYear) {
  const escaped = [currentMonthYear, previousMonthYear]
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`\\b(?:${escaped})\\b`, 'i');
}

async function getSearchPayload(currentMonthYear, previousMonthYear) {
  const now = Date.now();
  if (cachedSearchResponse && now < cachedSearchExpiresAt) {
    return cachedSearchResponse;
  }

  const matchRegex = makeMatchRegex(currentMonthYear, previousMonthYear);

  if (!notion) {
    const payload = {
      executionDate: new Date().toISOString(),
      currentMonthYear,
      previousMonthYear,
      notionConfigured: false,
      resultCount: 0,
      results: []
    };
    cachedSearchResponse = payload;
    cachedSearchExpiresAt = now + SEARCH_CACHE_TTL_MS;
    return payload;
  }

  const pages = await getWorkspacePages([currentMonthYear, previousMonthYear]);
  const results = [];

  for (const page of pages) {
    const title = await getPageTitle(page.id);
    const pageLines = await collectPageLines(page.id);

    pageLines.forEach((line, index) => {
      if (matchRegex.test(normalizeForSearch(line))) {
        results.push({
          pageId: page.id,
          title,
          lineNumber: index + 1,
          text: line,
        });
      }
    });
  }

  const payload = {
    executionDate: new Date().toISOString(),
    currentMonthYear,
    previousMonthYear,
    notionConfigured: true,
    resultCount: results.length,
    results,
  };

  cachedSearchResponse = payload;
  cachedSearchExpiresAt = now + SEARCH_CACHE_TTL_MS;
  return payload;
}

function getThreeMonthYearLabels(date = new Date()) {
  return [0, 1, 2].map((offset) => {
    const d = new Date(date.getFullYear(), date.getMonth() - offset, 1);
    return formatMonthYear(d);
  });
}

function makeLineFilterRegex(monthLabels) {
  const escaped = monthLabels.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`\\b(?:${escaped})\\b`, 'i');
}

function ensureCacheDirectory() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCachedMonthLinesPayload() {
  try {
    ensureCacheDirectory();
    if (!fs.existsSync(MONTH_LINES_CACHE_FILE)) return null;
    const raw = fs.readFileSync(MONTH_LINES_CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to read month-lines cache file:', error.message);
    return null;
  }
}

function writeCachedMonthLinesPayload(payload) {
  try {
    ensureCacheDirectory();
    fs.writeFileSync(MONTH_LINES_CACHE_FILE, JSON.stringify(payload, null, 2));
    cachedMonthLinesPayload = payload;
    cachedMonthLinesUpdatedAt = new Date().toISOString();
    return payload;
  } catch (error) {
    console.warn('Failed to write month-lines cache file:', error.message);
    return payload;
  }
}

function getCachedMonthLinesPayload() {
  if (cachedMonthLinesPayload) return cachedMonthLinesPayload;
  return readCachedMonthLinesPayload();
}

function shouldRefreshMonthLinesCache() {
  if (!cachedMonthLinesUpdatedAt) return true;
  return Date.now() - new Date(cachedMonthLinesUpdatedAt).getTime() > MONTH_LINES_REFRESH_MS;
}

async function buildMonthLinesPayload() {
  if (!notion) {
    return {};
  }

  const monthLabels = getThreeMonthYearLabels();
  const filterRegex = makeLineFilterRegex(monthLabels);
  const pages = await getAllWorkspacePages();
  const grouped = {};

  for (const label of monthLabels) {
    grouped[label] = [];
  }

  for (const page of pages) {
    const title = await getPageTitle(page.id);
    const lines = await collectPageLines(page.id);

    const byLabel = monthLabels.reduce((acc, label) => {
      acc[label] = [];
      return acc;
    }, {});

    for (const line of lines) {
      for (const label of monthLabels) {
        if (new RegExp(`\\b${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(line)) {
          byLabel[label].push(line);
        }
      }
    }

    if (EXCLUDED_TITLES.has(title)) {
      continue;
    }

    for (const label of monthLabels) {
      if (byLabel[label].length > 0) {
        grouped[label].push({ [title]: byLabel[label] });
      }
    }
  }

  return grouped;
}

async function refreshMonthLinesCache() {
  try {
    const payload = await buildMonthLinesPayload();
    writeCachedMonthLinesPayload(payload);
    console.log(`[cache] refreshed month-lines at ${new Date().toISOString()}`);
    return payload;
  } catch (error) {
    console.error('Failed to refresh month-lines cache:', error);
    return getCachedMonthLinesPayload() || {};
  }
}

function scheduleMonthLinesRefresh() {
  if (monthLinesRefreshTimer) {
    clearInterval(monthLinesRefreshTimer);
  }

  monthLinesRefreshTimer = setInterval(() => {
    refreshMonthLinesCache().catch(() => {});
  }, MONTH_LINES_REFRESH_MS);
}

app.get('/', (req, res) => {
  const payload = getCachedMonthLinesPayload() || {};
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replace('__INITIAL_DATA__', JSON.stringify(payload));
  res.type('html').send(html);
});

app.get('/api/search', async (req, res) => {
  try {
    const { currentMonthYear, previousMonthYear } = getCurrentAndPreviousMonthYear();
    const payload = await getSearchPayload(currentMonthYear, previousMonthYear);

    res.json({
      execution_date: new Date().toISOString(),
      executionDate: payload.executionDate,
      current_month_year: currentMonthYear,
      currentMonthYear,
      previous_month_year: previousMonthYear,
      previousMonthYear,
      notionConfigured: payload.notionConfigured,
      resultCount: payload.resultCount,
      matches: payload.results,
      results: payload.results,
    });
  } catch (error) {
    console.error('Failed to search Notion workspace:', error);

    const message = error?.message || 'Unknown error';
    const isRateLimit = /rate limit|429|too many requests/i.test(message);

    res.status(isRateLimit ? 429 : 500).json({
      error: 'Failed to search Notion workspace',
      details: message,
      retryable: isRateLimit,
    });
  }
});

app.get('/api/mock', async (req, res) => {
  if (!notion) {
    return res.status(400).json({ error: 'Notion API key not configured' });
  }

  try {
    const response = await notion.search({
      query: '',
      filter: { value: 'page', property: 'object' },
      page_size: 3,
    });

    res.json({
      message: 'Mock Notion fetch successful',
      results: response.results,
      hasMore: response.has_more,
      total: response.total,
    });
  } catch (error) {
    console.error('Failed to fetch mock Notion data:', error);
    res.status(500).json({ error: 'Failed to fetch mock Notion data', details: error.message });
  }
});

app.get('/api/movies-orthodox', async (req, res) => {
  if (!notion) {
    return res.status(400).json({ error: 'Notion API key not configured' });
  }

  const pageTitle = 'Movies (orthodox)';

  try {
    const page = await findPageByTitle(pageTitle);
    if (!page) {
      return res.status(404).json({ error: `Page '${pageTitle}' not found` });
    }

    const pageLines = await collectPageLines(page.id);
    const location = await getPageLocation(page);

    res.json({
      pageId: page.id,
      title: pageTitle,
      location,
      content: pageLines,
    });
  } catch (error) {
    console.error(`Failed to fetch page '${pageTitle}':`, error);
    res.status(500).json({ error: `Failed to fetch page '${pageTitle}'`, details: error.message });
  }
});

app.get('/api/all-pages', async (req, res) => {
  if (!notion) {
    return res.status(400).json({ error: 'Notion API key not configured' });
  }

  try {
    const pages = await getAllWorkspacePages();
    const pageContents = [];

    for (const page of pages) {
      const title = await getPageTitle(page.id);
      const lines = await collectLeafPageLines(page.id);
      pageContents.push({ pageId: page.id, title, lines });
    }

    const combinedContent = pageContents
      .flatMap((page) => [
        `--- ${page.title} (${page.pageId}) ---`,
        ...page.lines,
      ])
      .join('\n');

    res.json({
      executionDate: new Date().toISOString(),
      pageCount: pageContents.length,
      combinedContent,
      pages: pageContents,
    });
  } catch (error) {
    console.error('Failed to fetch all page content:', error);
    res.status(500).json({ error: 'Failed to fetch all page content', details: error.message });
  }
});

app.get('/api/debug-collect', async (req, res) => {
  const title = req.query.title || req.query.q;
  if (!title) return res.status(400).json({ error: 'Provide ?title=...' });
  if (!notion) return res.status(400).json({ error: 'Notion API key not configured' });

  try {
    const page = await findPageByTitle(title);
    if (!page) return res.status(404).json({ error: `Page '${title}' not found` });

    const full = await collectPageLines(page.id);
    const leaf = await collectLeafPageLines(page.id);

    res.json({ pageId: page.id, title, fullCount: full.length, leafCount: leaf.length, full, leaf });
  } catch (err) {
    console.error('debug-collect error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/month-lines', async (req, res) => {
  try {
    const cachedPayload = getCachedMonthLinesPayload();
    if (cachedPayload && !shouldRefreshMonthLinesCache()) {
      return res.json(cachedPayload);
    }

    if (cachedPayload) {
      refreshMonthLinesCache().catch(() => {});
      return res.json(cachedPayload);
    }

    const payload = await refreshMonthLinesCache();
    return res.json(payload);
  } catch (error) {
    console.error('Failed to fetch filtered month lines:', error);
    res.status(500).json({ error: 'Failed to fetch filtered month lines', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Brahman View API listening on http://localhost:${server.address().port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port !== 0) {
      console.warn(`Port ${port} is busy, trying a random open port instead.`);
      startServer(0);
      return;
    }

    console.error(error);
    process.exit(1);
  });
}

startServer(PORT);

refreshMonthLinesCache()
  .catch(() => {})
  .finally(() => {
    scheduleMonthLinesRefresh();
  });
