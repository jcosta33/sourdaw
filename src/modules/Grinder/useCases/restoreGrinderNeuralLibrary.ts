import { restoreGrinderNeuralLibrary as restoreGrinderNeuralLibraryFromRepo } from '../repositories/neuralLibraryPersistence/restoreGrinderNeuralLibrary';
import { setGrinderNeuralLibraryState } from '../stores/grinderNeuralLibraryStore';

export async function restoreGrinderNeuralLibrary(): Promise<void> {
    setGrinderNeuralLibraryState({ loading: true, error: null });
    const entries = await restoreGrinderNeuralLibraryFromRepo();
    setGrinderNeuralLibraryState({
        hydrated: true,
        loading: false,
        error: null,
        entries,
    });
}
