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
  authorIdentityAvailable: true
};
var communityComposerType = 'discussion';
var communityPosterBlob = null;

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
  processPosterPhoto(event, 'communityPosterBlob', 'community-poster-preview', 'community-poster-fallback');
}
function communityRemovePoster() {
  communityPosterBlob = null;
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
    return uploaded.href;
  } catch (error) {
    console.error('[TipChat] poster upload failed', error);
    communityStatus(error.message || 'Could not upload the poster. Your draft is still here.', 'error');
    return null;
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
  var group = communityMvp.group;
  var title = document.getElementById('community-group-title');
  var description = document.getElementById('community-group-description');
  var join = document.getElementById('community-join-btn');
  if (title) title.textContent = 'TipChat';
  if (description) description.textContent = 'A shared space for South African job seekers to swap advice and discover vacancies — by text or poster.';
  if (join) {
    join.textContent = communityMvp.joined ? 'Joined' : 'Join TipChat';
    join.classList.toggle('is-joined', communityMvp.joined);
    join.setAttribute('aria-pressed', communityMvp.joined ? 'true' : 'false');
  }
  var adminPanel = document.getElementById('community-moderator-panel');
  if (adminPanel) adminPanel.hidden = !communityMvp.moderator;
  var postButton = document.getElementById('community-post-submit');
  if (postButton) postButton.disabled = !communityMvp.joined || !communitySignedIn();
  var composerHint = document.getElementById('community-composer-hint');
  if (composerHint) {
    composerHint.textContent = !communitySignedIn()
      ? 'Sign in and join TipChat to share a post.'
      : (!communityMvp.joined ? 'Join TipChat before posting or commenting.' : 'Posts are reviewed before they appear in the feed.');
  }
  communitySetComposerType(communityComposerType);
}
async function communityLoad() {
  var host = document.getElementById('community-feed');
  if (!host || communityMvp.loading || !supabaseClient) return;
  communityMvp.loading = true;
  host.innerHTML = '<div class="community-empty">Loading TipChat…</div>';
  try {
    var groupResult = await supabaseClient.from('community_groups')
      .select('id,slug,title,description,is_public')
      .eq('slug', 'interview-tips').eq('is_public', true).maybeSingle();
    if (groupResult.error) throw groupResult.error;
    if (!groupResult.data) throw new Error('TipChat is not available yet.');
    communityMvp.group = groupResult.data;
    communityMvp.joined = false;
    communityMvp.moderator = false;
    if (communitySignedIn()) {
      var membership = await supabaseClient.from('community_memberships')
        .select('group_id').eq('group_id', communityMvp.group.id).limit(1).maybeSingle();
      if (!membership.error) communityMvp.joined = !!membership.data;
      var adminResult = await supabaseClient.rpc('is_admin');
      communityMvp.moderator = !adminResult.error && adminResult.data === true;
    }
    communityRenderGroup();
    await communityLoadFeed();
    if (communityMvp.moderator) await communityLoadModerationQueue(false);
  } catch (error) {
    console.error('[Community] load failed', error);
    host.innerHTML = '<div class="community-empty"><strong>Community unavailable</strong><span>Check your connection and try again.</span><button type="button" class="community-secondary-btn" onclick="communityLoad()">Retry</button></div>';
    communityStatus('Could not load the community. Please try again.', 'error');
  } finally {
    communityMvp.loading = false;
  }
}
async function communityLoadFeed() {
  var host = document.getElementById('community-feed');
  if (!host || !communityMvp.group) return;
  host.innerHTML = '<div class="community-empty">Loading posts…</div>';
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
    var liked = communityMvp.liked.has(post.id);
    var joined = communityMvp.joined && communitySignedIn();
    var likeAction = joined ? 'communityToggleLike' : 'communityPromptParticipation';
    var commentAction = joined ? 'communityToggleComments' : 'communityPromptParticipation';
    var expanded = communityMvp.expanded.has(post.id);
    return '<article class="community-post" data-post-id="' + id + '">' +
      '<div class="community-post-head">' + communityAuthorAvatarHtml(post.author_label, post.author_photo_url, post.is_official, false) +
      '<div class="community-post-byline"><strong>' + communityEsc(post.author_label) + '</strong>' + official + '<span>' + communityEsc(communityWhen(post.created_at)) + '</span></div>' +
      '<button class="community-more" type="button" aria-label="Report post" title="Report post" onclick="communityOpenReport(\'post\',\'' + id + '\')">•••</button></div>' +
      communityVacancyMetaHtml(post) +
      (post.body ? '<div class="community-post-body">' + communityRenderBody(post.body) + '</div>' : '') +
      communityPosterImageHtml(post) +
      '<div class="community-post-actions"><button type="button" class="community-action' + (liked ? ' is-liked' : '') + '" aria-pressed="' + (liked ? 'true' : 'false') + '" onclick="' + likeAction + '(\'' + id + '\')"><span aria-hidden="true">' + (liked ? '♥' : '♡') + '</span> ' + Number(post.likes_count || 0) + ' Like</button>' +
      '<button type="button" class="community-action" aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="' + commentAction + '(\'' + id + '\')">' + Number(post.comments_count || 0) + ' Comments</button>' +
      '<button type="button" class="community-action community-reaction-toggle" aria-expanded="false" onclick="communityToggleEmojiPicker(\'community-reaction-picker-' + id + '\',\'post:' + id + '\')">' + (communityMvp.reactions.has(post.id) ? '<img src="' + communityEmojiUrl(communityMvp.reactions.get(post.id)) + '" alt="" class="community-action-emoji"> Reacted' : 'React') + '</button>' +
      '<button type="button" class="community-action community-share-action" onclick="communitySharePost(\'' + id + '\')">Share</button></div>' +
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
  if (!body && isVacancy && communityPosterBlob) body = vacancy.title ? 'Vacancy poster: ' + vacancy.title : 'Vacancy poster attached — see the image for details.';
  if (body.length < 12 || body.length > 3000) { communityStatus('Write at least 12 characters, or attach a vacancy poster.', 'error'); return false; }
  if (isVacancy && !communityMvp.vacancySchemaAvailable) { communityToast('Vacancy posting is being enabled. Please try again shortly.'); return false; }
  if (isVacancy && communityPosterBlob && !communityMvp.posterSchemaAvailable) { communityToast('Poster posts are being enabled. You can still share this vacancy as text.'); return false; }
  if (isVacancy && vacancy.title.length > 140) { communityStatus('Keep the vacancy title under 140 characters.', 'error'); return false; }
  if (isVacancy && vacancy.application.length > 300) { communityStatus('Keep the application contact under 300 characters.', 'error'); return false; }
  var button = document.getElementById('community-post-submit');
  if (button) button.disabled = true;
  var result;
  var posterImageUrl = null;
  try {
    if (isVacancy && communityPosterBlob) {
      communityStatus('Uploading your poster…', '');
      posterImageUrl = await communityUploadPoster(vacancy.title || 'TipChat vacancy poster');
      if (!posterImageUrl) { if (button) button.disabled = false; return false; }
    }
    result = communityMvp.vacancySchemaAvailable
      ? await supabaseClient.from('community_posts').insert({
          group_id: communityMvp.group.id,
          body: body,
          post_type: isVacancy ? 'vacancy' : 'discussion',
          vacancy_title: isVacancy ? (vacancy.title || null) : null,
          vacancy_location: isVacancy ? (vacancy.location || null) : null,
          vacancy_application: isVacancy ? (vacancy.application || null) : null,
          poster_image_url: posterImageUrl
        })
      : await supabaseClient.from('community_posts').insert({ group_id: communityMvp.group.id, body: body });
  } catch (error) {
    result = { error: error };
  }
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
    var errorMessage = errorCode === '401' || errorCode === 'PGRST301'
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
  communityStatus('Thanks — your post is awaiting moderator review. Your account is not shown publicly.', 'success');
  communityRenderGroup();
  communityLoadModerationQueue(false);
  return false;
}
function communityToggleLike(postId) {
  if (!communityRequireSignIn()) return;
  if (!communityMvp.joined) { communityPromptParticipation(); return; }
  var alreadyLiked = communityMvp.liked.has(postId);
  var request = alreadyLiked
    ? supabaseClient.from('community_post_reactions').delete().eq('post_id', postId)
    : supabaseClient.from('community_post_reactions').insert({ post_id: postId, reaction_type: 'like' });
  request.then(function(result) {
    if (result.error && result.error.code !== '23505') { console.error(result.error); communityToast('Reaction could not be saved.'); return; }
    if (alreadyLiked) communityMvp.liked.delete(postId); else communityMvp.liked.add(postId);
    communityLoadFeed().catch(function(error) { console.error(error); });
  });
}
async function communityToggleReaction(postId, reactionType) {
  if (!communityRequireSignIn()) return;
  if (!communityMvp.joined) { communityPromptParticipation(); return; }
  var current = communityMvp.reactions.get(postId) || (communityMvp.liked.has(postId) ? 'like' : null), result;
  if (current === reactionType) {
    result = await supabaseClient.from('community_post_reactions').delete().eq('post_id', postId);
    if (!result.error) { communityMvp.reactions.delete(postId); communityMvp.liked.delete(postId); }
  } else {
    if (current) await supabaseClient.from('community_post_reactions').delete().eq('post_id', postId);
    result = await supabaseClient.from('community_post_reactions').insert({ post_id: postId, reaction_type: reactionType });
    if (!result.error) { communityMvp.liked.delete(postId); if (reactionType === 'like') communityMvp.liked.add(postId); else communityMvp.reactions.set(postId, reactionType); }
  }
  if (result && result.error && result.error.code !== '23505') { console.error(result.error); communityToast('Reaction could not be saved.'); return; }
  communityRenderFeed();
}
async function communityToggleComments(postId) {
  if (!communityRequireSignIn()) return;
  if (!communityMvp.joined) { communityPromptParticipation(); return; }
  if (communityMvp.expanded.has(postId)) {
    communityMvp.expanded.delete(postId);
    var panel = document.getElementById('community-comments-' + postId);
    if (panel) panel.hidden = true;
    communityRenderFeed();
    return;
  }
  communityMvp.expanded.add(postId);
  communityRenderFeed();
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
  panel.innerHTML = '<div class="community-comment-list">' + (comments.length
    ? comments.map(function(comment) {
        var commentId = communityEsc(comment.id);
        return '<div class="community-comment"><div class="community-comment-head">' + communityAuthorAvatarHtml(comment.author_label, comment.author_photo_url, false, true) + '<strong>' + communityEsc(comment.author_label) + '</strong><span>' + communityEsc(communityWhen(comment.created_at)) + '</span><button type="button" class="community-comment-report" aria-label="Report comment" onclick="communityOpenReport(\'comment\',\'' + commentId + '\')">Report</button></div><p>' + communityEsc(comment.body) + '</p></div>';
      }).join('')
    : '<div class="community-comment-loading">No approved comments yet.</div>') + '</div>' +
    (communityMvp.joined && communitySignedIn()
      ? '<form class="community-comment-form" onsubmit="return communitySubmitComment(event,\'' + communityEsc(postId) + '\')"><label class="sr-only" for="community-comment-input-' + communityEsc(postId) + '">Add a comment</label><textarea id="community-comment-input-' + communityEsc(postId) + '" maxlength="1500" placeholder="Add a helpful comment…" required></textarea><button type="submit">Send</button><small>Comments are reviewed before they appear.</small></form>'
      : '<button type="button" class="community-secondary-btn" onclick="communityPromptParticipation()">Join to comment</button>');
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
  if (result.error) { console.error(result.error); communityToast('Comment could not be sent. Please try again.'); return false; }
  if (field) field.value = '';
  communityToast('Comment submitted for moderator review.');
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
    else { console.error(result.error); communityToast('Report could not be sent. Please try again.'); }
    return false;
  }
  communityCloseReport();
  communityToast('Report sent to the moderation team.');
  communityLoadModerationQueue(false);
  return false;
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
  var postQueueQuery = supabaseClient.from('community_posts').select('id,group_id,author_label,body,status,post_type,vacancy_title,vacancy_location,vacancy_application,poster_image_url,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
  var results = await Promise.all([
    postQueueQuery,
    supabaseClient.from('community_comments').select('id,post_id,author_label,body,status,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
    supabaseClient.from('community_reports').select('id,post_id,comment_id,reason,details,status,created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(50)
  ]);
  if (results[0].error && communityMissingPosterSchema(results[0].error)) {
    communityMvp.posterSchemaAvailable = false;
    results[0] = await supabaseClient.from('community_posts').select('id,group_id,author_label,body,status,post_type,vacancy_title,vacancy_location,vacancy_application,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
    communitySetComposerType(communityComposerType);
  }
  if (results[0].error && communityMissingVacancySchema(results[0].error)) {
    communityMvp.vacancySchemaAvailable = false;
    results[0] = await supabaseClient.from('community_posts').select('id,group_id,author_label,body,status,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
    communitySetComposerType(communityComposerType);
  }
  var error = results.find(function(result) { return result.error; });
  if (error) { console.error('[Community] moderation queue', error.error); queue.innerHTML = '<div class="community-comment-loading">Moderation queue could not be loaded.</div>'; return; }
  var pendingPosts = results[0].data || [];
  var pendingComments = results[1].data || [];
  var reports = results[2].data || [];
  if (badge) badge.textContent = String(pendingPosts.length + pendingComments.length + reports.length);
  var postIds = Array.from(new Set(reports.map(function(row) { return row.post_id; }).filter(Boolean)));
  var commentIds = Array.from(new Set(reports.map(function(row) { return row.comment_id; }).filter(Boolean)));
  var reportPosts = postIds.length ? await supabaseClient.from('community_posts').select('id,author_label,body,status').in('id', postIds) : { data: [] };
  var reportComments = commentIds.length ? await supabaseClient.from('community_comments').select('id,post_id,author_label,body,status').in('id', commentIds) : { data: [] };
  var postMap = new Map((reportPosts.data || []).map(function(row) { return [row.id, row]; }));
  var commentMap = new Map((reportComments.data || []).map(function(row) { return [row.id, row]; }));
  var pendingHtml = pendingPosts.map(function(row) { return communityModerationCard('post', row, 'pending'); }).join('') +
    pendingComments.map(function(row) { return communityModerationCard('comment', row, 'pending'); }).join('');
  var reportHtml = reports.map(function(report) {
    var type = report.post_id ? 'post' : 'comment';
    var target = report.post_id ? postMap.get(report.post_id) : commentMap.get(report.comment_id);
    return '<article class="community-review-card"><div class="community-review-meta">Reported ' + communityEsc(type) + ' · ' + communityEsc(report.reason) + '</div>' +
      '<p>' + communityEsc(report.details || 'No extra details supplied.') + '</p>' +
      (target ? '<blockquote>' + communityEsc(target.body) + '</blockquote>' : '<p>Content is no longer available.</p>') +
      '<div class="community-review-actions"><button type="button" onclick="communityReviewReported(\'' + communityEsc(report.id) + '\',\'' + type + '\',\'' + communityEsc(report.post_id || report.comment_id) + '\',\'hide\')">Hide content</button><button type="button" class="community-secondary-btn" onclick="communityDismissReport(\'' + communityEsc(report.id) + '\')">Dismiss report</button></div></article>';
  }).join('');
  queue.innerHTML = '<section><h3>Waiting for approval <span>' + (pendingPosts.length + pendingComments.length) + '</span></h3>' + (pendingHtml || '<p class="community-review-empty">Nothing is waiting for approval.</p>') + '</section>' +
    '<section><h3>Open reports <span>' + reports.length + '</span></h3>' + (reportHtml || '<p class="community-review-empty">No open reports.</p>') + '</section>';
}
function communityModerationCard(type, row, status) {
  var id = communityEsc(row.id);
  return '<article class="community-review-card"><div class="community-review-meta">' + (type === 'post' ? (row.post_type === 'vacancy' ? 'Vacancy' : 'Post') : 'Comment') + ' · ' + communityEsc(communityWhen(row.created_at)) + ' · ' + communityEsc(row.author_label) + '</div>' + (type === 'post' ? communityVacancyMetaHtml(row) + communityPosterImageHtml(row) : '') + '<p>' + communityEsc(row.body) + '</p><div class="community-review-actions"><button type="button" onclick="communityModerate(\'' + type + '\',\'' + id + '\',\'approved\')">Approve</button><button type="button" class="community-danger-btn" onclick="communityModerate(\'' + type + '\',\'' + id + '\',\'hidden\')">Hide</button></div></article>';
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

(function initCommunityMvp() {
  communityInitEmojiPicker('community-post-emoji-picker', 'community-post-body');
  var reportOverlay = document.getElementById('community-report-overlay');
  if (reportOverlay) reportOverlay.addEventListener('click', function(event) {
    if (event.target === reportOverlay) communityCloseReport();
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') communityCloseReport();
  });
  if (supabaseClient && supabaseClient.auth) {
    supabaseClient.auth.onAuthStateChange(function() {
      if (document.getElementById('screen-community') && document.getElementById('screen-community').classList.contains('active')) communityLoad();
    });
  }
  if (location.hash === '#community-interview-tips' || location.hash === '#tipchat') {
    window.setTimeout(function() { openCommunity(true); }, 700);
  }
})();
