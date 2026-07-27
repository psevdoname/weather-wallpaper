import Foundation

/// Fetches the global 10m wind field straight from NOAA's GFS.
///
/// Done natively for two reasons: NOMADS sends no CORS headers, so a file://
/// page cannot read it at all, and the response is GRIB2 which has to be
/// decoded. The result is a 1° global grid — about a hundred times denser than
/// what point-sampling an API could afford — and it costs nothing.
final class WindService {

    struct Grid {
        let cols: Int
        let rows: Int
        let u: [Float]
        let v: [Float]
        let cycle: String
    }

    private let session = URLSession(configuration: .ephemeral)
    private var cached: Grid?
    private var cachedAt: Date = .distantPast
    private var inFlight = false

    /// GFS runs every six hours and takes roughly four to publish.
    private static let refreshInterval: TimeInterval = 3 * 3600

    func field(_ completion: @escaping (Grid?) -> Void) {
        if let cached, Date().timeIntervalSince(cachedAt) < Self.refreshInterval {
            completion(cached)
            return
        }
        guard !inFlight else { completion(cached); return }
        inFlight = true
        download(attempt: 0) { [weak self] grid in
            guard let self else { return }
            self.inFlight = false
            if let grid {
                self.cached = grid
                self.cachedAt = Date()
            }
            completion(grid ?? self.cached)
        }
    }

    private func download(attempt: Int, completion: @escaping (Grid?) -> Void) {
        // Walk back through cycles until one has been published.
        guard attempt < 4, let url = Self.url(cyclesAgo: attempt) else {
            completion(nil)
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 60

        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            DesktopWindowManager.windLog("cycle -\(attempt): status \(status), \(data?.count ?? 0) bytes")
            guard let data, status == 200, data.count > 1000,
                  data.prefix(4) == Data("GRIB".utf8) else {
                NSLog("[Wind] cycle -\(attempt) unavailable (status \(status), \(error?.localizedDescription ?? "no error"))")
                self.download(attempt: attempt + 1, completion: completion)
                return
            }

            let fields = GribDecoder.decode(data)
            DesktopWindowManager.windLog("decoded \(fields.count) fields")
            // Category 2 is momentum; 2 = u-component, 3 = v-component.
            guard let uField = fields.first(where: { $0.parameterCategory == 2 && $0.parameterNumber == 2 }),
                  let vField = fields.first(where: { $0.parameterCategory == 2 && $0.parameterNumber == 3 }),
                  uField.values.count == uField.ni * uField.nj,
                  vField.values.count == uField.values.count else {
                NSLog("[Wind] GRIB decoded but wind components missing")
                self.download(attempt: attempt + 1, completion: completion)
                return
            }

            completion(Self.reproject(u: uField, v: vField, cycle: url.lastPathComponent))
        }.resume()
    }

    /// GFS is published north-to-south starting at longitude 0. The renderer
    /// wants south-to-north starting at -180.
    private static func reproject(u: GribDecoder.Field, v: GribDecoder.Field, cycle: String) -> Grid {
        let ni = u.ni, nj = u.nj
        var outU = [Float](repeating: 0, count: ni * nj)
        var outV = [Float](repeating: 0, count: ni * nj)

        for row in 0..<nj {
            let sourceRow = nj - 1 - row
            for col in 0..<ni {
                let sourceCol = (col + ni / 2) % ni
                let source = sourceRow * ni + sourceCol
                let destination = row * ni + col
                outU[destination] = u.values[source]
                outV[destination] = v.values[source]
            }
        }
        return Grid(cols: ni, rows: nj, u: outU, v: outV, cycle: cycle)
    }

    private static func url(cyclesAgo: Int) -> URL? {
        let now = Date().addingTimeInterval(-4 * 3600 - Double(cyclesAgo) * 6 * 3600)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.year, .month, .day, .hour], from: now)
        guard let year = parts.year, let month = parts.month,
              let day = parts.day, let hour = parts.hour else { return nil }

        let cycle = (hour / 6) * 6
        let date = String(format: "%04d%02d%02d", year, month, day)
        let cycleText = String(format: "%02d", cycle)

        var components = URLComponents(string: "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl")!
        components.queryItems = [
            URLQueryItem(name: "file", value: "gfs.t\(cycleText)z.pgrb2.1p00.f000"),
            URLQueryItem(name: "lev_10_m_above_ground", value: "on"),
            URLQueryItem(name: "var_UGRD", value: "on"),
            URLQueryItem(name: "var_VGRD", value: "on"),
            URLQueryItem(name: "dir", value: "/gfs.\(date)/\(cycleText)/atmos")
        ]
        return components.url
    }

    /// Shaped for window.receiveWind in globe.js.
    static func json(for grid: Grid) -> String? {
        let payload: [String: Any] = [
            "south": -90.0, "west": -180.0,
            "north": 90.0, "east": 180.0 - (360.0 / Double(grid.cols)),
            "global": true,
            "cols": grid.cols, "rows": grid.rows,
            "u": grid.u.map { Double($0) },
            "v": grid.v.map { Double($0) },
            "source": "GFS \(grid.cycle)"
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
