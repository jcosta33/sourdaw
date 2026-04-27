import { createStore } from '#/infra/store/createStore';

import { type GrinderImportedNeuralModel } from '../models/GrinderPatch';

export type GrinderNeuralLibraryState = {
    hydrated: boolean;
    loading: boolean;
    error: string | null;
    entries: GrinderImportedNeuralModel[];
};

export const DEFAULT_GRINDER_NEURAL_LIBRARY_STATE: GrinderNeuralLibraryState = {
    hydrated: false,
    loading: false,
    error: null,
    entries: [],
};

export const grinderNeuralLibraryStore = createStore<GrinderNeuralLibraryState>({
    initialData: DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
});

export function setGrinderNeuralLibraryState(input: Partial<GrinderNeuralLibraryState>): void {
    const current = grinderNeuralLibraryStore.value ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE;
    grinderNeuralLibraryStore.set({
        ...current,
        ...input,
    });
}

export function upsertGrinderNeuralLibraryEntries(entries: readonly GrinderImportedNeuralModel[]): void {
    const current = grinderNeuralLibraryStore.value ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE;
    const next_by_id = new Map(current.entries.map((entry) => [entry.id, entry]));
    for (const entry of entries) {
        next_by_id.set(entry.id, entry);
    }

    grinderNeuralLibraryStore.set({
        hydrated: true,
        loading: false,
        error: null,
        entries: [...next_by_id.values()].sort((left, right) => right.importedAt - left.importedAt),
    });
}

export function removeGrinderNeuralLibraryEntry(entry_id: string): GrinderImportedNeuralModel[] {
    const current = grinderNeuralLibraryStore.value ?? DEFAULT_GRINDER_NEURAL_LIBRARY_STATE;
    const next_entries = current.entries.filter((entry) => entry.id !== entry_id);
    grinderNeuralLibraryStore.set({
        hydrated: true,
        loading: false,
        error: null,
        entries: next_entries,
    });
    return next_entries;
}
