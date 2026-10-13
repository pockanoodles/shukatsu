import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { makeRoot, people } from './helpers.mjs';
import { createAgent } from '../core/people.mjs';
import { makeCtx } from '../core/http.mjs';
import { handleMcp } from '../core/mcp.mjs';
import { deny, grant, handleOAuth, readPending, setMetadataFetcher, validRedirectUri } from '../core/oauth.mjs';

let root, server, base, owner, editor, agent, freshOwner, clientA, clientB;
const REDIRECT = 'http://127.0.0.1:8976/callback';

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const form = (obj) => new URLSearchParams(obj).toString();
const post = (path, body, type = 'application/x-www-form-urlencoded') => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

async function register(redirect_uris = [REDIRECT]) {
  const res = await post('/oauth/register', { client_name: 'Test Client', redirect_uris }, 'application/json');
  return { res, body: await res.json() };
}

/** Run authorize and return the signed request id from the consent redirect. */
async function authorize(client_id, challenge, extra = {}) {
  const q = new URLSearchParams({
    response_type: 'code', client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
    state: 'xyz', resource: `${base}/mcp`, ...extra,
  });
  const res = await fetch(`${base}/oauth/authorize?${q}`, { redirect: 'manual' });
  return { res, location: res.headers.get('location') };
}

async function codeFor(client_id, challenge) {
  const { location } = await authorize(client_id, challenge);
  const requestId = new URL(location, base).searchParams.get('request');
  const { redirect } = grant(root, { owner: freshOwner, requestId, agentId: agent.id });
  const u = new URL(redirect);
  assert.equal(u.searchParams.get('state'), 'xyz');
  return u.searchParams.get('code');
}

const tokenReq = (obj) => post('/oauth/token', form({ grant_type: 'authorization_code', redirect_uri: REDIRECT, resource: `${base}/mcp`, ...obj }));

async function mcpList(token) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

before(async () => {
  root = makeRoot();
  ({ owner, editor } = people(root));
  agent = createAgent(root, { actor: owner, name: 'claude.ai' });
  freshOwner = { ...owner, session: { created_at: new Date().toISOString() } };
  server = createServer(async (req, res) => {
    const ctx = makeCtx(req, res, { root });
    if (await handleOAuth(req, res, ctx)) return;
    if (req.url.startsWith('/mcp')) return handleMcp(req, res, ctx);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  clientA = (await register()).body;
  clientB = (await register()).body;
});
after(() => { server.close(); setMetadataFetcher(); });
beforeEach(() => setMetadataFetcher());

describe('oauth: discovery', () => {
  it('serves the authorization server metadata', async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    const doc = await res.json();
    assert.equal(res.status, 200);
    assert.equal(doc.issuer, base);
    assert.equal(doc.authorization_endpoint, `${base}/oauth/authorize`);
    assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
    assert.ok(doc.grant_types_supported.includes('refresh_token'));
    assert.equal(doc.client_id_metadata_document_supported, true);
    assert.equal(doc.registration_endpoint, `${base}/oauth/register`);
  });

  it('serves the protected resource metadata at both paths', async () => {
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const doc = await (await fetch(`${base}${p}`)).json();
      assert.equal(doc.resource, `${base}/mcp`);
      assert.deepEqual(doc.authorization_servers, [base]);
    }
  });

  it('leaves other paths alone', async () => {
    const res = await fetch(`${base}/elsewhere`);
    assert.equal(res.status, 404);
  });
});

