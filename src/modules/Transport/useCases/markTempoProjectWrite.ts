import { tempoProjectRevisionStore } from '../stores/tempoProjectRevisionStore';

export function markTempoProjectWrite(): void {
    const currentRevision = tempoProjectRevisionStore.value ?? 0;
    tempoProjectRevisionStore.set((currentRevision + 1) % Number.MAX_SAFE_INTEGER);
}
