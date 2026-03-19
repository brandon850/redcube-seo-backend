const express = require('express');
const cors    = require('cors');

const publicRoutes = require('./routes/public');
const adminRoutes  = require('./routes/admin');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4mb' }));

// ── Utility routes
app.get('/health',      (_, res) => res.json({ ok: true }));
app.get('/favicon.ico', (_, res) => res.status(204).end());

// ── Public SEO audit tool (unchanged, no auth)
app.use('/api', publicRoutes);

// ── Admin dashboard (JWT protected)
app.use('/admin', adminRoutes);

module.exports = app;
