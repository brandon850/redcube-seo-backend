function scoreOnePage(m) {
  let s = 100;
  if (!m.title || m.titleLength < 5)  s -= 20;
  else if (m.titleLength < 30)        s -= 8;
  else if (m.titleLength > 60)        s -= 5;
  if (m.metaDescLen < 20)             s -= 15;
  else if (m.metaDescLen > 160)       s -= 5;
  if (m.h1Count === 0)                s -= 18;
  else if (m.h1Count > 1)            s -= 8;
  if (!m.isMobileOptimized)          s -= 15;
  if (!m.isHttps)                    s -= 20;
  if (m.wordCount < 200)             s -= 12;
  else if (m.wordCount < 400)        s -= 5;
  if (m.imagesWithoutAlt > 0)        s -= Math.min(10, m.imagesWithoutAlt * 3);
  if (!m.canonical)                  s -= 5;
  if (m.hasNoindex)                  s -= 30;
  return Math.max(0, Math.min(100, s));
}

function detectPageType(url) {
  const path = url.toLowerCase();
  if (/\/blog\/|\/post\/|\/article\/|\/news\/|\d{4}\/\d{2}\//.test(path)) return 'post';
  if (/\/landing\/|\/lp\/|-lp\b|\/campaign\//.test(path))                  return 'landing';
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

module.exports = { scoreOnePage, detectPageType, getPageIssues };
