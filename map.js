/* =====================================================================
   SDL Dynamic Map  —  v1.1
   Square Design Lab
   ===================================================================== */
(function () {
  "use strict";

  /* -------------------------------------------------- Config */
  var USER = window.SDL_MAP_CONFIG || {};
  var DEFAULTS = {
    collectionUrl: "/blog",
    target: "auto",
    containerId: "sdl-map",
    coordSource: "location",
    excerptTag: "map",

    mapStyle: "carto-voyager",
    defaultZoom: 13,
    autoFit: true,
    scrollWheelZoom: false,
    showZoomControl: true,

    markerType: "pin",
    markerColor: "#E5484D",
    markerSize: 42,
    markerImageUrl: "",
    cluster: false,

    popupWidth: 320,
    popupImage: true,
    popupExcerpt: true,
    popupCategory: false,
    popupAddress: false,
    popupReadMore: true,
    readMoreText: "Read more",
    viewOnMap: false,
    viewOnMapText: "View on Google Maps",
    excerptLength: 120,

    search: false,
    searchPlaceholder: "Search locations…",

    categoryFilter: false,
    categoryLabel: "",
    allLabel: "All",

    tagFilter: false,
    tagLabel: "",
    tagFilterType: "pills",
    priceMin: 0,
    priceMax: 1000000,
    pricePrefix: "$",
    priceStep: 1000,
    allTagLabel: "All",

    sidebar: false,
    sidebarPosition: "left",
    sidebarWidth: 340
  };

  var cfg = {};
  for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
  for (var u in USER) if (USER[u] !== undefined && USER[u] !== null) cfg[u] = USER[u];

  var TILES = {
    "osm":           { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                               attr: "&copy; OpenStreetMap contributors" },
    "carto-light":   { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",                  attr: "&copy; OpenStreetMap &copy; CARTO" },
    "carto-dark":    { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",                   attr: "&copy; OpenStreetMap &copy; CARTO" },
    "carto-voyager": { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",        attr: "&copy; OpenStreetMap &copy; CARTO" }
  };

  /* -------------------------------------------------- Helpers */
  function warn() { console.warn.apply(console, ["[SDL Map]"].concat([].slice.call(arguments))); }

  function loadCSS(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  }

  function loadJS(src) {
    return new Promise(function (res, rej) {
      var e = document.querySelector('script[src="' + src + '"]');
      if (e) { if (e.dataset.loaded) return res(); e.addEventListener("load", res); e.addEventListener("error", rej); return; }
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { s.dataset.loaded = "1"; res(); }; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function stripHtml(h) { var t = document.createElement("div"); t.innerHTML = h || ""; return (t.textContent || t.innerText || "").trim(); }

  function truncate(t, n) { if (!n || t.length <= n) return t; return t.slice(0, n).replace(/\s+\S*$/, "") + "…"; }

  function formatPrice(n) {
    var s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (cfg.pricePrefix || "") + s;
  }

  /* -------------------------------------------------- Coordinate parsing */
  function excerptCoords(raw) {
    if (!raw) return null;
    var tag = (cfg.excerptTag || "map").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("\\[\\s*" + tag + "\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]", "i");
    var m = String(raw).match(re);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }

  function locationCoords(loc) {
    if (!loc) return null;
    var lat = loc.markerLat != null ? loc.markerLat : loc.mapLat;
    var lng = loc.markerLng != null ? loc.markerLng : loc.mapLng;
    if (lat == null || lng == null) return null;
    return { lat: parseFloat(lat), lng: parseFloat(lng) };
  }

  function resolveCoords(item) {
    var fl = locationCoords(item.location), fe = excerptCoords(item.excerpt);
    if (cfg.coordSource === "excerpt") return fe;
    if (cfg.coordSource === "location") return fl;
    return fe || fl;
  }

  function cleanExcerpt(raw) {
    var text = stripHtml(raw);
    var tag = (cfg.excerptTag || "map").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp("\\[\\s*" + tag + "\\s*:[^\\]]*\\]", "ig"), "").replace(/^["'\s]+/, "").trim();
  }

  /* -------------------------------------------------- Price helpers */
  function parseTagPrice(tag) {
    var n = parseFloat(String(tag).replace(/,/g, "").replace(/[^0-9.]/g, ""));
    return isNaN(n) ? null : n;
  }

  function getRecordPrice(rec) {
    for (var i = 0; i < rec.tags.length; i++) {
      var p = parseTagPrice(rec.tags[i]);
      if (p !== null) return p;
    }
    return null;
  }

  /* -------------------------------------------------- Fetch (paginated) */
  function fetchAll(url) {
    var base = url.split("?")[0], items = [];
    function page(off) {
      var u = base + "?format=json&nocache=" + Date.now() + (off ? "&offset=" + off : "");
      return fetch(u, { credentials: "same-origin" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (d) {
          var b = d.items || []; items = items.concat(b);
          var pg = d.pagination || {};
          return (pg.nextPage && pg.nextPageOffset && b.length) ? page(pg.nextPageOffset) : items;
        });
    }
    return page(null);
  }

  /* -------------------------------------------------- Build records */
  function buildRecords(items) {
    var recs = [];
    items.forEach(function (item) {
      var c = resolveCoords(item);
      if (!c || isNaN(c.lat) || isNaN(c.lng)) return;
      var loc = item.location || {};
      var ap = [loc.addressLine1, loc.addressLine2, loc.addressCountry].filter(Boolean);
      recs.push({
        title: item.title || "",
        url: item.fullUrl || "#",
        image: item.assetUrl || "",
        excerpt: cleanExcerpt(item.excerpt),
        categories: item.categories || [],
        tags: item.tags || [],
        address: ap.join(", "),
        lat: c.lat,
        lng: c.lng
      });
    });
    return recs;
  }

  /* -------------------------------------------------- Icon */
  function makeIcon() {
    var size = parseInt(cfg.markerSize, 10) || 42;
    if (cfg.markerType === "image" && cfg.markerImageUrl) {
      return L.icon({ iconUrl: cfg.markerImageUrl, iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size + 4], className: "sdlmap-custom-icon" });
    }
    var color = cfg.markerColor || "#E5484D";
    var h = Math.round(size * 32 / 24);
    var svg = '<svg viewBox="0 0 24 32" width="' + size + '" height="' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0z" fill="' + color + '"/>' +
      '<circle cx="12" cy="12" r="4.5" fill="#ffffff"/></svg>';
    return L.divIcon({ html: svg, className: "sdlmap-pin", iconSize: [size, h], iconAnchor: [size / 2, h], popupAnchor: [0, -h + 6] });
  }

  /* -------------------------------------------------- Popup */
  function popupHtml(rec) {
    var p = ['<div class="sdlmap-popup">'];
    if (cfg.popupImage && rec.image) {
      p.push('<a class="sdlmap-popup-img" href="' + esc(rec.url) + '" target="_blank" style="background-image:url(' + esc(rec.image) + '?format=500w)"></a>');
    }
    p.push('<div class="sdlmap-popup-body">');
    if (cfg.popupCategory && rec.categories.length) p.push('<div class="sdlmap-popup-cat">' + esc(rec.categories[0]) + '</div>');
    p.push('<a class="sdlmap-popup-title" href="' + esc(rec.url) + '" target="_blank">' + esc(rec.title) + '</a>');
    if (cfg.popupAddress && rec.address) p.push('<div class="sdlmap-popup-addr"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ' + esc(rec.address) + '</div>');
    if (cfg.popupExcerpt && rec.excerpt) p.push('<div class="sdlmap-popup-exc">' + esc(truncate(rec.excerpt, cfg.excerptLength)) + '</div>');
    var links = [];
    if (cfg.popupReadMore) links.push('<a class="sdlmap-popup-more" href="' + esc(rec.url) + '" target="_blank">' + esc(cfg.readMoreText) + ' →</a>');
    if (cfg.viewOnMap) {
      var g = "https://www.google.com/maps/search/?api=1&query=" + rec.lat + "," + rec.lng;
      links.push('<a class="sdlmap-popup-gmap" href="' + g + '" target="_blank" rel="noopener">' + esc(cfg.viewOnMapText) + '</a>');
    }
    if (links.length) p.push('<div class="sdlmap-popup-links">' + links.join("") + "</div>");
    p.push("</div></div>");
    return p.join("");
  }

  /* -------------------------------------------------- Collect unique values */
  function collectUnique(recs, field) {
    var seen = {}, list = [];
    recs.forEach(function (r) { r[field].forEach(function (v) { if (!seen[v]) { seen[v] = true; list.push(v); } }); });
    return list;
  }

  /* -------------------------------------------------- Container */
  function resolveContainer() {
    if (cfg.target === "native" || cfg.target === "auto") {
      var b = document.querySelector(".sqs-block-map .sqs-block-content, .map-block .sqs-block-content, .sqs-block-map");
      if (b) {
        /* Capture the native map's height (set in the Squarespace editor) so we
           render at exactly that size instead of forcing a fixed height. */
        var nh = b.offsetHeight;
        if (nh && nh > 80) cfg._nativeHeight = nh;
        b.innerHTML = ""; b.classList.add("sdlmap-took-over"); b.dataset.sdlmapNative = "1";
        return b;
      }
      if (cfg.target === "native") warn("No Map Block found on page.");
    }
    var el = document.getElementById(cfg.containerId);
    if (el) return el;
    warn("No Map Block and no #" + cfg.containerId + " found.");
    return null;
  }

  /* -------------------------------------------------- Render */
  function render(host, records) {
    /* ---------- Controls area (search + filters) ---------- */
    var hasControls = cfg.search || cfg.categoryFilter || cfg.tagFilter;

    var root = document.createElement("div");
    /* "plain" = a bare native-style map (no controls, no sidebar): fills the
       native block edge-to-edge with no card framing, matching the Squarespace editor. */
    var plain = !hasControls && !cfg.sidebar;
    root.className = "sdlmap-root"
      + (cfg.sidebar ? " sdlmap-has-sidebar sdlmap-sidebar-" + cfg.sidebarPosition : "")
      + (plain ? " sdlmap-plain" : "");
    root.style.setProperty("--sdlmap-height", (parseInt(cfg._nativeHeight, 10) || 500) + "px");
    root.style.setProperty("--sdlmap-sidebar-width", (parseInt(cfg.sidebarWidth, 10) || 340) + "px");

    var controls = null;
    if (hasControls) {
      controls = document.createElement("div");
      controls.className = "sdlmap-controls";
      root.appendChild(controls);
    }

    /* Search */
    var searchInput = null;
    if (cfg.search) {
      var searchWrap = document.createElement("div");
      searchWrap.className = "sdlmap-search-wrap";
      searchWrap.innerHTML =
        '<svg class="sdlmap-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input class="sdlmap-search" type="text" placeholder="' + esc(cfg.searchPlaceholder) + '">' +
        '<button class="sdlmap-search-clear" aria-label="Clear">×</button>';
      controls.appendChild(searchWrap);
      searchInput = searchWrap.querySelector(".sdlmap-search");
      var clearBtn = searchWrap.querySelector(".sdlmap-search-clear");
      clearBtn.style.display = "none";
      searchInput.addEventListener("input", function () {
        clearBtn.style.display = searchInput.value ? "" : "none";
        applyFilters();
      });
      clearBtn.addEventListener("click", function () {
        searchInput.value = ""; clearBtn.style.display = "none"; searchInput.focus(); applyFilters();
      });
    }

    /* Category filter */
    var activeCat = "__all__";
    var catBar = null;
    if (cfg.categoryFilter) {
      var cats = collectUnique(records, "categories");
      if (cats.length) {
        var catGroup = document.createElement("div");
        catGroup.className = "sdlmap-filter-group";
        if (cfg.categoryLabel) {
          var lbl = document.createElement("div");
          lbl.className = "sdlmap-filter-label";
          lbl.textContent = cfg.categoryLabel;
          catGroup.appendChild(lbl);
        }
        catBar = document.createElement("div");
        catBar.className = "sdlmap-filterbar";
        [cfg.allLabel].concat(cats).forEach(function (label, i) {
          var b = document.createElement("button");
          b.className = "sdlmap-filter-btn" + (i === 0 ? " active" : "");
          b.textContent = label;
          b.dataset.val = i === 0 ? "__all__" : label;
          b.addEventListener("click", function () {
            catBar.querySelectorAll(".sdlmap-filter-btn").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            activeCat = b.dataset.val;
            applyFilters();
          });
          catBar.appendChild(b);
        });
        catGroup.appendChild(catBar);
        controls.appendChild(catGroup);
      }
    }

    /* Tag filter */
    var activeTag = "__all__";
    var activePriceMin = cfg.priceMin, activePriceMax = cfg.priceMax;
    var tagBar = null;
    if (cfg.tagFilter) {
      var tagGroup = document.createElement("div");
      tagGroup.className = "sdlmap-filter-group";
      if (cfg.tagLabel) {
        var tagLbl = document.createElement("div");
        tagLbl.className = "sdlmap-filter-label";
        tagLbl.textContent = cfg.tagLabel;
        tagGroup.appendChild(tagLbl);
      }

      if (cfg.tagFilterType === "price-range") {
        /* --- Price range slider --- */
        var prices = [];
        records.forEach(function (r) { var p = getRecordPrice(r); if (p !== null) prices.push(p); });
        var sMin = prices.length ? Math.min.apply(null, prices) : cfg.priceMin;
        var sMax = prices.length ? Math.max.apply(null, prices) : cfg.priceMax;
        sMin = Math.min(sMin, cfg.priceMin);
        sMax = Math.max(sMax, cfg.priceMax);
        activePriceMin = sMin;
        activePriceMax = sMax;

        var priceWrap = document.createElement("div");
        priceWrap.className = "sdlmap-price-wrap";

        var displays = document.createElement("div");
        displays.className = "sdlmap-price-displays";

        var minDisplay = document.createElement("input");
        minDisplay.type = "text";
        minDisplay.className = "sdlmap-price-input";
        minDisplay.value = formatPrice(sMin);

        var maxDisplay = document.createElement("input");
        maxDisplay.type = "text";
        maxDisplay.className = "sdlmap-price-input sdlmap-price-input-max";
        maxDisplay.value = formatPrice(sMax);

        displays.appendChild(minDisplay);
        var sep = document.createElement("span");
        sep.className = "sdlmap-price-sep";
        sep.textContent = "—";
        displays.appendChild(sep);
        displays.appendChild(maxDisplay);
        priceWrap.appendChild(displays);

        var sliderWrap = document.createElement("div");
        sliderWrap.className = "sdlmap-slider-wrap";
        var track = document.createElement("div");
        track.className = "sdlmap-slider-track";
        var fill = document.createElement("div");
        fill.className = "sdlmap-slider-fill";
        track.appendChild(fill);

        var inputLo = document.createElement("input");
        inputLo.type = "range"; inputLo.className = "sdlmap-range sdlmap-range-lo";
        inputLo.min = sMin; inputLo.max = sMax; inputLo.step = cfg.priceStep; inputLo.value = sMin;

        var inputHi = document.createElement("input");
        inputHi.type = "range"; inputHi.className = "sdlmap-range sdlmap-range-hi";
        inputHi.min = sMin; inputHi.max = sMax; inputHi.step = cfg.priceStep; inputHi.value = sMax;

        sliderWrap.appendChild(track);
        sliderWrap.appendChild(inputLo);
        sliderWrap.appendChild(inputHi);
        priceWrap.appendChild(sliderWrap);
        tagGroup.appendChild(priceWrap);

        function updateFill() {
          var lo = parseFloat(inputLo.value), hi = parseFloat(inputHi.value);
          if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
          var pctLo = (lo - sMin) / (sMax - sMin) * 100;
          var pctHi = (hi - sMin) / (sMax - sMin) * 100;
          fill.style.left = pctLo + "%";
          fill.style.width = (pctHi - pctLo) + "%";
          minDisplay.value = formatPrice(lo);
          maxDisplay.value = formatPrice(hi);
          activePriceMin = lo;
          activePriceMax = hi;
        }
        updateFill();

        function onRangeInput() {
          var lo = parseFloat(inputLo.value), hi = parseFloat(inputHi.value);
          if (lo > hi) { if (this === inputLo) inputLo.value = hi; else inputHi.value = lo; }
          updateFill();
          applyFilters();
        }
        inputLo.addEventListener("input", onRangeInput);
        inputHi.addEventListener("input", onRangeInput);

        function parseAndApplyInput(inputEl, isMax) {
          var raw = inputEl.value.replace(/,/g, "").replace(/[^0-9.]/g, "");
          var n = parseFloat(raw);
          if (!isNaN(n)) {
            n = Math.max(sMin, Math.min(sMax, n));
            if (isMax) inputHi.value = n; else inputLo.value = n;
            updateFill();
            applyFilters();
          }
        }
        minDisplay.addEventListener("change", function () { parseAndApplyInput(minDisplay, false); });
        maxDisplay.addEventListener("change", function () { parseAndApplyInput(maxDisplay, true); });

      } else {
        /* --- Tag pills --- */
        var tags = collectUnique(records, "tags");
        if (tags.length) {
          tagBar = document.createElement("div");
          tagBar.className = "sdlmap-filterbar";
          [cfg.allTagLabel || cfg.allLabel].concat(tags).forEach(function (label, i) {
            var b = document.createElement("button");
            b.className = "sdlmap-filter-btn" + (i === 0 ? " active" : "");
            b.textContent = label;
            b.dataset.val = i === 0 ? "__all__" : label;
            b.addEventListener("click", function () {
              tagBar.querySelectorAll(".sdlmap-filter-btn").forEach(function (x) { x.classList.remove("active"); });
              b.classList.add("active");
              activeTag = b.dataset.val;
              applyFilters();
            });
            tagBar.appendChild(b);
          });
          tagGroup.appendChild(tagBar);
        }
      }
      controls.appendChild(tagGroup);
    }

    /* ---------- Body: sidebar + map ---------- */
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

    /* ---------- Leaflet ---------- */
    var tile = TILES[cfg.mapStyle] || TILES["carto-voyager"];
    var map = L.map(mapEl, { scrollWheelZoom: !!cfg.scrollWheelZoom, zoomControl: !!cfg.showZoomControl });
    L.tileLayer(tile.url, { attribution: tile.attr, maxZoom: 19 }).addTo(map);

    var icon = makeIcon();
    var pw = parseInt(cfg.popupWidth, 10) || 320;
    var layerGroup = (cfg.cluster && L.markerClusterGroup)
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 })
      : L.layerGroup();

    var markers = [];
    records.forEach(function (rec) {
      var m = L.marker([rec.lat, rec.lng], { icon: icon });
      m.bindPopup(popupHtml(rec), { maxWidth: pw, minWidth: Math.min(pw, 220), className: "sdlmap-popup-wrap", autoPanPaddingTopLeft: L.point(20, 20), autoPanPaddingBottomRight: L.point(20, 20) });
      layerGroup.addLayer(m);
      markers.push(m);
    });
    map.addLayer(layerGroup);

    function fitAll(ms) {
      if (!ms.length) return;
      if (ms.length === 1) { map.setView(ms[0].getLatLng(), parseInt(cfg.defaultZoom, 10) || 13); return; }
      map.fitBounds(L.latLngBounds(ms.map(function (m) { return m.getLatLng(); })), { padding: [48, 48] });
    }
    if (cfg.autoFit) fitAll(markers);
    else if (markers.length) map.setView(markers[0].getLatLng(), parseInt(cfg.defaultZoom, 10) || 13);

    /* ---------- Sidebar ---------- */
    var sidebarCards = [];
    if (sidebar) {
      records.forEach(function (rec, i) {
        var card = document.createElement("div");
        card.className = "sdlmap-card";
        var img = (cfg.popupImage && rec.image)
          ? '<div class="sdlmap-card-img" style="background-image:url(' + esc(rec.image) + '?format=400w)"></div>' : "";
        var cat = rec.categories.length ? '<div class="sdlmap-card-cat">' + esc(rec.categories[0]) + "</div>" : "";
        var addr = rec.address ? '<div class="sdlmap-card-addr">' + esc(rec.address) + "</div>" : "";
        var exc = rec.excerpt ? '<div class="sdlmap-card-exc">' + esc(truncate(rec.excerpt, 100)) + "</div>" : "";
        card.innerHTML = img + '<div class="sdlmap-card-body">' + cat + '<div class="sdlmap-card-title">' + esc(rec.title) + "</div>" + addr + exc + "</div>";
        card.addEventListener("click", function () {
          var m = markers[i];
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

    /* ---------- Central filter fn ---------- */
    function applyFilters() {
      var query = searchInput ? searchInput.value.toLowerCase().trim() : "";
      var shown = [];
      layerGroup.clearLayers();

      records.forEach(function (rec, i) {
        var visible = true;

        /* search */
        if (query) {
          var hay = (rec.title + " " + rec.excerpt + " " + rec.address + " " + rec.categories.join(" ") + " " + rec.tags.join(" ")).toLowerCase();
          if (hay.indexOf(query) === -1) visible = false;
        }

        /* category */
        if (visible && cfg.categoryFilter && activeCat !== "__all__") {
          if (rec.categories.indexOf(activeCat) === -1) visible = false;
        }

        /* tag / price */
        if (visible && cfg.tagFilter) {
          if (cfg.tagFilterType === "price-range") {
            var price = getRecordPrice(rec);
            if (price !== null && (price < activePriceMin || price > activePriceMax)) visible = false;
          } else {
            if (activeTag !== "__all__" && rec.tags.indexOf(activeTag) === -1) visible = false;
          }
        }

        if (sidebarCards[i]) sidebarCards[i].style.display = visible ? "" : "none";
        if (visible) { layerGroup.addLayer(markers[i]); shown.push(markers[i]); }
      });

      if (cfg.autoFit && shown.length) fitAll(shown);
    }

    /* ---------- Settle ---------- */
    setTimeout(function () { map.invalidateSize(); if (cfg.autoFit) fitAll(markers); }, 250);
    window.SDL_MAP_INSTANCE = { map: map, records: records, config: cfg };
  }

  /* -------------------------------------------------- Boot */
  function boot() {
    var host = resolveContainer();
    if (!host) return;
    host.classList.add("sdlmap-host");

    loadCSS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    if (cfg.cluster) {
      loadCSS("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css");
      loadCSS("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css");
    }

    loadJS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js")
      .then(function () { return cfg.cluster ? loadJS("https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js") : null; })
      .then(function () { return fetchAll(cfg.collectionUrl); })
      .then(function (items) {
        var records = buildRecords(items);
        if (!records.length) {
          warn("No posts with coordinates found in " + cfg.collectionUrl);
          host.innerHTML = '<div class="sdlmap-empty">No mappable locations found.</div>';
          return;
        }
        render(host, records);
      })
      .catch(function (err) { warn("Failed:", err); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
