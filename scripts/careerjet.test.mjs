import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSearchParams, refererFor, buildCareerjetUrl, plainText,
  mapCareerjetResponse, normaliseApiKey, careerjetSearchResponse
} from "../Cloudflare-worker/careerjet.js";

const sp = (q) => new URLSearchParams(q);

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

test("API keys are normalized before Basic authentication", () => {
  assert.equal(normaliseApiKey("  secret-key\n\t"), "secret-key");
  assert.equal(normaliseApiKey(""), "");
});

test("control characters and long input are cleaned", () => {
  const { query } = parseSearchParams(sp("keywords=" + encodeURIComponent("pyth\u0000on\n dev") + "&location=" + "x".repeat(500)));
  assert.equal(query.keywords, "pyth on dev");
  assert.equal(query.location.length, 80);
});

test("referer only accepts our own https pages", () => {
  const site = "https://sa-recruiters.co.za";
  assert.equal(refererFor("https://sa-recruiters.co.za/find-jobs/?s=x", site), "https://sa-recruiters.co.za/find-jobs/?s=x");
  assert.equal(refererFor("https://www.sa-recruiters.co.za/find-jobs/", site), "https://www.sa-recruiters.co.za/find-jobs/");
  assert.equal(refererFor("https://evil.example/find-jobs/", site), "https://sa-recruiters.co.za/find-jobs/");
  assert.equal(refererFor("http://sa-recruiters.co.za/", site), "https://sa-recruiters.co.za/find-jobs/");
  assert.equal(refererFor("not a url", site), "https://sa-recruiters.co.za/find-jobs/");
  assert.equal(refererFor("", site), "https://sa-recruiters.co.za/find-jobs/");
});

test("upstream URL is properly encoded and carries the visitor details", () => {
  const url = new URL(buildCareerjetUrl(
    { keywords: "python developer", location: "Johannesburg", page: 2, pageSize: 10, sort: "date" },
    { ip: "102.165.0.1", userAgent: "Mozilla/5.0 (X11)" }
  ));
  assert.equal(url.origin + url.pathname, "https://search.api.careerjet.net/v4/query");
  assert.equal(url.searchParams.get("locale_code"), "en_ZA");
  assert.equal(url.searchParams.get("keywords"), "python developer");
  assert.equal(url.searchParams.get("user_ip"), "102.165.0.1");
  assert.equal(url.searchParams.get("user_agent"), "Mozilla/5.0 (X11)");
});

test("descriptions are reduced to plain text", () => {
  assert.equal(plainText("<b>Python</b> dev &amp; more&nbsp;<script>x</script>"), "Python dev & more x");
});

test("jobs reply is mapped and unsafe links dropped", () => {
  const out = mapCareerjetResponse({
    type: "JOBS", hits: 42, pages: 5,
    jobs: [
      { title: "<b>Dev</b>", company: "Acme", locations: "Durban", url: "https://www.careerjet.co.za/jobad/abc", description: "<p>Hi</p>" },
      { title: "Bad", url: "javascript:alert(1)" }
    ]
  }, 1);
  assert.equal(out.type, "jobs");
  assert.equal(out.total, 42);
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0].title, "Dev");
  assert.equal(out.jobs[0].description, "Hi");
});

test("ambiguous location reply and errors", () => {
  assert.deepEqual(
    mapCareerjetResponse({ type: "LOCATIONS", locations: ["Durban, KZN", { name: "Durban, Free State" }] }, 1),
    { type: "locations", locations: ["Durban, KZN", "Durban, Free State"] }
  );
  assert.throws(() => mapCareerjetResponse({ type: "ERROR", error: "bad key" }, 1), /bad key/);
  assert.throws(() => mapCareerjetResponse(null, 1));
});

test("route: no key, no search and no IP are refused before calling Careerjet", async () => {
  const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: {} });
  const req = (qs, headers) => new Request("https://w.example/api/jobs/careerjet?" + qs, { headers });
  assert.equal((await careerjetSearchResponse(req("keywords=a"), {}, null, json)).status, 503);
  assert.equal((await careerjetSearchResponse(req(""), { CAREERJET_API_KEY: "k" }, null, json)).status, 400);
  assert.equal((await careerjetSearchResponse(req("keywords=a"), { CAREERJET_API_KEY: "k" }, null, json)).status, 400);
});

test("route: sends Basic auth + referer and returns mapped jobs", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ type: "JOBS", hits: 1, pages: 1, jobs: [{ title: "Welder", url: "https://x.example/j" }] }), { status: 200 });
  };
  try {
    const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: {} });
    const req = new Request("https://w.example/api/jobs/careerjet?keywords=welder&location=Durban&page_url=" +
      encodeURIComponent("https://sa-recruiters.co.za/find-jobs/?s=welder"), {
      headers: { "CF-Connecting-IP": "102.165.0.9", "User-Agent": "TestUA/1.0" }
    });
    const res = await careerjetSearchResponse(req, { CAREERJET_API_KEY: "\n secret \t", SITE_URL: "https://sa-recruiters.co.za" }, null, json);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(body.jobs[0].title, "Welder");
    assert.equal(seen.init.headers.Authorization, "Basic " + btoa("secret:"));
    assert.equal(seen.init.headers.Referer, "https://sa-recruiters.co.za/find-jobs/?s=welder");
    assert.equal(new URL(seen.url).searchParams.get("user_ip"), "102.165.0.9");
    assert.equal(new URL(seen.url).searchParams.get("user_agent"), "TestUA/1.0");
    assert.ok(!JSON.stringify(body).includes("secret"));
  } finally {
    globalThis.fetch = realFetch;
  }
});
