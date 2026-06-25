import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

export function removeSample(sampleId: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.filter((s) => s.id !== sampleId),
    });
}
