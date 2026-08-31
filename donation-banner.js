/*!
 * SA Recruiters — Donation footer
 * -----------------------------------------------------------------
 * Appends a small "Support SA Recruiters" strip to the bottom of
 * every .vacancy-card and .hub-card (agency card) on the page.
 *
 * Self-attaching by design: app.js/content.js build these cards
 * dynamically (including on search/filter re-renders), so instead of
 * editing that render logic directly, this watches the DOM and
 * appends the footer to any matching card as soon as it appears —
 * on first load, after a search, after switching screens, etc.
 *
 * No configuration needed. Just include this script anywhere after
 * the app shell exists (e.g. next to sponsor-widget.js).
 */
(function (window, document) {
  "use strict";

  var FOOTER_CLASS = "donate-footer";
  var CARD_SELECTOR = ".vacancy-card, .hub-card";

  var BANK_NAME = "Capitec";
  var ACCOUNT_NUMBER = "2573389037";
  var ACCOUNT_HOLDER = "SA Recruiters";
  var EMAIL = "sarecruiters.directory@gmail.com";
  var WHATSAPP_NUMBER = "27715531005"; // international format, no + or spaces, for wa.me
  var WHATSAPP_DISPLAY = "+27 71 553 1005";

  function injectStyles() {
    if (document.getElementById("donate-footer-styles")) return;
    var style = document.createElement("style");
    style.id = "donate-footer-styles";
    style.textContent = [
      ".donate-footer{margin-top:12px;padding-top:10px;border-top:1px solid var(--border);}",
      ".donate-footer-label{display:block;font-size:10.5px;font-weight:700;",
      "letter-spacing:.02em;text-transform:uppercase;color:var(--accent);margin-bottom:3px;}",
      ".donate-footer-row{display:block;font-size:11.5px;line-height:1.5;color:var(--text-2);}",
      ".donate-footer-row strong{color:var(--text);font-weight:700;letter-spacing:.02em;}",
      ".donate-footer a{color:var(--accent);font-weight:600;text-decoration:none;}",
      ".donate-footer a:active{opacity:.7;}"
    ].join("");
    document.head.appendChild(style);
  }

  function buildFooter() {
    var footer = document.createElement("div");
    footer.className = FOOTER_CLASS;

    var label = document.createElement("span");
    label.className = "donate-footer-label";
    label.textContent = "Support SA Recruiters";
    footer.appendChild(label);

    var acctRow = document.createElement("span");
    acctRow.className = "donate-footer-row";
    var bankPrefix = BANK_NAME ? BANK_NAME + " — " : "";
    acctRow.innerHTML = "Donate — " + bankPrefix + "Acc <strong>" + ACCOUNT_NUMBER + "</strong> (" + ACCOUNT_HOLDER + ")";
    footer.appendChild(acctRow);

    var linksRow = document.createElement("span");
    linksRow.className = "donate-footer-row";

    var emailLink = document.createElement("a");
    emailLink.href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("SA Recruiters — donation / partnership");
    emailLink.textContent = "Email";
    linksRow.appendChild(emailLink);

    linksRow.appendChild(document.createTextNode(" \u00B7 "));

    var waLink = document.createElement("a");
    waLink.href = "https://wa.me/" + WHATSAPP_NUMBER;
    waLink.target = "_blank";
    waLink.rel = "noopener";
    waLink.textContent = "WhatsApp (" + WHATSAPP_DISPLAY + ")";
    linksRow.appendChild(waLink);

    footer.appendChild(linksRow);

    // Cards typically have their own onclick/ripple handler to open a
    // detail view — stop the footer's own taps (and its links) from
    // also triggering that, so "Email"/"WhatsApp" behave like normal
    // links instead of also navigating the card.
    footer.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    return footer;
  }

  function attachFooter(card) {
    if (!card || card.querySelector(":scope > ." + FOOTER_CLASS)) return;
    card.appendChild(buildFooter());
  }

  function scanAndAttach(root) {
    if (!root) return;
    if (root.matches && root.matches(CARD_SELECTOR)) attachFooter(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(CARD_SELECTOR).forEach(attachFooter);
    }
  }

  function start() {
    injectStyles();
    scanAndAttach(document.body);

    // Cards are rendered/re-rendered dynamically (search, filters,
    // screen switches). Watch the whole app for new cards rather than
    // hooking into app.js's render functions directly.
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 1) scanAndAttach(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window, document);
