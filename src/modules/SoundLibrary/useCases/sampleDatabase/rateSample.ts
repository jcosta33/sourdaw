import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

/** Clamp a rating into [0, 5]; non-finite input (NaN/Infinity) collapses to 0. */
function clampRating(rating: number): number {
    if (!Number.isFinite(rating)) {
        return 0;
    }
    return Math.max(0, Math.min(5, rating));
}

export function rateSample(sampleId: string, rating: number): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    const clamped = clampRating(rating);
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) => (s.id === sampleId ? { ...s, rating: clamped } : s)),
    });
}
