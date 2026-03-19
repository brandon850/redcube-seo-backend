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

module.exports = router;
