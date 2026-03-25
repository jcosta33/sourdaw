import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function rateSample(sampleId: string, rating: number): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId ? { ...s, rating: Math.max(0, Math.min(5, rating)) } : s
        ),
    });
}
