const express  = require('express');
const supabase = require('../../config/supabase');
const { getPageSpeedData } = require('../../services/pagespeed');

const router = express.Router();

// POST /admin/pagespeed/:siteId/:pageId — manual refresh for a single page
router.post('/:siteId/:pageId', async (req, res) => {
  const { siteId, pageId } = req.params;

  const { data: page } = await supabase
    .from('site_pages').select('url').eq('id', pageId).eq('site_id', siteId).single();
  if (!page) return res.status(404).json({ error: 'Page not found' });

  try {
    console.log(`[pagespeed] Fetching PSI for ${page.url}`);
    const psi = await getPageSpeedData(page.url);

    await supabase.from('site_pages').update({
      psi_mobile:  psi.mobile,
      psi_desktop: psi.desktop,
      psi_fetched_at: psi.fetched_at,
    }).eq('id', pageId);

    res.json({ success: true, data: psi });
  } catch (err) {
    console.error('[pagespeed]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/pagespeed/:siteId/:pageId — fetch stored PSI data for a page
router.get('/:siteId/:pageId', async (req, res) => {
  const { data, error } = await supabase
    .from('site_pages')
    .select('psi_mobile, psi_desktop, psi_fetched_at, url')
    .eq('id', req.params.pageId)
    .eq('site_id', req.params.siteId)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

module.exports = router;
