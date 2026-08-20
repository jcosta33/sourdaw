import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { stopPlayback } from '../../../useCases/transportControls/stopPlayback';
import { handleSetTempo } from '../handleSetTempo';
import { handleStopPlayback } from '../handleStopPlayback';

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type TempoMapFixture = { changes: TempoChangeFixture[] };

// The stores are mocked rather than the resolver, and `setTempo` runs for real:
// a handler that read the inert `transport.tempo`, or that let undo re-resolve
// its target from the playhead, would still answer — just about the wrong event.
const { transportRef, tempoMapRef, livePlayheadRef } = vi.hoisted(() => {
    const transportRef: { value: TransportState | null } = { value: null };
    const tempoMapRef: { value: TempoMapFixture | null } = { value: null };
    const livePlayheadRef = { current: 0 };
    return { transportRef, tempoMapRef, livePlayheadRef };
});

vi.mock('../../../stores/transportStore', () => ({
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

vi.mock('../../../stores/tempoMapStore', () => ({
    MIN_TEMPO_MAP_TEMPO: 20,
    MAX_TEMPO_MAP_TEMPO: 999,
    tempoMapStore: {
        get value() {
            return tempoMapRef.value;
        },
        set: (next: TempoMapFixture) => {
            tempoMapRef.value = next;
        },
    },
}));

vi.mock('../../../stores/playheadPositionRef', () => ({
    playheadPositionRef: livePlayheadRef,
}));

vi.mock('../../../useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

function tempoOf(id: string): number {
    return tempoMapRef.value!.changes.find((change) => change.id === id)!.tempo;
}

function seekTo(beat: number): void {
    transportRef.value = { ...transportRef.value!, playheadPosition: beat };
    livePlayheadRef.current = beat;
}

describe('transport handlers', () => {
    beforeEach(() => {
        vi.mocked(stopPlayback).mockClear();
        transportRef.value = { ...defaultTransportState, tempo: 110, playheadPosition: 0 };
        tempoMapRef.value = { changes: [] };
        livePlayheadRef.current = 0;
    });

    it('handleSetTempo writes the requested bpm', () => {
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 120 } });

        expect(transportRef.value!.tempo).toBe(120);
    });

    it('handleSetTempo captures the transport base tempo when there is no tempo map', () => {
        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            inverseAction: { type: 'setTempo', payload: { bpm: 110, expectedBpm: 128, tempoChangeId: null } },
            redoAction: { type: 'setTempo', payload: { bpm: 128, expectedBpm: 110, tempoChangeId: null } },
        });
    });

    it('keeps a base-tempo inverse pinned after a collaborator adds a tempo map', () => {
        const described = handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } });
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 128 } });
        tempoMapRef.value = { changes: [{ id: 'tc-new', beat: 0, tempo: 95, curve: 'instant' }] };
        if (described.inverseAction?.type !== 'setTempo') {
            throw new Error('Expected a guarded base-tempo inverse');
        }

        expect(handleSetTempo.execute(described.inverseAction)).toBeUndefined();
        expect(transportRef.value!.tempo).toBe(110);
        expect(tempoOf('tc-new')).toBe(95);
    });

    it('handleSetTempo captures the map-governed tempo when a change sits at beat 0', () => {
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };

        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            // 90, not the inert base tempo 110 — undoing has to restore what the
            // field read out, which is the tempo event at the playhead. Both
            // replay actions name that event so they cannot re-resolve later.
            inverseAction: { type: 'setTempo', payload: { bpm: 90, expectedBpm: 128, tempoChangeId: 'tc-0' } },
            redoAction: { type: 'setTempo', payload: { bpm: 128, expectedBpm: 90, tempoChangeId: 'tc-0' } },
        });
    });

    it('handleSetTempo restores the event it wrote even after the playhead has moved', () => {
        tempoMapRef.value = {
            changes: [
                { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
                { id: 'tc-b', beat: 12, tempo: 130, curve: 'instant' },
            ],
        };

        const described = handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 100 } });
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 100 } });
        expect(tempoOf('tc-a')).toBe(100);

        // Seeking to beat 12 puts tc-b in charge. A bare-bpm inverse would
        // re-resolve here and rewrite tc-b, corrupting two events with one undo.
        seekTo(12);
        void handleSetTempo.execute(described.inverseAction as { type: 'setTempo'; payload: { bpm: number } });

        expect(tempoOf('tc-a')).toBe(90);
        expect(tempoOf('tc-b')).toBe(130);
    });

    it('handleSetTempo redoes onto the event it originally wrote, not the current one', () => {
        tempoMapRef.value = {
            changes: [
                { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
                { id: 'tc-b', beat: 12, tempo: 130, curve: 'instant' },
            ],
        };

        const described = handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 100 } });
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 100 } });
        seekTo(12);
        void handleSetTempo.execute(described.inverseAction as { type: 'setTempo'; payload: { bpm: number } });
        void handleSetTempo.execute(described.redoAction as { type: 'setTempo'; payload: { bpm: number } });

        expect(tempoOf('tc-a')).toBe(100);
        expect(tempoOf('tc-b')).toBe(130);
    });

    it('handleSetTempo produces a usable inverse for a change above the base-tempo range', () => {
        // Tempo-map events accept up to 999 BPM. When the inverse was dropped for
        // being out of the transport field's 20–300 range, `undo` treated the
        // entry as inert, dropped it and undid the *previous* action instead —
        // while the 400 BPM change stayed destroyed.
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 400, curve: 'instant' }] };

        const described = handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } });
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 128 } });
        expect(tempoOf('tc-0')).toBe(128);

        expect(described.inverseAction).toEqual({
            type: 'setTempo',
            payload: { bpm: 400, expectedBpm: 128, tempoChangeId: 'tc-0' },
        });
        void handleSetTempo.execute(described.inverseAction as { type: 'setTempo'; payload: { bpm: number } });
        expect(tempoOf('tc-0')).toBe(400);
    });

    it('refuses a guarded inverse after a collaborator changes the targeted tempo event', () => {
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
        const described = handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } });
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 128 } });
        tempoMapRef.value.changes[0]!.tempo = 95;
        if (described.inverseAction?.type !== 'setTempo') {
            throw new Error('Expected a guarded tempo inverse');
        }
        const inverse = described.inverseAction;

        expect(handleSetTempo.validate?.(inverse, { actionIndex: 0, actions: [inverse] })).toBe(false);
        expect(handleSetTempo.execute(inverse)).toEqual({ status: 'conflict' });
        expect(tempoOf('tc-0')).toBe(95);
    });

    it('handleSetTempo emits no inverse and lands no write inside a tempo ramp', () => {
        tempoMapRef.value = {
            changes: [
                { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
                { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
            ],
        };
        seekTo(4);

        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 111 } })).toEqual({
            label: 'Set tempo to 111 BPM',
            inverseAction: null,
        });
        // The null inverse is only sound because nothing is written: an entry with
        // a null inverse is dropped by `undo`, which then undoes an unrelated
        // earlier action. The refusal itself throws rather than returning
        // `no-write`, which `executeAppAction` swallows into a silent abort — an
        // AI caller then reported the action as dispatched having changed nothing.
        expect(() => handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 111 } })).toThrowError(/tempo ramp/i);
        expect(tempoOf('tc-a')).toBe(90);
        expect(tempoOf('tc-b')).toBe(130);
    });

    it('handleSetTempo does not call a ramp refusal a no-op, which would swallow it just as quietly', () => {
        tempoMapRef.value = {
            changes: [
                { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
                { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
            ],
        };
        seekTo(4);

        // 110 is the interpolated tempo in force at beat 4. Comparing the request
        // against it made `isNoop` true, so `executeAppAction` returned before
        // `execute` ever ran and the refusal never surfaced. 111 is the same
        // refusal reached through the other branch.
        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 110 } })).toBe(false);
        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 111 } })).toBe(false);
    });

    it('handleSetTempo still treats a genuinely equal map tempo as a no-op', () => {
        // Guards the clause above against being written as a blanket `false`:
        // outside a ramp the no-op comparison has to keep working.
        tempoMapRef.value = { changes: [{ id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' }] };
        seekTo(4);

        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 90 } })).toBe(true);
    });

    it('handleSetTempo emits no inverse when transport state is missing', () => {
        transportRef.value = null;

        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            inverseAction: null,
        });
        expect(handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({ status: 'no-write' });
    });

    it('handleSetTempo treats the map-governed tempo, not the base tempo, as the no-op comparison', () => {
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };

        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 90 } })).toBe(true);
        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 110 } })).toBe(false);
    });

    it('handleSetTempo compares a named change against that change, not the playhead', () => {
        tempoMapRef.value = {
            changes: [
                { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
                { id: 'tc-b', beat: 12, tempo: 130, curve: 'instant' },
            ],
        };

        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 130, tempoChangeId: 'tc-b' } })).toBe(true);
        expect(handleSetTempo.isNoop?.({ type: 'setTempo', payload: { bpm: 90, tempoChangeId: 'tc-b' } })).toBe(false);
    });

    it('handleStopPlayback calls stopPlayback', () => {
        void handleStopPlayback.execute({ type: 'stopPlayback', payload: undefined });

        expect(stopPlayback).toHaveBeenCalled();
    });
});
