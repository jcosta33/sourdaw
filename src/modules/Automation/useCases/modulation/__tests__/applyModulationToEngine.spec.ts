import { describe, it, expect, beforeEach, vi } from 'vitest';

type MockPluginParam = {
    id: string;
    minValue: number;
    maxValue: number;
    defaultValue: number;
};

type MockPluginDescriptor = {
    id: string;
    name: string;
    parameters: MockPluginParam[];
};

type MockTrackStoreValue = {
    tracks: Array<{
        id: string;
        automationMode?: 'read' | 'off';
        clips?: Array<{ id: string; startBeat: number; endBeat: number }>;
        devices: Array<{
            id: string;
            type: string;
            parameterValues: Record<string, number>;
        }>;
    }>;
} | null;

type UpdateDeviceParam = (trackId: string, deviceId: string, paramId: string, value: number) => void;
type GetPluginById = (pluginId: string) => MockPluginDescriptor | undefined;

const { mocks } = vi.hoisted(() => {
    const trackStore: { value: MockTrackStoreValue } = { value: null };
    return {
        mocks: {
            updateDeviceParam: vi.fn<UpdateDeviceParam>(),
            getPluginById: vi.fn<GetPluginById>(),
            trackStore,
        },
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    resolveEligibleDeviceWriteTarget: (deviceId: string) => {
        const track = mocks.trackStore.value?.tracks.find((candidate) =>
            candidate.devices.some((device) => device.id === deviceId)
        );
        if (!track) {
            return { status: 'missing' };
        }
        return { status: 'eligible', trackId: track.id, deviceId };
    },
}));

