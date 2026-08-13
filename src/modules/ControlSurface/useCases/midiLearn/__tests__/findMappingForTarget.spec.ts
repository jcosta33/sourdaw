import { describe, it, expect, beforeEach } from 'vitest';

import { midiLearnStore } from '../../../stores/midiLearnStore';
import { findMappingForTarget } from '../findMappingForTarget';

describe('findMappingForTarget', () => {
    beforeEach(() => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: false,
            learningTarget: null,
        });
    });

    it('should return undefined when the store value is null', () => {
        midiLearnStore.set(null);
        expect(findMappingForTarget({ targetType: 'trackGain', trackId: 't1' })).toBeUndefined();
    });

    it('should return undefined when no mapping matches', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [
                {
                    id: 'm1',
                    channel: 0,
                    cc: 1,
                    targetType: 'trackPan',
                    trackId: 't1',
                    minValue: 0,
                    maxValue: 1,
                },
            ],
            isLearning: false,
            learningTarget: null,
        });

        expect(findMappingForTarget({ targetType: 'trackGain', trackId: 't1' })).toBeUndefined();
    });

    it('should return the mapping when target fields match', () => {
        const mapping = {
            id: 'm1',
            channel: 1,
            cc: 7,
            targetType: 'deviceParam' as const,
            trackId: 't1',
            deviceId: 'd1',
            paramId: 'cutoff',
            minValue: 0,
            maxValue: 1,
        };
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [mapping],
            isLearning: false,
            learningTarget: null,
        });

        expect(
            findMappingForTarget({
                targetType: 'deviceParam',
                trackId: 't1',
                deviceId: 'd1',
                paramId: 'cutoff',
            })
        ).toBe(mapping);
    });
});
