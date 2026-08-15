import { describe, it, expect, vi, beforeEach } from 'vitest';

import { strumNotes } from '../strumNotes';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {} } },
    midiStoreSet: vi.fn(),
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('strumNotes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('offsets notes in pitch order for "up" direction', () => {
        const mockNotes = [
            { id: 'nHigh', pitch: 72, startBeat: 4 },
            { id: 'nMid', pitch: 64, startBeat: 4 },
            { id: 'nLow', pitch: 60, startBeat: 4 },
        ];
        mocks.midiStoreValue.value = { notesByClipId: { c1: mockNotes } };

        strumNotes('c1', ['nHigh', 'nMid', 'nLow'], 0.1, 'up');

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.midiStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('Expected midiStore.set call');
        }
        const updated = setCall[0].notesByClipId.c1;

        // Sort order for 'up': Low(60) -> Mid(64) -> High(72)
        // Offsets: Low: 0*0.1=0, Mid: 1*0.1=0.1, High: 2*0.1=0.2
        const nLow = updated.find((node: any) => node.id === 'nLow');
        const nMid = updated.find((node: any) => node.id === 'nMid');
        const nHigh = updated.find((node: any) => node.id === 'nHigh');

        expect(nLow.startBeat).toBe(4.0);
        expect(nMid.startBeat).toBe(4.1);
        expect(nHigh.startBeat).toBe(4.2);
    });

    it('offsets notes in reverse pitch order for "down" direction', () => {
        const mockNotes = [
            { id: 'nHigh', pitch: 72, startBeat: 0 },
            { id: 'nLow', pitch: 60, startBeat: 0 },
        ];
        mocks.midiStoreValue.value = { notesByClipId: { c1: mockNotes } };

        strumNotes('c1', ['nHigh', 'nLow'], 0.05, 'down');

        const setCall = mocks.midiStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('Expected midiStore.set call');
        }
        const updated = setCall[0].notesByClipId.c1;
        // Sort order for 'down': High(72) -> Low(60)
        // Offsets: High: 0, Low: 0.05
        const nHigh = updated.find((node: any) => node.id === 'nHigh');
        const nLow = updated.find((node: any) => node.id === 'nLow');

        expect(nHigh.startBeat).toBe(0);
        expect(nLow.startBeat).toBe(0.05);
    });

    it('replays the same random offsets for a repeated seed', () => {
        // Undo/redo re-invokes the transform. With raw Math.random() the redo
        // produced a different strum than the apply it was replaying.
        const notes = [
            { id: 'n1', pitch: 60, startBeat: 0 },
            { id: 'n2', pitch: 64, startBeat: 0 },
            { id: 'n3', pitch: 67, startBeat: 0 },
        ];
        mocks.midiStoreValue.value = { notesByClipId: { c1: notes } };

        strumNotes('c1', ['n1', 'n2', 'n3'], 0.1, 'random', 4242);
        mocks.midiStoreValue.value = { notesByClipId: { c1: notes } };
        strumNotes('c1', ['n1', 'n2', 'n3'], 0.1, 'random', 4242);

        const [firstCall, secondCall] = mocks.midiStoreSet.mock.calls;
        if (!firstCall || !secondCall) {
            throw new Error('Expected two midiStore.set calls');
        }
        const beatsOf = (call: unknown[]): number[] =>
            (call[0] as { notesByClipId: Record<string, { startBeat: number }[]> }).notesByClipId.c1!.map(
                (node) => node.startBeat
            );

        expect(beatsOf(secondCall)).toEqual(beatsOf(firstCall));
    });

    it('produces different random offsets for different seeds', () => {
        // Guards the opposite failure: a seed parameter that is accepted and
        // then ignored would satisfy the replay test above on its own.
        const notes = [
            { id: 'n1', pitch: 60, startBeat: 0 },
            { id: 'n2', pitch: 64, startBeat: 0 },
            { id: 'n3', pitch: 67, startBeat: 0 },
        ];
        mocks.midiStoreValue.value = { notesByClipId: { c1: notes } };

        strumNotes('c1', ['n1', 'n2', 'n3'], 0.1, 'random', 1);
        mocks.midiStoreValue.value = { notesByClipId: { c1: notes } };
        strumNotes('c1', ['n1', 'n2', 'n3'], 0.1, 'random', 2);

        const [firstCall, secondCall] = mocks.midiStoreSet.mock.calls;
        if (!firstCall || !secondCall) {
            throw new Error('Expected two midiStore.set calls');
        }
        const beatsOf = (call: unknown[]): number[] =>
            (call[0] as { notesByClipId: Record<string, { startBeat: number }[]> }).notesByClipId.c1!.map(
                (node) => node.startBeat
            );

        expect(beatsOf(secondCall)).not.toEqual(beatsOf(firstCall));
    });

    it('bails if less than 2 notes provided', () => {
        mocks.midiStoreValue.value = { notesByClipId: { c1: [{ id: 'n1' }] } };
        expect(strumNotes('c1', ['n1'])).toBeNull();
    });
});
