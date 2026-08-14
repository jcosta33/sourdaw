import { describe, it, expect, beforeEach } from 'vitest';

import { midiLearnStore, type MidiMapping } from '../../../stores/midiLearnStore';
import { clearAllMappings } from '../clearAllMappings';

const sampleMapping: MidiMapping = {
    id: 'm1',
    channel: 0,
    cc: 7,
    targetType: 'trackGain',
    trackId: 'track1',
    minValue: 0,
    maxValue: 1,
    scaleMode: 'log',
};

describe('clearAllMappings', () => {
    beforeEach(() => {
        midiLearnStore.set({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });
    });

    it('empties every mapping in one call', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [sampleMapping, { ...sampleMapping, id: 'm2', cc: 8 }],
            isLearning: false,
            learningTarget: null,
        });

        clearAllMappings();

        expect(midiLearnStore.value?.mappings).toEqual([]);
    });

    it('cancels any in-progress learn so a stale target cannot capture the next CC', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [sampleMapping],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        clearAllMappings();

        expect(midiLearnStore.value?.isLearning).toBe(false);
        expect(midiLearnStore.value?.learningTarget).toBeNull();
        expect(midiLearnStore.value?.mappings).toEqual([]);
    });

    it('is a no-op when there is nothing to clear', () => {
        midiLearnStore.set({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });
        const before = midiLearnStore.value;

        clearAllMappings();

        expect(midiLearnStore.value).toBe(before);
    });
});
