import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../stores/midiLearnStore', () => ({
    midiLearnStore: {
        get value() {
            return mockValue;
        },
        set: vi.fn((state: MidiLearnState | null) => {
            mockValue = state;
        }),
    },
}));

import { midiLearnStore } from '../../../stores/midiLearnStore';
import {
    handleCompleteMidiLearn,
    handleRemoveMidiMapping,
    handleRestoreMidiLearnMappings,
} from '../handleRestoreMidiLearnMappings';

import type { MidiLearnState, MidiMapping } from '../../../stores/midiLearnStore';

const mockedSet = vi.mocked(midiLearnStore.set);

let mockValue: MidiLearnState | null = null;

function setState(state: MidiLearnState | null): void {
    mockValue = state;
}

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

beforeEach(() => {
    vi.clearAllMocks();
    mockValue = { mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null };
});

describe('handleCompleteMidiLearn — execute', () => {
    it('creates a new mapping for the armed target and defaults the log taper for trackGain (F-2)', () => {
        setState({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        void handleCompleteMidiLearn.execute({
            type: 'completeMidiLearn',
            payload: { channel: 1, cc: 74, mappingId: 'new-id' },
        });

        expect(mockedSet).toHaveBeenCalledTimes(1);
        const written = mockedSet.mock.calls[0]?.[0] as MidiLearnState;
        expect(written.mappings).toEqual([
            {
                id: 'new-id',
                channel: 1,
                cc: 74,
                targetType: 'trackGain',
                trackId: 'track1',
                minValue: 0,
                maxValue: 1,
                scaleMode: 'log',
            },
        ]);
        expect(written.isLearning).toBe(false);
        expect(written.learningTarget).toBeNull();
    });

    it('uses a linear range for trackPan', () => {
        setState({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackPan', trackId: 'track1' },
        });

        void handleCompleteMidiLearn.execute({
            type: 'completeMidiLearn',
            payload: { channel: 0, cc: 10, mappingId: 'x' },
        });

        const written = mockedSet.mock.calls[0]?.[0] as MidiLearnState;
        expect(written.mappings[0]).toMatchObject({
            targetType: 'trackPan',
            minValue: -50,
            maxValue: 50,
            scaleMode: 'linear',
        });
    });

    it('replaces an existing mapping bound to the same channel/cc pair rather than duplicating it', () => {
        setState({
            mappingsSchemaVersion: 1,
            mappings: [{ ...mappingB, channel: 0, cc: 7 }],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        void handleCompleteMidiLearn.execute({
            type: 'completeMidiLearn',
            payload: { channel: 0, cc: 7, mappingId: 'new-id' },
        });

        const written = mockedSet.mock.calls[0]?.[0] as MidiLearnState;
        expect(written.mappings).toHaveLength(1);
        expect(written.mappings[0]?.targetType).toBe('trackGain');
        expect(written.mappings[0]?.trackId).toBe('track1');
    });

    it('returns no-write and does not touch the store when not currently learning', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });

        const result = handleCompleteMidiLearn.execute({
            type: 'completeMidiLearn',
            payload: { channel: 0, cc: 7, mappingId: 'x' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mockedSet).not.toHaveBeenCalled();
    });
});

describe('handleCompleteMidiLearn — describe / isNoop', () => {
    it('snapshots the pre-mutation mappings as the inverse restore replacement', () => {
        setState({
            mappingsSchemaVersion: 1,
            mappings: [mappingA],
            isLearning: true,
            learningTarget: { targetType: 'trackPan', trackId: 'track2' },
        });

        const result = handleCompleteMidiLearn.describe({
            type: 'completeMidiLearn',
            payload: { channel: 2, cc: 20, mappingId: 'new-id' },
        });

        expect(result.inverseAction?.type).toBe('restoreMidiLearnMappings');
        const payload = (
            result.inverseAction as unknown as {
                payload: { expected: { mappings: MidiMapping[] }; replacement: { mappings: MidiMapping[] } };
            }
        ).payload;
        expect(payload.replacement.mappings).toEqual([mappingA]);
        expect(payload.expected.mappings).toEqual([
            mappingA,
            {
                id: 'new-id',
                channel: 2,
                cc: 20,
                targetType: 'trackPan',
                trackId: 'track2',
                minValue: -50,
                maxValue: 50,
                scaleMode: 'linear',
            },
        ]);
    });

    it('isNoop is true when not currently learning', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });
        expect(
            handleCompleteMidiLearn.isNoop?.({
                type: 'completeMidiLearn',
                payload: { channel: 0, cc: 1, mappingId: 'x' },
            })
        ).toBe(true);
    });

    it('isNoop is false when armed', () => {
        setState({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain' },
        });
        expect(
            handleCompleteMidiLearn.isNoop?.({
                type: 'completeMidiLearn',
                payload: { channel: 0, cc: 1, mappingId: 'x' },
            })
        ).toBe(false);
    });
});

