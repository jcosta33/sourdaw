import { type SampleCategory } from '../../models/SampleEntry';
import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

export function setCategoryFilter(category: SampleCategory | null): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, categoryFilter: category });
}
