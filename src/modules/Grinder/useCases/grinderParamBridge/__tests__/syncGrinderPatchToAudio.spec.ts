import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, migrateGrinderPatch, type GrinderPatch } from '../../../models/GrinderPatch';
import { syncGrinderPatchToAudio } from '../syncGrinderPatchToAudio';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

describe('syncGrinderPatchToAudio', () => {
    const update_device_param = vi.fn();
    const persist_device_param = vi.fn();
    const update_device_patch = vi.fn();
    const ref = { trackId: 'track-1', deviceId: 'device-1' };

    function run(patch: GrinderPatch): void {
        syncGrinderPatchToAudio({
            patch,
            ref,
            update_device_param,
            persist_device_param,
            update_device_patch,
            resolve_eligible_device_write_target: () => ({
                status: 'eligible',
                trackId: ref.trackId,
                deviceId: ref.deviceId,
            }),
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send the shared pre-compressor defaults when no compressor pedal exists', () => {
        run(migrateGrinderPatch({ ...DEFAULT_PATCH, prePedals: [] }));

        // Single source of truth: the worklet receives -24/3/16/220, matching the panel,
        // never the previously-divergent -20/4/10/200.
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorThreshold', -24);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorRatio', 3);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorAttack', 16);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorRelease', 220);
        expect(update_device_param).not.toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorThreshold', -20);
    });

    it('should forward an existing compressor pedal threshold instead of the default', () => {
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                prePedals: [
                    {
                        id: 'comp1',
                        type: 'compressor',
                        enabled: true,
                        params: { threshold: -12, ratio: 6, attack: 5, release: 90 },
                    },
                ],
            })
        );

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorEnabled', 1);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorThreshold', -12);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorRatio', 6);
    });

    it('should skip enum keys that resolve to no audio index without sending a non-finite value', () => {
        // routingMode 'serial' is index 0 (finite); an unknown enum value resolves to null
        // and must be skipped. The guard relies solely on the null result, so a finite 0
        // index still reaches the device.
        run(migrateGrinderPatch({ ...DEFAULT_PATCH, routingMode: 'serial' }));

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'routingMode', 0);

        update_device_param.mockClear();

        run(migrateGrinderPatch({ ...DEFAULT_PATCH, routingMode: 'not-a-real-mode' as GrinderPatch['routingMode'] }));

        const routing_calls = update_device_param.mock.calls.filter((call) => call[2] === 'routingMode');
        expect(routing_calls).toHaveLength(0);
    });

    it('should let an enabled boost drive the shared overdrive slot even when a disabled overdrive precedes it', () => {
        // The engine exposes a single overdrive-family slot (see getAudioParamKeyForPedal),
        // so 'boost' and 'overdrive' contend for it. Selection must not silently drop the
        // pedal the user actually enabled just because a bypassed sibling sits earlier in
        // the chain array.
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                prePedals: [
                    { id: 'od1', type: 'overdrive', enabled: false, params: { drive: 9, tone: 1, level: 1 } },
                    { id: 'boost1', type: 'boost', enabled: true, params: { drive: 3, tone: 2, level: 2 } },
                ],
            })
        );

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveEnabled', 1);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveDrive', 3);
        expect(update_device_param).not.toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveDrive', 9);
    });

    it('should deterministically prefer the native overdrive over a boost when both are enabled', () => {
        // With both pedals enabled only one can occupy the single slot. Precedence is by
        // pedal type ('overdrive' owns the slot, 'boost' borrows it), not by chain array
        // order, so reordering the chain never swaps which pedal drives the slot.
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                postPedals: [
                    { id: 'boost1', type: 'boost', enabled: true, params: { drive: 3, tone: 2, level: 2 } },
                    { id: 'od1', type: 'overdrive', enabled: true, params: { drive: 7, tone: 4, level: 5 } },
                ],
            })
        );

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'postOverdriveEnabled', 1);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'postOverdriveDrive', 7);
        expect(update_device_param).not.toHaveBeenCalledWith('track-1', 'device-1', 'postOverdriveDrive', 3);
    });

    it('should keep the slot bypassed but sourced from the native overdrive when both family pedals are bypassed', () => {
        // Same precedence band (both bypassed): the native 'overdrive' still outranks the
        // 'boost', so the slot reports disabled while carrying the overdrive's stored
        // params — deterministic regardless of chain order.
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                prePedals: [
                    { id: 'boost1', type: 'boost', enabled: false, params: { drive: 3, tone: 2, level: 2 } },
                    { id: 'od1', type: 'overdrive', enabled: false, params: { drive: 8, tone: 6, level: 4 } },
                ],
            })
        );

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveEnabled', 0);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveDrive', 8);
        expect(update_device_param).not.toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveDrive', 3);
    });

    it('should let a lone boost pedal drive the shared overdrive slot with its own params', () => {
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                prePedals: [{ id: 'boost1', type: 'boost', enabled: true, params: { drive: 2, tone: 9, level: 6 } }],
            })
        );

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveEnabled', 1);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveDrive', 2);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveTone', 9);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preOverdriveLevel', 6);
    });

    it('should send an imported profile as the engine-named numeric writes before neuralModelMode', () => {
        const profile = {
            derivedFrom: 'nam' as const,
            sourceArchitecture: 'wavenet',
            sourceSampleRate: 48_000,
            sourceWeightCount: 6,
            preferredTier: 'lite' as const,
            inputDrive: 1.2,
            asymmetry: -0.1,
            outputTrim: 0.9,
            contourMix: 0.3,
            recurrentBias: 0.05,
            convWeights: [
                [0.1, 0.2, 0.3],
                [0.4, 0.5, 0.6],
            ] as Array<[number, number, number]>,
        };

        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                neuralModelSource: 'imported',
                neuralModelProfile: profile,
            })
        );

        const neural_calls = update_device_param.mock.calls.filter(
            ([, , key]) => (key as string).startsWith('neuralCustom') || key === 'neuralModelMode'
        );
        expect(neural_calls).toEqual([
            ['track-1', 'device-1', 'neuralCustomTier', 1],
            ['track-1', 'device-1', 'neuralCustomInputDrive', 1.2],
            ['track-1', 'device-1', 'neuralCustomAsymmetry', -0.1],
            ['track-1', 'device-1', 'neuralCustomOutputTrim', 0.9],
            ['track-1', 'device-1', 'neuralCustomContourMix', 0.3],
            ['track-1', 'device-1', 'neuralCustomLstmBias', 0.05],
            ['track-1', 'device-1', 'neuralCustomConvWeight0_0', 0.1],
            ['track-1', 'device-1', 'neuralCustomConvWeight0_1', 0.2],
            ['track-1', 'device-1', 'neuralCustomConvWeight0_2', 0.3],
            ['track-1', 'device-1', 'neuralCustomConvWeight1_0', 0.4],
            ['track-1', 'device-1', 'neuralCustomConvWeight1_1', 0.5],
            ['track-1', 'device-1', 'neuralCustomConvWeight1_2', 0.6],
            ['track-1', 'device-1', 'neuralModelMode', 1],
        ]);

        const persisted_calls = persist_device_param.mock.calls.filter(
            ([, key]) => (key as string).startsWith('neuralCustom') || key === 'neuralModelMode'
        );
        expect(persisted_calls).toEqual([
            ['device-1', 'neuralCustomTier', 1],
            ['device-1', 'neuralCustomInputDrive', 1.2],
            ['device-1', 'neuralCustomAsymmetry', -0.1],
            ['device-1', 'neuralCustomOutputTrim', 0.9],
            ['device-1', 'neuralCustomContourMix', 0.3],
            ['device-1', 'neuralCustomLstmBias', 0.05],
            ['device-1', 'neuralCustomConvWeight0_0', 0.1],
            ['device-1', 'neuralCustomConvWeight0_1', 0.2],
            ['device-1', 'neuralCustomConvWeight0_2', 0.3],
            ['device-1', 'neuralCustomConvWeight1_0', 0.4],
            ['device-1', 'neuralCustomConvWeight1_1', 0.5],
            ['device-1', 'neuralCustomConvWeight1_2', 0.6],
            ['device-1', 'neuralModelMode', 1],
        ]);

        expect(update_device_patch).toHaveBeenCalledWith('track-1', 'device-1', {
            neuralModelMode: 'imported',
            profile,
        });
    });

    it('should send no neuralCustom writes for a built-in model', () => {
        run(migrateGrinderPatch({ ...DEFAULT_PATCH }));

        const neural_custom_calls = update_device_param.mock.calls.filter(([, , key]) =>
            (key as string).startsWith('neuralCustom')
        );
        expect(neural_custom_calls).toHaveLength(0);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'neuralModelMode', 0);
    });

    it('should emit neuralEnabled before engineMode to the device and into the persisted record', () => {
        // Both names write NeuralCapture's single engine_mode field; the
        // engineMode-first order let the boolean simplification overwrite the
        // exact pick (GRINDER_PATCH_PRECEDENCE, issue #4141). The persist
        // order is the persisted record's first-insertion order, so the
        // replay path meets the pair in the same order.
        run(migrateGrinderPatch({ ...DEFAULT_PATCH, neuralEnabled: true, engineMode: 'capture' }));

        const update_keys = update_device_param.mock.calls.map(([, , key]) => key as string);
        expect(update_keys.indexOf('neuralEnabled')).toBeGreaterThan(-1);
        expect(update_keys.indexOf('engineMode')).toBeGreaterThan(update_keys.indexOf('neuralEnabled'));

        const persist_keys = persist_device_param.mock.calls.map(([, key]) => key as string);
        expect(persist_keys.indexOf('neuralEnabled')).toBeGreaterThan(-1);
        expect(persist_keys.indexOf('engineMode')).toBeGreaterThan(persist_keys.indexOf('neuralEnabled'));
    });
});
