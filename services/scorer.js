function scoreToStatus(s) {
  return s >= 90 ? 'Great' : s >= 75 ? 'Good' : s >= 60 ? 'Okay' : s >= 40 ? 'Needs Work' : 'Poor';
}

function scoreSite(pages, aux, startUrl) {
  const hm      = (pages[0] || {}).metrics || {};
  const all     = pages.map(p => p.metrics).filter(Boolean);
  const n       = all.length || 1;
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

  if (!aux.hasRobotsTxt) {
    findScore -= 10;
    findFindings.push({ type: 'warn', text: `Your site is missing a robots.txt file. This file guides Google's crawlers through your site — without it, Google has to guess which pages to visit.` });
  } else {
    findFindings.push({ type: 'pass', text: `A robots.txt file is in place, helping guide Google's crawlers efficiently through your site.` });
  }

  if (!aux.hasSitemap) {
    findScore -= 12;
    findFindings.push({ type: 'fail', text: `No sitemap.xml was found. A sitemap is essentially a map for Google listing all your pages — without it, some pages may never show up in search results.` });
  } else {
    findFindings.push({ type: 'pass', text: `A sitemap.xml was found, ensuring Google discovers and indexes all your pages — not just the ones it stumbles across.` });
  }

  if (hm.hasNoindex) {
    findScore -= 30;
    findFindings.push({ type: 'fail', text: `Your homepage has a "noindex" tag — this is actively telling Google NOT to show it in search results. This is a critical issue that needs immediate attention.` });
  }

  findScore = Math.max(0, Math.min(100, findScore));

  // ── PAGE SPEED ───────────────────────────────────
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

  // ── MOBILE ───────────────────────────────────────
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

  // ── CONTENT ──────────────────────────────────────
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
    'F':  "Your site has critical SEO problems preventing it from showing up properly in Google. Immediate attention is needed — but these issues can be fixed.",
  };

  const domain = (() => {
    try { return new URL(startUrl).hostname.replace('www.', ''); } catch { return startUrl; }
  })();

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
      { name: 'Links & Navigation',  icon: '🔗', score: navScore,     status: scoreToStatus(navScore),     findings: navFindings.slice(0, 5) },
    ],
  };
}

module.exports = { scoreSite, scoreToStatus };
