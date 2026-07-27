import Cocoa

/// A real settings window, so toggling several options in a row doesn't mean
/// reopening the status-bar menu after every single click.
final class SettingsWindow: NSWindowController, NSWindowDelegate {

    private let manager: DesktopWindowManager
    private let defaults = UserDefaults.standard

    // Kept in sync with the arrays in globe.js.
    static let mapStyles: [(id: String, name: String)] = [
        ("faded", "Standard · Faded"),
        ("monochrome", "Standard · Monochrome"),
        ("dusk", "Standard · Dusk"),
        ("night", "Standard · Night"),
        ("satellite", "Satellite"),
        ("today", "Satellite · Today (live NASA)"),
        ("dark", "Dark"),
        ("classic", "Classic"),
    ]

    /// Keys match the mapFeatures object in globe.js.
    private static let features: [(key: String, name: String, defaultOn: Bool)] = [
        ("labels", "Place names", true),
        ("boundaries", "Country & state borders", false),
        ("roads", "Roads", false),
        ("roadGlow", "Road glow (stylised motorways)", false),
        ("paths", "Pedestrian paths & trails", false),
        ("roadLabels", "Road names", false),
        ("poiLabels", "Points of interest & transit", false),
    ]

    private static let zoomLevels: [(value: Double, name: String)] = [
        (2.5, "Globe"),
        (3.8, "Continent"),
        (5.0, "Country"),
        (6.5, "Region"),
        (8.0, "City"),
        (10.0, "District"),
        (12.0, "Street"),
        (14.0, "Block"),
    ]

    private static let flightColors: [(hex: String, name: String)] = [
        ("#C9A84C", "Gold"),
        ("#FFFFFF", "White"),
        ("#4DC98A", "Green"),
        ("#4D8CC9", "Blue"),
        ("#FF6B3D", "Orange"),
        ("#E64DFF", "Magenta"),
    ]

    private static let cloudStyles: [(id: String, name: String)] = [
        ("white", "White"),
        ("grey", "Grey — realistic"),
        ("storm", "Storm — dark and heavy"),
    ]

    private static let radarStyles: [(id: String, name: String)] = [
        ("colour", "Colour — weather-map style"),
        ("dark", "Dark — rain-bearing cloud"),
    ]

    private static let windUnits: [(id: String, name: String)] = [
        ("auto", "Match units setting"),
        ("ms", "m/s"),
        ("kmh", "km/h"),
        ("mph", "mph"),
        ("kn", "knots"),
    ]

    /// Particle count dominates smoothness, so it is a user choice.
    private static let windDensities: [(count: Int, name: String)] = [
        (900, "Light — smoothest"),
        (1800, "Medium"),
        (2600, "Dense"),
        (4000, "Very dense — may stutter"),
    ]

    private static let spinSpeeds: [(value: Double, name: String)] = [
        (13, "Slow"), (26, "Normal"), (52, "Fast"),
    ]

    init(manager: DesktopWindowManager) {
        self.manager = manager
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 640),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Weather Wallpaper Settings"
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self
        window.contentView = buildContent()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    // MARK: - Layout

    private func buildContent() -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false

