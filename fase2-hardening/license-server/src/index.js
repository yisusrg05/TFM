const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 8080);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'license-server', mode: 'phase2-mock', timestamp: new Date().toISOString() });
});

app.post('/internal/license', (req, res) => {
  const { challenge, accountId, deviceId, assetId, sessionId, risk, requestedAt, ip } = req.body || {};

  if (!accountId || !deviceId || !assetId || !sessionId) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_CONTEXT',
      message: 'Missing playback authorization context'
    });
  }

  const challengeSize = Buffer.byteLength(JSON.stringify(challenge || {}));

  return res.json({
    ok: true,
    mode: 'phase2-mock',
    message: 'Licencia simulada emitida con contexto antifraude y trazabilidad.',
    policy: {
      ttlSeconds: 120,
      renewable: true,
      outputProtection: 'mock-widevine-policy-v2'
    },
    risk: risk || { score: 0, reasons: [] },
    session: { sessionId, accountId, deviceId, assetId, requestedAt, ip },
    challengeSize,
    license: 'BASE64_LICENSE_PLACEHOLDER'
  });
});

app.listen(port, () => {
  console.log(`[license-server-phase2] listening on ${port}`);
});
