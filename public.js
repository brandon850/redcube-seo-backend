const express  = require('express');
const { v4: uuidv4 } = require('uuid');

const supabase          = require('../config/supabase');
const { crawlSite, checkAuxFiles } = require('../services/crawler');
const { scoreSite }     = require('../services/scorer');
const { sendResultsEmail } = require('../services/email');

const router = express.Router();

// POST /api/audit — public free audit tool
router.post('/audit', async (req, res) => {
  let { email, url, name } = req.body;
  if (!email || !url) return res.status(400).json({ error: 'email and url are required' });
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  try {
    console.log(`[audit] Crawling ${url} for ${email}`);
    const [pages, aux] = await Promise.all([crawlSite(url), checkAuxFiles(url)]);
    console.log(`[audit] Crawled ${pages.length} pages`);

    const result = scoreSite(pages, aux, url);
    console.log(`[audit] Grade: ${result.grade} (${result.overallScore})`);

    const reportId = uuidv4();
    const { error: dbErr } = await supabase.from('seo_reports').insert({
      id:            reportId,
      email,
      name:          name || null,
      url,
      domain:        result.domain,
      grade:         result.grade,
      overall_score: result.overallScore,
      pages_scanned: result.pagesScanned,
      report_data:   result,
      created_at:    new Date().toISOString(),
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

// GET /api/report/:id — fetch a stored public report
router.get('/report/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('seo_reports')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Report not found' });
  res.json(data);
});

module.exports = router;
