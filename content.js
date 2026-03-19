const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

// GET /admin/content — all drafts across all sites
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('content_drafts')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ drafts: data || [] });
});

// POST /admin/content — create a new draft
router.post('/', async (req, res) => {
  const { site_id, type, title, target_keyword, meta_description, body, status } = req.body;
  const wordCount = (body || '').split(/\s+/).filter(w => w.length > 2).length;

  const { data, error } = await supabase.from('content_drafts').insert({
    site_id,
    type,
    title,
    target_keyword,
    meta_description,
    body,
    status:     status || 'draft',
    word_count: wordCount,
    created_by: req.user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ draft: data });
});

// PATCH /admin/content/:id — update a draft
router.patch('/:id', async (req, res) => {
  const { site_id, type, title, target_keyword, meta_description, body, status } = req.body;
  const wordCount = (body || '').split(/\s+/).filter(w => w.length > 2).length;

  const { data, error } = await supabase
    .from('content_drafts')
    .update({
      site_id,
      type,
      title,
      target_keyword,
      meta_description,
      body,
      status,
      word_count: wordCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ draft: data });
});

// DELETE /admin/content/:id
router.delete('/:id', async (req, res) => {
  await supabase.from('content_drafts').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
