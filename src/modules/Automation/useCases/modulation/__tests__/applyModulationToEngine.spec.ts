import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        updateDeviceParam: vi.fn(),
        getPluginById: vi.fn(),
        trackStore: { value: null as unknown as { tracks: unknown[] } | null },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getPluginById: mocks.getPluginById,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

import { modulationStore } from '../../../stores/modulationStore';
import { applyModulationToEngine } from '../applyModulationToEngine';

describe('applyModulationToEngine', () => {
    beforeEach(() => {
        mocks.updateDeviceParam.mockReset();
        mocks.getPluginById.mockReset();

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
                parameters: [
                    { id: 'cutoff', minValue: 0, maxValue: 1000, defaultValue: 500 },
                ],
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
                    mappings: [
                        { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 0.5 },
                    ],
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

        const tracks = mocks.trackStore.value?.tracks as Array<{ devices: Array<{ parameterValues: Record<string, number> }> }> | undefined;
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
                    mappings: [
                        { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 1 },
                    ],
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
});
