import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Logger } from '#/infra/logger/types';
import * as platformCapabilities from '#/utils/platformCapabilities';

import { midiLearnStore } from '../../stores/midiLearnStore';
import { type MidiLearnState } from '../../stores/midiLearnStore';
import { completeMidiLearn } from '../midiLearn/completeMidiLearn';
import { findMappingForTarget } from '../midiLearn/findMappingForTarget';
import { scaleMidiValue } from '../midiLearn/scaleMidiValue';
import { startMidiLearn } from '../midiLearn/startMidiLearn';
import { stopMidiLearn } from '../midiLearn/stopMidiLearn';

const supportedMidiCapabilities: platformCapabilities.PlatformCapabilities = {
    hasNativePlugins: false,
    hasPluginScanning: false,
    webMidiApiPresent: true,
    hasMidiInput: true,
    hasNativeFileDialogs: false,
    hasMultiTrackRecording: false,
    isDesktopApp: false,
    degradations: [],
};

const unsupportedMidiCapabilities: platformCapabilities.PlatformCapabilities = {
    ...supportedMidiCapabilities,
    webMidiApiPresent: false,
    hasMidiInput: false,
    degradations: [
        {
            feature: 'midi-input',
            reason: 'api-absent',
            message: platformCapabilities.DISABLED_REASONS.midiInput,
        },
    ],
};

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
    const getPlatformCapabilities = vi.spyOn(platformCapabilities, 'getPlatformCapabilities');

    beforeEach(() => {
        vi.mocked(midiLearnStore.set).mockClear();
        getPlatformCapabilities.mockReturnValue(supportedMidiCapabilities);
        mocks.state.value = {
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        getPlatformCapabilities.mockReset();
    });

    afterAll(() => {
        getPlatformCapabilities.mockRestore();
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
        vi.useFakeTimers();
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
        expect(vi.getTimerCount()).toBe(1);
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('should not start learning when MIDI input is unsupported', () => {
        vi.useFakeTimers();
        getPlatformCapabilities.mockReturnValue(unsupportedMidiCapabilities);
        const initialState = midiLearnStore.value;
        const logger = createMock<Logger>();
        injectDependencies(startMidiLearn, { logger });

        startMidiLearn({
            targetType: 'fermenterGlobalParam',
            trackId: 'global',
            paramId: 'p1',
        });

        expect(logger.info).not.toHaveBeenCalled();
        expect(midiLearnStore.set).not.toHaveBeenCalled();
        expect(midiLearnStore.value).toEqual(initialState);
        expect(vi.getTimerCount()).toBe(0);
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

describe('completeMidiLearn (audit A-1 — dispatches through executeUserAppAction)', () => {
    const dispatched: { type: string; payload: unknown }[] = [];
    const executeUserAppAction = vi.fn((action: { type: string; payload: unknown }) => {
        dispatched.push(action);
        return Promise.resolve();
    });

    beforeEach(() => {
        dispatched.length = 0;
        executeUserAppAction.mockClear();
        mocks.state.value = {
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
        injectDependencies(completeMidiLearn, { executeUserAppAction });
    });

    it('should not dispatch when completeMidiLearn runs without active learning', () => {
        completeMidiLearn(1, 7);

        expect(executeUserAppAction).not.toHaveBeenCalled();
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
