// End-to-end smoke test: dashboard -> API key -> pair device -> send -> phone polls -> status -> webhook/incoming -> OTP
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smsgw-'));
const { createApp } = await import('../src/index.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, { token, key, body } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...(key && { 'x-api-key': key }),
    },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

// webhook receiver
const hooks = [];
const hookServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { hooks.push({ event: req.headers['x-smsgateway-event'], sig: req.headers['x-smsgateway-signature'], body: JSON.parse(b) }); res.end('ok'); });
}).listen(0);

let r = await call('POST', '/api/auth/register', { body: { email: 'a@b.co', password: 'password123' } });
assert.equal(r.status, 201);
const session = r.json.token;
assert.equal((await call('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'bad' } })).status, 401);

r = await call('POST', '/api/keys', { token: session, body: { name: 'test' } });
const key = r.json.key;
assert.match(key, /^sg_/);

// no device yet
assert.equal((await call('POST', '/v1/messages', { key, body: { to: '+919876543210', body: 'hi' } })).status, 409);
assert.equal((await call('POST', '/v1/messages', { key: 'sg_nope', body: {} })).status, 401);

r = await call('POST', '/device/register', { key, body: { name: 'Pixel' } });
const dev = r.json.device_token;
assert.ok(dev);

await call('PUT', '/api/webhook', { token: session, body: { url: `http://127.0.0.1:${hookServer.address().port}/` } });

assert.equal((await call('POST', '/v1/messages', { key, body: { to: 'abc', body: 'hi' } })).status, 400);
r = await call('POST', '/v1/messages', { key, body: { to: '+91 98765-43210', body: 'Promo!' } });
assert.equal(r.status, 202);
assert.equal(r.json.status, 'pending');
const msgId = r.json.id;

r = await call('GET', '/device/poll', { token: dev });
assert.equal(r.json.messages.length, 1);
assert.equal(r.json.messages[0].address, '+919876543210');

// long-poll wakes up on new message
const waiting = call('GET', '/device/poll', { token: dev });
await new Promise((x) => setTimeout(x, 200));
await call('POST', '/v1/messages', { key, body: { to: '+14155550123', body: 'wake' } });
assert.equal((await waiting).json.messages[0].body, 'wake');

await call('POST', '/device/status', { token: dev, body: { id: msgId, status: 'sent' } });
await call('POST', '/device/status', { token: dev, body: { id: msgId, status: 'delivered' } });
await call('POST', '/device/status', { token: dev, body: { id: msgId, status: 'sent' } }); // late, ignored
assert.equal((await call('GET', `/v1/messages/${msgId}`, { key })).json.status, 'delivered');

r = await call('POST', '/device/incoming', { token: dev, body: { from: '+919999999999', body: 'STOP' } });
assert.equal(r.status, 201);
assert.equal((await call('GET', '/v1/messages?direction=in', { key })).json[0].body, 'STOP');

// OTP flow: read the code out of the queued SMS like the phone would
r = await call('POST', '/v1/otp/send', { key, body: { to: '+919876543210' } });
assert.equal(r.status, 202);
const otpId = r.json.otp_id;
const otpSms = (await call('GET', '/device/poll', { token: dev })).json.messages.find((m) => /verification code/.test(m.body));
const code = otpSms.body.match(/\d{6}/)[0];
assert.equal((await call('POST', '/v1/otp/verify', { key, body: { otp_id: otpId, code: '000000' === code ? '111111' : '000000' } })).status, 400);
assert.equal((await call('POST', '/v1/otp/verify', { key, body: { otp_id: otpId, code } })).json.valid, true);
assert.equal((await call('POST', '/v1/otp/verify', { key, body: { otp_id: otpId, code } })).status, 400); // single use

await new Promise((x) => setTimeout(x, 300));
const events = hooks.map((h) => h.event);
assert.deepEqual(events.filter((e) => e !== 'sms.received').sort(), ['sms.delivered', 'sms.sent']);
assert.ok(events.includes('sms.received'));
assert.match(hooks[0].sig, /^sha256=[0-9a-f]{64}$/);

console.log('smoke test passed');
server.close(); hookServer.close(); process.exit(0);
