import { describe, it, expect, vi, beforeEach } from 'vitest';

import { restoreStrumOriginals } from '../restoreStrumOriginals';

import type { MidiStoreState, MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    midiStoreValue: {
        value: {
            notesByClipId: {} as Record<string, { id: string; startBeat: number }[]>,
            ccByClipId: {},
            pitchBendByClipId: {},
        } as unknown as MidiStoreStateInput,
    },
    midiStoreSet: vi.fn<typeof import('../../../stores/midiStore').midiStore.set>(),
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('restoreStrumOriginals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('should not write when the MIDI store is null', () => {
        mocks.midiStoreValue.value = null as unknown as MidiStoreStateInput;
        restoreStrumOriginals('c1', new Map([['n1', 0]]));
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should restore startBeat from the originals map', () => {
        restoreStrumOriginals('c1', new Map([['n1', 0]]));

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                notesByClipId: expect.objectContaining({
                    c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                }) as unknown as MidiStoreState['notesByClipId'],
            })
        );
    });
});
