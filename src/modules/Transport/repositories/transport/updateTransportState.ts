import { type TransportState } from '../../models/TransportState';
import { transportStore } from '../../stores/transportStore';

export function updateTransportState(patch: Partial<TransportState>): void {
    const current = transportStore.value;
    if (!current) {
        return;
    }
    transportStore.set({ ...current, ...patch });
}
