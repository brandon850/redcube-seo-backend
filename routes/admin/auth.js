const express = require('express');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');

const supabase       = require('../../config/supabase');
const { JWT_SECRET } = require('../../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data: users, error } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error || !users?.length) return res.status(401).json({ error: 'Invalid credentials' });

  const user = users[0];
  const hash = crypto.createHash('sha256').update(password + user.salt).digest('hex');
  if (hash !== user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

module.exports = router;
