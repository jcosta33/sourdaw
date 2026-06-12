import { persistGrinderNeuralLibrary } from '../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
    removeGrinderNeuralLibraryEntry,
    setGrinderNeuralLibraryState,
} from '../stores/grinderNeuralLibraryStore';

type RemoveGrinderNeuralModelInput = {
    model_id: string;
};

export async function removeGrinderNeuralModel(input: RemoveGrinderNeuralModelInput): Promise<void> {
    const current = grinderNeuralLibraryStore.value ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE;
    const removed_entry = current.entries.find((entry) => entry.id === input.model_id);
    const next_entries = current.entries.filter((entry) => entry.id !== input.model_id);
    const persisted = await persistGrinderNeuralLibrary({ entries: next_entries });
    if (!persisted) {
        setGrinderNeuralLibraryState({
            error: removed_entry
                ? `Could not remove ${removed_entry.name}: failed to persist the updated Neural library.`
                : 'Could not update the Neural library: failed to persist changes.',
        });
        return;
    }

    removeGrinderNeuralLibraryEntry(input.model_id);
    setGrinderNeuralLibraryState({ error: null });
}
