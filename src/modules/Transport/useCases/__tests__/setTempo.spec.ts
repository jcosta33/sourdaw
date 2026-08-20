import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../models/TransportState';
import { setTempo } from '../setTempo';

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };

// The stores are mocked, not the repositories: `setTempo` resolves its
// destination from the tempo map and the playhead, so a spec that stubbed the
// repository layer could not tell a base-tempo write from a tempo-map write.
const { transportRef, tempoMapRef } = vi.hoisted(() => ({
    transportRef: { value: null as TransportState | null },
    tempoMapRef: { value: null as { changes: TempoChangeFixture[] } | null },
}));

vi.mock('../../stores/transportStore', () => ({
    MIN_TEMPO: 20,
    MAX_TEMPO: 300,
    transportStore: {
        get value() {
            return transportRef.value;
        },
        set: (next: TransportState) => {
            transportRef.value = next;
        },
    },
}));

vi.mock('../../stores/tempoMapStore', () => ({
    MIN_TEMPO_MAP_TEMPO: 20,
    MAX_TEMPO_MAP_TEMPO: 999,
    tempoMapStore: {
        get value() {
            return tempoMapRef.value;
        },
        set: (next: { changes: TempoChangeFixture[] }) => {
            tempoMapRef.value = next;
        },
    },
}));

describe('setTempo', () => {
    beforeEach(() => {
        transportRef.value = { ...defaultTransportState, tempo: 120, playheadPosition: 0 };
        tempoMapRef.value = { changes: [] };
    });

    it('should throw when bpm is outside the base-tempo range', () => {
        expect(() => setTempo({ bpm: 10 })).toThrow();
        expect(() => setTempo({ bpm: 400 })).toThrow();
        expect(transportRef.value!.tempo).toBe(120);
    });

    it('should patch tempo when bpm is valid', () => {
        expect(setTempo({ bpm: 140 })).toEqual({ status: 'written' });
        expect(transportRef.value!.tempo).toBe(140);
    });

    it('should report no-write and change nothing when there is no transport state', () => {
        transportRef.value = null;

        expect(setTempo({ bpm: 140 })).toEqual({ status: 'no-write' });
        expect(transportRef.value).toBeNull();
    });
});
