import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';
import { type SampleDatabaseState } from '#/modules/SoundLibrary/models/SampleEntry';

export function setSortBy(sortBy: SampleDatabaseState['sortBy'], direction?: 'asc' | 'desc'): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        sortBy,
        sortDirection: direction ?? (state.sortBy === sortBy && state.sortDirection === 'asc' ? 'desc' : 'asc'),
    });
}
