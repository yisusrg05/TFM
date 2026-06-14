const crypto = require('crypto');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;
const widevineLicenseUrl = process.env.WIDEVINE_LICENSE_URL || '';
const sessions = new Map();

const users = new Map([
  ['usuario-permitido@tfm.local', {
    password: 'demo123',
    accountId: 'acc-allowed-001',
    displayName: 'Usuario con permiso',
    canWatch: true
  }],
  ['usuario-denegado@tfm.local', {
    password: 'demo123',
    accountId: 'acc-denied-001',
    displayName: 'Usuario sin permiso',
    canWatch: false
  }]
]);

function parseHeadersFromEnv() {
  try {
    return JSON.parse(process.env.WIDEVINE_LICENSE_HEADERS_JSON || '{}');
  } catch (_error) {
    return {};
  }
}

function isLicenseRoute(req) {
  return req.method === 'POST' && (
    req.path === '/license' ||
    req.path === '/license/no_auth' ||
    req.path === '/platform/license'
  );
}

function getBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  const user = users.get(session.email);
  return user ? { ...user, email: session.email, token } : null;
}

async function proxyWidevineLicense(challenge, req, res) {
  const challengeSize = challenge.length;

  if (!widevineLicenseUrl) {
    return res.status(501).json({
      ok: false,
      mode: 'widevine-proxy-not-configured',
      message: 'Falta WIDEVINE_LICENSE_URL.',
      challengeSize,
      issuedAt: new Date().toISOString()
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
    res.set('X-Upstream-License-Server', new URL(widevineLicenseUrl).host);
    return res.send(responseBody);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      mode: 'widevine-proxy-error',
      message: error.message,
      challengeSize,
      issuedAt: new Date().toISOString()
    });
  }
}

app.use((req, res, next) => {
  if (isLicenseRoute(req)) {
    return express.raw({ type: '*/*', limit: '2mb' })(req, res, next);
  }

  return express.json({ limit: '2mb' })(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'license-server',
    drm: 'widevine',
    mode: widevineLicenseUrl ? 'proxy' : 'not-configured',
    activeSessions: sessions.size
  });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ ok: false, message: 'Credenciales invalidas' });
  }

  const token = crypto.randomUUID();
  sessions.set(token, {
    email,
    createdAt: new Date().toISOString()
  });

  return res.json({
    ok: true,
    accessToken: token,
    user: {
      email,
      accountId: user.accountId,
      displayName: user.displayName,
      canWatch: user.canWatch
    },
    playback: {
      manifestUri: 'https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd',
      protectedLicenseUri: 'http://localhost:8080/platform/license',
      publicNoAuthLicenseUri: 'http://localhost:8080/license/no_auth'
    }
  });
});

app.get('/auth/me', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, message: 'No autenticado' });
  }

  return res.json({
    ok: true,
    user: {
      email: user.email,
      accountId: user.accountId,
      displayName: user.displayName,
      canWatch: user.canWatch
    }
  });
});

app.post('/platform/license', async (req, res) => {
  const user = getAuthenticatedUser(req);
  const challenge = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body || {}));

  if (!user) {
    return res.status(401).json({
      ok: false,
      mode: 'platform-license-denied',
      message: 'La plataforma requiere login para solicitar licencia.',
      challengeSize: challenge.length
    });
  }

  if (!user.canWatch) {
    return res.status(403).json({
      ok: false,
      mode: 'platform-license-denied',
      message: 'El usuario autenticado no tiene permisos para este contenido.',
      accountId: user.accountId,
      challengeSize: challenge.length
    });
  }

  res.set('X-Platform-User', user.accountId);
  return proxyWidevineLicense(challenge, req, res);
});

app.post(['/license', '/license/no_auth'], async (req, res) => {
  const challenge = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body || {}));
  res.set('X-Phase0-Weakness', 'public-no-auth-license');
  return proxyWidevineLicense(challenge, req, res);
});

app.listen(port, () => {
  console.log(`[license-server] listening on ${port}`);
});
