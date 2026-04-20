import { type SampleCategory } from '#/modules/SoundLibrary/models/SampleEntry';
import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function setCategoryFilter(category: SampleCategory | null): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, categoryFilter: category });
}
