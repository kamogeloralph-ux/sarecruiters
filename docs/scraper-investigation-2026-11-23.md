# Jooble and retail scraper investigation — 2026-11-23

## Evidence

- Refresh run `45070520185` at commit `d83b246` made six Jooble requests on each of two attempts. All requests completed without HTTP, auth, timeout, or rate-limit errors, but every response produced `parsed 0, upserted 0`. The script then intentionally failed with `run returned no vacancies; refusing to mark the source healthy`.
- `scripts/sync-jooble.mjs` sends every request to `https://jooble.org/api/{key}` and uses `location: South Africa`. It then requires a location string to match a South African place/province list and rejects old rows. It has no response-shape or location-count diagnostics.
- Jooble's official documentation says each country/domain requires its own API key. It also documents the response as `{ totalCount, jobs }` and says 429 means the daily request limit was exceeded.
- The current implementation's fixed `jooble.org` host is therefore a configuration risk: a key created for the wrong regional domain can return successful HTTP responses without supplying the intended South African inventory. The logs alone cannot prove whether the current secret is a US/global key or whether the responses contain locations rejected by the local filter; the secret value is not exposed.
- Pick n Pay failed twice with `HTTP 429`; Boxer returned 1 job and Cashbuild returned 100 jobs across five pages on both attempts. Oracle retail sources (Mr Price and TFG) succeeded separately.
- A controlled, single request from the sandbox to the same Pick n Pay Workday CXS endpoint with the scraper's headers/body returned HTTP 200 and `{ total: 58, jobPostings: 20 }`. This shows the endpoint is currently live and the recorded 429 is not a permanent endpoint removal. It is consistent with intermittent runner/IP or tenant-load throttling.
- Workday's official guidance says tenant overload can produce HTTP 429 and recommends exponential backoff and caching. The current scraper retries every non-OK response after only 1.5 seconds, then the workflow reruns the complete retail group after 10 seconds. That retry pattern is not Workday's recommended backoff.

## Diagnosis

1. Jooble: application networking and authentication failure are not evidenced. The strongest configuration hypothesis is a regional-key/endpoint mismatch, with the South African location filter as the second hypothesis. This must be confirmed by a diagnostic run that reports only `totalCount`, job count, and a redacted location histogram.
2. Pick n Pay: upstream throttling, not parser failure or infrastructure outage. The public endpoint works from another origin, while GitHub Actions received 429 twice.
3. Retail group: the partial-success behavior is intentional. The script preserves Boxer/Cashbuild results but exits non-zero when PnP fails, so monitoring correctly exposes degradation; it should not silently mark the group healthy.

## Safe fixes to implement next

- Make the Jooble regional API host explicit via a non-secret configuration variable, defaulting to the current behavior for backwards compatibility, and set it to the domain matching the key (for South African inventory, obtain/use the South African Jooble key according to Jooble's instructions). Add safe diagnostics for response counts and rejected-location counts without logging payloads or the API key.
- Change Workday/retail retries to honor `Retry-After` when present and use capped exponential backoff with jitter for 429/5xx responses. Keep source isolation and non-zero partial-failure reporting.
- Do not delete or overwrite existing rows when a source fails; the workflow already preserves failed-source rows.

## Sources

- https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation
- https://help.jooble.org/en/support/solutions/articles/60000922689-how-to-connect-to-the-jooble-rest-api
- https://doc.workday.com/admin-guide/en-us/manage-workday/tenant-configuration/it-administrator-resources/limitations-and-availability/dan1370797408285.html
- https://www.pnp.co.za/careers
- https://picknpay.wd3.myworkdayjobs.com/PNP_Careers
