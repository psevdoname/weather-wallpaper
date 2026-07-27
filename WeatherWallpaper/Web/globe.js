(function () {
  'use strict';

  var jsErrors = [];
  window.addEventListener('error', function (e) {
    jsErrors.push((e.message || 'error') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
  window.__jsErrors = jsErrors;

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

  // NASA publishes yesterday's true-colour imagery daily. Unlike a satellite
  // basemap — a cloud-free mosaic stitched mostly from summer scenes, hence its
  // permanent green Chukotka and missing polar ice — this shows the world as it
  // actually is today: snow line, sea ice and the day's cloud cover.
  var GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';

  function gibsDate(daysAgo) {
    var d = new Date(Date.now() - daysAgo * 86400000);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  function rasterStyle(tileUrl, maxzoom, attribution, background) {
    return {
      version: 8,
      glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
      sources: {
        'basemap-raster': {
          type: 'raster', tiles: [tileUrl], tileSize: 256,
          maxzoom: maxzoom, attribution: attribution
        }
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': background } },
        { id: 'basemap-raster-layer', type: 'raster', source: 'basemap-raster' }
      ]
    };
  }

  function todayImageryStyle() {
    // Yesterday, because the current day is still being assembled.
    var url = GIBS_BASE + 'VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/' +
      gibsDate(1) + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg';
    return rasterStyle(url, 9, 'NASA GIBS / VIIRS', '#050810');
  }

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
      id: 'today', name: 'Satellite · Today',
      style: todayImageryStyle(),
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
  var NIGHTLIGHTS_MAX_OPACITY = 1.0;
  // Luminance window mapped to alpha: below the floor is unlit ground and goes
  // fully transparent, above the ceiling is a city core at full strength.
  var LIGHT_FLOOR = 18;
  var LIGHT_CEIL = 90;


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

  // ==================== OPENWEATHERMAP OVERLAYS ====================
  // Global cloud and temperature tiles. Unlike the GOES/Himawari imagery on
  // NASA GIBS these cover Europe and Africa too. Free tier, one key.
  // The weather-map tiles are only produced up to z9.
  var OWM_MAXZOOM = 9;
  function owmTiles(layer, key) {
    return 'https://tile.openweathermap.org/map/' + layer + '/{z}/{x}/{y}.png?appid=' + key;
  }

  // ==================== WIND ====================
  // Live 10m wind from Open-Meteo (free, no key). One request returns the whole
  // grid, so the field costs a single call. Rendered as streamlines with an
  // animated dash rather than GPU particles: streamlines are ordinary line
  // layers, so they project correctly on the globe for free.
  // Open-Meteo bills per *location*, not per request, so the viewport grid is
  // kept small; it is refetched as the view moves. The globe uses NOAA GFS via
  // Swift instead, which is free and far denser.
  var WIND_GRID_COLS = 14;
  var WIND_GRID_ROWS = 10;
  // Locations per request, to keep the URL within a safe length.
  var WIND_CHUNK = 280;
  // Many thin short strokes read as a flowing field; fewer thick long ones
  // read as sausages.
  var WIND_PARTICLES = 2600;
  var WIND_TRAIL = 6;               // positions kept per particle
  var WIND_TICK_MS = 90;
  var WIND_MAX_AGE = 110;           // ticks before a particle is reseeded, so
                                    // they don't all pile into convergence zones
  var WIND_PX_PER_SEC = 30;         // on-screen speed of a reference wind
  var WIND_REFERENCE_SPEED = 5;     // m/s — near the median of a live 10m field
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
    var tileCanvas = document.createElement('canvas');
    tileCanvas.width = BM_TILE; tileCanvas.height = BM_TILE;
    var tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });
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
            // Turn brightness into alpha, per tile, so the work is spread over
            // the loads. Black Marble is mostly black background with lit
            // cities; keeping only the lit part lets the normal basemap stay
            // visible underneath instead of being covered by a dark image.
            tileCtx.clearRect(0, 0, BM_TILE, BM_TILE);
            tileCtx.drawImage(img, 0, 0, BM_TILE, BM_TILE);
            var tileData = tileCtx.getImageData(0, 0, BM_TILE, BM_TILE);
            var px = tileData.data;
            for (var i = 0; i < px.length; i += 4) {
              var lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
              var a = (lum - LIGHT_FLOOR) / (LIGHT_CEIL - LIGHT_FLOOR);
              if (a < 0) a = 0; else if (a > 1) a = 1;
              px[i + 3] = Math.round(a * 255);
            }
            tileCtx.putImageData(tileData, 0, 0);
            ctx.drawImage(tileCanvas, x * BM_TILE, y * BM_TILE);
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

  // Timers on a page WebKit considers hidden are throttled hard; timers inside
  // a Worker are not. Everything that needs a steady beat uses this.
  // A single long-lived worker ticker with subscribers. Creating a worker per
  // animation proved unreliable — short-lived ones stopped delivering after a
  // second or so — while one that simply keeps running is rock solid.
  function createTicker(intervalMs, onTick) {
    var worker = null, timer = null;
    try {
      var source = 'var t=setInterval(function(){postMessage(0);},' + intervalMs + ');' +
                   'onmessage=function(){clearInterval(t);close();};';
      worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      worker.onmessage = onTick;
    } catch (e) {
      worker = null;
      timer = setInterval(onTick, intervalMs);
    }
    return {
      stop: function () {
        if (worker) { worker.terminate(); worker = null; }
        if (timer) { clearInterval(timer); timer = null; }
      },
      isWorker: function () { return worker !== null; }
    };
  }

  function normalizeLon(lon) {
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  }

  // A sampled wind field over a regular lat/lon grid.
  function WindField(south, west, north, east, cols, rows, u, v, wraps) {
    this.wraps = !!wraps;
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
    // A global field wraps: the column after the last one is the first.
    if (this.wraps) {
      x = x % this.cols;
      if (x < 0) x += this.cols;
    }
    if (!(y >= 0 && y <= this.rows - 1)) return null;
    if (!this.wraps && !(x >= 0 && x <= this.cols - 1)) return null;

    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = this.wraps ? x0 + 1 : Math.min(x0 + 1, this.cols - 1);
    var y1 = Math.min(y0 + 1, this.rows - 1);
    var fx = x - x0, fy = y - y0;

    if (this.wraps) { x1 = x1 % this.cols; }
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
    var mapFeatures = {
      labels: savedFlag('feature-labels', true),
      boundaries: savedFlag('feature-boundaries', false),
      roads: savedFlag('feature-roads', false),
      roadGlow: savedFlag('feature-roadGlow', false),
      paths: savedFlag('feature-paths', false),
      roadLabels: savedFlag('feature-roadLabels', false),
      poiLabels: savedFlag('feature-poiLabels', false)
    };
    var spinEnabledInitial = savedFlag('spin-enabled', false);
    var spinPixelsPerSec = parseFloat(localStorage.getItem('spin-speed'));
    if (Number.isNaN(spinPixelsPerSec)) spinPixelsPerSec = 26;
    var nightLightsEnabled = savedFlag('night-lights', false);
    var windEnabled = savedFlag('wind-enabled', false);
    var windDensity = parseInt(localStorage.getItem('wind-density'), 10);
    if (!windDensity || windDensity < 200) windDensity = WIND_PARTICLES;
    var flightColor = localStorage.getItem('flight-color') || palette.accent;
    var owmEnabled = {
      clouds: savedFlag('clouds-enabled', false),
      temperature: savedFlag('temperature-enabled', false)
    };
    var windField = null;
    var radarTileUrl = null;
    // Repositioning is paced by how far aircraft actually move on screen. At
    // cruise (~0.00225 deg/s) that is 0.018 px/s on the globe — 83 seconds per
    // 1.5px — so updating once a second there was ~80x more often than any eye
    // could tell, while each update costs several map renders.
    var FLIGHT_DEG_PER_SEC = 0.00225;
    var FLIGHT_TARGET_PX = 1.5;
    var FLIGHT_MIN_MS = 400;
    var FLIGHT_MAX_MS = 20000;

    function flightRenderInterval() {
      var pixelsPerDegree = 512 * Math.pow(2, map.getZoom()) / 360;
      var pixelsPerSecond = FLIGHT_DEG_PER_SEC * pixelsPerDegree;
      var ms = (FLIGHT_TARGET_PX / pixelsPerSecond) * 1000;
      if (ms < FLIGHT_MIN_MS) ms = FLIGHT_MIN_MS;
      if (ms > FLIGHT_MAX_MS) ms = FLIGHT_MAX_MS;
      return ms;
    }

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
      // Symbols cross-fade over 300ms by default. The flight layer replaces
      // thousands of icons twice a second, so the fade never settles and the
      // map re-renders continuously — ~33fps of pure overhead while idle.
      fadeDuration: 0,
    });

    var mapLoaded = false;
    var mapErrors = [];

    // ==================== STYLE ====================

    // Fires on first load and again after every setStyle(), which wipes all
    // imperatively-added sources, layers and images.
    map.on('error', function (e) {
      var msg = (e && e.error && e.error.message) || (e && e.message) || 'map error';
      if (mapErrors.length < 6) mapErrors.push(msg);
    });

    map.on('style.load', function () {
      applyStyleConfig();
      try { map.setProjection('globe'); } catch (e) { }
      reportStyleDiagnostics();
      map.on('render', function () {
        renderCount++;
        renderTimes.push(performance.now());
        if (renderTimes.length > 400) renderTimes.shift();
      });
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
      if (map.getLayer('nightlights-global-layer')) {
        map.setLayoutProperty('nightlights-global-layer', 'visibility', on ? 'visible' : 'none');
      } else if (on) {
        ensureGlobalNightLights();
      }
      applyNightBlend();
    };

    // Individual feature toggles. Each one covers both our own layers and the
    // equivalent in the basemap, which is what actually draws most of this.
    var LABEL_LAYER_IDS = [
      'country-labels', 'state-labels', 'city-labels', 'neighborhood-labels'
    ];

    function setVisible(layerId, visible) {
      try {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      } catch (e) { }
    }

    function setConfig(property, value) {
      try { map.setConfigProperty('basemap', property, value); } catch (e) { }
    }

    // Hides layers of a classic vector style (dark-v11 and friends), which
    // expose their layers directly rather than through config properties.
    function setSourceLayerVisible(sourceLayerName, visible, exceptId) {
      var style = map.getStyle();
      var layers = (style && style.layers) || [];
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer['source-layer'] !== sourceLayerName) continue;
        if (exceptId && layer.id === exceptId) continue;
        setVisible(layer.id, visible);
      }
    }

    // One-shot dump of what the loaded style actually exposes, so the boundary
    // and road controls can be verified instead of guessed at.
    function reportStyleDiagnostics() {
      if (!window.isPrimaryView) return;
      setTimeout(function () {
        var out = { style: currentStyle.id, config: {}, adminLayers: [], roadLayers: [], imports: null };
        ['showAdminBoundaries', 'showRoadsAndTransit', 'showPedestrianRoads',
         'colorAdminBoundaries', 'colorRoads', 'colorLand', 'theme'].forEach(function (name) {
          try { out.config[name] = map.getConfigProperty('basemap', name); }
          catch (e) { out.config[name] = 'ERROR: ' + (e.message || e); }
        });
        try {
          var style = map.getStyle();
          out.imports = (style.imports || []).map(function (i) { return i.id; });
          (style.layers || []).forEach(function (l) {
            if (l['source-layer'] === 'admin') out.adminLayers.push(l.id);
            if (l['source-layer'] === 'road') out.roadLayers.push(l.id);
          });
          out.totalLayers = (style.layers || []).length;
        } catch (e) { out.styleError = e.message || String(e); }
        try {
        out.mapLoaded = mapLoaded;
        out.mapErrors = mapErrors;
        out.jsErrors = (window.__jsErrors || []).slice(0, 5);
        // Frames over the last few seconds. Averaging since load mixed in the
        // idle period before the spin started and understated everything.
        var nowMs = performance.now();
        var recent = renderTimes.filter(function (t) { return nowMs - t < 5000; });
        out.renderFps = recent.length / 5;
        out.renderFpsSinceLoad = renderCount / ((nowMs - renderCountStart) / 1000);
        // If WebKit fell back to a software rasteriser, no amount of layer
        // tuning would ever help — worth knowing before rewriting anything.
        try {
          var gl = map.painter && map.painter.context && map.painter.context.gl;
          if (!gl) {
            var probe = document.createElement('canvas');
            gl = probe.getContext && (probe.getContext('webgl2') || probe.getContext('webgl'));
          }
          if (gl) {
            var info = gl.getExtension('WEBGL_debug_renderer_info');
            out.webgl = {
              renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
              vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
              maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE)
            };
          } else {
            out.webgl = 'no context';
          }
        } catch (e) { out.webgl = 'probe failed: ' + ((e && e.message) || e); }
        out.lastCameraRequest = lastCameraRequest;
        out.cameraCalls = cameraCallCount;
        out.mapCenter = [map.getCenter().lng, map.getCenter().lat];
        out.mapZoom = map.getZoom();
        out.spin = {
          spinEnabled: spinEnabled,
          spinning: spinning,
          tickerRunning: masterTicker !== null,
          masterTicks: masterTickCount,
          cameraAnimating: cameraAnimation !== null,
          subscribers: tickSubscribers.length,
          spinSubscribed: tickSubscribers.indexOf(spinTick) !== -1,
          msSinceLastMasterTick: masterLastTickAt ? Math.round(performance.now() - masterLastTickAt) : null,
          workerDriven: masterTicker ? masterTicker.isWorker() : false,
          subscribers: tickSubscribers.length,
          pixelsPerSec: spinPixelsPerSec,
          degPerSec: currentSpinSpeed(),
          frames: spinFrameCount,
          lonTravelled: spinLonTravelled,
          elapsedSec: spinStartedAt ? (performance.now() - spinStartedAt) / 1000 : 0
        };
        out.wind = {
          enabled: windEnabled,
          hasField: !!windField,
          fieldIsGlobal: windFieldIsGlobal,
          particles: windParticles.length,
          tickRunning: !!windTickInterval,
          tickIsWorker: masterTicker ? masterTicker.isWorker() : null,
          layerExists: !!map.getLayer('wind-layer'),
          layerVisibility: map.getLayer('wind-layer')
            ? map.getLayoutProperty('wind-layer', 'visibility') : null,
          lastFeatureCount: windLastFeatureCount,
          flightIntervalMs: Math.round(flightRenderInterval()),
          computeMs: Math.round(windComputeMs * 10) / 10,
          culled: windCulledCount,
          setDataMs: Math.round(windSetDataMs * 10) / 10,
          tickIntervalMs: (function () {
            if (!windTickTimes.length) return null;
            var sum = 0, max = 0;
            for (var i = 0; i < windTickTimes.length; i++) {
              sum += windTickTimes[i];
              if (windTickTimes[i] > max) max = windTickTimes[i];
            }
            return { avg: Math.round(sum / windTickTimes.length), max: Math.round(max), target: WIND_TICK_MS };
          })(),
          lonOffsets: (function () {
            // Histogram of particle longitude relative to the map centre, to
            // see whether spinning leaves a gap ahead of the view.
            var c = map.getCenter().lng, buckets = {};
            for (var i = 0; i < windParticles.length; i++) {
              var d = windParticles[i].lon - c;
              while (d > 180) d -= 360; while (d < -180) d += 360;
              var key = String(Math.floor(d / 30) * 30);
              buckets[key] = (buckets[key] || 0) + 1;
            }
            return buckets;
          })(),
          lastError: windLastError,
          loadHandlerError: loadHandlerError,
          fetchWindCalls: fetchWindCalls,
          globalWindPosts: globalWindPosts,
          mapLoaded: mapLoaded,
          isPrimary: window.isPrimaryView,
          source: windFieldSource,
          urlLength: windLastUrlLength,
          zoom: map.getZoom()
        };
        if (windField) {
          out.wind.field = {
            south: windField.south, west: windField.west,
            rows: windField.rows, cols: windField.cols,
            centerLat: map.getCenter().lat,
            centerLon: map.getCenter().lng,
            sampleAtCenter: windField.sample(map.getCenter().lat, map.getCenter().lng),
            sampleAtBerlin: windField.sample(52.5, 13.4)
          };
        }
        } catch (e) { out.windError = (e && e.message) || String(e); }
        try {
          webkit.messageHandlers.dataRelay.postMessage({ type: 'debug', json: JSON.stringify(out, null, 2) });
        } catch (e) { }
      }, 6000);
      if (!diagnosticsRepeat) diagnosticsRepeat = setInterval(reportStyleDiagnostics, 15000);
    }

    function applyMapFeatures() {
      var f = mapFeatures;

      for (var i = 0; i < LABEL_LAYER_IDS.length; i++) {
        setVisible(LABEL_LAYER_IDS[i], f.labels);
      }

      setConfig('showAdminBoundaries', f.boundaries);
      setSourceLayerVisible('admin', f.boundaries);

      // Standard Satellite has a boolean; plain Standard has none, so its roads
      // are painted the colour of the land instead.
      setConfig('showRoadsAndTransit', f.roads);
      if (roadDefaults) {
        var c = f.roads
          ? roadDefaults
          : { motorways: roadDefaults.land, trunks: roadDefaults.land, roads: roadDefaults.land };
        setConfig('colorMotorways', c.motorways);
        setConfig('colorTrunks', c.trunks);
        setConfig('colorRoads', c.roads);
      }
      setSourceLayerVisible('road', f.roads, 'road-lights');
      setVisible('road-lights', f.roadGlow);

      setConfig('showPedestrianRoads', f.paths);
      setConfig('showRoadLabels', f.roadLabels);
      setConfig('showPointOfInterestLabels', f.poiLabels);
      setConfig('showTransitLabels', f.poiLabels);
    }

    window.setMapFeature = function (name, on) {
      if (!(name in mapFeatures)) return;
      mapFeatures[name] = on;
      localStorage.setItem('feature-' + name, on ? '1' : '0');
      applyMapFeatures();
    };

    // Planes are easy to lose against red admin boundaries, so the colour is
    // configurable. The icon is a canvas image, so it has to be redrawn.
    window.setFlightColor = function (color) {
      flightColor = color;
      localStorage.setItem('flight-color', color);
      if (!mapLoaded || !map.getLayer('flights-layer')) return;
      try {
        map.removeLayer('flights-layer');
        map.removeImage('airplane');
      } catch (e) { }
      addCustomLayers();
      renderFlightPositions();
    };

    window.setSpinSpeed = function (pixelsPerSec) {
      spinPixelsPerSec = pixelsPerSec;
      localStorage.setItem('spin-speed', String(pixelsPerSec));
    };

    // Restores every toggle-driven layer state after a style swap.
    function reapplyToggles() {
      applyMapFeatures();
      if (map.getLayer('flights-layer')) {
        map.setLayoutProperty('flights-layer', 'visibility', flightsEnabled ? 'visible' : 'none');
        renderFlightPositions();
      }
      if (map.getLayer('radar-layer')) {
        map.setLayoutProperty('radar-layer', 'visibility', weatherEnabled ? 'visible' : 'none');
      }
      if (map.getLayer('nightlights-global-layer')) {
        map.setLayoutProperty('nightlights-global-layer', 'visibility', nightLightsEnabled ? 'visible' : 'none');
      }
      if (map.getLayer('wind-layer')) {
        map.setLayoutProperty('wind-layer', 'visibility', windEnabled ? 'visible' : 'none');
      }
      ['clouds', 'temperature'].forEach(function (id) {
        var layerId = 'owm-' + id + '-layer';
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', owmEnabled[id] ? 'visible' : 'none');
        }
      });
    }

    var spinning = false;
    var spinEnabled = false;
    // Driven by a timer, not requestAnimationFrame: the wallpaper window is
    // never focused, so WebKit treats the page as hidden and throttles rAF to
    // about 1.5 calls per second — which looked like stutter, and like a
    // stopped globe once the wind loop competed for the main thread.
    // Spin is specified in screen pixels per second rather than degrees, so it
    // feels the same on the globe and at street zoom (26 px/s is ~110s per
    // revolution on the globe view). Set from the menu bar.
    var lastSpinRender = 0;
    var spinFrameCount = 0;
    var spinStartedAt = 0;
    var diagnosticsRepeat = null;
    var loadHandlerError = null;
    var fetchWindCalls = 0;
    var globalWindPosts = 0;
    var renderCount = 0;
    var renderTimes = [];
    var renderCountStart = performance.now();
    var spinLonTravelled = 0;
    var lastNightBlend = 0;
    // The terminator moves ~0.02° in 5s, so there is nothing to gain from
    // recomputing the crossfade more often — and each one restarts a 1.5s
    // opacity transition, which is what made the spin shimmer.
    var NIGHT_BLEND_MS = 5000;
    // `spinEnabled` is what the user asked for; `spinning` is whether the loop
    // is currently running. They differ while a camera animation borrows the
    // camera, since both drive the same map.
    function spinTick() { if (spinning) spinStep(); }

    function startSpinLoop() {
      lastSpinRender = performance.now();
      if (!spinStartedAt) spinStartedAt = lastSpinRender;
      subscribeTick(spinTick);
    }

    function stopSpinLoop() {
      unsubscribeTick(spinTick);
    }

    var lastCameraRequest = null;

    var MASTER_TICK_MS = 25;
    var masterTicker = null;
    var masterTickCount = 0;
    var masterLastTickAt = 0;
    var tickSubscribers = [];

    // Started once and never stopped. Workers created on demand were being
    // killed after a second or two; one that simply keeps running is stable,
    // which is why the wind loop always worked and per-animation ones did not.
    function startMasterTicker() {
      if (masterTicker) return;
      masterTicker = createTicker(MASTER_TICK_MS, function () {
        masterTickCount++;
        masterLastTickAt = performance.now();
        for (var i = tickSubscribers.length - 1; i >= 0; i--) {
          try { tickSubscribers[i](); } catch (e) { }
        }
      });
    }

    function subscribeTick(fn) {
      if (typeof fn !== 'function') { console.warn('[Tick] ignoring non-function subscriber'); return; }
      if (tickSubscribers.indexOf(fn) === -1) tickSubscribers.push(fn);
      startMasterTicker();
    }

    function unsubscribeTick(fn) {
      var index = tickSubscribers.indexOf(fn);
      if (index !== -1) tickSubscribers.splice(index, 1);
    }


    // Mapbox animates the camera on requestAnimationFrame, which is throttled
    // to ~1.5Hz on this window — a 2s flyTo then takes minutes and looks like
    // the map ignoring the request entirely. Drive the interpolation ourselves
    // off the worker ticker and apply each step with jumpTo.
    var cameraCallCount = 0;
    var cameraAnimation = null;

    // Permanently subscribed; it simply does nothing when no animation is
    // active. Subscribing and unsubscribing per animation turned out to be the
    // thing that kept losing the camera mid-flight.
    function cameraStep() {
      var a = cameraAnimation;
      if (!a) return;

      a.request.ticks++;
      var t = (performance.now() - a.startedAt) / a.duration;
      a.request.lastT = t;
      if (t > 1) t = 1;
      var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      map.jumpTo({
        center: [normalizeLon(a.from.lng + a.deltaLng * e),
                 a.from.lat + (a.toLat - a.from.lat) * e],
        zoom: a.fromZoom + (a.toZoom - a.fromZoom) * e
      });

      if (t >= 1) {
        a.request.finishedAt = performance.now() - a.startedAt;
        cameraAnimation = null;
        if (a.resumeAfter && spinEnabled && !spinning) {
          spinning = true;
          startSpinLoop();
        }
      }
    }

    function runCameraAnimation(options) {
      cameraCallCount++;
      var request = {
        call: cameraCallCount,
        at: new Date().toISOString(),
        center: options.center || null,
        zoom: options.zoom,
        spinningBefore: spinning,
        ticks: 0
      };
      lastCameraRequest = request;

      var resumeAfter = spinning || (cameraAnimation && cameraAnimation.resumeAfter);
      if (spinning) {
        spinning = false;
        stopSpinLoop();
      }

      var from = map.getCenter();
      var deltaLng = 0;
      if (options.center) {
        deltaLng = options.center[0] - from.lng;
        while (deltaLng > 180) deltaLng -= 360;
        while (deltaLng < -180) deltaLng += 360;
      }

      cameraAnimation = {
        request: request,
        startedAt: performance.now(),
        duration: options.duration || 1500,
        from: from,
        fromZoom: map.getZoom(),
        toLat: options.center ? options.center[1] : from.lat,
        toZoom: options.zoom != null ? options.zoom : map.getZoom(),
        deltaLng: deltaLng,
        resumeAfter: !!resumeAfter
      };
    }

    window.setSpinEnabled = function (on) {
      spinEnabled = on;
      spinning = on;
      if (on) startSpinLoop(); else stopSpinLoop();
    };
    var appPaused = false;
    window.setAppPaused = function (paused) {
      appPaused = paused;
      if (paused) {
        // Stop animations
        stopSpinLoop();
        stopFlightAnimation();
        stopWindAnimation();
        // Stop fetching
        stopBackgroundTasks();
      } else {
        // Resume animations if they were enabled
        if (spinning) startSpinLoop();
        if (flightsEnabled) startFlightAnimation();
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
      if (windEnabled) fetchWind(true);

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
        if (!appPaused && windEnabled) fetchWind(true);
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

    function spinStep() {
      if (!spinning) { stopSpinLoop(); return; }
      var ts = performance.now();

      // Move on every frame. Throttling to 30fps on a 60/120Hz display is
      // itself the stutter: the map jumps once per 33ms while the compositor
      // presents every 8-16ms, so the eye sees steps. dt spans the real
      // interval, so the speed stays correct at any refresh rate.
      var dt = (ts - lastSpinRender) / 1000;
      lastSpinRender = ts;
      // WebKit throttles timers on this window (it is never focused), so gaps
      // of several hundred ms are normal. Clamp long gaps instead of dropping
      // them: discarding meant two thirds of elapsed time never turned the
      // globe, so it crawled at a third of the requested speed.
      if (dt > 0.5) dt = 0.5;
      if (dt > 0) {   // skip the first frame and resumes after a pause
        var center = map.getCenter();
        var step = currentSpinSpeed() * dt;
        spinFrameCount++;
        spinLonTravelled += step;
        center.lng += step;
        if (center.lng > 180) center.lng -= 360;
        map.setCenter(center);
      }
      if (ts - lastNightBlend >= NIGHT_BLEND_MS) {
        lastNightBlend = ts;
        applyNightBlend();
      }
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
          stopFlightAnimation();
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

      // --- OpenWeatherMap overlays (clouds, temperature) ---
      addOwmLayer('clouds', 'clouds_new', 0.55);
      addOwmLayer('temperature', 'temp_new', 0.5);

      // --- Wind streamlines ---
      if (!map.getSource('wind')) {
        map.addSource('wind', {
          type: 'geojson',
          lineMetrics: true,          // required for line-gradient
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      if (!map.getLayer('wind-layer')) {
        map.addLayer({
          id: 'wind-layer',
          type: 'line',
          source: 'wind',
          layout: {
            // round caps/joins are generated per line; with thousands of them
            // that cost ~5fps of spin, and the gradient hides the difference.
            'line-cap': 'butt',
            'line-join': 'miter',
            'visibility': windEnabled ? 'visible' : 'none'
          },
          paint: {
            // Trails run oldest -> newest, so the gradient fades in towards
            // the head. This is what separates a comet from a sausage.
            'line-gradient': [
              'interpolate', ['linear'], ['line-progress'],
              0, 'rgba(130,180,255,0)',
              0.55, 'rgba(180,220,255,0.30)',
              1, 'rgba(240,250,255,0.95)'
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 6, 1.0, 10, 1.5],
            'line-opacity': 0.9
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

      if (map.hasImage('airplane')) map.removeImage('airplane');
      if (true) {
        var sz = 48;
        var ic = document.createElement('canvas');
        ic.width = sz; ic.height = sz;
        var ctx = ic.getContext('2d');
        ctx.fillStyle = flightColor;
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
          paint: { 'icon-opacity': 0.9, 'icon-opacity-transition': { duration: 0 } }
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
      if (!map.getLayer('nightlights-global-layer')) return;
      var center = map.getCenter();
      var elevation = getSunElevation(center.lat, center.lng);
      // 0 at sunset, 1 once the sun is 12° below the horizon (nautical twilight).
      var k = 0;
      if (nightLightsEnabled) {
        k = -elevation / 12;
        if (k < 0) k = 0; if (k > 1) k = 1;
      }
      try {
        if (map.getLayer('nightlights-global-layer')) {
          map.setPaintProperty('nightlights-global-layer', 'raster-opacity',
                               k * NIGHTLIGHTS_MAX_OPACITY);
        }
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
      if (windEnabled) {
        if (!windFieldCoversView()) {
          fetchWind();
        } else if (windZoomAtBuild !== null &&
                   Math.abs(map.getZoom() - windZoomAtBuild) > 0.25) {
          // Step length is derived from zoom, so lines built at another zoom
          // are the wrong on-screen size.
          rebuildStreamlines();
        }
      }
      if (spinning) return;
      applyNightBlend();
    });

    // ==================== MAP LOAD ====================
    map.on('load', function () {
      try {
      mapLoaded = true;
      startMasterTicker();
      subscribeTick(cameraStep);
      cityMarker.addTo(map);
      applyNightBlend();

      // Restore the rest of the persisted state.
      if (flightsEnabled) startFlightAnimation();
      if (spinEnabledInitial) window.setSpinEnabled(true);
      if (windEnabled) { fetchWind(true); startWindAnimation(); }
      if (savedFlag('pollen-enabled', false)) window.setPollenEnabled(true);

      // Start background tasks (flights, radar, terminator)
      startBackgroundTasks();
      } catch (e) {
        loadHandlerError = (e && e.message) || String(e);
        console.error('[Load]', loadHandlerError);
      }
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

    var flightAccumulator = 0;

    function flightTickStep() {
      flightAccumulator += MASTER_TICK_MS;
      if (flightAccumulator < flightRenderInterval()) return;
      flightAccumulator = 0;
      renderFlightPositions();
    }

    function startFlightAnimation() {
      if (flightAnimInterval) return;
      flightAnimInterval = true;
      subscribeTick(flightTickStep);
    }

    function stopFlightAnimation() {
      if (flightAnimInterval) { unsubscribeTick(flightTickStep); flightAnimInterval = null; }
    }

    // --- OpenWeatherMap overlays ---

    function owmKey() { return localStorage.getItem('owm-api-key') || ''; }

    // Sources are only created once a key exists; without one every tile 401s.
    function addOwmLayer(id, owmLayerName, opacity) {
      var key = owmKey();
      if (!key) return;
      var sourceId = 'owm-' + id;
      var layerId = sourceId + '-layer';
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [owmTiles(owmLayerName, key)],
          tileSize: 256,
          maxzoom: OWM_MAXZOOM,
          attribution: 'OpenWeatherMap'
        });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': opacity },
          layout: { 'visibility': owmEnabled[id] ? 'visible' : 'none' }
        });
      }
    }

    function setOwmEnabled(id, on) {
      owmEnabled[id] = on;
      localStorage.setItem(id + '-enabled', on ? '1' : '0');
      if (!mapLoaded) return;
      var layerId = 'owm-' + id + '-layer';
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
      } else if (on) {
        // Key may have arrived after the style loaded.
        addOwmLayer('clouds', 'clouds_new', 0.55);
        addOwmLayer('temperature', 'temp_new', 0.5);
      }
    }

    window.setCloudsEnabled = function (on) { setOwmEnabled('clouds', on); };
    window.setTemperatureEnabled = function (on) { setOwmEnabled('temperature', on); };

    // --- Wind (Open-Meteo, primary view only) ---

    // Particles advected through the field. Their speed is the real wind
    // speed, mapped to a constant on-screen scale, so gales visibly race and
    // calm air drifts — which a dash animation could never show.
    var windZoomAtBuild = null;
    var windParticles = [];
    var windTickInterval = null;
    var windLastFeatureCount = -1;
    var windLastError = null;
    var windComputeMs = 0;
    var windCulledCount = 0;
    var windSetDataMs = 0;
    var windTickTimes = [];
    var windLastTickAt = 0;
    var windFieldSource = null;
    var windLastUrlLength = 0;
    var windFieldIsGlobal = false;
    var lastWindRequest = 0;
    // At 140 calls per request this allows ~4200 calls/hour, inside the free
    // hourly budget even if the view keeps changing.
    var WIND_REQUEST_MIN_MS = 120000;
    var WIND_BACKOFF_MS = 15 * 60000;
    var windBackoffUntil = 0;

    // The field is sampled for whatever was on screen at the time, so after a
    // zoom or pan it may no longer cover the view at all — in which case every
    // particle falls outside the grid and nothing is drawn.
    function windFieldCoversView() {
      if (!windField) return false;
      if (map.getZoom() < FLIGHTS_GLOBAL_ZOOM) return windFieldIsGlobal;
      var b = map.getBounds();
      var north = windField.south + windField.dLat * (windField.rows - 1);
      var east = windField.west + windField.dLon * (windField.cols - 1);
      return b.getSouth() >= windField.south && b.getNorth() <= north &&
             b.getWest() >= windField.west && b.getEast() <= east;
    }

    function seedParticle(p) {
        var south = windField.south;
        var west = windField.west;
        var north = south + windField.dLat * (windField.rows - 1);
        var east = west + windField.dLon * (windField.cols - 1);

        // On the globe half the planet faces away, so seeding across the whole
        // field wastes half the particles. getBounds is unreliable there, but
        // the visible hemisphere is simply the region around the centre.
        if (map.getZoom() < FLIGHTS_GLOBAL_ZOOM) {
          var c = map.getCenter();
          south = Math.max(south, c.lat - 75);
          north = Math.min(north, c.lat + 75);
          west = c.lng - 85;
          east = c.lng + 85;
        } else if (map.getZoom() >= FLIGHTS_GLOBAL_ZOOM) {
          try {
            var b = map.getBounds();
            south = Math.max(south, b.getSouth());
            north = Math.min(north, b.getNorth());
            west = Math.max(west, b.getWest());
            east = Math.min(east, b.getEast());
          } catch (e) { }
        }
        if (!(north > south && east > west)) {
          south = windField.south; west = windField.west;
          north = south + windField.dLat * (windField.rows - 1);
          east = west + windField.dLon * (windField.cols - 1);
        }

        p.lat = south + Math.random() * (north - south);
        p.lon = normalizeLon(west + Math.random() * (east - west));
        p.trail = [];
        p.age = Math.floor(Math.random() * WIND_MAX_AGE);
        p.speed = 0;
    }

    // On the globe roughly half the planet faces away, and near the limb the
    // rest is edge-on. Building geometry for particles the viewer cannot see is
    // pure waste, so they are dropped before the mesh is handed to Mapbox.
    var cullCenterLat = 0, cullCenterLon = 0, cullGlobe = false;
    var cullSouth = -90, cullNorth = 90, cullWest = -180, cullEast = 180;
    var VISIBLE_ANGLE_DEG = 78;

    function prepareCulling() {
      cullGlobe = map.getZoom() < FLIGHTS_GLOBAL_ZOOM;
      if (cullGlobe) {
        var c = map.getCenter();
        cullCenterLat = c.lat; cullCenterLon = c.lng;
      } else {
        var b = map.getBounds();
        var padLat = (b.getNorth() - b.getSouth()) * 0.1;
        var padLon = (b.getEast() - b.getWest()) * 0.1;
        cullSouth = b.getSouth() - padLat; cullNorth = b.getNorth() + padLat;
        cullWest = b.getWest() - padLon; cullEast = b.getEast() + padLon;
      }
    }

    function isOnScreen(lat, lon) {
      if (!cullGlobe) {
        if (lat < cullSouth || lat > cullNorth) return false;
        // Bounds may straddle the antimeridian, in which case west > east.
        var lonN = normalizeLon(lon);
        var west = normalizeLon(cullWest);
        var east = normalizeLon(cullEast);
        if (west <= east) return lonN >= west && lonN <= east;
        return lonN >= west || lonN <= east;
      }
      // Angular distance from the point facing the viewer.
      var dLon = (lon - cullCenterLon) * DEG;
      var a = Math.sin(lat * DEG) * Math.sin(cullCenterLat * DEG) +
              Math.cos(lat * DEG) * Math.cos(cullCenterLat * DEG) * Math.cos(dLon);
      return a > Math.cos(VISIBLE_ANGLE_DEG * DEG);
    }

    function windTick() {
      if (appPaused || !windEnabled || !windField || !map.getSource('wind')) return;


      while (windParticles.length < windDensity) {
        var fresh = {};
        seedParticle(fresh);
        windParticles.push(fresh);
      }

      // Seconds of simulated time per tick, chosen so a reference wind travels
      // WIND_PX_PER_SEC on screen regardless of zoom.
      var pixelsPerDegree = 512 * Math.pow(2, map.getZoom()) / 360;
      var baseScale = WIND_PX_PER_SEC * METERS_PER_DEGREE / pixelsPerDegree;
      var tickSeconds = WIND_TICK_MS / 1000;

      var tickStart = performance.now();
      var lines = [];
      var culled = 0;
      prepareCulling();
      for (var i = 0; i < windParticles.length; i++) {
        var p = windParticles[i];
        var w = windField.sample(p.lat, p.lon);
        var cosLat = Math.cos(p.lat * DEG);
        if (!w || p.age > WIND_MAX_AGE || cosLat < 0.05) { seedParticle(p); continue; }

        var previous = p.trail.length ? p.trail[p.trail.length - 1] : null;
        if (previous && Math.abs(p.lon - previous[0]) > 180) p.trail = [];
        p.trail.push([p.lon, p.lat]);
        if (p.trail.length > WIND_TRAIL) p.trail.shift();

        p.speed = Math.sqrt(w.u * w.u + w.v * w.v);

        // Screen speed follows sqrt(wind speed), not wind speed itself. Linear
        // mapping is faithful but unreadable: a 1 m/s breeze drew a 6px dot
        // while a gale shot off screen. sqrt keeps faster genuinely faster
        // while leaving calm air visible.
        var gain = p.speed > 0.01
          ? Math.sqrt(p.speed / WIND_REFERENCE_SPEED) / p.speed
          : 0;
        var dt = tickSeconds * baseScale * gain;

        p.lat += (w.v * dt) / METERS_PER_DEGREE;
        p.lon = normalizeLon(p.lon + (w.u * dt) / (METERS_PER_DEGREE * cosLat));
        p.age++;

        if (p.trail.length > 1 && isOnScreen(p.lat, p.lon)) lines.push(p.trail.slice());
        else if (p.trail.length > 1) culled++;
      }
      var nowTick = performance.now();
      if (windLastTickAt) {
        windTickTimes.push(nowTick - windLastTickAt);
        if (windTickTimes.length > 60) windTickTimes.shift();
      }
      windLastTickAt = nowTick;
      var computeMs = performance.now() - tickStart;
      windCulledCount = culled;
      windLastFeatureCount = lines.length;
      var setDataStart = performance.now();
      map.getSource('wind').setData({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: lines },
        properties: {}
      });
      windComputeMs = computeMs;
      windSetDataMs = performance.now() - setDataStart;
    }

    var windTickAccumulator = 0;

    function windTickStep() {
      windTickAccumulator += MASTER_TICK_MS;
      if (windTickAccumulator < WIND_TICK_MS) return;
      windTickAccumulator = 0;
      windTick();
    }

    function startWindAnimation() {
      if (windTickInterval) return;
      windTickInterval = true;
      subscribeTick(windTickStep);
    }

    function stopWindAnimation() {
      if (windTickInterval) { unsubscribeTick(windTickStep); windTickInterval = null; }
      windParticles = [];
    }

    // Open-Meteo takes comma-separated coordinates, but a 540-point URL would
    // run past what is safe to send, so the grid is split across requests.
    function requestWindGrid(lats, lons) {
      var chunks = [];
      for (var start = 0; start < lats.length; start += WIND_CHUNK) {
        chunks.push([lats.slice(start, start + WIND_CHUNK),
                     lons.slice(start, start + WIND_CHUNK)]);
      }
      return Promise.all(chunks.map(function (chunk) {
        var url = 'https://api.open-meteo.com/v1/forecast' +
          '?latitude=' + chunk[0].join(',') +
          '&longitude=' + chunk[1].join(',') +
          '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms';
        windLastUrlLength = Math.max(windLastUrlLength, url.length);
        return fetch(url).then(function (res) {
          if (res.status === 429) {
            windBackoffUntil = Date.now() + WIND_BACKOFF_MS;
            throw new Error('HTTP 429 (backing off)');
          }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        });
      })).then(function (responses) {
        var u = [], v = [];
        responses.forEach(function (data) {
          var list = Array.isArray(data) ? data : [data];
          list.forEach(function (entry) {
            var cur = entry && entry.current;
            var c = windComponents(
              (cur && cur.wind_speed_10m) || 0,
              (cur && cur.wind_direction_10m) || 0
            );
            u.push(c.u); v.push(c.v);
          });
        });
        return { u: u, v: v };
      });
    }

    function fetchWind(force) {
      fetchWindCalls++;
      if (!mapLoaded || appPaused || !windEnabled) return;
      if (!window.isPrimaryView) return;

      var now = Date.now();
      var isGlobal = map.getZoom() < FLIGHTS_GLOBAL_ZOOM;

      // Only the viewport path spends Open-Meteo quota. The global field comes
      // from GFS via Swift, which caches it for hours, so throttling that was
      // pure harm: enabling wind within the window left it with no field at
      // all, which looked like frozen particles.
      if (!isGlobal) {
        if (now < windBackoffUntil) return;
        if (!force && now - lastWindRequest < WIND_REQUEST_MIN_MS) return;
        lastWindRequest = now;
      }

      var south, west, north, east, cols, rows;

      if (isGlobal) {
        // The globe is served by NOAA GFS through Swift: a full 1-degree grid,
        // free, and it never touches the Open-Meteo budget that the weather bar
        // depends on. Swift caches it and answers via receiveWind.
        try {
          webkit.messageHandlers.dataRelay.postMessage({
            type: 'requestGlobalWind', json: '{}'
          });
          globalWindPosts++;
        } catch (e) { windLastError = (e && e.message) || String(e); }
        return;
      }

      {
        // Sample a margin beyond the viewport so small pans don't immediately
        // fall outside the field and trigger another request.
        var b = map.getBounds();
        var padLat = (b.getNorth() - b.getSouth()) * 0.25;
        var padLon = (b.getEast() - b.getWest()) * 0.25;
        south = Math.max(-85, b.getSouth() - padLat);
        north = Math.min(85, b.getNorth() + padLat);
        west = b.getWest() - padLon;
        east = b.getEast() + padLon;
        cols = WIND_GRID_COLS; rows = WIND_GRID_ROWS;
      }

      var lats = [], lons = [];
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          lats.push((south + (north - south) * row / (rows - 1)).toFixed(3));
          lons.push((west + (east - west) * col / (cols - 1)).toFixed(3));
        }
      }

      requestWindGrid(lats, lons)
        .then(function (result) {
          var field = {
            south: south, west: west, north: north, east: east,
            global: isGlobal, cols: cols, rows: rows,
            u: result.u, v: result.v
          };
          applyWindField(field);
          windLastError = null;

          if (isGlobal) {
            field.savedAt = Date.now();
            try { localStorage.setItem(WIND_GLOBAL_CACHE_KEY, JSON.stringify(field)); } catch (e) { }
          }
          try {
            webkit.messageHandlers.dataRelay.postMessage({
              type: 'wind', json: JSON.stringify(field)
            });
          } catch (e) { }
        })
        .catch(function (err) {
          windLastError = (err && err.message) || String(err);
          console.warn('[Wind]', windLastError);
        });
    }

    function applyWindField(raw) {
      windFieldIsGlobal = !!raw.global;
      windField = new WindField(
        raw.south, raw.west, raw.north, raw.east,
        raw.cols, raw.rows, raw.u, raw.v, raw.global
      );
      rebuildStreamlines();
    }

    window.receiveWind = function (raw) {
      applyWindField(raw);
      windLastError = null;
      if (raw && raw.source) windFieldSource = raw.source;
    };

    // Particle positions are in geographic space, so a zoom change only alters
    // how fast they should appear to move; the trails are reseeded so they
    // don't keep a stale on-screen length.
    function rebuildStreamlines() {
      windZoomAtBuild = map.getZoom();
      for (var i = 0; i < windParticles.length; i++) seedParticle(windParticles[i]);
    }

    // The particle count is the single biggest lever on smoothness — each line
    // is meshed separately — so it is exposed rather than guessed at.
    window.setWindDensity = function (count) {
      windDensity = count;
      localStorage.setItem('wind-density', String(count));
      if (windParticles.length > windDensity) windParticles.length = windDensity;
    };

    window.setWindEnabled = function (on) {
      windEnabled = on;
      localStorage.setItem('wind-enabled', on ? '1' : '0');
      if (!mapLoaded) return;
      if (map.getLayer('wind-layer')) {
        map.setLayoutProperty('wind-layer', 'visibility', on ? 'visible' : 'none');
      }
      if (on) {
        if (windFieldCoversView()) rebuildStreamlines(); else fetchWind();
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
      // RainViewer answers 200 with a "Zoom Level Not Supported" placeholder
      // image above z7, so cap the source and let Mapbox overzoom instead.
      map.addSource('radar', { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom: 7 });
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
