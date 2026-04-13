const crypto = require('crypto');
const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 8080);
const appOrigin = process.env.APP_ORIGIN || 'http://localhost:9300';
const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET || 'access-secret';
const playbackTokenSecret = process.env.PLAYBACK_TOKEN_SECRET || 'playback-secret';
const originBaseUrl = process.env.ORIGIN_BASE_URL || 'http://origin';
const licenseServerUrl = process.env.LICENSE_SERVER_URL || 'http://license-server:8080';
const accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600);
const playbackTokenTtlSeconds = Number(process.env.PLAYBACK_TOKEN_TTL_SECONDS || 90);
const heartbeatGraceSeconds = Number(process.env.HEARTBEAT_GRACE_SECONDS || 45);
const maxConcurrentStreams = Number(process.env.MAX_CONCURRENT_STREAMS || 1);

const users = new Map([
  ['demo@tfm.local', {
    accountId: 'acc-demo-001',
    password: 'demo123',
    displayName: 'Demo Viewer',
    plan: 'student',
    entitlements: ['minimal']
  }]
]);

const playbackSessions = new Map();
const rateLimits = new Map();

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token, secret) {
  const [body, signature] = (token || '').split('.');
  if (!body || !signature) {
    throw new Error('Malformed token');
  }

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);

  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64UrlDecode(body));
  if (payload.exp * 1000 <= Date.now()) {
    throw new Error('Token expired');
  }

  return payload;
}

function nowIso() {
  return new Date().toISOString();
}

