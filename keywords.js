const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

// GET /admin/keywords — all keywords across all sites
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('site_keywords')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keywords: data || [] });
});

// DELETE /admin/keywords/:id
router.delete('/:id', async (req, res) => {
  await supabase.from('site_keywords').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
