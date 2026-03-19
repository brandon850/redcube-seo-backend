const express = require('express');

const supabase                    = require('../../config/supabase');
const { crawlSite, checkAuxFiles } = require('../../services/crawler');
const { scoreSite }               = require('../../services/scorer');
const { scoreOnePage, detectPageType, getPageIssues } = require('../../services/pageScorer');
const { generateChecklist }       = require('../../services/checklist');

const router = express.Router();

// GET /admin/sites
router.get('/', async (req, res) => {
  const { data: sitesRaw, error } = await supabase
    .from('managed_sites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const sites = await Promise.all((sitesRaw || []).map(async site => {
    const [{ count: openTasks }, { count: kwCount }, { count: draftCount }] = await Promise.all([
      supabase.from('checklist_items').select('*', { count: 'exact', head: true }).eq('site_id', site.id).eq('done', false),
      supabase.from('site_keywords').select('*',   { count: 'exact', head: true }).eq('site_id', site.id),
      supabase.from('content_drafts').select('*',  { count: 'exact', head: true }).eq('site_id', site.id).neq('status', 'published'),
    ]);
    return { ...site, open_tasks: openTasks || 0, keyword_count: kwCount || 0, draft_count: draftCount || 0 };
  }));

  res.json({ sites });
});

// POST /admin/sites
router.post('/', async (req, res) => {
  const { name, url, platform, client_email, notes } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });

  let cleanUrl = url.trim();
  if (!/^https?:\/\//.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
  const domain = (() => { try { return new URL(cleanUrl).hostname.replace('www.', ''); } catch { return cleanUrl; } })();

  const { data, error } = await supabase.from('managed_sites').insert({
    name, url: cleanUrl, domain, platform, client_email, notes,
    created_by: req.user.id,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ site: data });
});

// DELETE /admin/sites/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
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

// GET /admin/sites/:id/pages
router.get('/:id/pages', async (req, res) => {
  const { data: pages, error } = await supabase
    .from('site_pages')
    .select('*')
    .eq('site_id', req.params.id)
    .order('score', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pages: pages || [] });
});

// POST /admin/sites/:id/audit — full crawl up to 100 pages
router.post('/:id/audit', async (req, res) => {
  const siteId = req.params.id;
  const { data: site, error: siteErr } = await supabase.from('managed_sites').select('*').eq('id', siteId).single();
  if (siteErr || !site) return res.status(404).json({ error: 'Site not found' });

  try {
    console.log(`[admin-audit] Starting full crawl of ${site.url}`);
    const [pages, aux] = await Promise.all([crawlSite(site.url, 100), checkAuxFiles(site.url)]);
    console.log(`[admin-audit] Crawled ${pages.length} pages`);

    const result = scoreSite(pages, aux, site.url);

    // Store audit record
    await supabase.from('site_audits').insert({
      site_id:       siteId,
      grade:         result.grade,
      overall_score: result.overallScore,
      pages_crawled: pages.length,
      report_data:   result,
      crawled_by:    req.user.id,
      created_at:    new Date().toISOString(),
    });

    // Rebuild page records
    await supabase.from('site_pages').delete().eq('site_id', siteId);
    const pageInserts = pages.filter(p => p.ok && p.metrics).map(p => ({
      site_id:      siteId,
      url:          p.url,
      title:        p.metrics.title || '',
      score:        scoreOnePage(p.metrics),
      type:         detectPageType(p.url),
      word_count:   p.metrics.wordCount || 0,
      h1_text:      p.metrics.h1Text || '',
      has_meta:     p.metrics.metaDescLen > 20,
      has_h1:       p.metrics.h1Count === 1,
      is_https:     p.metrics.isHttps,
      is_mobile:    p.metrics.isMobileOptimized,
      issues:       getPageIssues(p.metrics),
      last_crawled: new Date().toISOString(),
    }));
    if (pageInserts.length) await supabase.from('site_pages').insert(pageInserts);

    // Rebuild checklist
    await supabase.from('checklist_items').delete().eq('site_id', siteId).eq('auto_generated', true);
    const checklistItems = generateChecklist(pages, aux, result, siteId);
    if (checklistItems.length) await supabase.from('checklist_items').insert(checklistItems);

    // Update site summary
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

// GET /admin/sites/:id/keyword-groups
router.get('/:id/keyword-groups', async (req, res) => {
  const { data, error } = await supabase
    .from('keyword_groups')
    .select('*')
    .eq('site_id', req.params.id)
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ groups: data || [] });
});

// POST /admin/sites/:id/keyword-groups
router.post('/:id/keyword-groups', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase.from('keyword_groups').insert({
    site_id:    req.params.id,
    name:       name.trim(),
    created_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ group: data });
});

