/**
 * Command operations read domain/history state, may await handler work, then
 * commit linear and tree history. One FIFO chain prevents another action,
 * undo, redo, or group reversion from publishing against a stale snapshot.
 * Internal replay uses `executeAppActionImpl` so it remains inside the owning
 * operation instead of reacquiring this lock.
 */
let mutation_chain: Promise<void> = Promise.resolve();

export function runCommandMutationExclusive<Output>(operation: () => Promise<Output>): Promise<Output> {
    const result = mutation_chain.then(operation);
    // Keep the queue live after a rejection while preserving the caller's error.
    mutation_chain = result.then(
        () => undefined,
        () => undefined
    );
    return result;
}
