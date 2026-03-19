const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../../config/supabase');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const router = express.Router();

// GET /admin/team
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, name, email, role, last_login, created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
});

// POST /admin/team/invite
router.post('/invite', async (req, res) => {
  const { name, email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const tempPass = crypto.randomBytes(8).toString('hex');
  const salt     = crypto.randomBytes(16).toString('hex');
  const hash     = crypto.createHash('sha256').update(tempPass + salt).digest('hex');

  const { data, error } = await supabase.from('admin_users').insert({
    name,
    email:         email.toLowerCase(),
    role:          role || 'editor',
    password_hash: hash,
    salt,
    created_at:    new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const loginUrl = process.env.PUBLIC_RESULTS_BASE_URL?.replace('/results', '') + '/dashboard';

  try {
    await resend.emails.send({
      from:    'RedCube SEO <hello@redcube.co>',
      to:      email,
      subject: "You've been invited to RedCube SEO Platform",
      html: `
        <p>Hi ${name || 'there'},</p>
        <p>You've been added to the RedCube SEO Platform as <strong>${role || 'editor'}</strong>.</p>
        <p>
          Login at: <a href="${loginUrl}">${loginUrl}</a><br>
          Email: ${email}<br>
          Temporary password: <strong>${tempPass}</strong>
        </p>
        <p>Please change your password after first login.</p>
        <p>— RedCube</p>
      `,
    });
  } catch (e) {
    console.warn('[team/invite] Email failed:', e.message);
  }

  res.json({ success: true, member: data });
});

// DELETE /admin/team/:id
router.delete('/:id', async (req, res) => {
  await supabase.from('admin_users').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