function jsonError(res, status, error, details) {
  return res.status(status).json({ ok: false, error, details, timestamp: nowIso() });
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(category, key, limit, windowMs) {
  const mapKey = `${category}:${key}`;
  const now = Date.now();
  const current = rateLimits.get(mapKey);

  if (!current || current.resetAt <= now) {
    rateLimits.set(mapKey, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  return true;
}

function issueAccessToken(account, deviceId) {
  return signToken({
    typ: 'access',
    sub: account.accountId,
    accountId: account.accountId,
    deviceId,
    plan: account.plan,
    entitlements: account.entitlements,
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + accessTokenTtlSeconds
  }, accessTokenSecret);
}

function issuePlaybackToken(session) {
  return signToken({
    typ: 'playback',
    sub: session.accountId,
    accountId: session.accountId,
    deviceId: session.deviceId,
    assetId: session.assetId,
    sessionId: session.sessionId,
    scope: ['content:read', 'license:request', 'heartbeat:write'],
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + playbackTokenTtlSeconds
  }, playbackTokenSecret);
}

function cleanupSessions() {
  const threshold = Date.now() - heartbeatGraceSeconds * 1000;

  for (const [sessionId, session] of playbackSessions.entries()) {
    if (session.status === 'active' && session.lastHeartbeatAt < threshold) {
      session.status = 'expired';
      playbackSessions.set(sessionId, session);
    }
  }
}

function countActiveSessions(accountId) {
  cleanupSessions();

  let count = 0;
  for (const session of playbackSessions.values()) {
    if (session.accountId === accountId && session.status === 'active') {
      count += 1;
    }
  }
  return count;
}

function getBearerToken(req) {
  const value = req.headers.authorization || '';
  if (!value.startsWith('Bearer ')) {
    throw new Error('Missing Bearer token');
  }
  return value.slice('Bearer '.length);
}

function requireAccessToken(req) {
  const payload = verifyToken(getBearerToken(req), accessTokenSecret);
  if (payload.typ !== 'access') {
    throw new Error('Unexpected token type');
  }
  return payload;
}

function requirePlaybackToken(req) {
  const payload = verifyToken(getBearerToken(req), playbackTokenSecret);
  if (payload.typ !== 'playback') {
    throw new Error('Unexpected token type');
  }

  cleanupSessions();

  const session = playbackSessions.get(payload.sessionId);
  if (!session) {
    throw new Error('Unknown playback session');
  }
  if (session.status !== 'active') {
    throw new Error('Playback session is not active');
  }
  if (session.accountId !== payload.accountId || session.deviceId !== payload.deviceId || session.assetId !== payload.assetId) {
    throw new Error('Playback token context mismatch');
  }

  return { payload, session };
}

function updateSessionHeartbeat(session) {
  session.lastHeartbeatAt = Date.now();
  playbackSessions.set(session.sessionId, session);
}

function copyHeaders(sourceHeaders, target, names) {
  for (const name of names) {
    const value = sourceHeaders.get(name);
    if (value) {
      target.setHeader(name, value);
    }
  }
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', appOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, X-Playback-Session-Id, X-Device-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Request-Id');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.get('/health', (_req, res) => {
  cleanupSessions();
  res.json({
    ok: true,
    service: 'control-plane',
    activeSessions: [...playbackSessions.values()].filter((session) => session.status === 'active').length,
    timestamp: nowIso()
  });
});

app.post('/auth/login', (req, res) => {
  const ip = getRequestIp(req);
  if (!rateLimit('auth', ip, 20, 60_000)) {
    return jsonError(res, 429, 'RATE_LIMITED', 'Too many login attempts');
  }

  const { email, password, deviceId } = req.body || {};
  const account = users.get((email || '').toLowerCase());

  if (!account || account.password !== password) {
    return jsonError(res, 401, 'INVALID_CREDENTIALS', 'Use demo@tfm.local / demo123');
  }

  const resolvedDeviceId = deviceId || `web-${crypto.randomUUID()}`;
  const accessToken = issueAccessToken(account, resolvedDeviceId);

  res.json({
    ok: true,
    user: {
      accountId: account.accountId,
      email: 'demo@tfm.local',
      displayName: account.displayName,
      plan: account.plan
    },
    deviceId: resolvedDeviceId,
    accessToken,
    accessTokenExpiresIn: accessTokenTtlSeconds,
    allowedAssets: account.entitlements
  });
});

app.post('/playback/session', (req, res) => {
  const ip = getRequestIp(req);
  if (!rateLimit('playback-session', ip, 60, 60_000)) {
    return jsonError(res, 429, 'RATE_LIMITED', 'Too many playback session requests');
  }

  let accessPayload;
  try {
    accessPayload = requireAccessToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  const { assetId = 'minimal' } = req.body || {};
  if (!accessPayload.entitlements.includes(assetId)) {
    return jsonError(res, 403, 'ASSET_NOT_ALLOWED', `Asset ${assetId} is not in account entitlements`);
  }

  if (countActiveSessions(accessPayload.accountId) >= maxConcurrentStreams) {
    return jsonError(res, 409, 'CONCURRENCY_LIMIT', `The account already has ${maxConcurrentStreams} active session(s)`);
  }

  const session = {
    sessionId: crypto.randomUUID(),
    accountId: accessPayload.accountId,
    deviceId: accessPayload.deviceId,
    assetId,
    ip,
    status: 'active',
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now()
  };

  playbackSessions.set(session.sessionId, session);

  res.status(201).json({
    ok: true,
    session: {
      sessionId: session.sessionId,
      assetId: session.assetId,
      startedAt: new Date(session.startedAt).toISOString(),
      lastHeartbeatAt: new Date(session.lastHeartbeatAt).toISOString(),
      status: session.status
    },
    playbackToken: issuePlaybackToken(session),
    playbackTokenExpiresIn: playbackTokenTtlSeconds,
    manifestUrl: 'http://localhost:9080/content/dash/minimal.mpd'
  });
});

app.post('/playback/heartbeat', (req, res) => {
  const ip = getRequestIp(req);
  if (!rateLimit('heartbeat', ip, 180, 60_000)) {
    return jsonError(res, 429, 'RATE_LIMITED', 'Too many heartbeat requests');
  }

  let authContext;
  try {
    authContext = requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  const headerSessionId = req.headers['x-playback-session-id'];
  if (headerSessionId && headerSessionId !== authContext.payload.sessionId) {
    return jsonError(res, 409, 'SESSION_MISMATCH', 'Heartbeat session id does not match the token');
  }

  updateSessionHeartbeat(authContext.session);

  res.json({
    ok: true,
    sessionId: authContext.session.sessionId,
    playbackToken: issuePlaybackToken(authContext.session),
    playbackTokenExpiresIn: playbackTokenTtlSeconds,
    lastHeartbeatAt: new Date(authContext.session.lastHeartbeatAt).toISOString()
  });
});

app.post('/playback/stop', (req, res) => {
  let authContext;
  try {
    authContext = requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  authContext.session.status = 'stopped';
  authContext.session.stoppedAt = Date.now();
  playbackSessions.set(authContext.session.sessionId, authContext.session);

  res.json({
    ok: true,
    sessionId: authContext.session.sessionId,
    status: authContext.session.status,
    stoppedAt: new Date(authContext.session.stoppedAt).toISOString()
  });
});

app.use('/content/*', async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return jsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET and HEAD are allowed for content');
  }

  const ip = getRequestIp(req);
  if (!rateLimit('content', ip, 600, 60_000)) {
    return jsonError(res, 429, 'RATE_LIMITED', 'Too many content requests');
  }

  let authContext;
  try {
    authContext = requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  if (req.headers['x-playback-session-id'] && req.headers['x-playback-session-id'] !== authContext.payload.sessionId) {
    return jsonError(res, 409, 'SESSION_MISMATCH', 'Header session id does not match the playback token');
  }

  updateSessionHeartbeat(authContext.session);

  const upstreamUrl = `${originBaseUrl}/${req.params[0]}`;
  const upstreamHeaders = {};
  if (req.headers.range) {
    upstreamHeaders.Range = req.headers.range;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders
    });

    res.status(upstreamResponse.status);
    copyHeaders(upstreamResponse.headers, res, [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified'
    ]);
    res.setHeader('X-Playback-Session-Id', authContext.session.sessionId);
    res.setHeader('X-Account-Id', authContext.session.accountId);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    return res.end(buffer);
  } catch (error) {
    return jsonError(res, 502, 'UPSTREAM_ERROR', error.message);
  }
});

app.post('/license', async (req, res) => {
  const ip = getRequestIp(req);
  if (!rateLimit('license', ip, 120, 60_000)) {
    return jsonError(res, 429, 'RATE_LIMITED', 'Too many license requests');
  }

  let authContext;
  try {
    authContext = requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  if (req.headers['x-playback-session-id'] && req.headers['x-playback-session-id'] !== authContext.payload.sessionId) {
    return jsonError(res, 409, 'SESSION_MISMATCH', 'Header session id does not match the playback token');
  }

  updateSessionHeartbeat(authContext.session);

  const licenseRequest = {
    challenge: req.body || {},
    accountId: authContext.session.accountId,
    deviceId: authContext.session.deviceId,
    assetId: authContext.session.assetId,
    sessionId: authContext.session.sessionId,
    requestedAt: nowIso(),
    ip
  };

  try {
    const upstreamResponse = await fetch(`${licenseServerUrl}/internal/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(licenseRequest)
    });

    const payload = await upstreamResponse.json();
    return res.status(upstreamResponse.status).json(payload);
  } catch (error) {
    return jsonError(res, 502, 'UPSTREAM_ERROR', error.message);
  }
});

app.use((req, res) => {
  jsonError(res, 404, 'NOT_FOUND', `No route matched ${req.method} ${req.originalUrl}`);
});

setInterval(cleanupSessions, 10_000).unref();

app.listen(port, () => {
  console.log(`[control-plane] listening on ${port}`);
});