describe('handleRemoveMidiMapping — execute', () => {
    it('removes only the mapping with the matching id', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [mappingA, mappingB], isLearning: false, learningTarget: null });

        void handleRemoveMidiMapping.execute({ type: 'removeMidiMapping', payload: { mappingId: 'm1' } });

        const written = mockedSet.mock.calls[0]?.[0] as MidiLearnState;
        expect(written.mappings).toEqual([mappingB]);
    });

    it('does not touch isLearning or learningTarget', () => {
        setState({
            mappingsSchemaVersion: 1,
            mappings: [mappingA, mappingB],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track2' },
        });

        void handleRemoveMidiMapping.execute({ type: 'removeMidiMapping', payload: { mappingId: 'm1' } });

        const written = mockedSet.mock.calls[0]?.[0] as MidiLearnState;
        expect(written.isLearning).toBe(true);
        expect(written.learningTarget).toEqual({ targetType: 'trackGain', trackId: 'track2' });
    });

    it('returns no-write when no mapping has that id', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [mappingA, mappingB], isLearning: false, learningTarget: null });

        const result = handleRemoveMidiMapping.execute({ type: 'removeMidiMapping', payload: { mappingId: 'nope' } });

        expect(result).toEqual({ status: 'no-write' });
        expect(mockedSet).not.toHaveBeenCalled();
    });

    it('returns no-write when the store has no state', () => {
        setState(null);

        const result = handleRemoveMidiMapping.execute({ type: 'removeMidiMapping', payload: { mappingId: 'm1' } });

        expect(result).toEqual({ status: 'no-write' });
    });
});

describe('handleRemoveMidiMapping — isNoop', () => {
    it('is true when the mapping does not exist', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [mappingA], isLearning: false, learningTarget: null });
        expect(handleRemoveMidiMapping.isNoop?.({ type: 'removeMidiMapping', payload: { mappingId: 'nope' } })).toBe(
            true
        );
    });

    it('is false when the mapping exists', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [mappingA], isLearning: false, learningTarget: null });
        expect(handleRemoveMidiMapping.isNoop?.({ type: 'removeMidiMapping', payload: { mappingId: 'm1' } })).toBe(
            false
        );
    });
});

describe('handleRestoreMidiLearnMappings — execute', () => {
    it('writes replacement when current mappings match expected', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [mappingA], isLearning: false, learningTarget: null });

        const result = handleRestoreMidiLearnMappings.execute({
            type: 'restoreMidiLearnMappings',
            payload: { expected: { mappings: [mappingA] }, replacement: { mappings: [mappingA, mappingB] } },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mockedSet).toHaveBeenCalledTimes(1);
        const written = mockedSet.mock.calls[0]?.[0] as MidiLearnState;
        expect(written.mappings).toEqual([mappingA, mappingB]);
    });

    it('returns conflict and does not write when current mappings drifted from expected', () => {
        setState({ mappingsSchemaVersion: 1, mappings: [mappingA, mappingB], isLearning: false, learningTarget: null });

        const result = handleRestoreMidiLearnMappings.execute({
            type: 'restoreMidiLearnMappings',
            payload: { expected: { mappings: [mappingA] }, replacement: { mappings: [] } },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mockedSet).not.toHaveBeenCalled();
    });
});

describe('handleRestoreMidiLearnMappings — describe', () => {
    it('returns inverse action with swapped expected/replacement', () => {
        const expected = { mappings: [mappingA] };
        const replacement = { mappings: [mappingA, mappingB] };

        const result = handleRestoreMidiLearnMappings.describe({
            type: 'restoreMidiLearnMappings',
            payload: { expected, replacement },
        });

        expect(result.label).toBe('Restore MIDI mappings');
        const inversePayload = (
            result.inverseAction as unknown as {
                payload: { expected: { mappings: MidiMapping[] }; replacement: { mappings: MidiMapping[] } };
            }
        ).payload;
        expect(inversePayload.expected).toEqual(replacement);
        expect(inversePayload.replacement).toEqual(expected);
    });
});
