import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function setTagFilter(tags: string[]): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, activeFilters: tags });
}
