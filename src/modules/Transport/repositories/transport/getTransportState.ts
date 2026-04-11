import { transportStore } from '../../stores/transportStore';
import { type TransportState } from '../../models/TransportState';

export function getTransportState(): TransportState | null {
    return transportStore.value;
}