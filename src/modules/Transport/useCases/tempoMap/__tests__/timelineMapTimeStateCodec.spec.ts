import { describe, it, expect } from 'vitest';

import { timelineMapTimeStateCodec } from '../timelineMapTimeStateCodec';

import type { TempoMapStoreState } from '#/modules/Transport/stores/tempoMapStore';
import type { TimeSignatureMapStoreState } from '#/modules/Transport/stores/timeSignatureMapStore';

/**
 * Direct unit specs for timelineMapTimeStateCodec. The codec encodes/decodes
 * tempo + time-signature map state for CRDT collaboration snapshots. Zero direct
 * spec coverage — callers feed encoded snapshots but never assert the codec itself.
 */

const { encodeState, decodeState, snapshotsEqual, stateMatchesSnapshot } = timelineMapTimeStateCodec;

function makeState(overrides: { tempo?: TempoMapStoreState; ts?: TimeSignatureMapStoreState } = {}): {
    tempoState: TempoMapStoreState;
    timeSignatureState: TimeSignatureMapStoreState;
} {
    return {
        tempoState: overrides.tempo ?? { changes: [{ id: 't1', beat: 0, tempo: 120, curve: 'linear' }] },
        timeSignatureState: overrides.ts ?? { changes: [{ id: 'ts1', beat: 0, numerator: 4, denominator: 4 }] },
    };
}

describe('timelineMapTimeStateCodec — round-trip fidelity', () => {
    it('round-trips a state with tempo and time-signature changes', () => {
        const state = makeState({
            tempo: {
                changes: [
                    { id: 't1', beat: 0, tempo: 128, curve: 'linear' },
                    { id: 't2', beat: 8, tempo: 140, curve: 'instant' },
                ],
            },
            ts: {
                changes: [
                    { id: 'ts1', beat: 0, numerator: 3, denominator: 4 },
                    { id: 'ts2', beat: 16, numerator: 6, denominator: 8 },
                ],
            },
        });
        const encoded = encodeState(state);
        expect(encoded).not.toBeNull();
        const decoded = decodeState(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded).toEqual(state);
    });

    it('round-trips an empty state (no changes)', () => {
        const state = makeState({
            tempo: { changes: [] },
            ts: { changes: [] },
        });
        const encoded = encodeState(state);
        const decoded = decodeState(encoded);
        expect(decoded).toEqual(state);
    });
});

describe('timelineMapTimeStateCodec — negative-zero distinction', () => {
    it('encodes a beat of -0 as a negative-zero node and round-trips distinctly', () => {
        const state = makeState({
            tempo: { changes: [{ id: 't1', beat: -0, tempo: 120, curve: 'linear' }] },
        });
        const encoded = encodeState(state);
        expect(encoded).not.toBeNull();
        const decoded = decodeState(encoded)!;
        const change = decoded.tempoState.changes[0];
        expect(Object.is(change?.beat, -0)).toBe(true);
    });
});

