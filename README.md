# Weather Wallpaper

A macOS app that turns your desktop wallpaper into a live 3D globe with real-time weather, flights, and more.

Built with MapboxGL, Swift, and WebKit. Entirely vibe-coded with Claude.

## Features

- **3D Globe** — rendered as your desktop wallpaper
- **Map Styles** — seven switchable basemap styles
- **City Lights at Night** — NASA VIIRS Black Marble imagery, faded in by real solar elevation
- **Day/Night Cycle** — real-time sun position with twilight and night overlays
- **Weather Radar** — live precipitation overlay via RainViewer (no API key needed)
- **Wind** — live 10m wind advected as particles whose speed is the real wind speed. The globe uses NOAA GFS directly (1° global grid, decoded from GRIB2 in-app); zoomed in, Open-Meteo fills in local detail. No API key either way.
- **Live Flights** — real-time aircraft positions from OpenSky Network
- **Pollen & Air Quality** — Google Pollen API + Open-Meteo air quality data
- **City Labels** — custom-styled country, state, city, and neighborhood labels
- **Globe Spin** — smooth auto-rotation (~40s per revolution)
- **Zoom Levels** — Globe, Country, City, and Street views
- **Search Location** — geocode any city/place and fly there
- **Menu Bar Controls** — toggle everything from the menu bar

## Requirements

- macOS 13.0+
- A free [Mapbox access token](https://account.mapbox.com/access-tokens/) (required)
- [OpenSky API client credentials](https://opensky-network.org/my-opensky/account) (optional, for flights — anonymous access is heavily rate limited since OpenSky moved to OAuth2 in March 2026)
- An [OpenWeatherMap API key](https://openweathermap.org/api) (optional, for global cloud and temperature overlays — free tier; a new key can take up to two hours to activate)
- A [Google Pollen API key](https://console.cloud.google.com/) (optional, for pollen data)

Map styles, city lights, weather radar and air quality need no key at all.

## Install

### From DMG

Download the latest DMG from [Releases](https://github.com/alexcohennyc/weather-wallpaper/releases), open it, and drag `WeatherWallpaper.app` to Applications.

### Build from source

```bash
git clone https://github.com/alexcohennyc/weather-wallpaper.git
cd weather-wallpaper
make run
```

Requires Xcode Command Line Tools (`xcode-select --install`).

## Setup

1. Launch the app — a globe icon appears in your menu bar
2. Click the icon → **Set Mapbox Token…** → paste your `pk.eyJ…` token
3. The globe renders on your desktop

## Menu Bar

| Item | Description |
|------|-------------|
| Refresh Location | Re-detect current location via GPS |
| Search Location… | Geocode a city/place and fly there |
| Settings… | Open the settings window |
| Refresh Location | Re-detect current location via GPS |
| Search Location… | Geocode a city/place and fly there |
| Quit Weather Wallpaper | Quit |

Everything else lives in the settings window, so several options can be changed
without the menu closing after each click:

| Setting | Description |
|---------|-------------|
| Map style | One of seven basemaps |
| Map features | Individual toggles: place names, borders, roads, road glow, pedestrian paths, road names, POIs |
| Zoom | Eight levels from Globe to Block |
| Units | Imperial or metric |
| Wind speed | m/s, km/h, mph, knots, or match the units setting |
| Flights | Live aircraft positions, with a configurable colour |
| Weather radar | Precipitation overlay (RainViewer) |
| Wind | Live 10m wind as moving particles |
| Wind density | Light / Medium / Dense / Very dense — the main lever on smoothness |
| Clouds / Temperature | Global overlays (needs an OpenWeather key) |
| City lights at night | NASA Black Marble on the night side |
| Pollen & air quality | Bottom bar switches to the allergy view |
| Spin globe / Spin speed | Auto-rotation, constant on-screen speed at any zoom |
| Keys | Mapbox token, OpenWeather key, OpenSky credentials, Pollen key |
| Launch at login | Start on boot |

## APIs Used

- [Mapbox GL JS](https://www.mapbox.com/) — 3D globe rendering
- [OpenSky Network](https://opensky-network.org/) — live flight data (OAuth2 client credentials)
- [RainViewer](https://www.rainviewer.com/api.html) — weather radar tiles (free, no key)
- [Open-Meteo](https://open-meteo.com/) — weather, air quality and local wind (free, no key)
- [NOAA GFS via NOMADS](https://nomads.ncep.noaa.gov/) — global wind field (free, no key)
- [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) — VIIRS Black Marble city lights (free, no key)
- [OpenWeatherMap](https://openweathermap.org/api/weathermaps) — global cloud and temperature tiles
- [Google Pollen API](https://developers.google.com/maps/documentation/pollen) — pollen forecasts

## Attribution

City lights imagery courtesy of NASA Worldview / GIBS, part of the NASA Earth Observing
System Data and Information System (EOSDIS).

## License

MIT
