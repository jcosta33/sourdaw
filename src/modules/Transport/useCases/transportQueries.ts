import {
    getTransportState as repoGetTransportState,
    updateTransportState as repoUpdateTransportState,
} from '../repositories/transport';
import { type TransportState, defaultTransportState } from '../models/TransportState';
import { type TempoChange, getTempoAtBeat as modelGetTempoAtBeat } from '../models/TempoMap';
import { type TimeSignatureChange } from '../models/TimeSignatureMap';
import { tempoMapStore, type TempoMapStoreState } from '../stores/tempoMapStore';

export { defaultTransportState };
export type { TransportState, TempoChange, TimeSignatureChange };

export function getTransportState(): TransportState | null {
    return repoGetTransportState();
}

export function getTransportStoreValue(): TransportState | null {
    return repoGetTransportState();
}

export function getTempoMapState(): TempoMapStoreState | null {
    return tempoMapStore.value;
}

/** Resolve tempo at a given beat. */
export function getTempoAtBeat(changes: TempoChange[], beat: number, defaultTempo: number): number {
    return modelGetTempoAtBeat(changes, beat, defaultTempo);
}

export function updateTransportState(patch: Partial<TransportState>): void {
    repoUpdateTransportState(patch);
}
