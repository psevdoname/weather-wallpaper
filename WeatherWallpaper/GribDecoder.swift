import Foundation

/// Minimal GRIB2 reader for the GFS wind fields published by NOAA NOMADS.
///
/// Only what those files actually use is implemented: data representation
/// template 5.3, complex packing with second-order spatial differencing. The
/// decoder validates itself — the group lengths must sum to the point count —
/// so a malformed or unexpected message is rejected rather than silently
/// producing nonsense.
enum GribDecoder {

    struct Field {
        let parameterCategory: UInt8
        let parameterNumber: UInt8
        let ni: Int
        let nj: Int
        let values: [Float]
    }

    private struct BitReader {
        let data: [UInt8]
        var bitPosition: Int

        init(_ data: [UInt8], byteOffset: Int) {
            self.data = data
            self.bitPosition = byteOffset * 8
        }

        mutating func read(_ count: Int) -> Int {
            var value = 0
            for _ in 0..<count {
                let byte = data[bitPosition >> 3]
                value = (value << 1) | Int((byte >> (7 - UInt8(bitPosition & 7))) & 1)
                bitPosition += 1
            }
            return value
        }

        /// The reference, width and length blocks each start on an octet
        /// boundary, unlike the values within them.
        mutating func alignToOctet() {
            bitPosition = (bitPosition + 7) & ~7
        }
    }

    /// GRIB stores negatives as sign-and-magnitude, not two's complement.
    private static func signMagnitude(_ raw: Int, bits: Int) -> Int {
        let sign = raw >> (bits - 1)
        let magnitude = raw & ((1 << (bits - 1)) - 1)
        return sign == 1 ? -magnitude : magnitude
    }

    static func decode(_ data: Data) -> [Field] {
        let bytes = [UInt8](data)
        var fields: [Field] = []
        var position = 0

        func u8(_ offset: Int) -> Int { Int(bytes[offset]) }
        func u16(_ offset: Int) -> Int { (Int(bytes[offset]) << 8) | Int(bytes[offset + 1]) }
        func u32(_ offset: Int) -> Int {
            (Int(bytes[offset]) << 24) | (Int(bytes[offset + 1]) << 16) |
            (Int(bytes[offset + 2]) << 8) | Int(bytes[offset + 3])
        }

        while position + 16 <= bytes.count,
              bytes[position] == 0x47, bytes[position + 1] == 0x52,
              bytes[position + 2] == 0x49, bytes[position + 3] == 0x42 {

            var messageLength = 0
            for index in 8..<16 { messageLength = (messageLength << 8) | Int(bytes[position + index]) }
            guard messageLength > 0, position + messageLength <= bytes.count else { break }

            var sections: [Int: Int] = [:]
            var cursor = position + 16
            while cursor + 5 <= position + messageLength {
                if bytes[cursor] == 0x37, bytes[cursor + 1] == 0x37,
                   bytes[cursor + 2] == 0x37, bytes[cursor + 3] == 0x37 { break }
                let length = u32(cursor)
                guard length > 0 else { break }
                sections[Int(bytes[cursor + 4])] = cursor
                cursor += length
            }

            guard let s3 = sections[3], let s4 = sections[4],
                  let s5 = sections[5], let s7 = sections[7] else {
                position += messageLength
                continue
            }

            let ni = u32(s3 + 30)
            let nj = u32(s3 + 34)
            let category = bytes[s4 + 9]
            let number = bytes[s4 + 10]

            let pointCount = u32(s5 + 5)
            guard u16(s5 + 9) == 3 else { position += messageLength; continue }

            let referenceValue = Float(bitPattern: UInt32(u32(s5 + 11)))
            let binaryScale = signMagnitude(u16(s5 + 15), bits: 16)
            let decimalScale = signMagnitude(u16(s5 + 17), bits: 16)
            let bitsPerValue = u8(s5 + 19)
            let groupCount = u32(s5 + 31)
            let widthReference = u8(s5 + 35)
            let widthBits = u8(s5 + 36)
            let lengthReference = u32(s5 + 37)
            let lengthIncrement = u8(s5 + 41)
            let lastGroupLength = u32(s5 + 42)
            let lengthBits = u8(s5 + 46)
            let differencingOrder = u8(s5 + 47)
            let extraOctets = u8(s5 + 48)

            var reader = BitReader(bytes, byteOffset: s7 + 5)

            var initialValues: [Int] = []
            for _ in 0..<differencingOrder { initialValues.append(reader.read(extraOctets * 8)) }
            let minimumDifference = signMagnitude(reader.read(extraOctets * 8), bits: extraOctets * 8)

            reader.alignToOctet()
            var references = [Int](repeating: 0, count: groupCount)
            for index in 0..<groupCount { references[index] = reader.read(bitsPerValue) }

            reader.alignToOctet()
            var widths = [Int](repeating: 0, count: groupCount)
            for index in 0..<groupCount { widths[index] = widthReference + reader.read(widthBits) }

            reader.alignToOctet()
            var lengths = [Int](repeating: 0, count: groupCount)
            for index in 0..<groupCount {
                lengths[index] = lengthReference + lengthIncrement * reader.read(lengthBits)
            }
            if groupCount > 0 { lengths[groupCount - 1] = lastGroupLength }

            // Self-check: if the bit stream were misread this would not hold.
            guard lengths.reduce(0, +) == pointCount else {
                NSLog("[Grib] group lengths do not sum to point count; skipping message")
                position += messageLength
                continue
            }

            reader.alignToOctet()
            var packed = [Int](); packed.reserveCapacity(pointCount)
            for group in 0..<groupCount {
                let width = widths[group]
                let reference = references[group]
                if width == 0 {
                    packed.append(contentsOf: repeatElement(reference, count: lengths[group]))
                } else {
                    for _ in 0..<lengths[group] { packed.append(reference + reader.read(width)) }
                }
            }

            // Undo the spatial differencing.
            for index in 0..<min(differencingOrder, packed.count) { packed[index] = initialValues[index] }
            if differencingOrder == 1 {
                for index in 1..<packed.count {
                    packed[index] += minimumDifference + packed[index - 1]
                }
            } else if differencingOrder == 2, packed.count >= 2 {
                for index in 2..<packed.count {
                    packed[index] += minimumDifference + 2 * packed[index - 1] - packed[index - 2]
                }
            }

            let scale = Float(pow(10.0, Double(decimalScale)))
            let factor = Float(pow(2.0, Double(binaryScale)))
            var values = [Float](repeating: 0, count: packed.count)
            for index in 0..<packed.count {
                values[index] = (referenceValue + Float(packed[index]) * factor) / scale
            }

            fields.append(Field(parameterCategory: category, parameterNumber: number,
                                ni: ni, nj: nj, values: values))
            position += messageLength
        }

        return fields
    }
}
