import { type GrinderImportedNeuralModel } from '../models/GrinderPatch';
import { persistGrinderNeuralLibrary } from '../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import { pickGrinderNeuralModelFiles } from '../repositories/neuralLibraryPersistence/pickGrinderNeuralModelFiles';
import { parseGrinderNamFile } from '../services/parseGrinderNamFile';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
    setGrinderNeuralLibraryState,
    upsertGrinderNeuralLibraryEntries,
} from '../stores/grinderNeuralLibraryStore';

export async function importGrinderNeuralModels(): Promise<GrinderImportedNeuralModel[]> {
    setGrinderNeuralLibraryState({ loading: true, error: null });

    const files = await pickGrinderNeuralModelFiles();
    if (!files || files.length === 0) {
        setGrinderNeuralLibraryState({ loading: false });
        return [];
    }

    const successes: GrinderImportedNeuralModel[] = [];
    const failures: string[] = [];
    for (const file of files) {
        try {
            const file_text = await file.text();
            successes.push(parseGrinderNamFile({ file_name: file.name, file_text }));
        } catch (error) {
            failures.push(error instanceof Error ? error.message : `Failed to import ${file.name}`);
        }
    }

    if (successes.length === 0) {
        setGrinderNeuralLibraryState({
            hydrated: true,
            loading: false,
            error: failures[0] ?? 'Failed to import neural model',
        });
        return [];
    }

    upsertGrinderNeuralLibraryEntries(successes);
    const next_entries = grinderNeuralLibraryStore.value?.entries ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE.entries;
    await persistGrinderNeuralLibrary({ entries: next_entries });

    if (failures.length > 0) {
        setGrinderNeuralLibraryState({
            error: failures[0] ?? 'Some neural model imports failed',
        });
    }

    return successes;
}
