// ════════════════════════════════════════════════════
//  RedCube SEO Audit — Backend Server v2
//  Stack: Node.js + Express + Cheerio + Supabase + Resend
//  Deploy: Railway / Render / Fly.io (all free tiers work)
// ════════════════════════════════════════════════════

// node-fetch v2 is CommonJS-compatible and avoids Node 18 undici/File issues
const fetch   = require('node-fetch');
global.fetch  = fetch; // polyfill for supabase-js which also calls fetch internally

const express = require('express');
const cors    = require('cors');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');
const { v4: uuidv4 }   = require('uuid');

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4mb' }));

// ── ENV VARS (set in Railway / Render dashboard) ─────
// SUPABASE_URL            = https://xxxx.supabase.co
// SUPABASE_SERVICE_KEY     = your-service-role-key  ← use this, NOT the anon key
// RESEND_API_KEY          = re_xxxxxxxx
// PUBLIC_RESULTS_BASE_URL = https://your-frontend.com/results
// PORT                    = 3001  (auto-set by most platforms)
// ─────────────────────────────────────────────────────

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);

// ══════════════════════════════════════════════════════
//  CRAWLER — fetches up to 10 pages using cheerio
// ══════════════════════════════════════════════════════

const MAX_PAGES      = 10;
const FETCH_TIMEOUT  = 8000;

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RedCubeSEOBot/1.0; +https://redcube.co)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    const html = await res.text();
    return { html, status: res.status, finalUrl: res.url, ok: res.ok };
  } catch (e) {
    return { html: '', status: 0, finalUrl: url, ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.toString().replace(/\/$/, '') || u.toString();
  } catch { return null; }
}

// File extensions that are never HTML pages — skip them entirely
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
    const pathname = new URL(url).pathname.toLowerCase();
    // Strip query string for extension check
    const clean = pathname.split('?')[0];
    const lastSegment = clean.split('/').pop();
    const dot = lastSegment.lastIndexOf('.');
    if (dot === -1) return true; // no extension = likely a page (e.g. /about)
    const ext = lastSegment.slice(dot + 1);
    return !NON_PAGE_EXTENSIONS.has(ext);
  } catch { return false; }
}

function extractInternalLinks($, pageUrl, origin) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // Skip non-navigational hrefs
    if (!href
      || href.startsWith('mailto:')
      || href.startsWith('tel:')
      || href.startsWith('javascript:')
      || href.startsWith('#')
      || href.startsWith('data:')
      || href.startsWith('ftp:')
    ) return;
    const normalized = normalizeUrl(href, pageUrl);
    // Must be same origin AND must look like an HTML page
    if (normalized && normalized.startsWith(origin) && isHtmlPage(normalized)) {
      links.add(normalized);
    }
  });
  return links;
}

async function crawlSite(startUrl, maxPages = MAX_PAGES) {
  const origin  = new URL(startUrl).origin;
  const start   = normalizeUrl(startUrl, startUrl);
  const queue   = [start];
  const visited = new Set();
  const pages   = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    if (!isHtmlPage(url)) continue; // skip images, PDFs, assets
    visited.add(url);

    const { html, status, finalUrl, ok, error } = await fetchPage(url);
    const page = { url, finalUrl, status, ok, error: error || null, metrics: null };

    if (ok && html) {
      const $ = cheerio.load(html);

      page.metrics = {
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
      };

      // Queue internal links for crawling
      for (const link of extractInternalLinks($, url, origin)) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    pages.push(page);
    await new Promise(r => setTimeout(r, 250)); // polite delay
  }

  return pages;
}

async function checkAuxFiles(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const [robots, sitemap] = await Promise.all([
    fetchPage(origin + '/robots.txt'),
    fetchPage(origin + '/sitemap.xml')
  ]);
  return {
    hasRobotsTxt: robots.ok && robots.html.length > 10,
    hasSitemap:   sitemap.ok && sitemap.html.length > 50,
  };
}

// ══════════════════════════════════════════════════════
//  SEO SCORER — deterministic scoring from crawl data
// ══════════════════════════════════════════════════════

function scoreToStatus(s) {
  return s >= 90 ? 'Great' : s >= 75 ? 'Good' : s >= 60 ? 'Okay' : s >= 40 ? 'Needs Work' : 'Poor';
}

