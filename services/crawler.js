const cheerio = require('cheerio');

const MAX_PAGES     = 10;
const FETCH_TIMEOUT = 8000;

const NON_PAGE_EXTENSIONS = new Set([
  'jpg','jpeg','png','gif','webp','svg','ico','bmp','tiff','avif',
  'pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf',
  'zip','gz','tar','rar','7z',
  'mp4','mov','avi','wmv','webm','mkv','m4v','flv',
  'mp3','wav','ogg','aac','flac','m4a',
  'woff','woff2','ttf','eot','otf',
  'js','css','json','xml','rss','atom',
  'map','ts','jsx','tsx',
]);

function isHtmlPage(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase().split('?')[0];
    const lastSegment = pathname.split('/').pop();
    const dot = lastSegment.lastIndexOf('.');
    if (dot === -1) return true;
    return !NON_PAGE_EXTENSIONS.has(lastSegment.slice(dot + 1));
  } catch { return false; }
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.toString().replace(/\/$/, '') || u.toString();
  } catch { return null; }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; RedCubeSEOBot/1.0; +https://redcube.co)',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    return { html, status: res.status, finalUrl: res.url, ok: res.ok };
  } catch (e) {
    return { html: '', status: 0, finalUrl: url, ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractInternalLinks($, pageUrl, origin) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href
      || href.startsWith('mailto:') || href.startsWith('tel:')
      || href.startsWith('javascript:') || href.startsWith('#')
      || href.startsWith('data:') || href.startsWith('ftp:')
    ) return;
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized && normalized.startsWith(origin) && isHtmlPage(normalized)) {
      links.add(normalized);
    }
  });
  return links;
}

function extractPageMetrics($, html, url, origin) {
  return {
    title:              $('title').first().text().trim(),
    titleLength:        $('title').first().text().trim().length,
    metaDescription:    $('meta[name="description"]').attr('content') || '',
    metaDescLen:        ($('meta[name="description"]').attr('content') || '').length,
    h1Count:            $('h1').length,
    h1Text:             $('h1').first().text().trim().slice(0, 120),
    h2Count:            $('h2').length,
    canonical:          $('link[rel="canonical"]').attr('href') || '',
    robotsMeta:         $('meta[name="robots"]').attr('content') || '',
    ogTitle:            $('meta[property="og:title"]').attr('content') || '',
    ogDesc:             $('meta[property="og:description"]').attr('content') || '',
    ogImage:            $('meta[property="og:image"]').attr('content') || '',
    viewport:           $('meta[name="viewport"]').attr('content') || '',
    lang:               $('html').attr('lang') || '',
    imageCount:         $('img').length,
    imagesWithAlt:      $('img[alt]').filter((_, el) => ($(el).attr('alt') || '').trim() !== '').length,
    imagesWithoutAlt:   $('img').filter((_, el) => !($(el).attr('alt') || '').trim()).length,
    internalLinks:      $('a[href]').filter((_, el) => { try { return new URL($(el).attr('href'), url).origin === origin; } catch { return false; } }).length,
    externalLinks:      $('a[href]').filter((_, el) => { try { return new URL($(el).attr('href'), url).origin !== origin; } catch { return false; } }).length,
    wordCount:          $('body').text().replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).length,
    hasSchemaOrg:       html.includes('schema.org'),
    hasStructuredData:  $('script[type="application/ld+json"]').length > 0,
    hasGoogleAnalytics: html.includes('gtag') || html.includes('google-analytics') || html.includes('googletagmanager'),
    isMobileOptimized:  ($('meta[name="viewport"]').attr('content') || '').includes('width=device-width'),
    htmlSize:           html.length,
    hasNavElement:      $('nav').length > 0 || $('[role="navigation"]').length > 0,
    hasFooter:          $('footer').length > 0,
    isHttps:            url.startsWith('https://'),
    hasNoindex:         ($('meta[name="robots"]').attr('content') || '').toLowerCase().includes('noindex'),
    hasArticleDate:     !!($('meta[property="article:published_time"]').attr('content') ||
                           $('time[datetime]').length ||
                           $('[class*="post-date"],[class*="entry-date"],[class*="publish"]').length),
    hasAuthorMeta:      !!($('meta[name="author"]').attr('content') ||
                           $('[rel="author"]').length ||
                           $('[class*="author"],[class*="byline"]').length),
    hasCtaButton:       !!($('a,button').filter((_, el) => {
                          const text = ($(el).text() || '').toLowerCase();
                          return /get started|sign up|free trial|book|schedule|contact|call now|get a quote|request|download/.test(text);
                        }).length),
    structuredDataTypes: (() => {
      const types = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html());
          if (data['@type']) types.push(Array.isArray(data['@type']) ? data['@type'] : [data['@type']]);
        } catch {}
      });
      return types.flat();
    })(),
  };
}

async function crawlSite(startUrl, maxPages = MAX_PAGES) {
  const origin  = new URL(startUrl).origin;
  const start   = normalizeUrl(startUrl, startUrl);
  const queue   = [start];
  const visited = new Set();
  const pages   = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url) || !isHtmlPage(url)) continue;
    visited.add(url);

    const { html, status, finalUrl, ok, error } = await fetchPage(url);
    const page = { url, finalUrl, status, ok, error: error || null, metrics: null };

    if (ok && html) {
      const $ = cheerio.load(html);
      page.metrics = extractPageMetrics($, html, url, origin);
      for (const link of extractInternalLinks($, url, origin)) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    pages.push(page);
    await new Promise(r => setTimeout(r, 250));
  }

  return pages;
}

async function checkAuxFiles(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const [robots, sitemap] = await Promise.all([
    fetchPage(origin + '/robots.txt'),
    fetchPage(origin + '/sitemap.xml'),
  ]);
  return {
    hasRobotsTxt: robots.ok && robots.html.length > 10,
    hasSitemap:   sitemap.ok && sitemap.html.length > 50,
  };
}

module.exports = { crawlSite, checkAuxFiles, isHtmlPage, MAX_PAGES };
