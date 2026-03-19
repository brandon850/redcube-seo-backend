const { Resend } = require('resend');

const resend   = new Resend(process.env.RESEND_API_KEY);
const LOGO_URL = 'https://redcube.co/wp-content/uploads/2025/08/RedcubeLogoFinal_Signature-1030x340.png';

const BRAND = {
  red:    '#CC0000',
  black:  '#111111',
  dark:   '#1a1a1a',
  card:   '#222222',
  border: '#2e2e2e',
};

const GRADE_COLORS = {
  'A+': '#22c55e', 'A': '#22c55e', 'B+': '#84cc16', 'B': '#84cc16',
  'C+': '#f59e0b', 'C': '#f97316', 'D':  '#ef4444', 'F': '#dc2626',
};

const STATUS_COLOR = {
  Great: '#22c55e', Good: '#84cc16', Okay: '#f59e0b', 'Needs Work': '#f97316', Poor: '#ef4444',
};
const STATUS_BG = {
  Great: 'rgba(34,197,94,.12)', Good: 'rgba(132,204,22,.12)', Okay: 'rgba(245,158,11,.12)',
  'Needs Work': 'rgba(249,115,22,.12)', Poor: 'rgba(239,68,68,.12)',
};

function buildCategoryRow(c) {
  const sc   = STATUS_COLOR[c.status] || '#888';
  const sb   = STATUS_BG[c.status]   || 'rgba(136,136,136,.12)';
  const barC = c.score >= 85 ? '#22c55e' : c.score >= 70 ? '#84cc16' : c.score >= 55 ? '#f59e0b' : c.score >= 40 ? '#f97316' : '#ef4444';
  return `
  <tr><td colspan="2" style="padding:0;border-bottom:1px solid ${BRAND.border};">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:14px 0 8px;font-family:Arial,sans-serif;">
          <span style="font-size:16px;">${c.icon}</span>
          <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fff;margin-left:8px;">${c.name}</span>
          <span style="display:inline-block;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;margin-left:8px;background:${sb};color:${sc};border:1px solid ${sc}33;">${c.status}</span>
        </td>
        <td style="padding:14px 0 8px;text-align:right;font-family:Arial,sans-serif;">
          <span style="font-size:15px;font-weight:900;color:${barC};">${c.score}/100</span>
        </td>
      </tr>
      <tr><td colspan="2" style="padding:0 0 14px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:${BRAND.border};height:3px;padding:0;">
            <div style="background:${barC};height:3px;width:${c.score}%;font-size:0;">&nbsp;</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`;
}

async function sendResultsEmail({ email, name, url, auditResult, resultsUrl }) {
  const gradeColor = GRADE_COLORS[auditResult.grade] || '#888888';
  const greeting   = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';
  const catRows    = (auditResult.categories || []).map(buildCategoryRow).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your SEO Audit Report — RedCube</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

  <tr><td style="background:${BRAND.red};height:3px;font-size:0;">&nbsp;</td></tr>

  <tr><td style="background:${BRAND.black};padding:28px 36px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};" bgcolor="${BRAND.black}">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><table cellpadding="0" cellspacing="0" style="background:${BRAND.black};" bgcolor="${BRAND.black}">
        <tr><td style="padding:0;background:${BRAND.black};" bgcolor="${BRAND.black}">
          <img src="${LOGO_URL}" alt="RedCube Creative" width="160" style="display:block;height:auto;max-width:160px;border:0;">
        </td></tr></table></td>
      <td style="text-align:right;">
        <span style="font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#555;">SEO Audit Report</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:${BRAND.dark};padding:44px 36px;text-align:center;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};">
    <p style="margin:0 0 20px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#555;">${auditResult.domain} &nbsp;·&nbsp; ${auditResult.pagesScanned} pages scanned</p>
    <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;">
      <tr><td style="border:2px solid ${BRAND.border};border-radius:50%;width:150px;height:150px;text-align:center;vertical-align:middle;">
        <div style="font-size:72px;font-weight:900;line-height:1;color:${gradeColor};font-family:Arial,sans-serif;">${auditResult.grade}</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#555;margin-top:4px;">${auditResult.overallScore} / 100</div>
      </td></tr>
    </table>
    <p style="margin:0 auto;max-width:420px;font-size:14px;color:#888;line-height:1.75;">${auditResult.gradeSummary}</p>
  </td></tr>

  <tr><td style="background:${BRAND.card};padding:36px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};">
    <p style="margin:0 0 6px;font-size:14px;color:#ccc;line-height:1.7;">${greeting}</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.75;">Your free SEO audit for <strong style="color:#ccc;">${url}</strong> is complete. We scanned <strong style="color:#ccc;">${auditResult.pagesScanned} pages</strong> and here's how each area performed:</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td colspan="2" style="padding:0 0 12px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#555;border-bottom:1px solid ${BRAND.red};padding-bottom:6px;display:inline-block;">Score Breakdown</span>
      </td></tr>
      ${catRows}
    </table>

    <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 28px;">
      <tr><td style="background:${BRAND.red};border-radius:3px;">
        <a href="${resultsUrl}" style="display:inline-block;padding:16px 40px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#fff;text-decoration:none;">View Your Full Report →</a>
      </td></tr>
    </table>
    <p style="text-align:center;margin:0 0 32px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#555;">Your report is saved at this link and will not expire</p>

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:${BRAND.black};border-top:3px solid ${BRAND.red};padding:28px;">
        <p style="margin:0 0 4px;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${BRAND.red};">Next Step</p>
        <p style="margin:0 0 12px;font-size:16px;font-weight:900;letter-spacing:-.01em;text-transform:uppercase;color:#fff;line-height:1.2;">Let's Turn That Grade Into an A</p>
        <p style="margin:0 0 20px;font-size:13px;color:#888;line-height:1.75;">RedCube specializes in helping local businesses rank higher on Google and turn visitors into customers. Schedule a free 15-minute call and let's review your results together.</p>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:${BRAND.red};border-radius:3px;">
            <a href="https://redcube.co/contact" style="display:inline-block;padding:12px 24px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fff;text-decoration:none;">Schedule a Free Consult →</a>
          </td></tr>
        </table>
        <p style="margin:12px 0 0;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#444;">(678) 877-0609 &nbsp;·&nbsp; No commitment required</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#0a0a0a;padding:20px 36px;border:1px solid ${BRAND.border};border-top:none;" bgcolor="#0a0a0a">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><table cellpadding="0" cellspacing="0" style="background:#0a0a0a;" bgcolor="#0a0a0a">
        <tr><td style="padding:0;background:#0a0a0a;" bgcolor="#0a0a0a">
          <img src="${LOGO_URL}" alt="RedCube" width="100" style="display:block;height:auto;max-width:100px;opacity:.5;border:0;">
        </td></tr></table></td>
      <td style="text-align:right;vertical-align:middle;">
        <p style="margin:0;font-size:10px;color:#444;line-height:1.7;">
          Report generated at your request.<br>
          No spam — ever. &nbsp;<a href="mailto:hello@redcube.co" style="color:#555;text-decoration:none;">hello@redcube.co</a>
        </p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:${BRAND.red};height:3px;font-size:0;">&nbsp;</td></tr>

</table></td></tr></table>
</body></html>`;

  await resend.emails.send({
    from:    'RedCube SEO <hello@redcube.co>',
    to:      email,
    replyTo: 'hello@redcube.co',
    subject: `Your SEO Report: ${auditResult.domain} scored ${auditResult.grade} (${auditResult.overallScore}/100)`,
    html,
  });
}

module.exports = { sendResultsEmail };
