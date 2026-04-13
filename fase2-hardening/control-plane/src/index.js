const crypto = require('crypto');
const express = require('express');
const { createClient } = require('redis');

const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 8080);
const appOrigin = process.env.APP_ORIGIN || 'http://localhost:9400';
const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET || 'access-secret';
const playbackTokenSecret = process.env.PLAYBACK_TOKEN_SECRET || 'playback-secret';
const originBaseUrl = process.env.ORIGIN_BASE_URL || 'http://origin';
const licenseServerUrl = process.env.LICENSE_SERVER_URL || 'http://license-server:8080';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600);
const playbackTokenTtlSeconds = Number(process.env.PLAYBACK_TOKEN_TTL_SECONDS || 90);
const heartbeatGraceSeconds = Number(process.env.HEARTBEAT_GRACE_SECONDS || 45);
const maxConcurrentStreams = Number(process.env.MAX_CONCURRENT_STREAMS || 1);
const autoBanThreshold = Number(process.env.AUTO_BAN_THRESHOLD || 100);
const eventRetention = Number(process.env.EVENT_RETENTION || 300);

const users = new Map([
  ['demo@tfm.local', {
    accountId: 'acc-demo-001',
    password: 'demo123',
    displayName: 'Demo Viewer',
    plan: 'student',
    entitlements: ['minimal'],
    roles: ['user', 'admin']
  }]
]);

const redis = createClient({ url: redisUrl });
redis.on('error', (error) => {
  console.error('[redis]', error.message);
});

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

function jsonError(res, status, error, details, extra = {}) {
  return res.status(status).json({ ok: false, error, details, timestamp: nowIso(), ...extra });
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function getBearerToken(req) {
  const value = req.headers.authorization || '';
  if (!value.startsWith('Bearer ')) {
    throw new Error('Missing Bearer token');
  }
  return value.slice('Bearer '.length);
}

async function setJson(key, value, ttlSeconds) {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.set(key, serialized, { EX: ttlSeconds });
  } else {
    await redis.set(key, serialized);
  }
}

async function getJson(key, fallback = null) {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : fallback;
}

async function pushEvent(type, payload) {
  const event = { id: crypto.randomUUID(), type, timestamp: nowIso(), ...payload };
  await redis.lPush('events', JSON.stringify(event));
  await redis.lTrim('events', 0, eventRetention - 1);
  return event;
}

async function getEvents(limit = 50) {
  const rows = await redis.lRange('events', 0, Math.max(0, limit - 1));
  return rows.map((row) => JSON.parse(row));
}

async function getRisk(accountId) {
  return getJson(`risk:${accountId}`, { accountId, score: 0, reasons: [], lastUpdatedAt: nowIso() });
}

async function storeRisk(risk) {
  risk.lastUpdatedAt = nowIso();
  await setJson(`risk:${risk.accountId}`, risk, 86400);
}

async function appendReason(risk, reason) {
  if (!risk.reasons.includes(reason)) {
    risk.reasons = [reason, ...risk.reasons].slice(0, 8);
  }
}

async function createBan({ type, subjectId, reason, createdBy, ttlSeconds = 1800 }) {
  const ban = {
    id: crypto.randomUUID(),
    type,
    subjectId,
    reason,
    createdBy,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
  };
  await setJson(`ban:${type}:${subjectId}`, ban, ttlSeconds);
  await pushEvent('ban.created', ban);
  return ban;
}

async function getBan(type, subjectId) {
  return getJson(`ban:${type}:${subjectId}`);
}

async function clearBan(type, subjectId) {
  await redis.del(`ban:${type}:${subjectId}`);
  await pushEvent('ban.cleared', { type, subjectId });
}

async function ensureNotBanned({ accountId, deviceId }) {
  const accountBan = accountId ? await getBan('account', accountId) : null;
  if (accountBan) {
    throw new Error(`Account banned until ${accountBan.expiresAt}`);
  }
  const deviceBan = deviceId ? await getBan('device', deviceId) : null;
  if (deviceBan) {
    throw new Error(`Device banned until ${deviceBan.expiresAt}`);
  }
}