describe('oauth: redirect URIs and registration', () => {
  it('accepts https and loopback http only', () => {
    assert.ok(validRedirectUri('https://claude.ai/api/mcp/auth_callback'));
    assert.ok(validRedirectUri('http://localhost:33418/callback'));
    assert.ok(validRedirectUri('http://127.0.0.1/cb'));
    assert.ok(!validRedirectUri('http://example.com/cb'));
    assert.ok(!validRedirectUri('myapp://cb'));
    assert.ok(!validRedirectUri('https://example.com/cb#frag'));
    assert.ok(!validRedirectUri('https://user:pw@example.com/cb'));
    assert.ok(!validRedirectUri('nonsense'));
  });

  it('registers a public client', async () => {
    const { res, body } = await register();
    assert.equal(res.status, 201);
    assert.match(body.client_id, /^shk_client_/);
    assert.equal(body.token_endpoint_auth_method, 'none');
  });

  it('refuses a bad redirect URI or a client secret method', async () => {
    assert.equal((await register(['http://evil.example/cb'])).res.status, 400);
    const res = await post('/oauth/register', { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }, 'application/json');
    assert.equal(res.status, 400);
  });
});

describe('oauth: authorize', () => {
  it('sends a valid request to the consent page with a signed request id and no secrets', async () => {
    const client = clientA;
    const { challenge } = pkce();
    const { res, location } = await authorize(client.client_id, challenge);
    assert.equal(res.status, 302);
    assert.match(location, /^\/oauth\/consent\?request=/);
    assert.ok(!location.includes('code='));
    const pending = await readPending(root, new URL(location, base).searchParams.get('request'));
    assert.equal(pending.client_name, 'Test Client');
    assert.equal(pending.redirect_host, '127.0.0.1:8976');
    assert.equal(await readPending(root, 'forged.value'), null);
  });

  it('refuses a redirect_uri the client did not register, without redirecting', async () => {
    const client = clientA;
    const { res, location } = await authorize(client.client_id, pkce().challenge, { redirect_uri: 'http://127.0.0.1:9999/other' });
    assert.equal(res.status, 400);
    assert.equal(location, null);
  });

  it('refuses an unknown client', async () => {
    const { res } = await authorize('shk_client_nope', pkce().challenge);
    assert.equal(res.status, 400);
  });

  it('reports a missing S256 challenge or a wrong resource to the redirect_uri', async () => {
    const client = clientA;
    const plain = await authorize(client.client_id, pkce().challenge, { code_challenge_method: 'plain' });
    assert.equal(plain.res.status, 302);
    assert.match(plain.location, /^http:\/\/127\.0\.0\.1:8976\/callback\?error=invalid_request/);
    assert.equal(new URL(plain.location).searchParams.get('state'), 'xyz');
    const none = await authorize(client.client_id, '');
    assert.match(none.location, /error=invalid_request/);
    const wrong = await authorize(client.client_id, pkce().challenge, { resource: 'https://other.example/mcp' });
    assert.match(wrong.location, /error=invalid_target/);
    const type = await authorize(client.client_id, pkce().challenge, { response_type: 'token' });
    assert.match(type.location, /error=unsupported_response_type/);
  });

  it('accepts a client ID metadata document', async () => {
    const id = 'https://client.example/oauth/metadata.json';
    setMetadataFetcher(async (url) => {
      assert.equal(url, id);
      return { client_id: id, client_name: 'Doc Client', redirect_uris: [REDIRECT] };
    });
    const { res, location } = await authorize(id, pkce().challenge);
    assert.equal(res.status, 302);
    const pending = await readPending(root, new URL(location, base).searchParams.get('request'));
    assert.equal(pending.client_name, 'Doc Client');
    assert.equal(pending.client_host, 'client.example');
  });

  it('refuses a metadata document that names another client_id or bad redirect URIs', async () => {
    const id = 'https://client.example/other.json';
    setMetadataFetcher(async () => ({ client_id: 'https://evil.example/x', redirect_uris: [REDIRECT] }));
    assert.equal((await authorize(id, pkce().challenge)).res.status, 400);
    const id2 = 'https://client.example/third.json';
    setMetadataFetcher(async () => ({ client_id: id2, redirect_uris: ['http://evil.example/cb'] }));
    assert.equal((await authorize(id2, pkce().challenge)).res.status, 400);
  });

  it('never fetches metadata from http, private, or loopback hosts', async () => {
    for (const id of ['http://client.example/m.json', 'https://localhost/m.json', 'https://127.0.0.1/m.json', 'https://169.254.169.254/m.json', 'https://client.example/']) {
      const { res } = await authorize(id, pkce().challenge);
      assert.equal(res.status, 400, id);
    }
  });
});

