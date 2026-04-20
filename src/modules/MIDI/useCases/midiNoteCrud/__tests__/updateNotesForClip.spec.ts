import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateNotesForClip } from '../updateNotesForClip';

const mocks = vi.hoisted(() => ({
    midiStoreValue: {
        value: {
            notesByClipId: {} as Record<string, { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[]>,
            ccByClipId: {},
            pitchBendByClipId: {},
        },
    },
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

describe('updateNotesForClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('should not write when the MIDI store is null', () => {
        mocks.midiStoreValue.value = null as any;

        updateNotesForClip('c1', (notes) => notes);

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should not write when the clip has no notes in the store', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        updateNotesForClip('c1', (notes) => notes);

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should apply the updater and write back notes for the clip', () => {
        updateNotesForClip('c1', (notes) => notes.map((n) => ({ ...n, velocity: 50 })));

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                notesByClipId: expect.objectContaining({
                    c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 50 }],
                }),
            })
        );
    });
});