        stack.addArrangedSubview(header("Appearance"))
        stack.addArrangedSubview(popupRow(
            "Map style", Self.mapStyles.map(\.name),
            selected: Self.mapStyles.firstIndex { $0.id == currentStyleId } ?? 0,
            action: #selector(styleChanged(_:))))
        stack.addArrangedSubview(popupRow(
            "Zoom", Self.zoomLevels.map(\.name),
            selected: Self.zoomLevels.firstIndex { $0.value == defaults.double(forKey: "zoom-level") } ?? 0,
            action: #selector(zoomChanged(_:))))
        stack.addArrangedSubview(popupRow(
            "Units", ["Imperial (°F, mph)", "Metric (°C, km/h)"],
            selected: (defaults.string(forKey: "unit-system") == "metric") ? 1 : 0,
            action: #selector(unitsChanged(_:))))

        stack.addArrangedSubview(popupRow(
            "Wind speed", Self.windUnits.map(\.name),
            selected: Self.windUnits.firstIndex { $0.id == currentWindUnit } ?? 0,
            action: #selector(windUnitChanged(_:))))

        stack.addArrangedSubview(separator())
        stack.addArrangedSubview(header("Map features"))
        for feature in Self.features {
            let button = NSButton(checkboxWithTitle: feature.name, target: self,
                                  action: #selector(featureToggled(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(feature.key)
            button.state = featureIsOn(feature) ? .on : .off
            stack.addArrangedSubview(button)
        }

        stack.addArrangedSubview(separator())
        stack.addArrangedSubview(header("Layers"))
        stack.addArrangedSubview(checkbox("Flights", key: "flights-enabled", action: #selector(flightsToggled(_:))))
        stack.addArrangedSubview(popupRow(
            "Flight colour", Self.flightColors.map(\.name),
            selected: Self.flightColors.firstIndex { $0.hex == currentFlightColor } ?? 0,
            action: #selector(flightColorChanged(_:))))
        stack.addArrangedSubview(checkbox("Weather radar", key: "radar-enabled", action: #selector(radarToggled(_:))))
        stack.addArrangedSubview(popupRow(
            "Rain look", Self.radarStyles.map(\.name),
            selected: Self.radarStyles.firstIndex { $0.id == currentRadarStyle } ?? 0,
            action: #selector(radarStyleChanged(_:))))
        stack.addArrangedSubview(checkbox("Wind", key: "wind-enabled", action: #selector(windToggled(_:))))
        stack.addArrangedSubview(popupRow(
            "Wind density", Self.windDensities.map(\.name),
            selected: Self.windDensities.firstIndex { $0.count == currentWindDensity } ?? 2,
            action: #selector(windDensityChanged(_:))))
        stack.addArrangedSubview(checkbox("Clouds (needs OpenWeather key)", key: "clouds-enabled", action: #selector(cloudsToggled(_:))))
        stack.addArrangedSubview(popupRow(
            "Cloud look", Self.cloudStyles.map(\.name),
            selected: Self.cloudStyles.firstIndex { $0.id == currentCloudStyle } ?? 1,
            action: #selector(cloudStyleChanged(_:))))
        stack.addArrangedSubview(checkbox("Temperature (needs OpenWeather key)", key: "temperature-enabled", action: #selector(temperatureToggled(_:))))
        stack.addArrangedSubview(checkbox("City lights at night", key: "night-lights", action: #selector(nightLightsToggled(_:))))
        stack.addArrangedSubview(checkbox("Pollen & air quality panel", key: "pollen-enabled", action: #selector(pollenToggled(_:))))

        stack.addArrangedSubview(separator())
        stack.addArrangedSubview(header("Motion"))
        stack.addArrangedSubview(checkbox("Spin globe", key: "spin-enabled", action: #selector(spinToggled(_:))))
        stack.addArrangedSubview(popupRow(
            "Spin speed", Self.spinSpeeds.map(\.name),
            selected: Self.spinSpeeds.firstIndex { $0.value == currentSpinSpeed } ?? 1,
            action: #selector(spinSpeedChanged(_:))))

        stack.addArrangedSubview(separator())
        stack.addArrangedSubview(header("Keys"))
        stack.addArrangedSubview(buttonRow([
            ("Mapbox Token…", #selector(editMapboxToken)),
            ("OpenWeather Key…", #selector(editOwmKey)),
        ]))
        stack.addArrangedSubview(buttonRow([
            ("OpenSky Credentials…", #selector(editOpenSkyCredentials)),
            ("Pollen Key…", #selector(editPollenKey)),
        ]))

        stack.addArrangedSubview(separator())
        stack.addArrangedSubview(checkbox("Launch at login", key: "launchAtLogin", action: #selector(launchAtLoginToggled(_:))))

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = stack
        stack.widthAnchor.constraint(equalTo: scroll.widthAnchor, constant: -16).isActive = true
        return scroll
    }

    // MARK: - Builders

    private func header(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 11, weight: .semibold)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func separator() -> NSView {
        let line = NSBox()
        line.boxType = .separator
        return line
    }

    private func checkbox(_ title: String, key: String, action: Selector) -> NSButton {
        let button = NSButton(checkboxWithTitle: title, target: self, action: action)
        button.state = defaults.bool(forKey: key) ? .on : .off
        return button
    }

    private func popupRow(_ title: String, _ items: [String], selected: Int, action: Selector) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.alignment = .right
        label.widthAnchor.constraint(equalToConstant: 90).isActive = true

        let popup = NSPopUpButton()
        popup.addItems(withTitles: items)
        popup.selectItem(at: min(selected, items.count - 1))
        popup.target = self
        popup.action = action
        popup.widthAnchor.constraint(equalToConstant: 250).isActive = true

        let row = NSStackView(views: [label, popup])
        row.orientation = .horizontal
        row.spacing = 10
        return row
    }

    private func buttonRow(_ buttons: [(String, Selector)]) -> NSView {
        let row = NSStackView(views: buttons.map { NSButton(title: $0.0, target: self, action: $0.1) })
        row.orientation = .horizontal
        row.spacing = 10
        return row
    }

    // MARK: - Current values

    private var currentStyleId: String { defaults.string(forKey: "map-style") ?? "faded" }
    private var currentCloudStyle: String { defaults.string(forKey: "cloud-style") ?? "grey" }

    private var currentRadarStyle: String { defaults.string(forKey: "radar-style") ?? "colour" }

    private var currentWindDensity: Int { defaults.object(forKey: "wind-density") as? Int ?? 2600 }

    private var currentWindUnit: String { defaults.string(forKey: "wind-unit") ?? "auto" }

    private var currentFlightColor: String { defaults.string(forKey: "flight-color") ?? "#C9A84C" }

    /// Defaults have to be registered lazily: a key absent from UserDefaults
    /// must read as the feature's own default, not as false.
    private func featureIsOn(_ feature: (key: String, name: String, defaultOn: Bool)) -> Bool {
        let key = "feature-\(feature.key)"
        if defaults.object(forKey: key) == nil { return feature.defaultOn }
        return defaults.bool(forKey: key)
    }
    private var currentSpinSpeed: Double { defaults.object(forKey: "spin-speed") as? Double ?? 26 }

    // MARK: - Actions

    @objc private func styleChanged(_ sender: NSPopUpButton) {
        let id = Self.mapStyles[sender.indexOfSelectedItem].id
        defaults.set(id, forKey: "map-style")
        manager.injectMapStyle(id)
    }

    @objc private func featureToggled(_ sender: NSButton) {
        guard let key = sender.identifier?.rawValue else { return }
        let on = sender.state == .on
        defaults.set(on, forKey: "feature-\(key)")
        manager.injectMapFeature(key, on)
    }

    @objc private func cloudStyleChanged(_ sender: NSPopUpButton) {
        let id = Self.cloudStyles[sender.indexOfSelectedItem].id
        defaults.set(id, forKey: "cloud-style")
        manager.injectCloudStyle(id)
    }

    @objc private func radarStyleChanged(_ sender: NSPopUpButton) {
        let id = Self.radarStyles[sender.indexOfSelectedItem].id
        defaults.set(id, forKey: "radar-style")
        manager.injectRadarStyle(id)
    }

    @objc private func windDensityChanged(_ sender: NSPopUpButton) {
        let count = Self.windDensities[sender.indexOfSelectedItem].count
        defaults.set(count, forKey: "wind-density")
        manager.injectWindDensity(count)
    }

    @objc private func windUnitChanged(_ sender: NSPopUpButton) {
        let id = Self.windUnits[sender.indexOfSelectedItem].id
        defaults.set(id, forKey: "wind-unit")
        manager.injectWindUnit(id)
    }

    @objc private func flightColorChanged(_ sender: NSPopUpButton) {
        let hex = Self.flightColors[sender.indexOfSelectedItem].hex
        defaults.set(hex, forKey: "flight-color")
        manager.injectFlightColor(hex)
    }

    @objc private func zoomChanged(_ sender: NSPopUpButton) {
        let value = Self.zoomLevels[sender.indexOfSelectedItem].value
        defaults.set(value, forKey: "zoom-level")
        manager.injectZoom(value)
    }

    @objc private func unitsChanged(_ sender: NSPopUpButton) {
        let system = sender.indexOfSelectedItem == 1 ? "metric" : "imperial"
        defaults.set(system, forKey: "unit-system")
        manager.injectUnitSystem(system)
    }

    @objc private func spinSpeedChanged(_ sender: NSPopUpButton) {
        let value = Self.spinSpeeds[sender.indexOfSelectedItem].value
        defaults.set(value, forKey: "spin-speed")
        manager.injectSpinSpeed(value)
    }

    private func store(_ sender: NSButton, _ key: String) -> Bool {
        let on = sender.state == .on
        defaults.set(on, forKey: key)
        return on
    }

    @objc private func flightsToggled(_ s: NSButton) { manager.injectFlightsToggle(store(s, "flights-enabled")) }
    @objc private func radarToggled(_ s: NSButton) { manager.injectWeatherToggle(store(s, "radar-enabled")) }
    @objc private func windToggled(_ s: NSButton) { manager.injectWindToggle(store(s, "wind-enabled")) }
    @objc private func cloudsToggled(_ s: NSButton) { manager.injectCloudsToggle(store(s, "clouds-enabled")) }
    @objc private func temperatureToggled(_ s: NSButton) { manager.injectTemperatureToggle(store(s, "temperature-enabled")) }
    @objc private func nightLightsToggled(_ s: NSButton) { manager.injectNightLightsToggle(store(s, "night-lights")) }
    @objc private func pollenToggled(_ s: NSButton) { manager.injectPollenToggle(store(s, "pollen-enabled")) }
    @objc private func spinToggled(_ s: NSButton) { manager.injectSpinToggle(store(s, "spin-enabled")) }

    @objc private func launchAtLoginToggled(_ sender: NSButton) {
        LaunchAtLogin.isEnabled = (sender.state == .on)
    }

    // MARK: - Credentials

    @objc private func editMapboxToken() {
        promptForSecret(
            title: "Mapbox Access Token",
            message: "Enter your Mapbox public token (pk.eyJ…).\nGet one free at mapbox.com/account/access-tokens",
            placeholder: "pk.eyJ...",
            key: "mapbox-access-token"
        ) { [weak self] value in self?.manager.injectMapboxToken(value) }
    }

    @objc private func editOwmKey() {
        promptForSecret(
            title: "OpenWeatherMap API Key",
            message: "Enter your OpenWeatherMap key. A new key can take up to two hours to activate.",
            placeholder: "32-character key",
            key: "owm-api-key"
        ) { [weak self] value in self?.manager.injectOwmApiKey(value) }
    }

    @objc private func editPollenKey() {
        promptForSecret(
            title: "Google Pollen API Key",
            message: "Enter your Google Pollen API key.\nGet one at console.cloud.google.com",
            placeholder: "AIza...",
            key: "google-pollen-api-key"
        ) { [weak self] value in self?.manager.injectPollenApiKey(value) }
    }

    private func promptForSecret(title: String, message: String, placeholder: String,
                                 key: String, apply: @escaping (String) -> Void) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        input.placeholderString = placeholder
        input.stringValue = defaults.string(forKey: key) ?? ""
        alert.accessoryView = input

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let value = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        defaults.set(value, forKey: key)
        apply(value)
    }

    /// Imports the credentials.json downloaded from an OpenSky API client.
    /// The secret goes to the Keychain, never to UserDefaults or the repo.
    @objc private func editOpenSkyCredentials() {
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
            err.runModal()
            return
        }

        manager.openSky.storeCredentials(clientId: id, clientSecret: secret)

        let ok = NSAlert()
        ok.messageText = "OpenSky Credentials Saved"
        ok.informativeText = "Client \"\(id)\" stored. The secret is in your Keychain."
        ok.runModal()
    }
}
