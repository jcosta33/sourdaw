import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function toggleFavorite(sampleId: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId ? { ...s, favorite: !s.favorite } : s
        ),
    });
}
