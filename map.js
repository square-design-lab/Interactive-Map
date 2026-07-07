/* =====================================================================
   SDL Dynamic Map  —  v1.0
   Square Design Lab
   ---------------------------------------------------------------------
   Renders a multi-pin Leaflet map from a Squarespace Blog collection.
   - Takes over a native Map Block (or renders into a #container div).
   - Coordinates come from the native Location field OR an excerpt
     token like  [map: 40.7484, -73.9857].
   - Optional marker clustering, category filter bar and location sidebar.

   No build step, no framework, no API key. Reads window.SDL_MAP_CONFIG.
   ===================================================================== */
(function () {
  "use strict";

  /* -------------------------------------------------- Config + defaults */
  var USER = window.SDL_MAP_CONFIG || {};

  var DEFAULTS = {
    collectionUrl: "/blog",     // Blog collection to read pins from
    target: "auto",             // "auto" | "native" | "container"
    containerId: "sdl-map",     // fallback container id (Code Block)

    coordSource: "location",    // "location" | "excerpt" | "auto"
    excerptTag: "map",          // token name -> [map: lat, lng]

    height: 500,                // map height in px
    mapStyle: "carto-voyager",  // osm | carto-light | carto-dark | carto-voyager
    defaultZoom: 13,
    autoFit: true,              // frame all pins on load
    scrollWheelZoom: false,
    showZoomControl: true,

    /* markers */
    markerType: "pin",          // "pin" | "image"
    markerColor: "#E5484D",
    markerSize: 42,
    markerImageUrl: "",

    /* clustering */
    cluster: true,

    /* popup */
    popupImage: true,
    popupExcerpt: true,
    popupCategory: true,
    popupAddress: true,
    popupReadMore: true,
    readMoreText: "Read more",
    viewOnMap: true,            // Google Maps link
    viewOnMapText: "View on Google Maps",
    excerptLength: 110,

    /* category filter */
    categoryFilter: true,
    filterSource: "categories", // "categories" | "tags"
    allLabel: "All",

    /* sidebar list */
    sidebar: false,
    sidebarPosition: "left",    // "left" | "right"
    sidebarWidth: 340
  };

  var cfg = {};
  for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
  for (var u in USER) if (USER[u] !== undefined && USER[u] !== null) cfg[u] = USER[u];

  var TILES = {
    "osm": {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr: '&copy; OpenStreetMap contributors'
    },
    "carto-light": {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attr: '&copy; OpenStreetMap &copy; CARTO'
    },
    "carto-dark": {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attr: '&copy; OpenStreetMap &copy; CARTO'
    },
    "carto-voyager": {
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      attr: '&copy; OpenStreetMap &copy; CARTO'
    }
  };

  var LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  var LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  var MC_CSS1 = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css";
  var MC_CSS2 = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css";
  var MC_JS = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js";

  /* -------------------------------------------------- Tiny helpers */
  function log() {
    if (window.SDL_MAP_DEBUG) console.log.apply(console, ["[SDL Map]"].concat([].slice.call(arguments)));
  }
  function warn() { console.warn.apply(console, ["[SDL Map]"].concat([].slice.call(arguments))); }

  function loadCSS(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }

  function loadJS(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded) return resolve();
        existing.addEventListener("load", function () { resolve(); });
        existing.addEventListener("error", reject);
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { s.dataset.loaded = "1"; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stripHtml(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  }

  function truncate(text, n) {
    if (!n || text.length <= n) return text;
    return text.slice(0, n).replace(/\s+\S*$/, "") + "…";
  }

  /* -------------------------------------------------- Coordinate parsing */
  // Matches  [map: 40.7484, -73.9857]  (tag name configurable)
  function excerptCoords(rawExcerpt) {
    if (!rawExcerpt) return null;
    var tag = (cfg.excerptTag || "map").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("\\[\\s*" + tag + "\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]", "i");
    var m = String(rawExcerpt).match(re);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }

  function locationCoords(loc) {
    if (!loc) return null;
    var lat = (loc.markerLat != null) ? loc.markerLat : loc.mapLat;
    var lng = (loc.markerLng != null) ? loc.markerLng : loc.mapLng;
    if (lat == null || lng == null) return null;
    return { lat: parseFloat(lat), lng: parseFloat(lng) };
  }

  function resolveCoords(item) {
    var fromLoc = locationCoords(item.location);
    var fromExc = excerptCoords(item.excerpt);
    if (cfg.coordSource === "excerpt") return fromExc;
    if (cfg.coordSource === "location") return fromLoc;
    // auto: excerpt override wins, else native location field
    return fromExc || fromLoc;
  }

  // Remove the [map: ...] token from displayed excerpt text
  function cleanExcerpt(rawExcerpt) {
    var text = stripHtml(rawExcerpt);
    var tag = (cfg.excerptTag || "map").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("\\[\\s*" + tag + "\\s*:[^\\]]*\\]", "ig");
    return text.replace(re, "").replace(/^["'\s]+/, "").trim();
  }

  /* -------------------------------------------------- Fetch collection (paginated) */
  function fetchAll(url) {
    var base = url.split("?")[0];
    var items = [];
    function page(offset) {
      var u = base + "?format=json&nocache=" + Date.now() + (offset ? "&offset=" + offset : "");
      return fetch(u, { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status + " fetching " + base);
          return r.json();
        })
        .then(function (data) {
          var batch = data.items || [];
          items = items.concat(batch);
          var pg = data.pagination || {};
          if (pg.nextPage && pg.nextPageOffset && batch.length) {
            return page(pg.nextPageOffset);
          }
          return items;
        });
    }
    return page(null);
  }

  /* -------------------------------------------------- Build marker records */
  function buildRecords(items) {
    var records = [];
    items.forEach(function (item) {
      var coords = resolveCoords(item);
      if (!coords || isNaN(coords.lat) || isNaN(coords.lng)) return; // skip pin-less posts
      var loc = item.location || {};
      var addrParts = [loc.addressLine1, loc.addressLine2, loc.addressCountry].filter(Boolean);
      records.push({
        title: item.title || "",
        url: item.fullUrl || "#",
        image: item.assetUrl || "",
        excerpt: cleanExcerpt(item.excerpt),
        categories: item.categories || [],
        tags: item.tags || [],
        address: addrParts.join(", "),
        addressTitle: loc.addressTitle || "",
        lat: coords.lat,
        lng: coords.lng
      });
    });
    return records;
  }

  /* -------------------------------------------------- Icons */
  function makeIcon() {
    var size = parseInt(cfg.markerSize, 10) || 42;
    if (cfg.markerType === "image" && cfg.markerImageUrl) {
      return L.icon({
        iconUrl: cfg.markerImageUrl,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -size + 4],
        className: "sdlmap-custom-icon"
      });
    }
    // SVG teardrop pin, coloured via config
    var color = cfg.markerColor || "#E5484D";
    var svg =
      '<svg viewBox="0 0 24 32" width="' + size + '" height="' + Math.round(size * 32 / 24) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0z" fill="' + color + '"/>' +
      '<circle cx="12" cy="12" r="4.5" fill="#ffffff"/></svg>';
    var h = Math.round(size * 32 / 24);
    return L.divIcon({
      html: svg,
      className: "sdlmap-pin",
      iconSize: [size, h],
      iconAnchor: [size / 2, h],
      popupAnchor: [0, -h + 6]
    });
  }

  /* -------------------------------------------------- Popup HTML */
  function popupHtml(rec) {
    var parts = ['<div class="sdlmap-popup">'];
    if (cfg.popupImage && rec.image) {
      parts.push('<a class="sdlmap-popup-img" href="' + esc(rec.url) + '" style="background-image:url(' + esc(rec.image) + '?format=500w)"></a>');
    }
    parts.push('<div class="sdlmap-popup-body">');
    if (cfg.popupCategory && rec.categories.length) {
      parts.push('<div class="sdlmap-popup-cat">' + esc(rec.categories[0]) + '</div>');
    }
    parts.push('<a class="sdlmap-popup-title" href="' + esc(rec.url) + '">' + esc(rec.title) + '</a>');
    if (cfg.popupAddress && rec.address) {
      parts.push('<div class="sdlmap-popup-addr">' + esc(rec.address) + '</div>');
    }
    if (cfg.popupExcerpt && rec.excerpt) {
      parts.push('<div class="sdlmap-popup-exc">' + esc(truncate(rec.excerpt, cfg.excerptLength)) + '</div>');
    }
    var links = [];
    if (cfg.popupReadMore) {
      links.push('<a class="sdlmap-popup-more" href="' + esc(rec.url) + '">' + esc(cfg.readMoreText) + '</a>');
    }
    if (cfg.viewOnMap) {
      var g = "https://www.google.com/maps/search/?api=1&query=" + rec.lat + "," + rec.lng;
      links.push('<a class="sdlmap-popup-gmap" href="' + g + '" target="_blank" rel="noopener">' + esc(cfg.viewOnMapText) + '</a>');
    }
    if (links.length) parts.push('<div class="sdlmap-popup-links">' + links.join("") + "</div>");
    parts.push("</div></div>");
    return parts.join("");
  }

  /* -------------------------------------------------- Category list */
  function collectCategories(records) {
    var seen = {};
    var list = [];
    records.forEach(function (r) {
      (cfg.filterSource === "tags" ? r.tags : r.categories).forEach(function (c) {
        if (!seen[c]) { seen[c] = true; list.push(c); }
      });
    });
    return list;
  }

  /* -------------------------------------------------- Container resolution */
  function resolveContainer() {
    // native map block takeover
    if (cfg.target === "native" || cfg.target === "auto") {
      var block = document.querySelector(".sqs-block-map .sqs-block-content, .map-block .sqs-block-content, .sqs-block-map");
      if (block) {
        block.innerHTML = "";
        block.classList.add("sdlmap-took-over");
        return block;
      }
      if (cfg.target === "native") {
        warn("target=native but no Map Block found on page.");
      }
    }
    // explicit container div (Code Block)
    var el = document.getElementById(cfg.containerId);
    if (el) return el;

    if (cfg.target === "auto") {
      warn("No Map Block and no #" + cfg.containerId + " found. Add a Code Block with <div id=\"" + cfg.containerId + "\"></div>.");
    }
    return null;
  }

  /* -------------------------------------------------- Build the whole UI */
  function render(host, records) {
    var categories = cfg.categoryFilter ? collectCategories(records) : [];

    // Layout scaffold
    var root = document.createElement("div");
    root.className = "sdlmap-root" +
      (cfg.sidebar ? " sdlmap-has-sidebar sdlmap-sidebar-" + cfg.sidebarPosition : "");
    root.style.setProperty("--sdlmap-height", (parseInt(cfg.height, 10) || 500) + "px");
    root.style.setProperty("--sdlmap-sidebar-width", (parseInt(cfg.sidebarWidth, 10) || 340) + "px");

    // Filter bar
    var filterBar = null;
    if (cfg.categoryFilter && categories.length) {
      filterBar = document.createElement("div");
      filterBar.className = "sdlmap-filterbar";
      var btns = [cfg.allLabel].concat(categories);
      btns.forEach(function (label, i) {
        var b = document.createElement("button");
        b.className = "sdlmap-filter-btn" + (i === 0 ? " active" : "");
        b.textContent = label;
        b.dataset.cat = i === 0 ? "__all__" : label;
        filterBar.appendChild(b);
      });
      root.appendChild(filterBar);
    }

    // Body (sidebar + map)
    var body = document.createElement("div");
    body.className = "sdlmap-body";

    var sidebar = null;
    if (cfg.sidebar) {
      sidebar = document.createElement("div");
      sidebar.className = "sdlmap-sidebar";
      body.appendChild(sidebar);
    }

    var mapEl = document.createElement("div");
    mapEl.className = "sdlmap-canvas";
    body.appendChild(mapEl);
    root.appendChild(body);

    host.appendChild(root);

    /* ---- Leaflet map ---- */
    var tile = TILES[cfg.mapStyle] || TILES["carto-voyager"];
    var map = L.map(mapEl, {
      scrollWheelZoom: !!cfg.scrollWheelZoom,
      zoomControl: !!cfg.showZoomControl
    });
    L.tileLayer(tile.url, { attribution: tile.attr, maxZoom: 19 }).addTo(map);

    var icon = makeIcon();
    var layerGroup = (cfg.cluster && L.markerClusterGroup)
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 })
      : L.layerGroup();

    var markerByIndex = [];
    records.forEach(function (rec, i) {
      var m = L.marker([rec.lat, rec.lng], { icon: icon });
      m.bindPopup(popupHtml(rec), { minWidth: 220, maxWidth: 280, className: "sdlmap-popup-wrap" });
      m._sdlRec = rec;
      layerGroup.addLayer(m);
      markerByIndex.push(m);
    });
    map.addLayer(layerGroup);

    function fitAll(markers) {
      var pts = markers.map(function (m) { return m.getLatLng(); });
      if (pts.length === 1) {
        map.setView(pts[0], parseInt(cfg.defaultZoom, 10) || 13);
      } else if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
      } else {
        map.setView([20, 0], 2);
      }
    }
    if (cfg.autoFit) fitAll(markerByIndex);
    else if (markerByIndex.length) map.setView(markerByIndex[0].getLatLng(), parseInt(cfg.defaultZoom, 10) || 13);

    /* ---- Sidebar list ---- */
    var sidebarCards = [];
    if (sidebar) {
      records.forEach(function (rec, i) {
        var card = document.createElement("div");
        card.className = "sdlmap-card";
        card.dataset.index = i;
        var img = (cfg.popupImage && rec.image)
          ? '<div class="sdlmap-card-img" style="background-image:url(' + esc(rec.image) + '?format=300w)"></div>' : "";
        var cat = (rec.categories.length ? '<div class="sdlmap-card-cat">' + esc(rec.categories[0]) + "</div>" : "");
        var addr = (rec.address ? '<div class="sdlmap-card-addr">' + esc(rec.address) + "</div>" : "");
        var exc = (rec.excerpt ? '<div class="sdlmap-card-exc">' + esc(truncate(rec.excerpt, 90)) + "</div>" : "");
        card.innerHTML = img +
          '<div class="sdlmap-card-body">' + cat +
          '<div class="sdlmap-card-title">' + esc(rec.title) + "</div>" +
          addr + exc + "</div>";
        card.addEventListener("click", function () {
          var m = markerByIndex[i];
          if (cfg.cluster && layerGroup.zoomToShowLayer) {
            layerGroup.zoomToShowLayer(m, function () { m.openPopup(); });
          } else {
            map.setView(m.getLatLng(), Math.max(map.getZoom(), 14));
            m.openPopup();
          }
          sidebarCards.forEach(function (c) { c.classList.remove("active"); });
          card.classList.add("active");
        });
        sidebar.appendChild(card);
        sidebarCards.push(card);
      });
    }

    /* ---- Category filtering ---- */
    if (filterBar) {
      filterBar.addEventListener("click", function (e) {
        var btn = e.target.closest(".sdlmap-filter-btn");
        if (!btn) return;
        filterBar.querySelectorAll(".sdlmap-filter-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        var cat = btn.dataset.cat;
        var shown = [];
        layerGroup.clearLayers();
        records.forEach(function (rec, i) {
          var pool = cfg.filterSource === "tags" ? rec.tags : rec.categories;
          var match = cat === "__all__" || pool.indexOf(cat) !== -1;
          if (sidebarCards[i]) sidebarCards[i].style.display = match ? "" : "none";
          if (match) { layerGroup.addLayer(markerByIndex[i]); shown.push(markerByIndex[i]); }
        });
        if (cfg.autoFit) fitAll(shown);
      });
    }

    // Fix tile sizing after layout settles
    setTimeout(function () { map.invalidateSize(); if (cfg.autoFit) fitAll(markerByIndex); }, 200);
    window.SDL_MAP_INSTANCE = { map: map, records: records, config: cfg };
    log("Rendered", records.length, "pins");
  }

  /* -------------------------------------------------- Boot */
  function boot() {
    var host = resolveContainer();
    if (!host) return;
    host.classList.add("sdlmap-host");

    // load leaflet, then optional markercluster
    loadCSS(LEAFLET_CSS);
    if (cfg.cluster) { loadCSS(MC_CSS1); loadCSS(MC_CSS2); }

    loadJS(LEAFLET_JS)
      .then(function () { return cfg.cluster ? loadJS(MC_JS) : null; })
      .then(function () { return fetchAll(cfg.collectionUrl); })
      .then(function (items) {
        var records = buildRecords(items);
        if (!records.length) {
          warn("No posts with coordinates found in " + cfg.collectionUrl +
            ". Check the Location field or the [" + cfg.excerptTag + ": lat, lng] excerpt token.");
          host.innerHTML = '<div class="sdlmap-empty">No mappable locations found.</div>';
          return;
        }
        render(host, records);
      })
      .catch(function (err) {
        warn("Failed to build map:", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