function scoreSite(pages, aux, startUrl) {
  const hm  = (pages[0] || {}).metrics || {};
  const all = pages.map(p => p.metrics).filter(Boolean);
  const n   = all.length || 1;
  const isHttps = startUrl.startsWith('https://');

  // ── FINDABILITY ──────────────────────────────────
  let findScore = 100;
  const findFindings = [];

  const missingTitle = pages.length - all.filter(m => m.title && m.titleLength > 5).length;
  if (missingTitle > 0) {
    findScore -= missingTitle * 8;
    findFindings.push({ type: 'fail', text: `${missingTitle} of your ${pages.length} scanned pages are missing a page title — one of the most important things Google looks at to understand your content.` });
  } else {
    findFindings.push({ type: 'pass', text: `All scanned pages have a title tag — Google can clearly identify what each page is about.` });
  }

  const badTitleLen = all.filter(m => m.titleLength > 60 || (m.titleLength > 0 && m.titleLength < 30)).length;
  if (badTitleLen > 0) {
    findScore -= Math.min(20, badTitleLen * 5);
    findFindings.push({ type: 'warn', text: `${badTitleLen} page title(s) are either too short or too long. Ideal titles are 30–60 characters so they display perfectly in Google search results without getting cut off.` });
  }

  const missingDesc = pages.length - all.filter(m => m.metaDescLen > 20).length;
  if (missingDesc > 0) {
    findScore -= missingDesc * 6;
    findFindings.push({ type: 'fail', text: `${missingDesc} page(s) are missing a meta description — the short preview text that appears under your link in Google. These directly influence whether someone clicks on your result.` });
  } else {
    findFindings.push({ type: 'pass', text: `Every scanned page has a meta description, helping Google show a compelling preview of your pages in search results.` });
  }

  if (!aux.hasRobotsTxt) { findScore -= 10; findFindings.push({ type: 'warn', text: `Your site is missing a robots.txt file. This file guides Google's crawlers through your site — without it, Google has to guess which pages to visit.` }); }
  else findFindings.push({ type: 'pass', text: `A robots.txt file is in place, helping guide Google's crawlers efficiently through your site.` });

  if (!aux.hasSitemap) { findScore -= 12; findFindings.push({ type: 'fail', text: `No sitemap.xml was found. A sitemap is essentially a map for Google listing all your pages — without it, some pages may never show up in search results.` }); }
  else findFindings.push({ type: 'pass', text: `A sitemap.xml was found, ensuring Google discovers and indexes all your pages — not just the ones it stumbles across.` });

  if (hm.hasNoindex) { findScore -= 30; findFindings.push({ type: 'fail', text: `Your homepage has a "noindex" tag — this is actively telling Google NOT to show it in search results. This is a critical issue that needs immediate attention.` }); }

  findScore = Math.max(0, Math.min(100, findScore));

  // ── PAGE SPEED (proxy scoring — no real perf API needed) ─
  let speedScore = 68;
  const speedFindings = [];

  const avgSize = all.reduce((s, m) => s + (m.htmlSize || 0), 0) / n;
  if (avgSize > 500000) {
    speedScore -= 20;
    speedFindings.push({ type: 'fail', text: `Your pages are quite large (averaging ${Math.round(avgSize / 1024)}KB of HTML). Large, heavy pages load slowly, and Google penalizes slow-loading sites in its rankings.` });
  } else if (avgSize > 200000) {
    speedScore -= 8;
    speedFindings.push({ type: 'warn', text: `Your pages are moderately sized (averaging ${Math.round(avgSize / 1024)}KB). Trimming unnecessary code and compressing images could improve your load speed and rankings.` });
  } else {
    speedScore += 10;
    speedFindings.push({ type: 'pass', text: `Your page HTML is lean (averaging ${Math.round(avgSize / 1024)}KB), which is a good indicator of a fast-loading site.` });
  }

  if (hm.hasGoogleAnalytics) {
    speedFindings.push({ type: 'pass', text: `Google Analytics or Tag Manager is installed — you're tracking visitor behavior and can make data-driven decisions about your site.` });
  } else {
    speedFindings.push({ type: 'warn', text: `No Google Analytics or Tag Manager was detected. Without tracking, you're flying blind — you can't see how many visitors you're getting or where they come from.` });
  }

  if (hm.hasStructuredData) {
    speedScore += 8;
    speedFindings.push({ type: 'pass', text: `Your site uses structured data, which can earn you "rich results" in Google — like star ratings, FAQs, or business hours displayed right in search results.` });
  } else {
    speedScore -= 8;
    speedFindings.push({ type: 'warn', text: `No structured data was found. Adding Schema markup can help your business appear with enhanced listings in Google (like ratings, hours, or service areas).` });
  }

  speedScore = Math.max(0, Math.min(100, speedScore));

  // ── MOBILE FRIENDLINESS ──────────────────────────
  let mobileScore = 100;
  const mobileFindings = [];

  if (hm.isMobileOptimized) {
    mobileFindings.push({ type: 'pass', text: `Your site has a mobile viewport configured correctly — it's set up to display properly on phones and tablets.` });
  } else {
    mobileScore -= 40;
    mobileFindings.push({ type: 'fail', text: `Your site is missing a mobile viewport setting. This means it likely looks broken or tiny on phones — a major problem since most Google searches happen on mobile devices.` });
  }

  if (hm.lang) {
    mobileFindings.push({ type: 'pass', text: `Your site specifies a language (${hm.lang}), which helps Google serve your pages to the right audience.` });
  } else {
    mobileScore -= 8;
    mobileFindings.push({ type: 'warn', text: `Your site doesn't declare a language. Setting this helps Google correctly identify and rank your content for your target audience.` });
  }

  if (hm.ogImage) {
    mobileFindings.push({ type: 'pass', text: `A social share image is configured. When someone shares your site on Facebook or sends it in a text message, a proper image preview will appear.` });
  } else {
    mobileScore -= 10;
    mobileFindings.push({ type: 'warn', text: `No social share image (og:image) was found. Without it, your site shows a blank preview when shared on Facebook, LinkedIn, or in iMessages.` });
  }

  mobileScore = Math.max(0, Math.min(100, mobileScore));

  // ── TRUST & SECURITY ─────────────────────────────
  let trustScore = 100;
  const trustFindings = [];

  if (!isHttps) {
    trustScore -= 40;
    trustFindings.push({ type: 'fail', text: `Your site is not using HTTPS (the padlock icon in browsers). Google actively penalizes unsecured sites and warns visitors that your site may not be safe.` });
  } else {
    trustFindings.push({ type: 'pass', text: `Your site uses HTTPS — it's secure. Google gives a ranking boost to secure sites, and visitors see the trust-building padlock in their browser.` });
  }

  const withCanonical = all.filter(m => m.canonical && m.canonical.length > 5).length;
  if (withCanonical < n / 2) {
    trustScore -= 12;
    trustFindings.push({ type: 'warn', text: `Most pages are missing canonical tags. Without these, Google might treat duplicate versions of the same page as separate pages, splitting your ranking power and hurting your position.` });
  } else {
    trustFindings.push({ type: 'pass', text: `Canonical tags are in place on most pages, preventing duplicate content issues that can dilute your search rankings.` });
  }

  if (hm.ogTitle && hm.ogDesc) {
    trustFindings.push({ type: 'pass', text: `Social media preview tags (Open Graph) are properly configured — your site looks professional and polished when shared on any platform.` });
  } else {
    trustScore -= 10;
    trustFindings.push({ type: 'warn', text: `Social media preview tags are incomplete. When your site is shared on Facebook or other platforms, it may show a blank or randomly selected image instead of a controlled preview.` });
  }

  if (hm.hasStructuredData) {
    trustFindings.push({ type: 'pass', text: `Structured data is present on your homepage, helping Google understand your business name, address, services, and more.` });
  } else {
    trustScore -= 10;
    trustFindings.push({ type: 'warn', text: `No structured business data was found. Adding this tells Google exactly who you are and what you do — especially important for local search results.` });
  }

  trustScore = Math.max(0, Math.min(100, trustScore));

  // ── CONTENT QUALITY ──────────────────────────────
  let contentScore = 100;
  const contentFindings = [];

  const noH1    = all.filter(m => m.h1Count === 0).length;
  const multiH1 = all.filter(m => m.h1Count > 1).length;
  if (noH1 > 0) {
    contentScore -= noH1 * 8;
    contentFindings.push({ type: 'fail', text: `${noH1} page(s) have no main heading (H1 tag). Every page needs one clear headline — it signals to both visitors and Google what the page is primarily about.` });
  } else if (multiH1 > 0) {
    contentScore -= multiH1 * 5;
    contentFindings.push({ type: 'warn', text: `${multiH1} page(s) have more than one main heading. Each page should have exactly one H1 to clearly communicate its main topic to Google.` });
  } else {
    contentFindings.push({ type: 'pass', text: `Every scanned page has exactly one main heading — perfect for clearly signaling each page's topic to Google.` });
  }

  const avgWords = Math.round(all.reduce((s, m) => s + (m.wordCount || 0), 0) / n);
  if (avgWords < 200) {
    contentScore -= 15;
    contentFindings.push({ type: 'warn', text: `Your pages average only ${avgWords} words of content. Google tends to rank pages with more helpful, relevant content higher — consider expanding your key pages.` });
  } else if (avgWords < 400) {
    contentScore -= 5;
    contentFindings.push({ type: 'warn', text: `Your pages average ${avgWords} words. Adding more depth to key pages can meaningfully improve how Google ranks them.` });
  } else {
    contentFindings.push({ type: 'pass', text: `Your pages have solid content depth (averaging ${avgWords} words), giving Google plenty of context to rank your pages well.` });
  }

  const totalImgs  = all.reduce((s, m) => s + (m.imageCount || 0), 0);
  const missingAlt = all.reduce((s, m) => s + (m.imagesWithoutAlt || 0), 0);
  if (missingAlt > 0 && totalImgs > 0) {
    contentScore -= Math.min(20, Math.round((missingAlt / totalImgs) * 30));
    contentFindings.push({ type: 'warn', text: `${missingAlt} image(s) are missing alt text descriptions. Alt text tells Google what an image shows — it's both an SEO factor and an accessibility requirement.` });
  } else if (totalImgs > 0) {
    contentFindings.push({ type: 'pass', text: `All images have descriptive alt text — great for both accessibility and helping Google understand your visual content.` });
  }

  contentScore = Math.max(0, Math.min(100, contentScore));

  // ── LINKS & NAVIGATION ───────────────────────────
  let navScore = 100;
  const navFindings = [];

  if (hm.hasNavElement) {
    navFindings.push({ type: 'pass', text: `Your site has a proper navigation menu, making it easy for both visitors and Google to explore your pages.` });
  } else {
    navScore -= 15;
    navFindings.push({ type: 'warn', text: `No navigation menu was detected. A clear menu is essential for helping visitors find what they need — and for Google to discover all your pages.` });
  }

  if (hm.hasFooter) {
    navFindings.push({ type: 'pass', text: `Your site has a footer with supporting links, which helps both site structure and visitor trust.` });
  } else {
    navScore -= 8;
    navFindings.push({ type: 'warn', text: `No footer was detected. A footer with key links (like Contact, Privacy Policy, and Services) improves both trust and site structure for Google.` });
  }

  const avgInternal = Math.round(all.reduce((s, m) => s + (m.internalLinks || 0), 0) / n);
  if (avgInternal < 3) {
    navScore -= 15;
    navFindings.push({ type: 'warn', text: `Your pages average only ${avgInternal} internal links. Adding more links between your own pages helps Google discover all your content and keeps visitors exploring your site longer.` });
  } else {
    navFindings.push({ type: 'pass', text: `Pages link well to other pages within your site (averaging ${avgInternal} internal links), helping Google crawl your full site effectively.` });
  }

  const failedPages = pages.filter(p => !p.ok && p.status >= 400).length;
  if (failedPages > 0) {
    navScore -= failedPages * 10;
    navFindings.push({ type: 'fail', text: `${failedPages} page(s) returned errors (like "404 Not Found"). Broken pages frustrate visitors and signal to Google that your site isn't well-maintained.` });
  } else {
    navFindings.push({ type: 'pass', text: `All ${pages.filter(p => p.ok).length} scanned pages loaded successfully — no broken pages sending visitors to dead ends.` });
  }

  navScore = Math.max(0, Math.min(100, navScore));

  // ── OVERALL ──────────────────────────────────────
  const overall = Math.round(
    findScore    * 0.25 +
    speedScore   * 0.15 +
    mobileScore  * 0.20 +
    trustScore   * 0.20 +
    contentScore * 0.12 +
    navScore     * 0.08
  );

  const grade = overall >= 95 ? 'A+' : overall >= 90 ? 'A' : overall >= 85 ? 'B+' :
                overall >= 75 ? 'B'  : overall >= 65 ? 'C+' : overall >= 55 ? 'C' :
                overall >= 40 ? 'D'  : 'F';

  const gradeSummaries = {
    'A+': "Outstanding! Your site is in excellent SEO shape and should be performing very well in Google. Keep doing what you're doing.",
    'A':  "Great work — your site is well-optimized and performing well. A few small improvements could push you even higher in the rankings.",
    'B+': "Your site is in good shape with some clear opportunities to improve. Fixing the items flagged below could meaningfully increase your Google visibility.",
    'B':  "Your site has a solid foundation but there are gaps holding you back. Addressing the issues below could lead to noticeable improvements in rankings and traffic.",
    'C+': "Your site has the basics covered but is missing several things Google looks for. There's real potential here — the right improvements could make a big difference.",
    'C':  "There are SEO issues on your site that are likely costing you visibility in Google. The good news: most of these are fixable without rebuilding your site.",
    'D':  "Your site has significant SEO gaps that are almost certainly costing you customers every day. Several important issues need to be addressed soon.",
    'F':  "Your site has critical SEO problems preventing it from showing up properly in Google. Immediate attention is needed — but these issues can be fixed."
  };

  const domain = (() => { try { return new URL(startUrl).hostname.replace('www.', ''); } catch { return startUrl; } })();

  return {
    overallScore: overall,
    grade,
    gradeSummary: gradeSummaries[grade],
    domain,
    pagesScanned: pages.length,
    pageUrls: pages.map(p => p.url),
    categories: [
      { name: 'Findability',         icon: '🔍', score: findScore,    status: scoreToStatus(findScore),    findings: findFindings.slice(0, 5) },
      { name: 'Page Speed',          icon: '⚡', score: speedScore,   status: scoreToStatus(speedScore),   findings: speedFindings.slice(0, 5) },
      { name: 'Mobile Friendliness', icon: '📱', score: mobileScore,  status: scoreToStatus(mobileScore),  findings: mobileFindings.slice(0, 5) },
      { name: 'Trust & Security',    icon: '🔒', score: trustScore,   status: scoreToStatus(trustScore),   findings: trustFindings.slice(0, 5) },
      { name: 'Content Quality',     icon: '📝', score: contentScore, status: scoreToStatus(contentScore), findings: contentFindings.slice(0, 5) },
      { name: 'Links & Navigation',  icon: '🔗', score: navScore,     status: scoreToStatus(navScore),     findings: navFindings.slice(0, 5) }
    ]
  };
}

