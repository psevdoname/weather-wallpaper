# Weather Wallpaper — working notes

macOS menu-bar app that renders a live Mapbox globe as the desktop wallpaper.
Swift shell + `WKWebView` running `Web/globe.js` and `Web/weather.js`.

Fork of `alexcohennyc/weather-wallpaper`. `origin` is the fork
(`psevdoname`), `upstream` is the original.

## Architecture

- `AppDelegate.swift` — menu bar only: Settings, location, quit.
- `SettingsWindow.swift` — **the** settings UI and single source of truth. The
  menu deliberately mirrors no state; a status-bar menu closes on every click,
  which made trying combinations painful.
- `DesktopWindowManager.swift` — one borderless desktop-level window per
  screen, each with its own WebView. Also the bridge: JS posts to `dataRelay`,
  Swift answers by evaluating `window.receive*` on every view.
- `OpenSkyClient.swift`, `WindService.swift`, `GribDecoder.swift` — native
  fetchers (see CORS below).

Settings are written to `UserDefaults` **and** injected into `localStorage` at
document start, so a reload or window rebuild restores the same view without
racing `evaluateJavaScript`.

## Diagnostics

The page dumps its state a few seconds after style load to
`~/Library/Logs/WeatherWallpaper-debug.json` (via `dataRelay` type `debug`):
loaded style config, wind state, spin frame counts, idle render fps.

**Use it.** Every hard bug in this project was found by reading that file, and
several were misdiagnosed first by guessing. There is no screenshot access, so
correctness is established numerically — sun position against known
declination, wind against climatology, decoders against a reference
implementation.

## Hard-won facts

**Mapbox GL version dictates the Standard schema.** Mapbox serves a revision of
the Standard style matched to the library. On 3.9.4 `showAdminBoundaries` and
`colorLand` did not exist, so those controls silently did nothing —
`getConfigProperty` returned `null`. Fixed by moving to 3.27. If a documented
config property appears to be ignored, check the version before debugging code.

**`requestAnimationFrame` is throttled to ~1.5Hz.** The wallpaper window is
never focused, so WebKit treats the page as hidden. Plain timers get ~7-18Hz; a
timer inside a Worker does better. Never drive animation from rAF here.

**Animate the camera yourself.** Mapbox drives `flyTo`/`easeTo` on rAF too, so
they crawl: a 2s flight was measured covering 0.76 of 26 degrees. Interpolate
and apply with `jumpTo` from the shared ticker instead.

**One long-lived ticker, not one per animation.** Workers created on demand
stopped delivering after a second or two; the wind ticker, created once at load
and never stopped, ran forever. Everything subscribes to a single ticker.

**Clamp long frame gaps, don't discard them.** Throttling makes multi-hundred-ms
gaps routine. Dropping them lost two thirds of elapsed time and the globe
crawled at a third of its requested speed.

**Symbol cross-fade keeps the renderer awake.** `fadeDuration` defaults to
300ms; replacing thousands of flight icons twice a second meant the map
re-rendered ~45fps while idle. `fadeDuration: 0` plus slower repositioning
took it to ~20.

**Open-Meteo bills per location, not per request.** A 300-point grid costs 300
calls against 5000/hour and 10000/day. This budget is shared with the weather
bar, so overspending on wind takes the temperature readout down with it. The
globe therefore uses GFS instead (below), and the viewport grid stays small.

**RainViewer answers 200 with a placeholder above z7.** Not an error — an actual
image reading "Zoom Level Not Supported". Cap the source at `maxzoom: 7`.

**CORS blocks several APIs from a `file://` page**, so they are fetched in Swift:
- OpenSky sends `Access-Control-Allow-Origin: https://opensky-network.org`
- NOMADS (GFS) sends no CORS headers at all
NASA GIBS and Open-Meteo do send `*` and are fetched from JS.

**GFS is GRIB2 template 5.3** (complex packing, second-order spatial
differencing). `GribDecoder.swift` handles exactly that. Two things bite:
reference/width/length blocks are octet-aligned relative to each other, and
GRIB stores negatives as sign-and-magnitude. The decoder self-checks by summing
group lengths against the point count — keep that check.

**Black Marble tiles are opaque RGB with no alpha**, and raster layers have
neither blend modes nor a geographic mask. The night-lights layer therefore
stitches its own mosaic and punches the day side out of the alpha channel.

## Traps that cost hours

`var x = null` placed above a `function x(){}` **silently destroys the
function**: hoisting defines the function first, then the assignment overwrites
it. This put `null` in the tick subscriber list, the loop's `try/catch` ate the
TypeError, and the diagnostic printed it as subscribed because `null === null`.

In shell, `grep -c` exits **1** when it counts zero, so `grep -c foo file && make`
silently skips the build. Several measurements were taken against a stale bundle
because of this.

CPU numbers here vary by ±30% between identical runs. Do not tune against a
single measurement; only trust differences that are large and repeatable.

## Measuring performance

`ps -o %cpu` reports a lifetime average and is useless here. Diff accumulated
CPU time over a fixed window instead, for the app process *and* its WebContent
process (find it by diffing `pgrep -f WebKit.WebContent` across launch).

Rough costs at time of writing: ~5fps idle render baseline, flights ~14fps of
render, 3600 wind particles ~45% of a core, spin ~20%.

## Keys

Mapbox token, OpenWeather key and Google Pollen key live in `UserDefaults`; the
OpenSky **client secret is in the Keychain**. Never commit any of them.
