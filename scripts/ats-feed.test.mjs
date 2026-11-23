import test from "node:test";
import assert from "node:assert/strict";
import { parseAtsXml, atsDate, atsJobFilterText, atsJobMatchesFilters } from "../Cloudflare-worker/worker.js";

const topJobXml = `<?xml version="1.0"?><rss xmlns:job_listing="https://topjobseeker.com"><channel><item>
  <title>DC Inventory Supervisor &#8211; Longmeadow</title>
  <link>https://topjobseeker.com/job/example?utm_source=rss&amp;x=1</link>
  <guid isPermaLink="false">https://topjobseeker.com/?post_type=job_listing&amp;p=105164</guid>
  <pubDate>Thu, 12 Nov 2026 23:04:00 +0000</pubDate>
  <description><![CDATA[DC Inventory Supervisor Closing Date 09 December 2026]]></description>
  <job_listing:location><![CDATA[Johannesburg, Gauteng, South Africa]]></job_listing:location>
  <job_listing:job_type><![CDATA[Full Time]]></job_listing:job_type>
  <job_listing:company><![CDATA[Dis-Chem Pharmacies Limited]]></job_listing:company>
</item></channel></rss>`;

const govPostsXml = `<rss><channel><item>
  <title>Nursing Assistant Grade 1 to 3</title>
  <link>https://govposts.co.za/job/nursing-assistant-post-42-509?utm_source=rss&amp;utm_medium=feed</link>
  <guid isPermaLink="false">https://govposts.co.za/job/nursing-assistant-post-42-509</guid>
  <description>PROVINCIAL ADMINISTRATION: WESTERN CAPE DEPARTMENT OF HEALTH AND WELLNESS · Nelspoort Hospital, Western Cape · R181 230 per annum · Closes Friday 4 December 2026</description>
  <pubDate>Fri, 20 Nov 2026 11:21:20 GMT</pubDate>
</item></channel></rss>`;

const weWorkRemotelyXml = `<rss><channel><item>
  <title>OKX: Affiliate Manager</title>
  <region>Anywhere in the World</region>
  <country></country>
  <type>Full-Time</type>
  <description>&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; South Africa (Remote)&lt;/p&gt;</description>
  <link>https://weworkremotely.com/remote-jobs/okx-affiliate-manager</link>
  <guid>https://weworkremotely.com/remote-jobs/okx-affiliate-manager</guid>
</item></channel></rss>`;

test("TopJob namespaced RSS fields and numeric entities are parsed", () => {
  const [job] = parseAtsXml(topJobXml);
  assert.equal(job.external_ref, "https://topjobseeker.com/?post_type=job_listing&p=105164");
  assert.equal(job.title, "DC Inventory Supervisor – Longmeadow");
  assert.equal(job.company, "Dis-Chem Pharmacies Limited");
  assert.equal(job.location, "Johannesburg, Gauteng, South Africa");
  assert.equal(job.employment_type, "Full Time");
  assert.equal(job.link, "https://topjobseeker.com/job/example?utm_source=rss&x=1");
  assert.equal(atsDate(job.closing_date), "2026-12-09");
});

test("GovPosts RSS derives company, location, salary and closing date from description", () => {
  const [job] = parseAtsXml(govPostsXml);
  assert.equal(job.external_ref, "https://govposts.co.za/job/nursing-assistant-post-42-509");
  assert.equal(job.company, "PROVINCIAL ADMINISTRATION: WESTERN CAPE DEPARTMENT OF HEALTH AND WELLNESS");
  assert.equal(job.location, "Nelspoort Hospital, Western Cape");
  assert.equal(job.salary, "R181 230 per annum");
  assert.equal(atsDate(job.closing_date), "2026-12-04");
});

test("We Work Remotely RSS exposes region text for South Africa filtering and company fallback", () => {
  const [job] = parseAtsXml(weWorkRemotelyXml);
  assert.equal(job.external_ref, "https://weworkremotely.com/remote-jobs/okx-affiliate-manager");
  assert.equal(job.company, "OKX");
  assert.equal(job.employment_type, "Full-Time");
  assert.match(job.region, /South Africa/);
  assert.equal(job.location, "Anywhere in the World");
});

test("ATS filters search title, location and company as well as description fields", () => {
  const job = { title: "South Africa Customer Support", location: "Remote", company: "Example Co", description: "Worldwide role" };
  assert.match(atsJobFilterText(job), /south africa/);
  assert.equal(atsJobMatchesFilters(job, ["south africa"], []), true);
  assert.equal(atsJobMatchesFilters({ ...job, title: "Customer Support", location: "Cape Town" }, ["south africa"], []), false);
  assert.equal(atsJobMatchesFilters({ ...job, company: "South Africa Jobs Ltd" }, ["south africa"], ["jobs ltd"]), false);
});

test("malformed or empty XML does not create phantom jobs", () => {
  assert.deepEqual(parseAtsXml("<rss><channel><item><description>missing title</description></item></channel></rss>"), []);
  assert.deepEqual(parseAtsXml(""), []);
});
