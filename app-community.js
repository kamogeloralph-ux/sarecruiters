/* SA Recruiters community feed — TipChat */
var communityMvp = {
  group: null,
  joined: false,
  moderator: false,
  sort: 'new',
  posts: [],
  liked: new Set(),
  reactions: new Map(),
  expanded: new Set(),
  loading: false,
  returnScreen: 'home',
  reportTarget: null,
  vacancySchemaAvailable: true,
  posterSchemaAvailable: true,
  authorIdentityAvailable: true,
  mine: new Map(),
  submissions: [],
  identity: { show: false, has: false },
  lastUserId: null,
  reactionBusy: new Set(),
  pendingReload: false,
  drafts: {}
};
var communityComposerType = 'discussion';
var communityPosterBlob = null;
var communityPosterPreparing = false;
var COMMUNITY_SEEN_KEY = 'sa_tipchat_seen_v1';

function communityEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
  });
}
function communityMissingIdentitySchema(error) {
  return String(error && error.message || '').toLowerCase().indexOf('author_photo_url') >= 0;
}
function communityAuthorAvatarHtml(label, photo, isOfficial, compact) {
  var safePhoto = /^https:\/\//i.test(String(photo || '')) ? communityEsc(photo) : '';
  var initial = isOfficial ? 'SA' : (String(label || 'Anonymous member').trim().charAt(0).toUpperCase() || 'A');
  var className = compact ? 'community-comment-avatar' : 'community-author-mark';
  return '<span class="' + className + (safePhoto ? ' has-photo' : '') + '" aria-hidden="true">' +
    (safePhoto ? '<img src="' + safePhoto + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : communityEsc(initial)) + '</span>';
}
function communityIsRateLimit(error) {
  return String(error && error.message || '').toLowerCase().indexOf('rate limit') >= 0 || String(error && error.code || '') === 'P0429';
}
function communityRateLimitMessage() {
  return 'You are doing that too quickly. Please wait a few minutes and try again.';
}
function communityToast(message) {
  if (typeof showToast === 'function') showToast(message);
  else console.info('[Community]', message);
}
function communityMissingVacancySchema(error) {
  var code = String(error && (error.code || error.status || '') || '');
  var message = String(error && error.message || '').toLowerCase();
  return code === '42703' || code === 'PGRST204' || message.indexOf('post_type') >= 0 || message.indexOf('vacancy_title') >= 0;
}
function communityMissingPosterSchema(error) {
  var message = String(error && error.message || '').toLowerCase();
  return message.indexOf('poster_image_url') >= 0;
}
var COMMUNITY_EMOJIS = [
  { type: 'join', label: 'Join in', file: 'sa-recruiters-emoji-01-join.webp' },
  { type: 'good-luck', label: 'Good luck', file: 'sa-recruiters-emoji-02-good-luck.webp' },
  { type: 'interview-win', label: 'Interview win', file: 'sa-recruiters-emoji-03-interview-win.webp' },
  { type: 'ask-question', label: 'Question', file: 'sa-recruiters-emoji-04-ask-question.webp' },
  { type: 'applause', label: 'Applause', file: 'sa-recruiters-emoji-05-applause.webp' }
];
function communityEmojiInfo(type) { return COMMUNITY_EMOJIS.find(function(item) { return item.type === type; }) || COMMUNITY_EMOJIS[0]; }
function communityEmojiUrl(type) { return 'assets/sa-recruiters-emoji/web/' + communityEmojiInfo(type).file; }
function communityEmojiToken(type) { return '[sa-emoji:' + communityEmojiInfo(type).type + ']'; }
function communityRenderBody(value) {
  var source = String(value == null ? '' : value), token = /\[sa-emoji:(join|good-luck|interview-win|ask-question|applause)\]/g, html = '', last = 0, match;
  while ((match = token.exec(source))) {
    html += communityEsc(source.slice(last, match.index));
    var info = communityEmojiInfo(match[1]);
    html += '<img class="community-inline-emoji" src="' + communityEmojiUrl(info.type) + '" alt="' + communityEsc(info.label) + ' emoji" loading="lazy">';
    last = match.index + match[0].length;
  }
  return html + communityEsc(source.slice(last));
}
function communitySetComposerType(type) {
  communityComposerType = type === 'vacancy' && communityMvp.vacancySchemaAvailable ? 'vacancy' : 'discussion';
  document.querySelectorAll('[data-community-compose-type]').forEach(function(button) {
    var active = button.getAttribute('data-community-compose-type') === communityComposerType;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  var fields = document.getElementById('community-vacancy-fields');
  if (fields) fields.hidden = communityComposerType !== 'vacancy';
  var help = document.getElementById('community-vacancy-help');
  if (help) help.hidden = communityComposerType !== 'vacancy';
  var posterUpload = document.getElementById('community-poster-upload');
  if (posterUpload) posterUpload.hidden = communityComposerType !== 'vacancy' || !communityMvp.posterSchemaAvailable;
  var vacancyButton = document.querySelector('[data-community-compose-type="vacancy"]');
  if (vacancyButton) {
    vacancyButton.hidden = !communityMvp.vacancySchemaAvailable;
    vacancyButton.title = communityMvp.vacancySchemaAvailable ? '' : 'Vacancy posting is being enabled';
  }
  var heading = document.getElementById('community-compose-heading');
  if (heading) heading.textContent = communityComposerType === 'vacancy' ? 'Share a vacancy' : 'Start a conversation';
  var body = document.getElementById('community-post-body');
  if (body) {
    body.placeholder = communityComposerType === 'vacancy'
      ? 'Add vacancy details or a short caption. You can also share a poster below…'
      : 'What would you like advice on? Share a question or helpful tip…';
    body.setAttribute('aria-label', communityComposerType === 'vacancy' ? 'Vacancy details or caption' : 'Write a TipChat post');
  }
  var submit = document.getElementById('community-post-submit');
  if (submit) submit.textContent = communityComposerType === 'vacancy' ? 'Share vacancy' : 'Post';
}
function communityReadVacancyMeta() {
  function value(id) { var field = document.getElementById(id); return field ? field.value.trim() : ''; }
  return { title: value('community-vacancy-title'), location: value('community-vacancy-location'), application: value('community-vacancy-application') };
}
function communityVacancyMetaHtml(post) {
  if (post.post_type !== 'vacancy') return '';
  var meta = [];
  if (post.vacancy_location) meta.push('<span>📍 ' + communityEsc(post.vacancy_location) + '</span>');
  if (post.vacancy_application) meta.push('<span>✉ ' + communityEsc(post.vacancy_application) + '</span>');
  return '<div class="community-vacancy-head"><span class="community-vacancy-badge">Vacancy</span><span class="community-vacancy-source">' + (post.poster_image_url ? 'Poster vacancy' : 'Text vacancy') + ' · shared by the community</span></div>' +
    (post.vacancy_title ? '<h3 class="community-vacancy-title">' + communityEsc(post.vacancy_title) + '</h3>' : '') +
    (meta.length ? '<div class="community-vacancy-meta">' + meta.join('') + '</div>' : '');
}
function communityPosterImageHtml(post) {
  if (!post || !post.poster_image_url) return '';
  var title = post.vacancy_title || 'Vacancy poster';
  var url = communityEsc(post.poster_image_url);
  return '<a class="community-post-poster" href="' + url + '" target="_blank" rel="noopener noreferrer" aria-label="Open poster: ' + communityEsc(title) + '"><img src="' + url + '" alt="' + communityEsc(title) + ' vacancy poster" loading="lazy"><span>Open poster</span></a>';
}
function communityHandlePosterPhoto(event) {
  var file = event && event.target && event.target.files && event.target.files[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type || '')) {
    communityRemovePoster();
    event.target.value = '';
    communityToast('Choose a JPG, PNG or WebP poster image.');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    communityRemovePoster();
    event.target.value = '';
    communityToast('Choose a poster smaller than 12 MB.');
    return;
  }
  var preview = document.getElementById('community-poster-preview');
  var fallback = document.getElementById('community-poster-fallback');
  communityPosterBlob = null;
  if (preview && preview.src && preview.src.indexOf('blob:') === 0) URL.revokeObjectURL(preview.src);
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (fallback) { fallback.textContent = 'Preparing poster preview…'; fallback.style.display = 'grid'; }
  if (typeof processPosterPhoto !== 'function') {
    communityToast('Poster upload is unavailable right now.');
    return;
  }
  communityPosterPreparing = true;
  processPosterPhoto(event, 'communityPosterBlob', 'community-poster-preview', 'community-poster-fallback', function(error) {
    communityPosterPreparing = false;
    if (error) {
      communityRemovePoster();
      communityToast('That image could not be read. Try a different JPG, PNG or WebP.');
    }
  });
}
function communityRemovePoster() {
  communityPosterBlob = null;
  communityPosterPreparing = false;
  var input = document.getElementById('community-poster-file');
  var preview = document.getElementById('community-poster-preview');
  var fallback = document.getElementById('community-poster-fallback');
  if (input) input.value = '';
  if (preview) {
    if (preview.src && preview.src.indexOf('blob:') === 0) URL.revokeObjectURL(preview.src);
    preview.src = '';
    preview.style.display = 'none';
  }
  if (fallback) { fallback.textContent = 'Poster preview will appear here'; fallback.style.display = 'grid'; }
}
async function communityUploadPoster(caption) {
  if (!communityPosterBlob) return null;
  try {
    var sessionResult = await supabaseClient.auth.getSession();
    var token = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
    if (!token) throw new Error('Your sign-in has expired. Please sign in again.');
    var response = await fetch(R2_WORKER_URL + '/api/upload/employer-poster' + (caption ? '?caption=' + encodeURIComponent(caption) : ''), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'image/jpeg' },
      body: communityPosterBlob
    });
    var payload = await response.json().catch(function() { return {}; });
    if (!response.ok || !payload.url) throw new Error(payload.error || 'Could not upload the poster. Please try again.');
    var uploaded = new URL(payload.url);
    if (uploaded.protocol !== 'https:' || uploaded.pathname.indexOf('/employer-posters/') < 0) throw new Error('The poster upload returned an invalid image URL.');
    return { url: uploaded.href, key: payload.key || null };
  } catch (error) {
    console.error('[TipChat] poster upload failed', error);
    communityStatus(error.message || 'Could not upload the poster. Your draft is still here.', 'error');
    return null;
  }
}
// Best-effort cleanup of an uploaded poster that never became (or no longer is) a post.
async function communityDeletePosterFile(ref) {
  try {
    var key = String(ref || '');
    if (!key) return;
    if (/^https?:/i.test(key)) {
      var match = key.match(/\/(employer-posters\/[A-Za-z0-9]+\.jpg)$/);
      key = match ? match[1] : '';
    }
    if (!key) return;
    var sessionResult = await supabaseClient.auth.getSession();
    var token = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
    if (!token) return;
    await fetch(R2_WORKER_URL + '/api/upload/employer-poster?key=' + encodeURIComponent(key), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  } catch (error) {
    console.warn('[TipChat] poster cleanup skipped', error);
  }
}
function communityEmojiButton(type, target) {
  var info = communityEmojiInfo(type);
  var action = target.indexOf('post:') === 0
    ? 'communityToggleReaction(\'' + communityEsc(target.slice(5)) + '\',\'' + info.type + '\')'
    : 'communityPickComposerEmoji(\'' + communityEsc(target) + '\',\'' + info.type + '\')';
  return '<button type="button" class="community-emoji-choice" title="' + communityEsc(info.label) + '" aria-label="Add ' + communityEsc(info.label) + ' emoji" onclick="' + action + '"><img src="' + communityEmojiUrl(info.type) + '" alt=""><span>' + communityEsc(info.label) + '</span></button>';
}
function communityInitEmojiPicker(id, target) { var picker = document.getElementById(id); if (picker && !picker.dataset.ready) { picker.innerHTML = COMMUNITY_EMOJIS.map(function(item) { return communityEmojiButton(item.type, target); }).join(''); picker.dataset.ready = 'true'; } }
function communityToggleEmojiPicker(id, target) { var picker = document.getElementById(id); if (!picker) return; communityInitEmojiPicker(id, target); picker.hidden = !picker.hidden; }
function communityPickComposerEmoji(target, type) {
  var field = document.getElementById(target); if (!field) return;
  var token = communityEmojiToken(type), start = Number.isInteger(field.selectionStart) ? field.selectionStart : field.value.length, end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
  field.value = field.value.slice(0, start) + token + field.value.slice(end); field.focus(); field.selectionStart = field.selectionEnd = start + token.length;
  var info = communityEmojiInfo(type), preview = document.getElementById('community-post-emoji-preview');
  if (preview) preview.innerHTML = '<img src="' + communityEmojiUrl(type) + '" alt="' + communityEsc(info.label) + ' emoji"><span>' + communityEsc(info.label) + ' added</span>';
  var picker = document.getElementById('community-post-emoji-picker'); if (picker) picker.hidden = true;
}
function communitySignedIn() {
  return typeof saAuthUser !== 'undefined' && !!saAuthUser && !!supabaseClient;
}
function communityRequireSignIn() {
  if (communitySignedIn()) return true;
  communityToast('Sign in with Google to join or take part in the community.');
  if (typeof signInWithGoogle === 'function') signInWithGoogle();
  return false;
}
function communityWhen(value) {
  var time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  var seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' }).format(new Date(time));
}
function communityStatus(message, kind) {
  var element = document.getElementById('community-status');
  if (!element) return;
  element.textContent = message || '';
  element.className = 'community-status' + (kind ? ' is-' + kind : '');
}
function communitySetScreen(screenId) {
  document.querySelectorAll('.screen').forEach(function(screen) { screen.classList.remove('active'); });
  var screen = document.getElementById(screenId);
  if (screen) screen.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function(button) {
    var isCommunity = screenId === 'screen-community' && button.id === 'nav-community';
    button.classList.toggle('active', isCommunity || button.dataset.tab === screenId.replace(/^screen-/, ''));
  });
  if (typeof resetActiveScreenScroll === 'function') resetActiveScreenScroll(screenId);
  else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}
