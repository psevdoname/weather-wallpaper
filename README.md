# Weather Wallpaper

A macOS app that turns your desktop wallpaper into a live 3D globe with real-time weather, flights, and more.

Built with MapboxGL, Swift, and WebKit. Entirely vibe-coded with Claude.

## Features

- **3D Globe** — rendered as your desktop wallpaper
- **Map Styles** — eight switchable styles, including cloudless Sentinel-2 satellite imagery
- **City Lights at Night** — NASA VIIRS Black Marble imagery, faded in by real solar elevation
- **Day/Night Cycle** — real-time sun position with twilight and night overlays
- **Weather Radar** — live precipitation overlay via RainViewer (no API key needed)
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
| Set Mapbox Token… | Enter your Mapbox public token |
| Set Pollen API Key… | Enter your Google Pollen API key |
| Set OpenSky Credentials… | Import the `credentials.json` from your OpenSky API client |
| Map Style | Pick one of eight basemap styles (radio select) |
| Zoom: Globe / Country / City / Street | Change zoom level (radio select) |
| Show Flights | Toggle live flight tracking |
| Show Weather Radar | Toggle precipitation overlay |
| Show Pollen & Air Quality | Toggle bottom bar to allergy view |
| Show City Lights at Night | Fade in NASA Black Marble imagery on the night side |
| Detail | How much is drawn on top of the geography: None / Minimal / Normal / Full (roads included) |
| Spin Globe | Smooth auto-rotation |
| Spin Speed | Slow / Normal / Fast — constant on-screen speed at any zoom |
| Launch at Login | Start on boot |

## APIs Used

- [Mapbox GL JS](https://www.mapbox.com/) — 3D globe rendering
- [OpenSky Network](https://opensky-network.org/) — live flight data (OAuth2 client credentials)
- [RainViewer](https://www.rainviewer.com/api.html) — weather radar tiles (free, no key)
- [Open-Meteo](https://open-meteo.com/) — air quality data (free, no key)
- [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) — VIIRS Black Marble city lights (free, no key)
- [Sentinel-2 cloudless](https://s2maps.eu) — cloudless satellite basemap (free, no key)
- [Google Pollen API](https://developers.google.com/maps/documentation/pollen) — pollen forecasts

## Attribution

The **Satellite · Cloudless** style uses [Sentinel-2 cloudless 2020](https://s2maps.eu) by
EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020), which is free for
non-commercial use with attribution.

City lights imagery courtesy of NASA Worldview / GIBS, part of the NASA Earth Observing
System Data and Information System (EOSDIS).

## License

MIT
