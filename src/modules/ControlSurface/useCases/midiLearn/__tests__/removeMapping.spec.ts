import { describe, it, expect, beforeEach } from 'vitest';

import { midiLearnStore, type MidiMapping } from '../../../stores/midiLearnStore';
import { removeMapping } from '../removeMapping';

const mappingA: MidiMapping = {
    id: 'm1',
    channel: 0,
    cc: 7,
    targetType: 'trackGain',
    trackId: 'track1',
    minValue: 0,
    maxValue: 1,
    scaleMode: 'log',
};

const mappingB: MidiMapping = {
    id: 'm2',
    channel: 0,
    cc: 8,
    targetType: 'trackPan',
    trackId: 'track1',
    minValue: -50,
    maxValue: 50,
};

describe('removeMapping', () => {
    beforeEach(() => {
        midiLearnStore.set({ mappings: [mappingA, mappingB], isLearning: false, learningTarget: null });
    });

    it('removes only the mapping with the matching id', () => {
        removeMapping('m1');

        expect(midiLearnStore.value?.mappings).toEqual([mappingB]);
    });

    it('is a no-op when no mapping has that id', () => {
        removeMapping('does-not-exist');

        expect(midiLearnStore.value?.mappings).toEqual([mappingA, mappingB]);
    });

    it('does not touch isLearning or learningTarget', () => {
        midiLearnStore.set({
            mappings: [mappingA, mappingB],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track2' },
        });

        removeMapping('m1');

        expect(midiLearnStore.value?.isLearning).toBe(true);
        expect(midiLearnStore.value?.learningTarget).toEqual({ targetType: 'trackGain', trackId: 'track2' });
    });

    it('does nothing when the store has no state', () => {
        midiLearnStore.set(null);

        removeMapping('m1');

        expect(midiLearnStore.value).toBeNull();
    });
});
