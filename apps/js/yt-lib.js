/* Shared helpers for the YouTube page. ES5 only: this runs on iOS 12 Safari.
 * Named YTU because YouTube's player script owns the global YT. */
var YTU = (function () {
  "use strict";

  var COLORS = ["#c00", "#065fd4", "#065", "#e37400", "#7e37d8"];

  function byId(id) {
    return document.getElementById(id);
  }

  function hasClass(el, name) {
    return (" " + el.className + " ").indexOf(" " + name + " ") !== -1;
  }

  function addClass(el, name) {
    if (el && !hasClass(el, name)) {
      el.className = el.className ? el.className + " " + name : name;
    }
  }

  function removeClass(el, name) {
    if (!el) {
      return;
    }
    el.className = (" " + el.className + " ")
      .replace(" " + name + " ", " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function toggleClass(el, name, on) {
    if (on) {
      addClass(el, name);
    } else {
      removeClass(el, name);
    }
  }

  function show(el, on) {
    toggleClass(typeof el === "string" ? byId(el) : el, "hidden", !on);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function trim(value) {
    return String(value || "").replace(/^\s+|\s+$/g, "");
  }

  // ---- storage (localStorage can throw in private mode) ----------------

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (err) {}
  }

  // ---- formatting -------------------------------------------------------

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatDuration(sec) {
    sec = parseInt(sec, 10);
    if (!sec || sec < 0) {
      return "";
    }
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  function shortCount(n) {
    n = parseInt(n, 10) || 0;
    if (n >= 1000000000) {
      return Math.round(n / 100000000) / 10 + "B";
    }
    if (n >= 1000000) {
      return Math.round(n / 100000) / 10 + "M";
    }
    if (n >= 1000) {
      return (n >= 10000 ? Math.round(n / 1000) : Math.round(n / 100) / 10) + "K";
    }
    return String(n);
  }

  function formatViews(n) {
    n = parseInt(n, 10);
    return n ? shortCount(n) + " views" : "";
  }

  function parseDate(value) {
    if (!value) {
      return null;
    }
    // Safari 12 cannot parse "2026-10-20T10:00:00+00:00" reliably; normalise it.
    var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
    if (!m) {
      return null;
    }
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  }

  function timeAgo(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var sec = Math.max(0, (Date.now() - date.getTime()) / 1000);
    var units = [
      [31536000, "year"],
      [2592000, "month"],
      [604800, "week"],
      [86400, "day"],
      [3600, "hour"],
      [60, "minute"],
    ];
    var i;
    for (i = 0; i < units.length; i++) {
      if (sec >= units[i][0]) {
        var n = Math.floor(sec / units[i][0]);
        return n + " " + units[i][1] + (n === 1 ? "" : "s") + " ago";
      }
    }
    return "just now";
  }

  function joinBits(bits) {
    var out = [];
    var i;
    for (i = 0; i < bits.length; i++) {
      if (bits[i]) {
        out.push(bits[i]);
      }
    }
    return out.join(" · ");
  }

  function extractVideoId(value) {
    var trimmed = trim(value);
    if (!trimmed) {
      return null;
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    var match = trimmed.match(/(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  // mqdefault (320x180) instead of hqdefault (480x360): a third of the memory per
  // card, which matters on a 1 GB iPad.
  function thumbUrl(id) {
    return "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg";
  }

  function avatarInto(node, name, url, index) {
    node.innerHTML = "";
    node.style.background = COLORS[(index || 0) % COLORS.length];
    if (url) {
      var img = el("img");
      img.alt = "";
      img.src = url;
      node.appendChild(img);
      node.style.background = "#ddd";
    } else {
      node.textContent = trim(name || "Y").charAt(0).toUpperCase() || "Y";
    }
  }

  // ---- network ----------------------------------------------------------

  function xhr(method, url, headers, body, onOk, onErr) {
    var req = new XMLHttpRequest();
    req.open(method, url, true);
    req.timeout = 30000;
    var name;
    for (name in headers || {}) {
      if (headers.hasOwnProperty(name)) {
        req.setRequestHeader(name, headers[name]);
      }
    }
    var done = false;
    function finish(fn, a, b) {
      if (!done) {
        done = true;
        fn(a, b);
      }
    }
    req.onreadystatechange = function () {
      if (req.readyState !== 4 || req.status === 0) {
        return; // onerror / ontimeout report network failures
      }
      var data = null;
      try {
        data = req.responseText ? JSON.parse(req.responseText) : {};
      } catch (err) {}
      if (req.status >= 200 && req.status < 300) {
        finish(onOk, data || {});
      } else {
        finish(onErr, data || {}, req.status);
      }
    };
    req.onerror = function () {
      finish(onErr, { offline: true }, 0);
    };
    req.ontimeout = function () {
      finish(onErr, { offline: true }, 0);
    };
    req.send(body || null);
  }

  // Google's search suggestions have no CORS headers, but they do support JSONP.
  var jsonpCount = 0;
  function jsonp(url, onOk, onErr) {
    jsonpCount += 1;
    var name = "ytJsonp" + jsonpCount;
    var script = document.createElement("script");
    var timer = setTimeout(function () {
      cleanup();
      onErr();
    }, 8000);
    function cleanup() {
      clearTimeout(timer);
      window[name] = function () {};
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }
    window[name] = function (data) {
      cleanup();
      onOk(data);
    };
    script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "callback=" + name;
    script.onerror = function () {
      cleanup();
      onErr();
    };
    document.body.appendChild(script);
  }

  // Only the newest request for a given slot may paint; older replies are dropped.
  var seq = {};
  function latest(slot) {
    var n = (seq[slot] || 0) + 1;
    seq[slot] = n;
    return function () {
      return seq[slot] === n;
    };
  }

  function q(params) {
    var parts = [];
    var key;
    for (key in params) {
      if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== null && params[key] !== "") {
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
      }
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  // ---- response cache in localStorage (saves YouTube API quota) ---------

  var CACHE_PREFIX = "ytc:";

  function cacheGet(key) {
    var hit = load(CACHE_PREFIX + key, null);
    return hit && hit.until > Date.now() ? hit.value : null;
  }

  function cachePut(key, value, seconds) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ until: Date.now() + seconds * 1000, value: value }));
    } catch (err) {
      // Storage full: drop every cached response and try once more.
      cacheClear();
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ until: Date.now() + seconds * 1000, value: value }));
      } catch (err2) {}
    }
  }

  function cacheClear(prefix) {
    var drop = [];
    var i;
    try {
      for (i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX + (prefix || "")) === 0) {
          drop.push(k);
        }
      }
      for (i = 0; i < drop.length; i++) {
        localStorage.removeItem(drop[i]);
      }
    } catch (err) {}
  }

  // Once a day, drop expired cache entries (and the old full-reply "videos:" ones).
  // A few keys per turn: parsing the whole cache at once stalls an iPad mini 2.
  function cachePrune() {
    if (load("ytPruned", 0) > Date.now() - 86400000) {
      return;
    }
    var keys = [];
    var i;
    try {
      for (i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) {
          keys.push(k);
        }
      }
    } catch (err) {
      return;
    }
    var now = Date.now();
    var index = 0;
    function step() {
      var end = Math.min(index + 4, keys.length);
      for (; index < end; index++) {
        var key = keys[index];
        try {
          if (key.indexOf(CACHE_PREFIX + "videos:") === 0) {
            localStorage.removeItem(key);
            continue;
          }
          var hit = load(key, null);
          if (!hit || hit.until < now) {
            localStorage.removeItem(key);
          }
        } catch (err) {}
      }
      if (index < keys.length) {
        setTimeout(step, 40);
      } else {
        store("ytPruned", now);
      }
    }
    step();
  }

  return {
    byId: byId,
    hasClass: hasClass,
    addClass: addClass,
    removeClass: removeClass,
    toggleClass: toggleClass,
    show: show,
    el: el,
    trim: trim,
    load: load,
    store: store,
    formatDuration: formatDuration,
    shortCount: shortCount,
    formatViews: formatViews,
    timeAgo: timeAgo,
    joinBits: joinBits,
    extractVideoId: extractVideoId,
    thumbUrl: thumbUrl,
    avatarInto: avatarInto,
    xhr: xhr,
    jsonp: jsonp,
    q: q,
    latest: latest,
    cacheGet: cacheGet,
    cachePut: cachePut,
    cacheClear: cacheClear,
    cachePrune: cachePrune,
  };
})();
