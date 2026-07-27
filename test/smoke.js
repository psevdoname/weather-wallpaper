#!/usr/bin/env node
'use strict';

// Loads globe.js against a stubbed Mapbox and DOM, then exercises every entry
// point the Swift side calls. Catches the class of breakage that kept getting
// through: a deleted-but-still-referenced variable, a `var x = null` shadowing
// a function, a handler that throws and silently takes its callers with it.
//
// Syntax checking alone never caught these — the files parsed fine.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const errors = [];
const listeners = {};
let layers = {};
let sources = {};
let zoom = 3.8;
const calls = { jumpTo: 0, setData: 0, subscribeNonFunction: 0 };

function fail(where, err) {
  errors.push(`${where}: ${(err && err.message) || err}`);
}

const map = {
  on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); },
  once: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); },
  addSource: (id, spec) => { sources[id] = spec; },
  getSource: (id) => sources[id] ? {
    setData: () => { calls.setData++; }, setTiles: () => {},
    updateImage: () => {}, setCoordinates: () => {}
  } : undefined,
  removeSource: (id) => { delete sources[id]; },
  addLayer: (spec) => { layers[spec.id] = spec; },
  getLayer: (id) => layers[id],
  removeLayer: (id) => { delete layers[id]; },
  setLayoutProperty: (id) => { if (!layers[id]) throw new Error('no layer ' + id); },
  getLayoutProperty: () => 'visible',
  setPaintProperty: (id) => { if (!layers[id]) throw new Error('no layer ' + id); },
  setConfigProperty: () => {},
  getConfigProperty: () => null,
  hasImage: () => false,
  addImage: () => {},
  removeImage: () => {},
  setStyle: function () { emit('style.load'); },
  getStyle: () => ({ layers: Object.values(layers), imports: [{ id: 'basemap' }] }),
  setFog: () => {},
  setProjection: () => {},
  setCenter: () => {},
  jumpTo: () => { calls.jumpTo++; },
  flyTo: () => {},
  getCenter: () => ({ lng: 13.4, lat: 52.5 }),
  getZoom: () => zoom,
  getBounds: () => ({
    getSouth: () => 45, getWest: () => 5, getNorth: () => 58, getEast: () => 22
  }),
  isMoving: () => false,
  isEasing: () => false
};

function emit(event, arg) {
  (listeners[event] || []).forEach(fn => {
    try { fn(arg); } catch (e) { fail(`listener ${event}`, e); }
  });
}

const canvasStub = () => ({
  width: 0, height: 0,
  getContext: () => ({
    fillStyle: '', globalCompositeOperation: '', imageSmoothingEnabled: true,
    imageSmoothingQuality: '', translate: () => {}, beginPath: () => {},
    moveTo: () => {}, lineTo: () => {}, closePath: () => {}, fill: () => {},
    drawImage: () => {}, clearRect: () => {}, putImageData: () => {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  }),
  toBlob: (cb) => cb({}),
  toDataURL: () => 'data:,'
});

const storage = {};
const timers = [];
let workers = [];

const sandbox = {
  console: {
    log: () => {},
    warn: (...a) => {
      const text = a.join(' ');
      if (/non-function subscriber/.test(text)) calls.subscribeNonFunction++;
    },
    error: (...a) => fail('console.error', a.join(' '))
  },
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  setInterval: (fn) => { timers.push(fn); return timers.length; },
  clearInterval: () => {},
  performance: { now: () => Date.now() },
  Date, Math, JSON, Array, Object, String, Number, Boolean, Error,
  parseInt, parseFloat, isNaN, Float32Array, Uint8ClampedArray, Promise,
  fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }),
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
  Blob: function () {},
  // Every ticker in the app runs on a Worker, so the stub has to deliver
  // messages or nothing animates and the test proves nothing.
  Worker: function () {
    this.onmessage = null;
    this.postMessage = () => {};
    this.terminate = () => { workers = workers.filter(w => w !== this); };
    workers.push(this);
  },
  Image: function () { this.crossOrigin = ''; Object.defineProperty(this, 'src', { set() {} }); },
  webkit: { messageHandlers: { dataRelay: { postMessage: () => {} } } },
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  },
  mapboxgl: {
    Map: function () { return map; },
    Marker: function () { return { setLngLat() { return this; }, addTo() { return this; } }; },
    accessToken: '', workerUrl: ''
  },
  document: {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} } },
    getElementById: () => ({
      innerHTML: '', textContent: '', className: '',
      style: { background: '', setProperty: () => {} },
      classList: { add: () => {}, remove: () => {} },
      querySelector: () => null, appendChild: () => {}
    }),
    createElement: (tag) => (tag === 'canvas' ? canvasStub() : {
      className: '', style: { background: '', setProperty: () => {} },
      classList: { add: () => {}, remove: () => {} }
    })
  }
};

