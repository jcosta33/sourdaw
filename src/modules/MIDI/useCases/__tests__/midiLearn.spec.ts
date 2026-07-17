import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Logger } from '#/infra/logger/types';

import { midiLearnStore } from '../../stores/midiLearnStore';
import { type MidiLearnState } from '../../stores/midiLearnStore';
import { completeMidiLearn } from '../midiLearn/completeMidiLearn';
import { findMappingForTarget } from '../midiLearn/findMappingForTarget';
import { scaleMidiValue } from '../midiLearn/scaleMidiValue';
import { startMidiLearn } from '../midiLearn/startMidiLearn';
import { stopMidiLearn } from '../midiLearn/stopMidiLearn';

const mocks = vi.hoisted(() => {
    const state: { value: MidiLearnState | null } = {
        value: {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        },
    };
    const set = vi.fn<(next: MidiLearnState | null) => void>((next) => {
        state.value = next;
    });
    return { state, set };
});

vi.mock('../../stores/midiLearnStore', () => ({
    midiLearnStore: {
        get value() {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

describe('midiLearn injectables', () => {
    beforeEach(() => {
        vi.mocked(midiLearnStore.set).mockClear();
        mocks.state.value = {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
    });

    it('should not update store when startMidiLearn finds no store state', () => {
        mocks.state.value = null;

        const logger = createMock<Logger>();
        injectDependencies(startMidiLearn, { logger });

        startMidiLearn({
            targetType: 'fermenterGlobalParam',
            trackId: 'global',
            paramId: 'p1',
        });

        expect(midiLearnStore.set).not.toHaveBeenCalled();
    });

    it('should set learning state when startMidiLearn runs', () => {
        const logger = createMock<Logger>();
        injectDependencies(startMidiLearn, { logger });

        startMidiLearn({
            targetType: 'fermenterGlobalParam',
            trackId: 'global',
            paramId: 'p1',
        });

        expect(logger.info).toHaveBeenCalled();
        expect(midiLearnStore.set).toHaveBeenCalledOnce();
        expect(midiLearnStore.value?.isLearning).toBe(true);
        expect(midiLearnStore.value?.learningTarget).toEqual({
            targetType: 'fermenterGlobalParam',
            trackId: 'global',
            paramId: 'p1',
        });
    });

    it('should clear learning state when stopMidiLearn runs', () => {
        mocks.state.value = {
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'fermenterGlobalParam',
                trackId: 'global',
                paramId: 'p1',
            },
        };

        const logger = createMock<Logger>();
        injectDependencies(stopMidiLearn, { logger });

        stopMidiLearn();

        expect(midiLearnStore.set).toHaveBeenCalledWith(
            expect.objectContaining({
                isLearning: false,
                learningTarget: null,
            })
        );
    });

    it('should not persist mapping when completeMidiLearn runs without active learning', () => {
        mocks.state.value = {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };

        const logger = createMock<Logger>();
        injectDependencies(completeMidiLearn, { logger });

        completeMidiLearn(1, 7);

        expect(midiLearnStore.set).not.toHaveBeenCalled();
    });

    it('should append a new mapping when completeMidiLearn runs while learning', () => {
        mocks.state.value = {
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'trackGain',
                trackId: 't1',
            },
        };

        const logger = createMock<Logger>();
        injectDependencies(completeMidiLearn, { logger });

        completeMidiLearn(2, 11);

        expect(midiLearnStore.set).toHaveBeenCalledWith(
            expect.objectContaining({
                isLearning: false,
                learningTarget: null,
                mappings: [
                    expect.objectContaining({
                        channel: 2,
                        cc: 11,
                        trackId: 't1',
                        targetType: 'trackGain',
                    }),
                ],
            })
        );
    });

    it('should replace an existing mapping when completeMidiLearn targets same channel and cc', () => {
        mocks.state.value = {
            mappings: [
                {
                    id: 'midi-map-old',
                    channel: 1,
                    cc: 2,
                    targetType: 'trackPan',
                    trackId: 't2',
                    deviceId: undefined,
                    paramId: undefined,
                    minValue: -50,
                    maxValue: 50,
                },
            ],
            isLearning: true,
            learningTarget: {
                targetType: 'trackGain',
                trackId: 't9',
            },
        };

        const logger = createMock<Logger>();
        injectDependencies(completeMidiLearn, { logger });

        completeMidiLearn(1, 2);

        const setCall = vi.mocked(midiLearnStore.set).mock.calls[0]?.[0];
        if (!setCall) {
            throw new Error('Expected midiLearnStore.set call');
        }
        expect(setCall.mappings).toHaveLength(1);
        expect(setCall.mappings[0]).toEqual(
            expect.objectContaining({
                channel: 1,
                cc: 2,
                targetType: 'trackGain',
                trackId: 't9',
            })
        );
    });
});

describe('midiLearn helpers', () => {
    beforeEach(() => {
        mocks.state.value = {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
    });

    it('should scale MIDI CC value into the target range', () => {
        expect(scaleMidiValue(0, 0, 127)).toBe(0);
        expect(scaleMidiValue(127, 0, 127)).toBe(127);
        expect(scaleMidiValue(64, 0, 1)).toBeCloseTo(0.503937, 5);
    });

    it('should return mapping for matching learning target', () => {
        mocks.state.value = {
            mappings: [
                {
                    id: 'm1',
                    channel: 0,
                    cc: 1,
                    targetType: 'deviceParam',
                    trackId: 't1',
                    deviceId: 'd1',
                    paramId: 'gain',
                    minValue: 0,
                    maxValue: 1,
                },
            ],
            isLearning: false,
            learningTarget: null,
        };

        const found = findMappingForTarget({
            targetType: 'deviceParam',
            trackId: 't1',
            deviceId: 'd1',
            paramId: 'gain',
        });

        expect(found?.id).toBe('m1');
    });

    it('should return undefined when no mapping matches target', () => {
        expect(
            findMappingForTarget({
                targetType: 'trackGain',
                trackId: 'missing',
            })
        ).toBeUndefined();
    });
});
