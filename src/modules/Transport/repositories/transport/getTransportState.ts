import { type TransportState } from '../../models/TransportState';
import { transportStore } from '../../stores/transportStore';

export function getTransportState(): TransportState | null {
    return transportStore.value;
}