function issueAccessToken(account, deviceId) {
  return signToken({
    typ: 'access',
    sub: account.accountId,
    accountId: account.accountId,
    deviceId,
    plan: account.plan,
    entitlements: account.entitlements,
    roles: account.roles,
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

async function storeSession(session) {
  await setJson(`session:${session.sessionId}`, session, Math.max(playbackTokenTtlSeconds, heartbeatGraceSeconds) * 10);
  await redis.sAdd(`account-sessions:${session.accountId}`, session.sessionId);
  await redis.expire(`account-sessions:${session.accountId}`, 86400);
}

async function getSession(sessionId) {
  return getJson(`session:${sessionId}`);
}

async function listSessionsForAccount(accountId) {
  const ids = await redis.sMembers(`account-sessions:${accountId}`);
  const rows = await Promise.all(ids.map((id) => getSession(id)));
  return rows.filter(Boolean);
}

async function cleanupSessions() {
  const keys = await redis.keys('session:*');
  const now = Date.now();

  for (const key of keys) {
    const session = await getJson(key);
    if (!session) {
      continue;
    }
    if (session.status === 'active' && session.lastHeartbeatAt < now - heartbeatGraceSeconds * 1000) {
      session.status = 'expired';
      session.expiredAt = now;
      await storeSession(session);
      await pushEvent('playback.expired', { sessionId: session.sessionId, accountId: session.accountId, deviceId: session.deviceId });
    }
  }
}

async function countActiveSessions(accountId) {
  await cleanupSessions();
  const sessions = await listSessionsForAccount(accountId);
  return sessions.filter((session) => session.status === 'active').length;
}

async function rememberIp(accountId, ip) {
  const key = `account-ips:${accountId}`;
  const current = await getJson(key, {});
  current[ip] = Date.now();
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [value, seenAt] of Object.entries(current)) {
    if (seenAt < cutoff) {
      delete current[value];
    }
  }
  await setJson(key, current, 3600);
  return Object.keys(current);
}

async function incrementCounter(key, ttlSeconds) {
  const value = await redis.incr(key);
  if (value === 1) {
    await redis.expire(key, ttlSeconds);
  }
  return value;
}

async function addRisk(accountId, score, reason, context = {}) {
  const risk = await getRisk(accountId);
  risk.score += score;
  await appendReason(risk, reason);
  await storeRisk(risk);
  await pushEvent('risk.incremented', { accountId, scoreAdded: score, reason, context, risk });
  if (risk.score >= autoBanThreshold) {
    await createBan({
      type: 'account',
      subjectId: accountId,
      reason: `AUTO_BAN:${reason}`,
      createdBy: 'system',
      ttlSeconds: 1800
    });
  }
  return risk;
}

async function decayRisk(accountId, amount) {
  const risk = await getRisk(accountId);
  risk.score = Math.max(0, risk.score - amount);
  await storeRisk(risk);
  return risk;
}

async function applyAccountSignals({ accountId, deviceId, ip, signal }) {
  if (!accountId) {
    return getRisk('anonymous');
  }

  if (signal === 'login.success') {
    const ips = await rememberIp(accountId, ip);
    if (ips.length >= 3) {
      await addRisk(accountId, 30, 'MULTI_IP_ACTIVITY', { ips });
    } else {
      await decayRisk(accountId, 5);
    }
  }

  if (signal === 'playback.concurrency_rejected') {
    const count = await incrementCounter(`counter:concurrency:${accountId}`, 600);
    if (count >= 2) {
      await addRisk(accountId, 25, 'REPEATED_CONCURRENCY_VIOLATION', { count });
    }
  }

  if (signal === 'license.request') {
    const count = await incrementCounter(`counter:license:${accountId}`, 300);
    if (count >= 6) {
      await addRisk(accountId, 20, 'LICENSE_BURST', { count });
    }
  }

  if (signal === 'content.request') {
    const count = await incrementCounter(`counter:content:${accountId}`, 60);
    if (count >= 40) {
      await addRisk(accountId, 15, 'CONTENT_RATE_SPIKE', { count });
    }
  }

  if (signal === 'heartbeat.request') {
    const count = await incrementCounter(`counter:heartbeat:${accountId}`, 60);
    if (count >= 8) {
      await addRisk(accountId, 10, 'HEARTBEAT_CADENCE_SPIKE', { count });
    }
  }

  if (signal === 'auth.failure') {
    const count = await incrementCounter(`counter:auth-failure:${deviceId || ip}`, 300);
    if (count >= 8) {
      await createBan({ type: 'device', subjectId: deviceId || ip, reason: 'AUTH_FAILURE_BURST', createdBy: 'system', ttlSeconds: 900 });
    }
  }

  return getRisk(accountId);
}

async function requireAccessToken(req) {
  const payload = verifyToken(getBearerToken(req), accessTokenSecret);
  if (payload.typ !== 'access') {
    throw new Error('Unexpected token type');
  }
  await ensureNotBanned({ accountId: payload.accountId, deviceId: payload.deviceId });
  return payload;
}

async function requirePlaybackToken(req) {
  const payload = verifyToken(getBearerToken(req), playbackTokenSecret);
  if (payload.typ !== 'playback') {
    throw new Error('Unexpected token type');
  }

  const session = await getSession(payload.sessionId);
  if (!session) {
    throw new Error('Unknown playback session');
  }
  if (session.status !== 'active') {
    throw new Error('Playback session is not active');
  }
  if (session.accountId !== payload.accountId || session.deviceId !== payload.deviceId || session.assetId !== payload.assetId) {
    throw new Error('Playback token context mismatch');
  }
  await ensureNotBanned({ accountId: payload.accountId, deviceId: payload.deviceId });
  return { payload, session };
}

function copyHeaders(sourceHeaders, target, names) {
  for (const name of names) {
    const value = sourceHeaders.get(name);
    if (value) {
      target.setHeader(name, value);
    }
  }
}

function requireAdmin(accessPayload) {
  if (!accessPayload.roles || !accessPayload.roles.includes('admin')) {
    throw new Error('Admin role required');
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

app.get('/health', async (_req, res) => {
  await cleanupSessions();
  const keys = await redis.keys('session:*');
  res.json({ ok: true, service: 'control-plane-phase2', activeSessionKeys: keys.length, timestamp: nowIso() });
});

app.post('/auth/login', async (req, res) => {
  const ip = getRequestIp(req);
  const { email, password, deviceId } = req.body || {};
  const account = users.get((email || '').toLowerCase());

  if (!account || account.password !== password) {
    await applyAccountSignals({ accountId: account?.accountId, deviceId, ip, signal: 'auth.failure' });
    await pushEvent('auth.failure', { email, deviceId, ip });
    return jsonError(res, 401, 'INVALID_CREDENTIALS', 'Use demo@tfm.local / demo123');
  }

  const resolvedDeviceId = deviceId || `web-${crypto.randomUUID()}`;
  try {
    await ensureNotBanned({ accountId: account.accountId, deviceId: resolvedDeviceId });
  } catch (error) {
    await pushEvent('auth.blocked', { accountId: account.accountId, deviceId: resolvedDeviceId, ip, reason: error.message });
    return jsonError(res, 403, 'BANNED', error.message);
  }

  const accessToken = issueAccessToken(account, resolvedDeviceId);
  const risk = await applyAccountSignals({ accountId: account.accountId, deviceId: resolvedDeviceId, ip, signal: 'login.success' });
  await pushEvent('auth.success', { accountId: account.accountId, deviceId: resolvedDeviceId, ip, risk });

  res.json({
    ok: true,
    user: {
      accountId: account.accountId,
      email: 'demo@tfm.local',
      displayName: account.displayName,
      plan: account.plan,
      roles: account.roles
    },
    deviceId: resolvedDeviceId,
    accessToken,
    accessTokenExpiresIn: accessTokenTtlSeconds,
    allowedAssets: account.entitlements,
    risk
  });
});

app.post('/playback/session', async (req, res) => {
  const ip = getRequestIp(req);
  let accessPayload;
  try {
    accessPayload = await requireAccessToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  const { assetId = 'minimal' } = req.body || {};
  if (!accessPayload.entitlements.includes(assetId)) {
    return jsonError(res, 403, 'ASSET_NOT_ALLOWED', `Asset ${assetId} is not in account entitlements`);
  }

  if (await countActiveSessions(accessPayload.accountId) >= maxConcurrentStreams) {
    await applyAccountSignals({ accountId: accessPayload.accountId, deviceId: accessPayload.deviceId, ip, signal: 'playback.concurrency_rejected' });
    await pushEvent('playback.concurrency_rejected', { accountId: accessPayload.accountId, deviceId: accessPayload.deviceId, ip });
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

  await storeSession(session);
  const risk = await getRisk(accessPayload.accountId);
  await pushEvent('playback.session_created', { sessionId: session.sessionId, accountId: session.accountId, deviceId: session.deviceId, ip, risk });

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
    manifestUrl: 'http://localhost:9180/content/dash/minimal.mpd',
    risk
  });
});

app.post('/playback/heartbeat', async (req, res) => {
  let authContext;
  try {
    authContext = await requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  if (req.headers['x-playback-session-id'] && req.headers['x-playback-session-id'] !== authContext.payload.sessionId) {
    return jsonError(res, 409, 'SESSION_MISMATCH', 'Heartbeat session id does not match the token');
  }

  authContext.session.lastHeartbeatAt = Date.now();
  await storeSession(authContext.session);
  const risk = await applyAccountSignals({ accountId: authContext.session.accountId, deviceId: authContext.session.deviceId, ip: getRequestIp(req), signal: 'heartbeat.request' });
  await pushEvent('playback.heartbeat', { sessionId: authContext.session.sessionId, accountId: authContext.session.accountId, risk });

  res.json({
    ok: true,
    sessionId: authContext.session.sessionId,
    playbackToken: issuePlaybackToken(authContext.session),
    playbackTokenExpiresIn: playbackTokenTtlSeconds,
    lastHeartbeatAt: new Date(authContext.session.lastHeartbeatAt).toISOString(),
    risk
  });
});

app.post('/playback/stop', async (req, res) => {
  let authContext;
  try {
    authContext = await requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  authContext.session.status = 'stopped';
  authContext.session.stoppedAt = Date.now();
  await storeSession(authContext.session);
  await pushEvent('playback.stopped', { sessionId: authContext.session.sessionId, accountId: authContext.session.accountId });

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

  let authContext;
  try {
    authContext = await requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  authContext.session.lastHeartbeatAt = Date.now();
  await storeSession(authContext.session);
  const risk = await applyAccountSignals({
    accountId: authContext.session.accountId,
    deviceId: authContext.session.deviceId,
    ip: getRequestIp(req),
    signal: 'content.request'
  });

  const upstreamUrl = `${originBaseUrl}/${req.params[0]}`;
  const upstreamHeaders = {};
  if (req.headers.range) {
    upstreamHeaders.Range = req.headers.range;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, { method: req.method, headers: upstreamHeaders });
    res.status(upstreamResponse.status);
    copyHeaders(upstreamResponse.headers, res, ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']);
    res.setHeader('X-Playback-Session-Id', authContext.session.sessionId);
    res.setHeader('X-Risk-Score', String(risk.score));
    await pushEvent('content.request', { sessionId: authContext.session.sessionId, accountId: authContext.session.accountId, path: req.params[0], risk });

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
  let authContext;
  try {
    authContext = await requirePlaybackToken(req);
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', error.message);
  }

  authContext.session.lastHeartbeatAt = Date.now();
  await storeSession(authContext.session);
  const risk = await applyAccountSignals({
    accountId: authContext.session.accountId,
    deviceId: authContext.session.deviceId,
    ip: getRequestIp(req),
    signal: 'license.request'
  });

  const licenseRequest = {
    challenge: req.body || {},
    accountId: authContext.session.accountId,
    deviceId: authContext.session.deviceId,
    assetId: authContext.session.assetId,
    sessionId: authContext.session.sessionId,
    requestedAt: nowIso(),
    ip: getRequestIp(req),
    risk
  };

  try {
    const upstreamResponse = await fetch(`${licenseServerUrl}/internal/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(licenseRequest)
    });
    const payload = await upstreamResponse.json();
    await pushEvent('license.request', { sessionId: authContext.session.sessionId, accountId: authContext.session.accountId, risk });
    return res.status(upstreamResponse.status).json(payload);
  } catch (error) {
    return jsonError(res, 502, 'UPSTREAM_ERROR', error.message);
  }
});

app.get('/admin/overview', async (req, res) => {
  let accessPayload;
  try {
    accessPayload = await requireAccessToken(req);
    requireAdmin(accessPayload);
  } catch (error) {
    return jsonError(res, 403, 'FORBIDDEN', error.message);
  }

  await cleanupSessions();
  const sessions = (await listSessionsForAccount(accessPayload.accountId)).sort((a, b) => b.startedAt - a.startedAt);
  const risk = await getRisk(accessPayload.accountId);
  const accountBan = await getBan('account', accessPayload.accountId);
  const deviceBan = await getBan('device', accessPayload.deviceId);
  const events = await getEvents(20);

  res.json({
    ok: true,
    overview: {
      accountId: accessPayload.accountId,
      activeSessions: sessions.filter((session) => session.status === 'active').length,
      sessions,
      risk,
      bans: [accountBan, deviceBan].filter(Boolean),
      recentEvents: events
    }
  });
});

app.get('/admin/events', async (req, res) => {
  let accessPayload;
  try {
    accessPayload = await requireAccessToken(req);
    requireAdmin(accessPayload);
  } catch (error) {
    return jsonError(res, 403, 'FORBIDDEN', error.message);
  }

  const limit = Number(req.query.limit || 50);
  res.json({ ok: true, events: await getEvents(limit) });
});

app.post('/admin/bans', async (req, res) => {
  let accessPayload;
  try {
    accessPayload = await requireAccessToken(req);
    requireAdmin(accessPayload);
  } catch (error) {
    return jsonError(res, 403, 'FORBIDDEN', error.message);
  }

  const { type, subjectId, reason, ttlSeconds = 1800 } = req.body || {};
  if (!['account', 'device'].includes(type) || !subjectId || !reason) {
    return jsonError(res, 400, 'INVALID_BAN_REQUEST', 'type, subjectId and reason are required');
  }

  const ban = await createBan({ type, subjectId, reason, createdBy: accessPayload.accountId, ttlSeconds: Number(ttlSeconds) });
  res.status(201).json({ ok: true, ban });
});

app.post('/admin/bans/clear', async (req, res) => {
  let accessPayload;
  try {
    accessPayload = await requireAccessToken(req);
    requireAdmin(accessPayload);
  } catch (error) {
    return jsonError(res, 403, 'FORBIDDEN', error.message);
  }

  const { type, subjectId } = req.body || {};
  if (!['account', 'device'].includes(type) || !subjectId) {
    return jsonError(res, 400, 'INVALID_BAN_CLEAR_REQUEST', 'type and subjectId are required');
  }

  await clearBan(type, subjectId);
  res.json({ ok: true, type, subjectId });
});

app.use((req, res) => {
  jsonError(res, 404, 'NOT_FOUND', `No route matched ${req.method} ${req.originalUrl}`);
});

async function start() {
  await redis.connect();
  await pushEvent('system.started', { service: 'control-plane-phase2' });
  setInterval(() => {
    cleanupSessions().catch((error) => console.error('[cleanup]', error.message));
  }, 10000).unref();

  app.listen(port, () => {
    console.log(`[control-plane-phase2] listening on ${port}`);
  });
}

start().catch((error) => {
  console.error('[startup]', error);
  process.exit(1);
});
