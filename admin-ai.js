/* SA Recruiters admin — AI Assistant panel (Gemini via the Worker).
   Every call goes to the Worker with the admin's Supabase token; the Gemini key never reaches this page.
   Text from posters, vacancies and visitors is untrusted, so everything is drawn with textContent only. */
(function () {
  var LEVEL_COLOR = { high: '#b91c1c', medium: '#b45309', low: '#4b5563', none: '#4b5563' };

  function el(tag, text, style) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (style) node.style.cssText = style;
    return node;
  }
  function button(label, onClick) {
    var b = el('button', label); b.className = 'minibtn'; b.type = 'button'; b.addEventListener('click', onClick); return b;
  }
  function card(title, hint) {
    var box = el('div', null, 'border:1px solid rgba(127,127,127,.25);border-radius:12px;padding:12px 14px;margin:0 0 14px');
    box.appendChild(el('div', title, 'font-weight:700;margin-bottom:4px'));
    if (hint) box.appendChild(el('div', hint, 'font-size:12.5px;opacity:.75;margin-bottom:8px'));
    return box;
  }
  function out() { return el('div', null, 'margin-top:8px;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere'); }

  async function api(path, options) {
    var headers = Object.assign({}, await r2AuthHeader(), (options && options.headers) || {});
    if (!headers.Authorization) throw new Error('You need to be signed in as admin.');
    var res = await fetch(R2_WORKER_URL + path, Object.assign({}, options, { headers: headers }));
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  function show(target, text, isError) { target.textContent = text; target.style.color = isError ? '#b91c1c' : ''; }

  function copyButton(text) {
    return button('Copy', function (e) { navigator.clipboard && navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; });
  }

  function statusCard() {
    var box = card('Status');
    var o = out(); box.appendChild(o);
    function load() {
      show(o, 'Loading…');
      api('/api/admin/ai/status').then(function (s) {
        var saved = Object.keys(s.saved_results || {}).map(function (k) { return k + ': ' + s.saved_results[k]; }).join(', ') || 'nothing saved yet';
        show(o, 'AI calls today: ' + s.calls_today + ' of ' + s.daily_cap + '\nOpen items to review: ' + s.open_flags + '\nSaved results — ' + saved +
          '\nPaid Gemini plan declared: ' + (s.paid_tier ? 'yes' : 'no (CV feedback and photo checks stay off)'));
      }).catch(function (e) { show(o, e.message, true); });
    }
    var row = el('div', null, 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px');
    row.appendChild(button('Refresh', load));
    row.appendChild(button('Tidy & screen vacancies now', function () {
      show(o, 'Running — this can take a minute…');
      api('/api/admin/ai/run', { method: 'POST' }).then(function (r) { show(o, 'Done: ' + JSON.stringify(r.summary)); }).catch(function (e) { show(o, e.message, true); });
    }));
    box.appendChild(row); load();
    return box;
  }

  function flagsCard() {
    var box = card('Review queue', 'Things the AI or the rules found suspicious. Nothing is hidden or deleted automatically — you decide.');
    var list = el('div'); box.appendChild(list);
    function load() {
      list.textContent = 'Loading…';
      api('/api/admin/ai/flags?status=open').then(function (res) {
        list.textContent = '';
        if (!res.flags.length) { list.appendChild(el('div', 'Nothing to review. 🎉', 'opacity:.75')); return; }
        res.flags.forEach(function (f) {
          var item = el('div', null, 'border-top:1px solid rgba(127,127,127,.2);padding:8px 0');
          item.appendChild(el('div', f.subject_type.toUpperCase() + ' · ' + f.level + ' (' + f.risk_score + ') · ' + (f.title || f.subject_id), 'font-weight:600;color:' + (LEVEL_COLOR[f.level] || '')));
          item.appendChild(el('div', f.reasons.join(' • '), 'font-size:12.5px'));
          if (f.link) item.appendChild(el('div', f.link, 'font-size:12px;opacity:.7;overflow-wrap:anywhere'));
          var actions = el('div', null, 'display:flex;gap:8px;margin-top:6px');
          [['Looks fine — dismiss', 'dismissed'], ['Confirmed problem', 'confirmed']].forEach(function (pair) {
            actions.appendChild(button(pair[0], function () {
              api('/api/admin/ai/flags/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id, decision: pair[1] }) })
                .then(load).catch(function (e) { alert(e.message); });
            }));
          });
          item.appendChild(actions); list.appendChild(item);
        });
      }).catch(function (e) { list.textContent = e.message; });
    }
    box.appendChild(button('Refresh', load)); load();
    return box;
  }

  function posterCard() {
    var box = card('Read a poster', 'Choose a poster image: the AI reads the title, employer, location, closing date and how to apply so you can check and copy them.');
    var input = el('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    var o = out();
    input.addEventListener('change', function () {
      var file = input.files && input.files[0]; if (!file) return;
      show(o, 'Reading…');
      api('/api/ai/poster-extract', { method: 'POST', headers: { 'Content-Type': file.type }, body: file }).then(function (r) {
        var p = r.poster, a = p.apply || {};
        var lines = ['Title: ' + p.title, 'Company: ' + (p.company || '—'), 'Location: ' + (p.location || '—') + (p.province ? ' (' + p.province + ')' : ''),
          'Closing date: ' + (p.closing_date || '—') + (p.closing_date_past ? ' (already passed)' : ''), 'Type: ' + (p.employment_type || '—'), 'Salary: ' + (p.salary || '—'),
          'Apply email: ' + (a.email || '—'), 'Apply phone: ' + (a.phone || '—'), 'Apply link: ' + (a.link || '—'), 'How to apply: ' + (a.text || '—')];
        if (p.requirements.length) lines.push('Requirements: ' + p.requirements.join('; '));
        if (p.review_reasons.length) lines.push('\nCheck before publishing: ' + p.review_reasons.join('; '));
        if (p.scam_signals.length) lines.push('Warning signs: ' + p.scam_signals.join(', ') + (p.scam_note ? ' — ' + p.scam_note : ''));
        show(o, lines.join('\n') + (r.cached ? '\n(saved result)' : ''));
      }).catch(function (e) { show(o, e.message, true); });
    });
    box.appendChild(input); box.appendChild(o); return box;
  }

  function screenCard() {
    var box = card('Check text for scam signs', 'Paste a vacancy, WhatsApp message or post. You get the warning signs and a risk level; you make the call.');
    var ta = el('textarea'); ta.rows = 5; ta.style.cssText = 'width:100%;box-sizing:border-box'; ta.placeholder = 'Paste the text here';
    var o = out();
    box.appendChild(ta);
    box.appendChild(button('Check', function () {
      show(o, 'Checking…');
      api('/api/admin/ai/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ta.value }) }).then(function (r) {
        var s = r.scam; show(o, 'Risk: ' + s.level + ' (' + s.score + '/100)' + (s.needs_review ? ' — worth a closer look' : '') + '\n' + (s.reasons.length ? '• ' + s.reasons.join('\n• ') : 'No warning signs found.'));
      }).catch(function (e) { show(o, e.message, true); });
    }));
    box.appendChild(o); return box;
  }

  function draftCard() {
    var box = card('Draft today’s post', 'Writes the poster caption and Instagram / LinkedIn copy from the latest vacancies. Edit before you post.');
    var o = el('div', null, 'margin-top:8px');
    box.appendChild(button('Draft from today’s vacancies', function () {
      o.textContent = 'Writing…';
      api('/api/admin/ai/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'daily' }) }).then(function (r) {
        o.textContent = '';
        [['Poster caption', r.draft.poster_caption], ['Instagram', r.draft.instagram], ['LinkedIn', r.draft.linkedin], ['Hashtags', r.draft.hashtags.join(' ')]].forEach(function (pair) {
          if (!pair[1]) return;
          o.appendChild(el('div', pair[0], 'font-weight:600;margin-top:8px'));
          o.appendChild(el('div', pair[1], 'white-space:pre-wrap;font-size:13px;overflow-wrap:anywhere'));
          o.appendChild(copyButton(pair[1]));
        });
      }).catch(function (e) { o.textContent = e.message; o.style.color = '#b91c1c'; });
    }));
    box.appendChild(o); return box;
  }

  function replyCard() {
    var box = card('Draft a reply', 'Paste a job enquiry or a job-seeker request. You get a polite draft to edit; nothing is sent.');
    var kind = el('select'); [['enquiry-reply', 'Job enquiry'], ['seeker-reply', 'Job-seeker request']].forEach(function (p) { var o = el('option', p[1]); o.value = p[0]; kind.appendChild(o); });
    var ta = el('textarea'); ta.rows = 4; ta.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px'; ta.placeholder = 'Paste the message';
    var o = out();
    box.appendChild(kind); box.appendChild(ta);
    box.appendChild(button('Draft reply', function () {
      show(o, 'Writing…');
      api('/api/admin/ai/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind.value, message: ta.value }) })
        .then(function (r) { show(o, r.reply); o.appendChild(el('div')); o.appendChild(copyButton(r.reply)); }).catch(function (e) { show(o, e.message, true); });
    }));
    box.appendChild(o); return box;
  }

  function matchCard() {
    var box = card('Match CV Box candidates to a vacancy', 'Enter a vacancy ID. Candidates are ranked by position, skills, town and province. Use the existing “send vacancy alerts” flow to contact them.');
    var id = el('input'); id.placeholder = 'Vacancy ID'; id.style.cssText = 'margin-right:8px';
    var o = out();
    box.appendChild(id);
    box.appendChild(button('Find matches', function () {
      show(o, 'Matching…');
      api('/api/admin/ai/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vacancy_id: id.value.trim() }) }).then(function (r) {
        show(o, r.matches.length ? r.matches.map(function (m) { return m.score + '  ' + m.full_name + ' — ' + m.position + ' (' + m.location + ')\n     ' + m.reasons.join('; '); }).join('\n') : 'No candidates fit well enough.');
      }).catch(function (e) { show(o, e.message, true); });
    }));
    box.appendChild(o); return box;
  }

  window.renderAiAssistant = function () {
    var host = document.getElementById('ai-assistant-body'); if (!host) return;
    host.textContent = '';
    [statusCard, flagsCard, posterCard, screenCard, draftCard, replyCard, matchCard].forEach(function (make) { host.appendChild(make()); });
  };
})();
