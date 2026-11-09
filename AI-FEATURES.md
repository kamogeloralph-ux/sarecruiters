# AI features (Gemini)

All of these run in the Cloudflare Worker. The Gemini key (`GEMINI_API_KEY`) never reaches a browser.

## Rules every feature follows

- **Who can call it.** Admin routes need the admin session. User routes (`/api/ai/*`) need a signed-in user, a Turnstile token in the `cf-turnstile-response` header, and stay under a per-user hourly limit. An admin in the admin panel skips Turnstile.
- **Saved once.** Every result is stored in D1 (`ai_results`, migration `0007_ai_features.sql`). The same vacancy, poster image, or search is not paid for twice. A vacancy summary is regenerated only when the vacancy text changes.
- **Budget.** Every call counts against `AI_DAILY_CAP` (default 1000/day). When it is used up, new calls return 429 and saved answers keep working.
- **Untrusted input.** Posters, CVs, vacancy text and chat posts are wrapped as untrusted data in the prompt, and every answer is normalised and whitelisted in code (`ai.js`) before it is used. The model only suggests. Nothing in the AI code publishes, hides, edits or deletes a vacancy.
- **Review queue.** Suspicious items go to `ai_flags` (shown in Admin → AI Assistant) or, for TipChat, into the existing `community_automated_flags` table. A flag you dismiss is never re-opened.
- **POPIA.** CV feedback and photo checks stay off until `GEMINI_PAID_TIER=1`. CV text and feedback are never stored. Skills read from a CV are stored in D1 under the candidate id, and erased when the account is deleted.

## What was added

| # | Feature | Where |
|---|---|---|
| 1 | Poster reading (title, employer, location, closing date, how to apply) | `POST /api/ai/poster-extract`; also runs on every poster upload, replacing the title-only call |
| 2 | Scam screening | Rules first, Gemini only when unsure. Posters (at upload), new vacancies and recent TipChat posts (daily job), any text (`POST /api/admin/ai/screen`) |
| 3 | isiZulu / Sesotho / Afrikaans / English summaries | `GET` (read saved, no sign-in) and `POST /api/ai/vacancy-summary` |
| 4 | Natural-language search | `POST /api/ai/search` returns existing filters |
| 5 | Cleaner scraped vacancies + near-duplicates | Daily job; stored beside the vacancy, originals untouched |
| 6 | Better matching | `POST /api/admin/ai/match` ranks CV Box candidates; CV scan now also saves skills |
| 7 | CV feedback and interview practice | `POST /api/ai/cv-feedback`, `POST /api/ai/interview` |
| 8 | Your own content | Admin → AI Assistant: daily post draft, reply drafts |
| 9 | Photo "usable" check | `POST /api/admin/ai/photo-check` (yes/no answers only; anything doubtful says `needs_human`) |

## Request / response cheat-sheet (for wiring the public pages)

```
POST /api/ai/search            {query}                       -> {filters:{q,location,remote?,experience?}, fallback_location}
GET  /api/ai/vacancy-summary   ?id=<vacancy>&lang=zu|st|af|en -> {available, summary:{summary,key_points,how_to_apply}}
POST /api/ai/vacancy-summary   {vacancy_id, lang}            -> {summary}            (creates it if missing)
POST /api/ai/poster-extract    image bytes, or {image_url}   -> {poster:{title,company,location,closing_date,apply:{email,phone,link,text},...}}
POST /api/ai/cv-feedback       file bytes (pdf/png/jpg) or {cv_text} -> {feedback:{strengths,fixes,missing_sections}}
POST /api/ai/interview         {vacancy_id}                  -> {questions}
                               {vacancy_id, step:"answer", question, answer} -> {feedback}
```

User routes need `Authorization: Bearer <supabase token>` and `cf-turnstile-response: <token>`.

## Settings

See the `GEMINI_*` and `AI_*` notes in `Cloudflare-worker/wrangler.toml`. The daily job runs after the D1 sync; Admin → AI Assistant → "Tidy & screen vacancies now" runs it on demand.

## Tests

`node --test scripts/ai.test.mjs` (uses Node's built-in SQLite as a stand-in for D1; no network).
