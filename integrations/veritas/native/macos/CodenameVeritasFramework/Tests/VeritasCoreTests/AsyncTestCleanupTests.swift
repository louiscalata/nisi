import Dispatch
import Foundation
import Testing

private final class CleanupSentinelError: Error {}

@Suite("Private awaited test cleanup")
struct AsyncTestCleanupTests {
  @Test("Success waits for exactly one cleanup before returning the value")
  func success() async throws {
    var events: [String] = []
    let value = try await withAsyncTestCleanup(
      operation: {
        events.append("operation")
        return 7
      },
      cleanup: {
        events.append("cleanup")
      })
    events.append("returned")
    #expect(value == 7)
    #expect(events == ["operation", "cleanup", "returned"])
  }

  @Test("Failure waits for exactly one cleanup and rethrows the original object")
  func failure() async {
    var events: [String] = []
    let expected = CleanupSentinelError()
    do {
      let _: Void = try await withAsyncTestCleanup(
        operation: {
          events.append("operation")
          throw expected
        },
        cleanup: {
          events.append("cleanup")
        })
      Issue.record("The operation's original failure must propagate.")
    } catch {
      #expect((error as? CleanupSentinelError) === expected)
      events.append("caught")
    }
    #expect(events == ["operation", "cleanup", "caught"])
  }

  @Test("Nested scopes drain task then close ledgers before outer removal")
  func nestedUnwind() async {
    var events: [String] = []
    let expected = CleanupSentinelError()
    do {
      let _: Void = try await withAsyncTestCleanup(
        operation: {
          try await withAsyncTestCleanup(
            operation: {
              try await withAsyncTestCleanup(
                operation: { () async throws -> Void in
                  throw expected
                },
                cleanup: {
                  events.append("task-drained")
                })
            },
            cleanup: {
              events.append("blocked-ledger-closed")
            })
        },
        cleanup: {
          events.append("primary-ledger-closed")
        })
      Issue.record("The nested operation must throw.")
    } catch {
      #expect((error as? CleanupSentinelError) === expected)
    }
    events.append("root-removed")
    #expect(
      events == [
        "task-drained", "blocked-ledger-closed", "primary-ledger-closed", "root-removed",
      ])
  }

  @Test("A failed later acquisition still cleans the already acquired scope")
  func laterAcquisitionFailure() async {
    var events: [String] = ["primary-acquired"]
    let expected = CleanupSentinelError()
    do {
      let _: Void = try await withAsyncTestCleanup(
        operation: {
          events.append("secondary-acquisition-failed")
          throw expected
        },
        cleanup: {
          events.append("primary-closed")
        })
      Issue.record("Acquisition failure must propagate.")
    } catch {
      #expect((error as? CleanupSentinelError) === expected)
    }
    #expect(events == ["primary-acquired", "secondary-acquisition-failed", "primary-closed"])
  }

  @Test("CancellationError is rethrown only after awaited cleanup")
  func cancellationError() async {
    var events: [String] = []
    do {
      let _: Void = try await withAsyncTestCleanup(
        operation: {
          throw CancellationError()
        },
        cleanup: {
          events.append("cleanup")
        })
      Issue.record("CancellationError must propagate.")
    } catch {
      #expect(error is CancellationError)
      events.append("caught")
    }
    #expect(events == ["cleanup", "caught"])
  }

  @Test("Failure releases and joins a real blocked worker before rethrowing")
  func blockedWorkerUnwind() async {
    let gate = CleanupWorkerGate()
    let events = CleanupWorkerEvents()
    let expected = CleanupSentinelError()
    let worker = Task {
      let released = await gate.waitForRelease()
      await events.append("worker-finished")
      return released
    }
    do {
      let _: Void = try await withAsyncTestCleanup(
        operation: { () async throws -> Void in
          var iterator = gate.entered.makeAsyncIterator()
          let entered: Void? = await iterator.next()
          #expect(entered != nil)
          throw expected
        },
        cleanup: {
          gate.release.signal()
          let released = await worker.value
          #expect(released, "Cleanup must release the worker, not wait for its timeout.")
          await events.append("joined")
        })
      Issue.record("The original operation error must propagate after cleanup.")
    } catch {
      #expect((error as? CleanupSentinelError) === expected)
      await events.append("caught")
    }
    #expect(await events.snapshot() == ["worker-finished", "joined", "caught"])
  }
}

// Only thread-safe synchronization members cross the worker boundary.
private final class CleanupWorkerGate: @unchecked Sendable {
  let release = DispatchSemaphore(value: 0)
  let entered: AsyncStream<Void>
  let enteredContinuation: AsyncStream<Void>.Continuation

  init() {
    let stream = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
    entered = stream.stream
    enteredContinuation = stream.continuation
  }

  func waitForRelease() async -> Bool {
    await withCheckedContinuation { continuation in
      DispatchQueue.global().async {
        self.enteredContinuation.yield(())
        let released = self.release.wait(timeout: .now() + 5) == .success
        self.enteredContinuation.finish()
        continuation.resume(returning: released)
      }
    }
  }
}

private actor CleanupWorkerEvents {
  private var events: [String] = []
  func append(_ event: String) { events.append(event) }
  func snapshot() -> [String] { events }
}
