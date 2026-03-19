function generateChecklist(pages, aux, result, siteId, ignoredTypes = []) {
  const items = [];
  let order = 0;

  const add = (text, category, priority, pageUrl = null) => {
    // Skip if this issue type was previously ignored by the user
    const fingerprint = (category + ':' + text.slice(0, 60)).toLowerCase();
    if (ignoredTypes.some(ig => fingerprint.startsWith(ig))) return;
    items.push({
      site_id:        siteId,
      text,
      category,
      priority,
      priority_order: order++,
      done:           false,
      auto_generated: true,
      page_url:       pageUrl,
      created_at:     new Date().toISOString(),
    });
  };

  const crawled = pages.filter(p => p.ok && p.metrics).map(p => ({ url: p.url, m: p.metrics }));

  // ── Findability
  if (!aux.hasSitemap)   add("Create and submit an XML sitemap to Google Search Console", 'Findability', 'high');
  if (!aux.hasRobotsTxt) add("Add a robots.txt file to guide Google's crawlers", 'Findability', 'high');

  crawled.filter(p => !p.m.title || p.m.titleLength < 5).forEach(p =>
    add(`Add a title tag to this page`, 'Findability', 'high', p.url));
  crawled.filter(p => p.m.titleLength > 60).forEach(p =>
    add(`Shorten title tag to under 60 characters (currently ${p.m.titleLength})`, 'Findability', 'med', p.url));
  crawled.filter(p => p.m.titleLength > 0 && p.m.titleLength < 30).forEach(p =>
    add(`Expand title tag to at least 30 characters (currently ${p.m.titleLength})`, 'Findability', 'med', p.url));
  crawled.filter(p => p.m.metaDescLen < 20).forEach(p =>
    add(`Write a meta description (150–160 chars) for this page`, 'Findability', 'high', p.url));
  crawled.filter(p => p.m.metaDescLen > 160).forEach(p =>
    add(`Shorten meta description to 160 chars or less (currently ${p.m.metaDescLen})`, 'Findability', 'low', p.url));

  // ── Content
  crawled.filter(p => p.m.h1Count === 0).forEach(p =>
    add(`Add a single H1 heading to this page`, 'Content', 'high', p.url));
  crawled.filter(p => p.m.h1Count > 1).forEach(p =>
    add(`Remove extra H1 tags — only one H1 per page (found ${p.m.h1Count})`, 'Content', 'med', p.url));
  crawled.filter(p => p.m.wordCount < 300).forEach(p =>
    add(`Add more content — page has only ${p.m.wordCount} words, aim for 500+`, 'Content', 'high', p.url));
  crawled.filter(p => p.m.imagesWithoutAlt > 0).forEach(p =>
    add(`Add alt text to ${p.m.imagesWithoutAlt} image(s) on this page`, 'Content', 'med', p.url));
  crawled.filter(p => !p.m.hasStructuredData).slice(0, 5).forEach(p =>
    add(`Add Schema.org structured data markup to this page`, 'Content', 'med', p.url));

  // ── Technical
  crawled.filter(p => !p.m.isHttps).forEach(p =>
    add(`Migrate this page to HTTPS`, 'Technical', 'high', p.url));
  crawled.filter(p => !p.m.canonical).slice(0, 10).forEach(p =>
    add(`Add a canonical tag to prevent duplicate content issues`, 'Technical', 'med', p.url));
  crawled.filter(p => !p.m.ogImage).slice(0, 5).forEach(p =>
    add(`Add an Open Graph image tag for better social sharing`, 'Technical', 'low', p.url));

  // ── Mobile
  crawled.filter(p => !p.m.isMobileOptimized).forEach(p =>
    add(`Add mobile viewport meta tag to this page`, 'Mobile', 'high', p.url));

  // ── Speed
  crawled.filter(p => (p.m.htmlSize || 0) > 300000).forEach(p =>
    add(`Reduce page weight — HTML is ${Math.round(p.m.htmlSize / 1024)}KB, optimize images and minify code`, 'Speed', 'med', p.url));
  if (!crawled.some(p => p.m.hasGoogleAnalytics))
    add('Install Google Analytics or Google Tag Manager to track visitors', 'Speed', 'high');

  return items.slice(0, 100);
}

module.exports = { generateChecklist };
