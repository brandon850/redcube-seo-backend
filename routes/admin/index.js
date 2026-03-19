const express = require('express');
const { requireAuth } = require('../../middleware/auth');

const authRouter       = require('./auth');
const sitesRouter      = require('./sites');
const checklistRouter  = require('./checklist');
const keywordsRouter   = require('./keywords');
const contentRouter    = require('./content');
const reportsRouter    = require('./reports');
const teamRouter       = require('./team');
const gscRouter        = require('./gsc');
const pagespeedRouter  = require('./pagespeed');
const leadsRouter      = require('./leads');

const router = express.Router();

// Public (no auth required)
router.use('/',    authRouter);
router.use('/gsc', gscRouter);  // callback must be public

// JWT protected
router.use(requireAuth);
router.use('/sites',      sitesRouter);
router.use('/checklist',  checklistRouter);
router.use('/keywords',   keywordsRouter);
router.use('/content',    contentRouter);
router.use('/reports',    reportsRouter);
router.use('/team',       teamRouter);
router.use('/pagespeed',  pagespeedRouter);
router.use('/leads',      leadsRouter);

module.exports = router;
