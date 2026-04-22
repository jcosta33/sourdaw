import { describe, it, expect, vi, beforeEach } from 'vitest';

import { restoreGrooveOriginals } from '../restoreGrooveOriginals';

type MidiStoreValue = {
    notesByClipId: Record<string, { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[]>;
    ccByClipId: Record<string, unknown>;
    pitchBendByClipId: Record<string, unknown>;
};

const mocks = vi.hoisted(() => ({
    midiStoreValue: {
        value: {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        } as MidiStoreValue | null,
    },
    midiStoreSet: vi.fn<(newState: MidiStoreValue) => void>(),
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('restoreGrooveOriginals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 80 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('should not write when the MIDI store is null', () => {
        mocks.midiStoreValue.value = null;

        restoreGrooveOriginals('c1', new Map([['n1', { startBeat: 0, velocity: 100 }]]));

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should not write when the clip has no notes', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        restoreGrooveOriginals('c1', new Map());

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should restore startBeat and velocity from the originals map', () => {
        const originals = new Map([['n1', { startBeat: 0, velocity: 100 }]]);

        restoreGrooveOriginals('c1', originals);

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                notesByClipId: expect.objectContaining({
                    c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                }),
            })
        );
    });
});
