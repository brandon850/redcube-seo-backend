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

module.exports = router;
