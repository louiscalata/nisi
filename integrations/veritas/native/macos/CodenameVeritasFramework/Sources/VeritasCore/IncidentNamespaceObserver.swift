import Darwin
import Foundation

/// Observation is not an atomic namespace lock or a SQLite result.
public enum IncidentNamespaceRefusalV1: Error, Equatable, Sendable {
    case changed(eventMask: UInt32)
    case unavailable(operation: String, code: Int32)
    case identityMismatch
    case malformedEvent
    case stopped
}

typealias NamespaceKernelEvent = Darwin.kevent
typealias NamespaceEventCallV1 = @Sendable (
    Int32, UnsafePointer<NamespaceKernelEvent>?, Int32,
    UnsafeMutablePointer<NamespaceKernelEvent>?, Int32, UnsafePointer<timespec>?
) -> Int32
let namespaceKevent: NamespaceEventCallV1 = kevent

struct NamespaceCloseResultV1: Equatable, Sendable {
    let descriptor: Int32
    let role: String
    let resultCode: Int32
    let errorCode: Int32?
}

/// Confined to one ledger actor. Opens ONLY a directory, never SQLite's files:
/// closing an independent database FD can cancel another connection's POSIX locks.
/// Coverage starts after bootstrap and ends before SQLite close. Directory entry
/// changes are conservative refusals, including harmless unrelated entry changes.
/// Empty polls do not prove absence of a race, and file-content writes are unseen.
final class IncidentNamespaceObserverV1: @unchecked Sendable {
    static let mask = UInt32(NOTE_WRITE | NOTE_RENAME | NOTE_DELETE | NOTE_REVOKE)
    private var directory: Int32 = -1
    private var queue: Int32 = -1
    private let eventCall: NamespaceEventCallV1
    private let closeCall: @Sendable (Int32) -> Int32
    private(set) var closeResults: [NamespaceCloseResultV1] = []
    private(set) var refusal: IncidentNamespaceRefusalV1?
    var descriptorsForTesting: [Int32] { [queue, directory] }

    init(directoryURL: URL, device: dev_t, inode: ino_t,
         eventCall: @escaping NamespaceEventCallV1 = namespaceKevent,
         closeCall: @escaping @Sendable (Int32) -> Int32 = Darwin.close) throws {
        self.eventCall = eventCall
        self.closeCall = closeCall
        directory = directoryURL.path.withCString {
            Darwin.open($0, O_EVTONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard directory >= 0 else {
            throw IncidentNamespaceRefusalV1.unavailable(operation: "open-directory", code: errno)
        }
        do {
            var status = stat()
            guard fstat(directory, &status) == 0 else {
                throw IncidentNamespaceRefusalV1.unavailable(operation: "fstat-directory", code: errno)
            }
            guard status.st_dev == device, status.st_ino == inode,
                  status.st_mode & S_IFMT == S_IFDIR, status.st_uid == geteuid() else {
                throw IncidentNamespaceRefusalV1.identityMismatch
            }
            queue = kqueue()
            guard queue >= 0 else {
                throw IncidentNamespaceRefusalV1.unavailable(operation: "kqueue", code: errno)
            }
            guard fcntl(queue, F_SETFD, FD_CLOEXEC) == 0 else {
                throw IncidentNamespaceRefusalV1.unavailable(operation: "queue-cloexec", code: errno)
            }
            var change = NamespaceKernelEvent(
                ident: UInt(directory), filter: Int16(EVFILT_VNODE),
                flags: UInt16(EV_ADD | EV_ENABLE | EV_CLEAR | EV_RECEIPT),
                fflags: Self.mask, data: 0, udata: nil
            )
            var receipt = NamespaceKernelEvent()
            let count = eventCall(queue, &change, 1, &receipt, 1, nil)
            guard count >= 0 else {
                throw IncidentNamespaceRefusalV1.unavailable(operation: "register", code: errno)
            }
            guard count == 1, receipt.ident == UInt(directory),
                  receipt.filter == Int16(EVFILT_VNODE),
                  receipt.flags & UInt16(EV_ERROR) != 0 else {
                throw IncidentNamespaceRefusalV1.malformedEvent
            }
            guard receipt.data == 0 else {
                throw IncidentNamespaceRefusalV1.unavailable(operation: "register-receipt", code: Int32(clamping: receipt.data))
            }
            // Do not drain/discard early evidence as a favorable baseline.
            try poll()
        } catch {
            _ = stop()
            throw error
        }
    }

    func poll() throws {
        if let refusal { throw refusal }
        do {
            guard queue >= 0, directory >= 0 else { throw IncidentNamespaceRefusalV1.stopped }
            var event = NamespaceKernelEvent()
            var immediate = timespec(tv_sec: 0, tv_nsec: 0)
            let count = eventCall(queue, nil, 0, &event, 1, &immediate)
            guard count >= 0 else {
                throw IncidentNamespaceRefusalV1.unavailable(operation: "poll", code: errno)
            }
            guard count == 0 || count == 1 else { throw IncidentNamespaceRefusalV1.malformedEvent }
            if count == 1 {
                try Self.validateEvent(
                    ident: event.ident, expected: UInt(directory), filter: event.filter,
                    flags: event.flags, mask: event.fflags, data: event.data
                )
                throw IncidentNamespaceRefusalV1.changed(eventMask: event.fflags)
            }
        } catch let error as IncidentNamespaceRefusalV1 {
            refusal = error
            throw error
        }
    }

    static func validateEvent(
        ident: UInt, expected: UInt, filter: Int16, flags: UInt16, mask: UInt32, data: Int
    ) throws {
        guard ident == expected, filter == Int16(EVFILT_VNODE),
              flags & UInt16(EV_ERROR) == 0, data == 0,
              mask != 0, mask & ~Self.mask == 0 else {
            throw IncidentNamespaceRefusalV1.malformedEvent
        }
    }

    /// End observation BEFORE SQLite close; do not mislabel its WAL/SHM cleanup
    /// as pre-checkpoint evidence. Invalidate ownership before each close attempt;
    /// an ambiguous failed close is reported and never blindly retried.
    @discardableResult
    func stop() -> IncidentNamespaceRefusalV1? {
        let descriptors = [(queue, "kqueue"), (directory, "directory")]
        queue = -1
        directory = -1
        var failure: IncidentNamespaceRefusalV1?
        for (descriptor, role) in descriptors where descriptor >= 0 {
            let result = closeCall(descriptor)
            let errorCode = result == 0 ? nil : errno
            closeResults.append(.init(descriptor: descriptor, role: role, resultCode: result, errorCode: errorCode))
            if let errorCode, failure == nil {
                failure = .unavailable(operation: "close-observer", code: errorCode)
            }
        }
        if refusal == nil { refusal = failure ?? .stopped }
        return failure
    }

    deinit { stop() }
}
