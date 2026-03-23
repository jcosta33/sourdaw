import { type ElasticAudioMode, elasticAudioStore } from './types';

export function setQuantizeStrength(strength: number): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    elasticAudioStore.set({ ...state, quantizeStrength: Math.max(0, Math.min(1, strength)) });
}

export function setElasticMode(mode: ElasticAudioMode): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    elasticAudioStore.set({ ...state, mode });
}

export function lockTransient(clipId: string, transientId: string): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    const markers = state.transients.get(clipId);
    if (!markers) {
        return;
    }
    const newTransients = new Map(state.transients);
    newTransients.set(
        clipId,
        markers.map((m) => (m.id === transientId ? { ...m, locked: !m.locked } : m))
    );
    elasticAudioStore.set({ ...state, transients: newTransients });
}

export function clearTransients(clipId: string): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    const newTransients = new Map(state.transients);
    newTransients.delete(clipId);
    elasticAudioStore.set({ ...state, transients: newTransients });
}
