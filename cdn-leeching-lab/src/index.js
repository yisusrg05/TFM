const crypto = require('crypto');
const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 8080);
const phase = process.env.PHASE || 'fase1';
const cdnBaseUrl = process.env.CDN_BASE_URL || 'http://cdn';
const browserCdnBaseUrl = process.env.BROWSER_CDN_BASE_URL || 'http://localhost:9080';
const assetId = 'local-cenc-clearkey';
const sessions = new Map();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function upstreamHeaders(session, clientInstanceId = session.clientInstanceId) {
  return {
    Authorization: `Bearer ${session.playbackToken}`,
    'X-Playback-Session-Id': session.sessionId,
    'X-Device-Id': session.deviceId,
    'X-Client-Instance-Id': clientInstanceId
  };
}

async function readResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let body = null;
  if (contentType.includes('json')) {
    try { body = await response.json(); } catch (_error) { body = null; }
  } else {
    body = await response.text();
  }
  return { status: response.status, body };
}

async function jsonRequest(route, options = {}) {
  const response = await fetch(`${cdnBaseUrl}${route}`, options);
  return { response, result: await readResponse(response) };
}

function publicSession(session) {
  return {
    labSessionId: session.labSessionId,
    sessionId: session.sessionId,
    accountId: session.accountId,
    deviceId: session.deviceId,
    clientInstanceId: session.clientInstanceId,
    assetId,
    contentRequests: session.contentRequests,
    bytesRelayed: session.bytesRelayed,
    licenseRequests: 0,
    startedAt: session.startedAt,
    playUrl: `/stream/${session.labSessionId}/manifest.mpd`
  };
}

async function overview(session) {
  if (phase !== 'fase2') return null;
  const { result } = await jsonRequest('/admin/overview', {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  return result.status === 200 ? result.body.overview : null;
}

app.get('/api/config', (_req, res) => {
  res.json({ phase, browserCdnBaseUrl, assetId });
});

app.post('/api/start', async (req, res) => {
  const email = req.body?.email || 'usuario-permitido@tfm.local';
  const password = req.body?.password || 'demo123';
  const labSessionId = crypto.randomUUID();
  const deviceId = `external-${phase}-${crypto.randomUUID()}`;
  const clientInstanceId = `iptv-${phase}-${crypto.randomUUID()}`;

  const login = await jsonRequest('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId })
  });
  if (login.result.status !== 200) return res.status(login.result.status).json(login.result.body);

  const accessToken = login.result.body.accessToken;
  const playback = await jsonRequest('/playback/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ assetId, clientInstanceId })
  });
  if (playback.result.status !== 201) return res.status(playback.result.status).json(playback.result.body);

  const session = {
    labSessionId,
    accessToken,
    playbackToken: playback.result.body.playbackToken,
    sessionId: playback.result.body.session.sessionId,
    accountId: login.result.body.user.accountId,
    deviceId,
    clientInstanceId,
    contentRequests: 0,
    bytesRelayed: 0,
    startedAt: new Date().toISOString()
  };
  sessions.set(labSessionId, session);
  res.status(201).json({ ok: true, session: publicSession(session) });
});

app.get('/stream/:labSessionId/manifest.mpd', async (req, res) => {
  const session = sessions.get(req.params.labSessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'UNKNOWN_LAB_SESSION' });
  const response = await fetch(`${cdnBaseUrl}/manifest/${assetId}`, { headers: upstreamHeaders(session) });
  if (!response.ok) return res.status(response.status).send(await response.text());
  const manifest = (await response.text()).replace(/<BaseURL>[^<]*<\/BaseURL>/, '<BaseURL>content/</BaseURL>');
  res.type('application/dash+xml').send(manifest);
});

app.get('/stream/:labSessionId/content/:filename', async (req, res) => {
  const session = sessions.get(req.params.labSessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'UNKNOWN_LAB_SESSION' });
  const headers = upstreamHeaders(session);
  if (req.headers.range) headers.Range = req.headers.range;
  const response = await fetch(`${cdnBaseUrl}/content/dash-known-key/${encodeURIComponent(req.params.filename)}`, { headers });
  const body = Buffer.from(await response.arrayBuffer());
  session.contentRequests += 1;
  session.bytesRelayed += body.length;
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.status(response.status).end(body);
});

app.get('/api/status/:labSessionId', async (req, res) => {
  const session = sessions.get(req.params.labSessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'UNKNOWN_LAB_SESSION' });
  res.json({ ok: true, session: publicSession(session), overview: await overview(session) });
});

app.post('/api/probe/no-token', async (_req, res) => {
  const manifest = await jsonRequest(`/manifest/${assetId}`);
  const segment = await jsonRequest('/content/dash-known-key/video_init.mp4');
  res.json({ ok: true, manifestStatus: manifest.result.status, segmentStatus: segment.result.status });
});

app.post('/api/probe/controls/:labSessionId', async (req, res) => {
  const session = sessions.get(req.params.labSessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'UNKNOWN_LAB_SESSION' });

  const second = await jsonRequest('/playback/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ assetId, clientInstanceId: `second-${crypto.randomUUID()}` })
  });
  const cloned = await jsonRequest(`/manifest/${assetId}`, {
    headers: upstreamHeaders(session, `clone-${crypto.randomUUID()}`)
  });
  const crossAsset = await jsonRequest('/manifest/sintel-widevine', {
    headers: upstreamHeaders(session)
  });
  const noToken = await jsonRequest(`/manifest/${assetId}`);

  res.json({
    ok: true,
    secondSession: second.result,
    clonedInstance: cloned.result,
    crossAsset: crossAsset.result,
    noToken: noToken.result,
    overview: await overview(session)
  });
});

app.post('/api/stop/:labSessionId', async (req, res) => {
  const session = sessions.get(req.params.labSessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'UNKNOWN_LAB_SESSION' });
  const stopped = await jsonRequest('/playback/stop', { method: 'POST', headers: upstreamHeaders(session) });
  res.status(stopped.result.status).json(stopped.result.body);
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'cdn-leeching-lab', phase }));

app.listen(port, () => {
  console.log(`[cdn-leeching-lab:${phase}] listening on ${port}`);
});
