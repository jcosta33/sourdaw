import { beforeEach, describe, expect, it } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { restorePitchBend } from '../restorePitchBend';

describe('restorePitchBend', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: { c1: [{ id: 'pb-a', value: 0, beat: 0, channel: 0 }] },
        });
    });

    it('puts a removed row back whole, its id and channel-scoped mark included', () => {
        const removed = { id: 'pb-b', value: 100, beat: 1, channel: 2, channelScoped: true };

        restorePitchBend('c1', removed);

        expect(midiStore.value?.pitchBendByClipId.c1).toEqual([{ id: 'pb-a', value: 0, beat: 0, channel: 0 }, removed]);
    });

    it('starts the clip’s list when it holds none', () => {
        restorePitchBend('c2', { id: 'pb-c', value: 5, beat: 0, channel: 0 });

        expect(midiStore.value?.pitchBendByClipId.c2).toEqual([{ id: 'pb-c', value: 5, beat: 0, channel: 0 }]);
    });

    it('refuses to restore into an uninitialised store', () => {
        midiStore.set(null);

        expect(() => restorePitchBend('c1', { id: 'pb-d', value: 1, beat: 0, channel: 0 })).toThrow();
    });
});
