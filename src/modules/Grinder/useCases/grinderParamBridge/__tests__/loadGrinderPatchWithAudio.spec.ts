import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { loadGrinderPatch } from '../../../stores/grinderStore';
import { loadGrinderPatchWithAudio } from '../loadGrinderPatchWithAudio';

vi.mock('../../../stores/grinderStore', () => ({
    loadGrinderPatch: vi.fn(),
    migrateGrinderPatch: (param: any) => param,
    grinderStore: { value: {} },
}));

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(),
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

describe('loadGrinderPatchWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        updateDevicePatch: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update store and notify audio engine for all sync keys', () => {
        const deviceId = 'device-1';
        const trackId = 'track-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: trackId,
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = { ...DEFAULT_PATCH, gain: 7.5 };
        const action = loadGrinderPatchWithAudio(deps as any);

        action(deviceId, patch);

        expect(loadGrinderPatch).toHaveBeenCalledWith(deviceId, expect.objectContaining({ gain: 7.5 }));
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'gain', 7.5);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'gain', 7.5);
    });

    it('should sync mic properties', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = {
            ...DEFAULT_PATCH,
            mic1: { ...DEFAULT_PATCH.mic1, positionX: 0.8 },
            mic2: { ...DEFAULT_PATCH.mic2, enabled: true, positionY: 0.4 },
        };
        const action = loadGrinderPatchWithAudio(deps as any);

        action(deviceId, patch);

        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'mic1PositionX', 0.8);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'mic2Enabled', 1);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'mic2PositionY', 0.4);
    });

    it('should sync the selected neural model as a real DSP slot', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = {
            ...DEFAULT_PATCH,
            uiSection: 'neural' as const,
            engineMode: 'capture' as const,
            neuralEnabled: true,
            neuralModelId: 'factory-rig-b',
            neuralModelName: 'Factory Rig B',
        };
        const action = loadGrinderPatchWithAudio(deps as any);

        action(deviceId, patch);

        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'neuralModelSlot', 1);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'neuralModelSlot', 1);
    });

    it('should sync an imported neural model as a structured custom profile patch', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = {
            ...DEFAULT_PATCH,
            uiSection: 'neural' as const,
            engineMode: 'capture' as const,
            neuralEnabled: true,
            neuralModelId: 'imported-tight-rhythm',
            neuralModelName: 'Tight Rhythm',
            neuralModelFamily: 'NAM import',
            neuralModelSource: 'imported' as const,
            neuralModelProfile: {
                derivedFrom: 'nam' as const,
                sourceArchitecture: 'WaveNet',
                sourceSampleRate: 48_000,
                sourceWeightCount: 12,
                preferredTier: 'standard' as const,
                inputDrive: 1.18,
                asymmetry: 0.04,
                outputTrim: 0.9,
                contourMix: 0.22,
                recurrentBias: 0.02,
                convWeights: [
                    [0.1, 0.7, 0.2],
                    [0.09, 0.68, 0.23],
                    [0.12, 0.66, 0.2],
                    [0.11, 0.67, 0.19],
                    [0.08, 0.72, 0.16],
                    [0.07, 0.74, 0.15],
                    [0.13, 0.64, 0.19],
                    [0.1, 0.69, 0.18],
                    [0.09, 0.7, 0.17],
                    [0.11, 0.68, 0.17],
                ],
            },
        };
        const action = loadGrinderPatchWithAudio(deps as never);

        action(deviceId, patch);

        expect(deps.updateDevicePatch).toHaveBeenCalledWith(
            'track-1',
            deviceId,
            expect.objectContaining({
                neuralModelMode: 'imported',
                profile: expect.objectContaining({
                    sourceArchitecture: 'WaveNet',
                    convWeights: expect.any(Array),
                }),
            })
        );
    });

    it('should sync cabinet mode, cabinet voice, and routing preset selections', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = {
            ...DEFAULT_PATCH,
            uiSection: 'cab' as const,
            cabType: 'parametric' as const,
            cabIrId: '2x12-open',
            routingMode: 'parallel' as const,
        };
        const action = loadGrinderPatchWithAudio(deps as never);

        action(deviceId, patch);

        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', deviceId, 'cabType', 1);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'cabType', 1);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', deviceId, 'routingMode', 1);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'routingMode', 1);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', deviceId, 'cabIrSlot', 1);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'cabIrSlot', 1);
    });
});
