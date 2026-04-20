import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeNotesByIds } from '../removeNotesByIds';

const mocks = vi.hoisted(() => ({
    midiStoreValue: {
        value: {
            notesByClipId: {} as Record<string, { id: string }[]>,
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

describe('removeNotesByIds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [
                    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    { id: 'n2', pitch: 62, startBeat: 1, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('should not write when the MIDI store is null', () => {
        mocks.midiStoreValue.value = null as any;
        removeNotesByIds('c1', ['n1']);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should remove only the listed note ids for the clip', () => {
        removeNotesByIds('c1', ['n1']);

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                notesByClipId: expect.objectContaining({
                    c1: [{ id: 'n2', pitch: 62, startBeat: 1, duration: 1, velocity: 100 }],
                }),
            })
        );
    });
});
