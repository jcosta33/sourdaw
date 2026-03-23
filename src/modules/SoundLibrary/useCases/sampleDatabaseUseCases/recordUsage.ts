import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function recordUsage(sampleId: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId
                ? { ...s, useCount: s.useCount + 1, lastUsedAt: new Date().toISOString() }
                : s
        ),
    });
}
