import Cocoa
import WebKit
import CoreLocation

class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var desktopManager: DesktopWindowManager!
    private var locationManager: LocationManager!
    private var settingsWindow: SettingsWindow?


    private var currentUnitSystem: String = "imperial"


    private let geocoder = CLGeocoder()
    private var geocodeCache: [String: String] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: ["zoom-level": 2.5, "map-detail": "normal"])

        if let savedUnit = UserDefaults.standard.string(forKey: "unit-system"), ["imperial", "metric"].contains(savedUnit) {
            currentUnitSystem = savedUnit
        }


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
            statusItem.button?.title = "*"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Refresh Location", action: #selector(refreshLocation), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: "Search Location…", action: #selector(searchLocation), keyEquivalent: "l"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Weather Wallpaper", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    @objc private func openSettings() {
        if settingsWindow == nil {
            settingsWindow = SettingsWindow(manager: desktopManager)
        }
        settingsWindow?.show()
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



    /// Imports the credentials.json downloaded from an OpenSky API client.
    /// The secret goes to the Keychain, never to UserDefaults or the repo.





















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