describe('oauth: the code flow', () => {
  it('runs authorize, consent, token, mcp, refresh, and rotation', async () => {
    const client = clientA;
    const { verifier, challenge } = pkce();
    const code = await codeFor(client.client_id, challenge);

    const res = await tokenReq({ client_id: client.client_id, code, code_verifier: verifier });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const tokens = await res.json();
    assert.equal(tokens.token_type, 'Bearer');
    assert.equal(tokens.expires_in, 3600);
    assert.match(tokens.access_token, /^shk_oauth_/);
    assert.match(tokens.refresh_token, /^shk_refresh_/);

    const listed = await mcpList(tokens.access_token);
    assert.equal(listed.status, 200);
    const names = listed.body.result.tools.map((t) => t.name);
    assert.ok(names.includes('tracker_list'));
    assert.ok(!names.includes('review_decide'));

    // A refresh token is not a bearer credential for the API.
    assert.equal((await mcpList(tokens.refresh_token)).status, 401);

    const next = await (await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }))).json();
    assert.match(next.access_token, /^shk_oauth_/);
    assert.notEqual(next.refresh_token, tokens.refresh_token);
    assert.equal((await mcpList(next.access_token)).status, 200);

    const replay = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }));
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, 'invalid_grant');
  });

  it('spends a code once', async () => {
    const client = clientA;
    const { verifier, challenge } = pkce();
    const code = await codeFor(client.client_id, challenge);
    assert.equal((await tokenReq({ client_id: client.client_id, code, code_verifier: verifier })).status, 200);
    const again = await tokenReq({ client_id: client.client_id, code, code_verifier: verifier });
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'invalid_grant');
  });

  it('refuses the wrong verifier, and the code is spent anyway', async () => {
    const client = clientA;
    const { verifier, challenge } = pkce();
    const code = await codeFor(client.client_id, challenge);
    const bad = await tokenReq({ client_id: client.client_id, code, code_verifier: pkce().verifier });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'invalid_grant');
    assert.equal((await tokenReq({ client_id: client.client_id, code, code_verifier: verifier })).status, 400);
  });

  it('refuses a redirect_uri that differs from the request', async () => {
    const client = clientA;
    const { verifier, challenge } = pkce();
    const code = await codeFor(client.client_id, challenge);
    const res = await tokenReq({ client_id: client.client_id, code, code_verifier: verifier, redirect_uri: 'http://127.0.0.1:8976/other' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_grant');
  });

  it('refuses a code presented by another client', async () => {
    const a = clientA;
    const b = clientB;
    const { verifier, challenge } = pkce();
    const code = await codeFor(a.client_id, challenge);
    assert.equal((await tokenReq({ client_id: b.client_id, code, code_verifier: verifier })).status, 400);
  });

  it('refuses a refresh token that belongs to another client', async () => {
    const a = clientA;
    const b = clientB;
    const { verifier, challenge } = pkce();
    const code = await codeFor(a.client_id, challenge);
    const tokens = await (await tokenReq({ client_id: a.client_id, code, code_verifier: verifier })).json();
    const res = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: b.client_id }));
    assert.equal(res.status, 400);
    // The rightful client's token survives the attempt.
    assert.equal((await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: a.client_id }))).status, 200);
  });

  it('refuses an unsupported grant type', async () => {
    const client = clientA;
    const res = await post('/oauth/token', form({ grant_type: 'password', client_id: client.client_id }));
    assert.equal((await res.json()).error, 'unsupported_grant_type');
  });

  it('revokes an access token and its refresh token', async () => {
    const client = clientA;
    const { verifier, challenge } = pkce();
    const code = await codeFor(client.client_id, challenge);
    const tokens = await (await tokenReq({ client_id: client.client_id, code, code_verifier: verifier })).json();
    const res = await post('/oauth/revoke', form({ token: tokens.access_token, client_id: client.client_id }));
    assert.equal(res.status, 200);
    assert.equal((await mcpList(tokens.access_token)).status, 401);
    const refresh = await post('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }));
    assert.equal(refresh.status, 400);
    assert.equal((await post('/oauth/revoke', form({ token: 'shk_oauth_unknown' }))).status, 200);
  });

  it('cuts off an agent that is disabled after the grant', async () => {
    const { disableAgent } = await import('../core/people.mjs');
    const other = createAgent(root, { actor: owner, name: 'short lived' });
    const client = clientA;
    const { verifier, challenge } = pkce();
    const { location } = await authorize(client.client_id, challenge);
    const { redirect } = grant(root, { owner: freshOwner, requestId: new URL(location, base).searchParams.get('request'), agentId: other.id });
    const tokens = await (await tokenReq({ client_id: client.client_id, code: new URL(redirect).searchParams.get('code'), code_verifier: verifier })).json();
    disableAgent(root, { actor: owner, id: other.id });
    assert.equal((await mcpList(tokens.access_token)).status, 401);
  });
});

