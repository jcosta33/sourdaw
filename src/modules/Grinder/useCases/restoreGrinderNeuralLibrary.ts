import { restoreGrinderNeuralLibraryResult } from '../repositories/neuralLibraryPersistence/restoreGrinderNeuralLibrary';
import { setGrinderNeuralLibraryState } from '../stores/grinderNeuralLibraryStore';

export async function restoreGrinderNeuralLibrary(): Promise<void> {
    setGrinderNeuralLibraryState({ loading: true, error: null });
    const result = await restoreGrinderNeuralLibraryResult();

    if (!result.ok) {
        // Surface the differentiated quota / schema / permission failure instead
        // of collapsing it to an empty library, which is indistinguishable from
        // "nothing was ever imported".
        setGrinderNeuralLibraryState({
            hydrated: true,
            loading: false,
            error: result.error.message,
            entries: [],
        });
        return;
    }

    setGrinderNeuralLibraryState({
        hydrated: true,
        loading: false,
        error: null,
        entries: result.entries,
    });
}
