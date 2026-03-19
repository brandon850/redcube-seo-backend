const express = require('express');
const { requireAuth } = require('../../middleware/auth');

const authRouter      = require('./auth');
const sitesRouter     = require('./sites');
const checklistRouter = require('./checklist');
const keywordsRouter  = require('./keywords');
const contentRouter   = require('./content');
const reportsRouter   = require('./reports');
const teamRouter      = require('./team');
const gscRouter       = require('./gsc');

const router = express.Router();

// Login is public (no auth required)
router.use('/', authRouter);

// Everything else requires a valid JWT
router.use(requireAuth);
router.use('/sites',     sitesRouter);
router.use('/checklist', checklistRouter);
router.use('/keywords',  keywordsRouter);
router.use('/content',   contentRouter);
router.use('/reports',   reportsRouter);
router.use('/team',      teamRouter);
router.use('/gsc',       gscRouter);

module.exports = router;