// ══════════════════════════════════════════════════════
//  POST /api/audit
// ══════════════════════════════════════════════════════
app.post('/api/audit', async (req, res) => {
  let { email, url, name } = req.body;
  if (!email || !url) return res.status(400).json({ error: 'email and url are required' });

  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  try {
    console.log(`[audit] Crawling ${url} for ${email}`);
    const [pages, aux] = await Promise.all([
      crawlSite(url),
      checkAuxFiles(url)
    ]);
    console.log(`[audit] Crawled ${pages.length} pages`);

    const result = scoreSite(pages, aux, url);
    console.log(`[audit] Grade: ${result.grade} (${result.overallScore})`);

    const reportId = uuidv4();
    const { error: dbErr } = await supabase.from('seo_reports').insert({
      id: reportId, email, name: name || null, url,
      domain: result.domain, grade: result.grade,
      overall_score: result.overallScore,
      pages_scanned: result.pagesScanned,
      report_data: result,
      created_at: new Date().toISOString()
    });
    if (dbErr) throw new Error('DB error: ' + dbErr.message);

    const resultsUrl = `${process.env.PUBLIC_RESULTS_BASE_URL}/${reportId}`;
    await sendResultsEmail({ email, name, url, auditResult: result, resultsUrl });

    res.json({ success: true, reportId, resultsUrl, grade: result.grade, score: result.overallScore });
  } catch (err) {
    console.error('[audit]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════
//  GET /api/report/:id
// ══════════════════════════════════════════════════════
app.get('/api/report/:id', async (req, res) => {
  const { data, error } = await supabase.from('seo_reports')
    .select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Report not found' });
  res.json(data);
});

app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/favicon.ico', (_, res) => res.status(204).end());

// ══════════════════════════════════════════════════════
//  EMAIL
// ══════════════════════════════════════════════════════
async function sendResultsEmail({ email, name, url, auditResult, resultsUrl }) {
  const BRAND_RED   = '#CC0000';
  const BRAND_BLACK = '#111111';
  const BRAND_DARK  = '#1a1a1a';
  const BRAND_CARD  = '#222222';
  const BRAND_BORDER= '#2e2e2e';
  const LOGO_URL    = 'https://redcube.co/wp-content/uploads/2019/10/RedCubeLogo_Website-1030x327.png';

  const gradeColor = {
    'A+':'#22c55e','A':'#22c55e','B+':'#84cc16','B':'#84cc16',
    'C+':'#f59e0b','C':'#f97316','D':'#ef4444','F':'#dc2626'
  }[auditResult.grade] || '#888888';

  const statusColor = {
    'Great': '#22c55e', 'Good': '#84cc16', 'Okay': '#f59e0b',
    'Needs Work': '#f97316', 'Poor': '#ef4444'
  };
  const statusBg = {
    'Great': 'rgba(34,197,94,.12)', 'Good': 'rgba(132,204,22,.12)',
    'Okay': 'rgba(245,158,11,.12)', 'Needs Work': 'rgba(249,115,22,.12)',
    'Poor': 'rgba(239,68,68,.12)'
  };

  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';

  const catRows = (auditResult.categories || []).map(c => {
    const sc = statusColor[c.status] || '#888';
    const sb = statusBg[c.status]   || 'rgba(136,136,136,.12)';
    const barW = c.score + '%';
    const barC = c.score >= 85 ? '#22c55e' : c.score >= 70 ? '#84cc16' : c.score >= 55 ? '#f59e0b' : c.score >= 40 ? '#f97316' : '#ef4444';
    return `
    <tr>
      <td colspan="2" style="padding:0;border-bottom:1px solid #2e2e2e;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:14px 0 8px;font-family:Arial,sans-serif;">
              <span style="font-size:16px;">${c.icon}</span>
              <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#ffffff;margin-left:8px;">${c.name}</span>
              <span style="display:inline-block;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;margin-left:8px;background:${sb};color:${sc};border:1px solid ${sc}33;">${c.status}</span>
            </td>
            <td style="padding:14px 0 8px;text-align:right;font-family:Arial,sans-serif;">
              <span style="font-size:15px;font-weight:900;color:${barC};">${c.score}/100</span>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:0 0 14px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2e2e2e;height:3px;padding:0;">
                    <div style="background:${barC};height:3px;width:${barW};font-size:0;">&nbsp;</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your SEO Audit Report — RedCube</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

  <!-- TOP ACCENT BAR -->
  <tr><td style="background:${BRAND_RED};height:3px;font-size:0;">&nbsp;</td></tr>

  <!-- HEADER -->
  <tr><td style="background:#111111;padding:28px 36px;border-left:1px solid ${BRAND_BORDER};border-right:1px solid ${BRAND_BORDER};" bgcolor="#111111">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <table cellpadding="0" cellspacing="0" style="background:#111111;" bgcolor="#111111"><tr><td style="padding:0;background:#111111;" bgcolor="#111111"><img src="${LOGO_URL}" alt="RedCube Creative" width="160" style="display:block;height:auto;max-width:160px;border:0;"></td></tr></table>
        </td>
        <td style="text-align:right;">
          <span style="font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#555555;">SEO Audit Report</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- GRADE HERO -->
  <tr><td style="background:${BRAND_DARK};padding:44px 36px;text-align:center;border-left:1px solid ${BRAND_BORDER};border-right:1px solid ${BRAND_BORDER};border-bottom:1px solid ${BRAND_BORDER};">
    <p style="margin:0 0 20px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#555555;">${auditResult.domain} &nbsp;·&nbsp; ${auditResult.pagesScanned} pages scanned</p>
    <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;">
      <tr><td style="border:2px solid #2e2e2e;border-radius:50%;width:150px;height:150px;text-align:center;vertical-align:middle;">
        <div style="font-size:72px;font-weight:900;line-height:1;color:${gradeColor};font-family:Arial,sans-serif;">${auditResult.grade}</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#555555;margin-top:4px;">${auditResult.overallScore} / 100</div>
      </td></tr>
    </table>
    <p style="margin:0 auto;max-width:420px;font-size:14px;color:#888888;line-height:1.75;">${auditResult.gradeSummary}</p>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:${BRAND_CARD};padding:36px;border-left:1px solid ${BRAND_BORDER};border-right:1px solid ${BRAND_BORDER};border-bottom:1px solid ${BRAND_BORDER};">

    <p style="margin:0 0 6px;font-size:14px;color:#cccccc;line-height:1.7;">${greeting}</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888888;line-height:1.75;">Your free SEO audit for <strong style="color:#cccccc;">${url}</strong> is complete. We scanned <strong style="color:#cccccc;">${auditResult.pagesScanned} pages</strong> and here's how each area performed:</p>

    <!-- CATEGORY SCORES -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td colspan="2" style="padding:0 0 12px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#555555;border-bottom:1px solid ${BRAND_RED};padding-bottom:6px;display:inline-block;">Score Breakdown</span>
      </td></tr>
      ${catRows}
    </table>

    <!-- CTA BUTTON -->
    <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 28px;">
      <tr><td style="background:${BRAND_RED};border-radius:3px;">
        <a href="${resultsUrl}" style="display:inline-block;padding:16px 40px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ffffff;text-decoration:none;">View Your Full Report →</a>
      </td></tr>
    </table>
    <p style="text-align:center;margin:0 0 32px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#555555;">Your report is saved at this link and will not expire</p>

    <!-- CONSULT CTA -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:${BRAND_BLACK};border-top:3px solid ${BRAND_RED};padding:28px;border-radius:0 0 3px 3px;">
        <p style="margin:0 0 4px;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${BRAND_RED};">Next Step</p>
        <p style="margin:0 0 12px;font-size:16px;font-weight:900;letter-spacing:-.01em;text-transform:uppercase;color:#ffffff;line-height:1.2;">Let's Turn That Grade Into an A</p>
        <p style="margin:0 0 20px;font-size:13px;color:#888888;line-height:1.75;">RedCube specializes in helping local businesses rank higher on Google and turn visitors into customers. Schedule a free 15-minute call and let's review your results together.</p>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:${BRAND_RED};border-radius:3px;">
            <a href="https://redcube.co/contact" style="display:inline-block;padding:12px 24px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#ffffff;text-decoration:none;">Schedule a Free Consult →</a>
          </td></tr>
        </table>
        <p style="margin:12px 0 0;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#444444;">(678) 877-0609 &nbsp;·&nbsp; No commitment required</p>
      </td></tr>
    </table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0a0a0a;padding:20px 36px;border:1px solid ${BRAND_BORDER};border-top:none;" bgcolor="#0a0a0a">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <table cellpadding="0" cellspacing="0" style="background:#0a0a0a;" bgcolor="#0a0a0a"><tr><td style="padding:0;background:#0a0a0a;" bgcolor="#0a0a0a"><img src="${LOGO_URL}" alt="RedCube Creative" width="100" style="display:block;height:auto;max-width:100px;opacity:.5;border:0;"></td></tr></table>
        </td>
        <td style="text-align:right;vertical-align:middle;">
          <p style="margin:0;font-size:10px;color:#444444;line-height:1.7;">
            Report generated at your request.<br>
            No spam — ever. &nbsp;<a href="mailto:hello@redcube.co" style="color:#555555;text-decoration:none;">hello@redcube.co</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- BOTTOM ACCENT BAR -->
  <tr><td style="background:${BRAND_RED};height:3px;font-size:0;">&nbsp;</td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;

  await resend.emails.send({
    from: 'RedCube SEO <hello@redcube.co>',
    to: email,
    replyTo: 'hello@redcube.co',
    subject: `Your SEO Report: ${auditResult.domain} scored ${auditResult.grade} (${auditResult.overallScore}/100)`,
    html
  });
}

const JWT_SECRET = process.env.JWT_SECRET || 'redcube-seo-secret-change-me';

// ── ADMIN AUTH MIDDLEWARE ─────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /admin/login ─────────────────────────────
app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data: users, error } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error || !users?.length) return res.status(401).json({ error: 'Invalid credentials' });
  const user = users[0];

  const hash = crypto.createHash('sha256').update(password + user.salt).digest('hex');
  if (hash !== user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// ── GET /admin/sites ──────────────────────────────
app.get('/admin/sites', requireAuth, async (req, res) => {
  const { data: sitesRaw, error } = await supabase
    .from('managed_sites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Attach aggregate counts
  const sites = await Promise.all((sitesRaw || []).map(async site => {
    const [{ count: openTasks }, { count: kwCount }, { count: draftCount }] = await Promise.all([
      supabase.from('checklist_items').select('*', { count: 'exact', head: true }).eq('site_id', site.id).eq('done', false),
      supabase.from('site_keywords').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
      supabase.from('content_drafts').select('*', { count: 'exact', head: true }).eq('site_id', site.id).neq('status', 'published'),
    ]);
    return { ...site, open_tasks: openTasks || 0, keyword_count: kwCount || 0, draft_count: draftCount || 0 };
  }));
  res.json({ sites });
});

// ── POST /admin/sites ─────────────────────────────
app.post('/admin/sites', requireAuth, async (req, res) => {
  const { name, url, platform, client_email, notes } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  let cleanUrl = url.trim();
  if (!/^https?:\/\//.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
  const domain = (() => { try { return new URL(cleanUrl).hostname.replace('www.', ''); } catch { return cleanUrl; } })();

  const { data, error } = await supabase.from('managed_sites').insert({
    name, url: cleanUrl, domain, platform, client_email, notes,
    created_by: req.user.id,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ site: data });
});

// ── DELETE /admin/sites/:id ───────────────────────
app.delete('/admin/sites/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  // Cascade delete related data
  await Promise.all([
    supabase.from('site_pages').delete().eq('site_id', id),
    supabase.from('checklist_items').delete().eq('site_id', id),
    supabase.from('site_keywords').delete().eq('site_id', id),
    supabase.from('content_drafts').delete().eq('site_id', id),
    supabase.from('site_audits').delete().eq('site_id', id),
  ]);
  await supabase.from('managed_sites').delete().eq('id', id);
  res.json({ success: true });
});

// ── GET /admin/sites/:id/pages ────────────────────
app.get('/admin/sites/:id/pages', requireAuth, async (req, res) => {
  const { data: pages, error } = await supabase
    .from('site_pages')
    .select('*')
    .eq('site_id', req.params.id)
    .order('score', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pages: pages || [] });
});

// ── GET /admin/sites/:id/checklist ───────────────
app.get('/admin/sites/:id/checklist', requireAuth, async (req, res) => {
  const { data: items, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('site_id', req.params.id)
    .order('priority_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: items || [] });
});

// ── PATCH /admin/checklist/:id ────────────────────
app.patch('/admin/checklist/:id', requireAuth, async (req, res) => {
  const { done } = req.body;
  const updates = { done, completed_at: done ? new Date().toISOString() : null, completed_by: req.user.id };
  const { data, error } = await supabase.from('checklist_items').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: data });
});

// ── POST /admin/sites/:id/audit ───────────────────
app.post('/admin/sites/:id/audit', requireAuth, async (req, res) => {
  const siteId = req.params.id;
  const { data: site, error: siteErr } = await supabase.from('managed_sites').select('*').eq('id', siteId).single();
  if (siteErr || !site) return res.status(404).json({ error: 'Site not found' });

  try {
    console.log(`[admin-audit] Starting full crawl of ${site.url}`);

    // Full crawl — up to 100 pages for managed sites
    const ADMIN_MAX_PAGES = 100;
    const [pages, aux] = await Promise.all([
      crawlSite(site.url, ADMIN_MAX_PAGES),
      checkAuxFiles(site.url)
    ]);
    console.log(`[admin-audit] Crawled ${pages.length} pages`);

    const result = scoreSite(pages, aux, site.url);

    // Store audit record
    const { data: audit } = await supabase.from('site_audits').insert({
      site_id: siteId,
      grade: result.grade,
      overall_score: result.overallScore,
      pages_crawled: pages.length,
      report_data: result,
      crawled_by: req.user.id,
      created_at: new Date().toISOString()
    }).select().single();

    // Upsert individual pages
    const pageInserts = pages.filter(p => p.ok && p.metrics).map(p => {
      const m = p.metrics;
      const pageScore = scoreOnePage(m);
      const pageType  = detectPageType(p.url, m);
      return {
        site_id:     siteId,
        url:         p.url,
        title:       m.title || '',
        score:       pageScore,
        type:        pageType,
        word_count:  m.wordCount || 0,
        h1_text:     m.h1Text || '',
        has_meta:    m.metaDescLen > 20,
        has_h1:      m.h1Count === 1,
        is_https:    m.isHttps,
        is_mobile:   m.isMobileOptimized,
        issues:      getPageIssues(m),
        last_crawled: new Date().toISOString()
      };
    });

    // Delete old pages for this site then insert fresh
    await supabase.from('site_pages').delete().eq('site_id', siteId);
    if (pageInserts.length) {
      await supabase.from('site_pages').insert(pageInserts);
    }

    // Regenerate checklist
    await supabase.from('checklist_items').delete().eq('site_id', siteId).eq('auto_generated', true);
    const checklistItems = generateChecklist(pages, aux, result, siteId);
    if (checklistItems.length) {
      await supabase.from('checklist_items').insert(checklistItems);
    }

    // Update site record
    await supabase.from('managed_sites').update({
      last_audit:    new Date().toISOString(),
      last_grade:    result.grade,
      last_score:    result.overallScore,
      pages_crawled: pages.length,
    }).eq('id', siteId);

    res.json({ success: true, grade: result.grade, score: result.overallScore, pages_crawled: pages.length });
  } catch (err) {
    console.error('[admin-audit]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PAGE SCORING (per-page score, stricter than site score) ──
function scoreOnePage(m) {
  let s = 100;
  if (!m.title || m.titleLength < 5)   s -= 20;
  else if (m.titleLength < 30)          s -= 8;
  else if (m.titleLength > 60)          s -= 5;
  if (m.metaDescLen < 20)               s -= 15;
  else if (m.metaDescLen > 160)         s -= 5;
  if (m.h1Count === 0)                  s -= 18;
  else if (m.h1Count > 1)              s -= 8;
  if (!m.isMobileOptimized)            s -= 15;
  if (!m.isHttps)                      s -= 20;
  if (m.wordCount < 200)               s -= 12;
  else if (m.wordCount < 400)          s -= 5;
  if (m.imagesWithoutAlt > 0)          s -= Math.min(10, m.imagesWithoutAlt * 3);
  if (!m.canonical)                    s -= 5;
  if (m.hasNoindex)                    s -= 30;
  return Math.max(0, Math.min(100, s));
}

function detectPageType(url, m) {
  const path = url.toLowerCase();
  if (/\/blog\/|\/post\/|\/article\/|\/news\/|\d{4}\/\d{2}\//.test(path)) return 'post';
  if (/\/landing\/|\/lp\/|-lp\b|\/campaign\//.test(path)) return 'landing';
  return 'page';
}

function getPageIssues(m) {
  const issues = [];
  if (!m.title || m.titleLength < 5)  issues.push('Missing title tag');
  if (m.titleLength > 60)             issues.push('Title too long');
  if (m.metaDescLen < 20)             issues.push('Missing meta description');
  if (m.h1Count === 0)                issues.push('No H1 heading');
  if (m.h1Count > 1)                  issues.push('Multiple H1 tags');
  if (!m.isMobileOptimized)           issues.push('Not mobile optimized');
  if (!m.isHttps)                     issues.push('Not HTTPS');
  if (m.wordCount < 200)              issues.push('Thin content');
  if (m.imagesWithoutAlt > 0)         issues.push(`${m.imagesWithoutAlt} images missing alt text`);
  if (m.hasNoindex)                   issues.push('Noindex tag present');
  if (!m.canonical)                   issues.push('No canonical tag');
  return issues;
}

// ── CHECKLIST GENERATOR ───────────────────────────
function generateChecklist(pages, aux, result, siteId) {
  const items = [];
  let order = 0;
  const add = (text, category, priority, pageUrl = null) => {
    items.push({
      site_id: siteId,
      text,
      category,
      priority,
      priority_order: order++,
      done: false,
      auto_generated: true,
      page_url: pageUrl,
      created_at: new Date().toISOString()
    });
  };

  const all = pages.filter(p => p.ok && p.metrics).map(p => ({ url: p.url, m: p.metrics }));

  // Findability
  if (!aux.hasSitemap)   add('Create and submit an XML sitemap to Google Search Console', 'Findability', 'high');
  if (!aux.hasRobotsTxt) add('Add a robots.txt file to guide Google\'s crawlers', 'Findability', 'high');

  all.filter(p => !p.m.title || p.m.titleLength < 5).forEach(p =>
    add(`Add a title tag to this page`, 'Findability', 'high', p.url));
  all.filter(p => p.m.titleLength > 60).forEach(p =>
    add(`Shorten title tag to under 60 characters (currently ${p.m.titleLength})`, 'Findability', 'med', p.url));
  all.filter(p => p.m.titleLength > 0 && p.m.titleLength < 30).forEach(p =>
    add(`Expand title tag to at least 30 characters (currently ${p.m.titleLength})`, 'Findability', 'med', p.url));
  all.filter(p => p.m.metaDescLen < 20).forEach(p =>
    add(`Write a meta description (150–160 chars) for this page`, 'Findability', 'high', p.url));
  all.filter(p => p.m.metaDescLen > 160).forEach(p =>
    add(`Shorten meta description to 160 chars or less (currently ${p.m.metaDescLen})`, 'Findability', 'low', p.url));

  // Content
  all.filter(p => p.m.h1Count === 0).forEach(p =>
    add(`Add a single H1 heading to this page`, 'Content', 'high', p.url));
  all.filter(p => p.m.h1Count > 1).forEach(p =>
    add(`Remove extra H1 tags — only one H1 allowed per page (found ${p.m.h1Count})`, 'Content', 'med', p.url));
  all.filter(p => p.m.wordCount < 300).forEach(p =>
    add(`Add more content — page has only ${p.m.wordCount} words, aim for 500+`, 'Content', 'high', p.url));
  all.filter(p => p.m.imagesWithoutAlt > 0).forEach(p =>
    add(`Add alt text to ${p.m.imagesWithoutAlt} image(s) on this page`, 'Content', 'med', p.url));
  all.filter(p => !p.m.hasStructuredData).slice(0, 5).forEach(p =>
    add(`Add Schema.org structured data markup to this page`, 'Content', 'med', p.url));

  // Technical
  if (!result.categories.find(c => c.name === 'Trust & Security')?.score >= 90) {
    all.filter(p => !p.m.isHttps).forEach(p =>
      add(`Migrate this page to HTTPS`, 'Technical', 'high', p.url));
    all.filter(p => !p.m.canonical).slice(0, 10).forEach(p =>
      add(`Add a canonical tag to prevent duplicate content issues`, 'Technical', 'med', p.url));
    all.filter(p => !p.m.ogImage).slice(0, 5).forEach(p =>
      add(`Add an Open Graph image tag for better social sharing`, 'Technical', 'low', p.url));
  }

  // Mobile
  all.filter(p => !p.m.isMobileOptimized).forEach(p =>
    add(`Add mobile viewport meta tag to this page`, 'Mobile', 'high', p.url));

  // Speed
  all.filter(p => (p.m.htmlSize || 0) > 300000).forEach(p =>
    add(`Reduce page weight — HTML is ${Math.round(p.m.htmlSize/1024)}KB, optimize images and minify code`, 'Speed', 'med', p.url));
  if (!all.some(p => p.m.hasGoogleAnalytics))
    add('Install Google Analytics or Google Tag Manager to track visitors', 'Speed', 'high');

  return items.slice(0, 100); // cap at 100 auto-generated items
}

// ── GET/POST /admin/sites/:id/keywords ───────────
app.get('/admin/sites/:id/keywords', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('site_keywords')
    .select('*').eq('site_id', req.params.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keywords: data || [] });
});

app.post('/admin/sites/:id/keywords', requireAuth, async (req, res) => {
  const { keyword, page_url } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  const { data, error } = await supabase.from('site_keywords').insert({
    site_id: req.params.id, keyword, page_url: page_url || null,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keyword: data });
});

app.get('/admin/keywords', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('site_keywords')
    .select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keywords: data || [] });
});

app.delete('/admin/keywords/:id', requireAuth, async (req, res) => {
  await supabase.from('site_keywords').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ── GET/POST /admin/sites/:id/content ─────────────
app.get('/admin/sites/:id/content', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('content_drafts')
    .select('*').eq('site_id', req.params.id).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ drafts: data || [] });
});

app.get('/admin/content', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('content_drafts')
    .select('*').order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ drafts: data || [] });
});

app.post('/admin/content', requireAuth, async (req, res) => {
  const { site_id, type, title, target_keyword, meta_description, body, status } = req.body;
  const wordCount = (body || '').split(/\s+/).filter(w => w.length > 2).length;
  const { data, error } = await supabase.from('content_drafts').insert({
    site_id, type, title, target_keyword, meta_description, body, status: status || 'draft',
    word_count: wordCount, created_by: req.user.id,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ draft: data });
});

app.patch('/admin/content/:id', requireAuth, async (req, res) => {
  const { title, target_keyword, meta_description, body, status, type, site_id } = req.body;
  const wordCount = (body || '').split(/\s+/).filter(w => w.length > 2).length;
  const { data, error } = await supabase.from('content_drafts').update({
    title, target_keyword, meta_description, body, status, type, site_id,
    word_count: wordCount, updated_at: new Date().toISOString()
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ draft: data });
});

// ── REPORTS ───────────────────────────────────────
app.get('/admin/reports', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('client_reports')
    .select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ reports: data || [] });
});

app.get('/admin/sites/:id/reports', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('client_reports')
    .select('*').eq('site_id', req.params.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ reports: data || [] });
});

app.post('/admin/sites/:id/reports', requireAuth, async (req, res) => {
  const siteId = req.params.id;
  const { data: site } = await supabase.from('managed_sites').select('*').eq('id', siteId).single();
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const { data: auditData } = await supabase.from('site_audits')
    .select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(1).single();

  const reportId = require('uuid').v4();
  const publicUrl = `${process.env.PUBLIC_RESULTS_BASE_URL}/${reportId}`;

  // Store a report record — the public results page will fetch /api/report/:id
  await supabase.from('client_reports').insert({
    id: reportId,
    site_id: siteId,
    site_name: site.name,
    grade: site.last_grade,
    score: site.last_score,
    pages_crawled: site.pages_crawled,
    public_url: publicUrl,
    report_data: auditData?.report_data || null,
    created_by: req.user.id,
    created_at: new Date().toISOString()
  });

  // Also store in seo_reports so the existing public viewer works
  await supabase.from('seo_reports').insert({
    id: reportId,
    email: site.client_email || 'noreply@redcube.co',
    url: site.url,
    domain: site.domain,
    grade: site.last_grade,
    overall_score: site.last_score,
    pages_scanned: site.pages_crawled,
    report_data: auditData?.report_data || null,
    created_at: new Date().toISOString()
  });

  res.json({ success: true, public_url: publicUrl, reportId });
});

// ── TEAM ──────────────────────────────────────────
app.get('/admin/team', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('admin_users').select('id,name,email,role,last_login,created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
});

app.post('/admin/team/invite', requireAuth, async (req, res) => {
  const { name, email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  // Generate a random temp password
  const tempPass = crypto.randomBytes(8).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(tempPass + salt).digest('hex');

  const { data, error } = await supabase.from('admin_users').insert({
    name, email: email.toLowerCase(), role: role || 'editor',
    password_hash: hash, salt,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Send invite email
  try {
    await resend.emails.send({
      from: 'RedCube SEO <hello@redcube.co>',
      to: email,
      subject: 'You\'ve been invited to RedCube SEO Platform',
      html: `<p>You've been added to the RedCube SEO Platform as ${role}.</p>
             <p>Login at: ${process.env.PUBLIC_RESULTS_BASE_URL?.replace('/results','')}/login</p>
             <p>Email: ${email}<br>Temporary password: <strong>${tempPass}</strong></p>
             <p>Please change your password after first login.</p>`
    });
  } catch(e) { console.warn('Invite email failed:', e.message); }

  res.json({ success: true, member: data });
});

app.delete('/admin/team/:id', requireAuth, async (req, res) => {
  await supabase.from('admin_users').delete().eq('id', req.params.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅  RedCube SEO API on :${PORT}`));
module.exports = app;
