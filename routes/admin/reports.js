const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

// GET /admin/reports — all client reports across all sites
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('client_reports')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ reports: data || [] });
});

// DELETE /admin/reports/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await Promise.all([
    supabase.from('client_reports').delete().eq('id', id),
    supabase.from('seo_reports').delete().eq('id', id),
  ]);
  res.json({ success: true });
});

module.exports = router;
