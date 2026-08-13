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
            mappingsSchemaVersion: 1,
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
            mappingsSchemaVersion: 1,
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
            mappingsSchemaVersion: 1,
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
});

describe('completeMidiLearn (audit A-1 — dispatches through executeAppAction)', () => {
    const dispatched: { type: string; payload: unknown }[] = [];
    const executeAppAction = vi.fn((action: { type: string; payload: unknown }) => {
        dispatched.push(action);
        return Promise.resolve();
    });

    beforeEach(() => {
        dispatched.length = 0;
        executeAppAction.mockClear();
        mocks.state.value = {
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
        injectDependencies(completeMidiLearn, { executeAppAction });
    });

    it('should not dispatch when completeMidiLearn runs without active learning', () => {
        completeMidiLearn(1, 7);

        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('should dispatch completeMidiLearn with the channel/cc when learning is active', () => {
        mocks.state.value = {
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'trackGain',
                trackId: 't1',
            },
        };

        completeMidiLearn(2, 11);

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).toMatchObject({ type: 'completeMidiLearn', payload: { channel: 2, cc: 11 } });
    });
});

describe('midiLearn helpers', () => {
    beforeEach(() => {
        mocks.state.value = {
            mappingsSchemaVersion: 1,
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
            mappingsSchemaVersion: 1,
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
