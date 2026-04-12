import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores/midiStore';

import { removePitchBend } from '../removePitchBend';

describe('removePitchBend', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {
                c1: [
                    { id: 'pb-a', value: 0, beat: 0, channel: 0 },
                    { id: 'pb-b', value: 100, beat: 1, channel: 0 },
                ],
            },
        });
    });

    it('should remove only the pitch bend with the given id', () => {
        removePitchBend('c1', 'pb-a');
        expect(midiStore.value?.pitchBendByClipId.c1?.map((p) => p.id)).toEqual(['pb-b']);
    });

    it('should not mutate when the clip or store is missing', () => {
        removePitchBend('missing', 'x');
        midiStore.set(null);
        removePitchBend('c1', 'pb-a');
        expect(midiStore.value).toBeNull();
    });
});
