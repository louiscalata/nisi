import Foundation

/// The single framing primitive for every byte-framed digest in VeritasCore.
///
/// # Frame layout (v1)
///
/// ```
/// frame(tag, value) = [u8 tag][u64 big-endian length][value bytes]
/// ```
///
/// This is the layout the TypeScript kernel's `updateFrame` writes -- a one-byte
/// tag, an eight-byte big-endian length, then the bytes:
///
/// ```ts
/// const header = Buffer.alloc(9);
/// header.writeUInt8(tag, 0);
/// header.writeBigUInt64BE(BigInt(value.byteLength), 1);
/// ```
///
/// Adopting it here makes the Swift side conformant with the TS v1 *frame
/// layout*.
///
/// It does NOT make Swift digests equal to TS digests. TS frames a
/// canonical-JSON payload; the constructions below frame a flat list of fields.
/// Same envelope, different contents. Reconciling the two constructions is a
/// separate decision and is deliberately not attempted here.
///
/// # Tags
///
/// - ``domainTag`` (`0x00`) — the domain separator. Exactly one, always first.
/// - ``fieldTag`` (`0x01`) — a payload field. Zero or more, in caller order.
/// - `0x02`–`0xFF` are reserved here. V1 Swift must never emit them.
///
/// Tag 0 for the domain and tag 1 for the payload mirrors the TS kernel's own
/// domain-digest construction, which is exactly
/// `updateFrame(hash, 0, domain)` then `updateFrame(hash, 1, payload)`.
///
/// TS does use tags `2`-`4`, but only in an unrelated file-tree construction
/// (path, entry kind, mode, bytes). Nothing in Swift builds that shape, so
/// those tags stay unassigned on this side rather than being mirrored.
///
/// # No field-count prefix
///
/// Earlier copies of this logic disagreed: some wrote a bare `u64` field count
/// after the domain, one wrote two bare counts mid-stream, others wrote none.
/// This primitive writes none, for four reasons.
///
/// 1. A count buys no collision resistance. Every frame carries its own length,
///    so a concatenation of frames is uniquely decodable and no two
///    `(domain, fields)` tuples can produce the same byte stream. `["a", "b"]`,
///    `["ab"]`, `[]` and `[""]` are already pairwise distinct.
/// 2. The counts that existed were themselves unframed — eight naked bytes with
///    no tag and no length. Under a tagged layout that is the one element of the
///    stream that is not a frame, reintroducing exactly the parse ambiguity the
///    tag byte exists to remove.
/// 3. TS has no count. Adding a field TS does not have makes the eventual
///    construction reconciliation strictly harder for no present benefit.
/// 4. Where a count is genuinely load-bearing — separating two variable-length
///    lists concatenated into one field list — it belongs inside the frame
///    discipline as an ordinary field. `LocalIncidentLedgerV1.incidentDigest`
///    already does this, framing `String(codes.count)` as a normal field.
///    Callers that need separation follow that pattern rather than reaching for
///    an out-of-band mechanism.
enum VeritasDigestFrameV1 {
    /// Tag for the domain separator frame. Exactly one, always first.
    static let domainTag: UInt8 = 0x00

    /// Tag for a payload field frame. Zero or more, in caller order.
    static let fieldTag: UInt8 = 0x01

    /// Append one `[u8 tag][u64 BE length][value]` frame to `data`.
    static func append(tag: UInt8, _ value: Data, to data: inout Data) {
        data.append(tag)
        var length = UInt64(value.count).bigEndian
        withUnsafeBytes(of: &length) { data.append(contentsOf: $0) }
        data.append(value)
    }

    /// The framed byte stream for a domain and an ordered list of raw fields.
    ///
    /// Layout: `frame(domainTag, domain) ‖ frame(fieldTag, f)` for each `f`.
    static func framedBytes(domain: String, fields: [Data]) -> Data {
        var data = Data()
        append(tag: domainTag, Data(domain.utf8), to: &data)
        for field in fields { append(tag: fieldTag, field, to: &data) }
        return data
    }

    /// SHA-256, lowercase hex, of ``framedBytes(domain:fields:)``.
    static func digest(domain: String, frames: [Data]) -> String {
        ArtifactSnapshot.digest(framedBytes(domain: domain, fields: frames))
    }

    /// SHA-256, lowercase hex, over UTF-8 encodings of `fields`.
    static func digest(domain: String, fields: [String]) -> String {
        digest(domain: domain, frames: fields.map { Data($0.utf8) })
    }

    /// SHA-256, lowercase hex, of a domain frame followed by one payload frame.
    ///
    /// Used where the payload is opaque binary (canonical JSON, say) rather than
    /// a list of textual fields.
    static func digest(domain: String, payload: Data) -> String {
        digest(domain: domain, frames: [payload])
    }
}