describe('oauth: consent is a stamp', () => {
  let requestId;
  beforeEach(async () => {
    const client = clientA;
    const { location } = await authorize(client.client_id, pkce().challenge);
    requestId = new URL(location, base).searchParams.get('request');
  });

  it('needs the owner', () => {
    assert.throws(() => grant(root, { owner: { ...editor, session: { created_at: new Date().toISOString() } }, requestId, agentId: agent.id }), /Only the owner/);
    assert.throws(() => grant(root, { owner: { ...agent, session: { created_at: new Date().toISOString() } }, requestId, agentId: agent.id }), /Only the owner/);
    assert.throws(() => grant(root, { owner: null, requestId, agentId: agent.id }), /Only the owner/);
  });

  it('needs a recent sign-in', () => {
    const old = { ...owner, session: { created_at: new Date(Date.now() - 11 * 60_000).toISOString() } };
    assert.throws(() => grant(root, { owner: old, requestId, agentId: agent.id }), /Sign in again/);
    assert.throws(() => grant(root, { owner, requestId, agentId: agent.id }), /Sign in again/);
  });

  it('only hands out an agent identity, never a person', () => {
    assert.throws(() => grant(root, { owner: freshOwner, requestId, agentId: owner.id }), /agent identity/);
    assert.throws(() => grant(root, { owner: freshOwner, requestId, agentId: 99999 }), /agent identity/);
  });

  it('refuses a forged or tampered request id', () => {
    assert.throws(() => grant(root, { owner: freshOwner, requestId: `${requestId}x`, agentId: agent.id }), /expired/);
    const [payload] = requestId.split('.');
    assert.throws(() => grant(root, { owner: freshOwner, requestId: `${payload}.AAAA`, agentId: agent.id }), /expired/);
  });

  it('sends access_denied back to the client on a denial', () => {
    const { redirect } = deny(root, { requestId });
    const u = new URL(redirect);
    assert.equal(u.searchParams.get('error'), 'access_denied');
    assert.equal(u.searchParams.get('state'), 'xyz');
    assert.equal(u.searchParams.get('code'), null);
  });

  it('stores the code only as a hash and logs who granted it', async () => {
    const { redirect } = grant(root, { owner: freshOwner, requestId, agentId: agent.id });
    const code = new URL(redirect).searchParams.get('code');
    const { db } = await import('../core/store.mjs');
    const rows = db(root).prepare('SELECT * FROM oauth_codes WHERE granted_by = ? ORDER BY created_at DESC').all(owner.id);
    assert.ok(rows.length);
    assert.ok(rows.every((r) => r.code_hash !== code && r.code_hash.length === 64));
    assert.equal(rows[0].user_id, agent.id);
    assert.ok(db(root).prepare(`SELECT 1 FROM activity WHERE verb = 'oauth.granted'`).get());
  });
});
