/**
 * In-flight guard. `undo`/`redo` read `undoStore.value` up front and write the moved
 * stacks at the end; the `await` on the inverse/forward replay in between yields the
 * microtask queue. Without serialization two overlapping `undo()` calls both read the
 * same `state`, both pop the same `lastEntry`, and the second write clobbers the first —
 * the same entry is consumed twice and one document mutation is undone without its stack
 * bookkeeping. We serialize every mutation through one FIFO promise chain so a second
 * call only reads `undoStore.value` after the first has committed its write. Sequential
 * awaited callers (e.g. `undoToIndex`) still proceed one step at a time.
 */
let mutationChain: Promise<unknown> = Promise.resolve();

export function runUndoRedoExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = mutationChain.then(operation);
    // Keep the chain alive even if an operation rejects, so one failure does not wedge
    // every future undo/redo. Swallow only on the chain copy; the caller still sees the
    // rejection via `result`.
    mutationChain = result.catch(() => undefined);
    return result;
}
