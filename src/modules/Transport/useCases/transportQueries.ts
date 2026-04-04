/**
 * Transport Queries — use case layer exposing read-only transport state
 * to cross-module consumers.
 *
 * Other modules should import from here rather than from
 * Transport/repositories/transportRepository directly.
 */

import {
    getTransportState as repoGetTransportState,
    updateTransportState as repoUpdateTransportState,
} from '../repositories/transport';
import { type TransportState, defaultTransportState } from '../models/TransportState';
import { type TempoChange, getTempoAtBeat as modelGetTempoAtBeat } from '../models/TempoMap';
import { type TimeSignatureChange } from '../models/TimeSignatureMap';
import { tempoMapStore } from '../stores/tempoMapStore';

export { defaultTransportState };
export type { TransportState, TempoChange, TimeSignatureChange };

/** Get the current transport state snapshot. */
export function getTransportState(): TransportState | null {
    return repoGetTransportState();
}

/** Get the raw transport store value (for direct snapshot access). */
export function getTransportStoreValue(): TransportState | null {
    return repoGetTransportState();
}

/** Get tempo map store state snapshot. */
export function getTempoMapState(): { changes: TempoChange[] } | null {
    return tempoMapStore.value;
}

/** Resolve tempo at a given beat. */
export function getTempoAtBeat(changes: TempoChange[], beat: number, defaultTempo: number): number {
    return modelGetTempoAtBeat(changes, beat, defaultTempo);
}

/** Patch the transport state. */
export function updateTransportState(patch: Partial<TransportState>): void {
    repoUpdateTransportState(patch);
}