// DELETE /admin/sites/:id/keyword-groups/:groupId
router.delete('/:id/keyword-groups/:groupId', async (req, res) => {
  await supabase.from('keyword_groups').delete().eq('id', req.params.groupId);
  res.json({ success: true });
});

module.exports = router;

// GET /admin/sites/:id/checklist
router.get('/:id/checklist', async (req, res) => {
  const { data: items, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('site_id', req.params.id)
    .order('priority_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: items || [] });
});

// GET /admin/sites/:id/keywords
router.get('/:id/keywords', async (req, res) => {
  const { data, error } = await supabase
    .from('site_keywords')
    .select('*')
    .eq('site_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keywords: data || [] });
});

// POST /admin/sites/:id/keywords
router.post('/:id/keywords', async (req, res) => {
  const { keyword, page_url } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  // Support comma-separated list
  const keywords = keyword.split(',').map(k => k.trim()).filter(Boolean);

  const inserts = keywords.map(kw => ({
  site_id:    req.params.id,
  keyword:    kw,
  page_url:   page_url || null,
  group_id:   group_id || null,
  created_at: new Date().toISOString(),
}));

  const { data, error } = await supabase.from('site_keywords')
    .insert(inserts).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keywords: data });
});

// GET /admin/sites/:id/content
router.get('/:id/content', async (req, res) => {
  const { data, error } = await supabase
    .from('content_drafts')
    .select('*')
    .eq('site_id', req.params.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ drafts: data || [] });
});

// GET /admin/sites/:id/reports
router.get('/:id/reports', async (req, res) => {
  const { data, error } = await supabase
    .from('client_reports')
    .select('*')
    .eq('site_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ reports: data || [] });
});

// POST /admin/sites/:id/reports — generate a shareable client report
router.post('/:id/reports', async (req, res) => {
  const siteId = req.params.id;
  const { data: site } = await supabase.from('managed_sites').select('*').eq('id', siteId).single();
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const { data: latestAudit } = await supabase
    .from('site_audits')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const { v4: uuidv4 } = require('uuid');
  const reportId  = uuidv4();
  const publicUrl = `${process.env.PUBLIC_RESULTS_BASE_URL}/${reportId}`;

  await supabase.from('client_reports').insert({
    id:           reportId,
    site_id:      siteId,
    site_name:    site.name,
    grade:        site.last_grade,
    score:        site.last_score,
    pages_crawled: site.pages_crawled,
    public_url:   publicUrl,
    report_data:  latestAudit?.report_data || null,
    created_by:   req.user.id,
    created_at:   new Date().toISOString(),
  });

  // Mirror into seo_reports so the public viewer works
  await supabase.from('seo_reports').insert({
    id:            reportId,
    email:         site.client_email || 'noreply@redcube.co',
    url:           site.url,
    domain:        site.domain,
    grade:         site.last_grade,
    overall_score: site.last_score,
    pages_scanned: site.pages_crawled,
    report_data:   latestAudit?.report_data || null,
    created_at:    new Date().toISOString(),
  });

  res.json({ success: true, public_url: publicUrl, reportId });
});
