(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function extractVideoId(value) {
    if (!value) {
      return null;
    }
    var trimmed = String(value).replace(/^\s+|\s+$/g, "");
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    var match = trimmed.match(
      /(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    return match ? match[1] : null;
  }

  function goSearch(event) {
    event.preventDefault();
    var q = byId("q").value.replace(/^\s+|\s+$/g, "");
    if (!q) {
      return;
    }
    window.location.href =
      "https://m.youtube.com/results?search_query=" + encodeURIComponent(q);
  }

  function playPasted(event) {
    event.preventDefault();
    var raw = byId("url").value;
    var id = extractVideoId(raw);
    var err = byId("url-error");
    var wrap = byId("player-wrap");
    var frame = byId("player");
    if (!id) {
      err.textContent =
        "Paste a full YouTube link, or an 11-character video id.";
      err.className = "error";
      wrap.className = "player-wrap hidden";
      return;
    }
    err.textContent = "";
    err.className = "error hidden";
    frame.src =
      "https://www.youtube.com/embed/" +
      encodeURIComponent(id) +
      "?playsinline=1&rel=0";
    wrap.className = "player-wrap";
  }

  function openSite() {
    window.location.href = "https://m.youtube.com";
  }

  document.addEventListener("DOMContentLoaded", function () {
    byId("search-form").addEventListener("submit", goSearch);
    byId("play-form").addEventListener("submit", playPasted);
    byId("open-youtube").addEventListener("click", openSite);
  });
})();
