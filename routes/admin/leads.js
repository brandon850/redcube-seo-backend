const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

// GET /admin/leads — all public audit submissions
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('seo_reports')
    .select('id, email, name, url, domain, grade, overall_score, lead_status, lead_notes, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ leads: data || [] });
});

// PATCH /admin/leads/:id — update status and/or notes
router.patch('/:id', async (req, res) => {
  const { lead_status, lead_notes } = req.body;
  const updates = {};
  if (lead_status !== undefined) updates.lead_status = lead_status;
  if (lead_notes  !== undefined) updates.lead_notes  = lead_notes;

  const { data, error } = await supabase
    .from('seo_reports')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ lead: data });
});

module.exports = router;
