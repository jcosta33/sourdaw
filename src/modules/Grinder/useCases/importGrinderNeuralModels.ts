import { pickFiles } from '#/modules/Project/useCases';

import { type GrinderImportedNeuralModel } from '../models/GrinderPatch';
import { persistGrinderNeuralLibrary } from '../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import { pickGrinderNeuralModelFiles } from '../repositories/neuralLibraryPersistence/pickGrinderNeuralModelFiles';
import { parseGrinderNamFile } from '../services/parseGrinderNamFile';
import { withGrinderNeuralLibraryWriteLock } from '../services/withGrinderNeuralLibraryWriteLock';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
    setGrinderNeuralLibraryState,
    upsertGrinderNeuralLibraryEntries,
} from '../stores/grinderNeuralLibraryStore';

export async function importGrinderNeuralModels(): Promise<GrinderImportedNeuralModel[]> {
    // The store owns the in-flight status so every panel instance observes the same
    // 'importing' flag and an unmount mid-import cannot strand a component-local one.
    // The flag is a single shared boolean, not a refcount, so an overlapping call
    // (double-click, second panel instance) is rejected as a silent no-op — otherwise
    // its finally below would flip the flag false while the first import is still in
    // flight. The trigger button is disabled while importing, so a rejected re-entry
    // matches the visible UX. Within a single run the finally settles the flag on
    // every exit — cancel, all-failed, success, or an unexpected throw from the
    // picker/parser/persistence path.
    if (grinderNeuralLibraryStore.value?.importing) {
        return [];
    }

    setGrinderNeuralLibraryState({ loading: true, importing: true, error: null });

    try {
        const files = await pickGrinderNeuralModelFiles({ pick_files: pickFiles });
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

        // Serialize the store mutation and the disk write so a concurrent remove
        // cannot persist a stale snapshot between them. Recompute the entries to
        // persist from the store *after* upserting, inside the lock, so disk always
        // reflects the post-import store.
        const persisted = await withGrinderNeuralLibraryWriteLock(async () => {
            upsertGrinderNeuralLibraryEntries(successes);
            const next_entries =
                grinderNeuralLibraryStore.value?.entries ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE.entries;
            return persistGrinderNeuralLibrary({ entries: next_entries });
        });

        if (!persisted.ok) {
            setGrinderNeuralLibraryState({
                error:
                    persisted.error.code === 'quota_exceeded'
                        ? 'Storage is full — the imported neural models could not be saved. Free up space and try again.'
                        : 'Imported neural models could not be saved to the Neural library.',
            });
        } else if (failures.length > 0) {
            setGrinderNeuralLibraryState({
                error: failures[0] ?? 'Some neural model imports failed',
            });
        }

        return successes;
    } finally {
        setGrinderNeuralLibraryState({ importing: false });
    }
}