import { type AutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { modulationStore } from '../../../stores/modulationStore';
import { applyModulationToEngine } from '../applyModulationToEngine';
import { setModulationDependencies } from '../modulationDependencies';
import { resetModulationSlew } from '../resetModulationSlew';

function createAutomationLaneFixture(input: {
    id: string;
    trackId: string;
    parameterId: string;
    parameterName: string;
    value: number;
    minValue: number;
    maxValue: number;
}): AutomationLane {
    return {
        id: input.id,
        trackId: input.trackId,
        parameterId: input.parameterId,
        parameterName: input.parameterName,
        points: [{ beat: 0, value: input.value, curve: 'linear', tension: 0 }],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        virginTerritory: false,
        minValue: input.minValue,
        maxValue: input.maxValue,
    };
}

describe('applyModulationToEngine', () => {
    beforeEach(() => {
        // The slew map is module-level and survives across ticks; clear it so a
        // prior test's seeded value does not suppress the first write here.
        resetModulationSlew();
        // The automated-base path reads the real automationStore; start empty so
        // a leftover lane from a prior case does not leak into the next.
        automationStore.set({ lanes: [] });
        mocks.updateDeviceParam.mockReset();
        mocks.getPluginById.mockReset();
        setModulationDependencies({
            updateDeviceParam: mocks.updateDeviceParam,
            getPluginParamRange: (deviceType, paramId) => {
                const descriptor = mocks.getPluginById(deviceType);
                const paramDef = descriptor?.parameters.find((param: { id: string }) => param.id === paramId);
                if (!paramDef) {
                    return null;
                }
                return { min: paramDef.minValue, max: paramDef.maxValue, defaultValue: paramDef.defaultValue };
            },
        });

        mocks.trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    devices: [
                        {
                            id: 'd1',
                            type: 'builtin-filter',
                            parameterValues: { cutoff: 500 },
                        },
                    ],
                },
            ],
        };

        mocks.getPluginById.mockImplementation((pluginId: string) => {
            if (pluginId !== 'builtin-filter') {
                return undefined;
            }
            return {
                id: 'builtin-filter',
                name: 'Filter',
                parameters: [{ id: 'cutoff', minValue: 0, maxValue: 1000, defaultValue: 500 }],
            };
        });

        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 0.5 }],
                    enabled: true,
                },
            ],
        });
    });

    it('writes base + modValue * amount * range to the engine without mutating the store', () => {
        applyModulationToEngine(1);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [trackId, deviceId, paramId, value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(trackId).toBe('t1');
        expect(deviceId).toBe('d1');
        expect(paramId).toBe('cutoff');
        expect(value).toBeCloseTo(1000);

        const tracks = mocks.trackStore.value?.tracks;
        expect(tracks?.[0]?.devices[0]?.parameterValues.cutoff).toBe(500);
    });

    it('clamps the engine value inside the param range', () => {
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 10 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 1 }],
                    enabled: true,
                },
            ],
        });

        applyModulationToEngine(1);

        const [, , , value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(value).toBeLessThanOrEqual(1000);
        expect(value).toBeGreaterThanOrEqual(0);
    });

    it('clears the same slew state used by applyModulationToEngine', () => {
        applyModulationToEngine(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [, , , initialValue] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(initialValue).toBeCloseTo(1000);

        mocks.updateDeviceParam.mockClear();
        mocks.trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    devices: [
                        {
                            id: 'd1',
                            type: 'builtin-filter',
                            parameterValues: { cutoff: 200 },
                        },
                    ],
                },
            ],
        };
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 0 }],
                    enabled: true,
                },
            ],
        });

        resetModulationSlew();
        applyModulationToEngine(1);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [, , , resetValue] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(resetValue).toBeCloseTo(200);
    });

    it('does nothing when the modulator is disabled', () => {
        const state = modulationStore.value!;
        modulationStore.set({
            ...state,
            modulators: state.modulators.map((m) => ({ ...m, enabled: false })),
        });

        applyModulationToEngine(1);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('skips mappings whose target track/device/param cannot be resolved', () => {
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                    mappings: [
                        { targetTrackId: 'missing', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 0.5 },
                        { targetTrackId: 't1', targetDeviceId: 'missing', targetParamId: 'cutoff', amount: 0.5 },
                        { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'missing', amount: 0.5 },
                    ],
                    enabled: true,
                },
            ],
        });

        applyModulationToEngine(1);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not ride a device-param modulation on a track-level gain lane that shares the bare id', () => {
        // A track-level gain lane carries the bare id 'gain' (normalized 0..1,
        // converted dB→linear / pan-remapped before a *track* engine setter),
        // while the modulation targets a *device* 'gain' param written verbatim.
        // The two merely share a string id; the track lane must NOT become the
        // base, or a normalized 0..1 value rides the device write in wrong units.
        mocks.trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    automationMode: 'read',
                    clips: [],
                    devices: [{ id: 'd1', type: 'builtin-gainer', parameterValues: { gain: 0.5 } }],
                },
            ],
        };
        mocks.getPluginById.mockImplementation((pluginId: string) =>
            pluginId === 'builtin-gainer'
                ? {
                      id: 'builtin-gainer',
                      name: 'Gainer',
                      parameters: [{ id: 'gain', minValue: 0, maxValue: 1, defaultValue: 0.5 }],
                  }
                : undefined
        );
        // Track-level gain lane parked at the range top (would be base=1 under the bug).
        automationStore.set({
            lanes: [
                createAutomationLaneFixture({
                    id: 'lane-track-gain',
                    trackId: 't1',
                    parameterId: 'gain',
                    parameterName: 'Volume',
                    value: 1,
                    minValue: 0,
                    maxValue: 1,
                }),
            ],
        });
        // amount 0 → delta 0, so the engine value equals the base exactly.
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'gain', amount: 0 }],
                    enabled: true,
                },
            ],
        });

        applyModulationToEngine(1);

        // Base must be the device's persisted param value (0.5), not the
        // track-gain lane's 1. Under the bug it would write 1.
        const [, , , value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(value).toBeCloseTo(0.5);
    });

    it.each(['d1:cutoff', 'builtin-filter:cutoff'])(
        'rides modulation on the uniquely matching device automation lane %s',
        (parameterId) => {
            mocks.trackStore.value = {
                tracks: [
                    {
                        id: 't1',
                        automationMode: 'read',
                        clips: [],
                        devices: [{ id: 'd1', type: 'builtin-filter', parameterValues: { cutoff: 500 } }],
                    },
                ],
            };
            automationStore.set({
                lanes: [
                    createAutomationLaneFixture({
                        id: 'lane-device-cutoff',
                        trackId: 't1',
                        parameterId,
                        parameterName: 'Filter Cutoff',
                        value: 800,
                        minValue: 0,
                        maxValue: 1000,
                    }),
                ],
            });
            modulationStore.set({
                modulators: [
                    {
                        id: 'lfo1',
                        name: 'LFO',
                        trackId: 't1',
                        kind: 'lfo',
                        config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                        mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 0 }],
                        enabled: true,
                    },
                ],
            });

            applyModulationToEngine(1);

            const [, , , value] = mocks.updateDeviceParam.mock.calls[0]!;
            expect(value).toBeCloseTo(800);
        }
    );
});
