import { describe, it, expect, beforeEach } from 'vitest';

import { midiLearnStore, type MidiMapping } from '../../../stores/midiLearnStore';
import { stopMidiLearn } from '../stopMidiLearn';

const existingMapping: MidiMapping = {
    id: 'm1',
    channel: 0,
    cc: 7,
    targetType: 'trackGain',
    trackId: 'track1',
    minValue: 0,
    maxValue: 1,
};

describe('stopMidiLearn', () => {
    beforeEach(() => {
        midiLearnStore.set({
            mappings: [existingMapping],
            isLearning: true,
            learningTarget: { targetType: 'trackPan', trackId: 'track2' },
        });
    });

    it('clears isLearning and learningTarget', () => {
        stopMidiLearn();

        expect(midiLearnStore.value?.isLearning).toBe(false);
        expect(midiLearnStore.value?.learningTarget).toBeNull();
    });

    it('leaves existing mappings untouched', () => {
        stopMidiLearn();

        expect(midiLearnStore.value?.mappings).toEqual([existingMapping]);
    });

    it('does nothing when the store has no state', () => {
        midiLearnStore.set(null);

        stopMidiLearn();

        expect(midiLearnStore.value).toBeNull();
    });
});
