/* YouTube app for iOS 12 Safari. ES5 only. Talks to scripts/server.py on the Mac. */
(function () {
  "use strict";

  var byId = YT.byId;
  var addClass = YT.addClass;
  var removeClass = YT.removeClass;
  var hasClass = YT.hasClass;
  var show = YT.show;
  var el = YT.el;

  var CHIPS = ["All", "Music", "Songs", "News", "Live", "Movies", "Comedy", "Cooking", "Gaming"];
  var MAX_HISTORY = 50;
  var MAX_AUTOSKIP = 3;

  var settings = YT.load("ytSettings", null) || {};
  if (settings.hd === undefined) {
    settings.hd = true;
  }
  if (settings.autoplay === undefined) {
    settings.autoplay = true;
  }
  if (!settings.topic) {
    settings.topic = "Tamil";
  }

  var auth = { configured: false, profile: YT.load("ytProfile", null) };
  var currentTab = "home";
  var currentChip = "All";
  var listStack = [];
  var listLoader = null;

  // Watch page state.
  var queue = [];
  var lastList = [];
  var currentItem = null;
  var currentInfo = null;
  var currentQuality = "hd";
  var rating = "none";
  var subscribed = false;
  var failCount = 0;
  var pendingSeek = 0;
  var lastSaved = 0;
  var prefetched = "";
  var commentsNext = "";
  var reloadWhenIdle = false;

  // Shorts state.
  var shorts = [];
  var shortIndex = 0;
  var shortsLoadedFor = "";
  var shortRated = {};

  function signedIn() {
    return YT.hasSession() && !!auth.profile;
  }

  function saveSettings() {
    YT.store("ytSettings", settings);
  }

  function setStatus(text, isError) {
    var node = byId("status");
    node.textContent = text || "";
    node.className = isError ? "yt-status error" : "yt-status";
  }

  var toastTimer = null;
  function toast(text) {
    var node = byId("toast");
    node.textContent = text;
    show(node, true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      show(node, false);
    }, 2600);
  }

  // ---- local lists: history, watch later, resume positions --------------

  function readList(key) {
    var list = YT.load(key, []);
    return list && list.length !== undefined ? list : [];
  }

  function slim(item) {
    return {
      id: item.id,
      title: item.title || "Video",
      author: item.author || "",
      channelId: item.channelId || "",
      views: item.views || 0,
      duration: item.duration || 0,
    };
  }

  function pushUnique(key, item, max) {
    var list = readList(key);
    var next = [slim(item)];
    var i;
    for (i = 0; i < list.length && next.length < max; i++) {
      if (list[i] && list[i].id !== item.id) {
        next.push(list[i]);
      }
    }
    YT.store(key, next);
  }

  function removeFrom(key, id) {
    var list = readList(key);
    var next = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id !== id) {
        next.push(list[i]);
      }
    }
    YT.store(key, next);
  }

  function inList(key, id) {
    var list = readList(key);
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        return true;
      }
    }
    return false;
  }

  var positions = YT.load("ytPos", {}) || {};
  function savePosition(id, t, d) {
    if (!id) {
      return;
    }
    if (!t || (d && t > d - 15)) {
      delete positions[id];
    } else {
      positions[id] = { t: Math.floor(t), d: Math.floor(d || 0), at: Date.now() };
    }
    var ids = [];
    var key;
    for (key in positions) {
      if (positions.hasOwnProperty(key)) {
        ids.push(key);
      }
    }
    if (ids.length > 200) {
      ids.sort(function (a, b) {
        return positions[a].at - positions[b].at;
      });
      delete positions[ids[0]];
    }
    YT.store("ytPos", positions);
  }

  // ---- cards ---------------------------------------------------------------

  function cardNode(item, index, kind, list, context) {
    var card = el("div", kind === "compact" ? "yt-compact" : kind === "shelf" ? "yt-shelf-card" : "yt-card");
    var thumb = el("div", kind === "compact" ? "yt-compact-thumb" : "yt-thumb");
    var img = el("img");
    img.alt = "";
    img.src = YT.thumbUrl(item.id);
    thumb.appendChild(img);
    if (item.live) {
      thumb.appendChild(el("div", "yt-dur yt-live", "LIVE"));
    } else if (YT.formatDuration(item.duration)) {
      thumb.appendChild(el("div", "yt-dur", YT.formatDuration(item.duration)));
    }
    var pos = positions[item.id];
    var total = (pos && pos.d) || item.duration;
    if (pos && total) {
      var bar = el("div", "yt-progress");
      var fill = el("div");
      fill.style.width = Math.min(100, Math.round((pos.t / total) * 100)) + "%";
      bar.appendChild(fill);
      thumb.appendChild(bar);
    }
    card.appendChild(thumb);

    var row = el("div", kind === "grid" ? "yt-card-row" : "yt-card-row yt-card-row-plain");
    if (kind === "grid") {
      var avatar = el("div", "yt-avatar");
      YT.avatarInto(avatar, item.author, item.avatar, index);
      row.appendChild(avatar);
    }
    var text = el("div", "yt-card-text");
    text.appendChild(el("div", kind === "grid" ? "yt-card-title" : "yt-compact-title", item.title || "Video"));
    text.appendChild(
      el(
        "div",
        "yt-card-sub",
        YT.joinBits([item.author, YT.formatViews(item.views), YT.timeAgo(item.published)])
      )
    );
    row.appendChild(text);
    var more = el("button", "yt-more");
    more.type = "button";
    more.setAttribute("aria-label", "More");
    more.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
    more.addEventListener("click", function (event) {
      event.stopPropagation();
      openItemMenu(item, context);
    });
    row.appendChild(more);
    card.appendChild(row);

    card.setAttribute("role", "button");
    card.addEventListener("click", function () {
      playFromList(item, list);
    });
    return card;
  }

  function renderCards(target, items, kind, emptyText, context) {
    target.innerHTML = "";
    if (!items || !items.length) {
      if (emptyText) {
        target.appendChild(el("p", "yt-empty-line", emptyText));
      }
      return;
    }
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i] && items[i].id) {
        target.appendChild(cardNode(items[i], i, kind, items, context));
      }
    }
  }

  // ---- views and navigation -------------------------------------------

  var VIEWS = ["view-home", "view-subs", "view-shorts", "view-you", "view-list"];

  function showView(id) {
    var i;
    for (i = 0; i < VIEWS.length; i++) {
      show(VIEWS[i], VIEWS[i] === id);
    }
    toggleShortsMode(id === "view-shorts");
    window.scrollTo(0, 0);
  }

  function markTab(name) {
    var tabs = document.querySelectorAll(".yt-tabs button");
    var i;
    for (i = 0; i < tabs.length; i++) {
      YT.toggleClass(tabs[i], "is-on", tabs[i].getAttribute("data-tab") === name);
    }
  }

  function leaveWatch() {
    if (hasClass(document.body, "watching") && !hasClass(document.body, "mini")) {
      shrinkToMini();
    }
  }

  function setTab(name, refresh) {
    currentTab = name;
    listStack = [];
    listLoader = null;
    closeSearch();
    leaveWatch();
    markTab(name);
    setStatus("", false);
    if (name !== "shorts") {
      byId("shorts-player").pause();
    }
    if (name === "home") {
      showView("view-home");
      if (refresh || !byId("home-feed").childNodes.length) {
        loadHome();
      }
    } else if (name === "shorts") {
      byId("player").pause();
      showView("view-shorts");
      loadShorts();
    } else if (name === "subs") {
      showView("view-subs");
      loadSubs();
    } else {
      showView("view-you");
      paintYou();
    }
  }

  function openList(title, loader) {
    closeSearch();
    leaveWatch();
    if (listLoader) {
      listStack.push({ title: byId("list-title").textContent, loader: listLoader });
    }
    runList(title, loader);
  }

  function runList(title, loader) {
    listLoader = loader;
    byId("shorts-player").pause();
    showView("view-list");
    byId("list-title").textContent = title;
    byId("list-header").innerHTML = "";
    byId("list-feed").innerHTML = "";
    setStatus("Loading…", false);
    var isLatest = YT.latest("list");
    loader(function (items, emptyText, header) {
      if (!isLatest()) {
        return;
      }
      setStatus("", false);
      byId("list-header").innerHTML = "";
      if (header) {
        byId("list-header").appendChild(header);
      }
      renderCards(byId("list-feed"), items, "grid", emptyText || "Nothing here yet.", title);
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    });
  }

  function listBack() {
    var prev = listStack.pop();
    if (prev) {
      runList(prev.title, prev.loader);
    } else {
      listLoader = null;
      setTab(currentTab);
    }
  }

  // ---- Home ------------------------------------------------------------

  function chipQuery(chip) {
    var topic = YT.trim(settings.topic);
    return topic ? topic + " " + chip.toLowerCase() : chip.toLowerCase();
  }

  function paintChips() {
    var box = byId("chips");
    box.innerHTML = "";
    var i;
    for (i = 0; i < CHIPS.length; i++) {
      (function (chip) {
        var b = el("button", chip === currentChip ? "yt-chip is-on" : "yt-chip", chip);
        b.type = "button";
        b.addEventListener("click", function () {
          currentChip = chip;
          paintChips();
          loadHome();
        });
        box.appendChild(b);
      })(CHIPS[i]);
    }
  }

  function interleave(a, b) {
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] && !seen[a[i].id]) {
        seen[a[i].id] = true;
        out.push(a[i]);
      }
      if (b[i] && !seen[b[i].id]) {
        seen[b[i].id] = true;
        out.push(b[i]);
      }
    }
    return out;
  }

  function loadHome() {
    var isLatest = YT.latest("home");
    var feed = byId("home-feed");
    feed.innerHTML = "";
    setStatus("Loading…", false);
    var main = currentChip === "All" ? chipQuery("songs") : chipQuery(currentChip);
    if (currentChip === "Live") {
      main = chipQuery("live");
    }
    function paint(items) {
      if (!isLatest()) {
        return;
      }
      setStatus("", false);
      renderCards(feed, items, "grid", "No videos found.", "Home");
    }
    function fail(err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    }
    YT.get("/api/search" + YT.q({ q: main }), function (data) {
      var results = data.results || [];
      // "All" mixes in videos like the one you watched last, like the app's recommendations.
      var history = readList("ytHistory");
      if (currentChip !== "All" || !history.length) {
        paint(results);
        return;
      }
      var seed = (history[0].title || "").split("|")[0];
      YT.get(
        "/api/related" + YT.q({ id: history[0].id, q: seed }),
        function (more) {
          paint(interleave(results, more.results || []));
        },
        function () {
          paint(results);
        }
      );
    }, fail);
  }

  // ---- Subscriptions ---------------------------------------------------

  function loadSubs() {
    var signed = signedIn();
    show("subs-out", !signed);
    var strip = byId("subs-channels");
    var feed = byId("subs-feed");
    if (!signed) {
      strip.innerHTML = "";
      feed.innerHTML = "";
      return;
    }
    var isLatest = YT.latest("subs");
    if (!feed.childNodes.length) {
      setStatus("Loading your subscriptions…", false);
    }
    YT.get("/api/me/feed", function (data) {
      if (!isLatest()) {
        return;
      }
      setStatus("", false);
      strip.innerHTML = "";
      var channels = data.channels || [];
      var i;
      for (i = 0; i < channels.length; i++) {
        (function (ch, index) {
          var b = el("button", "yt-strip-item");
          b.type = "button";
          var av = el("span", "yt-avatar yt-avatar-lg");
          YT.avatarInto(av, ch.title, ch.avatar, index);
          b.appendChild(av);
          b.appendChild(el("span", "yt-strip-name", ch.title));
          b.addEventListener("click", function () {
            openChannel(ch.channelId, ch.title);
          });
          strip.appendChild(b);
        })(channels[i], i);
      }
      renderCards(feed, data.videos || [], "grid", "No new videos from your subscriptions.", "Subscriptions");
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
      if (!signedIn()) {
        loadSubs();
      }
    });
  }

  // ---- You -------------------------------------------------------------

  function paintAccount() {
    var profile = signedIn() ? auth.profile : null;
    var head = byId("header-you");
    if (profile) {
      YT.avatarInto(head, profile.name, profile.avatar, 1);
    } else {
      head.style.background = "";
      head.innerHTML =
        '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 14a8 8 0 0 1-6.2-3c.1-2 4.1-3.1 6.2-3.1s6.1 1.1 6.2 3.1A8 8 0 0 1 12 20z"/></svg>';
    }
    show("you-out", !profile);
    show("you-in", !!profile);
    if (profile) {
      byId("you-name").textContent = profile.name;
      YT.avatarInto(byId("you-avatar"), profile.name, profile.avatar, 1);
      YT.avatarInto(byId("comment-me"), profile.name, profile.avatar, 1);
    }
    var needs = document.querySelectorAll(".yt-needs-sign");
    var i;
    for (i = 0; i < needs.length; i++) {
      show(needs[i], !!profile);
    }
  }

  function paintYou() {
    paintAccount();
    var history = readList("ytHistory");
    var shelf = byId("you-history");
    shelf.innerHTML = "";
    if (!history.length) {
      shelf.appendChild(el("p", "yt-empty-line", "Videos you watch will show up here."));
    } else {
      var i;
      for (i = 0; i < history.length && i < 12; i++) {
        shelf.appendChild(cardNode(history[i], i, "shelf", history, "History"));
      }
    }
    byId("set-hd").checked = !!settings.hd;
    byId("set-autoplay").checked = !!settings.autoplay;
    byId("set-topic").value = settings.topic;

    var wrap = byId("you-playlists-wrap");
    var box = byId("you-playlists");
    if (!signedIn()) {
      show(wrap, false);
      return;
    }
    var isLatest = YT.latest("playlists");
    YT.get("/api/me/playlists", function (data) {
      if (!isLatest()) {
        return;
      }
      box.innerHTML = "";
      var lists = data.playlists || [];
      show(wrap, lists.length > 0);
      var j;
      for (j = 0; j < lists.length; j++) {
        (function (pl) {
          var b = el("button");
          b.type = "button";
          var img = el("img", "yt-menu-thumb");
          img.alt = "";
          if (pl.thumb) {
            img.src = pl.thumb;
          }
          b.appendChild(img);
          b.appendChild(el("span", "", pl.title));
          b.appendChild(el("small", "", pl.count + " videos"));
          b.addEventListener("click", function () {
            openPlaylist(pl.id, pl.title);
          });
          box.appendChild(b);
        })(lists[j]);
      }
    }, function () {});
  }

  function openNamed(name) {
    if (name === "history") {
      openList("History", function (ok) {
        ok(readList("ytHistory"), "Videos you watch will show up here.");
      });
    } else if (name === "watch-later") {
      openList("Watch later", function (ok) {
        ok(readList("ytLater"), "Tap Save on a video to watch it later.");
      });
    } else if (name === "liked") {
      openList("Liked videos", function (ok, fail) {
        YT.get("/api/me/liked", function (data) {
          ok(data.results || [], "Videos you like will show up here.");
        }, fail);
      });
    }
  }

  function openPlaylist(id, title) {
    openList(title || "Playlist", function (ok, fail) {
      YT.get("/api/playlist" + YT.q({ id: id }), function (data) {
        ok(data.videos || [], "This playlist is empty.");
      }, fail);
    });
  }

  function subscribeButton(channelId) {
    var b = el("button", "yt-sub", "Subscribe");
    b.type = "button";
    function paint(on) {
      b.textContent = on ? "Subscribed" : "Subscribe";
      YT.toggleClass(b, "is-on", on);
    }
    var on = false;
    if (signedIn()) {
      YT.get("/api/me/state" + YT.q({ channel: channelId }), function (data) {
        on = !!data.subscribed;
        paint(on);
      }, function () {});
    }
    b.addEventListener("click", function () {
      toggleSubscribe(channelId, !on, function (now) {
        on = now;
        paint(on);
      });
    });
    return b;
  }

  function openChannel(channelId, name) {
    if (!channelId) {
      toast("Channel not available");
      return;
    }
    openList(name || "Channel", function (ok, fail) {
      YT.get("/api/channel" + YT.q({ id: channelId }), function (data) {
        var head = el("div", "yt-channel-head");
        var av = el("div", "yt-avatar yt-avatar-xl");
        YT.avatarInto(av, data.title, data.avatar, 0);
        head.appendChild(av);
        var text = el("div", "yt-channel-head-text");
        text.appendChild(el("h2", "", data.title || name));
        text.appendChild(el("p", "", data.followers ? YT.shortCount(data.followers) + " subscribers" : ""));
        head.appendChild(text);
        head.appendChild(subscribeButton(channelId));
        ok(data.videos || [], "This channel has no videos.", head);
      }, fail);
    });
  }

  // ---- search ----------------------------------------------------------

  var suggestTimer = null;

  function openSearch() {
    leaveWatch();
    show("brand", false);
    show("search-open", false);
    show("header-you", false);
    show("search-form", true);
    var input = byId("q");
    input.value = "";
    show("search-clear", false);
    paintSuggestions([], true);
    input.focus();
  }

  function closeSearch() {
    show("brand", true);
    show("search-open", true);
    show("header-you", true);
    show("search-form", false);
    show("suggest", false);
    byId("q").blur();
  }

  function paintSuggestions(items, recent) {
    var box = byId("suggest");
    box.innerHTML = "";
    if (recent) {
      items = YT.load("ytSearches", []) || [];
    }
    var i;
    for (i = 0; i < items.length; i++) {
      (function (text) {
        var b = el("button", recent ? "yt-suggest-item is-recent" : "yt-suggest-item");
        b.type = "button";
        b.appendChild(el("span", "", text));
        b.addEventListener("click", function () {
          byId("q").value = text;
          runSearch(text);
        });
        box.appendChild(b);
      })(items[i]);
    }
    show(box, items.length > 0);
  }

  function onSearchInput() {
    var value = YT.trim(byId("q").value);
    show("search-clear", !!value);
    clearTimeout(suggestTimer);
    if (!value) {
      paintSuggestions([], true);
      return;
    }
    suggestTimer = setTimeout(function () {
      var isLatest = YT.latest("suggest");
      YT.get("/api/suggest" + YT.q({ q: value }), function (data) {
        if (isLatest() && !hasClass(byId("search-form"), "hidden")) {
          paintSuggestions(data.suggestions || [], false);
        }
      }, function () {});
    }, 180);
  }

  function runSearch(text) {
    var query = YT.trim(text);
    if (!query) {
      return;
    }
    var recent = YT.load("ytSearches", []) || [];
    var next = [query];
    var i;
    for (i = 0; i < recent.length && next.length < 12; i++) {
      if (recent[i].toLowerCase() !== query.toLowerCase()) {
        next.push(recent[i]);
      }
    }
    YT.store("ytSearches", next);
    openList(query, function (ok, fail) {
      YT.get("/api/search" + YT.q({ q: query }), function (data) {
        ok(data.results || [], "No videos found.");
      }, fail);
    });
  }

  // ---- watch page ------------------------------------------------------

  function playSource(id, quality) {
    return "/api/play" + YT.q({ id: id, q: quality });
  }

  function startVideo(quality, seekTo) {
    var video = byId("player");
    currentQuality = quality;
    pendingSeek = seekTo || 0;
    video.src = playSource(currentItem.id, quality);
    video.load();
    var played = video.play();
    if (played && played["catch"]) {
      played["catch"](function () {});
    }
    paintQuality();
  }

  function paintQuality() {
    var hd = currentQuality === "hd" && (!currentInfo || currentInfo.hd !== false);
    byId("quality-label").textContent = hd ? "HD" : "360p";
  }

  function setQueueFrom(list, currentId) {
    var after = [];
    var before = [];
    var seen = false;
    var i;
    for (i = 0; i < (list || []).length; i++) {
      if (!list[i] || list[i].id === currentId) {
        seen = seen || (list[i] && list[i].id === currentId);
        continue;
      }
      if (seen) {
        after.push(list[i]);
      } else {
        before.push(list[i]);
      }
    }
    queue = after.length ? after.concat(before) : before;
    renderUpNext();
  }

  function renderUpNext() {
    renderCards(byId("upnext"), queue.slice(0, 30), "compact", "", "Up next");
    var first = byId("upnext").firstChild;
    if (first) {
      addClass(first, "is-next");
    }
  }

  function mergeQueue(extra) {
    var have = {};
    var i;
    if (currentItem) {
      have[currentItem.id] = true;
    }
    for (i = 0; i < queue.length; i++) {
      have[queue[i].id] = true;
    }
    for (i = 0; i < extra.length; i++) {
      if (extra[i] && extra[i].id && !have[extra[i].id]) {
        queue.push(extra[i]);
        have[extra[i].id] = true;
      }
    }
    renderUpNext();
  }

  function playFromList(item, list) {
    if (list && list.length) {
      lastList = list;
    }
    setQueueFrom(lastList, item.id);
    playItem(item);
  }

  function playNext() {
    if (!queue.length) {
      return false;
    }
    var next = queue.shift();
    renderUpNext();
    playItem(next);
    return true;
  }

  function paintRating() {
    YT.toggleClass(byId("btn-like"), "is-on", rating === "like");
    YT.toggleClass(byId("btn-dislike"), "is-on", rating === "dislike");
    // yt-dlp's count already includes the like you had when the page opened.
    var likes = currentInfo ? currentInfo.likes : 0;
    if (likes) {
      likes += (rating === "like" ? 1 : 0) - (currentInfo.ratedBase === "like" ? 1 : 0);
    }
    byId("like-count").textContent = likes ? YT.shortCount(likes) : "Like";
  }

  function paintSubscribed() {
    var b = byId("btn-sub");
    b.textContent = subscribed ? "Subscribed" : "Subscribe";
    YT.toggleClass(b, "is-on", subscribed);
  }

  function paintWatchMeta(item, info) {
    byId("now-playing").textContent = (info && info.title) || item.title || "Video";
    byId("mini-title").textContent = (info && info.title) || item.title || "Video";
    var author = (info && info.author) || item.author || "";
    byId("mini-author").textContent = author;
    var views = info ? info.views : item.views;
    byId("watch-sub").textContent = YT.joinBits([
      YT.formatViews(views),
      info ? YT.timeAgo(info.uploadDate) : "",
      info && info.description ? "...more" : "",
    ]);
    byId("channel-name").textContent = author || "YouTube";
    byId("channel-subs").textContent = info && info.followers ? YT.shortCount(info.followers) + " subscribers" : "";
    YT.avatarInto(byId("channel-avatar"), author, item.avatar, 0);
  }

  function playItem(item) {
    var video = byId("player");
    if (currentItem && video.currentTime) {
      savePosition(currentItem.id, video.currentTime, video.duration);
    }
    currentItem = item;
    currentInfo = null;
    rating = "none";
    subscribed = false;
    commentsNext = "";
    prefetched = "";
    byId("shorts-player").pause();
    closeSearch();
    show("watch", true);
    addClass(document.body, "watching");
    removeClass(document.body, "mini");
    show("watch-desc", false);
    byId("watch-desc").textContent = "";
    paintWatchMeta(item, null);
    paintRating();
    paintSubscribed();
    byId("comments").innerHTML = "";
    byId("comment-count").textContent = "";
    show("comments-more", false);
    setStatus("", false);
    window.scrollTo(0, 0);
    pushUnique("ytHistory", item, MAX_HISTORY);

    var saved = positions[item.id];
    startVideo(settings.hd ? "hd" : "sd", saved && saved.t > 10 ? saved.t : 0);

    var isLatest = YT.latest("watch");
    YT.get("/api/video" + YT.q({ id: item.id }), function (info) {
      if (!isLatest()) {
        return;
      }
      currentInfo = info;
      if (!item.channelId && info.channelId) {
        item.channelId = info.channelId;
      }
      item.title = info.title || item.title;
      item.author = info.author || item.author;
      item.duration = info.duration || item.duration;
      pushUnique("ytHistory", item, MAX_HISTORY);
      paintWatchMeta(item, info);
      byId("watch-desc").textContent = info.description || "";
      paintRating();
      paintQuality();
      loadWatchExtras(item, info, isLatest);
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    });

    YT.get("/api/related" + YT.q({ id: item.id, q: item.title && item.title !== "Video" ? item.title : "" }), function (data) {
      if (isLatest()) {
        mergeQueue(data.results || []);
      }
    }, function () {});
  }

  function loadWatchExtras(item, info, isLatest) {
    if (info.channelId) {
      YT.get("/api/channel" + YT.q({ id: info.channelId }), function (ch) {
        if (!isLatest()) {
          return;
        }
        if (ch.avatar) {
          YT.avatarInto(byId("channel-avatar"), info.author, ch.avatar, 0);
        }
        // The channel page's count is more reliable than the one in video metadata.
        if (ch.followers) {
          byId("channel-subs").textContent = YT.shortCount(ch.followers) + " subscribers";
        }
      }, function () {});
    }
    if (!signedIn()) {
      paintCommentsSignedOut();
      return;
    }
    YT.get("/api/me/state" + YT.q({ id: item.id, channel: info.channelId }), function (state) {
      if (!isLatest()) {
        return;
      }
      rating = state.rating || "none";
      currentInfo.ratedBase = rating;
      subscribed = !!state.subscribed;
      paintRating();
      paintSubscribed();
    }, function () {});
    loadComments(item.id, "", isLatest);
  }

  function paintCommentsSignedOut() {
    var box = byId("comments");
    box.innerHTML = "";
    show("comment-box", false);
    var b = el("button", "yt-signin-btn yt-signin-inline", "Sign in to see comments");
    b.type = "button";
    b.addEventListener("click", function () {
      openSignIn();
    });
    box.appendChild(b);
  }

  function commentNode(c) {
    var row = el("div", "yt-comment");
    var av = el("div", "yt-avatar yt-avatar-sm");
    YT.avatarInto(av, c.author, c.avatar, 2);
    row.appendChild(av);
    var body = el("div", "yt-comment-body");
    body.appendChild(el("div", "yt-comment-author", YT.joinBits([c.author, YT.timeAgo(c.published)])));
    body.appendChild(el("div", "yt-comment-text", c.text));
    body.appendChild(
      el("div", "yt-comment-meta", YT.joinBits([c.likes ? YT.shortCount(c.likes) + " likes" : "", c.replies ? c.replies + " replies" : ""]))
    );
    row.appendChild(body);
    return row;
  }

  function loadComments(id, page, isLatest) {
    show("comment-box", true);
    YT.get("/api/me/comments" + YT.q({ id: id, page: page }), function (data) {
      if (!isLatest()) {
        return;
      }
      var box = byId("comments");
      if (data.disabled) {
        box.innerHTML = "";
        show("comment-box", false);
        box.appendChild(el("p", "yt-empty-line", "Comments are turned off."));
        return;
      }
      var list = data.comments || [];
      var i;
      for (i = 0; i < list.length; i++) {
        box.appendChild(commentNode(list[i]));
      }
      if (!page && !list.length) {
        box.appendChild(el("p", "yt-empty-line", "No comments yet."));
      }
      commentsNext = data.next || "";
      show("comments-more", !!commentsNext);
    }, function (err) {
      if (isLatest()) {
        byId("comments").appendChild(el("p", "yt-empty-line", err));
      }
    });
  }

  function postComment() {
    var input = byId("comment-text");
    var text = YT.trim(input.value);
    if (!text || !currentItem) {
      return;
    }
    var id = currentItem.id;
    byId("comment-send").disabled = true;
    YT.post("/api/me/comment", { id: id, text: text }, function (c) {
      byId("comment-send").disabled = false;
      input.value = "";
      input.blur();
      var box = byId("comments");
      box.insertBefore(commentNode(c), box.firstChild);
      toast("Comment posted");
    }, function (err) {
      byId("comment-send").disabled = false;
      toast(err);
    });
  }

  function setRating(next) {
    if (!signedIn()) {
      openSignIn();
      return;
    }
    if (!currentItem) {
      return;
    }
    var before = rating;
    rating = next === rating ? "none" : next;
    paintRating();
    YT.post("/api/me/rate", { id: currentItem.id, rating: rating }, function () {
      if (rating === "like") {
        toast("Added to Liked videos");
      }
    }, function (err) {
      rating = before;
      paintRating();
      toast(err);
    });
  }

  function toggleSubscribe(channelId, on, done) {
    if (!signedIn()) {
      openSignIn();
      return;
    }
    if (!channelId) {
      toast("Channel not available");
      return;
    }
    done(on);
    YT.post("/api/me/subscribe", { channelId: channelId, on: on }, function () {
      toast(on ? "Subscription added" : "Subscription removed");
      byId("subs-feed").innerHTML = "";
    }, function (err) {
      done(!on);
      toast(err);
    });
  }

  function shrinkToMini() {
    if (!hasClass(document.body, "watching")) {
      return;
    }
    addClass(document.body, "mini");
    paintMiniIcon();
  }

  function expandFromMini() {
    removeClass(document.body, "mini");
    closeSearch();
    window.scrollTo(0, 0);
  }

  function closePlayer() {
    var video = byId("player");
    if (currentItem && video.currentTime) {
      savePosition(currentItem.id, video.currentTime, video.duration);
    }
    YT.latest("watch");
    video.pause();
    video.removeAttribute("src");
    video.load();
    currentItem = null;
    removeClass(document.body, "watching");
    removeClass(document.body, "mini");
    show("watch", false);
    if (reloadWhenIdle) {
      location.reload();
    }
  }

  function paintMiniIcon() {
    var video = byId("player");
    byId("mini-play-icon").innerHTML = video.paused
      ? '<path fill="currentColor" d="M8 5v14l11-7z"/>'
      : '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  }

  function wirePlayer() {
    var video = byId("player");
    video.addEventListener("loadedmetadata", function () {
      if (pendingSeek && (!video.duration || pendingSeek < video.duration - 15)) {
        try {
          video.currentTime = pendingSeek;
        } catch (err) {}
      }
      pendingSeek = 0;
    });
    video.addEventListener("playing", function () {
      failCount = 0;
      setStatus("", false);
      paintMiniIcon();
      // Warm up the next video on the Mac so it starts quickly.
      if (queue[0] && prefetched !== queue[0].id) {
        prefetched = queue[0].id;
        YT.get("/api/prefetch" + YT.q({ id: queue[0].id, q: settings.hd ? "hd" : "sd" }), function () {}, function () {});
      }
    });
    video.addEventListener("pause", paintMiniIcon);
    video.addEventListener("timeupdate", function () {
      var now = Date.now();
      if (currentItem && now - lastSaved > 5000) {
        lastSaved = now;
        savePosition(currentItem.id, video.currentTime, video.duration);
      }
    });
    video.addEventListener("ended", function () {
      if (currentItem) {
        savePosition(currentItem.id, 0, 0);
      }
      if (settings.autoplay && byId("autoplay").checked) {
        playNext();
      }
    });
    video.addEventListener("error", function () {
      if (!currentItem || !video.getAttribute("src")) {
        return;
      }
      // Step down HD (HLS) → 360p (HLS) → 360p MP4 through the Mac before giving up.
      if (currentQuality === "hd" || currentQuality === "sd") {
        startVideo(currentQuality === "hd" ? "sd" : "mp4", video.currentTime || pendingSeek);
        return;
      }
      failCount += 1;
      var auto = settings.autoplay && byId("autoplay").checked;
      if (auto && failCount < MAX_AUTOSKIP && queue.length) {
        setStatus("This video is unavailable. Playing the next one…", true);
        setTimeout(playNext, 1500);
      } else {
        setStatus(
          failCount >= MAX_AUTOSKIP
            ? "Several videos in a row would not play. Check that the Mac is online and serve.sh is running."
            : "This video is unavailable. Try another.",
          true
        );
      }
    });
  }

  // ---- share / save / item menu ----------------------------------------

  function openSheet(title, body) {
    byId("action-title").textContent = title;
    var box = byId("action-body");
    box.innerHTML = "";
    box.appendChild(body);
    show("action-sheet", true);
  }

  function closeSheet() {
    show("action-sheet", false);
  }

  function sheetButton(label, fn) {
    var b = el("button", "yt-sheet-item", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function shareItem(item) {
    var url = "https://youtu.be/" + item.id;
    if (navigator.share) {
      navigator.share({ title: item.title, url: url })["catch"](function () {});
      return;
    }
    var body = el("div");
    var input = el("input", "yt-share-input");
    input.value = url;
    input.readOnly = true;
    body.appendChild(input);
    body.appendChild(
      sheetButton("Copy link", function () {
        input.readOnly = false;
        input.focus();
        input.setSelectionRange(0, url.length);
        var ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (err) {}
        input.readOnly = true;
        input.blur();
        closeSheet();
        toast(ok ? "Link copied" : "Select the link to copy it");
      })
    );
    openSheet("Share", body);
  }

  function toggleWatchLater(item) {
    if (inList("ytLater", item.id)) {
      removeFrom("ytLater", item.id);
      toast("Removed from Watch later");
    } else {
      pushUnique("ytLater", item, 200);
      toast("Saved to Watch later");
    }
  }

  function openSaveSheet(item) {
    var body = el("div");
    body.appendChild(
      sheetButton(inList("ytLater", item.id) ? "✓ Watch later" : "Watch later", function () {
        closeSheet();
        toggleWatchLater(item);
      })
    );
    if (!signedIn()) {
      body.appendChild(
        sheetButton("Sign in to save to your playlists", function () {
          closeSheet();
          openSignIn();
        })
      );
      openSheet("Save video to…", body);
      return;
    }
    var lists = el("div");
    lists.appendChild(el("p", "yt-empty-line", "Loading playlists…"));
    body.appendChild(lists);
    body.appendChild(
      sheetButton("+ New playlist", function () {
        var title = window.prompt("Playlist name");
        if (!YT.trim(title)) {
          return;
        }
        YT.post("/api/me/playlist", { title: YT.trim(title) }, function (pl) {
          saveToPlaylist(item, pl.id, pl.title);
        }, function (err) {
          toast(err);
        });
      })
    );
    openSheet("Save video to…", body);
    YT.get("/api/me/playlists", function (data) {
      lists.innerHTML = "";
      var all = data.playlists || [];
      var i;
      for (i = 0; i < all.length; i++) {
        (function (pl) {
          lists.appendChild(
            sheetButton(pl.title, function () {
              saveToPlaylist(item, pl.id, pl.title);
            })
          );
        })(all[i]);
      }
    }, function (err) {
      lists.innerHTML = "";
      lists.appendChild(el("p", "yt-empty-line", err));
    });
  }

  function saveToPlaylist(item, playlistId, title) {
    closeSheet();
    YT.post("/api/me/save", { id: item.id, playlistId: playlistId }, function () {
      toast("Saved to " + title);
    }, function (err) {
      toast(err);
    });
  }

  function openItemMenu(item, context) {
    var body = el("div");
    body.appendChild(
      sheetButton("Play next", function () {
        closeSheet();
        if (!currentItem) {
          playFromList(item, [item]);
          return;
        }
        queue.unshift(item);
        renderUpNext();
        toast("Will play next");
      })
    );
    body.appendChild(
      sheetButton(inList("ytLater", item.id) ? "Remove from Watch later" : "Save to Watch later", function () {
        closeSheet();
        toggleWatchLater(item);
      })
    );
    body.appendChild(
      sheetButton("Save to playlist", function () {
        closeSheet();
        openSaveSheet(item);
      })
    );
    body.appendChild(
      sheetButton("Share", function () {
        closeSheet();
        shareItem(item);
      })
    );
    if (item.channelId) {
      body.appendChild(
        sheetButton("Go to channel", function () {
          closeSheet();
          openChannel(item.channelId, item.author);
        })
      );
    }
    if (context === "History") {
      body.appendChild(
        sheetButton("Remove from watch history", function () {
          closeSheet();
          removeFrom("ytHistory", item.id);
          if (listLoader) {
            runList(byId("list-title").textContent, listLoader);
          } else {
            paintYou();
          }
        })
      );
    }
    openSheet(item.title || "Video", body);
  }

  // ---- Shorts ----------------------------------------------------------

  function toggleShortsMode(on) {
    YT.toggleClass(document.body, "shorts-mode", on);
  }

  function loadShorts() {
    var key = settings.topic + "|" + (signedIn() ? "in" : "out");
    if (shorts.length && shortsLoadedFor === key) {
      showShort(shortIndex, false);
      return;
    }
    var isLatest = YT.latest("shorts");
    setStatus("Loading Shorts…", false);
    YT.get("/api/shorts" + YT.q({ topic: settings.topic }), function (data) {
      if (!isLatest()) {
        return;
      }
      setStatus("", false);
      shorts = data.results || [];
      shortsLoadedFor = key;
      shortIndex = 0;
      if (!shorts.length) {
        setStatus("No Shorts right now. Try again later.", true);
        return;
      }
      showShort(0, false);
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    });
  }

  function showShort(index, play) {
    if (!shorts.length) {
      return;
    }
    shortIndex = (index + shorts.length) % shorts.length;
    var item = shorts[shortIndex];
    var video = byId("shorts-player");
    if (video.getAttribute("data-id") !== item.id) {
      video.setAttribute("data-id", item.id);
      video.poster = YT.thumbUrl(item.id);
      video.src = playSource(item.id, settings.hd ? "hd" : "sd");
    }
    byId("shorts-author").textContent = item.author ? "@" + item.author.replace(/\s+/g, "") : "";
    byId("shorts-title").textContent = item.title || "";
    YT.toggleClass(byId("shorts-like"), "is-on", !!shortRated[item.id]);
    if (play) {
      playShort();
    } else {
      show("shorts-tap", true);
    }
    var next = shorts[(shortIndex + 1) % shorts.length];
    if (next && next.id !== item.id) {
      YT.get("/api/prefetch" + YT.q({ id: next.id, q: settings.hd ? "hd" : "sd" }), function () {}, function () {});
    }
  }

  function playShort() {
    var video = byId("shorts-player");
    byId("player").pause();
    show("shorts-tap", false);
    var played = video.play();
    if (played && played["catch"]) {
      played["catch"](function () {
        show("shorts-tap", true);
      });
    }
    if (shorts[shortIndex]) {
      pushUnique("ytHistory", shorts[shortIndex], MAX_HISTORY);
    }
  }

  function toggleShort() {
    var video = byId("shorts-player");
    if (video.paused) {
      playShort();
    } else {
      video.pause();
      show("shorts-tap", true);
    }
  }

  function wireShorts() {
    var view = byId("view-shorts");
    var startY = 0;
    var startX = 0;
    var moved = false;
    view.addEventListener("touchstart", function (event) {
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      moved = false;
    });
    view.addEventListener("touchmove", function (event) {
      moved = true;
      event.preventDefault();
    });
    view.addEventListener("touchend", function (event) {
      if (event.target.closest && event.target.closest(".yt-shorts-side")) {
        return;
      }
      var touch = event.changedTouches[0];
      var dy = touch.clientY - startY;
      var dx = touch.clientX - startX;
      event.preventDefault();
      if (moved && Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) {
        // touchend counts as a user gesture, so iOS lets the next Short start with sound.
        showShort(shortIndex + (dy < 0 ? 1 : -1), true);
      } else if (!moved) {
        toggleShort();
      }
    });
    // Mouse fallback; on iOS touchend above handles taps and blocks this click.
    byId("shorts-tap").addEventListener("click", toggleShort);
    byId("shorts-next").addEventListener("click", function () {
      showShort(shortIndex + 1, true);
    });
    byId("shorts-prev").addEventListener("click", function () {
      showShort(shortIndex - 1, true);
    });
    byId("shorts-share").addEventListener("click", function () {
      if (shorts[shortIndex]) {
        shareItem(shorts[shortIndex]);
      }
    });
    byId("shorts-like").addEventListener("click", function () {
      var item = shorts[shortIndex];
      if (!item) {
        return;
      }
      if (!signedIn()) {
        openSignIn();
        return;
      }
      var on = !shortRated[item.id];
      shortRated[item.id] = on;
      YT.toggleClass(byId("shorts-like"), "is-on", on);
      YT.post("/api/me/rate", { id: item.id, rating: on ? "like" : "none" }, function () {}, function (err) {
        shortRated[item.id] = !on;
        YT.toggleClass(byId("shorts-like"), "is-on", !on);
        toast(err);
      });
    });
    byId("shorts-player").addEventListener("error", function () {
      var video = byId("shorts-player");
      var src = video.getAttribute("src") || "";
      var next = src.indexOf("q=hd") !== -1 ? "sd" : src.indexOf("q=sd") !== -1 ? "mp4" : "";
      if (next) {
        video.src = playSource(video.getAttribute("data-id"), next);
        playShort();
      }
    });
  }

  // ---- Google sign-in ----------------------------------------------------

  var pollTimer = null;

  function signBody(nodes) {
    var box = byId("sign-body");
    box.innerHTML = "";
    var i;
    for (i = 0; i < nodes.length; i++) {
      box.appendChild(nodes[i]);
    }
  }

  function openSignIn() {
    show("sign-sheet", true);
    clearTimeout(pollTimer);
    if (!auth.configured) {
      signBody([
        el("p", "", "Google sign-in isn't set up on the Mac yet."),
        el("p", "", "On the Mac, follow \"Google sign-in\" in the README, then restart serve.sh."),
      ]);
      return;
    }
    signBody([el("p", "", "Getting a sign-in code…")]);
    var isLatest = YT.latest("signin");
    YT.post("/api/auth/start", {}, function (flow) {
      if (!isLatest()) {
        return;
      }
      var url = flow.url.replace(/^https?:\/\/(www\.)?/, "");
      var step1 = el("p", "");
      step1.appendChild(document.createTextNode("1. On your phone or computer, go to "));
      var link = el("a", "", url);
      link.href = flow.url;
      link.target = "_blank";
      step1.appendChild(link);
      signBody([
        step1,
        el("p", "", "2. Sign in to your Google account and enter this code:"),
        el("div", "yt-device-code", flow.code),
        el("p", "yt-sign-wait", "Waiting for you to finish signing in…"),
      ]);
      pollSignIn(flow.flow, flow.interval, isLatest);
    }, function (err) {
      if (isLatest()) {
        signBody([el("p", "", err), sheetButton("Try again", openSignIn)]);
      }
    });
  }

  function pollSignIn(flowId, interval, isLatest) {
    pollTimer = setTimeout(function () {
      if (!isLatest() || hasClass(byId("sign-sheet"), "hidden")) {
        return;
      }
      YT.post("/api/auth/poll", { flow: flowId }, function (res) {
        if (!isLatest()) {
          return;
        }
        if (res.status === "pending") {
          pollSignIn(flowId, res.interval || interval, isLatest);
        } else if (res.status === "done") {
          YT.setSession(res.session);
          auth.profile = res.profile;
          YT.store("ytProfile", res.profile);
          show("sign-sheet", false);
          toast("Signed in as " + res.profile.name);
          afterAccountChange();
        } else {
          var msg = res.status === "denied" ? "Sign-in was cancelled." : res.status === "expired" ? "The code expired." : res.message || "Sign-in failed.";
          signBody([el("p", "", msg), sheetButton("Try again", openSignIn)]);
        }
      }, function () {
        pollSignIn(flowId, interval, isLatest);
      });
    }, Math.max(2, interval || 5) * 1000);
  }

  function signOut() {
    if (!window.confirm("Sign out of your Google account on this Mac and iPad?")) {
      return;
    }
    YT.post("/api/auth/signout", {}, function () {}, function () {});
    YT.setSession("");
    auth.profile = null;
    YT.store("ytProfile", null);
    afterAccountChange();
    toast("Signed out");
  }

  function afterAccountChange() {
    paintAccount();
    byId("subs-feed").innerHTML = "";
    shortsLoadedFor = "";
    if (listLoader) {
      runList(byId("list-title").textContent, listLoader);
    } else if (currentTab !== "home") {
      setTab(currentTab);
    }
    if (currentItem && currentInfo) {
      loadWatchExtras(currentItem, currentInfo, YT.latest("watch"));
    }
  }

  function checkAuth() {
    YT.get("/api/auth/status", function (data) {
      auth.configured = !!data.configured;
      if (data.signedIn) {
        auth.profile = data.profile;
        YT.store("ytProfile", data.profile);
      } else if (YT.hasSession() || auth.profile) {
        YT.setSession("");
        auth.profile = null;
        YT.store("ytProfile", null);
      }
      paintAccount();
    }, function () {});
  }

  // ---- startup -----------------------------------------------------------

  function playPasted(event) {
    event.preventDefault();
    var id = YT.extractVideoId(byId("url").value);
    if (!id) {
      setStatus("Paste a full YouTube link.", true);
      return;
    }
    byId("url").value = "";
    byId("url").blur();
    playFromList({ id: id, title: "Video", author: "", views: 0, duration: 0 }, lastList);
  }

  function wireAppCache() {
    var appCache = window.applicationCache;
    if (!appCache) {
      return;
    }
    appCache.addEventListener("updateready", function () {
      try {
        appCache.swapCache();
      } catch (err) {}
      if (hasClass(document.body, "watching")) {
        reloadWhenIdle = true;
      } else {
        location.reload();
      }
    });
  }

  function on(id, type, fn) {
    byId(id).addEventListener(type, fn);
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      setStatus("Open this page from the Mac (serve.sh), not from Files.", true);
      return;
    }
    YT.onSignedOut(function () {
      auth.profile = null;
      YT.store("ytProfile", null);
      paintAccount();
      toast("You were signed out");
    });

    on("search-form", "submit", function (event) {
      event.preventDefault();
      runSearch(byId("q").value);
    });
    on("q", "input", onSearchInput);
    on("search-open", "click", openSearch);
    on("search-back", "click", closeSearch);
    on("search-clear", "click", function () {
      byId("q").value = "";
      onSearchInput();
      byId("q").focus();
    });
    on("header-you", "click", function () {
      setTab("you");
    });
    on("list-back", "click", listBack);
    on("play-form", "submit", playPasted);

    on("watch-collapse", "click", shrinkToMini);
    on("mini-open", "click", expandFromMini);
    on("mini-toggle", "click", function () {
      var video = byId("player");
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });
    on("mini-close", "click", closePlayer);
    on("watch-sub", "click", function () {
      var desc = byId("watch-desc");
      show(desc, hasClass(desc, "hidden") && !!desc.textContent);
    });
    on("btn-like", "click", function () {
      setRating("like");
    });
    on("btn-dislike", "click", function () {
      setRating("dislike");
    });
    on("btn-share", "click", function () {
      if (currentItem) {
        shareItem(currentItem);
      }
    });
    on("btn-save", "click", function () {
      if (currentItem) {
        openSaveSheet(currentItem);
      }
    });
    on("btn-quality", "click", function () {
      if (!currentItem) {
        return;
      }
      if (currentInfo && currentInfo.hd === false) {
        toast("HD isn't available for this video");
        return;
      }
      startVideo(currentQuality === "hd" ? "sd" : "hd", byId("player").currentTime);
      toast(currentQuality === "hd" ? "Quality: HD" : "Quality: 360p");
    });
    var video = byId("player");
    if (video.webkitSupportsPresentationMode && video.webkitSupportsPresentationMode("picture-in-picture")) {
      show("btn-pip", true);
      on("btn-pip", "click", function () {
        video.webkitSetPresentationMode(
          video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture"
        );
      });
    }
    on("channel-open", "click", function () {
      if (currentItem) {
        openChannel(currentItem.channelId, currentItem.author);
      }
    });
    on("btn-sub", "click", function () {
      toggleSubscribe(currentItem && currentItem.channelId, !subscribed, function (now) {
        subscribed = now;
        paintSubscribed();
      });
    });
    on("comment-send", "click", postComment);
    on("comment-text", "keydown", function (event) {
      if (event.keyCode === 13) {
        postComment();
      }
    });
    on("comments-more", "click", function () {
      if (currentItem && commentsNext) {
        loadComments(currentItem.id, commentsNext, YT.latest("watch-comments"));
      }
    });
    on("autoplay", "change", function () {
      settings.autoplay = byId("autoplay").checked;
      byId("set-autoplay").checked = settings.autoplay;
      saveSettings();
    });

    on("sign-cancel", "click", function () {
      clearTimeout(pollTimer);
      YT.latest("signin");
      show("sign-sheet", false);
    });
    on("sign-out", "click", signOut);
    on("action-cancel", "click", closeSheet);
    on("action-sheet", "click", function (event) {
      if (event.target === byId("action-sheet")) {
        closeSheet();
      }
    });

    on("set-hd", "change", function () {
      settings.hd = byId("set-hd").checked;
      saveSettings();
    });
    on("set-autoplay", "change", function () {
      settings.autoplay = byId("set-autoplay").checked;
      byId("autoplay").checked = settings.autoplay;
      saveSettings();
    });
    on("set-topic", "change", function () {
      settings.topic = YT.trim(byId("set-topic").value) || "Tamil";
      saveSettings();
      byId("home-feed").innerHTML = "";
      toast("Home will show " + settings.topic + " videos");
    });
    on("clear-history", "click", function () {
      if (window.confirm("Clear watch history on this iPad?")) {
        YT.store("ytHistory", []);
        positions = {};
        YT.store("ytPos", positions);
        paintYou();
      }
    });

    var buttons = document.querySelectorAll("[data-action=sign-in]");
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", openSignIn);
    }
    var opens = document.querySelectorAll("[data-open]");
    for (i = 0; i < opens.length; i++) {
      opens[i].addEventListener("click", function () {
        openNamed(this.getAttribute("data-open"));
      });
    }
    var tabs = document.querySelectorAll(".yt-tabs button");
    for (i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        var name = this.getAttribute("data-tab");
        setTab(name, name === currentTab && !listLoader);
      });
    }

    byId("autoplay").checked = !!settings.autoplay;
    wirePlayer();
    wireShorts();
    wireAppCache();
    paintChips();
    paintAccount();
    checkAuth();
    setTab("home", true);
  });
})();
