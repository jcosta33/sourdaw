import { persistGrinderNeuralLibrary } from '../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
    removeGrinderNeuralLibraryEntry,
    setGrinderNeuralLibraryState,
} from '../stores/grinderNeuralLibraryStore';

/**
 * Serializes neural-library writes (import + remove) so that "persist to disk"
 * and "mutate the store" happen as one indivisible unit. Without this, two
 * overlapping operations could persist stale snapshots and diverge disk from
 * the store, silently dropping imports on the next restore.
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

type RemoveGrinderNeuralModelInput = {
    model_id: string;
};

export async function removeGrinderNeuralModel(input: RemoveGrinderNeuralModelInput): Promise<void> {
    return withGrinderNeuralLibraryWriteLock(async () => {
        // Recompute from the *current* store inside the lock so a concurrent
        // import (or earlier removal) that already mutated the store is included
        // in the persisted snapshot, keeping disk and store in lockstep.
        const current = grinderNeuralLibraryStore.value ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE;
        const removed_entry = current.entries.find((entry) => entry.id === input.model_id);
        const next_entries = current.entries.filter((entry) => entry.id !== input.model_id);

        const result = await persistGrinderNeuralLibrary({ entries: next_entries });
        if (!result.ok) {
            setGrinderNeuralLibraryState({
                error: removed_entry
                    ? `Could not remove ${removed_entry.name}: failed to persist the updated Neural library.`
                    : 'Could not update the Neural library: failed to persist changes.',
            });
            return;
        }

        removeGrinderNeuralLibraryEntry(input.model_id);
        setGrinderNeuralLibraryState({ error: null });
    });
}
