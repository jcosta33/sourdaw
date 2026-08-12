import { describe, it, expect, beforeEach } from 'vitest';

import { midiLearnStore } from '../../../stores/midiLearnStore';
import { completeMidiLearn } from '../completeMidiLearn';

describe('completeMidiLearn', () => {
    beforeEach(() => {
        midiLearnStore.set({ mappings: [], isLearning: false, learningTarget: null });
    });

    it('does nothing when the store is not currently learning', () => {
        completeMidiLearn(0, 7);

        expect(midiLearnStore.value?.mappings).toEqual([]);
    });

    it('creates a new mapping for the armed target and defaults the log taper for trackGain (F-2)', () => {
        midiLearnStore.set({
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        completeMidiLearn(1, 74);

        const mappings = midiLearnStore.value?.mappings ?? [];
        expect(mappings).toHaveLength(1);
        expect(mappings[0]).toMatchObject({
            channel: 1,
            cc: 74,
            targetType: 'trackGain',
            trackId: 'track1',
            minValue: 0,
            maxValue: 1,
            scaleMode: 'log',
        });
    });

    it('uses a linear range for trackPan', () => {
        midiLearnStore.set({
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackPan', trackId: 'track1' },
        });

        completeMidiLearn(0, 10);

        expect(midiLearnStore.value?.mappings[0]).toMatchObject({
            targetType: 'trackPan',
            minValue: -50,
            maxValue: 50,
            scaleMode: 'linear',
        });
    });

    it('exits learning mode after completing', () => {
        midiLearnStore.set({
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        completeMidiLearn(0, 7);

        expect(midiLearnStore.value?.isLearning).toBe(false);
        expect(midiLearnStore.value?.learningTarget).toBeNull();
    });

    it('replaces an existing mapping bound to the same channel/cc pair rather than duplicating it', () => {
        midiLearnStore.set({
            mappings: [
                {
                    id: 'existing',
                    channel: 0,
                    cc: 7,
                    targetType: 'trackPan',
                    trackId: 'other-track',
                    minValue: -50,
                    maxValue: 50,
                },
            ],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        completeMidiLearn(0, 7);

        const mappings = midiLearnStore.value?.mappings ?? [];
        expect(mappings).toHaveLength(1);
        expect(mappings[0]?.targetType).toBe('trackGain');
        expect(mappings[0]?.trackId).toBe('track1');
    });
});
