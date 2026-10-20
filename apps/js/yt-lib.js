/* Shared helpers for the YouTube page. ES5 only: this runs on iOS 12 Safari. */
var YT = (function () {
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

  function thumbUrl(id) {
    return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
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

  var session = load("ytSession", "");
  var onSignedOut = null;

  function request(method, url, body, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 60000;
    if (session) {
      xhr.setRequestHeader("X-Session", session);
    }
    if (body) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    var done = false;
    function fail(message, status) {
      if (!done) {
        done = true;
        if (onErr) {
          onErr(message, status);
        }
      }
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || done) {
        return;
      }
      if (xhr.status === 0) {
        return; // onerror / ontimeout report it
      }
      var data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (err) {}
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        done = true;
        onOk(data);
        return;
      }
      if (xhr.status === 401 && session && url.indexOf("/api/me/") === 0) {
        setSession("");
        if (onSignedOut) {
          onSignedOut();
        }
      }
      fail((data && data.error) || "Something went wrong (HTTP " + xhr.status + ")", xhr.status);
    };
    xhr.onerror = function () {
      fail("Can't reach the Mac. Is serve.sh running?", 0);
    };
    xhr.ontimeout = function () {
      fail("The Mac took too long to answer. Try again.", 0);
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function get(url, onOk, onErr) {
    request("GET", url, null, onOk, onErr);
  }

  function post(url, body, onOk, onErr) {
    request("POST", url, body || {}, onOk, onErr);
  }

  function setSession(value) {
    session = value || "";
    store("ytSession", session || null);
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
    get: get,
    post: post,
    q: q,
    latest: latest,
    setSession: setSession,
    hasSession: function () {
      return !!session;
    },
    onSignedOut: function (fn) {
      onSignedOut = fn;
    },
  };
})();
