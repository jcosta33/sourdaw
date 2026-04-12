import { describe, it, expect, beforeEach } from 'vitest';
import { midiLearnStore } from '../../stores/midiLearnStore';
import { getMidiLearnState } from '../getMidiLearnState';

describe('getMidiLearnState', () => {
    beforeEach(() => {
        midiLearnStore.set({
            mappings: [],
            isLearning: false,
            learningTarget: null,
        });
    });

    it('should return the current MIDI learn store snapshot', () => {
        const next = {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
        midiLearnStore.set(next);
        expect(getMidiLearnState()).toBe(next);
    });

    it('should return null when the store is not initialized', () => {
        midiLearnStore.set(null);
        expect(getMidiLearnState()).toBeNull();
    });
});
