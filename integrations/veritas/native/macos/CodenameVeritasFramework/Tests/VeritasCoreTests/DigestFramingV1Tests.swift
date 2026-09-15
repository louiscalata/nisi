import Foundation
import Testing
@testable import VeritasCore

// MARK: - Shared digest framing primitive

/// Pins the v1 frame layout directly, independently of every consumer.
///
/// A wrong tag byte, a wrong length width, or little-endian lengths fail here
/// rather than as a confusing cascade across the digest sites that use them.
@Suite("Digest framing v1")
struct DigestFramingV1Tests {

    private func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    @Test("A frame is one tag byte, a big-endian u64 length, then the value")
    func frameLayoutIsExact() {
        let bytes = VeritasDigestFrameV1.framedBytes(
            domain: "d",
            fields: [Data("a".utf8)]
        )
        #expect(hex(bytes) == "00" + "0000000000000001" + "64"
                            + "01" + "0000000000000001" + "61")
    }

    @Test("Tag values are 0 for the domain and 1 for a field")
    func tagValuesAreFrozen() {
        #expect(VeritasDigestFrameV1.domainTag == 0x00)
        #expect(VeritasDigestFrameV1.fieldTag == 0x01)
    }

    @Test("A domain with no fields emits only the domain frame")
    func emptyFieldListEmitsOnlyTheDomain() {
        let bytes = VeritasDigestFrameV1.framedBytes(domain: "", fields: [])
        #expect(hex(bytes) == "00" + "0000000000000000")
    }

    @Test("Lengths are big-endian across a byte boundary")
    func lengthIsBigEndian() {
        let value = Data(repeating: 0x7a, count: 256)
        let bytes = VeritasDigestFrameV1.framedBytes(domain: "", fields: [value])
        #expect(hex(bytes).hasPrefix("00" + "0000000000000000"
                                   + "01" + "0000000000000100" + "7a7a"))
    }

    @Test("Frames are self-delimiting, so no field list needs a count prefix")
    func selfDelimitingFramesSeparateFieldLists() {
        let split = VeritasDigestFrameV1.digest(domain: "d", fields: ["a", "b"])
        let joined = VeritasDigestFrameV1.digest(domain: "d", fields: ["ab"])
        let none = VeritasDigestFrameV1.digest(domain: "d", fields: [])
        let empty = VeritasDigestFrameV1.digest(domain: "d", fields: [""])
        #expect(Set([split, joined, none, empty]).count == 4)
    }

    @Test("The domain separates digests over identical fields")
    func domainSeparatesDigests() {
        #expect(VeritasDigestFrameV1.digest(domain: "a", fields: ["x"])
                != VeritasDigestFrameV1.digest(domain: "b", fields: ["x"]))
    }

    @Test("A payload digest equals a single-field digest over the same bytes")
    func payloadDigestIsASingleFieldFrame() {
        let payload = Data("{\"a\":1}".utf8)
        #expect(VeritasDigestFrameV1.digest(domain: "d", payload: payload)
                == VeritasDigestFrameV1.digest(domain: "d", frames: [payload]))
    }
}
