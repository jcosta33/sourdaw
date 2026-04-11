import { tempoMapStore, type TempoMapStoreState } from '../../stores/tempoMapStore';

export function getTempoMapState(): TempoMapStoreState | null {
    return tempoMapStore.value;
}