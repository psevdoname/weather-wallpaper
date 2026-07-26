import Cocoa
import WebKit
import CoreLocation

class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var desktopManager: DesktopWindowManager!
    private var locationManager: LocationManager!
    private var currentZoom: Double = 2.5
    private var flightsEnabled: Bool = false
    private var pollenEnabled: Bool = false
    private var weatherEnabled: Bool = false
    private var windEnabled: Bool = false
    private var currentDetail: String = "normal"
    private var currentSpinSpeed: Double = 26
    private var spinEnabled: Bool = false

    /// Must stay in sync with DETAIL_LEVELS in Web/globe.js.
    private static let detailLevels: [(id: String, name: String)] = [
        ("off", "None"),
        ("minimal", "Minimal — countries only"),
        ("normal", "Normal — countries, states, cities"),
        ("full", "Full — everything, incl. roads"),
    ]

    private static let spinSpeeds: [(px: Double, name: String)] = [
        (13, "Slow"),
        (26, "Normal"),
        (52, "Fast"),
    ]
    private var nightLightsEnabled: Bool = false
    private var currentUnitSystem: String = "imperial"
    private var currentMapStyle: String = "faded"

    /// Must stay in sync with the STYLES array in Web/globe.js.
    private static let mapStyles: [(id: String, name: String)] = [
        ("faded", "Standard · Faded"),
        ("monochrome", "Standard · Monochrome"),
        ("dusk", "Standard · Dusk"),
        ("night", "Standard · Night"),
        ("satellite", "Satellite"),
        ("s2cloudless", "Satellite · Cloudless"),
        ("dark", "Dark"),
        ("classic", "Classic"),
    ]

    private let geocoder = CLGeocoder()
    private var geocodeCache: [String: String] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: ["labels-enabled": true, "zoom-level": 2.5])

        if let savedUnit = UserDefaults.standard.string(forKey: "unit-system"), ["imperial", "metric"].contains(savedUnit) {
            currentUnitSystem = savedUnit
        }

        let d = UserDefaults.standard
        currentZoom = d.double(forKey: "zoom-level")
        flightsEnabled = d.bool(forKey: "flights-enabled")
        weatherEnabled = d.bool(forKey: "radar-enabled")
        windEnabled = d.bool(forKey: "wind-enabled")
        spinEnabled = d.bool(forKey: "spin-enabled")
        if let detail = d.string(forKey: "map-detail"),
           Self.detailLevels.contains(where: { $0.id == detail }) {
            currentDetail = detail
        }
        currentSpinSpeed = d.object(forKey: "spin-speed") as? Double ?? 26
        pollenEnabled = d.bool(forKey: "pollen-enabled")
        if let savedStyle = UserDefaults.standard.string(forKey: "map-style"),
           Self.mapStyles.contains(where: { $0.id == savedStyle }) {
            currentMapStyle = savedStyle
        }
        nightLightsEnabled = UserDefaults.standard.bool(forKey: "night-lights")

        setupMenuBar()

        desktopManager = DesktopWindowManager()
        desktopManager.setupWindows()
        desktopManager.injectUnitSystem(currentUnitSystem)

        locationManager = LocationManager { [weak self] lat, lon in
            self?.reverseGeocodeAndInject(lat: lat, lon: lon)
        }
        locationManager.requestLocation()

        if let token = UserDefaults.standard.string(forKey: "mapbox-access-token"), !token.isEmpty {
            desktopManager.injectMapboxToken(token)
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        setupPowerObservers()
    }

    // MARK: - Menu Bar

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let img = NSImage(systemSymbolName: "globe.americas.fill", accessibilityDescription: "Weather Wallpaper") {
            img.isTemplate = true
            statusItem.button?.image = img
        } else {
            statusItem.button?.title = "☀"
        }

        let menu = NSMenu()

        menu.addItem(NSMenuItem(title: "Refresh Location", action: #selector(refreshLocation), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: "Search Location…", action: #selector(searchLocation), keyEquivalent: "l"))
        menu.addItem(NSMenuItem(title: "Set Mapbox Token…", action: #selector(setMapboxToken), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Set Pollen API Key…", action: #selector(setPollenApiKey), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Set OpenSky Credentials…", action: #selector(setOpenSkyCredentials), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())

        let styleItem = NSMenuItem(title: "Map Style", action: nil, keyEquivalent: "")
        let styleMenu = NSMenu()
        for style in Self.mapStyles {
            let item = NSMenuItem(title: style.name, action: #selector(setMapStyle(_:)), keyEquivalent: "")
            item.representedObject = style.id
            item.state = currentMapStyle == style.id ? .on : .off
            styleMenu.addItem(item)
        }
        styleItem.submenu = styleMenu
        menu.addItem(styleItem)
        menu.addItem(NSMenuItem.separator())

        let zoomGlobe = NSMenuItem(title: "Zoom: Globe", action: #selector(setZoomGlobe(_:)), keyEquivalent: "")
        menu.addItem(zoomGlobe)
        let zoomCountry = NSMenuItem(title: "Zoom: Country", action: #selector(setZoomCountry(_:)), keyEquivalent: "")
        menu.addItem(zoomCountry)
        let zoomCity = NSMenuItem(title: "Zoom: City", action: #selector(setZoomCity(_:)), keyEquivalent: "")
        menu.addItem(zoomCity)
        let zoomStreet = NSMenuItem(title: "Zoom: Street", action: #selector(setZoomStreet(_:)), keyEquivalent: "")
        menu.addItem(zoomStreet)
        menu.addItem(NSMenuItem.separator())

        let unitsImperial = NSMenuItem(title: "Units: Imperial (°F, mph)", action: #selector(setUnitsImperial(_:)), keyEquivalent: "")
        unitsImperial.state = currentUnitSystem == "imperial" ? .on : .off
        menu.addItem(unitsImperial)
        let unitsMetric = NSMenuItem(title: "Units: Metric (°C, km/h)", action: #selector(setUnitsMetric(_:)), keyEquivalent: "")
        unitsMetric.state = currentUnitSystem == "metric" ? .on : .off
        menu.addItem(unitsMetric)
        menu.addItem(NSMenuItem.separator())

        let flightsItem = NSMenuItem(title: "Show Flights", action: #selector(toggleFlights(_:)), keyEquivalent: "")
        flightsItem.state = flightsEnabled ? .on : .off
        menu.addItem(flightsItem)
        let weatherItem = NSMenuItem(title: "Show Weather Radar", action: #selector(toggleWeather(_:)), keyEquivalent: "")
        weatherItem.state = weatherEnabled ? .on : .off
        menu.addItem(weatherItem)
        let windItem = NSMenuItem(title: "Show Wind", action: #selector(toggleWind(_:)), keyEquivalent: "")
        windItem.state = windEnabled ? .on : .off
        menu.addItem(windItem)
        let pollenItem = NSMenuItem(title: "Show Pollen & Air Quality", action: #selector(togglePollen(_:)), keyEquivalent: "")
        pollenItem.state = pollenEnabled ? .on : .off
        menu.addItem(pollenItem)
        let nightLightsItem = NSMenuItem(title: "Show City Lights at Night", action: #selector(toggleNightLights(_:)), keyEquivalent: "")
        nightLightsItem.state = nightLightsEnabled ? .on : .off
        menu.addItem(nightLightsItem)
        let detailItem = NSMenuItem(title: "Detail", action: nil, keyEquivalent: "")
        let detailMenu = NSMenu()
        for level in Self.detailLevels {
            let item = NSMenuItem(title: level.name, action: #selector(setMapDetail(_:)), keyEquivalent: "")
            item.representedObject = level.id
            item.state = currentDetail == level.id ? .on : .off
            detailMenu.addItem(item)
        }
        detailItem.submenu = detailMenu
        menu.addItem(detailItem)

        let spinItem = NSMenuItem(title: "Spin Globe", action: #selector(toggleSpin(_:)), keyEquivalent: "")
        spinItem.state = spinEnabled ? .on : .off
        menu.addItem(spinItem)

        let speedItem = NSMenuItem(title: "Spin Speed", action: nil, keyEquivalent: "")
        let speedMenu = NSMenu()
        for speed in Self.spinSpeeds {
            let item = NSMenuItem(title: speed.name, action: #selector(setSpinSpeed(_:)), keyEquivalent: "")
            item.representedObject = speed.px
            item.state = currentSpinSpeed == speed.px ? .on : .off
            speedMenu.addItem(item)
        }
        speedItem.submenu = speedMenu
        menu.addItem(speedItem)
        menu.addItem(NSMenuItem.separator())

        let launchItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
        launchItem.state = LaunchAtLogin.isEnabled ? .on : .off
        menu.addItem(launchItem)

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Weather Wallpaper", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    // MARK: - Actions

    @objc private func refreshLocation() {
        locationManager.requestLocation()
    }

    @objc private func searchLocation() {
        let alert = NSAlert()
        alert.messageText = "Search Location"
        alert.informativeText = "Enter a city or place name."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Set")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        input.placeholderString = "e.g. Tokyo, Paris, New York"
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            let query = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if query.isEmpty { return }

            let geocoder = CLGeocoder()
            geocoder.geocodeAddressString(query) { [weak self] placemarks, error in
                DispatchQueue.main.async {
                    guard let place = placemarks?.first,
                          let loc = place.location else {
                        let err = NSAlert()
                        err.messageText = "Location Not Found"
                        err.informativeText = "Could not find \"\(query)\". Try a different search."
                        err.alertStyle = .warning
                        err.addButton(withTitle: "OK")
                        err.runModal()
                        return
                    }
                    let name: String
                    if let city = place.locality, let state = place.administrativeArea {
                        name = "\(city), \(state)"
                    } else {
                        name = place.name ?? ""
                    }
                    self?.desktopManager.injectLocation(
                        lat: loc.coordinate.latitude,
                        lon: loc.coordinate.longitude,
                        name: name
                    )
                }
            }
        }
    }

    @objc private func setMapboxToken() {
        let alert = NSAlert()
        alert.messageText = "Mapbox Access Token"
        alert.informativeText = "Enter your Mapbox public token (pk.eyJ…).\nGet one free at mapbox.com/account/access-tokens"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        input.placeholderString = "pk.eyJ..."
        input.stringValue = UserDefaults.standard.string(forKey: "mapbox-access-token") ?? ""
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            let token = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty {
                UserDefaults.standard.set(token, forKey: "mapbox-access-token")
                desktopManager.injectMapboxToken(token)
            }
        }
    }

    @objc private func setPollenApiKey() {
        let alert = NSAlert()
        alert.messageText = "Google Pollen API Key"
        alert.informativeText = "Enter your Google Pollen API key.\nGet one at console.cloud.google.com"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        input.placeholderString = "AIza..."
        input.stringValue = UserDefaults.standard.string(forKey: "google-pollen-api-key") ?? ""
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            let key = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty {
                UserDefaults.standard.set(key, forKey: "google-pollen-api-key")
                desktopManager.injectPollenApiKey(key)
            }
        }
    }

    /// Imports the credentials.json downloaded from an OpenSky API client.
    /// The secret goes to the Keychain, never to UserDefaults or the repo.
    @objc private func setOpenSkyCredentials() {
        let panel = NSOpenPanel()
        panel.title = "Select OpenSky credentials.json"
        panel.message = "Choose the credentials.json downloaded from your OpenSky API client."
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }

        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = (json["clientId"] ?? json["client_id"]) as? String,
              let secret = (json["clientSecret"] ?? json["client_secret"]) as? String,
              !id.isEmpty, !secret.isEmpty else {
            let err = NSAlert()
            err.messageText = "Invalid Credentials File"
            err.informativeText = "Expected JSON containing \"clientId\" and \"clientSecret\"."
            err.alertStyle = .warning
            err.addButton(withTitle: "OK")
            err.runModal()
            return
        }

        desktopManager.openSky.storeCredentials(clientId: id, clientSecret: secret)

        let ok = NSAlert()
        ok.messageText = "OpenSky Credentials Saved"
        ok.informativeText = "Client \"\(id)\" stored. The secret is in your Keychain."
        ok.alertStyle = .informational
        ok.addButton(withTitle: "OK")
        ok.runModal()
    }

    // MARK: - Zoom

    private func updateZoomCheckmarks() {
        guard let menu = statusItem.menu else { return }
        for item in menu.items {
            if item.title.hasPrefix("Zoom: ") {
                switch item.title {
                case "Zoom: Globe":   item.state = currentZoom == 2.5  ? .on : .off
                case "Zoom: Country": item.state = currentZoom == 5.0  ? .on : .off
                case "Zoom: City":    item.state = currentZoom == 8.0  ? .on : .off
                case "Zoom: Street":  item.state = currentZoom == 12.0 ? .on : .off
                default: break
                }
            }
        }
    }

    @objc private func setZoomGlobe(_ sender: NSMenuItem) {
        currentZoom = 2.5
        UserDefaults.standard.set(currentZoom, forKey: "zoom-level")
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    @objc private func setZoomCountry(_ sender: NSMenuItem) {
        currentZoom = 5.0
        UserDefaults.standard.set(currentZoom, forKey: "zoom-level")
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    @objc private func setZoomCity(_ sender: NSMenuItem) {
        currentZoom = 8.0
        UserDefaults.standard.set(currentZoom, forKey: "zoom-level")
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    @objc private func setZoomStreet(_ sender: NSMenuItem) {
        currentZoom = 12.0
        UserDefaults.standard.set(currentZoom, forKey: "zoom-level")
        desktopManager.injectZoom(currentZoom)
        updateZoomCheckmarks()
    }

    private func updateUnitCheckmarks() {
        guard let menu = statusItem.menu else { return }
        for item in menu.items {
            if item.title.hasPrefix("Units: ") {
                switch item.title {
                case "Units: Imperial (°F, mph)": item.state = currentUnitSystem == "imperial" ? .on : .off
                case "Units: Metric (°C, km/h)": item.state = currentUnitSystem == "metric" ? .on : .off
                default: break
                }
            }
        }
    }

    @objc private func setUnitsImperial(_ sender: NSMenuItem) {
        currentUnitSystem = "imperial"
        UserDefaults.standard.set(currentUnitSystem, forKey: "unit-system")
        desktopManager.injectUnitSystem(currentUnitSystem)
        updateUnitCheckmarks()
    }

    @objc private func setUnitsMetric(_ sender: NSMenuItem) {
        currentUnitSystem = "metric"
        UserDefaults.standard.set(currentUnitSystem, forKey: "unit-system")
        desktopManager.injectUnitSystem(currentUnitSystem)
        updateUnitCheckmarks()
    }

    // MARK: - Flights

    @objc private func toggleFlights(_ sender: NSMenuItem) {
        flightsEnabled.toggle()
        sender.state = flightsEnabled ? .on : .off
        UserDefaults.standard.set(flightsEnabled, forKey: "flights-enabled")
        desktopManager.injectFlightsToggle(flightsEnabled)
    }

    @objc private func toggleWeather(_ sender: NSMenuItem) {
        weatherEnabled.toggle()
        sender.state = weatherEnabled ? .on : .off
        UserDefaults.standard.set(weatherEnabled, forKey: "radar-enabled")
        desktopManager.injectWeatherToggle(weatherEnabled)
    }

    @objc private func toggleWind(_ sender: NSMenuItem) {
        windEnabled.toggle()
        sender.state = windEnabled ? .on : .off
        UserDefaults.standard.set(windEnabled, forKey: "wind-enabled")
        desktopManager.injectWindToggle(windEnabled)
    }

    @objc private func togglePollen(_ sender: NSMenuItem) {
        pollenEnabled.toggle()
        sender.state = pollenEnabled ? .on : .off
        UserDefaults.standard.set(pollenEnabled, forKey: "pollen-enabled")
        desktopManager.injectPollenToggle(pollenEnabled)
    }

    // MARK: - Map Style

    @objc private func setMapStyle(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        currentMapStyle = id
        UserDefaults.standard.set(id, forKey: "map-style")
        desktopManager.injectMapStyle(id)
        if let siblings = sender.menu?.items {
            for item in siblings {
                item.state = (item.representedObject as? String) == id ? .on : .off
            }
        }
    }

    @objc private func toggleNightLights(_ sender: NSMenuItem) {
        nightLightsEnabled.toggle()
        sender.state = nightLightsEnabled ? .on : .off
        UserDefaults.standard.set(nightLightsEnabled, forKey: "night-lights")
        desktopManager.injectNightLightsToggle(nightLightsEnabled)
    }

    @objc private func setMapDetail(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        currentDetail = id
        UserDefaults.standard.set(id, forKey: "map-detail")
        desktopManager.injectMapDetail(id)
        for item in sender.menu?.items ?? [] {
            item.state = (item.representedObject as? String) == id ? .on : .off
        }
    }

    @objc private func setSpinSpeed(_ sender: NSMenuItem) {
        guard let px = sender.representedObject as? Double else { return }
        currentSpinSpeed = px
        UserDefaults.standard.set(px, forKey: "spin-speed")
        desktopManager.injectSpinSpeed(px)
        for item in sender.menu?.items ?? [] {
            item.state = (item.representedObject as? Double) == px ? .on : .off
        }
    }

    @objc private func toggleSpin(_ sender: NSMenuItem) {
        spinEnabled.toggle()
        sender.state = spinEnabled ? .on : .off
        UserDefaults.standard.set(spinEnabled, forKey: "spin-enabled")
        desktopManager.injectSpinToggle(spinEnabled)
    }

    @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        LaunchAtLogin.isEnabled.toggle()
        sender.state = LaunchAtLogin.isEnabled ? .on : .off
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    private var screensChangedWork: DispatchWorkItem?

    /// This notification arrives in bursts (and on Space switches), so coalesce
    /// it; the manager then decides whether anything actually changed.
    @objc private func screensChanged() {
        screensChangedWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.desktopManager.rebuildWindowsIfNeeded()
        }
        screensChangedWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    // MARK: - Power & Sleep

    private func setupPowerObservers() {
        let ws = NSWorkspace.shared
        ws.notificationCenter.addObserver(self, selector: #selector(systemWillSleep), name: NSWorkspace.willSleepNotification, object: nil)
        ws.notificationCenter.addObserver(self, selector: #selector(systemDidWake), name: NSWorkspace.didWakeNotification, object: nil)
        ws.notificationCenter.addObserver(self, selector: #selector(systemWillSleep), name: NSWorkspace.screensDidSleepNotification, object: nil)
        ws.notificationCenter.addObserver(self, selector: #selector(systemDidWake), name: NSWorkspace.screensDidWakeNotification, object: nil)

        DistributedNotificationCenter.default().addObserver(self, selector: #selector(systemWillSleep), name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(systemDidWake), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
    }

    @objc private func systemWillSleep() {
        desktopManager.injectPaused(true)
    }

    @objc private func systemDidWake() {
        desktopManager.injectPaused(false)
    }

    private func reverseGeocodeAndInject(lat: Double, lon: Double) {
        let cacheKey = String(format: "%.2f,%.2f", lat, lon)
        if let cachedName = geocodeCache[cacheKey] {
            desktopManager.injectLocation(lat: lat, lon: lon, name: cachedName)
            return
        }

        let location = CLLocation(latitude: lat, longitude: lon)
        geocoder.reverseGeocodeLocation(location) { [weak self] placemarks, error in
            let name: String
            if let p = placemarks?.first {
                let city = p.locality ?? p.name ?? ""
                let state = p.administrativeArea ?? ""
                if !city.isEmpty && !state.isEmpty {
                    name = "\(city), \(state)"
                } else {
                    name = city.isEmpty ? state : city
                }
            } else {
                name = String(format: "%.2f, %.2f", lat, lon)
            }
            
            DispatchQueue.main.async {
                self?.geocodeCache[cacheKey] = name
                self?.desktopManager.injectLocation(lat: lat, lon: lon, name: name)
            }
        }
    }
}

// MARK: - Launch at Login helper

enum LaunchAtLogin {
    private static let bundleID = Bundle.main.bundleIdentifier ?? ""

    static var isEnabled: Bool {
        get {
            UserDefaults.standard.bool(forKey: "launchAtLogin")
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "launchAtLogin")
            if newValue {
                enableLoginItem()
            } else {
                disableLoginItem()
            }
        }
    }

    private static func enableLoginItem() {
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.register()
        }
    }

    private static func disableLoginItem() {
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.unregister()
        }
    }
}

import ServiceManagement
