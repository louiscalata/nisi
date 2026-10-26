// Test-only replacement for asynchronous defer on the older admitted compiler.
// Register each scope immediately after acquisition; nested scopes unwind LIFO.
// Cleanup is nonthrowing so it cannot replace the operation's original error.
func withAsyncTestCleanup<Value>(
    operation: () async throws -> Value,
    cleanup: () async -> Void
) async throws -> Value {
    let outcome: Result<Value, any Error>
    do {
        outcome = .success(try await operation())
    } catch {
        outcome = .failure(error)
    }
    await cleanup()
    return try outcome.get()
}
