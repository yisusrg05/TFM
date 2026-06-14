const express = require('express');

const app = express();
const port = Number(process.env.PORT || 8080);
const widevineLicenseUrl = process.env.WIDEVINE_LICENSE_URL || '';

function parseHeadersFromEnv() {
  try {
    return JSON.parse(process.env.WIDEVINE_LICENSE_HEADERS_JSON || '{}');
  } catch (_error) {
    return {};
  }
}

app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/internal/license') {
    return express.raw({ type: '*/*', limit: '2mb' })(req, res, next);
  }

  return express.json({ limit: '2mb' })(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'license-server',
    mode: widevineLicenseUrl ? 'phase2-widevine-proxy' : 'not-configured',
    timestamp: new Date().toISOString()
  });
});

app.post('/internal/license', async (req, res) => {
  const accountId = req.get('x-account-id');
  const deviceId = req.get('x-device-id');
  const assetId = req.get('x-asset-id');
  const sessionId = req.get('x-playback-session-id');
  const riskScore = req.get('x-risk-score') || '0';
  const challenge = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

  if (!accountId || !deviceId || !assetId || !sessionId) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_CONTEXT',
      message: 'Missing playback authorization context'
    });
  }

  if (!widevineLicenseUrl) {
    return res.status(501).json({
      ok: false,
      error: 'WIDEVINE_LICENSE_NOT_CONFIGURED',
      message: 'Missing WIDEVINE_LICENSE_URL'
    });
  }

  try {
    const upstreamResponse = await fetch(widevineLicenseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': req.get('content-type') || 'application/octet-stream',
        ...parseHeadersFromEnv()
      },
      body: challenge
    });

    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    res.status(upstreamResponse.status);
    res.set('Content-Type', upstreamResponse.headers.get('content-type') || 'application/octet-stream');
    res.set('Cache-Control', 'no-store');
    res.set('X-License-Context', `${accountId}:${assetId}:${sessionId}`);
    res.set('X-Risk-Score', riskScore);
    return res.send(responseBody);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'UPSTREAM_LICENSE_ERROR',
      message: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`[license-server-phase2] listening on ${port}`);
});
