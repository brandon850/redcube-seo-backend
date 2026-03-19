// ════════════════════════════════════════════════════
//  PageSpeed Insights Service
//  Calls Google PSI API for both mobile + desktop
//  Returns normalized CWV + diagnostics
// ════════════════════════════════════════════════════

const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Thresholds per Google's CWV guidelines
const THRESHOLDS = {
  lcp:  { good: 2500,  poor: 4000  },  // ms
  fid:  { good: 100,   poor: 300   },  // ms
  inp:  { good: 200,   poor: 500   },  // ms
  cls:  { good: 0.1,   poor: 0.25  },  // unitless
  fcp:  { good: 1800,  poor: 3000  },  // ms
  ttfb: { good: 800,   poor: 1800  },  // ms
};

function rateMetric(key, value) {
  if (value === null || value === undefined) return 'n/a';
  const t = THRESHOLDS[key];
  if (!t) return 'n/a';
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function extractMetrics(lighthouseResult) {
  const audits   = lighthouseResult?.audits || {};
  const cats     = lighthouseResult?.categories || {};
  const perf     = Math.round((cats.performance?.score || 0) * 100);

  // Core Web Vitals
  const lcp  = audits['largest-contentful-paint']?.numericValue  || null;
  const fid  = audits['max-potential-fid']?.numericValue          || null;
  const inp  = audits['interaction-to-next-paint']?.numericValue  || null;
  const cls  = audits['cumulative-layout-shift']?.numericValue    || null;
  const fcp  = audits['first-contentful-paint']?.numericValue     || null;
  const ttfb = audits['server-response-time']?.numericValue       || null;
  const tbt  = audits['total-blocking-time']?.numericValue        || null;
  const si   = audits['speed-index']?.numericValue                || null;

  // Top diagnostics — items with real savings
  const diagnosticAudits = [
    'render-blocking-resources',
    'unused-css-rules',
    'unused-javascript',
    'uses-optimized-images',
    'uses-responsive-images',
    'uses-webp-images',
    'efficiently-encode-images',
    'uses-text-compression',
    'uses-long-cache-ttl',
    'dom-size',
    'bootup-time',
    'mainthread-work-breakdown',
  ];

  const diagnostics = diagnosticAudits
    .map(id => {
      const a = audits[id];
      if (!a || a.score === 1 || a.score === null) return null;
      return {
        id,
        title:       a.title,
        description: a.description,
        score:       a.score,
        savings:     a.details?.overallSavingsMs
          ? Math.round(a.details.overallSavingsMs) + 'ms'
          : a.details?.overallSavingsBytes
            ? Math.round(a.details.overallSavingsBytes / 1024) + 'KB'
            : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.score || 0) - (b.score || 0))
    .slice(0, 8);

  return {
    performance_score: perf,
    lcp:  lcp  ? Math.round(lcp)  : null,
    fid:  fid  ? Math.round(fid)  : null,
    inp:  inp  ? Math.round(inp)  : null,
    cls:  cls  ? parseFloat(cls.toFixed(3)) : null,
    fcp:  fcp  ? Math.round(fcp)  : null,
    ttfb: ttfb ? Math.round(ttfb) : null,
    tbt:  tbt  ? Math.round(tbt)  : null,
    si:   si   ? Math.round(si)   : null,
    ratings: {
      lcp:  rateMetric('lcp',  lcp),
      inp:  rateMetric('inp',  inp || fid),
      cls:  rateMetric('cls',  cls),
      fcp:  rateMetric('fcp',  fcp),
      ttfb: rateMetric('ttfb', ttfb),
    },
    diagnostics,
  };
}

async function fetchPSI(url, strategy = 'mobile') {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) throw new Error('PAGESPEED_API_KEY not set');

  const endpoint = `${PSI_API}?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}&category=performance`;

  const res = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PSI API error (${strategy}): ${err?.error?.message || res.status}`);
  }

  const data = await res.json();
  return extractMetrics(data.lighthouseResult);
}

async function getPageSpeedData(url) {
  // Run mobile and desktop in parallel
  const [mobile, desktop] = await Promise.allSettled([
    fetchPSI(url, 'mobile'),
    fetchPSI(url, 'desktop'),
  ]);

  return {
    url,
    fetched_at: new Date().toISOString(),
    mobile:  mobile.status  === 'fulfilled' ? mobile.value  : { error: mobile.reason?.message },
    desktop: desktop.status === 'fulfilled' ? desktop.value : { error: desktop.reason?.message },
  };
}

module.exports = { getPageSpeedData };
