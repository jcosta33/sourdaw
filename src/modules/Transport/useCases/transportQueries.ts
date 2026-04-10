/**
 * Transport Queries — use case layer exposing read-only transport state
 * to cross-module consumers.
 *
 * Other modules should import from here rather than from
 * Transport/repositories/transportRepository directly.
 */

import { inject } from '#/infra/di/inject';
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

/** Get the current transport state snapshot. */
export const getTransportState = inject({ repoGetTransportState })(
    ({ repoGetTransportState }) =>
        function getTransportState(): TransportState | null {
            return repoGetTransportState();
        }
);

/** Get the raw transport store value (for direct snapshot access). */
export const getTransportStoreValue = inject({ repoGetTransportState })(
    ({ repoGetTransportState }) =>
        function getTransportStoreValue(): TransportState | null {
            return repoGetTransportState();
        }
);

/** Get tempo map store state snapshot. */
export const getTempoMapState = inject({ tempoMapStore })(
    ({ tempoMapStore: store }) =>
        function getTempoMapState(): TempoMapStoreState | null {
            return store.value;
        }
);

/** Resolve tempo at a given beat. */
export function getTempoAtBeat(changes: TempoChange[], beat: number, defaultTempo: number): number {
    return modelGetTempoAtBeat(changes, beat, defaultTempo);
}

/** Patch the transport state. */
export const updateTransportState = inject({ repoUpdateTransportState })(
    ({ repoUpdateTransportState }) =>
        function updateTransportState(patch: Partial<TransportState>): void {
            repoUpdateTransportState(patch);
        }
);
