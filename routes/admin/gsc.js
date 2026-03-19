const express  = require('express');
const supabase = require('../../config/supabase');

const router = express.Router();

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth';
const GSC_API_BASE      = 'https://www.googleapis.com/webmasters/v3';

// ── Build OAuth URL ──────────────────────────────
// GET /admin/gsc/auth-url?site_id=xxx
// Returns the Google OAuth URL to open in browser
router.get('/auth-url', require('../../middleware/auth').requireAuth, (req, res) => {
  const { site_id } = req.query;
  if (!site_id) return res.status(400).json({ error: 'site_id required' });

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/webmasters.readonly',
    access_type:   'offline',
    prompt:        'consent',
    state:         site_id, // pass site_id through so callback knows which site
  });

  res.json({ url: GOOGLE_AUTH_URL + '?' + params.toString() });
});

// ── OAuth Callback ───────────────────────────────
// GET /admin/gsc/callback?code=xxx&state=site_id
// Google redirects here after user authorizes
router.get('/callback', async (req, res) => {
  const { code, state: siteId, error } = req.query;

  if (error) {
    return res.redirect(
      process.env.PUBLIC_RESULTS_BASE_URL?.replace('/results', '') +
      `/dashboard?gsc_error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !siteId) return res.status(400).send('Missing code or state');

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    // If Google didn't return a refresh token, check if we already have one stored
    if (!tokens.refresh_token) {
      const { data: existingSite } = await supabase
        .from('managed_sites')
        .select('gsc_refresh_token')
        .eq('id', siteId)
        .single();
    
      if (existingSite?.gsc_refresh_token) {
        tokens.refresh_token = existingSite.gsc_refresh_token;
      } else {
        return res.redirect(
          process.env.PUBLIC_RESULTS_BASE_URL?.replace('/results', '') +
          '/dashboard?gsc_error=no_refresh_token'
        );
      }
    }

    // Get list of GSC properties to auto-detect which one matches the site
    const accessToken = tokens.access_token;
    const sitesRes = await fetch(GSC_API_BASE + '/sites', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const sitesData = await sitesRes.json();
    const properties = sitesData.siteEntry || [];

    // Fetch the site URL from our DB to match against GSC properties
    const { data: site } = await supabase
      .from('managed_sites').select('url, domain').eq('id', siteId).single();

    // Find best matching property
    const domain   = site?.domain || '';
    const siteUrl  = site?.url    || '';
    const matched  = properties.find(p =>
      p.siteUrl.includes(domain) || siteUrl.includes(p.siteUrl.replace(/\/$/, ''))
    );
    const propertyUrl = matched?.siteUrl || properties[0]?.siteUrl || siteUrl;

    // Store tokens in Supabase
    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    await supabase.from('managed_sites').update({
      gsc_connected:     true,
      gsc_property_url:  propertyUrl,
      gsc_refresh_token: tokens.refresh_token,
      gsc_access_token:  accessToken,
      gsc_token_expiry:  expiry,
    }).eq('id', siteId);

    // Redirect back to the dashboard site detail
    res.redirect(
      process.env.PUBLIC_RESULTS_BASE_URL?.replace('/results', '') +
      '/dashboard?gsc_connected=1&site_id=' + siteId
    );
  } catch (err) {
    console.error('[gsc/callback]', err);
    res.redirect(
      process.env.PUBLIC_RESULTS_BASE_URL?.replace('/results', '') +
      '/dashboard?gsc_error=' + encodeURIComponent(err.message)
    );
  }
});

// ── Refresh access token if expired ──────────────
async function getValidAccessToken(site) {
  const now    = Date.now();
  const expiry = site.gsc_token_expiry ? new Date(site.gsc_token_expiry).getTime() : 0;

  // Still valid — return as-is
  if (site.gsc_access_token && expiry > now + 60000) {
    return site.gsc_access_token;
  }

  // Refresh it
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: site.gsc_refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  const tokens = await res.json();
  if (!tokens.access_token) throw new Error('Failed to refresh GSC token');

  const newExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await supabase.from('managed_sites').update({
    gsc_access_token: tokens.access_token,
    gsc_token_expiry: newExpiry,
  }).eq('id', site.id);

  return tokens.access_token;
}

// ── Sync keyword data from GSC ───────────────────
// POST /admin/gsc/sync/:siteId
// Pulls last 90 days of query data and updates keyword positions
router.post('/sync/:siteId', require('../../middleware/auth').requireAuth, async (req, res) => {
  const { siteId } = req.params;

  const { data: site } = await supabase
    .from('managed_sites').select('*').eq('id', siteId).single();
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (!site.gsc_connected || !site.gsc_refresh_token) {
    return res.status(400).json({ error: 'GSC not connected for this site' });
  }

  try {
    const accessToken = await getValidAccessToken(site);

    // Fetch search analytics — last 90 days, grouped by query + page
    const endDate   = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const gscRes = await fetch(
      `${GSC_API_BASE}/sites/${encodeURIComponent(site.gsc_property_url)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization:  'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions:  ['query', 'page'],
          rowLimit:    1000,
          dataState:   'all',
        }),
      }
    );

    const gscData = await gscRes.json();
    if (gscData.error) throw new Error(gscData.error.message);

    const rows = gscData.rows || [];
    console.log(`[gsc/sync] Got ${rows.length} rows for ${site.domain}`);

    // Get existing tracked keywords for this site
    const { data: trackedKeywords } = await supabase
      .from('site_keywords').select('*').eq('site_id', siteId);

    const tracked = trackedKeywords || [];
    const updates = [];
    const newKws  = [];

    // Build a map of query → best position from GSC rows
    const gscMap = {};
    rows.forEach(row => {
      const query    = row.keys[0];
      const page     = row.keys[1];
      const position = Math.round(row.position);
      if (!gscMap[query] || position < gscMap[query].position) {
        gscMap[query] = { position, page, clicks: row.clicks, impressions: row.impressions };
      }
    });

    // Update tracked keywords with GSC position data
    for (const kw of tracked) {
      const match = gscMap[kw.keyword.toLowerCase()];
      if (!match) continue;
      updates.push({
        id:                kw.id,
        previous_position: kw.current_position || null,
        current_position:  match.position,
        position_change:   kw.current_position ? kw.current_position - match.position : 0,
        page_url:          kw.page_url || match.page,
        updated_at:        new Date().toISOString(),
      });
    }

    // Optionally auto-import top GSC queries not yet tracked
    const trackedSet = new Set(tracked.map(k => k.keyword.toLowerCase()));
    const topNew = Object.entries(gscMap)
      .filter(([query]) => !trackedSet.has(query))
      .sort((a, b) => b[1].impressions - a[1].impressions)
      .slice(0, 20); // import top 20 untracked queries

    topNew.forEach(([query, data]) => {
      newKws.push({
        site_id:          siteId,
        keyword:          query,
        current_position: data.position,
        page_url:         data.page,
        updated_at:       new Date().toISOString(),
        created_at:       new Date().toISOString(),
      });
    });

    // Write updates
    for (const u of updates) {
      const { id, ...fields } = u;
      await supabase.from('site_keywords').update(fields).eq('id', id);
    }
    if (newKws.length) {
      await supabase.from('site_keywords').insert(newKws);
    }

    res.json({
      success:  true,
      updated:  updates.length,
      imported: newKws.length,
      total:    rows.length,
    });
  } catch (err) {
    console.error('[gsc/sync]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Disconnect GSC ───────────────────────────────
// DELETE /admin/gsc/:siteId
router.delete('/:siteId', require('../../middleware/auth').requireAuth, async (req, res) => {
  await supabase.from('managed_sites').update({
    gsc_connected:     false,
    gsc_property_url:  null,
    gsc_refresh_token: null,
    gsc_access_token:  null,
    gsc_token_expiry:  null,
  }).eq('id', req.params.siteId);
  res.json({ success: true });
});

// GET /admin/gsc/properties/:siteId — list all GSC properties for this site's account
router.get('/properties/:siteId', require('../../middleware/auth').requireAuth, async (req, res) => {
  const { data: site } = await supabase
    .from('managed_sites').select('*').eq('id', req.params.siteId).single();
  if (!site || !site.gsc_connected) return res.status(400).json({ error: 'GSC not connected' });

  try {
    const accessToken = await getValidAccessToken(site);
    const sitesRes = await fetch(GSC_API_BASE + '/sites', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const data = await sitesRes.json();
    res.json({ properties: (data.siteEntry || []).map(s => s.siteUrl) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/gsc/property/:siteId — manually set the GSC property URL
router.patch('/property/:siteId', require('../../middleware/auth').requireAuth, async (req, res) => {
  const { property_url } = req.body;
  if (!property_url) return res.status(400).json({ error: 'property_url required' });
  await supabase.from('managed_sites')
    .update({ gsc_property_url: property_url })
    .eq('id', req.params.siteId);
  res.json({ success: true });
});

module.exports = router;
