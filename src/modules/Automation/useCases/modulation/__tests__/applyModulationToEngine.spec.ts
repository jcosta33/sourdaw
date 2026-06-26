import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        updateDeviceParam: vi.fn(),
        getPluginById: vi.fn(),
        trackStore: { value: null as unknown as { tracks: unknown[] } | null },
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

import { automationStore } from '../../../stores/automationStore';
import { modulationStore } from '../../../stores/modulationStore';
import { applyModulationToEngine, resetModulationSlew } from '../applyModulationToEngine';
import { setModulationDependencies } from '../modulationDependencies';

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

        const tracks = mocks.trackStore.value?.tracks as
            | Array<{ devices: Array<{ parameterValues: Record<string, number> }> }>
            | undefined;
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
                {
                    id: 'lane-track-gain',
                    trackId: 't1',
                    parameterId: 'gain',
                    parameterName: 'Volume',
                    points: [{ beat: 0, value: 1, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    virginTerritory: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        } as never);
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

    it('rides a device-param modulation on the matching device-param automation lane', () => {
        // The device-param lane carries the prefixed id `${deviceType}:${paramId}`
        // and its value is in the device param's engine space — so it is the
        // correct automated base for a device-param modulation.
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
                {
                    id: 'lane-device-cutoff',
                    trackId: 't1',
                    parameterId: 'builtin-filter:cutoff',
                    parameterName: 'Filter → Cutoff',
                    points: [{ beat: 0, value: 800, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    virginTerritory: false,
                    minValue: 0,
                    maxValue: 1000,
                },
            ],
        } as never);
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

        // Base is the device-param automation value (800), not the persisted 500.
        const [, , , value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(value).toBeCloseTo(800);
    });
});