describe('timelineMapTimeStateCodec — tempo range validation', () => {
    it('rejects tempo below MIN_TEMPO_MAP_TEMPO (20) on encode', () => {
        const state = makeState({
            tempo: { changes: [{ id: 't1', beat: 0, tempo: 19, curve: 'linear' }] },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('rejects tempo above MAX_TEMPO_MAP_TEMPO (999) on encode', () => {
        const state = makeState({
            tempo: { changes: [{ id: 't1', beat: 0, tempo: 1000, curve: 'linear' }] },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('accepts tempo at the boundaries (20 and 999)', () => {
        const minState = makeState({
            tempo: { changes: [{ id: 't1', beat: 0, tempo: 20, curve: 'linear' }] },
        });
        const maxState = makeState({
            tempo: { changes: [{ id: 't1', beat: 0, tempo: 999, curve: 'linear' }] },
        });
        expect(encodeState(minState)).not.toBeNull();
        expect(encodeState(maxState)).not.toBeNull();
    });

    it('rejects an invalid curve type', () => {
        const state = makeState({
            tempo: { changes: [{ id: 't1', beat: 0, tempo: 120, curve: 'exponential' as never }] },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('rejects a negative beat', () => {
        const state = makeState({
            tempo: { changes: [{ id: 't1', beat: -1, tempo: 120, curve: 'linear' }] },
        });
        expect(encodeState(state)).toBeNull();
    });
});

describe('timelineMapTimeStateCodec — time-signature range validation', () => {
    it('rejects numerator > 32 on encode', () => {
        const state = makeState({
            ts: { changes: [{ id: 'ts1', beat: 0, numerator: 33, denominator: 4 }] },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('rejects denominator < 1 on encode', () => {
        const state = makeState({
            ts: { changes: [{ id: 'ts1', beat: 0, numerator: 4, denominator: 0 }] },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('rejects non-integer numerator on encode', () => {
        const state = makeState({
            ts: { changes: [{ id: 'ts1', beat: 0, numerator: 2.5, denominator: 4 }] },
        });
        expect(encodeState(state)).toBeNull();
    });

    it('accepts time-signature at the boundaries (1 and 32)', () => {
        const state = makeState({
            ts: { changes: [{ id: 'ts1', beat: 0, numerator: 1, denominator: 32 }] },
        });
        expect(encodeState(state)).not.toBeNull();
    });
});

describe('timelineMapTimeStateCodec — decode rejection', () => {
    it('rejects null input', () => {
        expect(decodeState(null)).toBeNull();
    });

    it('rejects a non-object input', () => {
        expect(decodeState(42)).toBeNull();
    });

    it('rejects a snapshot with an invalid tempo value after decode', () => {
        const validState = makeState();
        const encoded = encodeState(validState)!;
        // Tamper: replace a tempo value with an out-of-range encoded number.
        if (encoded.tempo.changes[0]) {
            encoded.tempo.changes[0].tempo = { type: 'number', value: 5 };
        }
        expect(decodeState(encoded)).toBeNull();
    });
});

describe('timelineMapTimeStateCodec — snapshotsEqual', () => {
    it('returns true for identical encoded snapshots', () => {
        const a = encodeState(makeState())!;
        const b = encodeState(makeState())!;
        expect(snapshotsEqual(a, b)).toBe(true);
    });

    it('returns false when tempo differs between snapshots', () => {
        const a = encodeState(makeState())!;
        const b = encodeState(makeState({ tempo: { changes: [{ id: 't1', beat: 0, tempo: 140, curve: 'linear' }] } }))!;
        expect(snapshotsEqual(a, b)).toBe(false);
    });

    it('returns false when time-signature differs between snapshots', () => {
        const a = encodeState(makeState())!;
        const b = encodeState(makeState({ ts: { changes: [{ id: 'ts1', beat: 0, numerator: 3, denominator: 4 }] } }))!;
        expect(snapshotsEqual(a, b)).toBe(false);
    });

    it('returns false when comparing snapshots of different lengths', () => {
        const a = encodeState(
            makeState({
                tempo: {
                    changes: [
                        { id: 't1', beat: 0, tempo: 120, curve: 'linear' },
                        { id: 't2', beat: 4, tempo: 140, curve: 'linear' },
                    ],
                },
            })
        )!;
        const b = encodeState(makeState())!;
        expect(snapshotsEqual(a, b)).toBe(false);
    });
});

describe('timelineMapTimeStateCodec — stateMatchesSnapshot', () => {
    it('returns true when the state matches its own encoded snapshot', () => {
        const state = makeState();
        const snapshot = encodeState(state)!;
        expect(stateMatchesSnapshot({ ...state, snapshot })).toBe(true);
    });

    it('returns false when the state differs from the snapshot', () => {
        const state = makeState();
        const otherState = makeState({ tempo: { changes: [{ id: 't1', beat: 0, tempo: 200, curve: 'linear' }] } });
        const snapshot = encodeState(otherState)!;
        expect(stateMatchesSnapshot({ ...state, snapshot })).toBe(false);
    });

    it('returns false when the state cannot be encoded', () => {
        const invalid = makeState({ tempo: { changes: [{ id: 't1', beat: 0, tempo: 5, curve: 'linear' }] } });
        const snapshot = encodeState(makeState())!;
        expect(stateMatchesSnapshot({ ...invalid, snapshot })).toBe(false);
    });
});
