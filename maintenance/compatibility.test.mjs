import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

async function readProjectFile(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}

describe("imported SA Recruiters PWA compatibility", () => {
  it("keeps the existing entrypoint and core runtime assets", async () => {
    const html = await readProjectFile("client/index.html");
    expect(html).toContain('<script src="app.js" defer></script>');
    expect(html).toContain('<link rel="manifest" href="manifest.json">');
    expect(html).toContain('id="connection-status"');
    expect(html).toContain('id="retry-banner"');
  });

  it("guards optional sponsor initialization", async () => {
    const html = await readProjectFile("client/index.html");
    expect(html).not.toContain('<script src="sponsor-widget.js" defer></script>');
    expect(html).toContain("window.SponsorWidget");
  });

  it("guards Supabase startup and preserves the existing local cache", async () => {
    const app = await readProjectFile("client/public/app.js");
    expect(app).toContain("window.supabase && typeof window.supabase.createClient === 'function'");
    expect(app).toContain("using local read-only fallback");
    expect(app).toContain("var DATA_CACHE_KEY = 'sa_data_cache_v1';");
    expect(app).toContain("lastDataRefreshAt");
    expect(app).toContain("setConnectionStatus");
  });

  it("keeps the two authoritative vacancy save handlers present", async () => {
    const app = await readProjectFile("client/public/app.js");
    expect(app).toContain("async function saveVacancy()");
    expect(app).toContain("async function saveGeneralVacancy()");
    expect(app).toContain("await upsertVacancy(data)");
  });

  it("keeps contextual empty-state copy for vacancy views", async () => {
    const app = await readProjectFile("client/public/app.js");
    expect(app).toContain("No agencies match that search");
    expect(app).toContain("function vacancyScreenStateMarkup(screen, hasRows, hasQuery)");
    expect(app).toContain("Use the star on a vacancy card to keep it here for later.");
    expect(app).toContain("Try a different search or adjust your filters.");
    expect(app).toContain("New employer listings will appear here after they are saved.");
  });

  it("keeps vacancy links actionable and prevents repeated submissions", async () => {
    const app = await readProjectFile("client/public/app.js");
    expect(app).toContain("function normalizeVacancyLink(value)");
    expect(app).toContain("'https://' + link");
    expect(app).toContain("function setVacancySaveBusy(busy)");
    expect(app).toContain('aria-busy');
  });

  it("keeps the connection status above search and away from bottom navigation", async () => {
    const html = await readProjectFile("client/index.html");
    const statusIndex = html.indexOf('class="connection-status"');
    const searchIndex = html.indexOf('<div class="search search-mini">');
    expect(statusIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeLessThan(searchIndex);
    expect(html.indexOf('<nav class="bottom-nav">')).toBeGreaterThan(statusIndex);

    const css = await readProjectFile("client/public/styles.css");
    const statusRule = css.match(/\.connection-status\{[^}]+\}/)?.[0] || "";
    expect(statusRule).toContain("position:relative");
    expect(statusRule).not.toContain("position:fixed");
  });

  it("keeps deterministic status and employer-vacancy state contracts", async () => {
    const app = await readProjectFile("client/public/app.js");
    expect(app).toContain("function connectionStatusLabel(state, timestamp, isOnline)");
    expect(app).toContain("Offline · saved listings only");
    expect(app).toContain('data-vacancy-state="');
    expect(app).toContain("list.length ? 'ready' : 'empty'");
    expect(app).toContain('class="screen-state"');

    const stateSource = app.match(/function vacancyScreenStateMarkup\(screen, hasRows, hasQuery\) \{[\s\S]*?\n\}/)?.[0];
    expect(stateSource).toBeTruthy();
    const vacancyScreenStateMarkup = new Function(`${stateSource}; return vacancyScreenStateMarkup;`)();
    for (const screen of ["all", "saved", "search", "employer", "manager"]) {
      const markup = vacancyScreenStateMarkup(screen, false, screen === "search");
      expect(markup).toContain(`data-screen="${screen}"`);
      expect(markup).toContain('data-vacancy-state="empty"');
    }
    expect(vacancyScreenStateMarkup("all", true, false)).toBe("");

    const fnSource = app.match(/function connectionStatusLabel\(state, timestamp, isOnline\) \{[\s\S]*?\n\}/)?.[0];
    expect(fnSource).toBeTruthy();
    const connectionStatusLabel = new Function("formatDataAge", `${fnSource}; return connectionStatusLabel;`)(() => "2 hr ago");
    expect(connectionStatusLabel("offline", null, false)).toBe("Offline · saved listings only");
    expect(connectionStatusLabel("cached", 1, true)).toContain("Saved listings · last checked 2 hr ago");
    expect(connectionStatusLabel("error", null, true)).toBe("Could not refresh the latest listings");
    expect(connectionStatusLabel("live", 1, true)).toContain("Live listings · updated 2 hr ago");
  });
});
