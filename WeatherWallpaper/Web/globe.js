(function () {
  'use strict';

  var PALETTES = [
    { name: 'gold', accent: '#C9A84C', accentRgb: 'rgb(201,168,76)' },
    { name: 'arctic', accent: '#4D8CC9', accentRgb: 'rgb(77,140,201)' },
    { name: 'aurora', accent: '#4DC98A', accentRgb: 'rgb(77,201,138)' },
    { name: 'rose', accent: '#C94D6E', accentRgb: 'rgb(201,77,110)' },
    { name: 'violet', accent: '#8A4DC9', accentRgb: 'rgb(138,77,201)' },
    { name: 'ember', accent: '#C96B4D', accentRgb: 'rgb(201,107,77)' },
  ];
  var palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  document.documentElement.style.setProperty('--accent', palette.accent);
  document.body.classList.add('has-webgl');

  var MAPBOX_TOKEN_KEY = 'mapbox-access-token';
  function getMapboxToken() { return localStorage.getItem(MAPBOX_TOKEN_KEY) || ''; }

  // ==================== MAP STYLES ====================

  var GLYPHS = 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf';

  // Raster-only styles need their own minimal style document. Glyphs are
  // required or the custom symbol (label) layers silently fail to render.
  function rasterStyle(tileUrl, maxzoom, attribution, background) {
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        'basemap-raster': {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          maxzoom: maxzoom,
          attribution: attribution
        }
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': background } },
        { id: 'basemap-raster-layer', type: 'raster', source: 'basemap-raster' }
      ]
    };
  }

  var S2CLOUDLESS_TILES =
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
  var S2CLOUDLESS_ATTRIB =
    'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)';

  // labelColor / haloColor / haloWidth style the custom place-label layers,
  // which have to stay legible across light, dark and imagery basemaps.
  var STYLES = [
    {
      id: 'faded', name: 'Standard · Faded',
      url: 'mapbox://styles/mapbox/standard',
      config: { theme: 'faded' },
      labelColor: 'rgba(0,0,0,0.6)', haloColor: 'rgba(255,255,255,0.35)', haloWidth: 0
    },
    {
      id: 'monochrome', name: 'Standard · Monochrome',
      url: 'mapbox://styles/mapbox/standard',
      config: { theme: 'monochrome' },
      labelColor: 'rgba(0,0,0,0.55)', haloColor: 'rgba(255,255,255,0.35)', haloWidth: 0
    },
    {
      id: 'dusk', name: 'Standard · Dusk',
      url: 'mapbox://styles/mapbox/standard',
      config: { theme: 'default', lightPreset: 'dusk' },
      labelColor: 'rgba(255,255,255,0.7)', haloColor: 'rgba(0,0,0,0.5)', haloWidth: 0.8
    },
    {
      id: 'night', name: 'Standard · Night',
      url: 'mapbox://styles/mapbox/standard',
      config: { theme: 'default', lightPreset: 'night' },
      labelColor: 'rgba(255,255,255,0.72)', haloColor: 'rgba(0,0,0,0.6)', haloWidth: 0.8
    },
    {
      id: 'satellite', name: 'Satellite',
      url: 'mapbox://styles/mapbox/standard-satellite',
      config: {},
      labelColor: 'rgba(255,255,255,0.85)', haloColor: 'rgba(0,0,0,0.65)', haloWidth: 1
    },
    {
      id: 's2cloudless', name: 'Satellite · Cloudless',
      style: rasterStyle(S2CLOUDLESS_TILES, 14, S2CLOUDLESS_ATTRIB, '#050810'),
      config: {},
      labelColor: 'rgba(255,255,255,0.85)', haloColor: 'rgba(0,0,0,0.65)', haloWidth: 1
    },
    {
      id: 'dark', name: 'Dark',
      url: 'mapbox://styles/mapbox/dark-v11',
      config: {},
      labelColor: 'rgba(255,255,255,0.6)', haloColor: 'rgba(0,0,0,0.5)', haloWidth: 0
    },
    {
      id: 'classic', name: 'Classic',
      url: 'mapbox://styles/jchmapguy/cms12yqaj00ry01qt2j2j6as5',
      config: { theme: 'faded' },
      labelColor: 'rgba(0,0,0,0.6)', haloColor: 'rgba(255,255,255,0.35)', haloWidth: 0
    },
  ];

  function findStyle(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return STYLES[0];
  }

  // NASA GIBS VIIRS Black Marble — city lights, no API key required.
  // WMTS tile order is {z}/{y}/{x}, not the usual {z}/{x}/{y}.
  var NIGHTLIGHTS_URL_BASE =
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/' +
    'GoogleMapsCompatible_Level8/';
  var NIGHTLIGHTS_TILES = NIGHTLIGHTS_URL_BASE + '{z}/{y}/{x}.png';
  var NIGHTLIGHTS_MAX_OPACITY = 0.92;

  // Zoom at which we hand over from the terminator-masked global image to the
  // sharper tiled layer. Above it the whole viewport is within roughly one
  // local time, so a single global opacity is already correct.
  var NIGHTLIGHTS_TILE_MINZOOM = 5;

  // Global mosaic: 16x16 tiles at z4 => 4096x4096 Web Mercator canvas (~4 MB,
  // fetched once and then served from cache).
  var BM_ZOOM = 4;
  var BM_TILE = 256;
  var BM_SIZE = BM_TILE * (1 << BM_ZOOM);
  var MERCATOR_MAX_LAT = 85.051129;
  var NIGHTLIGHTS_COORDS = [
    [-180, MERCATOR_MAX_LAT], [180, MERCATOR_MAX_LAT],
    [180, -MERCATOR_MAX_LAT], [-180, -MERCATOR_MAX_LAT]
  ];

  // ==================== WIND ====================
  // Live 10m wind from Open-Meteo (free, no key). One request returns the whole
  // grid, so the field costs a single call. Rendered as streamlines with an
  // animated dash rather than GPU particles: streamlines are ordinary line
  // layers, so they project correctly on the globe for free.
  var WIND_GRID_COLS = 20;
  var WIND_GRID_ROWS = 15;          // 300 points, ~0.2s per request
  var WIND_STREAMLINES = 420;
  var WIND_STEPS = 18;
  var WIND_TARGET_PX = 70;          // on-screen length drawn by a typical wind
  var WIND_REFERENCE_SPEED = 5;     // m/s — near the median of a live 10m field,
                                    // so most streamlines land near the target
                                    // and gales visibly run longer
  var METERS_PER_DEGREE = 111320;

  var mapContainer = document.getElementById('globe-map');
  var token = getMapboxToken();
  if (!token) {
    mapContainer.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.3);font-family:Inter,sans-serif;font-size:13px;">' +
      'Waiting for Mapbox token…' +
      '</div>';
    return;
  }
  initMap(token);

  // --- Sun position ---
  var DEG = Math.PI / 180;
  var EARTH_R = 6371000;

  function getSunPosition() {
    var now = new Date();
    var JD = now.getTime() / 86400000 + 2440587.5;
    var n = JD - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360;
    var g = (357.528 + 0.9856003 * n) % 360;
    if (L < 0) L += 360; if (g < 0) g += 360;
    var lambda = L + 1.915 * Math.sin(g * DEG) + 0.020 * Math.sin(2 * g * DEG);
    var epsilon = 23.439 - 0.0000004 * n;
    var declRad = Math.asin(Math.sin(epsilon * DEG) * Math.sin(lambda * DEG));
    var GMST = (18.697374558 + 24.06570982441908 * n) % 24;
    if (GMST < 0) GMST += 24;
    var ra = Math.atan2(Math.cos(epsilon * DEG) * Math.sin(lambda * DEG), Math.cos(lambda * DEG));
    var subSolarLon = (ra / DEG) - GMST * 15;
    while (subSolarLon > 180) subSolarLon -= 360;
    while (subSolarLon < -180) subSolarLon += 360;
    return { lat: declRad / DEG, lon: subSolarLon };
  }

  // Solar elevation angle in degrees at a given point, used to crossfade
  // the night-lights imagery in and out.
  function getSunElevation(lat, lon) {
    var sun = getSunPosition();
    var latRad = lat * DEG;
    var declRad = sun.lat * DEG;
    var ha = (lon - sun.lon) * DEG;
    var sinEl = Math.sin(latRad) * Math.sin(declRad) +
                Math.cos(latRad) * Math.cos(declRad) * Math.cos(ha);
    if (sinEl > 1) sinEl = 1; if (sinEl < -1) sinEl = -1;
    return Math.asin(sinEl) / DEG;
  }

  function buildNightPolygon(offsetDeg) {
    var sun = getSunPosition();
    var decl = sun.lat * DEG;
    if (Math.abs(sun.lat) < 0.1) decl = (sun.lat >= 0 ? 0.1 : -0.1) * DEG;
    var darkPoleLat = sun.lat >= 0 ? -90 : 90;
    var shift = (darkPoleLat > 0 ? 1 : -1) * offsetDeg;
    var coords = [];
    for (var lon = -180; lon <= 180; lon += 2) {
      var ha = (lon - sun.lon) * DEG;
      var lat = Math.atan(-Math.cos(ha) / Math.tan(decl)) / DEG + shift;
      if (lat > 90) lat = 90; if (lat < -90) lat = -90;
      coords.push([lon, lat]);
    }
    coords.push([180, darkPoleLat], [-180, darkPoleLat], coords[0].slice());
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }] };
  }

  // ==================== NIGHT LIGHTS MOSAIC ====================

  // Black Marble tiles are opaque RGB, and Mapbox raster layers support neither
  // blend modes nor a geographic mask. So we stitch a global mosaic ourselves
  // and punch the day side out of its alpha channel. GIBS serves the tiles with
  // Access-Control-Allow-Origin: *, so the canvas stays untainted.

  var mosaicCanvas = null;      // stitched Black Marble, drawn once
  var mosaicPending = false;
  var maskCanvas = null;        // low-res terminator mask, stretched when applied
  var MASK_SIZE = 512;

  function loadMosaic(onReady) {
    if (mosaicCanvas) { onReady(); return; }
    if (mosaicPending) return;
    mosaicPending = true;

    var canvas = document.createElement('canvas');
    canvas.width = BM_SIZE; canvas.height = BM_SIZE;
    var ctx = canvas.getContext('2d');
    var side = 1 << BM_ZOOM;
    var total = side * side;
    var done = 0;

    function tileFinished() {
      done++;
      if (done < total) return;
      mosaicCanvas = canvas;
      mosaicPending = false;
      onReady();
    }

    for (var ty = 0; ty < side; ty++) {
      for (var tx = 0; tx < side; tx++) {
        (function (x, y) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            ctx.drawImage(img, x * BM_TILE, y * BM_TILE, BM_TILE, BM_TILE);
            tileFinished();
          };
          img.onerror = function () {
            console.warn('[NightLights] tile failed', BM_ZOOM, y, x);
            tileFinished();
          };
          // WMTS row/col order.
          img.src = NIGHTLIGHTS_URL_BASE + BM_ZOOM + '/' + y + '/' + x + '.png';
        })(tx, ty);
      }
    }
  }

  // Alpha = how deep into night this pixel is. Computed small and upscaled, so
  // the terminator gets a soft edge for free from bilinear filtering.
  function buildMask() {
    if (!maskCanvas) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.width = MASK_SIZE; maskCanvas.height = MASK_SIZE;
    }
    var ctx = maskCanvas.getContext('2d');
    var img = ctx.createImageData(MASK_SIZE, MASK_SIZE);
    var d = img.data;

    for (var y = 0; y < MASK_SIZE; y++) {
      // Inverse Web Mercator for the row's latitude.
      var n = Math.PI * (1 - 2 * (y + 0.5) / MASK_SIZE);
      var lat = Math.atan(Math.sinh(n)) / DEG;
      for (var x = 0; x < MASK_SIZE; x++) {
        var lon = ((x + 0.5) / MASK_SIZE) * 360 - 180;
        var elevation = getSunElevation(lat, lon);
        var k = -elevation / 12;   // 0 at sunset, 1 at nautical twilight
        if (k < 0) k = 0; if (k > 1) k = 1;
        var i = (y * MASK_SIZE + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
        d[i + 3] = Math.round(k * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return maskCanvas;
  }

  // Produces a blob URL of the masked mosaic, or null if the mosaic isn't ready.
  function renderNightLights(onUrl) {
    if (!mosaicCanvas) return;
    // A 4096² buffer is ~67 MB, so build it per render and release it right
    // after rather than holding a second copy for the lifetime of the app.
    var out = document.createElement('canvas');
    out.width = BM_SIZE; out.height = BM_SIZE;
    var ctx = out.getContext('2d');

    ctx.drawImage(mosaicCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buildMask(), 0, 0, BM_SIZE, BM_SIZE);
    ctx.globalCompositeOperation = 'source-over';

    out.toBlob(function (blob) {
      out.width = 0; out.height = 0;
      if (blob) onUrl(URL.createObjectURL(blob));
    }, 'image/png');
  }

  // A sampled wind field over a regular lat/lon grid.
  function WindField(south, west, north, east, cols, rows, u, v) {
    this.south = south; this.west = west;
    this.cols = cols; this.rows = rows;
    this.dLat = (north - south) / (rows - 1);
    this.dLon = (east - west) / (cols - 1);
    this.u = u; this.v = v;
  }

  // Bilinear sample. Returns null outside the grid.
  WindField.prototype.sample = function (lat, lon) {
    var x = (lon - this.west) / this.dLon;
    var y = (lat - this.south) / this.dLat;
    if (!(x >= 0 && y >= 0 && x <= this.cols - 1 && y <= this.rows - 1)) return null;

    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = Math.min(x0 + 1, this.cols - 1), y1 = Math.min(y0 + 1, this.rows - 1);
    var fx = x - x0, fy = y - y0;

    var i00 = y0 * this.cols + x0, i10 = y0 * this.cols + x1;
    var i01 = y1 * this.cols + x0, i11 = y1 * this.cols + x1;

    function mix(a, b, t) { return a + (b - a) * t; }
    return {
      u: mix(mix(this.u[i00], this.u[i10], fx), mix(this.u[i01], this.u[i11], fx), fy),
      v: mix(mix(this.v[i00], this.v[i10], fx), mix(this.v[i01], this.v[i11], fx), fy)
    };
  };

  // Meteorological convention: wind_direction is the direction the wind comes
  // FROM, so the air's velocity vector points the opposite way.
  function windComponents(speed, directionDeg) {
    var rad = directionDeg * Math.PI / 180;
    return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
  }

  // Integrates streamlines through the field, seeded at random points.
  // stepSeconds is chosen by the caller so a typical wind draws a line of
  // roughly constant on-screen length whatever the zoom.
  function buildStreamlines(field, count, steps, stepSeconds) {
    var features = [];
    var north = field.south + field.dLat * (field.rows - 1);
    var east = field.west + field.dLon * (field.cols - 1);

    for (var n = 0; n < count; n++) {
      var lat = field.south + Math.random() * (north - field.south);
      var lon = field.west + Math.random() * (east - field.west);
      var coords = [];
      var speedSum = 0;

      for (var s = 0; s < steps; s++) {
        var w = field.sample(lat, lon);
        if (!w) break;
        coords.push([lon, lat]);
        speedSum += Math.sqrt(w.u * w.u + w.v * w.v);

        var cosLat = Math.cos(lat * DEG);
        if (cosLat < 0.05) break;   // degenerate near the poles
        lat += (w.v * stepSeconds) / METERS_PER_DEGREE;
        lon += (w.u * stepSeconds) / (METERS_PER_DEGREE * cosLat);
        if (lat > 89 || lat < -89) break;
      }

      if (coords.length < 3) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { speed: speedSum / coords.length }
      });
    }
    return { type: 'FeatureCollection', features: features };
  }

  function initMap(accessToken) {
    mapboxgl.workerUrl = 'mapbox-gl-csp-worker.js';
    mapboxgl.accessToken = accessToken;

    var storedLat = parseFloat(localStorage.getItem('last-location-lat'));
    var storedLon = parseFloat(localStorage.getItem('last-location-lon'));
    var hasStoredLocation = !Number.isNaN(storedLat) && !Number.isNaN(storedLon);

    var startLat = window.userLocation ? window.userLocation.lat : (hasStoredLocation ? storedLat : 30.27);
    var startLon = window.userLocation ? window.userLocation.lon : (hasStoredLocation ? storedLon : -97.74);

    var currentStyle = findStyle(localStorage.getItem('map-style') || 'faded');

    var currentZoomLevel = parseFloat(localStorage.getItem('zoom-level'));
    if (Number.isNaN(currentZoomLevel)) currentZoomLevel = 2.5;

    // --- Layer state ---
    // Restored from localStorage, which Swift populates at document start, so a
    // reload or window rebuild comes back with the same view.
    // Declared before the map so the style.load handler never reads them
    // before assignment.
    function savedFlag(key, fallback) {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    }

    var flightAnimInterval = null;
    var flightStore = [];
    var lastFlightFetch = 0;
    var flightsEnabled = savedFlag('flights-enabled', false);
    var weatherEnabled = savedFlag('radar-enabled', false);
    var detailLevel = localStorage.getItem('map-detail') || 'normal';
    var spinEnabledInitial = savedFlag('spin-enabled', false);
    var spinPixelsPerSec = parseFloat(localStorage.getItem('spin-speed'));
    if (Number.isNaN(spinPixelsPerSec)) spinPixelsPerSec = 26;
    var nightLightsEnabled = savedFlag('night-lights', false);
    var windEnabled = savedFlag('wind-enabled', false);
    var windField = null;
    var radarTileUrl = null;
    var FLIGHT_RENDER_MS = 500; // 2fps for plane movement (more than enough for globe scale)

    // Background refresh cadence. Nothing here is a paid API: Open-Meteo,
    // RainViewer and NASA GIBS are free and keyless, OpenSky is free with a
    // 4000/day credit budget (this uses ~288).
    var REFRESH = {
      flights: 5 * 60000,
      radar: 10 * 60000,
      terminator: 10 * 60000,
      wind: 30 * 60000
    };
    var timers = [];

    var map = new mapboxgl.Map({
      container: 'globe-map',
      style: currentStyle.style || currentStyle.url,
      projection: 'globe',
      center: [startLon, startLat],
      zoom: currentZoomLevel,
      attributionControl: false,
    });

    var mapLoaded = false;

    // ==================== STYLE ====================

    // Fires on first load and again after every setStyle(), which wipes all
    // imperatively-added sources, layers and images.
    map.on('style.load', function () {
      applyStyleConfig();
      try { map.setProjection('globe'); } catch (e) { }
      addCustomLayers();
      reapplyToggles();
      applyNightBlend();
    });

    // Captured per style, before we touch anything, so "Full" can put the
    // style's own colours back.
    var roadDefaults = null;

    function captureRoadDefaults() {
      function get(name) {
        try { return map.getConfigProperty('basemap', name); } catch (e) { return null; }
      }
      var land = get('colorLand');
      roadDefaults = land ? {
        land: land,
        motorways: get('colorMotorways'),
        trunks: get('colorTrunks'),
        roads: get('colorRoads')
      } : null;
    }

    function applyStyleConfig() {
      captureRoadDefaults();

      // Config properties only exist on Standard-derived styles.
      try {
        var cfg = currentStyle.config || {};
        if (cfg.theme) map.setConfigProperty('basemap', 'theme', cfg.theme);
        if (cfg.lightPreset) map.setConfigProperty('basemap', 'lightPreset', cfg.lightPreset);
        map.setConfigProperty('basemap', 'showPlaceLabels', false);
        map.setConfigProperty('basemap', 'showRoadLabels', false);
        map.setConfigProperty('basemap', 'showPointOfInterestLabels', false);
        map.setConfigProperty('basemap', 'showTransitLabels', false);
      } catch (e) { }

      map.setFog({
        'color': 'rgb(15, 15, 25)',
        'high-color': palette.accentRgb,
        'space-color': 'rgb(5, 5, 8)',
        'star-intensity': 0.6,
        'horizon-blend': 0.03
      });
    }

    window.setMapStyle = function (id) {
      var next = findStyle(id);
      if (next.id === currentStyle.id) return;
      currentStyle = next;
      localStorage.setItem('map-style', next.id);
      map.setStyle(next.style || next.url);
    };

    // --- City marker ---
    var markerEl = document.createElement('div');
    markerEl.className = 'city-marker-dot';
    markerEl.style.background = palette.accent;
    markerEl.style.setProperty('--marker-accent', palette.accent);
    var cityMarker = new mapboxgl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([startLon, startLat]);

    window.globeSetCity = function (lat, lon) {
      cityMarker.setLngLat([lon, lat]);
      // Keep the user's chosen zoom — this also fires on every location
      // re-injection, and forcing a zoom here used to yank the view to z3.
      if (mapLoaded) runCameraAnimation({ center: [lon, lat], zoom: currentZoomLevel, duration: 2000 });
    };

    // Listen for location updates from Swift
    window.addEventListener('locationUpdated', function (e) {
      globeSetCity(e.detail.latitude, e.detail.longitude);
    });

    // Exposed controls for Swift menu bar
    window.mapFlyTo = function (zoom) {
      currentZoomLevel = zoom;
      localStorage.setItem('zoom-level', String(zoom));
      runCameraAnimation({ zoom: zoom, duration: 1500 });
    };

    window.setPollenEnabled = function (on) {
      var weatherView = document.getElementById('weather-view');
      var allergyView = document.getElementById('allergy-view');
      if (on) {
        weatherView.classList.add('bar-hidden');
        allergyView.classList.remove('bar-hidden');
        if (allergyView.querySelector('.bar-loading') && window.reloadAllergy) {
          window.reloadAllergy();
        }
      } else {
        weatherView.classList.remove('bar-hidden');
        allergyView.classList.add('bar-hidden');
      }
    };

    window.setWeatherEnabled = function (on) {
      weatherEnabled = on;
      if (!mapLoaded) return;
      if (on) {
        // The radar layer only exists once a tile URL has been resolved.
        if (radarTileUrl) applyRadarUrl(radarTileUrl);
        else fetchRadar();
      }
      if (map.getLayer('radar-layer')) {
        map.setLayoutProperty('radar-layer', 'visibility', on ? 'visible' : 'none');
      }
    };

    window.setNightLightsEnabled = function (on) {
      nightLightsEnabled = on;
      localStorage.setItem('night-lights', on ? '1' : '0');
      if (!mapLoaded) return;
      if (map.getLayer('nightlights-layer')) {
        map.setLayoutProperty('nightlights-layer', 'visibility', on ? 'visible' : 'none');
      }
      if (map.getLayer('nightlights-global-layer')) {
        map.setLayoutProperty('nightlights-global-layer', 'visibility', on ? 'visible' : 'none');
      } else if (on) {
        ensureGlobalNightLights();
      }
      applyNightBlend();
    };

    // Detail levels, coarse to fine. Roads are part of this because they are
    // what actually buries the geography at country zoom.
    var DETAIL_LAYER_IDS = [
      'country-labels', 'state-labels', 'city-labels', 'neighborhood-labels', 'road-lights'
    ];
    var DETAIL_LEVELS = {
      off: [],
      minimal: ['country-labels'],
      normal: ['country-labels', 'state-labels', 'city-labels'],
      full: DETAIL_LAYER_IDS
    };

    // What the *basemap itself* draws underneath our layers. Hiding our
    // road-lights layer was never enough — the roads and borders people see
    // come from the base style.
    var DETAIL_BASEMAP = {
      off: { roads: false, boundaries: false },
      minimal: { roads: false, boundaries: false },
      normal: { roads: false, boundaries: true },
      full: { roads: true, boundaries: true }
    };

    function setConfig(property, value) {
      try { map.setConfigProperty('basemap', property, value); } catch (e) { }
    }

    function applyBasemapDetail() {
      var cfg = DETAIL_BASEMAP[detailLevel] || DETAIL_BASEMAP.normal;

      // Standard-derived styles, via config properties. The two Standard
      // variants expose different knobs, and setting one a style doesn't
      // declare is simply ignored.
      setConfig('showAdminBoundaries', cfg.boundaries);
      setConfig('showPedestrianRoads', cfg.roads);
      setConfig('showRoadsAndTransit', cfg.roads);   // standard-satellite only

      // Plain Standard has no boolean for roads at all, so paint them the
      // colour of the land instead — the theme LUT is applied to both equally,
      // so they vanish under faded/monochrome just as well as under default.
      if (roadDefaults) {
        var c = cfg.roads ? roadDefaults : { motorways: roadDefaults.land, trunks: roadDefaults.land, roads: roadDefaults.land };
        setConfig('colorMotorways', c.motorways);
        setConfig('colorTrunks', c.trunks);
        setConfig('colorRoads', c.roads);
      }

      // Classic vector styles (dark-v11, light-v11) expose their layers, so
      // hide them directly. Our own road-lights layer is handled separately.
      var style = map.getStyle();
      var layers = (style && style.layers) || [];
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var sourceLayer = layer['source-layer'];
        if (!sourceLayer || layer.id === 'road-lights') continue;
        var visible;
        if (sourceLayer === 'road') visible = cfg.roads;
        else if (sourceLayer === 'admin') visible = cfg.boundaries;
        else continue;
        try {
          map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
        } catch (e) { }
      }
    }

    function applyDetail() {
      var shown = DETAIL_LEVELS[detailLevel] || DETAIL_LEVELS.normal;
      for (var i = 0; i < DETAIL_LAYER_IDS.length; i++) {
        var id = DETAIL_LAYER_IDS[i];
        var vis = shown.indexOf(id) >= 0 ? 'visible' : 'none';
        try { map.setLayoutProperty(id, 'visibility', vis); } catch (e) { }
      }
      applyBasemapDetail();
    }

    window.setMapDetail = function (level) {
      detailLevel = DETAIL_LEVELS[level] ? level : 'normal';
      localStorage.setItem('map-detail', detailLevel);
      applyDetail();
    };

    window.setSpinSpeed = function (pixelsPerSec) {
      spinPixelsPerSec = pixelsPerSec;
      localStorage.setItem('spin-speed', String(pixelsPerSec));
    };

    // Restores every toggle-driven layer state after a style swap.
    function reapplyToggles() {
      applyDetail();
      if (map.getLayer('flights-layer')) {
        map.setLayoutProperty('flights-layer', 'visibility', flightsEnabled ? 'visible' : 'none');
        renderFlightPositions();
      }
      if (map.getLayer('radar-layer')) {
        map.setLayoutProperty('radar-layer', 'visibility', weatherEnabled ? 'visible' : 'none');
      }
      if (map.getLayer('nightlights-layer')) {
        map.setLayoutProperty('nightlights-layer', 'visibility', nightLightsEnabled ? 'visible' : 'none');
      }
      if (map.getLayer('nightlights-global-layer')) {
        map.setLayoutProperty('nightlights-global-layer', 'visibility', nightLightsEnabled ? 'visible' : 'none');
      }
      if (map.getLayer('wind-layer')) {
        map.setLayoutProperty('wind-layer', 'visibility', windEnabled ? 'visible' : 'none');
      }
    }

    var spinning = false;
    var spinEnabled = false;
    var spinAnimId = null;
    // Spin is specified in screen pixels per second rather than degrees, so it
    // feels the same on the globe and at street zoom (26 px/s is ~110s per
    // revolution on the globe view). Set from the menu bar.
    var lastSpinRender = 0;
    var lastNightBlend = 0;
    // The terminator moves ~0.02° in 5s, so there is nothing to gain from
    // recomputing the crossfade more often — and each one restarts a 1.5s
    // opacity transition, which is what made the spin shimmer.
    var NIGHT_BLEND_MS = 5000;
    // `spinEnabled` is what the user asked for; `spinning` is whether the loop
    // is currently running. They differ while a camera animation borrows the
    // camera — spinStep calls setCenter every frame, which would otherwise
    // cancel any flyTo in progress.
    function runCameraAnimation(options) {
      var resumeAfter = spinning;
      if (resumeAfter) {
        spinning = false;
        if (spinAnimId) { cancelAnimationFrame(spinAnimId); spinAnimId = null; }
      }
      map.flyTo(options);
      if (resumeAfter) {
        setTimeout(function () {
          if (!spinEnabled || spinning) return;
          spinning = true;
          lastSpinRender = performance.now();
          if (!spinAnimId) spinAnimId = requestAnimationFrame(spinStep);
        }, (options.duration || 0) + 150);
      }
    }

    window.setSpinEnabled = function (on) {
      spinEnabled = on;
      spinning = on;
      if (on) {
        lastSpinRender = performance.now();
        if (!spinAnimId) spinAnimId = requestAnimationFrame(spinStep);
      } else {
        if (spinAnimId) { cancelAnimationFrame(spinAnimId); spinAnimId = null; }
      }
    };
    var appPaused = false;
    window.setAppPaused = function (paused) {
      appPaused = paused;
      if (paused) {
        // Stop animations
        if (spinAnimId) { cancelAnimationFrame(spinAnimId); spinAnimId = null; }
        if (flightAnimInterval) { clearInterval(flightAnimInterval); flightAnimInterval = null; }
        stopWindAnimation();
        // Stop fetching
        stopBackgroundTasks();
      } else {
        // Resume animations if they were enabled
        if (spinning && !spinAnimId) { lastSpinRender = performance.now(); spinAnimId = requestAnimationFrame(spinStep); }
        if (flightsEnabled && !flightAnimInterval) { startFlightAnimation(); }
        if (windEnabled) startWindAnimation();
        // Resume fetching
        if (mapLoaded) startBackgroundTasks();
      }
    };

    function stopBackgroundTasks() {
      for (var i = 0; i < timers.length; i++) clearInterval(timers[i]);
      timers = [];
    }

    function startBackgroundTasks() {
      stopBackgroundTasks();
      refreshTerminator();
      if (flightsEnabled) fetchFlights(true);
      if (weatherEnabled) fetchRadar();
      if (windEnabled) fetchWind();

      timers.push(setInterval(function () {
        if (!appPaused && flightsEnabled) fetchFlights(true);
      }, REFRESH.flights));

      timers.push(setInterval(function () {
        if (!appPaused && weatherEnabled) fetchRadar();
      }, REFRESH.radar));

      timers.push(setInterval(function () {
        if (!appPaused) refreshTerminator();
      }, REFRESH.terminator));

      timers.push(setInterval(function () {
        if (!appPaused && windEnabled) fetchWind();
      }, REFRESH.wind));
    }

    function refreshTerminator() {
      var tw = map.getSource('twilight-overlay');
      var nt = map.getSource('night-overlay');
      if (tw) tw.setData(buildNightPolygon(0));
      if (nt) nt.setData(buildNightPolygon(6));
      applyNightBlend();
      // The mask bakes in the sun's position, so it has to be re-rendered as
      // the terminator moves (~2.5° of longitude per 10 minutes).
      if (nightLightsEnabled) ensureGlobalNightLights();
    }

    // Degrees of longitude per second that keep the *on-screen* speed constant
    // at any zoom. The Web Mercator world is 512 * 2^zoom pixels wide, so a
    // fixed angular rate looks calm on the globe and absurdly fast up close.
    function currentSpinSpeed() {
      var worldPx = 512 * Math.pow(2, map.getZoom());
      return spinPixelsPerSec * 360 / worldPx;
    }

    function spinStep(ts) {
      if (!spinning) { spinAnimId = null; return; }

      // Move on every frame. Throttling to 30fps on a 60/120Hz display is
      // itself the stutter: the map jumps once per 33ms while the compositor
      // presents every 8-16ms, so the eye sees steps. dt spans the real
      // interval, so the speed stays correct at any refresh rate.
      var dt = (ts - lastSpinRender) / 1000;
      lastSpinRender = ts;
      if (dt > 0 && dt < 1) {   // skip the first frame and resumes after a pause
        var center = map.getCenter();
        center.lng += currentSpinSpeed() * dt;
        if (center.lng > 180) center.lng -= 360;
        map.setCenter(center);
      }
      if (ts - lastNightBlend >= NIGHT_BLEND_MS) {
        lastNightBlend = ts;
        applyNightBlend();
      }
      spinAnimId = requestAnimationFrame(spinStep);
    }

    window.setFlightsEnabled = function (on) {
      flightsEnabled = on;
      if (mapLoaded) {
        if (map.getLayer('flights-layer')) {
          map.setLayoutProperty('flights-layer', 'visibility', on ? 'visible' : 'none');
        }
        if (on) {
          fetchFlights(true);
          startFlightAnimation();
        } else {
          if (flightAnimInterval) { clearInterval(flightAnimInterval); flightAnimInterval = null; }
          flightStore = [];
          renderFlightPositions();
          // Timers keep running for the terminator even if flights are off.
        }
      }
    };

    // ==================== CUSTOM LAYERS ====================

    // Idempotent: re-run after every style change, which drops everything below.
    function addCustomLayers() {
      // --- Night overlays ---
      if (!map.getSource('twilight-overlay')) {
        map.addSource('twilight-overlay', { type: 'geojson', data: buildNightPolygon(0) });
      }
      if (!map.getLayer('twilight-overlay-layer')) {
        map.addLayer({
          id: 'twilight-overlay-layer', type: 'fill', source: 'twilight-overlay',
          paint: { 'fill-color': '#000010', 'fill-opacity': 0.3, 'fill-opacity-transition': { duration: 1200 } }
        });
      }

      if (!map.getSource('night-overlay')) {
        map.addSource('night-overlay', { type: 'geojson', data: buildNightPolygon(6) });
      }
      if (!map.getLayer('night-overlay-layer')) {
        map.addLayer({
          id: 'night-overlay-layer', type: 'fill', source: 'night-overlay',
          paint: { 'fill-color': '#000008', 'fill-opacity': 0.5, 'fill-opacity-transition': { duration: 1200 } }
        });
      }

      // --- City lights (NASA VIIRS Black Marble) ---
      // Sits above the darkening fills so the lights are not dimmed by them.
      // Two layers split by zoom: a terminator-masked global image on the globe,
      // and sharper tiles once zoomed in.
      if (!map.getSource('nightlights')) {
        map.addSource('nightlights', {
          type: 'raster',
          tiles: [NIGHTLIGHTS_TILES],
          tileSize: 256,
          maxzoom: 8,
          attribution: 'NASA GIBS / VIIRS Black Marble'
        });
      }
      if (!map.getLayer('nightlights-layer')) {
        map.addLayer({
          id: 'nightlights-layer',
          type: 'raster',
          source: 'nightlights',
          minzoom: NIGHTLIGHTS_TILE_MINZOOM,
          paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 1500 } },
          layout: { 'visibility': nightLightsEnabled ? 'visible' : 'none' }
        });
      }

      if (nightLightsEnabled) ensureGlobalNightLights();

      // --- Custom labels (replacing Standard style's white-halo labels) ---
      if (!map.getSource('streets-data')) {
        map.addSource('streets-data', { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' });
      }

      var labelPaint = {
        'text-color': currentStyle.labelColor,
        'text-halo-color': currentStyle.haloColor,
        'text-halo-width': currentStyle.haloWidth
      };

      if (!map.getLayer('country-labels')) {
        map.addLayer({
          id: 'country-labels',
          type: 'symbol',
          source: 'streets-data',
          'source-layer': 'place_label',
          filter: ['==', ['get', 'class'], 'country'],
          layout: {
            'text-field': ['get', 'name'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 3, 14, 5, 18],
            'text-letter-spacing': 0.1,
            'text-max-width': 8
          },
          paint: labelPaint
        });
      }

      if (!map.getLayer('state-labels')) {
        map.addLayer({
          id: 'state-labels',
          type: 'symbol',
          source: 'streets-data',
          'source-layer': 'place_label',
          filter: ['in', ['get', 'class'], ['literal', ['state', 'region']]],
          minzoom: 3,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 5, 12, 7, 14],
            'text-letter-spacing': 0.05,
            'text-max-width': 8
          },
          paint: labelPaint
        });
      }

      if (!map.getLayer('city-labels')) {
        map.addLayer({
          id: 'city-labels',
          type: 'symbol',
          source: 'streets-data',
          'source-layer': 'place_label',
          filter: ['==', ['get', 'class'], 'settlement'],
          layout: {
            'text-field': ['get', 'name'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 6, 12, 10, 16, 14, 20],
            'text-max-width': 8
          },
          paint: labelPaint
        });
      }

      if (!map.getLayer('neighborhood-labels')) {
        map.addLayer({
          id: 'neighborhood-labels',
          type: 'symbol',
          source: 'streets-data',
          'source-layer': 'place_label',
          filter: ['==', ['get', 'class'], 'settlement_subdivision'],
          minzoom: 8,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 13, 15, 16],
            'text-max-width': 8
          },
          paint: labelPaint
        });
      }

      if (!map.getLayer('road-lights')) {
        map.addLayer({
          id: 'road-lights',
          type: 'line',
          source: 'streets-data',
          'source-layer': 'road',
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
          paint: {
            'line-color': '#ffb040',
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 8, 0.6, 12, 1.2],
            'line-opacity': 0.15,
            'line-blur': 1
          }
        });
      }

      // --- Wind streamlines ---
      if (!map.getSource('wind')) {
        map.addSource('wind', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      if (!map.getLayer('wind-layer')) {
        map.addLayer({
          id: 'wind-layer',
          type: 'line',
          source: 'wind',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
            'visibility': windEnabled ? 'visible' : 'none'
          },
          paint: {
            'line-color': [
              'interpolate', ['linear'], ['get', 'speed'],
              0, 'rgba(150,195,255,0.35)',
              8, 'rgba(195,230,255,0.65)',
              18, 'rgba(255,240,205,0.9)'
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.9, 6, 1.3, 10, 2],
            'line-dasharray': WIND_DASH_SEQUENCE[0]
          }
        });
      }
      if (windField) rebuildStreamlines();

      // --- Weather radar (RainViewer) ---
      // Source is created lazily once a live tile path has been resolved.
      if (radarTileUrl) applyRadarUrl(radarTileUrl);

      // --- Flights ---
      if (!map.getSource('flights')) {
        map.addSource('flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }

      if (!map.hasImage('airplane')) {
        var sz = 48;
        var ic = document.createElement('canvas');
        ic.width = sz; ic.height = sz;
        var ctx = ic.getContext('2d');
        ctx.fillStyle = palette.accent;
        ctx.translate(sz / 2, sz / 2);
        ctx.beginPath();
        ctx.moveTo(0, -14); ctx.lineTo(3, -4); ctx.lineTo(14, 2);
        ctx.lineTo(3, 3); ctx.lineTo(5, 12); ctx.lineTo(0, 9);
        ctx.lineTo(-5, 12); ctx.lineTo(-3, 3); ctx.lineTo(-14, 2);
        ctx.lineTo(-3, -4); ctx.closePath(); ctx.fill();
        var imgData = ctx.getImageData(0, 0, sz, sz);
        map.addImage('airplane', { width: sz, height: sz, data: imgData.data }, { pixelRatio: 2 });
      }

      if (!map.getLayer('flights-layer')) {
        map.addLayer({
          id: 'flights-layer',
          type: 'symbol',
          source: 'flights',
          layout: {
            'icon-image': 'airplane',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 5, 0.7, 8, 1.2, 12, 2.5],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'visibility': flightsEnabled ? 'visible' : 'none'
          },
          paint: { 'icon-opacity': 0.9 }
        });
      }
    }

    // ==================== DAY / NIGHT CROSSFADE ====================

    var nightImageUrl = null;

    // Builds (or rebuilds) the masked global image and wires it into the map.
    // The mask lives in the image's alpha channel, so the lights follow the real
    // terminator regardless of where the map is centred.
    function ensureGlobalNightLights() {
      loadMosaic(function () {
        renderNightLights(function (url) {
          var previous = nightImageUrl;
          nightImageUrl = url;

          var src = map.getSource('nightlights-global');
          if (src) {
            src.updateImage({ url: url });
          } else {
            map.addSource('nightlights-global', {
              type: 'image',
              url: url,
              coordinates: NIGHTLIGHTS_COORDS
            });
            map.addLayer({
              id: 'nightlights-global-layer',
              type: 'raster',
              source: 'nightlights-global',
              maxzoom: NIGHTLIGHTS_TILE_MINZOOM,
              paint: {
                'raster-opacity': NIGHTLIGHTS_MAX_OPACITY,
                'raster-fade-duration': 0
              },
              layout: { 'visibility': nightLightsEnabled ? 'visible' : 'none' }
            }, map.getLayer('country-labels') ? 'country-labels' : undefined);
          }

          if (previous) URL.revokeObjectURL(previous);
        });
      });
    }

    // The tiled layer (zoom >= 5) has no mask, so it still crossfades globally
    // by solar elevation at the centre — correct at that scale, where the whole
    // viewport shares roughly one local time. The darkening fills are backed off
    // by the same amount so the two don't stack into pure black.
    function applyNightBlend() {
      if (!map.getLayer('nightlights-layer')) return;
      var center = map.getCenter();
      var elevation = getSunElevation(center.lat, center.lng);
      // 0 at sunset, 1 once the sun is 12° below the horizon (nautical twilight).
      var k = 0;
      if (nightLightsEnabled) {
        k = -elevation / 12;
        if (k < 0) k = 0; if (k > 1) k = 1;
      }
      // Only dim the fills where the unmasked tiled layer is actually showing.
      var tiled = map.getZoom() >= NIGHTLIGHTS_TILE_MINZOOM ? k : 0;
      try {
        map.setPaintProperty('nightlights-layer', 'raster-opacity', k * NIGHTLIGHTS_MAX_OPACITY);
        map.setPaintProperty('twilight-overlay-layer', 'fill-opacity', 0.3 * (1 - tiled));
        map.setPaintProperty('night-overlay-layer', 'fill-opacity', 0.5 * (1 - tiled));
      } catch (e) { }
    }

    // While spinning, setCenter fires moveend continuously; spinStep already
    // paces the crossfade, so recomputing it here too would restart the opacity
    // transitions every frame.
    map.on('moveend', function () {
      // Past the global-request zoom the viewport defines what we ask for, so
      // panning or spinning has to pull in the newly visible area. fetchFlights
      // rate-limits itself.
      if (map.getZoom() >= FLIGHTS_GLOBAL_ZOOM) fetchFlights();
      if (windEnabled && windField && windZoomAtBuild !== null &&
          Math.abs(map.getZoom() - windZoomAtBuild) > 0.3) {
        rebuildStreamlines();
      }
      if (spinning) return;
      applyNightBlend();
    });

    // ==================== MAP LOAD ====================
    map.on('load', function () {
      mapLoaded = true;
      cityMarker.addTo(map);
      applyNightBlend();

      // Restore the rest of the persisted state.
      if (flightsEnabled) startFlightAnimation();
      if (spinEnabledInitial) window.setSpinEnabled(true);
      if (windEnabled) { fetchWind(); startWindAnimation(); }
      if (savedFlag('pollen-enabled', false)) window.setPollenEnabled(true);

      // Start background tasks (flights, radar, terminator)
      startBackgroundTasks();
    });

    // --- Flight fetching (primary view asks Swift; Swift answers every view) ---
    // The OpenSky API only allows its own origin via CORS, so the actual request
    // has to happen natively.
    // Below this zoom one world-wide request is fetched instead of the
    // viewport, so spinning or re-centring needs no further requests — and
    // getBounds() is unreliable on the globe projection anyway.
    var FLIGHTS_GLOBAL_ZOOM = 4;
    var FLIGHT_REQUEST_MIN_MS = 45000;
    var lastFlightRequest = 0;

    function fetchFlights(force) {
      if (!mapLoaded || appPaused || !flightsEnabled) return;
      if (!window.isPrimaryView) return;

      var now = Date.now();
      if (!force && now - lastFlightRequest < FLIGHT_REQUEST_MIN_MS) return;
      lastFlightRequest = now;

      var box;
      if (map.getZoom() < FLIGHTS_GLOBAL_ZOOM) {
        box = { south: -90, west: -180, north: 90, east: 180 };
      } else {
        var bounds = map.getBounds();
        box = {
          south: bounds.getSouth(), west: bounds.getWest(),
          north: bounds.getNorth(), east: bounds.getEast()
        };
      }

      try {
        webkit.messageHandlers.dataRelay.postMessage({
          type: 'requestFlights',
          json: JSON.stringify(box)
        });
      } catch (e) { console.warn('[Flights]', e.message || e); }
    }

    // Receiver for flight data pushed from Swift
    window.receiveFlights = function (data) {
      flightStore = data.store || [];
      lastFlightFetch = data.timestamp || Date.now();
      renderFlightPositions();
    };

    function renderFlightPositions() {
      var elapsed = (Date.now() - lastFlightFetch) / 1000;
      var features = [];
      for (var i = 0; i < flightStore.length; i++) {
        var f = flightStore[i];
        var dist = f.velocity * elapsed;
        var hRad = f.heading * DEG;
        var latRad = f.lat * DEG;
        var cosLat = Math.cos(latRad);
        var dLat = (dist / EARTH_R) * Math.cos(hRad) / DEG;
        var dLon = cosLat > 0.01 ? (dist / EARTH_R) * Math.sin(hRad) / cosLat / DEG : 0;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [f.lon + dLon, f.lat + dLat] },
          properties: {
            heading: f.heading, callsign: f.callsign, origin_country: f.origin_country,
            altitude: f.altitude, velocity: f.velocity, vertical_rate: f.vertical_rate
          }
        });
      }
      var src = map.getSource('flights');
      if (src) src.setData({ type: 'FeatureCollection', features: features });
    }

    function startFlightAnimation() {
      if (!flightAnimInterval) {
        flightAnimInterval = setInterval(renderFlightPositions, FLIGHT_RENDER_MS);
      }
    }

    // --- Wind (Open-Meteo, primary view only) ---

    // Mapbox's canonical dash-offset cycle; stepping through it makes the
    // streamlines appear to flow along their own direction.
    var WIND_DASH_SEQUENCE = [
      [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1],
      [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3],
      [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1],
      [0, 3.5, 3, 0.5]
    ];
    var windDashStep = 0;
    var windDashInterval = null;
    var windZoomAtBuild = null;

    function startWindAnimation() {
      if (windDashInterval) return;
      windDashInterval = setInterval(function () {
        if (appPaused || !windEnabled || !map.getLayer('wind-layer')) return;
        windDashStep = (windDashStep + 1) % WIND_DASH_SEQUENCE.length;
        try {
          map.setPaintProperty('wind-layer', 'line-dasharray', WIND_DASH_SEQUENCE[windDashStep]);
        } catch (e) { }
      }, 80);
    }

    function stopWindAnimation() {
      if (windDashInterval) { clearInterval(windDashInterval); windDashInterval = null; }
    }

    function fetchWind() {
      if (!mapLoaded || appPaused || !windEnabled) return;
      if (!window.isPrimaryView) return;

      var south, west, north, east;
      if (map.getZoom() < FLIGHTS_GLOBAL_ZOOM) {
        south = -60; west = -180; north = 75; east = 180;
      } else {
        var b = map.getBounds();
        south = b.getSouth(); west = b.getWest();
        north = b.getNorth(); east = b.getEast();
      }

      var lats = [], lons = [];
      for (var row = 0; row < WIND_GRID_ROWS; row++) {
        for (var col = 0; col < WIND_GRID_COLS; col++) {
          lats.push((south + (north - south) * row / (WIND_GRID_ROWS - 1)).toFixed(3));
          lons.push((west + (east - west) * col / (WIND_GRID_COLS - 1)).toFixed(3));
        }
      }

      var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + lats.join(',') +
        '&longitude=' + lons.join(',') +
        '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms';

      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var list = Array.isArray(data) ? data : [data];
          var u = new Float32Array(list.length);
          var v = new Float32Array(list.length);
          for (var i = 0; i < list.length; i++) {
            var cur = list[i] && list[i].current;
            var c = windComponents(
              (cur && cur.wind_speed_10m) || 0,
              (cur && cur.wind_direction_10m) || 0
            );
            u[i] = c.u; v[i] = c.v;
          }
          applyWindField({
            south: south, west: west, north: north, east: east,
            cols: WIND_GRID_COLS, rows: WIND_GRID_ROWS,
            u: Array.prototype.slice.call(u), v: Array.prototype.slice.call(v)
          });
          try {
            webkit.messageHandlers.dataRelay.postMessage({
              type: 'wind',
              json: JSON.stringify({
                south: south, west: west, north: north, east: east,
                cols: WIND_GRID_COLS, rows: WIND_GRID_ROWS,
                u: Array.prototype.slice.call(u), v: Array.prototype.slice.call(v)
              })
            });
          } catch (e) { }
        })
        .catch(function (err) { console.warn('[Wind]', err.message || err); });
    }

    function applyWindField(raw) {
      windField = new WindField(
        raw.south, raw.west, raw.north, raw.east,
        raw.cols, raw.rows, raw.u, raw.v
      );
      rebuildStreamlines();
    }

    window.receiveWind = function (raw) {
      if (window.isPrimaryView) return;
      applyWindField(raw);
    };

    function rebuildStreamlines() {
      if (!windField || !map.getSource('wind')) return;
      // Pick the integration step so a WIND_REFERENCE_SPEED wind draws roughly
      // WIND_TARGET_PX of line, whatever the zoom.
      var pixelsPerDegree = 512 * Math.pow(2, map.getZoom()) / 360;
      var targetDegrees = WIND_TARGET_PX / pixelsPerDegree;
      var stepSeconds =
        (targetDegrees * METERS_PER_DEGREE / WIND_REFERENCE_SPEED) / WIND_STEPS;

      windZoomAtBuild = map.getZoom();
      map.getSource('wind').setData(
        buildStreamlines(windField, WIND_STREAMLINES, WIND_STEPS, stepSeconds)
      );
    }

    window.setWindEnabled = function (on) {
      windEnabled = on;
      localStorage.setItem('wind-enabled', on ? '1' : '0');
      if (!mapLoaded) return;
      if (map.getLayer('wind-layer')) {
        map.setLayoutProperty('wind-layer', 'visibility', on ? 'visible' : 'none');
      }
      if (on) {
        if (windField) rebuildStreamlines(); else fetchWind();
        startWindAnimation();
      } else {
        stopWindAnimation();
      }
    };

    // --- Weather radar (RainViewer, primary view only) ---
    function fetchRadar() {
      if (!mapLoaded || appPaused) return;
      if (!window.isPrimaryView) return;
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.radar || !data.radar.past || !data.radar.past.length) return;
          var latest = data.radar.past[data.radar.past.length - 1];
          var tileUrl = 'https://tilecache.rainviewer.com' + latest.path + '/256/{z}/{x}/{y}/2/1_1.png';
          applyRadarUrl(tileUrl);
          // Relay radar URL to other views via Swift
          try {
            webkit.messageHandlers.dataRelay.postMessage({
              type: 'radarUrl',
              json: JSON.stringify(tileUrl)
            });
          } catch (e) { }
        })
        .catch(function (err) { console.warn('[Radar]', err.message || err); });
    }

    function applyRadarUrl(tileUrl) {
      radarTileUrl = tileUrl;
      var src = map.getSource('radar');
      if (src) {
        src.setTiles([tileUrl]);
        return;
      }
      map.addSource('radar', { type: 'raster', tiles: [tileUrl], tileSize: 256 });
      map.addLayer({
        id: 'radar-layer', type: 'raster', source: 'radar',
        paint: { 'raster-opacity': 0.5 },
        layout: { 'visibility': weatherEnabled ? 'visible' : 'none' }
      });
    }

    // Receiver for radar URL relayed from primary view
    window.receiveRadarUrl = function (tileUrl) {
      if (window.isPrimaryView) return;
      if (mapLoaded) applyRadarUrl(tileUrl);
    };
  }
})();
