import { type GrinderImportedNeuralModel } from '../models/GrinderPatch';
import { downloadGrinderNeuralModelFile } from '../repositories/neuralLibraryPersistence/downloadGrinderNeuralModelFile';
import { setGrinderNeuralLibraryState } from '../stores/grinderNeuralLibraryStore';

export function exportGrinderNeuralModel(entry: GrinderImportedNeuralModel): void {
    if (!entry.sourceFileText) {
        setGrinderNeuralLibraryState({
            error: `Cannot export ${entry.name}: original imported NAM payload is not available.`,
        });
        return;
    }

    downloadGrinderNeuralModelFile({
        file_name: entry.sourceFileName ?? `${entry.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'grinder-capture'}.nam`,
        file_text: entry.sourceFileText,
    });
    setGrinderNeuralLibraryState({ error: null });
}
