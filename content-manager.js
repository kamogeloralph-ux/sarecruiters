/* ============================================================
   CONTENT MANAGER  — admin-editable content sections
   Sections: faq, cv-prep, cv-revamp, interview-tips,
             know-your-rights, learning-hub, support
   Storage: localStorage key 'sa_content_v1' -> { section: [articles] }
   On first load, defaults from content.js are seeded.
   Admin (isAdmin===true) sees Edit / Delete / Add buttons.
   ============================================================ */
(function(){
  var STORAGE_KEY = 'sa_content_v1';

  function readStore(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch(e){ return {}; }
  }
  function writeStore(obj){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch(e){ console.warn('content store write failed', e); }
  }

  // Seed any missing section with defaults (does not overwrite admin edits)
  function ensureSeeded(){
    if (typeof DEFAULT_CONTENT === 'undefined') return;
    var store = readStore();
    var changed = false;
    Object.keys(DEFAULT_CONTENT).forEach(function(key){
      if (!store[key] || !Array.isArray(store[key]) || store[key].length === 0) {
        // deep clone defaults
        store[key] = JSON.parse(JSON.stringify(DEFAULT_CONTENT[key]));
        changed = true;
      }
    });
    if (changed) writeStore(store);
  }

  function getSection(key){
    ensureSeeded();
    var store = readStore();
    if (store[key]) return store[key];
    if (DEFAULT_CONTENT && DEFAULT_CONTENT[key]) return JSON.parse(JSON.stringify(DEFAULT_CONTENT[key]));
    return [];
  }

  function saveSection(key, articles){
    var store = readStore();
    store[key] = articles;
    writeStore(store);
  }

  function upsertArticle(key, article){
    var list = getSection(key);
    var i = list.findIndex(function(a){ return a.id === article.id; });
    if (i >= 0) list[i] = article; else list.push(article);
    saveSection(key, list);
  }

  function deleteArticle(key, id){
    var list = getSection(key).filter(function(a){ return a.id !== id; });
    saveSection(key, list);
  }

  function restoreDefaults(key){
    if (DEFAULT_CONTENT && DEFAULT_CONTENT[key]) {
      saveSection(key, JSON.parse(JSON.stringify(DEFAULT_CONTENT[key])));
    }
  }

  function resetAll(){
    if (typeof DEFAULT_CONTENT === 'undefined') return;
    var fresh = {};
    Object.keys(DEFAULT_CONTENT).forEach(function(key){
      fresh[key] = JSON.parse(JSON.stringify(DEFAULT_CONTENT[key]));
    });
    writeStore(fresh);
  }

  // Expose under both names so both the public app and admin.html can use it
  var api = {
    ensureSeeded: ensureSeeded,
    getSection: getSection,
    upsertArticle: upsertArticle,
    deleteArticle: deleteArticle,
    restoreDefaults: restoreDefaults,
    resetAll: resetAll
  };
  window.ContentMgr = api;
  window.ContentManager = api;   // alias used by admin.html
})();

/* ===== Rendering & editing UI ===== */
var contentEditKey = null;   // current section open in the content sheet
var contentEditingId = null; // article being edited (null = adding)

function renderContentBody(key){
  var articles = ContentMgr.getSection(key);
  var html = '';
  if (!articles.length) {
    html = '<div class="content-empty">No articles in this section yet.</div>';
  } else {
    articles.forEach(function(a){
      html += '<div class="content-article" id="c-art-'+ a.id +'">' +
        '<div class="content-article-title">' + escapeHtml(a.title || '') + '</div>' +
        '<div class="content-article-body">' + (a.body || '') + '</div>';
      if (isAdmin) {
        html += '<div class="content-article-actions">' +
          '<button class="content-edit-btn" data-ripple onclick="editContentArticle(\''+ a.id +'\')">Edit</button>' +
          '<button class="content-del-btn" data-ripple onclick="deleteContentArticle(\''+ a.id +'\')">Delete</button>' +
        '</div>';
      }
      html += '</div>';
    });
  }
  // Admin add / restore controls
  if (isAdmin) {
    html += '<div class="content-admin-bar">' +
      '<button class="content-add-btn" data-ripple onclick="addContentArticle()">+ Add article</button>' +
      '<button class="content-restore-btn" data-ripple onclick="restoreContentDefaults()">Restore defaults</button>' +
    '</div>';
  }
  return html;
}

function openContentSheet(key){
  if (!SECTION_META[key]) return;
  contentEditKey = key;
  contentEditingId = null;
  document.getElementById('content-title').innerHTML = SECTION_META[key].title;
  // Use innerHTML (rich) instead of textContent so articles render properly
  var bodyEl = document.getElementById('content-body');
  bodyEl.style.whiteSpace = 'normal';
  bodyEl.innerHTML = renderContentBody(key);
  document.getElementById('content-overlay').classList.add('open');
}

function refreshContentSheet(){
  if (contentEditKey) {
    document.getElementById('content-body').innerHTML = renderContentBody(contentEditKey);
  }
}

function addContentArticle(){
  contentEditingId = null;
  document.getElementById('ce-title').value = '';
  document.getElementById('ce-body').value = '';
  document.getElementById('content-edit-title').textContent = 'Add article';
  document.getElementById('content-edit-overlay').classList.add('open');
  // close the read sheet behind it (keep it for return)
}

function editContentArticle(id){
  var articles = ContentMgr.getSection(contentEditKey);
  var a = articles.find(function(x){ return x.id === id; });
  if (!a) return;
  contentEditingId = id;
  document.getElementById('ce-title').value = a.title || '';
  document.getElementById('ce-body').value = a.body || '';
  document.getElementById('content-edit-title').textContent = 'Edit article';
  document.getElementById('content-edit-overlay').classList.add('open');
}

function saveContentArticle(){
  var title = document.getElementById('ce-title').value.trim();
  var body = document.getElementById('ce-body').value.trim();
  if (!title) { showToast('Please enter a title'); return; }
  var id = contentEditingId || ('art-' + Date.now() + '-' + Math.floor(Math.random()*1000));
  ContentMgr.upsertArticle(contentEditKey, { id: id, title: title, body: body });
  closeSheet('content-edit-overlay');
  refreshContentSheet();
  showToast(contentEditingId ? 'Article updated' : 'Article added');
}

function deleteContentArticle(id){
  var articles = ContentMgr.getSection(contentEditKey);
  var a = articles.find(function(x){ return x.id === id; });
  var name = a ? a.title : 'this article';
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  ContentMgr.deleteArticle(contentEditKey, id);
  refreshContentSheet();
  showToast('Article deleted');
}

function restoreContentDefaults(){
  if (!confirm('Restore all default articles for this section? Your edits will be replaced.')) return;
  ContentMgr.restoreDefaults(contentEditKey);
  refreshContentSheet();
  showToast('Defaults restored');
}
