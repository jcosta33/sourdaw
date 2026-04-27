import { persistGrinderNeuralLibrary } from '../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import { removeGrinderNeuralLibraryEntry, setGrinderNeuralLibraryState } from '../stores/grinderNeuralLibraryStore';

type RemoveGrinderNeuralModelInput = {
    model_id: string;
};

export async function removeGrinderNeuralModel(input: RemoveGrinderNeuralModelInput): Promise<void> {
    const next_entries = removeGrinderNeuralLibraryEntry(input.model_id);
    await persistGrinderNeuralLibrary({ entries: next_entries });
    setGrinderNeuralLibraryState({ error: null });
}
