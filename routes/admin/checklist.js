const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

// GET /admin/sites/:id/checklist — mounted via sites router would require nesting
// Instead we expose a flat route here and mount it from admin/index.js
// Frontend calls /admin/sites/:id/checklist — we handle that in sites.js below

// PATCH /admin/checklist/:id — toggle a checklist item done/undone
router.patch('/:id', async (req, res) => {
  const { done } = req.body;
  const { data, error } = await supabase
    .from('checklist_items')
    .update({
      done,
      completed_at: done ? new Date().toISOString() : null,
      completed_by: req.user.id,
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: data });
});

// DELETE /admin/checklist/completed/:siteId — clear all done items for a site
router.delete('/completed/:siteId', async (req, res) => {
  const { error } = await supabase
    .from('checklist_items')
    .delete()
    .eq('site_id', req.params.siteId)
    .eq('done', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// PATCH /admin/checklist/:id/ignore — toggle ignored state
router.patch('/:id/ignore', async (req, res) => {
  const { ignored } = req.body;

  // Fetch the item so we know its text/category for site-level ignore tracking
  const { data: item } = await supabase
    .from('checklist_items').select('*').eq('id', req.params.id).single();
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // Update the item
  await supabase.from('checklist_items')
    .update({ ignored })
    .eq('id', req.params.id);

  // If ignoring, add this issue type to the site's ignored list
  // so the crawler won't regenerate it next audit
  if (ignored && item.site_id) {
    const { data: site } = await supabase
      .from('managed_sites').select('ignored_issue_types').eq('id', item.site_id).single();
    const existing = site?.ignored_issue_types || [];
    // Use category + first 60 chars of text as a fingerprint
    const fingerprint = (item.category + ':' + item.text.slice(0, 60)).toLowerCase();
    if (!existing.includes(fingerprint)) {
      await supabase.from('managed_sites')
        .update({ ignored_issue_types: [...existing, fingerprint] })
        .eq('id', item.site_id);
    }
  }

  res.json({ success: true });
});

module.exports = router;
