import { describe, expect, it } from 'vitest';

import { isCapturedByMidiLearn, type MidiLearnSnapshot } from '../isCapturedByMidiLearn';
import { admitsRecordedControlChange } from '../recordedControlChangeAdmission';

const idle: MidiLearnSnapshot = null;

const learning: MidiLearnSnapshot = {
    mappingsSchemaVersion: 1,
    mappings: [],
    isLearning: true,
    learningTarget: { targetType: 'trackPan', trackId: 'track-1' },
};

const pedalPanMapping = {
    id: 'mapping-1',
    channel: 2,
    cc: 64,
    targetType: 'trackPan' as const,
    trackId: 'track-1',
    minValue: -50,
    maxValue: 50,
};

function mappingOf(channel: number, cc: number): MidiLearnSnapshot {
    return {
        mappingsSchemaVersion: 1,
        mappings: [{ ...pedalPanMapping, channel, cc }],
        isLearning: false,
        learningTarget: null,
    };
}

const mapped = mappingOf(2, 64);

const sustain = { learnState: idle, mpeEnabled: false, channel: 0, cc: 64, resolvedCc: 64, consumed: false };

describe('recordedControlChangeAdmission', () => {
    it('admits an ordinary controller', () => {
        expect(admitsRecordedControlChange(sustain)).toBe(true);
    });

    it('keeps out a controller MIDI learn is waiting to capture', () => {
        expect(isCapturedByMidiLearn(learning)).toBe(true);
        expect(admitsRecordedControlChange({ ...sustain, learnState: learning })).toBe(false);
    });

    it('does not treat armed learning without a target as a capture', () => {
        expect(isCapturedByMidiLearn({ ...learning, learningTarget: null })).toBe(false);
    });

    it('keeps out a controller a learned mapping owns, on that channel only', () => {
        expect(admitsRecordedControlChange({ ...sustain, learnState: mapped, channel: 2 })).toBe(false);
        expect(admitsRecordedControlChange({ ...sustain, learnState: mapped, channel: 3 })).toBe(true);
    });

    it('matches a mapping against the resolved controller of a 14-bit pair', () => {
        expect(admitsRecordedControlChange({ ...sustain, learnState: mappingOf(0, 7), cc: 39, resolvedCc: 7 })).toBe(
            false
        );
    });

    it('admits a message the RPN state machine consumed even where a mapping names its number', () => {
        expect(
            admitsRecordedControlChange({
                ...sustain,
                learnState: mappingOf(0, 6),
                cc: 6,
                resolvedCc: 6,
                consumed: true,
            })
        ).toBe(true);
    });

    it('keeps out the channel-mode range', () => {
        expect(admitsRecordedControlChange({ ...sustain, cc: 121, resolvedCc: 121 })).toBe(false);
    });

    it('keeps out the MPE slide on a member channel only', () => {
        const slide = { ...sustain, mpeEnabled: true, cc: 74, resolvedCc: 74 };

        expect(admitsRecordedControlChange({ ...slide, channel: 1 })).toBe(false);
        expect(admitsRecordedControlChange({ ...slide, channel: 0 })).toBe(true);
        expect(admitsRecordedControlChange({ ...slide, mpeEnabled: false, channel: 1 })).toBe(true);
    });
});
