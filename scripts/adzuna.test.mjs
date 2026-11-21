import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSearchParams, buildAdzunaUrl, plainText, formatSalary,
  mapJob, mapAdzunaResponse, normaliseCredential, adzunaSearchResponse
} from "../Cloudflare-worker/adzuna.js";

const sp = (q) => new URLSearchParams(q);
const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json" } });

test("search needs keywords or a location", () => {
  assert.ok(parseSearchParams(sp("")).error);
  assert.equal(parseSearchParams(sp("keywords=welder")).query.keywords, "welder");
  assert.equal(parseSearchParams(sp("location=Durban")).query.location, "Durban");
});

test("page, page size and sort are clamped", () => {
  const { query } = parseSearchParams(sp("keywords=a&page=9999&page_size=500&sort=evil"));
  assert.equal(query.page, 10);
  assert.equal(query.pageSize, 20);
  assert.equal(query.sort, "relevance");
  assert.equal(parseSearchParams(sp("keywords=a&page=-3")).query.page, 1);
});

test("credentials are normalised", () => {
  assert.equal(normaliseCredential("  abc123\n"), "abc123");
  assert.equal(normaliseCredential(undefined), "");
});

test("upstream URL targets /jobs/za with app_id/app_key and the search terms", () => {
  const { query } = parseSearchParams(sp("keywords=python dev&location=Durban&sort=date&page=2&page_size=10"));
  const url = new URL(buildAdzunaUrl(query, { appId: "id1", appKey: "key1" }));
  assert.equal(url.origin + url.pathname, "https://api.adzuna.com/v1/api/jobs/za/search/2");
  assert.equal(url.searchParams.get("app_id"), "id1");
  assert.equal(url.searchParams.get("app_key"), "key1");
  assert.equal(url.searchParams.get("what"), "python dev");
  assert.equal(url.searchParams.get("where"), "Durban");
  assert.equal(url.searchParams.get("sort_by"), "date");
  assert.equal(url.searchParams.get("results_per_page"), "10");
  const rel = new URL(buildAdzunaUrl(parseSearchParams(sp("keywords=a")).query, { appId: "i", appKey: "k" }));
  assert.equal(rel.searchParams.get("sort_by"), null);
  assert.equal(rel.searchParams.get("where"), null);
});

test("country override is sanitised", () => {
  const { query } = parseSearchParams(sp("keywords=a"));
  assert.ok(buildAdzunaUrl(query, { appId: "i", appKey: "k", country: "../zz" }).includes("/jobs/zz/search/"));
});

test("highlight tags and entities are stripped", () => {
  assert.equal(plainText("<strong>Python</strong> dev &amp; ops&nbsp;role"), "Python dev & ops role");
});

test("salary formatting matches the sync script", () => {
  assert.equal(formatSalary(0, 0), "");
  assert.equal(formatSalary(20000, 30000, "0"), "R20,000 - R30,000");
  assert.equal(formatSalary(20000, 20000, "1"), "R20,000 (estimated)");
  assert.equal(formatSalary(null, 45000), "R45,000");
});

test("job mapping needs a title and a valid link", () => {
  assert.equal(mapJob({ title: "Dev", redirect_url: "javascript:alert(1)" }), null);
  assert.equal(mapJob({ title: "", redirect_url: "https://x.example/1" }), null);
  const job = mapJob({
    title: "<strong>Dev</strong>", company: { display_name: "Acme" }, location: { display_name: "Durban, KwaZulu-Natal" },
    salary_min: 30000, salary_max: 40000, salary_is_predicted: "0", created: "2026-11-20T08:00:00Z",
    description: "<p>Build things</p>", redirect_url: "https://www.adzuna.co.za/land/ad/1"
  });
  assert.deepEqual(job, {
    title: "Dev", company: "Acme", location: "Durban, KwaZulu-Natal", salary: "R30,000 - R40,000",
    date: "2026-11-20T08:00:00Z", description: "Build things", source: "Adzuna", url: "https://www.adzuna.co.za/land/ad/1"
  });
});

test("response mapping computes pages from count and caps at 10", () => {
  const out = mapAdzunaResponse({ count: 95, results: [{ title: "A", redirect_url: "https://a.example/1" }] }, 1, 10);
  assert.equal(out.type, "jobs");
  assert.equal(out.total, 95);
  assert.equal(out.pages, 10);
  assert.equal(mapAdzunaResponse({ count: 25, results: [] }, 1, 10).pages, 3);
  assert.throws(() => mapAdzunaResponse(null, 1, 10));
  assert.throws(() => mapAdzunaResponse({ exception: "x" }, 1, 10));
});

test("route: missing secrets and empty search are refused before calling Adzuna", async () => {
  const req = (qs) => new Request("https://w.example/api/jobs/adzuna?" + qs);
  assert.equal((await adzunaSearchResponse(req("keywords=a"), {}, null, json)).status, 503);
  assert.equal((await adzunaSearchResponse(req("keywords=a"), { ADZUNA_APP_ID: "i" }, null, json)).status, 503);
  assert.equal((await adzunaSearchResponse(req(""), { ADZUNA_APP_ID: "i", ADZUNA_APP_KEY: "k" }, null, json)).status, 400);
});

test("route: success, upstream auth failure, rate limit and bad shape", async () => {
  const realFetch = globalThis.fetch;
  const env = { ADZUNA_APP_ID: "id\n", ADZUNA_APP_KEY: "key" };
  const req = new Request("https://w.example/api/jobs/adzuna?keywords=welder");
  try {
    let seen;
    globalThis.fetch = async (url) => { seen = String(url); return new Response(JSON.stringify({ count: 1, results: [{ title: "Welder", redirect_url: "https://a.example/1" }] }), { status: 200 }); };
    const res = await adzunaSearchResponse(req, env, null, json);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.jobs[0].title, "Welder");
    assert.equal(new URL(seen).searchParams.get("app_id"), "id");
    assert.ok(!JSON.stringify(body).includes("key"));

    globalThis.fetch = async () => new Response("{}", { status: 401 });
    assert.equal((await adzunaSearchResponse(new Request("https://w.example/x?keywords=u1"), env, null, json)).status, 502);
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    assert.equal((await adzunaSearchResponse(new Request("https://w.example/x?keywords=u2"), env, null, json)).status, 503);
    globalThis.fetch = async () => new Response(JSON.stringify({ nope: true }), { status: 200 });
    assert.equal((await adzunaSearchResponse(new Request("https://w.example/x?keywords=u3"), env, null, json)).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});