function openCommunity(fromDeepLink) {
  var active = document.querySelector('.screen.active');
  if (active && active.id !== 'screen-community') communityMvp.returnScreen = active.id.replace(/^screen-/, '');
  if (!communityMvp.returnScreen) communityMvp.returnScreen = 'home';
  communitySetScreen('screen-community');
  if (!fromDeepLink && location.hash !== '#tipchat') {
    history.replaceState(null, '', location.pathname + location.search + '#tipchat');
  }
  communityLoad();
}
function goBackFromCommunity() {
  var screenName = communityMvp.returnScreen || 'home';
  var target = document.getElementById('screen-' + screenName) ? 'screen-' + screenName : 'screen-home';
  communitySetScreen(target);
  if (location.hash === '#community-interview-tips' || location.hash === '#tipchat') history.replaceState(null, '', location.pathname + location.search);
}
function communityRenderGroup() {
  var join = document.getElementById('community-join-btn');
  if (join) {
    join.textContent = communityMvp.joined ? '✓' : 'Join';
    join.classList.toggle('is-joined', communityMvp.joined);
    join.setAttribute('aria-pressed', communityMvp.joined ? 'true' : 'false');
    join.setAttribute('aria-label', communityMvp.joined ? 'Leave TipChat' : 'Join TipChat');
    join.title = communityMvp.joined ? 'Leave TipChat' : 'Join TipChat';
  }
  var adminPanel = document.getElementById('community-moderator-panel');
  if (adminPanel) adminPanel.hidden = !communityMvp.moderator;
  var postButton = document.getElementById('community-post-submit');
  if (postButton) postButton.disabled = !communityMvp.joined || !communitySignedIn();
  var composerHint = document.getElementById('community-composer-hint');
  if (composerHint) {
    composerHint.textContent = !communitySignedIn()
      ? 'Sign in and join TipChat to share a post.'
      : (!communityMvp.joined ? 'Join TipChat before posting or commenting.' : 'Posts are checked before they appear. You show as Anonymous member unless you choose otherwise above.');
  }
  communityRenderIdentity();
  communitySetComposerType(communityComposerType);
}
async function communityLoad() {
  var host = document.getElementById('community-feed');
  if (!host || !supabaseClient) return;
  if (communityMvp.loading) { communityMvp.pendingReload = true; return; }
  communityMvp.loading = true;
  communityMvp.pendingReload = false;
  if (!communityMvp.posts.length) host.innerHTML = '<div class="community-empty">Loading TipChat…</div>';
  try {
    var groupResult = await supabaseClient.from('community_groups')
      .select('id,slug,title,description,is_public')
      .eq('slug', 'interview-tips').eq('is_public', true).maybeSingle();
    if (groupResult.error) throw groupResult.error;
    if (!groupResult.data) throw new Error('TipChat is not available yet.');
    communityMvp.group = groupResult.data;
    communityMvp.joined = false;
    communityMvp.moderator = false;
    communityMvp.lastUserId = communitySignedIn() ? saAuthUser.id : null;
    if (communitySignedIn()) {
      var membership = await supabaseClient.from('community_memberships')
        .select('group_id').eq('group_id', communityMvp.group.id).limit(1).maybeSingle();
      if (!membership.error) communityMvp.joined = !!membership.data;
      var adminResult = await supabaseClient.rpc('is_admin');
      communityMvp.moderator = !adminResult.error && adminResult.data === true;
    }
    await communityLoadIdentityState();
    await communityLoadMySubmissions();
    communityRenderGroup();
    await communityLoadFeed();
    if (communityMvp.moderator) await communityLoadModerationQueue(false);
  } catch (error) {
    console.error('[Community] load failed', error);
    host.innerHTML = '<div class="community-empty"><strong>Community unavailable</strong><span>Check your connection and try again.</span><button type="button" class="community-secondary-btn" onclick="communityLoad()">Retry</button></div>';
    communityStatus('Could not load the community. Please try again.', 'error');
  } finally {
    communityMvp.loading = false;
    if (communityMvp.pendingReload) { communityMvp.pendingReload = false; communityLoad(); }
  }
}
async function communityLoadFeed() {
  var host = document.getElementById('community-feed');
  if (!host || !communityMvp.group) return;
  if (!communityMvp.posts.length) host.innerHTML = '<div class="community-empty">Loading posts…</div>';
  var authorPhotoSelect = communityMvp.authorIdentityAvailable ? ',author_photo_url' : '';
  var query = supabaseClient.from('community_posts')
    .select('id,group_id,author_label,body,status,is_official,post_type,vacancy_title,vacancy_location,vacancy_application,poster_image_url,likes_count,comments_count,created_at' + authorPhotoSelect)
    .eq('group_id', communityMvp.group.id)
    .eq('status', 'approved');
  if (communityMvp.sort === 'top') {
    var monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    query = query.gte('created_at', monthStart.toISOString())
      .order('likes_count', { ascending: false })
      .order('comments_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  var result = await query.limit(40);
  if (result.error && communityMvp.authorIdentityAvailable && communityMissingIdentitySchema(result.error)) {
    communityMvp.authorIdentityAvailable = false;
    return communityLoadFeed();
  }
  if (result.error && communityMissingPosterSchema(result.error)) {
    communityMvp.posterSchemaAvailable = false;
    communitySetComposerType(communityComposerType);
    query = supabaseClient.from('community_posts')
      .select('id,group_id,author_label,body,status,is_official,post_type,vacancy_title,vacancy_location,vacancy_application,likes_count,comments_count,created_at' + authorPhotoSelect)
      .eq('group_id', communityMvp.group.id).eq('status', 'approved');
    if (communityMvp.sort === 'top') query = query.gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()).order('likes_count', { ascending: false }).order('comments_count', { ascending: false }).order('created_at', { ascending: false });
    else query = query.order('created_at', { ascending: false });
    result = await query.limit(40);
  }
  if (result.error && communityMissingVacancySchema(result.error)) {
    communityMvp.vacancySchemaAvailable = false;
    result = await supabaseClient.from('community_posts')
      .select('id,group_id,author_label,body,status,is_official,likes_count,comments_count,created_at' + authorPhotoSelect)
      .eq('group_id', communityMvp.group.id).eq('status', 'approved')
      .order('created_at', { ascending: false }).limit(40);
    if (communityMvp.sort === 'top') result = await supabaseClient.from('community_posts')
      .select('id,group_id,author_label,body,status,is_official,likes_count,comments_count,created_at' + authorPhotoSelect)
      .eq('group_id', communityMvp.group.id).eq('status', 'approved')
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
      .order('likes_count', { ascending: false }).order('comments_count', { ascending: false }).order('created_at', { ascending: false }).limit(40);
    communitySetComposerType(communityComposerType);
  }
  if (result.error) throw result.error;
  communityMvp.posts = result.data || [];
  communityMvp.liked = new Set();
  communityMvp.reactions = new Map();
  if (communitySignedIn() && communityMvp.posts.length) {
    var ids = communityMvp.posts.map(function(post) { return post.id; });
    var reactionResult = await supabaseClient.from('community_post_reactions')
      .select('post_id,reaction_type').in('post_id', ids);
    if (!reactionResult.error) (reactionResult.data || []).forEach(function(row) {
      if (row.reaction_type === 'like') communityMvp.liked.add(row.post_id);
      else communityMvp.reactions.set(row.post_id, row.reaction_type);
    });
  }
  communityRenderFeed();
}
function communityCurrentReaction(postId) {
  return communityMvp.reactions.get(postId) || (communityMvp.liked.has(postId) ? 'like' : null);
}
function communityActionsHtml(post) {
  var id = communityEsc(post.id);
  var liked = communityMvp.liked.has(post.id);
  var joined = communityMvp.joined && communitySignedIn();
  var likeAction = joined ? 'communityToggleLike' : 'communityPromptParticipation';
  var expanded = communityMvp.expanded.has(post.id);
  var emoji = communityMvp.reactions.get(post.id);
  return '<button type="button" class="community-action' + (liked ? ' is-liked' : '') + '" aria-pressed="' + (liked ? 'true' : 'false') + '" onclick="' + likeAction + '(\'' + id + '\')"><span aria-hidden="true">' + (liked ? '♥' : '♡') + '</span> ' + Number(post.likes_count || 0) + ' Like</button>' +
    '<button type="button" class="community-action" data-community-comments-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="communityToggleComments(\'' + id + '\')">' + Number(post.comments_count || 0) + ' Comments</button>' +
    '<button type="button" class="community-action community-reaction-toggle" aria-expanded="false" onclick="communityToggleEmojiPicker(\'community-reaction-picker-' + id + '\',\'post:' + id + '\')">' + (emoji ? '<img src="' + communityEmojiUrl(emoji) + '" alt="" class="community-action-emoji"> Reacted' : 'React') + '</button>' +
    '<button type="button" class="community-action community-share-action" onclick="communitySharePost(\'' + id + '\')">Share</button>';
}
// Update one post's action row in place: no feed reload, no lost scroll position or drafts.
function communityRefreshActions(postId) {
  var post = communityMvp.posts.find(function(item) { return item.id === postId; });
  var article = document.querySelector('.community-post[data-post-id="' + String(postId).replace(/"/g, '') + '"]');
  if (!post || !article) return;
  var actions = article.querySelector('.community-post-actions');
  if (actions) actions.innerHTML = communityActionsHtml(post);
  var picker = article.querySelector('.community-reaction-picker');
  if (picker) picker.hidden = true;
}
function communityRenderFeed() {
  var host = document.getElementById('community-feed');
  if (!host) return;
  if (!communityMvp.posts.length) {
    host.innerHTML = '<div class="community-empty"><strong>Start the TipChat feed</strong><span>Share an interview tip, ask for advice, or post a vacancy as text or a poster.</span></div>';
    return;
  }
  host.innerHTML = communityMvp.posts.map(function(post) {
    var id = communityEsc(post.id);
    var official = post.is_official ? '<span class="community-official">Official</span>' : '';
    var expanded = communityMvp.expanded.has(post.id);
    var mine = communityMvp.mine.has('post:' + post.id);
    var moreButton = mine
      ? '<button class="community-more community-more-delete" type="button" aria-label="Delete your post" title="Delete your post" onclick="communityDeleteOwn(\'post\',\'' + id + '\')">Delete</button>'
      : '<button class="community-more" type="button" aria-label="Report post" title="Report post" onclick="communityOpenReport(\'post\',\'' + id + '\')">•••</button>';
    return '<article class="community-post" data-post-id="' + id + '">' +
      '<div class="community-post-head">' + communityAuthorAvatarHtml(post.author_label, post.author_photo_url, post.is_official, false) +
      '<div class="community-post-byline"><strong>' + communityEsc(post.author_label) + '</strong>' + official + '<span>' + communityEsc(communityWhen(post.created_at)) + '</span></div>' +
      moreButton + '</div>' +
      communityVacancyMetaHtml(post) +
      (post.body ? '<div class="community-post-body">' + communityRenderBody(post.body) + '</div>' : '') +
      communityPosterImageHtml(post) +
      '<div class="community-post-actions">' + communityActionsHtml(post) + '</div>' +
      '<div class="community-reaction-picker" id="community-reaction-picker-' + id + '" hidden></div>' +
      '<div class="community-comments" id="community-comments-' + id + '"' + (expanded ? '' : ' hidden') + '></div>' +
      '</article>';
  }).join('');
  communityMvp.posts.forEach(function(post) {
    if (communityMvp.expanded.has(post.id)) communityLoadComments(post.id);
  });
}
async function communityJoinGroup() {
  if (!communityRequireSignIn()) return;
  if (!communityMvp.group) return;
  if (communityMvp.joined) {
    var leave = await supabaseClient.from('community_memberships').delete().eq('group_id', communityMvp.group.id);
    if (leave.error) { communityToast('Could not leave the group. Please try again.'); return; }
    communityMvp.joined = false;
    communityToast('You left TipChat.');
  } else {
    var join = await supabaseClient.from('community_memberships').insert({ group_id: communityMvp.group.id });
    if (join.error && join.error.code !== '23505') { console.error(join.error); communityToast('Could not join the group. Please try again.'); return; }
    communityMvp.joined = true;
    communityToast('You joined TipChat. Welcome!');
  }
  communityRenderGroup();
  communityRenderFeed();
}
function communitySetSort(sort) {
  communityMvp.sort = sort === 'top' ? 'top' : 'new';
  document.querySelectorAll('[data-community-sort]').forEach(function(button) {
    var active = button.getAttribute('data-community-sort') === communityMvp.sort;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  communityLoadFeed().catch(function(error) { console.error(error); communityToast('Could not refresh posts.'); });
}
function communityPromptParticipation() {
  if (!communityRequireSignIn()) return;
  if (!communityMvp.joined) communityToast('Join TipChat before posting, commenting or reacting.');
}
async function communitySubmitPost(event) {
  if (event) event.preventDefault();
  if (!communityRequireSignIn()) return false;
  if (!communityMvp.joined) { communityToast('Join TipChat before posting.'); return false; }
  if (!communityMvp.group) { communityStatus('TipChat is still loading. Please try again in a moment.', 'error'); return false; }
  var field = document.getElementById('community-post-body');
  var body = field ? field.value.trim() : '';
  var vacancy = communityReadVacancyMeta();
  var isVacancy = communityComposerType === 'vacancy';
  if (isVacancy && communityPosterPreparing) { communityStatus('Your poster is still being prepared. Please wait a moment, then press Share again.', 'error'); return false; }
  if (!body && isVacancy && communityPosterBlob) body = vacancy.title ? 'Vacancy poster: ' + vacancy.title : 'Vacancy poster attached — see the image for details.';
  if (body.length < 12 || body.length > 3000) { communityStatus('Write at least 12 characters, or attach a vacancy poster.', 'error'); return false; }
  if (isVacancy && !communityMvp.vacancySchemaAvailable) { communityToast('Vacancy posting is being enabled. Please try again shortly.'); return false; }
  if (isVacancy && communityPosterBlob && !communityMvp.posterSchemaAvailable) { communityToast('Poster posts are being enabled. You can still share this vacancy as text.'); return false; }
  if (isVacancy && vacancy.title.length > 140) { communityStatus('Keep the vacancy title under 140 characters.', 'error'); return false; }
  if (isVacancy && vacancy.application.length > 300) { communityStatus('Keep the application contact under 300 characters.', 'error'); return false; }
  var button = document.getElementById('community-post-submit');
  if (button) button.disabled = true;
  var result;
  var poster = null;
  try {
    if (isVacancy && communityPosterBlob) {
      communityStatus('Uploading your poster…', '');
      poster = await communityUploadPoster(vacancy.title || 'TipChat vacancy poster');
      if (!poster) { if (button) button.disabled = false; return false; }
    }
    result = communityMvp.vacancySchemaAvailable
      ? await supabaseClient.from('community_posts').insert({
          group_id: communityMvp.group.id,
          body: body,
          post_type: isVacancy ? 'vacancy' : 'discussion',
          vacancy_title: isVacancy ? (vacancy.title || null) : null,
          vacancy_location: isVacancy ? (vacancy.location || null) : null,
          vacancy_application: isVacancy ? (vacancy.application || null) : null,
          poster_image_url: poster ? poster.url : null
        })
      : await supabaseClient.from('community_posts').insert({ group_id: communityMvp.group.id, body: body });
  } catch (error) {
    result = { error: error };
  }
  if (result.error && poster) communityDeletePosterFile(poster.key || poster.url);
  if (result.error && communityMissingVacancySchema(result.error)) {
    communityMvp.vacancySchemaAvailable = false;
    communityStatus('TipChat vacancy support is still being enabled. Your draft is still here; please try again later.', 'error');
    if (button) button.disabled = false;
    communityRenderGroup();
    return false;
  }
  if (result.error && communityMissingPosterSchema(result.error)) {
    communityMvp.posterSchemaAvailable = false;
    communityStatus('Poster posts are still being enabled. Your draft is still here; please try again later.', 'error');
    if (button) button.disabled = false;
    communityRenderGroup();
    return false;
  }
  if (button) button.disabled = false;
  if (result.error) {
    console.error('community post insert', result.error);
    var errorCode = String(result.error.code || result.error.status || '');
    var errorMessage = communityIsRateLimit(result.error)
      ? communityRateLimitMessage() + ' Your draft remains in the box.'
      : errorCode === '401' || errorCode === 'PGRST301'
        ? 'Your sign-in may have expired. Sign in again, then retry; your draft remains in the box.'
        : errorCode === '403' || errorCode === '42501'
          ? 'The post was blocked by group permissions. Check that you are still joined; your draft remains in the box.'
          : 'Your post could not be sent. Your draft remains in the box; check your connection and try again.';
    communityStatus(errorMessage, 'error');
    return false;
  }
  if (field) field.value = '';
  ['community-vacancy-title', 'community-vacancy-location', 'community-vacancy-application'].forEach(function(id) { var input = document.getElementById(id); if (input) input.value = ''; });
  communityRemovePoster();
  communitySetComposerType('discussion');
  communityStatus('Thanks — your post is being checked and will appear as soon as it passes. Track it under My submissions; ' + (communityMvp.identity.show && communityMvp.identity.has ? 'it will show your Talent Pool name and photo once it is live.' : 'it will appear as Anonymous member.'), 'success');
  communityRenderGroup();
  communityLoadMySubmissions();
  communityLoadModerationQueue(false);
  return false;
}
function communityToggleLike(postId) {
  return communityToggleReaction(postId, 'like');
}
async function communityToggleReaction(postId, reactionType) {
  if (!communityRequireSignIn()) return;
  if (!communityMvp.joined) { communityPromptParticipation(); return; }
  if (communityMvp.reactionBusy.has(postId)) return;
  communityMvp.reactionBusy.add(postId);
  try {
    // One atomic server call: set, switch or clear. No delete-then-insert gap.
    var result = await supabaseClient.rpc('community_set_reaction', { p_post_id: postId, p_reaction: reactionType });
    if (result.error) {
      console.error(result.error);
      communityToast(String(result.error.code) === '42501' ? 'Join TipChat before reacting.' : 'Reaction could not be saved.');
      return;
    }
    var previous = communityCurrentReaction(postId);
    var next = result.data || null;
    communityMvp.liked.delete(postId);
    communityMvp.reactions.delete(postId);
    if (next === 'like') communityMvp.liked.add(postId);
    else if (next) communityMvp.reactions.set(postId, next);
    var post = communityMvp.posts.find(function(item) { return item.id === postId; });
    if (post) post.likes_count = Math.max(0, Number(post.likes_count || 0) + (next === 'like' ? 1 : 0) - (previous === 'like' ? 1 : 0));
    communityRefreshActions(postId);
  } finally {
    communityMvp.reactionBusy.delete(postId);
  }
}
async function communityToggleComments(postId) {
  // Reading comments is public; only posting needs sign-in and membership.
  var panel = document.getElementById('community-comments-' + postId);
  if (!panel) return;
  var opening = !communityMvp.expanded.has(postId);
  if (opening) communityMvp.expanded.add(postId); else communityMvp.expanded.delete(postId);
  var article = panel.closest('.community-post');
  var toggle = article && article.querySelector('[data-community-comments-toggle]');
  if (toggle) toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (!opening) { panel.hidden = true; return; }
  await communityLoadComments(postId);
}
async function communityLoadComments(postId) {
  var panel = document.getElementById('community-comments-' + postId);
  if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = '<div class="community-comment-loading">Loading comments…</div>';
  var result = await supabaseClient.from('community_comments')
    .select('id,post_id,author_label,body,status,created_at' + (communityMvp.authorIdentityAvailable ? ',author_photo_url' : ''))
    .eq('post_id', postId).eq('status', 'approved')
    .order('created_at', { ascending: true }).limit(50);
  if (result.error && communityMvp.authorIdentityAvailable && communityMissingIdentitySchema(result.error)) {
    communityMvp.authorIdentityAvailable = false;
    result = await supabaseClient.from('community_comments')
      .select('id,post_id,author_label,body,status,created_at')
      .eq('post_id', postId).eq('status', 'approved')
      .order('created_at', { ascending: true }).limit(50);
  }
  if (result.error) { console.error(result.error); panel.innerHTML = '<div class="community-comment-loading">Comments are unavailable right now.</div>'; return; }
  var comments = result.data || [];
  var canComment = communityMvp.joined && communitySignedIn();
  var inputId = 'community-comment-input-' + communityEsc(postId);
  panel.innerHTML = '<div class="community-comment-list">' + (comments.length
    ? comments.map(function(comment) {
        var commentId = communityEsc(comment.id);
        var own = communityMvp.mine.has('comment:' + comment.id);
        var actionButton = own
          ? '<button type="button" class="community-comment-report" aria-label="Delete your comment" onclick="communityDeleteOwn(\'comment\',\'' + commentId + '\')">Delete</button>'
          : '<button type="button" class="community-comment-report" aria-label="Report comment" onclick="communityOpenReport(\'comment\',\'' + commentId + '\')">Report</button>';
        return '<div class="community-comment"><div class="community-comment-head">' + communityAuthorAvatarHtml(comment.author_label, comment.author_photo_url, false, true) + '<strong>' + communityEsc(comment.author_label) + '</strong><span>' + communityEsc(communityWhen(comment.created_at)) + '</span>' + actionButton + '</div><p>' + communityEsc(comment.body) + '</p></div>';
      }).join('')
    : '<div class="community-comment-loading">No approved comments yet.</div>') + '</div>' +
    (canComment
      ? '<form class="community-comment-form" onsubmit="return communitySubmitComment(event,\'' + communityEsc(postId) + '\')"><label class="sr-only" for="' + inputId + '">Add a comment</label><textarea id="' + inputId + '" maxlength="1500" placeholder="Add a helpful comment…" required></textarea><button type="submit">Send</button><small>Comments are checked before they appear.</small></form>'
      : '<button type="button" class="community-secondary-btn" onclick="communityPromptParticipation()">' + (communitySignedIn() ? 'Join to comment' : 'Sign in to comment') + '</button>');
  var draftField = document.getElementById('community-comment-input-' + postId);
  if (draftField && communityMvp.drafts[draftField.id]) draftField.value = communityMvp.drafts[draftField.id];
}
async function communitySubmitComment(event, postId) {
  if (event) event.preventDefault();
  if (!communityRequireSignIn()) return false;
  if (!communityMvp.joined) { communityToast('Join TipChat before commenting.'); return false; }
  var form = event && event.currentTarget;
  var field = form && form.querySelector('textarea');
  var body = field ? field.value.trim() : '';
  if (body.length < 2 || body.length > 1500) { communityToast('Write between 2 and 1,500 characters.'); return false; }
  var result = await supabaseClient.from('community_comments').insert({ post_id: postId, body: body });
  if (result.error) {
    console.error(result.error);
    communityToast(communityIsRateLimit(result.error) ? communityRateLimitMessage() : 'Comment could not be sent. Please try again.');
    return false;
  }
  if (field) { delete communityMvp.drafts[field.id]; field.value = ''; }
  communityToast('Comment submitted — it will appear as soon as it passes the checks. Track it under My submissions.');
  communityLoadMySubmissions();
  communityLoadModerationQueue(false);
  return false;
}
function communityOpenReport(type, id) {
  if (!communityRequireSignIn()) return;
  communityMvp.reportTarget = { type: type === 'comment' ? 'comment' : 'post', id: id };
  var overlay = document.getElementById('community-report-overlay');
  if (overlay) {
    overlay.hidden = false;
    var details = document.getElementById('community-report-details');
    if (details) details.value = '';
    var reason = document.getElementById('community-report-reason');
    if (reason) reason.value = 'spam';
    var submit = document.getElementById('community-report-submit');
    if (submit) submit.focus();
  }
}
function communityCloseReport() {
  var overlay = document.getElementById('community-report-overlay');
  if (overlay) overlay.hidden = true;
  communityMvp.reportTarget = null;
}
async function communitySubmitReport(event) {
  if (event) event.preventDefault();
  if (!communityRequireSignIn() || !communityMvp.reportTarget) return false;
  var reason = document.getElementById('community-report-reason');
  var details = document.getElementById('community-report-details');
  var payload = {
    post_id: communityMvp.reportTarget.type === 'post' ? communityMvp.reportTarget.id : null,
    comment_id: communityMvp.reportTarget.type === 'comment' ? communityMvp.reportTarget.id : null,
    reason: reason ? reason.value : 'other',
    details: details && details.value.trim() ? details.value.trim() : null
  };
  var result = await supabaseClient.from('community_reports').insert(payload);
  if (result.error) {
    if (result.error.code === '23505') communityToast('You have already reported this item.');
    else if (communityIsRateLimit(result.error)) communityToast(communityRateLimitMessage());
    else { console.error(result.error); communityToast('Report could not be sent. Please try again.'); }
    return false;
  }
  communityCloseReport();
  communityToast('Report sent to the moderation team.');
  communityLoadModerationQueue(false);
  return false;
}
async function communityLoadIdentityState() {
  communityMvp.identity = { show: false, has: false };
  if (communitySignedIn()) {
    try {
      var result = await supabaseClient.rpc('community_identity_state');
      if (!result.error && result.data) communityMvp.identity = { show: !!result.data.show_profile, has: !!result.data.has_profile };
    } catch (error) { console.warn('[TipChat] identity state unavailable', error); }
  }
  communityRenderIdentity();
}
function communityRenderIdentity() {
  var box = document.getElementById('community-identity-box');
  var toggle = document.getElementById('community-identity-toggle');
  if (box) box.hidden = !(communitySignedIn() && communityMvp.joined && communityMvp.identity.has);
  if (toggle) toggle.checked = !!communityMvp.identity.show;
}
async function communitySetIdentityVisibility(show) {
  var toggle = document.getElementById('community-identity-toggle');
  if (!communityRequireSignIn()) { if (toggle) toggle.checked = false; return; }
  if (toggle) toggle.disabled = true;
  var result = await supabaseClient.rpc('community_set_identity_visibility', { p_show: !!show });
  if (toggle) toggle.disabled = false;
  if (result.error || !result.data) {
    console.error(result.error);
    if (toggle) toggle.checked = !show;
    communityToast('Could not update your visibility setting. Please try again.');
    return;
  }
  communityMvp.identity = { show: !!result.data.show_profile, has: !!result.data.has_profile };
  communityRenderIdentity();
  communityToast(communityMvp.identity.show ? 'Your Talent Pool name and photo now show on your TipChat posts and comments.' : 'You now appear as Anonymous member.');
  await communityLoadFeed();
}
function communityNotifyDecisions() {
  var seen = {};
  try { seen = JSON.parse(localStorage.getItem(COMMUNITY_SEEN_KEY) || '{}') || {}; } catch (error) { seen = {}; }
  var approved = 0, hidden = 0, next = {};
  communityMvp.submissions.forEach(function(row) {
    if (seen[row.item_id] === 'pending') {
      if (row.item_status === 'approved') approved++;
      else if (row.item_status === 'hidden') hidden++;
    }
    next[row.item_id] = row.item_status;
  });
  try { localStorage.setItem(COMMUNITY_SEEN_KEY, JSON.stringify(next)); } catch (error) {}
  if (approved) communityToast(approved === 1 ? 'Your submission was approved and is now live.' : approved + ' of your submissions were approved and are now live.');
  else if (hidden) communityToast('A submission was not approved. See My submissions for details.');
}
async function communityLoadMySubmissions() {
  communityMvp.mine = new Map();
  communityMvp.submissions = [];
  if (communitySignedIn()) {
    try {
      var result = await supabaseClient.rpc('community_my_submissions');
      if (result.error) throw result.error;
      communityMvp.submissions = result.data || [];
      communityMvp.submissions.forEach(function(row) { communityMvp.mine.set(row.item_kind + ':' + row.item_id, row.item_status); });
      communityNotifyDecisions();
    } catch (error) { console.warn('[TipChat] my submissions unavailable', error); }
  }
  communityRenderMine();
}
function communityRenderMine() {
  var panel = document.getElementById('community-mine');
  var list = document.getElementById('community-mine-list');
  var count = document.getElementById('community-mine-count');
  if (!panel) return;
  var rows = communityMvp.submissions;
  panel.hidden = !communitySignedIn() || !rows.length;
  var pending = rows.filter(function(row) { return row.item_status === 'pending'; }).length;
  if (count) count.textContent = String(pending);
  if (!list) return;
  list.innerHTML = rows.map(function(row) {
    var label = row.item_status === 'pending' ? 'Awaiting review' : (row.item_status === 'approved' ? 'Live' : 'Not approved');
    var kind = row.item_kind === 'comment' ? 'comment' : 'post';
    return '<article class="community-review-card"><div class="community-review-meta">' + (kind === 'post' ? 'Post' : 'Comment') + ' · ' + communityEsc(communityWhen(row.item_created_at)) +
      ' <span class="community-status-pill is-' + communityEsc(row.item_status) + '">' + label + '</span></div><p>' + communityRenderBody(row.item_body) + '</p>' +
      '<div class="community-review-actions"><button type="button" class="community-danger-btn" onclick="communityDeleteOwn(\'' + kind + '\',\'' + communityEsc(row.item_id) + '\')">Delete</button></div></article>';
  }).join('');
}
function communityToggleMine() {
  var list = document.getElementById('community-mine-list');
  if (list) list.hidden = !list.hidden;
}
async function communityDeleteOwn(kind, id) {
  if (!communityRequireSignIn()) return;
  var type = kind === 'comment' ? 'comment' : 'post';
  if (!window.confirm(type === 'post' ? 'Delete this post? This cannot be undone.' : 'Delete this comment? This cannot be undone.')) return;
  var result = await supabaseClient.rpc('community_delete_own', { p_kind: type, p_id: id });
  if (result.error || !result.data || !result.data.deleted) {
    console.error(result.error);
    communityToast('Could not delete that. Please try again.');
    return;
  }
  if (result.data.poster_image_url) communityDeletePosterFile(result.data.poster_image_url);
  communityMvp.expanded.delete(id);
  communityToast('Deleted.');
  await communityLoadMySubmissions();
  await communityLoadFeed();
  if (communityMvp.moderator) await communityLoadModerationQueue(false);
}
async function communitySharePost(postId) {
  var link = location.origin + location.pathname + '#tipchat';
  var post = communityMvp.posts.find(function(item) { return item.id === postId; });
  var text = post ? String(post.body).slice(0, 180) : 'Join TipChat on SA Recruiters — advice, conversations and vacancy posts in one place.';
  try {
    if (navigator.share) await navigator.share({ title: 'TipChat — SA Recruiters', text: text, url: link });
    else if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(link); communityToast('Community link copied.'); }
    else communityToast(link);
  } catch (error) {
    if (error && error.name !== 'AbortError') communityToast('Could not share the link.');
  }
}
async function communityToggleModeration() {
  var queue = document.getElementById('community-moderation-queue');
  if (!queue) return;
  queue.hidden = !queue.hidden;
  if (!queue.hidden) await communityLoadModerationQueue(true);
}
async function communityLoadModerationQueue(showLoading) {
  if (!communityMvp.moderator || !supabaseClient) return;
  var queue = document.getElementById('community-moderation-queue');
  var badge = document.getElementById('community-moderation-count');
  if (!queue) return;
  if (showLoading) queue.innerHTML = '<div class="community-comment-loading">Loading moderation queue…</div>';
  var postCols = 'id,group_id,author_label,body,status,post_type,vacancy_title,vacancy_location,vacancy_application,poster_image_url,created_at';
  var results = await Promise.all([
    supabaseClient.from('community_posts').select(postCols, { count: 'exact' }).eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
    supabaseClient.from('community_comments').select('id,post_id,author_label,body,status,created_at', { count: 'exact' }).eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
    supabaseClient.from('community_reports').select('id,post_id,comment_id,reason,details,status,created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: false }).limit(50),
    supabaseClient.rpc('community_admin_flags')
  ]);
  if (results[0].error && communityMissingPosterSchema(results[0].error)) {
    communityMvp.posterSchemaAvailable = false;
    results[0] = await supabaseClient.from('community_posts').select('id,group_id,author_label,body,status,post_type,vacancy_title,vacancy_location,vacancy_application,created_at', { count: 'exact' }).eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
    communitySetComposerType(communityComposerType);
  }
  if (results[0].error && communityMissingVacancySchema(results[0].error)) {
    communityMvp.vacancySchemaAvailable = false;
    results[0] = await supabaseClient.from('community_posts').select('id,group_id,author_label,body,status,created_at', { count: 'exact' }).eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
    communitySetComposerType(communityComposerType);
  }
  var error = results.slice(0, 3).find(function(result) { return result.error; });
  if (error) { console.error('[Community] moderation queue', error.error); queue.innerHTML = '<div class="community-comment-loading">Moderation queue could not be loaded.</div>'; return; }
  var pendingPosts = results[0].data || [];
  var pendingComments = results[1].data || [];
  var reports = results[2].data || [];
  var totalPosts = results[0].count != null ? results[0].count : pendingPosts.length;
  var totalComments = results[1].count != null ? results[1].count : pendingComments.length;
  var totalReports = results[2].count != null ? results[2].count : reports.length;
  var flags = new Map();
  if (!results[3].error) (results[3].data || []).forEach(function(row) { flags.set(row.flag_content_type + ':' + row.flag_content_id, row.flag_reasons || []); });
  if (badge) badge.textContent = String(totalPosts + totalComments + totalReports);
  var postIds = Array.from(new Set(reports.map(function(row) { return row.post_id; }).filter(Boolean)));
  var commentIds = Array.from(new Set(reports.map(function(row) { return row.comment_id; }).filter(Boolean)));
  var reportPosts = postIds.length ? await supabaseClient.from('community_posts').select('id,author_label,body,status').in('id', postIds) : { data: [] };
  var reportComments = commentIds.length ? await supabaseClient.from('community_comments').select('id,post_id,author_label,body,status').in('id', commentIds) : { data: [] };
  var postMap = new Map((reportPosts.data || []).map(function(row) { return [row.id, row]; }));
  var commentMap = new Map((reportComments.data || []).map(function(row) { return [row.id, row]; }));
  var pendingHtml = pendingPosts.map(function(row) { return communityModerationCard('post', row, 'pending', flags); }).join('') +
    pendingComments.map(function(row) { return communityModerationCard('comment', row, 'pending', flags); }).join('');
  var reportHtml = reports.map(function(report) {
    var type = report.post_id ? 'post' : 'comment';
    var target = report.post_id ? postMap.get(report.post_id) : commentMap.get(report.comment_id);
    return '<article class="community-review-card"><div class="community-review-meta">Reported ' + communityEsc(type) + ' · ' + communityEsc(report.reason) + '</div>' +
      '<p>' + communityEsc(report.details || 'No extra details supplied.') + '</p>' +
      (target ? '<blockquote>' + communityEsc(target.body) + '</blockquote>' : '<p>Content is no longer available.</p>') +
      '<div class="community-review-actions"><button type="button" onclick="communityReviewReported(\'' + communityEsc(report.id) + '\',\'' + type + '\',\'' + communityEsc(report.post_id || report.comment_id) + '\',\'hide\')">Hide content</button><button type="button" class="community-secondary-btn" onclick="communityDismissReport(\'' + communityEsc(report.id) + '\')">Dismiss report</button></div></article>';
  }).join('');
  function overflowNote(shown, total) {
    return total > shown ? '<p class="community-review-empty">Showing the oldest ' + shown + ' of ' + total + '. Clear these to load more.</p>' : '';
  }
  var waiting = totalPosts + totalComments;
  queue.innerHTML = '<section><h3>Waiting for approval <span>' + waiting + '</span></h3>' + (pendingHtml || '<p class="community-review-empty">Nothing is waiting for approval.</p>') + overflowNote(pendingPosts.length, totalPosts) + overflowNote(pendingComments.length, totalComments) + '</section>' +
    '<section><h3>Open reports <span>' + totalReports + '</span></h3>' + (reportHtml || '<p class="community-review-empty">No open reports.</p>') + overflowNote(reports.length, totalReports) + '</section>';
}
function communityModerationCard(type, row, status, flags) {
  var id = communityEsc(row.id);
  var reasons = flags && flags.get(type + ':' + row.id);
  var flagNote = reasons && reasons.length
    ? '<div class="community-flag-note">⚠ Automated flag: ' + communityEsc(reasons.map(function(reason) { return String(reason).replace(/_/g, ' '); }).join(', ')) + '</div>'
    : '';
  return '<article class="community-review-card"><div class="community-review-meta">' + (type === 'post' ? (row.post_type === 'vacancy' ? 'Vacancy' : 'Post') : 'Comment') + ' · ' + communityEsc(communityWhen(row.created_at)) + ' · ' + communityEsc(row.author_label) + '</div>' + flagNote + (type === 'post' ? communityVacancyMetaHtml(row) + communityPosterImageHtml(row) : '') + '<p>' + communityEsc(row.body) + '</p><div class="community-review-actions"><button type="button" onclick="communityModerate(\'' + type + '\',\'' + id + '\',\'approved\')">Approve</button><button type="button" class="community-danger-btn" onclick="communityModerate(\'' + type + '\',\'' + id + '\',\'hidden\')">Hide</button></div></article>';
}
async function communityModerate(type, id, status) {
  var table = type === 'comment' ? 'community_comments' : 'community_posts';
  var result = await supabaseClient.from(table).update({ status: status }).eq('id', id).select('id').maybeSingle();
  if (result.error || !result.data) { console.error(result.error); communityToast('Moderation action failed.'); return false; }
  communityToast(status === 'approved' ? 'Content approved.' : 'Content hidden.');
  await communityLoadModerationQueue(true);
  await communityLoadFeed();
  return true;
}
async function communityReviewReported(reportId, type, targetId, action) {
  var moderated = await communityModerate(type, targetId, action === 'hide' ? 'hidden' : 'approved');
  if (!moderated) return;
  var result = await supabaseClient.from('community_reports').update({ status: 'reviewed' }).eq('id', reportId);
  if (result.error) { console.error(result.error); communityToast('Content was moderated, but the report could not be closed.'); }
  await communityLoadModerationQueue(true);
}
async function communityDismissReport(reportId) {
  var result = await supabaseClient.from('community_reports').update({ status: 'dismissed' }).eq('id', reportId);
  if (result.error) { console.error(result.error); communityToast('Could not dismiss report.'); return; }
  communityToast('Report dismissed.');
  await communityLoadModerationQueue(true);
}

window.openCommunity = openCommunity;
window.goBackFromCommunity = goBackFromCommunity;
window.communityJoinGroup = communityJoinGroup;
window.communitySetSort = communitySetSort;
window.communitySubmitPost = communitySubmitPost;
window.communitySetComposerType = communitySetComposerType;
window.communityHandlePosterPhoto = communityHandlePosterPhoto;
window.communityRemovePoster = communityRemovePoster;
window.communityPromptParticipation = communityPromptParticipation;
window.communityToggleLike = communityToggleLike;
window.communityToggleReaction = communityToggleReaction;
window.communityToggleEmojiPicker = communityToggleEmojiPicker;
window.communityPickComposerEmoji = communityPickComposerEmoji;
window.communityToggleComments = communityToggleComments;
window.communitySubmitComment = communitySubmitComment;
window.communityOpenReport = communityOpenReport;
window.communityCloseReport = communityCloseReport;
window.communitySubmitReport = communitySubmitReport;
window.communitySharePost = communitySharePost;
window.communityToggleModeration = communityToggleModeration;
window.communityModerate = communityModerate;
window.communityReviewReported = communityReviewReported;
window.communityDismissReport = communityDismissReport;
window.communityLoad = communityLoad;
window.communitySetIdentityVisibility = communitySetIdentityVisibility;
window.communityDeleteOwn = communityDeleteOwn;
window.communityToggleMine = communityToggleMine;

(function initCommunityMvp() {
  communityInitEmojiPicker('community-post-emoji-picker', 'community-post-body');
  var reportOverlay = document.getElementById('community-report-overlay');
  if (reportOverlay) reportOverlay.addEventListener('click', function(event) {
    if (event.target === reportOverlay) communityCloseReport();
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') communityCloseReport();
  });
  // Keep unsent comment drafts across feed reloads.
  document.addEventListener('input', function(event) {
    var target = event.target;
    if (target && target.matches && target.matches('.community-comment-form textarea') && target.id) communityMvp.drafts[target.id] = target.value;
  });
  if (supabaseClient && supabaseClient.auth) {
    supabaseClient.auth.onAuthStateChange(function(authEvent, session) {
      // Token refreshes and repeated INITIAL_SESSION events must not reload the feed;
      // only an actual sign-in / sign-out / account switch should.
      var userId = session && session.user ? session.user.id : null;
      if (userId === communityMvp.lastUserId) return;
      communityMvp.lastUserId = userId;
      if (document.getElementById('screen-community') && document.getElementById('screen-community').classList.contains('active')) communityLoad();
    });
  }
  if (location.hash === '#community-interview-tips' || location.hash === '#tipchat') {
    window.setTimeout(function() { openCommunity(true); }, 700);
  }
})();
