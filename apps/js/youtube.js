/* YouTube app for iOS 12 Safari, running entirely on the iPad. ES5 only.
 * Data comes from the YouTube Data API (yt-google.js) and videos play in
 * YouTube's own embedded player (IFrame API). */
(function () {
  "use strict";

  var byId = YTU.byId;
  var addClass = YTU.addClass;
  var removeClass = YTU.removeClass;
  var hasClass = YTU.hasClass;
  var show = YTU.show;
  var el = YTU.el;

  var CHIPS = ["All", "Music", "Songs", "News", "Live", "Movies", "Comedy", "Cooking", "Gaming"];
  var MAX_HISTORY = 50;
  var MAX_AUTOSKIP = 3;
  var STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 };

  var settings = YTU.load("ytSettings", null) || {};
  if (settings.autoplay === undefined) {
    settings.autoplay = true;
  }
  if (!settings.topic) {
    settings.topic = "Tamil";
  }

  var currentTab = "home";
  var currentChip = "All";
  var listStack = [];
  var listLoader = null;

  // Watch page state.
  var player = null;
  var playerReady = false;
  var pendingLoad = null;
  var queue = [];
  var lastList = [];
  var currentItem = null;
  var currentInfo = null;
  var rating = "none";
  var subscribed = false;
  var failCount = 0;
  var commentsNext = "";
  var commentsFor = null;
  var reloadWhenIdle = false;

  // Shorts state. Shorts reuse the one YouTube player: starting a player costs
  // about a second of frozen screen on an iPad mini 2, switching videos doesn't.
  var shortsMode = false;
  var shorts = [];
  var shortIndex = 0;
  var shortsLoadedFor = "";
  var shortRated = {};

  var apiReady = false;
  var apiWaiters = [];

  function signedIn() {
    return YTG.signedIn();
  }

  function saveSettings() {
    YTU.store("ytSettings", settings);
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
    var list = YTU.load(key, []);
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
    YTU.store(key, next);
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
    YTU.store(key, next);
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

  var positions = YTU.load("ytPos", {}) || {};
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
    YTU.store("ytPos", positions);
  }

  // ---- cards ---------------------------------------------------------------

  function cardNode(item, index, kind, list, context) {
    var card = el("div", kind === "compact" ? "yt-compact" : kind === "shelf" ? "yt-shelf-card" : "yt-card");
    var thumb = el("div", kind === "compact" ? "yt-compact-thumb" : "yt-thumb");
    var img = el("img");
    img.alt = "";
    img.src = YTU.thumbUrl(item.id);
    thumb.appendChild(img);
    if (item.live) {
      thumb.appendChild(el("div", "yt-dur yt-live", "LIVE"));
    } else if (YTU.formatDuration(item.duration)) {
      thumb.appendChild(el("div", "yt-dur", YTU.formatDuration(item.duration)));
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
      YTU.avatarInto(avatar, item.author, item.avatar, index);
      row.appendChild(avatar);
    }
    var text = el("div", "yt-card-text");
    text.appendChild(el("div", kind === "grid" ? "yt-card-title" : "yt-compact-title", item.title || "Video"));
    text.appendChild(
      el("div", "yt-card-sub", YTU.joinBits([item.author, YTU.formatViews(item.views), YTU.timeAgo(item.published)]))
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
    YTU.toggleClass(document.body, "shorts-mode", id === "view-shorts");
    window.scrollTo(0, 0);
  }

  function markTab(name) {
    var tabs = document.querySelectorAll(".yt-tabs button");
    var i;
    for (i = 0; i < tabs.length; i++) {
      YTU.toggleClass(tabs[i], "is-on", tabs[i].getAttribute("data-tab") === name);
    }
  }

  function leaveWatch() {
    if (hasClass(document.body, "watching") && !hasClass(document.body, "mini")) {
      shrinkToMini();
    }
  }

  function pauseShorts() {
    if (!shortsMode) {
      return;
    }
    shortsMode = false;
    removeClass(document.body, "shorts-playing");
    if (player && playerReady) {
      player.stopVideo();
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
      pauseShorts();
    }
    if (name === "home") {
      showView("view-home");
      if (refresh || !byId("home-feed").childNodes.length) {
        loadHome();
      }
    } else if (name === "shorts") {
      if (currentItem) {
        closePlayer();
      }
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
    pauseShorts();
    showView("view-list");
    byId("list-title").textContent = title;
    byId("list-header").innerHTML = "";
    byId("list-feed").innerHTML = "";
    setStatus("Loading…", false);
    var isLatest = YTU.latest("list");
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
    var topic = YTU.trim(settings.topic);
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

  function paintSetup(target) {
    target.innerHTML = "";
    var box = el("div", "yt-empty");
    box.appendChild(el("strong", "", "Almost ready"));
    if (YTG.canSignIn()) {
      box.appendChild(el("p", "", "Sign in with Google to start watching."));
      var b = el("button", "yt-signin-btn", "Sign in");
      b.type = "button";
      b.addEventListener("click", openSignIn);
      box.appendChild(b);
    } else {
      box.appendChild(el("p", "", "Add your YouTube API key to apps/js/config.js (see the README), then reopen this app."));
    }
    target.appendChild(box);
  }

  function loadHome() {
    var feed = byId("home-feed");
    if (!YTG.canBrowse()) {
      setStatus("", false);
      paintSetup(feed);
      return;
    }
    var isLatest = YTU.latest("home");
    feed.innerHTML = "";
    setStatus("Loading…", false);
    var live = currentChip === "Live";
    var query = currentChip === "All" ? chipQuery("songs") : live ? YTU.trim(settings.topic) || "news" : chipQuery(currentChip);
    function paint(items) {
      if (!isLatest()) {
        return;
      }
      setStatus("", false);
      renderCards(feed, items, "grid", "No videos found.", "Home");
    }
    YTG.search(query, { live: live }, function (results) {
      // "All" mixes in new uploads from the channel you watched last, like the app's recommendations.
      var history = readList("ytHistory");
      if (currentChip !== "All" || !history.length || !history[0].channelId) {
        paint(results);
        return;
      }
      YTG.channelVideos(history[0].channelId, 12, function (more) {
        paint(interleave(results, more));
      }, function () {
        paint(results);
      });
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    });
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
    var isLatest = YTU.latest("subs");
    if (!feed.childNodes.length) {
      setStatus("Loading your subscriptions…", false);
    }
    YTG.feed(function (data) {
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
          YTU.avatarInto(av, ch.title, ch.avatar, index);
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
    });
  }

  // ---- You -------------------------------------------------------------

  function paintAccount() {
    var profile = YTG.profile();
    var head = byId("header-you");
    if (profile) {
      YTU.avatarInto(head, profile.name, profile.avatar, 1);
    } else {
      head.style.background = "";
      head.innerHTML =
        '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 14a8 8 0 0 1-6.2-3c.1-2 4.1-3.1 6.2-3.1s6.1 1.1 6.2 3.1A8 8 0 0 1 12 20z"/></svg>';
    }
    show("you-out", !profile);
    show("you-in", !!profile);
    if (profile) {
      byId("you-name").textContent = profile.name;
      YTU.avatarInto(byId("you-avatar"), profile.name, profile.avatar, 1);
      YTU.avatarInto(byId("comment-me"), profile.name, profile.avatar, 1);
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
    byId("set-autoplay").checked = !!settings.autoplay;
    byId("set-topic").value = settings.topic;

    var wrap = byId("you-playlists-wrap");
    var box = byId("you-playlists");
    if (!signedIn()) {
      show(wrap, false);
      return;
    }
    var isLatest = YTU.latest("playlists");
    YTG.playlists(function (lists) {
      if (!isLatest()) {
        return;
      }
      box.innerHTML = "";
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
        YTG.liked(function (items) {
          ok(items, "Videos you like will show up here.");
        }, fail);
      });
    }
  }

  function openPlaylist(id, title) {
    openList(title || "Playlist", function (ok, fail) {
      YTG.playlistVideos(id, 50, 300, function (items) {
        ok(items, "This playlist is empty.");
      }, fail);
    });
  }

  function subscribeButton(channelId) {
    var b = el("button", "yt-sub", "Subscribe");
    b.type = "button";
    var on = false;
    function paint() {
      b.textContent = on ? "Subscribed" : "Subscribe";
      YTU.toggleClass(b, "is-on", on);
    }
    if (signedIn()) {
      YTG.subscriptionId(channelId, function (id) {
        on = !!id;
        paint();
      }, function () {});
    }
    b.addEventListener("click", function () {
      toggleSubscribe(channelId, !on, function (now) {
        on = now;
        paint();
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
      YTG.channel(channelId, function (ch) {
        var head = el("div", "yt-channel-head");
        var av = el("div", "yt-avatar yt-avatar-xl");
        YTU.avatarInto(av, ch.title, ch.avatar, 0);
        head.appendChild(av);
        var text = el("div", "yt-channel-head-text");
        text.appendChild(el("h2", "", ch.title || name));
        text.appendChild(el("p", "", ch.followers ? YTU.shortCount(ch.followers) + " subscribers" : ""));
        head.appendChild(text);
        head.appendChild(subscribeButton(channelId));
        YTG.channelVideos(channelId, 30, function (items) {
          ok(items, "This channel has no videos.", head);
        }, fail);
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
      items = YTU.load("ytSearches", []) || [];
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
    var value = YTU.trim(byId("q").value);
    show("search-clear", !!value);
    clearTimeout(suggestTimer);
    if (!value) {
      paintSuggestions([], true);
      return;
    }
    suggestTimer = setTimeout(function () {
      var isLatest = YTU.latest("suggest");
      YTG.suggest(value, function (list) {
        if (isLatest() && !hasClass(byId("search-form"), "hidden")) {
          paintSuggestions(list, false);
        }
      });
    }, 180);
  }

  function runSearch(text) {
    var query = YTU.trim(text);
    if (!query) {
      return;
    }
    var recent = YTU.load("ytSearches", []) || [];
    var next = [query];
    var i;
    for (i = 0; i < recent.length && next.length < 12; i++) {
      if (recent[i].toLowerCase() !== query.toLowerCase()) {
        next.push(recent[i]);
      }
    }
    YTU.store("ytSearches", next);
    openList(query, function (ok, fail) {
      YTG.search(query, {}, function (items) {
        ok(items, "No videos found.");
      }, fail);
    });
  }

  // ---- YouTube IFrame player ---------------------------------------------

  // Called by https://www.youtube.com/iframe_api once it has loaded.
  window.onYouTubeIframeAPIReady = function () {
    apiReady = true;
    var waiters = apiWaiters;
    apiWaiters = [];
    for (var i = 0; i < waiters.length; i++) {
      waiters[i]();
    }
  };

  function whenApi(fn) {
    if (apiReady || (window.YT && window.YT.loaded && window.YT.Player)) {
      fn();
    } else {
      apiWaiters.push(fn);
    }
  }

  function playerVars(extra) {
    var vars = { playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.protocol + "//" + location.host };
    var k;
    for (k in extra || {}) {
      if (extra.hasOwnProperty(k)) {
        vars[k] = extra[k];
      }
    }
    return vars;
  }

  function embedError(code) {
    if (code === 101 || code === 150 || code === 153) {
      return "The owner of this video doesn't allow it to play outside YouTube.";
    }
    if (code === 100) {
      return "This video was removed or made private.";
    }
    return "This video can't play right now.";
  }

  function loadIntoPlayer(id, start) {
    if (player && playerReady) {
      player.loadVideoById({ videoId: id, startSeconds: start || 0 });
      return;
    }
    pendingLoad = { id: id, start: start };
    if (player) {
      return; // still starting up; onReady loads pendingLoad
    }
    whenApi(function () {
      player = new window.YT.Player("player", {
        width: "100%",
        height: "100%",
        videoId: id,
        playerVars: playerVars({ autoplay: 1, start: Math.floor(start || 0) }),
        events: {
          onReady: function () {
            playerReady = true;
            if (pendingLoad && pendingLoad.id !== id) {
              player.loadVideoById({ videoId: pendingLoad.id, startSeconds: pendingLoad.start || 0 });
            }
            pendingLoad = null;
          },
          onStateChange: onPlayerState,
          onError: onPlayerError,
        },
      });
    });
  }

  function onPlayerState(event) {
    if (shortsMode) {
      // Shorts loop, like the app.
      if (event.data === STATE.ENDED) {
        player.seekTo(0);
        player.playVideo();
      }
      return;
    }
    paintMiniIcon();
    if (event.data === STATE.PLAYING) {
      failCount = 0;
      setStatus("", false);
    } else if (event.data === STATE.ENDED) {
      if (currentItem) {
        savePosition(currentItem.id, 0, 0);
      }
      if (settings.autoplay && byId("autoplay").checked) {
        playNext();
      }
    }
  }

  function onPlayerError(event) {
    if (shortsMode) {
      showShort(shortIndex + 1);
      return;
    }
    if (!currentItem) {
      return;
    }
    failCount += 1;
    var msg = embedError(event.data);
    var auto = settings.autoplay && byId("autoplay").checked;
    if (auto && failCount < MAX_AUTOSKIP && queue.length) {
      setStatus(msg + " Playing the next one…", true);
      setTimeout(playNext, 2000);
    } else {
      setStatus(msg, true);
    }
  }

  function playing() {
    return player && playerReady && player.getPlayerState && player.getPlayerState() === STATE.PLAYING;
  }

  // Remember where you are in each video, like the app does.
  setInterval(function () {
    if (currentItem && !shortsMode && playing()) {
      savePosition(currentItem.id, player.getCurrentTime(), player.getDuration());
    }
  }, 5000);

  // ---- watch page ------------------------------------------------------

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

  // Up next is drawn shortly after a video starts and kept short: building
  // these cards while YouTube's player loads was most of the switching lag on
  // an iPad mini 2.
  var upNextTimer = null;
  function renderUpNext() {
    clearTimeout(upNextTimer);
    upNextTimer = setTimeout(drawUpNext, 1200);
  }

  function drawUpNext() {
    renderCards(byId("upnext"), queue.slice(0, 12), "compact", "", "Up next");
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
    YTU.toggleClass(byId("btn-like"), "is-on", rating === "like");
    YTU.toggleClass(byId("btn-dislike"), "is-on", rating === "dislike");
    // The API's count already includes the like you had when the page opened.
    var likes = currentInfo ? currentInfo.likes : 0;
    if (likes) {
      likes += (rating === "like" ? 1 : 0) - (currentInfo.ratedBase === "like" ? 1 : 0);
    }
    byId("like-count").textContent = likes ? YTU.shortCount(likes) : "Like";
  }

  function paintSubscribed() {
    var b = byId("btn-sub");
    b.textContent = subscribed ? "Subscribed" : "Subscribe";
    YTU.toggleClass(b, "is-on", subscribed);
  }

  function paintWatchMeta(item, info) {
    var title = (info && info.title) || item.title || "Video";
    var author = (info && info.author) || item.author || "";
    byId("now-playing").textContent = title;
    byId("mini-title").textContent = title;
    byId("mini-author").textContent = author;
    byId("watch-sub").textContent = YTU.joinBits([
      YTU.formatViews(info ? info.views : item.views),
      info ? YTU.timeAgo(info.published) : "",
      info && info.description ? "...more" : "",
    ]);
    byId("channel-name").textContent = author || "YouTube";
    byId("channel-subs").textContent = "";
    YTU.avatarInto(byId("channel-avatar"), author, item.avatar, 0);
  }

  function playItem(item) {
    if (currentItem && playing()) {
      savePosition(currentItem.id, player.getCurrentTime(), player.getDuration());
    }
    currentItem = item;
    currentInfo = null;
    rating = "none";
    subscribed = false;
    commentsNext = "";
    commentsFor = null;
    pauseShorts();
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
    show("comments-more", false);
    setStatus("", false);
    window.scrollTo(0, 0);
    pushUnique("ytHistory", item, MAX_HISTORY);

    var saved = positions[item.id];
    loadIntoPlayer(item.id, saved && saved.t > 10 ? saved.t : 0);

    var isLatest = YTU.latest("watch");
    YTG.video(item.id, function (info) {
      if (!isLatest()) {
        return;
      }
      currentInfo = info;
      item.channelId = item.channelId || info.channelId;
      item.title = info.title || item.title;
      item.author = info.author || item.author;
      item.duration = info.duration || item.duration;
      pushUnique("ytHistory", item, MAX_HISTORY);
      paintWatchMeta(item, info);
      byId("watch-desc").textContent = info.description || "";
      paintRating();
      setTimeout(function () {
        if (isLatest()) {
          loadWatchExtras(item, info, isLatest);
        }
      }, 1500);
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    });
  }

  function loadWatchExtras(item, info, isLatest) {
    if (info.channelId) {
      YTG.channel(info.channelId, function (ch) {
        if (!isLatest()) {
          return;
        }
        if (ch.avatar) {
          YTU.avatarInto(byId("channel-avatar"), info.author, ch.avatar, 0);
        }
        if (ch.followers) {
          byId("channel-subs").textContent = YTU.shortCount(ch.followers) + " subscribers";
        }
      }, function () {});
      // Up next continues with more from this channel (1 unit; a related-videos search would cost 100).
      YTG.channelVideos(info.channelId, 15, function (more) {
        if (isLatest()) {
          mergeQueue(more);
        }
      }, function () {});
    }
    // Comments load when asked for, not with every video (saves time and quota).
    byId("comments").innerHTML = "";
    show("comments-more", false);
    show("comments-open", true);
    commentsFor = isLatest;
    show("comment-box", false);
    if (!signedIn()) {
      return;
    }
    YTG.rating(item.id, function (value) {
      if (isLatest()) {
        rating = value;
        currentInfo.ratedBase = value;
        paintRating();
      }
    }, function () {});
    if (info.channelId) {
      YTG.subscriptionId(info.channelId, function (id) {
        if (isLatest()) {
          subscribed = !!id;
          paintSubscribed();
        }
      }, function () {});
    }
  }

  function commentNode(c) {
    var row = el("div", "yt-comment");
    var av = el("div", "yt-avatar yt-avatar-sm");
    YTU.avatarInto(av, c.author, c.avatar, 2);
    row.appendChild(av);
    var body = el("div", "yt-comment-body");
    body.appendChild(el("div", "yt-comment-author", YTU.joinBits([c.author, YTU.timeAgo(c.published)])));
    body.appendChild(el("div", "yt-comment-text", c.text));
    body.appendChild(
      el("div", "yt-comment-meta", YTU.joinBits([c.likes ? YTU.shortCount(c.likes) + " likes" : "", c.replies ? c.replies + " replies" : ""]))
    );
    row.appendChild(body);
    return row;
  }

  function openComments() {
    if (!currentItem || !commentsFor) {
      return;
    }
    show("comments-open", false);
    show("comment-box", signedIn());
    loadComments(currentItem.id, "", commentsFor);
  }

  function loadComments(id, page, isLatest) {
    YTG.comments(id, page, function (data) {
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
    var text = YTU.trim(input.value);
    if (!text || !currentItem) {
      return;
    }
    byId("comment-send").disabled = true;
    YTG.addComment(currentItem.id, text, function (c) {
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
    YTG.rate(currentItem.id, rating, function () {
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
    YTG.subscribe(channelId, on, function () {
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
    if (currentItem && playing()) {
      savePosition(currentItem.id, player.getCurrentTime(), player.getDuration());
    }
    YTU.latest("watch");
    if (player && playerReady) {
      player.stopVideo();
    }
    currentItem = null;
    removeClass(document.body, "watching");
    removeClass(document.body, "mini");
    show("watch", false);
    if (reloadWhenIdle) {
      location.reload();
    }
  }

  function paintMiniIcon() {
    byId("mini-play-icon").innerHTML = playing()
      ? '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
      : '<path fill="currentColor" d="M8 5v14l11-7z"/>';
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
        var title = YTU.trim(window.prompt("Playlist name"));
        if (!title) {
          return;
        }
        YTG.createPlaylist(title, function (pl) {
          saveToPlaylist(item, pl.id, pl.title);
        }, toast);
      })
    );
    openSheet("Save video to…", body);
    YTG.playlists(function (all) {
      lists.innerHTML = "";
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
    YTG.save(item.id, playlistId, function () {
      toast("Saved to " + title);
    }, toast);
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

  function loadShorts() {
    if (!YTG.canBrowse()) {
      setStatus("Sign in or add an API key first (see You).", true);
      return;
    }
    var key = settings.topic;
    if (shorts.length && shortsLoadedFor === key) {
      showShort(shortIndex);
      return;
    }
    var isLatest = YTU.latest("shorts");
    setStatus("Loading Shorts…", false);
    YTG.search(YTU.trim(settings.topic) + " #shorts", { short: true }, function (results) {
      if (!isLatest()) {
        return;
      }
      setStatus("", false);
      shorts = [];
      for (var i = 0; i < results.length; i++) {
        if (results[i].duration && results[i].duration <= 180) {
          shorts.push(results[i]);
        }
      }
      shortsLoadedFor = key;
      shortIndex = 0;
      if (!shorts.length) {
        setStatus("No Shorts right now. Try again later.", true);
        return;
      }
      showShort(0);
    }, function (err) {
      if (isLatest()) {
        setStatus(err, true);
      }
    });
  }

  function showShort(index) {
    if (!shorts.length) {
      return;
    }
    shortIndex = (index + shorts.length) % shorts.length;
    var item = shorts[shortIndex];
    byId("shorts-author").textContent = item.author ? "@" + item.author.replace(/\s+/g, "") : "";
    byId("shorts-title").textContent = item.title || "";
    YTU.toggleClass(byId("shorts-like"), "is-on", !!shortRated[item.id]);
    pushUnique("ytHistory", item, MAX_HISTORY);
    shortsMode = true;
    addClass(document.body, "shorts-playing");
    loadIntoPlayer(item.id, 0);
  }

  function wireShorts() {
    // The video itself is YouTube's iframe and takes its own taps; swipe on the caption area.
    var zone = byId("shorts-swipe");
    var startY = 0;
    zone.addEventListener("touchstart", function (event) {
      startY = event.touches[0].clientY;
    });
    zone.addEventListener("touchend", function (event) {
      var dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dy) > 40) {
        showShort(shortIndex + (dy < 0 ? 1 : -1));
      }
    });
    byId("shorts-next").addEventListener("click", function () {
      showShort(shortIndex + 1);
    });
    byId("shorts-prev").addEventListener("click", function () {
      showShort(shortIndex - 1);
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
      YTU.toggleClass(byId("shorts-like"), "is-on", on);
      YTG.rate(item.id, on ? "like" : "none", function () {}, function (err) {
        shortRated[item.id] = !on;
        YTU.toggleClass(byId("shorts-like"), "is-on", !on);
        toast(err);
      });
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
    if (!YTG.canSignIn()) {
      signBody([
        el("p", "", "Google sign-in isn't set up yet."),
        el("p", "", "Add your Google client ID and secret to apps/js/config.js (see the README)."),
      ]);
      return;
    }
    signBody([el("p", "", "Getting a sign-in code…")]);
    var isLatest = YTU.latest("signin");
    YTG.startSignIn(function (flow) {
      if (!isLatest()) {
        return;
      }
      var step1 = el("p", "");
      step1.appendChild(document.createTextNode("1. On your phone or computer, go to "));
      var link = el("a", "", flow.url.replace(/^https?:\/\/(www\.)?/, ""));
      link.href = flow.url;
      link.target = "_blank";
      step1.appendChild(link);
      signBody([
        step1,
        el("p", "", "2. Sign in to your Google account and enter this code:"),
        el("div", "yt-device-code", flow.code),
        el("p", "yt-sign-wait", "Waiting for you to finish signing in…"),
      ]);
      pollSignIn(flow, isLatest);
    }, function (err) {
      if (isLatest()) {
        signBody([el("p", "", err), sheetButton("Try again", openSignIn)]);
      }
    });
  }

  function pollSignIn(flow, isLatest) {
    pollTimer = setTimeout(function () {
      if (!isLatest() || hasClass(byId("sign-sheet"), "hidden")) {
        return;
      }
      YTG.pollSignIn(flow, function (status, extra) {
        if (!isLatest()) {
          return;
        }
        if (status === "pending") {
          pollSignIn(flow, isLatest);
        } else if (status === "done") {
          show("sign-sheet", false);
          toast("Signed in as " + extra.name);
          afterAccountChange();
        } else {
          var msg = status === "denied" ? "Sign-in was cancelled." : status === "expired" ? "The code expired." : extra || "Sign-in failed.";
          signBody([el("p", "", msg), sheetButton("Try again", openSignIn)]);
        }
      });
    }, Math.max(2, flow.interval || 5) * 1000);
  }

  function signOut() {
    if (!window.confirm("Sign out of your Google account on this iPad?")) {
      return;
    }
    YTG.signOut();
    toast("Signed out");
  }

  function afterAccountChange() {
    paintAccount();
    byId("subs-feed").innerHTML = "";
    byId("home-feed").innerHTML = "";
    if (listLoader) {
      runList(byId("list-title").textContent, listLoader);
    } else {
      setTab(currentTab, true);
    }
    if (currentItem && currentInfo) {
      loadWatchExtras(currentItem, currentInfo, YTU.latest("watch"));
    }
  }

  // ---- startup -----------------------------------------------------------

  function playPasted(event) {
    event.preventDefault();
    var id = YTU.extractVideoId(byId("url").value);
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
      setStatus("Open this app from its web address and add it to the Home Screen; YouTube's player doesn't work from Files.", true);
      return;
    }
    YTG.onSignedOut(function () {
      afterAccountChange();
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
      if (!player || !playerReady) {
        return;
      }
      if (playing()) {
        player.pauseVideo();
      } else {
        player.playVideo();
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
    on("comments-open", "click", openComments);
    on("comments-more", "click", function () {
      if (currentItem && commentsNext) {
        loadComments(currentItem.id, commentsNext, YTU.latest("watch-comments"));
      }
    });
    on("autoplay", "change", function () {
      settings.autoplay = byId("autoplay").checked;
      byId("set-autoplay").checked = settings.autoplay;
      saveSettings();
    });

    on("sign-cancel", "click", function () {
      clearTimeout(pollTimer);
      YTU.latest("signin");
      show("sign-sheet", false);
    });
    on("sign-out", "click", signOut);
    on("action-cancel", "click", closeSheet);
    on("action-sheet", "click", function (event) {
      if (event.target === byId("action-sheet")) {
        closeSheet();
      }
    });

    on("set-autoplay", "change", function () {
      settings.autoplay = byId("set-autoplay").checked;
      byId("autoplay").checked = settings.autoplay;
      saveSettings();
    });
    on("set-topic", "change", function () {
      settings.topic = YTU.trim(byId("set-topic").value) || "Tamil";
      saveSettings();
      byId("home-feed").innerHTML = "";
      toast("Home will show " + settings.topic + " videos");
    });
    on("clear-history", "click", function () {
      if (window.confirm("Clear watch history on this iPad?")) {
        YTU.store("ytHistory", []);
        positions = {};
        YTU.store("ytPos", positions);
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
    wireShorts();
    wireAppCache();
    paintChips();
    paintAccount();
    setTab("home", true);
    setTimeout(YTU.cachePrune, 5000);
  });
})();
