import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../careerjet-relay/server.mjs";
import { careerjetSearchResponse } from "../Cloudflare-worker/careerjet.js";

const SECRET = "s".repeat(24);
function fakeRes() { return { status: 0, body: "", writeHead(s) { this.status = s; }, end(b) { this.body = b; } }; }
const call = async (handler, url, headers) => { const res = fakeRes(); await handler({ method: "GET", url, headers }, res); return res; };

test("relay rejects bad secret and missing visitor ip", async () => {
  const h = createHandler({ CAREERJET_API_KEY: "k", CAREERJET_RELAY_SECRET: SECRET, SITE_URL: "https://sa-recruiters.co.za" }, async () => { throw new Error("must not call upstream"); });
  assert.equal((await call(h, "/careerjet?keywords=a", { "x-relay-secret": "nope" })).status, 401);
  assert.equal((await call(h, "/careerjet?keywords=a", { "x-relay-secret": SECRET })).status, 400);
  assert.equal((await call(h, "/health", {})).status, 200);
});

test("relay calls Careerjet with basic auth, visitor ip and site referer", async () => {
  let seen;
  const h = createHandler({ CAREERJET_API_KEY: " key\n", CAREERJET_RELAY_SECRET: SECRET, SITE_URL: "https://sa-recruiters.co.za" },
    async (url, init) => { seen = { url: new URL(url), init }; return new Response('{"type":"JOBS","jobs":[]}', { status: 200 }); });
  const res = await call(h, "/careerjet?keywords=welder&location=Durban", { "x-relay-secret": SECRET, "x-visitor-ip": "41.13.0.1", "x-visitor-ua": "UA/1", "x-referer": "https://evil.example/x" });
  assert.equal(res.status, 200);
  assert.equal(seen.url.searchParams.get("user_ip"), "41.13.0.1");
  assert.equal(seen.init.headers.Authorization, "Basic " + Buffer.from("key:").toString("base64"));
  assert.equal(seen.init.headers.Referer, "https://sa-recruiters.co.za/find-jobs/");
});

test("worker forwards to the relay when configured and needs no API key", async () => {
  const realFetch = globalThis.fetch; let seen;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response('{"type":"JOBS","hits":0,"pages":0,"jobs":[]}', { status: 200 }); };
  try {
    const json = (b, s) => new Response(JSON.stringify(b), { status: s });
    const req = new Request("https://w.example/api/jobs/careerjet?keywords=welder", { headers: { "CF-Connecting-IP": "41.13.0.1", "User-Agent": "UA/1" } });
    const res = await careerjetSearchResponse(req, { CAREERJET_RELAY_URL: "https://relay.example/", CAREERJET_RELAY_SECRET: SECRET }, null, json);
    assert.equal(res.status, 200);
    assert.ok(seen.url.startsWith("https://relay.example/careerjet?"));
    assert.equal(seen.init.headers["X-Visitor-IP"], "41.13.0.1");
    assert.equal(seen.init.headers["X-Relay-Secret"], SECRET);
  } finally { globalThis.fetch = realFetch; }
});

import { careerjetEgressDiagnostic } from "../Cloudflare-worker/careerjet.js";
test("egress diagnostic is closed without the token and reports ips with it", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ip":"203.0.113.9"}', { status: 200 });
  try {
    const json = (b, s) => new Response(JSON.stringify(b), { status: s });
    const env = { CAREERJET_DEBUG_TOKEN: "t".repeat(20) };
    assert.equal((await careerjetEgressDiagnostic(new Request("https://w/x?token=bad"), env, null, json)).status, 404);
    assert.equal((await careerjetEgressDiagnostic(new Request("https://w/x"), {}, null, json)).status, 404);
    const res = await careerjetEgressDiagnostic(new Request("https://w/x?token=" + env.CAREERJET_DEBUG_TOKEN), env, null, json);
    const body = await res.json();
    assert.equal(res.status, 200); assert.deepEqual(body.ipv4, Array(4).fill("203.0.113.9")); assert.equal(body.stableIpv4, true);
  } finally { globalThis.fetch = realFetch; }
});
