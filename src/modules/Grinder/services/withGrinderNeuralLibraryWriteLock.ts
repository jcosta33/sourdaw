/**
 * Serializes neural-library writes (import + remove) so that "persist to disk"
 * and "mutate the store" happen as one indivisible unit. Without this, two
 * overlapping operations could persist stale snapshots and diverge disk from
 * the store, silently dropping imports on the next restore.
 *
 * The lock lives here, in services/, rather than inside a single use case so
 * both the import and remove use cases can serialize against the same mutable
 * state without one use case reaching into another's internals.
 */
let neural_library_write_lock: Promise<unknown> = Promise.resolve();

export function withGrinderNeuralLibraryWriteLock<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const run = neural_library_write_lock.then(operation, operation);
    // Keep the chain alive even if `operation` rejects, so later writers still
    // serialize after this one rather than racing.
    neural_library_write_lock = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}
