// ============================================================
//  SA RECRUITERS — app-pending-submissions.js
// ============================================================
//  Rescue queue for reports & suggestions that never reached the database.
//
//  Background: both submit forms fall back to a localStorage copy when the
//  Cloudflare Worker AND the direct Supabase insert both fail. For months
//  the `reports` RPC failed for everyone (reports.id had no database
//  default — see supabase/migrations/20260919b_fix_reports_id_default.sql),
//  so every report was trapped locally: My submissions showed it forever as
//  "Pending" while the admin console saw nothing.
//
//  This module retries those trapped items once per app load, after
//  sign-in, directly against the database (no Turnstile needed — the
//  caller is authenticated, and reports/suggestions now carry user_id).
//  Delivered items are removed from the local queue, so "Pending" clears
//  itself and the admin finally sees what was sent.
//
//  Loaded last among the app-*.js files; runs after startAuthenticatedApp
//  gives us a session. Idempotent and silent on failure (retries again on
//  the next load).
// ============================================================

/* global saAuthUser, supabaseClient, readLocalReports, writeLocalReports */

(function () {
  'use strict';

  var RETRY_FLAG = 'sa_pending_retry_v1';
  var MAX_BATCH = 10; // per load, per kind — keeps the boot request small

  function readLocalSuggestions() {
    try { return JSON.parse(localStorage.getItem('sa_suggestions_local') || '[]'); }
    catch (e) { return []; }
  }
  function writeLocalSuggestions(arr) {
    try { localStorage.setItem('sa_suggestions_local', JSON.stringify(arr)); }
    catch (e) {}
  }

  // Strip the client-only bookkeeping fields before inserting.
  function toRow(item) {
    var row = {
      agency_name: item.agency_name || null,
      reason: item.reason || null,
      details: item.details || null,
      status: item.status || 'open',
      user_id: saAuthUser ? saAuthUser.id : null
    };
    if (item.agency_id) row.agency_id = item.agency_id;
    return row;
  }
  function toSuggestionRow(item) {
    return {
      type: item.type || 'suggestion',
      agency_name: item.agency_name || null,
      details: item.details || null,
      status: item.status || 'open',
      user_id: saAuthUser ? saAuthUser.id : null
    };
  }

  // A local entry matches a DB row when kind + content agree. created_at is
  // compared by timestamp value (the local copy stores its own ISO stamp at
  // submit time; the DB row keeps its own) — a 2s tolerance absorbs clock
  // skew so genuinely-different submissions aren't mistaken for duplicates.
  function key(kind, item) {
    return [kind, item.agency_name || '', item.reason || '', item.type || '',
      item.details || ''].join('|').toLowerCase();
  }
  function closeTo(a, b) {
    if (!a || !b) return false;
    var ta = new Date(a).getTime(), tb = new Date(b).getTime();
    if (isNaN(ta) || isNaN(tb)) return false;
    return Math.abs(ta - tb) <= 2000;
  }
  function findMatchingRow(kind, item, rows) {
    var k = key(kind, item);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (key(kind, r) !== k) continue;
      if (closeTo(r.created_at, item.created_at)) return r;
    }
    return null;
  }

  async function retryPending(kind) {
    var isReport = kind === 'report';
    var local = isReport ? readLocalReports() : readLocalSuggestions();
    if (!local.length) return 0;

    // What the user already has in the DB? (select_own RLS scopes this to
    // their rows; anything matching here was already delivered earlier.)
    var existingRows = [];
    try {
      var res = await supabaseClient
        .from(isReport ? 'reports' : 'suggestions')
        .select(isReport
          ? 'id,agency_name,reason,details,created_at'
          : 'id,type,agency_name,details,created_at')
        .eq('user_id', saAuthUser.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (res.error) return 0; // transient — try again next load
      existingRows = res.data || [];
    } catch (e) { return 0; }

    var delivered = 0;
    var remaining = [];
    for (var i = 0; i < local.length; i++) {
      var item = local[i];
      // Anything already reflected in the DB is just cleaned up, not retried.
      if (findMatchingRow(isReport ? 'report' : 'suggestion', item, existingRows)) { delivered++; continue; }
      if (remaining.length < MAX_BATCH) remaining.push(item);
    }

    // Deliver the rest, oldest first (preserves the user's intended order).
    remaining.reverse();
    var stillFailed = [];
    for (var j = 0; j < remaining.length; j++) {
      var it = remaining[j];
      var row = isReport ? toRow(it) : toSuggestionRow(it);
      try {
        var ins = await supabaseClient
          .from(isReport ? 'reports' : 'suggestions')
          .insert([row]);
        if (ins.error) { stillFailed.push(it); continue; }
        delivered++;
      } catch (e) { stillFailed.push(it); }
    }

    // Rewrite the queue with only what still failed (keeps _localId etc.).
    if (isReport) writeLocalReports(stillFailed);
    else writeLocalSuggestions(stillFailed);

    if (delivered > 0) {
      try { localStorage.setItem(RETRY_FLAG, String(Date.now())); } catch (e) {}
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Synced ' + delivered + ' pending submission' + (delivered === 1 ? '' : 's'));
      }
    }
    return delivered;
  }

  // Not self-scheduling: saAuthUser only exists once the Google session has
  // resolved, which happens after DOMContentLoaded. bootAuthenticatedApp()
  // (app-manager-employer.js) calls this right after the auth gate clears.
  window.retryPendingSubmissions = function () {
    if (!saAuthUser || !supabaseClient) return;
    // Small delay so it never competes with the boot data load.
    setTimeout(function () {
      retryPending('report')
        .then(function () { return retryPending('suggestion'); })
        .catch(function (e) { console.warn('pending submissions retry', e); });
    }, 4000);
  };
})();
