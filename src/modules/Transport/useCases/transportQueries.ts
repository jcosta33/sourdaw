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
import { tempoMapStore } from '../stores/tempoMapStore';

export type TransportState = {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    overdubEnabled: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    playheadPosition: number;
    loopStart: number;
    loopEnd: number;
    scheduleGrainMs: number;
    punchInEnabled: boolean;
    punchInBeat: number;
    punchOutBeat: number;
    countInEnabled: boolean;
    countInBars: number;
    preRollEnabled: boolean;
    preRollBars: number;
    masterGain: number;
};

export type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

export const defaultTransportState: TransportState = {
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    overdubEnabled: false,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    playheadPosition: 0,
    loopStart: 0,
    loopEnd: 0,
    scheduleGrainMs: 10,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    countInEnabled: false,
    countInBars: 1,
    preRollEnabled: false,
    preRollBars: 2,
    masterGain: 80,
};

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
export function getTempoMapState(): { changes: TempoChange[] } | null {
    return tempoMapStore.value;
}

/** Resolve tempo at a given beat. */
export function getTempoAtBeat(changes: TempoChange[], beat: number, defaultTempo: number): number {
    if (changes.length === 0) {
        return defaultTempo;
    }

    const sorted = [...changes].sort((left, right) => left.beat - right.beat);
    const before = sorted.filter((change) => change.beat <= beat);
    const after = sorted.filter((change) => change.beat > beat);

    if (before.length === 0) {
        return sorted[0]!.tempo;
    }
    if (after.length === 0) {
        return before[before.length - 1]!.tempo;
    }

    const previousChange = before[before.length - 1]!;
    const nextChange = after[0]!;

    if (previousChange.curve === 'instant') {
        return previousChange.tempo;
    }

    const interpolation = (beat - previousChange.beat) / (nextChange.beat - previousChange.beat);
    return previousChange.tempo + (nextChange.tempo - previousChange.tempo) * interpolation;
}

/** Patch the transport state. */
export const updateTransportState = inject({ repoUpdateTransportState })(
    ({ repoUpdateTransportState }) =>
        function updateTransportState(patch: Partial<TransportState>): void {
            repoUpdateTransportState(patch);
        }
);
