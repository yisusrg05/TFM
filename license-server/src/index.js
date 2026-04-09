const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = process.env.PORT || 8080;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'license-server', drm: 'widevine-mock' });
});

app.post('/license', (req, res) => {
  const challengeSize = Buffer.byteLength(JSON.stringify(req.body || {}));

  res.json({
    ok: true,
    mode: 'mock',
    message: 'Servidor de licencias simulado. Reemplazar por integración Widevine real.',
    challengeSize,
    issuedAt: new Date().toISOString(),
    ttlSeconds: 300,
    license: 'BASE64_LICENSE_PLACEHOLDER'
  });
});

app.listen(port, () => {
  console.log(`[license-server] listening on ${port}`);
});
