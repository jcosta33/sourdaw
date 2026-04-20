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
        mocks.midiStoreValue.value = { notesByClipId: { c1: mockNotes } } as any;

        strumNotes('c1', ['nHigh', 'nMid', 'nLow'], 0.1, 'up');

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const updated = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;

        // Sort order for 'up': Low(60) -> Mid(64) -> High(72)
        // Offsets: Low: 0*0.1=0, Mid: 1*0.1=0.1, High: 2*0.1=0.2
        const nLow = updated.find((n: any) => n.id === 'nLow');
        const nMid = updated.find((n: any) => n.id === 'nMid');
        const nHigh = updated.find((n: any) => n.id === 'nHigh');

        expect(nLow.startBeat).toBe(4.0);
        expect(nMid.startBeat).toBe(4.1);
        expect(nHigh.startBeat).toBe(4.2);
    });

    it('offsets notes in reverse pitch order for "down" direction', () => {
        const mockNotes = [
            { id: 'nHigh', pitch: 72, startBeat: 0 },
            { id: 'nLow', pitch: 60, startBeat: 0 },
        ];
        mocks.midiStoreValue.value = { notesByClipId: { c1: mockNotes } } as any;

        strumNotes('c1', ['nHigh', 'nLow'], 0.05, 'down');

        const updated = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;
        // Sort order for 'down': High(72) -> Low(60)
        // Offsets: High: 0, Low: 0.05
        const nHigh = updated.find((n: any) => n.id === 'nHigh');
        const nLow = updated.find((n: any) => n.id === 'nLow');

        expect(nHigh.startBeat).toBe(0);
        expect(nLow.startBeat).toBe(0.05);
    });

    it('bails if less than 2 notes provided', () => {
        mocks.midiStoreValue.value = { notesByClipId: { c1: [{ id: 'n1' }] } } as any;
        expect(strumNotes('c1', ['n1'])).toBeNull();
    });
});
