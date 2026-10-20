/* Google sign-in (device flow) and YouTube Data API calls, straight from the iPad.
 * ES5 only. Every call costs quota (10,000 units a day per Google project; a
 * search is 100, most reads are 1), so results are cached in localStorage. */
var YTG = (function () {
  "use strict";

  var cfg = window.YT_CONFIG || {};
  var API = "https://www.googleapis.com/youtube/v3/";
  var OAUTH = "https://oauth2.googleapis.com/";
  var SCOPE = "https://www.googleapis.com/auth/youtube";

  var auth = YTU.load("ytAuth", null);
  var refreshWaiters = null;
  var onSignedOut = null;

  // ---- auth ------------------------------------------------------------

  function signedIn() {
    return !!(auth && auth.refresh_token);
  }

  function canBrowse() {
    return !!cfg.apiKey || signedIn();
  }

  function canSignIn() {
    return !!(cfg.clientId && cfg.clientSecret);
  }

  function saveAuth() {
    YTU.store("ytAuth", auth);
  }

  function dropAuth() {
    auth = null;
    YTU.store("ytAuth", null);
    YTU.cacheClear("me:");
    if (onSignedOut) {
      onSignedOut();
    }
  }

  function form(params) {
    return YTU.q(params).slice(1);
  }

  function oauthPost(path, params, onOk, onErr) {
    YTU.xhr(
      "POST",
      OAUTH + path,
      { "Content-Type": "application/x-www-form-urlencoded" },
      form(params),
      onOk,
      onErr
    );
  }

  function withToken(onToken, onErr) {
    if (!signedIn()) {
      onErr("signed out");
      return;
    }
    if (auth.access_token && auth.expires_at > Date.now()) {
      onToken(auth.access_token);
      return;
    }
    if (refreshWaiters) {
      refreshWaiters.push([onToken, onErr]);
      return;
    }
    refreshWaiters = [[onToken, onErr]];
    oauthPost(
      "token",
      {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: auth.refresh_token,
        grant_type: "refresh_token",
      },
      function (data) {
        auth.access_token = data.access_token;
        auth.expires_at = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
        saveAuth();
        var waiters = refreshWaiters;
        refreshWaiters = null;
        for (var i = 0; i < waiters.length; i++) {
          waiters[i][0](auth.access_token);
        }
      },
      function (data, status) {
        var waiters = refreshWaiters;
        refreshWaiters = null;
        if (data && data.error === "invalid_grant") {
          dropAuth();
        }
        var msg = status === 0 ? "No internet connection." : "Could not refresh Google sign-in.";
        for (var i = 0; i < waiters.length; i++) {
          waiters[i][1](msg);
        }
      }
    );
  }

  function startSignIn(onOk, onErr) {
    oauthPost(
      "device/code",
      { client_id: cfg.clientId, scope: SCOPE },
      function (data) {
        onOk({
          deviceCode: data.device_code,
          code: data.user_code,
          url: data.verification_url || data.verification_uri || "https://www.google.com/device",
          interval: data.interval || 5,
          expiresAt: Date.now() + (data.expires_in || 900) * 1000,
        });
      },
      function (data, status) {
        onErr(status === 0 ? "No internet connection." : (data && data.error_description) || "Google refused the sign-in request.");
      }
    );
  }

  // done(status, extra): status is "pending", "done", "denied", "expired" or "error".
  function pollSignIn(flow, done) {
    if (Date.now() > flow.expiresAt) {
      done("expired");
      return;
    }
    oauthPost(
      "token",
      {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        device_code: flow.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      function (data) {
        auth = {
          refresh_token: data.refresh_token,
          access_token: data.access_token,
          expires_at: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
          profile: null,
        };
        saveAuth();
        api("GET", "channels", { part: "snippet", mine: "true" }, null, function (res) {
          var item = (res.items || [])[0];
          auth.profile = item
            ? { name: item.snippet.title || "You", avatar: thumb(item.snippet), channelId: item.id }
            : { name: "You", avatar: "", channelId: "" };
          saveAuth();
          done("done", auth.profile);
        }, function () {
          auth.profile = { name: "You", avatar: "", channelId: "" };
          saveAuth();
          done("done", auth.profile);
        });
      },
      function (data, status) {
        var error = data && data.error;
        if (status === 0 || error === "authorization_pending") {
          done("pending", flow.interval);
        } else if (error === "slow_down") {
          flow.interval += 5;
          done("pending", flow.interval);
        } else if (error === "access_denied") {
          done("denied");
        } else if (error === "expired_token") {
          done("expired");
        } else {
          done("error", (data && data.error_description) || error || "Sign-in failed.");
        }
      }
    );
  }

  function signOut() {
    var token = auth && auth.refresh_token;
    if (token) {
      oauthPost("revoke", { token: token }, function () {}, function () {});
    }
    dropAuth();
  }

  // ---- Data API --------------------------------------------------------

  function apiError(data, status) {
    if (status === 0) {
      return "No internet connection.";
    }
    var err = (data && data.error) || {};
    var reason = ((err.errors || [])[0] || {}).reason || "";
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      return "Today's YouTube limit for this app is used up. It resets overnight (midnight in California).";
    }
    if (reason === "keyInvalid" || status === 400 && /API key/.test(err.message || "")) {
      return "The YouTube API key in config.js isn't valid.";
    }
    if (status === 403 && /referer|referrer/i.test(err.message || "")) {
      return "The API key isn't allowed on this web address. Check its restrictions in Google Cloud.";
    }
    return err.message || "YouTube error (HTTP " + status + ")";
  }

  function api(method, path, params, body, onOk, onErr, retried) {
    function send(token) {
      var headers = {};
      var query = {};
      var k;
      for (k in params) {
        if (params.hasOwnProperty(k)) {
          query[k] = params[k];
        }
      }
      if (token) {
        headers.Authorization = "Bearer " + token;
      } else {
        query.key = cfg.apiKey;
      }
      if (body) {
        headers["Content-Type"] = "application/json";
      }
      YTU.xhr(method, API + path + YTU.q(query), headers, body ? JSON.stringify(body) : null, onOk, function (data, status) {
        if (status === 401 && token && !retried) {
          auth.expires_at = 0;
          api(method, path, params, body, onOk, onErr, true);
          return;
        }
        var reason = (((data && data.error) || {}).errors || [{}])[0].reason;
        onErr(apiError(data, status), reason);
      });
    }
    if (signedIn()) {
      withToken(send, onErr);
    } else if (cfg.apiKey) {
      send("");
    } else {
      onErr("YouTube isn't set up yet: add your API key to config.js (see README).");
    }
  }

  // GET with a localStorage cache in front.
  function cached(key, seconds, path, params, onOk, onErr) {
    var hit = YTU.cacheGet(key);
    if (hit) {
      onOk(hit);
      return;
    }
    api("GET", path, params, null, function (data) {
      YTU.cachePut(key, data, seconds);
      onOk(data);
    }, onErr);
  }

  function thumb(snippet) {
    var t = snippet.thumbnails || {};
    return (t.medium || t["default"] || t.high || {}).url || "";
  }

  function duration(iso) {
    var m = String(iso || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) {
      return 0;
    }
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }

  function fromVideo(v) {
    var s = v.snippet || {};
    var st = v.statistics || {};
    return {
      id: v.id,
      title: s.title || "Video",
      author: s.channelTitle || "",
      channelId: s.channelId || "",
      published: s.publishedAt || "",
      description: s.description || "",
      views: +st.viewCount || 0,
      likes: +st.likeCount || 0,
      duration: duration((v.contentDetails || {}).duration),
      live: s.liveBroadcastContent === "live",
    };
  }

  // Adds duration, views and channel to a list of {id} items (1 unit per 50 videos).
  function details(ids, onOk, onErr) {
    var key = "videos:" + ids.join(",");
    var out = [];
    var i;
    if (!ids.length) {
      onOk([]);
      return;
    }
    cached(key, 3600, "videos", { part: "snippet,statistics,contentDetails", id: ids.slice(0, 50).join(","), maxResults: 50 }, function (data) {
      var byId = {};
      var items = data.items || [];
      for (i = 0; i < items.length; i++) {
        byId[items[i].id] = fromVideo(items[i]);
      }
      for (i = 0; i < ids.length; i++) {
        if (byId[ids[i]]) {
          out.push(byId[ids[i]]);
        }
      }
      onOk(out);
    }, onErr);
  }

  function idsOf(items, pick) {
    var ids = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var id = pick(items[i]);
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    }
    return ids;
  }

  // opts: { live: bool, short: bool }
  function search(query, opts, onOk, onErr) {
    opts = opts || {};
    var params = {
      part: "id",
      type: "video",
      videoEmbeddable: "true",
      maxResults: 25,
      q: query,
      regionCode: cfg.region || "",
    };
    if (opts.live) {
      params.eventType = "live";
    }
    if (opts.short) {
      params.videoDuration = "short";
    }
    var key = "search:" + (opts.live ? "live:" : opts.short ? "short:" : "") + query.toLowerCase();
    // A search costs 100 units, so keep results for 3 hours (live: 15 minutes).
    cached(key, opts.live ? 900 : 10800, "search", params, function (data) {
      details(idsOf(data.items || [], function (it) {
        return it.id && it.id.videoId;
      }), onOk, onErr);
    }, onErr);
  }

  function suggest(query, onOk) {
    YTU.jsonp(
      "https://suggestqueries.google.com/complete/search" + YTU.q({ client: "youtube", ds: "yt", q: query }),
      function (data) {
        var out = [];
        var list = (data && data[1]) || [];
        for (var i = 0; i < list.length && out.length < 10; i++) {
          out.push(typeof list[i] === "string" ? list[i] : list[i][0]);
        }
        onOk(out);
      },
      function () {
        onOk([]);
      }
    );
  }

  function video(id, onOk, onErr) {
    details([id], function (list) {
      if (list.length) {
        onOk(list[0]);
      } else {
        onErr("This video is unavailable.");
      }
    }, onErr);
  }

  function playlistVideos(playlistId, limit, cacheSeconds, onOk, onErr) {
    var key = (signedIn() ? "me:" : "") + "pl:" + playlistId;
    cached(key, cacheSeconds, "playlistItems", { part: "contentDetails", playlistId: playlistId, maxResults: limit }, function (data) {
      details(idsOf(data.items || [], function (it) {
        return it.contentDetails && it.contentDetails.videoId;
      }), onOk, onErr);
    }, onErr);
  }

  function channel(id, onOk, onErr) {
    cached("channel:" + id, 21600, "channels", { part: "snippet,statistics,contentDetails", id: id }, function (data) {
      var item = (data.items || [])[0];
      if (!item) {
        onErr("Channel not found.");
        return;
      }
      onOk({
        id: id,
        title: item.snippet.title,
        avatar: thumb(item.snippet),
        followers: +((item.statistics || {}).subscriberCount || 0),
        uploads: ((item.contentDetails || {}).relatedPlaylists || {}).uploads || "UU" + id.slice(2),
      });
    }, onErr);
  }

  function channelVideos(id, limit, onOk, onErr) {
    playlistVideos("UU" + id.slice(2), limit, 1800, onOk, onErr);
  }

  // ---- signed-in features ----------------------------------------------

  function subscriptions(onOk, onErr) {
    var hit = YTU.cacheGet("me:subs");
    if (hit) {
      onOk(hit);
      return;
    }
    var out = [];
    function page(token, n) {
      api("GET", "subscriptions", { part: "snippet", mine: "true", maxResults: 50, order: "relevance", pageToken: token }, null, function (data) {
        var items = data.items || [];
        for (var i = 0; i < items.length; i++) {
          out.push({
            channelId: items[i].snippet.resourceId.channelId,
            title: items[i].snippet.title,
            avatar: thumb(items[i].snippet),
          });
        }
        if (data.nextPageToken && n < 4) {
          page(data.nextPageToken, n + 1);
        } else {
          YTU.cachePut("me:subs", out, 1800);
          onOk(out);
        }
      }, onErr);
    }
    page("", 1);
  }

  // Latest uploads from your subscriptions: 1 unit per channel, cached 20 minutes.
  function feed(onOk, onErr) {
    var hit = YTU.cacheGet("me:feed");
    if (hit) {
      onOk(hit);
      return;
    }
    subscriptions(function (subs) {
      var channels = subs.slice(0, 30);
      var pending = channels.length;
      var ids = [];
      var avatars = {};
      if (!pending) {
        onOk({ channels: subs, videos: [] });
        return;
      }
      function oneDone() {
        pending -= 1;
        if (pending) {
          return;
        }
        // Newest first; details() keeps the order of ids, so sort after.
        var chunks = [];
        for (var i = 0; i < ids.length; i += 50) {
          chunks.push(ids.slice(i, i + 50));
        }
        var videos = [];
        var left = chunks.length;
        if (!left) {
          onOk({ channels: subs, videos: [] });
          return;
        }
        function got(list) {
          videos = videos.concat(list);
          left -= 1;
          if (left) {
            return;
          }
          videos.sort(function (a, b) {
            return a.published < b.published ? 1 : -1;
          });
          for (var v = 0; v < videos.length; v++) {
            videos[v].avatar = avatars[videos[v].channelId] || "";
          }
          var result = { channels: subs, videos: videos.slice(0, 80) };
          YTU.cachePut("me:feed", result, 1200);
          onOk(result);
        }
        for (var c = 0; c < chunks.length; c++) {
          details(chunks[c], got, function () {
            got([]);
          });
        }
      }
      for (var i = 0; i < channels.length; i++) {
        avatars[channels[i].channelId] = channels[i].avatar;
        api("GET", "playlistItems", { part: "contentDetails", playlistId: "UU" + channels[i].channelId.slice(2), maxResults: 4 }, null, function (data) {
          var items = data.items || [];
          for (var j = 0; j < items.length; j++) {
            ids.push(items[j].contentDetails.videoId);
          }
          oneDone();
        }, oneDone);
      }
    }, onErr);
  }

  function liked(onOk, onErr) {
    cached("me:liked", 300, "videos", { part: "snippet,statistics,contentDetails", myRating: "like", maxResults: 50 }, function (data) {
      var out = [];
      var items = data.items || [];
      for (var i = 0; i < items.length; i++) {
        out.push(fromVideo(items[i]));
      }
      onOk(out);
    }, onErr);
  }

  function playlists(onOk, onErr) {
    cached("me:playlists", 300, "playlists", { part: "snippet,contentDetails", mine: "true", maxResults: 50 }, function (data) {
      var out = [];
      var items = data.items || [];
      for (var i = 0; i < items.length; i++) {
        out.push({
          id: items[i].id,
          title: items[i].snippet.title,
          count: +((items[i].contentDetails || {}).itemCount || 0),
          thumb: thumb(items[i].snippet),
        });
      }
      onOk(out);
    }, onErr);
  }

  function subscriptionId(channelId, onOk, onErr) {
    api("GET", "subscriptions", { part: "id", mine: "true", forChannelId: channelId }, null, function (data) {
      onOk(((data.items || [])[0] || {}).id || "");
    }, onErr);
  }

  function rating(videoId, onOk, onErr) {
    api("GET", "videos/getRating", { id: videoId }, null, function (data) {
      onOk((((data.items || [])[0]) || {}).rating || "none");
    }, onErr);
  }

  function rate(videoId, value, onOk, onErr) {
    api("POST", "videos/rate", { id: videoId, rating: value }, null, function () {
      YTU.cacheClear("me:liked");
      onOk();
    }, onErr);
  }

  function subscribe(channelId, on, onOk, onErr) {
    function done() {
      YTU.cacheClear("me:subs");
      YTU.cacheClear("me:feed");
      onOk();
    }
    if (on) {
      api("POST", "subscriptions", { part: "snippet" }, { snippet: { resourceId: { kind: "youtube#channel", channelId: channelId } } }, done, function (msg, reason) {
        if (reason === "subscriptionDuplicate") {
          done();
        } else {
          onErr(msg);
        }
      });
      return;
    }
    subscriptionId(channelId, function (id) {
      if (!id) {
        done();
        return;
      }
      api("DELETE", "subscriptions", { id: id }, null, done, onErr);
    }, onErr);
  }

  function save(videoId, playlistId, onOk, onErr) {
    api("POST", "playlistItems", { part: "snippet" }, { snippet: { playlistId: playlistId, resourceId: { kind: "youtube#video", videoId: videoId } } }, function () {
      YTU.cacheClear("me:playlists");
      YTU.cacheClear("me:pl:" + playlistId);
      onOk();
    }, onErr);
  }

  function createPlaylist(title, onOk, onErr) {
    api("POST", "playlists", { part: "snippet,status" }, { snippet: { title: title }, status: { privacyStatus: "private" } }, function (data) {
      YTU.cacheClear("me:playlists");
      onOk({ id: data.id, title: title });
    }, onErr);
  }

  function fromComment(top) {
    return {
      author: top.authorDisplayName || "",
      avatar: top.authorProfileImageUrl || "",
      text: top.textOriginal || top.textDisplay || "",
      likes: +top.likeCount || 0,
      published: top.publishedAt || "",
    };
  }

  function comments(videoId, pageToken, onOk, onErr) {
    api("GET", "commentThreads", { part: "snippet", videoId: videoId, maxResults: 20, order: "relevance", textFormat: "plainText", pageToken: pageToken }, null, function (data) {
      var out = [];
      var items = data.items || [];
      for (var i = 0; i < items.length; i++) {
        var c = fromComment(items[i].snippet.topLevelComment.snippet);
        c.replies = +items[i].snippet.totalReplyCount || 0;
        out.push(c);
      }
      onOk({ comments: out, next: data.nextPageToken || "" });
    }, function (msg, reason) {
      if (reason === "commentsDisabled") {
        onOk({ disabled: true, comments: [], next: "" });
      } else {
        onErr(msg);
      }
    });
  }

  function addComment(videoId, text, onOk, onErr) {
    api("POST", "commentThreads", { part: "snippet" }, { snippet: { videoId: videoId, topLevelComment: { snippet: { textOriginal: text } } } }, function (data) {
      var c = fromComment(data.snippet.topLevelComment.snippet);
      c.text = c.text || text;
      c.replies = 0;
      onOk(c);
    }, onErr);
  }

  return {
    signedIn: signedIn,
    canBrowse: canBrowse,
    canSignIn: canSignIn,
    profile: function () {
      return signedIn() ? auth.profile : null;
    },
    onSignedOut: function (fn) {
      onSignedOut = fn;
    },
    startSignIn: startSignIn,
    pollSignIn: pollSignIn,
    signOut: signOut,
    search: search,
    suggest: suggest,
    video: video,
    channel: channel,
    channelVideos: channelVideos,
    playlistVideos: playlistVideos,
    subscriptions: subscriptions,
    feed: feed,
    liked: liked,
    playlists: playlists,
    rating: rating,
    subscriptionId: subscriptionId,
    rate: rate,
    subscribe: subscribe,
    save: save,
    createPlaylist: createPlaylist,
    comments: comments,
    addComment: addComment,
  };
})();
