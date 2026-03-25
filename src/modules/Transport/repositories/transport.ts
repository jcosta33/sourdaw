import { transportStore } from '../stores/transportStore';
import { type TransportState } from '../models/TransportState';

export function getTransportState(): TransportState | null {
    return transportStore.value;
}

export function updateTransportState(patch: Partial<TransportState>): void {
    const current = transportStore.value;
    if (!current) {
        return;
    }
    transportStore.set({ ...current, ...patch });
}
