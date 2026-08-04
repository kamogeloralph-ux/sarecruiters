# SA Recruiters — Branches Edit Button & Trades/Industries Save Fix

## What was wrong

### Issue 1 — Branches had no Edit button
Branches could be added and deleted, but there was **no way to edit** an existing branch:

- In the admin agency Hub card, the "Branches" tab showed each branch row with only a **delete (✕)** button.
- In the "All Branches" list, branch rows had **no admin actions at all**.
- The branch sheet (`openBranchSheet`) only ever created a **new** branch — `saveBranch()` always generated a fresh `id`, so even if you opened the sheet there was no edit path.

### Issue 2 — Trades/Industries didn't save when entered manually
The agency form has a "Trades / Industries (comma separated)" field. `saveAgency()` correctly read the typed value into the save payload, but `upsertAgency()` ran `delete safe.trades;` **before sending to Supabase** — it stripped the `trades` field every time as a "safety measure" pending the `trades` column being added to the table. So no matter what you typed, trades never reached the database and never persisted.

---

## What I changed

### Fix for Issue 1 — Full branch editing

**`index.html`**

1. **`openBranchSheet(agencyId, branchId)`** — now accepts an optional `branchId`.
   - When a `branchId` is passed, it looks up the existing branch (in the cache, or the localStorage fallback) and **pre-fills** the Branch name, Address/location, Phone and Email fields.
   - The sheet title dynamically switches to **"Edit branch"** (vs "Add branch" when adding).
   - A new `pendingBranchId` variable records which branch is being edited (or `null` when adding).

2. **`saveBranch()`** — now reuses the existing branch `id` when `pendingBranchId` is set (an **update**) instead of always generating a new id (an **add**). The toast correctly says "Branch updated" vs "Branch added". After saving, it reloads data and re-opens the relevant agency card / Manager view.

3. **Admin Hub card "Branches" tab (`hubBranches`)** — each branch row now shows an **Edit (pencil)** button next to the existing Delete button (admin only). Both are wrapped in a tidy `.hub-row-actions` container.

4. **"All Branches" list (`renderAllBranchesList`)** — each branch row now shows admin **Edit** and **Delete** action buttons (only visible when logged in as admin). Delete uses a new `deleteBranchAllList(id)` helper that looks up the name for the confirm dialog (safe for names containing apostrophes/quotes).

5. **`managerAddBranch()`** — refactored to call `openBranchSheet(agencyId, null)` so Manager Mode's "Add branch" stays consistent with the edit-aware sheet. Manager Mode itself is intentionally still **add-only** for non-admin agencies (the existing "Saved — contact admin to edit" design is preserved).

6. **CSS** added: `.hub-row-actions`, `.hub-row-edit`, `.hub-row-del` (shared), and `.br-actions`, `.br-edit`, `.br-del` for the All Branches list action buttons.

### Fix for Issue 2 — Trades now save to Supabase

**`index.html` — `upsertAgency(a)`**
- Removed the unconditional `delete safe.trades;`. The agency record is now upserted **with** the `trades` field included, so manually entered trades persist.
- **Resilient fallback:** if the upsert fails *specifically* because the `trades` column is missing (the error message/hint mentions "trades"), the app automatically retries the save **without** trades so the rest of the agency record still saves, and logs a console warning. This means the fix won't break anything if you haven't yet run the SQL to add the column — but trades will only persist permanently once the column exists.

**`ADD_TRADES_COLUMN.sql`** — updated the header comment to reflect the new behaviour (the app now sends trades; run this once so the column exists and trades persist).

---

## One action YOU need to take (for trades to persist permanently)

The `trades` column must exist on your `agencies` table in Supabase. If it doesn't, the app will still save the rest of the agency (resilient fallback) but trades won't stick.

**Run this once in your Supabase Dashboard → SQL Editor → New query** (it's also in `ADD_TRADES_COLUMN.sql`):

```sql
alter table public.agencies add column if not exists trades text default '';
```

After running it, every trades/industries value you enter will save and persist for all users. You can verify the column exists with:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'agencies' and column_name = 'trades';
```

---

## Verification performed

- ✅ `node --check` passes on the inline app script and `sw.js` (no syntax errors).
- ✅ In a live browser test (connected to your real Supabase data): the "All Branches" list shows **Edit** and **Delete** buttons on every branch row.
- ✅ Clicking **Edit** opens the branch sheet titled **"Edit branch"** with the Branch name, Address/location, Phone and Email **pre-filled**, and `pendingBranchId` set to the existing branch's id (so Save updates rather than duplicates).
- ✅ The admin agency Hub card "Branches" tab now generates the edit-button markup (`hub-row-edit` present alongside `hub-row-del`).
- ✅ `upsertAgency` confirmed to no longer strip `trades` (sends the full payload) and to keep the missing-column fallback.

## Files changed

| File | Change |
|------|--------|
| `index.html` | Branch editing end-to-end (edit-aware sheet, edit buttons in Hub card + All Branches list, `deleteBranchAllList` helper, CSS); `upsertAgency` now saves trades with resilient fallback |
| `sw.js` | Cache version bumped v46 → v47 so returning visitors get the fix automatically |
| `ADD_TRADES_COLUMN.sql` | Updated instructions to match the new trades-saving behaviour |

## Deploying

Upload the updated `index.html` and `sw.js` to your web server (replace the old ones). Because the service worker cache version was bumped to **v47**, returning visitors automatically pick up the new files on their next visit — no manual cache-clear needed. Then run the one-line SQL above in Supabase so trades persist permanently.
