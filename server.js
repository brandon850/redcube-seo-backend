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

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4mb' }));

// ── ENV VARS (set in Railway / Render dashboard) ─────
// SUPABASE_URL            = https://xxxx.supabase.co
// SUPABASE_ANON_KEY       = your-anon-key
// RESEND_API_KEY          = re_xxxxxxxx
// PUBLIC_RESULTS_BASE_URL = https://your-frontend.com/results
// PORT                    = 3001  (auto-set by most platforms)
// ─────────────────────────────────────────────────────

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
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

function extractInternalLinks($, pageUrl, origin) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized && normalized.startsWith(origin)) links.add(normalized);
  });
  return links;
}

async function crawlSite(startUrl) {
  const origin  = new URL(startUrl).origin;
  const start   = normalizeUrl(startUrl, startUrl);
  const queue   = [start];
  const visited = new Set();
  const pages   = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
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

// ══════════════════════════════════════════════════════
//  EMAIL
// ══════════════════════════════════════════════════════
async function sendResultsEmail({ email, name, url, auditResult, resultsUrl }) {
  const gradeColor = { 'A+': '#15803d','A':'#16a34a','B+':'#4f8a10','B':'#65a30d','C+':'#d97706','C':'#ea580c','D':'#dc2626','F':'#991b1b' }[auditResult.grade] || '#6b7280';
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';

  const catRows = (auditResult.categories || []).map(c => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;">
        ${c.icon}&nbsp;&nbsp;<strong>${c.name}</strong>
      </td>
      <td style="text-align:right;padding:10px 0;border-bottom:1px solid #f0f0f0;white-space:nowrap;">
        <strong style="color:#1a1a2e;">${c.score}/100</strong>&nbsp;
        <span style="background:#f3f4f6;border-radius:100px;padding:2px 10px;font-size:11px;color:#6b7280;">${c.status}</span>
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
  <tr><td style="background:#1a1a2e;border-radius:16px 16px 0 0;padding:28px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;">red<span style="color:#E63946;">cube</span></div>
    <div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:4px;letter-spacing:.1em;text-transform:uppercase;">Free SEO Audit Report</div>
  </td></tr>
  <tr><td style="background:#16213e;padding:32px;text-align:center;">
    <div style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:16px;">${auditResult.domain} · ${auditResult.pagesScanned} pages scanned</div>
    <div style="display:inline-block;border:2px solid rgba(255,255,255,0.12);border-radius:16px;padding:20px 52px;background:rgba(255,255,255,0.04);">
      <div style="font-size:64px;font-weight:800;line-height:1;color:${gradeColor};">${auditResult.grade}</div>
      <div style="color:rgba(255,255,255,0.45);font-size:15px;margin-top:8px;">${auditResult.overallScore} / 100</div>
    </div>
    <p style="color:rgba(255,255,255,0.6);max-width:420px;margin:20px auto 0;line-height:1.7;font-size:14px;">${auditResult.gradeSummary}</p>
  </td></tr>
  <tr><td style="background:#fff;padding:32px;">
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px;">${greeting} Your free SEO audit for <strong>${url}</strong> is complete — here's how each area scored:</p>
    <table width="100%" cellpadding="0" cellspacing="0">${catRows}</table>
    <div style="text-align:center;margin:36px 0 28px;">
      <a href="${resultsUrl}" style="display:inline-block;background:#E63946;color:#fff;padding:16px 36px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none;">View Your Full Report →</a>
      <div style="color:#9ca3af;font-size:12px;margin-top:10px;">Your report is saved at this link and won't expire.</div>
    </div>
    <div style="background:#f8f8fb;border-radius:12px;padding:24px;border-left:4px solid #E63946;">
      <p style="color:#1a1a2e;font-size:15px;font-weight:700;margin:0 0 8px;">Want help fixing these issues?</p>
      <p style="color:#6b7280;font-size:14px;line-height:1.7;margin:0 0 16px;">RedCube specializes in helping local businesses rank higher on Google and turn visitors into paying customers. Schedule a free 15-minute call and let's review your results together.</p>
      <a href="https://redcube.co/contact" style="display:inline-block;background:#1a1a2e;color:#fff;padding:11px 22px;border-radius:8px;font-weight:600;font-size:13px;text-decoration:none;">Schedule a Free Consult →</a>
    </div>
  </td></tr>
  <tr><td style="background:#f0f2f5;border-radius:0 0 16px 16px;padding:20px;text-align:center;">
    <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.7;">
      Report generated by <a href="https://redcube.co" style="color:#E63946;text-decoration:none;">RedCube</a> at your request.<br>
      No spam — ever. Questions? Email us at <a href="mailto:hello@redcube.co" style="color:#9ca3af;">hello@redcube.co</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  await resend.emails.send({
    from: 'RedCube SEO <hello@redcube.co>',
    to: email,
    replyTo: 'hello@redcube.co',
    subject: `Your SEO Report: ${auditResult.domain} scored ${auditResult.grade} (${auditResult.overallScore}/100)`,
    html
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅  RedCube SEO API on :${PORT}`));
module.exports = app;