sandbox.window = sandbox;
sandbox.window.isPrimaryView = true;
sandbox.window.matchMedia = () => ({ matches: false });
sandbox.window.addEventListener = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };
sandbox.window.dispatchEvent = () => {};

storage['mapbox-access-token'] = 'pk.test';
storage['wind-enabled'] = '1';
storage['flights-enabled'] = '1';
storage['radar-enabled'] = '1';
storage['night-lights'] = '1';
storage['spin-enabled'] = '1';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'WeatherWallpaper', 'Web', 'globe.js'), 'utf8');

vm.createContext(sandbox);
try {
  vm.runInContext(source, sandbox, { filename: 'globe.js' });
} catch (e) {
  fail('module evaluation', e);
}

// Style and map lifecycle, in the order Mapbox fires them.
emit('style.load');
emit('load');

function runTimers(rounds) {
  for (let round = 0; round < rounds; round++) {
    timers.splice(0, timers.length).forEach((fn, i) => {
      try { fn(); } catch (e) { fail(`timer #${i}`, e); }
    });
    workers.slice().forEach((worker, i) => {
      if (typeof worker.onmessage !== 'function') return;
      try { worker.onmessage(); } catch (e) { fail(`worker tick #${i}`, e); }
    });
  }
}

// Everything Swift can call. A missing one is itself a failure: the Swift side
// would silently do nothing.
const api = {
  setMapStyle: ['dark'],
  setMapFeature: ['roads', false],
  setFlightsEnabled: [true],
  setWeatherEnabled: [true],
  setWindEnabled: [true],
  setWindDensity: [1800],
  setCloudsEnabled: [true],
  setTemperatureEnabled: [true],
  setNightLightsEnabled: [true],
  setPollenEnabled: [true],
  setSpinEnabled: [true],
  setSpinSpeed: [26],
  setFlightColor: ['#FFFFFF'],
  mapFlyTo: [5],
  globeSetCity: [52.5, 13.4],
  setAppPaused: [false],
  receiveFlights: [{ store: [{ lon: 1, lat: 2, velocity: 200, heading: 90 }], timestamp: Date.now() }],
  receiveWind: [{ south: -90, west: -180, north: 90, east: 179, global: true, cols: 4, rows: 3,
                  u: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], v: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }],
  receiveRadarUrl: ['https://example.com/{z}/{x}/{y}.png']
};

for (const [name, args] of Object.entries(api)) {
  if (typeof sandbox.window[name] !== 'function') {
    errors.push(`window.${name} is not defined — Swift calls it`);
    continue;
  }
  try { sandbox.window[name](...args); } catch (e) { fail(`window.${name}()`, e); }
}

// Run whatever the code scheduled: this is where a ReferenceError inside a
// tick or a timer shows up.
runTimers(3);
emit('moveend');

// The camera must actually move. A dead animation subscriber produces no
// jumpTo at all, which is exactly how a `var x = null` over a function shows up.
calls.jumpTo = 0;
sandbox.window.globeSetCity(48.85, 2.35);
runTimers(6);
if (calls.jumpTo === 0) errors.push('globeSetCity moved the camera zero times');
if (calls.subscribeNonFunction > 0) errors.push('a non-function was subscribed to the ticker');

// Above zoom 4 the wind takes the viewport path instead of the global one,
// which uses different code and different constants.
zoom = 8;
emit('moveend');
try { sandbox.window.setWindEnabled(false); sandbox.window.setWindEnabled(true); }
catch (e) { fail('wind at zoom 8', e); }
runTimers(3);

// Particles must be produced once a field exists.
calls.setData = 0;
sandbox.window.receiveWind(api.receiveWind[0]);
runTimers(12);
if (calls.setData === 0) errors.push('wind produced no geometry after receiving a field');

zoom = 3.8;
emit('style.load');   // a style switch must rebuild cleanly

if (errors.length) {
  console.error('FAIL\n' + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`ok — globe.js loaded, ${Object.keys(api).length} entry points called, no errors`);
