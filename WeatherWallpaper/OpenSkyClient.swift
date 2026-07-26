import Foundation
import Security

/// Fetches live aircraft states from the OpenSky Network.
///
/// The request is made from Swift rather than the WebView on purpose: the API
/// only sends `Access-Control-Allow-Origin: https://opensky-network.org`, so a
/// `file://` page (origin `null`) is blocked by CORS. Doing it here also keeps
/// the client secret out of the JavaScript context.
final class OpenSkyClient {

    private static let clientIdKey = "opensky-client-id"
    private static let keychainService = "com.weatherwallpaper.app.opensky"
    private static let keychainAccount = "client-secret"
    private static let tokenURL = URL(string: "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token")!

    private var accessToken: String?
    private var tokenExpiry: Date = .distantPast
    private let session = URLSession(configuration: .ephemeral)

    // MARK: - Credentials

    var clientId: String? {
        get { UserDefaults.standard.string(forKey: Self.clientIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.clientIdKey) }
    }

    var isConfigured: Bool {
        guard let id = clientId, !id.isEmpty else { return false }
        return clientSecret != nil
    }

    func storeCredentials(clientId: String, clientSecret: String) {
        self.clientId = clientId
        saveSecret(clientSecret)
        // Force a fresh token on next fetch.
        accessToken = nil
        tokenExpiry = .distantPast
    }

    /// The secret lives in the Keychain, not UserDefaults.
    private var clientSecret: String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func saveSecret(_ secret: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(secret.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    // MARK: - OAuth2 (client credentials)

    private func withToken(_ completion: @escaping (String?) -> Void) {
        if let token = accessToken, Date() < tokenExpiry {
            completion(token)
            return
        }
        guard let id = clientId, let secret = clientSecret else {
            completion(nil)
            return
        }

        var request = URLRequest(url: Self.tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "grant_type", value: "client_credentials"),
            URLQueryItem(name: "client_id", value: id),
            URLQueryItem(name: "client_secret", value: secret)
        ]
        request.httpBody = body.percentEncodedQuery?.data(using: .utf8)

        session.dataTask(with: request) { [weak self] data, _, error in
            guard let self else { return completion(nil) }
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = json["access_token"] as? String else {
                NSLog("[OpenSky] token request failed: \(error?.localizedDescription ?? "no access_token")")
                return completion(nil)
            }
            let ttl = (json["expires_in"] as? Double) ?? 1800
            self.accessToken = token
            // Renew a minute early so a request never races the expiry.
            self.tokenExpiry = Date().addingTimeInterval(ttl - 60)
            completion(token)
        }.resume()
    }

    // MARK: - States

    /// Returns a JSON string shaped for `window.receiveFlights` in globe.js,
    /// or nil if the fetch failed.
    func fetchStates(south: Double, west: Double, north: Double, east: Double,
                     completion: @escaping (String?) -> Void) {
        withToken { [weak self] token in
            guard let self else { return completion(nil) }
            var comps = URLComponents(string: "https://opensky-network.org/api/states/all")!
            comps.queryItems = [
                URLQueryItem(name: "lamin", value: String(format: "%.2f", south)),
                URLQueryItem(name: "lomin", value: String(format: "%.2f", west)),
                URLQueryItem(name: "lamax", value: String(format: "%.2f", north)),
                URLQueryItem(name: "lomax", value: String(format: "%.2f", east))
            ]
            var request = URLRequest(url: comps.url!)
            request.timeoutInterval = 30
            // Anonymous access still works, just with a much lower rate limit.
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

            self.session.dataTask(with: request) { data, response, error in
                if let http = response as? HTTPURLResponse, http.statusCode == 429 {
                    NSLog("[OpenSky] rate limited")
                    return completion(nil)
                }
                guard let data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let states = json["states"] as? [[Any?]] else {
                    NSLog("[OpenSky] states request failed: \(error?.localizedDescription ?? "bad payload")")
                    return completion(nil)
                }
                completion(Self.encode(states: states))
            }.resume()
        }
    }

    private static let flightsMax = 4000

    /// OpenSky state vector indices: 1 callsign, 2 origin_country, 5 lon, 6 lat,
    /// 7 baro_altitude, 8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate,
    /// 13 geo_altitude.
    private static func encode(states: [[Any?]]) -> String? {
        // Filter first, then thin evenly. Truncating the head instead would
        // skew the globe: the list is ordered by icao24, which correlates with
        // country of registration.
        let airborne = states.filter { s in
            guard s.count >= 14, (s[8] as? Bool) != true else { return false }
            return s[5] as? Double != nil && s[6] as? Double != nil
        }
        let step = airborne.count > flightsMax
            ? Int((Double(airborne.count) / Double(flightsMax)).rounded(.up))
            : 1

        var store: [[String: Any]] = []
        store.reserveCapacity(min(airborne.count, flightsMax))

        for index in Swift.stride(from: 0, to: airborne.count, by: step) {
            let s = airborne[index]
            let lon = s[5] as! Double
            let lat = s[6] as! Double

            store.append([
                "lon": lon,
                "lat": lat,
                "velocity": (s[9] as? Double) ?? 0,
                "heading": (s[10] as? Double) ?? 0,
                "callsign": ((s[1] as? String) ?? "").trimmingCharacters(in: .whitespaces),
                "origin_country": (s[2] as? String) ?? "",
                "altitude": (s[13] as? Double) ?? (s[7] as? Double) ?? 0,
                "vertical_rate": (s[11] as? Double) ?? 0
            ])
        }

        let payload: [String: Any] = [
            "store": store,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
