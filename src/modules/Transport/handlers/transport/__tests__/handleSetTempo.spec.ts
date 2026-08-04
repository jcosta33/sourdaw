import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { setTempo } from '../../../useCases/setTempo';
import { stopPlayback } from '../../../useCases/transportControls/stopPlayback';
import { handleSetTempo } from '../handleSetTempo';
import { handleStopPlayback } from '../handleStopPlayback';

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type TempoMapFixture = { changes: TempoChangeFixture[] };

// The stores are mocked rather than `getTransportState`, so `getTempoAtPlayhead`
// resolves through the real tempo-map model: a handler that read the inert
// `transport.tempo` would still answer, just with the wrong number.
const { transportRef, tempoMapRef } = vi.hoisted(() => {
    const transportRef: { value: TransportState | null } = { value: null };
    const tempoMapRef: { value: TempoMapFixture | null } = { value: null };
    return { transportRef, tempoMapRef };
});

vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportRef.value;
        },
        set: (next: TransportState) => {
            transportRef.value = next;
        },
    },
}));

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapRef.value;
        },
        set: (next: TempoMapFixture) => {
            tempoMapRef.value = next;
        },
    },
}));

vi.mock('../../../useCases/setTempo', () => ({
    setTempo: vi.fn(),
}));

vi.mock('../../../useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

describe('transport handlers', () => {
    beforeEach(() => {
        vi.mocked(setTempo).mockClear();
        vi.mocked(stopPlayback).mockClear();
        transportRef.value = { ...defaultTransportState, tempo: 110, playheadPosition: 0 };
        tempoMapRef.value = { changes: [] };
    });

    it('handleSetTempo forwards bpm to setTempo', () => {
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 120 } });

        expect(setTempo).toHaveBeenCalledWith(120);
    });

    it('handleSetTempo captures the transport base tempo when there is no tempo map', () => {
        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            inverseAction: { type: 'setTempo', payload: { bpm: 110 } },
        });
    });

    it('handleSetTempo captures the map-governed tempo when a change sits at beat 0', () => {
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };

        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            // 90, not the inert base tempo 110 — undoing has to restore what the
            // field read out, which is the tempo event at the playhead.
            inverseAction: { type: 'setTempo', payload: { bpm: 90 } },
        });
    });

    it('handleSetTempo emits no inverse when the governing tempo is outside the settable range', () => {
        // Tempo-map events accept up to 999 BPM, `setTempo` only 300, so an
        // inverse carrying 400 would throw instead of restoring.
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 400, curve: 'instant' }] };

        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            inverseAction: null,
        });
    });

    it('handleSetTempo emits no inverse when transport state is missing', () => {
        transportRef.value = null;

        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            inverseAction: null,
        });
    });

    it('handleSetTempo treats the map-governed tempo, not the base tempo, as the no-op comparison', () => {
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };

        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 90 } })).toBe(true);
        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 110 } })).toBe(false);
    });

    it('handleStopPlayback calls stopPlayback', () => {
        void handleStopPlayback.execute({ type: 'stopPlayback', payload: undefined });

        expect(stopPlayback).toHaveBeenCalled();
    });
});
