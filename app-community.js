/* SA Recruiters Community MVP — Interview Tips */
var communityMvp = {
  group: null,
  joined: false,
  moderator: false,
  sort: 'new',
  posts: [],
  liked: new Set(),
  expanded: new Set(),
  loading: false,
  returnScreen: 'home',
  reportTarget: null
};

function communityEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
  });
}
function communityToast(message) {
  if (typeof showToast === 'function') showToast(message);
  else console.info('[Community]', message);
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
  document.querySelectorAll('.navbtn').forEach(function(button) { button.classList.remove('active'); });
  if (typeof resetActiveScreenScroll === 'function') resetActiveScreenScroll(screenId);
  else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}
function openCommunity(fromDeepLink) {
  var active = document.querySelector('.screen.active');
  if (active && active.id !== 'screen-community') communityMvp.returnScreen = active.id.replace(/^screen-/, '');
  if (!communityMvp.returnScreen) communityMvp.returnScreen = 'home';
  communitySetScreen('screen-community');
  if (!fromDeepLink && location.hash !== '#community-interview-tips') {
    history.replaceState(null, '', location.pathname + location.search + '#community-interview-tips');
  }
  communityLoad();
}
function goBackFromCommunity() {
  var screenName = communityMvp.returnScreen || 'home';
  var target = document.getElementById('screen-' + screenName) ? 'screen-' + screenName : 'screen-home';
  communitySetScreen(target);
  if (location.hash === '#community-interview-tips') history.replaceState(null, '', location.pathname + location.search);
}
function communityRenderGroup() {
  var group = communityMvp.group;
  var title = document.getElementById('community-group-title');
  var description = document.getElementById('community-group-description');
  var join = document.getElementById('community-join-btn');
  if (title) title.textContent = group ? group.title : 'Interview Tips';
  if (description) description.textContent = group ? group.description : 'Practical interview advice for job seekers in South Africa.';
  if (join) {
    join.textContent = communityMvp.joined ? 'Joined' : 'Join group';
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
      ? 'Sign in and join to share a tip or ask a question.'
      : (!communityMvp.joined ? 'Join this group before posting or commenting.' : 'Your post will be reviewed before it appears in the feed.');
  }
}
async function communityLoad() {
  var host = document.getElementById('community-feed');
  if (!host || communityMvp.loading || !supabaseClient) return;
  communityMvp.loading = true;
  host.innerHTML = '<div class="community-empty">Loading the Interview Tips community…</div>';
  try {
    var groupResult = await supabaseClient.from('community_groups')
      .select('id,slug,title,description,is_public')
      .eq('slug', 'interview-tips').eq('is_public', true).maybeSingle();
    if (groupResult.error) throw groupResult.error;
    if (!groupResult.data) throw new Error('The Interview Tips group is not available yet.');
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
  var query = supabaseClient.from('community_posts')
    .select('id,group_id,author_label,body,status,is_official,likes_count,comments_count,created_at')
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
  if (result.error) throw result.error;
  communityMvp.posts = result.data || [];
  communityMvp.liked = new Set();
  if (communitySignedIn() && communityMvp.posts.length) {
    var ids = communityMvp.posts.map(function(post) { return post.id; });
    var likedResult = await supabaseClient.from('community_post_reactions')
      .select('post_id').in('post_id', ids);
    if (!likedResult.error) communityMvp.liked = new Set((likedResult.data || []).map(function(row) { return row.post_id; }));
  }
  communityRenderFeed();
}
function communityRenderFeed() {
  var host = document.getElementById('community-feed');
  if (!host) return;
  if (!communityMvp.posts.length) {
    host.innerHTML = '<div class="community-empty"><strong>No posts yet</strong><span>Be the first to share a question or interview tip.</span></div>';
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
      '<div class="community-post-head"><div class="community-author-mark" aria-hidden="true">' + (post.is_official ? 'SA' : 'A') + '</div>' +
      '<div class="community-post-byline"><strong>' + communityEsc(post.author_label) + '</strong>' + official + '<span>' + communityEsc(communityWhen(post.created_at)) + '</span></div>' +
      '<button class="community-more" type="button" aria-label="Report post" title="Report post" onclick="communityOpenReport(\'post\',\'' + id + '\')">•••</button></div>' +
      '<div class="community-post-body">' + communityEsc(post.body) + '</div>' +
      '<div class="community-post-actions"><button type="button" class="community-action' + (liked ? ' is-liked' : '') + '" aria-pressed="' + (liked ? 'true' : 'false') + '" onclick="' + likeAction + '(\'' + id + '\')"><span aria-hidden="true">' + (liked ? '♥' : '♡') + '</span> ' + Number(post.likes_count || 0) + ' Like</button>' +
      '<button type="button" class="community-action" aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="' + commentAction + '(\'' + id + '\')">' + Number(post.comments_count || 0) + ' Comments</button>' +
      '<button type="button" class="community-action community-share-action" onclick="communitySharePost(\'' + id + '\')">Share</button></div>' +
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
    communityToast('You left Interview Tips.');
  } else {
    var join = await supabaseClient.from('community_memberships').insert({ group_id: communityMvp.group.id });
    if (join.error && join.error.code !== '23505') { console.error(join.error); communityToast('Could not join the group. Please try again.'); return; }
    communityMvp.joined = true;
    communityToast('You joined Interview Tips. Welcome!');
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
  if (!communityMvp.joined) communityToast('Join Interview Tips before posting, commenting or reacting.');
}
async function communitySubmitPost(event) {
  if (event) event.preventDefault();
  if (!communityRequireSignIn()) return false;
  if (!communityMvp.joined) { communityToast('Join Interview Tips before posting.'); return false; }
  if (!communityMvp.group) { communityStatus('Interview Tips is still loading. Please try again in a moment.', 'error'); return false; }
  var field = document.getElementById('community-post-body');
  var body = field ? field.value.trim() : '';
  if (body.length < 12 || body.length > 3000) { communityStatus('Write between 12 and 3,000 characters.', 'error'); return false; }
  var button = document.getElementById('community-post-submit');
  if (button) button.disabled = true;
  var result;
  try {
    result = await supabaseClient.from('community_posts').insert({ group_id: communityMvp.group.id, body: body });
  } catch (error) {
    result = { error: error };
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
    .select('id,post_id,author_label,body,status,created_at')
    .eq('post_id', postId).eq('status', 'approved')
    .order('created_at', { ascending: true }).limit(50);
  if (result.error) { console.error(result.error); panel.innerHTML = '<div class="community-comment-loading">Comments are unavailable right now.</div>'; return; }
  var comments = result.data || [];
  panel.innerHTML = '<div class="community-comment-list">' + (comments.length
    ? comments.map(function(comment) {
        var commentId = communityEsc(comment.id);
        return '<div class="community-comment"><div class="community-comment-head"><strong>' + communityEsc(comment.author_label) + '</strong><span>' + communityEsc(communityWhen(comment.created_at)) + '</span><button type="button" class="community-comment-report" aria-label="Report comment" onclick="communityOpenReport(\'comment\',\'' + commentId + '\')">Report</button></div><p>' + communityEsc(comment.body) + '</p></div>';
      }).join('')
    : '<div class="community-comment-loading">No approved comments yet.</div>') + '</div>' +
    (communityMvp.joined && communitySignedIn()
      ? '<form class="community-comment-form" onsubmit="return communitySubmitComment(event,\'' + communityEsc(postId) + '\')"><label class="sr-only" for="community-comment-input-' + communityEsc(postId) + '">Add a comment</label><textarea id="community-comment-input-' + communityEsc(postId) + '" maxlength="1500" placeholder="Add a helpful comment…" required></textarea><button type="submit">Send</button><small>Comments are pseudonymous and reviewed before they appear.</small></form>'
      : '<button type="button" class="community-secondary-btn" onclick="communityPromptParticipation()">Join to comment</button>');
}
async function communitySubmitComment(event, postId) {
  if (event) event.preventDefault();
  if (!communityRequireSignIn()) return false;
  if (!communityMvp.joined) { communityToast('Join Interview Tips before commenting.'); return false; }
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
  var link = location.origin + location.pathname + '#community-interview-tips';
  var post = communityMvp.posts.find(function(item) { return item.id === postId; });
  var text = post ? String(post.body).slice(0, 180) : 'Join the Interview Tips community on SA Recruiters.';
  try {
    if (navigator.share) await navigator.share({ title: 'Interview Tips — SA Recruiters', text: text, url: link });
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
  var results = await Promise.all([
    supabaseClient.from('community_posts').select('id,group_id,author_label,body,status,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
    supabaseClient.from('community_comments').select('id,post_id,author_label,body,status,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
    supabaseClient.from('community_reports').select('id,post_id,comment_id,reason,details,status,created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(50)
  ]);
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
  return '<article class="community-review-card"><div class="community-review-meta">' + (type === 'post' ? 'Post' : 'Comment') + ' · ' + communityEsc(communityWhen(row.created_at)) + ' · ' + communityEsc(row.author_label) + '</div><p>' + communityEsc(row.body) + '</p><div class="community-review-actions"><button type="button" onclick="communityModerate(\'' + type + '\',\'' + id + '\',\'approved\')">Approve</button><button type="button" class="community-danger-btn" onclick="communityModerate(\'' + type + '\',\'' + id + '\',\'hidden\')">Hide</button></div></article>';
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
window.communityPromptParticipation = communityPromptParticipation;
window.communityToggleLike = communityToggleLike;
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
  if (location.hash === '#community-interview-tips') {
    window.setTimeout(function() { openCommunity(true); }, 700);
  }
})();
