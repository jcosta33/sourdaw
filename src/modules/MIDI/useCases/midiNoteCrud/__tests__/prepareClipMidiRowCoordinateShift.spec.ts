import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../../stores/midiStore';
import { isMidiRowCoordinateCapture, prepareClipMidiRowCoordinateShift } from '../prepareClipMidiRowCoordinateShift';

const store = vi.hoisted(() => ({ value: null as MidiStoreState | null, set: vi.fn() }));
vi.mock('../../../stores/midiStore', () => ({ midiStore: store }));

function rowsAt(beat: number): MidiStoreState {
    return {
        probabilitySeed: 123,
        noteCoordinateFormat: 'clip-relative',
        notesByClipId: {
            clip: [{ id: 'note', startBeat: beat, pitch: 60, duration: 1, velocity: 100, probability: 0.4 }],
        },
        ccByClipId: { clip: [{ id: 'cc', beat, controller: 64, value: 127, channel: 2 }] },
        pitchBendByClipId: { clip: [{ id: 'bend', beat, value: 1024, channel: 3 }] },
    };
}

function prepare(beatDelta: number, restore?: unknown) {
    const result = prepareClipMidiRowCoordinateShift({ clipId: 'clip', beatDelta, restore });
    if (result.status !== 'prepared') {
        throw new Error(`Expected prepared coordinate writes: ${result.reason}`);
    }
    return result;
}

describe('MIDI owner coordinate shift preparation', () => {
    beforeEach(() => {
        store.value = rowsAt(0.1);
        store.set.mockReset();
        store.set.mockImplementation((next: MidiStoreState) => {
            store.value = next;
        });
    });

    it('writes all three coordinate lanes together and restores their exact fractional figures', () => {
        const before = structuredClone(store.value);
        const forward = prepare(8);
        expect(isMidiRowCoordinateCapture(JSON.parse(JSON.stringify(forward.capture)))).toBe(true);
        expect(store.set).not.toHaveBeenCalled();
        expect(forward.apply()).toBe(true);
        expect(store.set).toHaveBeenCalledTimes(1);
        expect(store.value).toEqual(rowsAt(8.1));
        const inverse = prepare(-8, JSON.parse(JSON.stringify(forward.capture)));
        expect(inverse.apply()).toBe(true);
        expect(store.value).toEqual(before);
    });

    it('keeps current membership and properties while restoring unchanged rows and translating peer edits', () => {
        const forward = prepare(8);
        expect(forward.apply()).toBe(true);
        const current = rowsAt(8.1);
        current.notesByClipId.clip![0]!.velocity = 42;
        current.notesByClipId.clip![0]!.expression = { pressure: [{ offsetBeats: 0.125, value: 0.5 }] };
        current.ccByClipId.clip = [];
        current.pitchBendByClipId.clip![0]!.beat = 9.25;
        current.pitchBendByClipId.clip!.push({ id: 'added', beat: 10.5, value: -1024, channel: 4 });
        current.notesByClipId.other = [{ id: 'other', startBeat: 99, pitch: 70, duration: 1, velocity: 50 }];
        store.value = current;
        expect(prepare(-8, forward.capture).apply()).toBe(true);
        expect(store.value?.notesByClipId.clip).toEqual([{ ...current.notesByClipId.clip![0], startBeat: 0.1 }]);
        expect(store.value?.ccByClipId.clip).toEqual([]);
        expect(store.value?.pitchBendByClipId.clip).toEqual([
            { id: 'bend', beat: 1.25, value: 1024, channel: 3 },
            { id: 'added', beat: 2.5, value: -1024, channel: 4 },
        ]);
        expect(store.value?.notesByClipId.other).toBe(current.notesByClipId.other);
    });

    it.each(['coordinate', 'property', 'membership'] as const)(
        'refuses stale preparation after a peer %s edit',
        (edit) => {
            const prepared = prepare(8);
            const peer = rowsAt(0.1);
            if (edit === 'coordinate') peer.notesByClipId.clip![0]!.startBeat = 1.25;
            if (edit === 'property') peer.notesByClipId.clip![0]!.velocity = 42;
            if (edit === 'membership') peer.ccByClipId.clip = [];
            store.value = peer;
            expect(prepared.apply()).toBe(false);
            expect(store.value).toBe(peer);
            expect(store.set).not.toHaveBeenCalled();
        }
    );

    it.each([{}, { beatDelta: 8, coordinates: [{ kind: 'note', id: 'note', beforeBeat: 0.1, afterBeat: 99 }] }])(
        'refuses malformed persisted capture before any write',
        (restore) => {
            expect(isMidiRowCoordinateCapture(restore)).toBe(false);
            expect(prepareClipMidiRowCoordinateShift({ clipId: 'clip', beatDelta: -8, restore }).status).toBe(
                'refused'
            );
            expect(store.value).toEqual(rowsAt(0.1));
            expect(store.set).not.toHaveBeenCalled();
        }
    );

    it('refuses the entire plan when the final lane overflows', () => {
        store.value!.pitchBendByClipId.clip![0]!.beat = Number.MAX_VALUE;
        const before = structuredClone(store.value);
        expect(prepareClipMidiRowCoordinateShift({ clipId: 'clip', beatDelta: Number.MAX_VALUE })).toEqual({
            status: 'refused',
            reason: 'coordinate-overflow',
        });
        expect(store.value).toEqual(before);
        expect(store.set).not.toHaveBeenCalled();
    });

    it('creates no lists for an absent clip or null store and writes nothing for a zero shift', () => {
        store.value = { probabilitySeed: 123, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        expect(prepare(8).apply()).toBe(true);
        store.value = null;
        expect(prepare(8).apply()).toBe(true);
        store.value = rowsAt(0.1);
        expect(prepare(0).apply()).toBe(true);
        expect(store.set).not.toHaveBeenCalled();
    });
});
