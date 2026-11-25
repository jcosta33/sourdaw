import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, migrateGrinderPatch, type GrinderPatch } from '../../../models/GrinderPatch';
import { parseGrinderNamFile } from '../../../services/parseGrinderNamFile';
import { GRINDER_PRESETS } from '../../grinderPresets';
import { encodeGrinderPatchCommands } from '../encodeGrinderPatchCommands';
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

    it('carries every weight from an actually parsed NAM through the production patch producer', () => {
        const document = {
            architecture: 'Linear',
            version: '0.5.4',
            sample_rate: 48000,
            config: { receptive_field: 2, bias: false },
            weights: [0.25, -0.5],
        };
        const entry = parseGrinderNamFile({ file_name: 'real.nam', file_text: JSON.stringify(document) });
        run(
            migrateGrinderPatch({ ...DEFAULT_PATCH, neuralModelSource: 'imported', neuralModelProfile: entry.profile })
        );
        const call = update_device_patch.mock.calls.find(([, , patch]) => typeof patch.modelJson === 'string');
        expect(call).toBeDefined();
        expect(JSON.parse(call?.[2].modelJson ?? 'null')).toEqual(document);

        const audioProfile = update_device_param.mock.calls
            .map(([, , key, value], index) => ({
                key,
                value,
                order: update_device_param.mock.invocationCallOrder[index],
            }))
            .filter(({ key }) => key.startsWith('neuralCustom'));
        const persistedProfile = persist_device_param.mock.calls
            .map(([, key, value], index) => ({
                key,
                value,
                order: persist_device_param.mock.invocationCallOrder[index],
            }))
            .filter(({ key }) => key.startsWith('neuralCustom'));
        expect(audioProfile.length).toBeGreaterThan(0);
        expect(persistedProfile.map(({ key, value }) => [key, value])).toEqual(
            audioProfile.map(({ key, value }) => [key, value])
        );
        const audioModeIndex = update_device_param.mock.calls.findIndex(
            ([, , key, value]) => key === 'neuralModelMode' && value === 1
        );
        const persistModeIndex = persist_device_param.mock.calls.findIndex(
            ([, key, value]) => key === 'neuralModelMode' && value === 1
        );
        const patchIndex = update_device_patch.mock.calls.findIndex(
            ([, , patch]) => typeof patch.modelJson === 'string'
        );
        const audioModeOrder = update_device_param.mock.invocationCallOrder[audioModeIndex];
        const persistModeOrder = persist_device_param.mock.invocationCallOrder[persistModeIndex];
        const patchOrder = update_device_patch.mock.invocationCallOrder[patchIndex];
        if (audioModeOrder === undefined || persistModeOrder === undefined || patchOrder === undefined) {
            throw new Error('Missing imported neural mode or structured patch call');
        }
        for (const { order } of [...audioProfile, ...persistedProfile]) {
            if (order === undefined) throw new Error('Missing imported neural profile call order');
            expect(order).toBeLessThan(audioModeOrder);
        }
        expect(audioModeOrder).toBeLessThan(persistModeOrder);
        expect(persistModeOrder).toBeLessThan(patchOrder);
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes the Rectifier Heavy factory preset in its original order', () => {
        const preset = GRINDER_PRESETS.find(({ id }) => id === 'gr-rectifier-heavy');
        if (!preset) throw new Error('Rectifier Heavy preset is missing');
        run(migrateGrinderPatch(preset.patch));

        function callOrder(orders: number[], index: number): number {
            const order = orders[index];
            if (order === undefined) throw new Error('Missing mock invocation order');
            return order;
        }

        const numeric = update_device_param.mock.calls.map(([, , key, value]) => `${key}=${value}`);
        const trace = [
            ...numeric.map((entry, index) => ({
                order: callOrder(update_device_param.mock.invocationCallOrder, index),
                entry,
            })),
            ...update_device_patch.mock.calls.map(([, , patch], index) => ({
                order: callOrder(update_device_patch.mock.invocationCallOrder, index),
                entry: `neural=${patch.neuralModelMode}`,
            })),
        ]
            .sort((a, b) => a.order - b.order)
            .map(({ entry }) => entry);
        const expected = `cabIrSlot=0
neuralEnabled=0
engineMode=0
inputImpedance=1000
inputGain=0
inputMode=0
gateEnabled=0
gateThreshold=-60
gateAttack=2
gateRelease=120
ampModel=4
gain=9
channel=2
bright=0
fat=0
tubeBias=0.5
tubeAge=0
millerCapacitance=0.5
gridConduction=0.5
couplingCapCharge=0.5
toneStackType=1
bass=7
mid=5
treble=6
presence=5
resonance=6
brightCap=0
master=4
powerTubeType=0
rectifierType=0
sagAmount=0.6
sagRecovery=300
negFeedback=0.5
powerAmpBias=0.5
transformerDrive=0.3
transformerHysteresis=0.3
transformerLfSaturation=0.3
cabType=2
cabEnabled=1
cabResonanceFreq=80
cabResonanceQ=2
cabDamping=0.5
cabOpenBack=0
coneBreakup=0.3
backEmf=0.2
micBlend=0
roomAmount=0.1
neuralPlacement=0
neuralTier=0
neuralMix=1
neuralCpuBudget=1
outputGain=0
outputMix=1
limiterEnabled=1
limiterThreshold=-0.3
routingMode=0
cleanBlend=0
preCompressorEnabled=0
preCompressorThreshold=-24
preCompressorRatio=3
preCompressorAttack=16
preCompressorRelease=220
preOverdriveEnabled=0
preOverdriveDrive=2.8
preOverdriveTone=5.2
preOverdriveLevel=5.4
preDistortionEnabled=0
preDistortionDrive=5.2
preDistortionTone=4.4
preDistortionLevel=7.2
preFuzzEnabled=0
preFuzzFuzz=6.8
preFuzzTone=4.8
preFuzzLevel=6.4
postCompressorEnabled=0
postCompressorThreshold=-24
postCompressorRatio=3
postCompressorAttack=16
postCompressorRelease=220
postOverdriveEnabled=0
postOverdriveDrive=2.8
postOverdriveTone=5.2
postOverdriveLevel=5.4
postDistortionEnabled=0
postDistortionDrive=5.2
postDistortionTone=4.4
postDistortionLevel=7.2
postFuzzEnabled=0
postFuzzFuzz=6.8
postFuzzTone=4.8
postFuzzLevel=6.4
preCompressorOrder=0
preOverdriveOrder=1
preDistortionOrder=2
preFuzzOrder=3
postCompressorOrder=0
postOverdriveOrder=1
postDistortionOrder=2
postFuzzOrder=3
neuralModelMode=0
neural=builtin
mic1Enabled=1
mic1PositionX=0.3
mic1PositionY=0.1
mic1Distance=0.2
mic1Gain=0
mic2Enabled=0
mic2PositionX=0.6
mic2PositionY=0.1
mic2Distance=0.2
mic2Gain=0`.split('\n');
        expect(trace).toEqual(expected);
        expect(update_device_patch.mock.calls.map(([, , patch]) => patch)).toEqual([{ neuralModelMode: 'builtin' }]);
        const expectedNumeric = expected
            .filter((entry) => !entry.startsWith('neural='))
            .map((entry) => {
                const [key, value] = entry.split('=');
                return [key, Number(value)];
            });
        expect(update_device_param.mock.calls.map(([, , key, value]) => [key, value])).toEqual(expectedNumeric);
        expect(persist_device_param.mock.calls.map(([, key, value]) => [key, value])).toEqual(expectedNumeric);
    });

    it('encodes finite parameters and the built-in neural command in playback order', () => {
        const patch = { ...DEFAULT_PATCH, gain: Number.NaN, neuralModelId: 'factory-rig-b' };
        const commands = encodeGrinderPatchCommands(patch);
        const modeIndex = commands.findIndex(
            (command) => command.kind === 'parameter' && command.key === 'neuralModelMode'
        );
        expect(commands.some((command) => command.kind === 'parameter' && command.key === 'gain')).toBe(false);
        expect(commands.slice(modeIndex, modeIndex + 3)).toEqual([
            { kind: 'parameter', key: 'neuralModelMode', value: 0 },
            { kind: 'neural', patch: { neuralModelMode: 'builtin' } },
            { kind: 'parameter', key: 'neuralModelSlot', value: 1 },
        ]);
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
            model: null,
            modelDigest: null,
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

    it('sends the model as .nam JSON on the patch when the profile carries one (#3774)', () => {
        const model = {
            architecture: 'WaveNet' as const,
            version: '0.6.1' as string | null,
            sampleRate: 48_000 as number | null,
            config: { channels: 2, dilations: [1, 2] } as Record<string, unknown>,
            weights: [0.5, -0.25, 0.125] as readonly number[],
        };
        const profile = {
            derivedFrom: 'nam' as const,
            sourceArchitecture: 'wavenet',
            sourceSampleRate: 48_000,
            sourceWeightCount: 3,
            preferredTier: 'standard' as const,
            inputDrive: 1,
            asymmetry: 0,
            outputTrim: 1,
            contourMix: 0,
            recurrentBias: 0,
            convWeights: [] as Array<[number, number, number]>,
            model,
            modelDigest: '0123-4567-89ab-cdef',
        };

        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                neuralModelSource: 'imported',
                neuralModelProfile: profile,
            })
        );

        const patch_call = update_device_patch.mock.calls.find(
            ([, , patch]) => (patch as { neuralModelMode?: string }).neuralModelMode === 'imported'
        );
        expect(patch_call).toBeDefined();
        const sent = patch_call![2] as { modelJson?: string; profile: unknown };
        // The serialized document parses back to exactly what the runtime
        // parses: architecture, version, root sample rate, config, weights.
        expect(JSON.parse(sent.modelJson ?? 'null')).toEqual({
            architecture: 'WaveNet',
            version: '0.6.1',
            sample_rate: 48_000,
            config: model.config,
            weights: [0.5, -0.25, 0.125],
        });
        // The compiled door strips the raw model (pinned in
        // runtimeGrinderNeuralPatch.spec); here the patch carries both the
        // profile and the text the runtime parses.
        expect(sent.modelJson).toBeDefined();
        expect(sent.profile).toEqual(profile);
    });

    it('sends no modelJson for a model-less profile (record with no library entry)', () => {
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
            convWeights: [] as Array<[number, number, number]>,
            model: null,
            modelDigest: null,
        };

        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                neuralModelSource: 'imported',
                neuralModelProfile: profile,
            })
        );

        const patch_call = update_device_patch.mock.calls.find(
            ([, , patch]) => (patch as { neuralModelMode?: string }).neuralModelMode === 'imported'
        );
        expect(patch_call).toBeDefined();
        expect(patch_call![2]).not.toHaveProperty('modelJson');
    });

    it('should send no neuralCustom writes for a built-in model', () => {
        run(migrateGrinderPatch({ ...DEFAULT_PATCH }));

        const neural_custom_calls = update_device_param.mock.calls.filter(([, , key]) =>
            (key as string).startsWith('neuralCustom')
        );
        expect(neural_custom_calls).toHaveLength(0);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'neuralModelMode', 0);
    });

    it('emits neuralEnabled before engineMode so exact engine mode pick lands last on the engine', () => {
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                engineMode: 'capture',
                neuralEnabled: true,
            })
        );

        const updateKeys = update_device_param.mock.calls.map((c) => c[2]);
        const persistKeys = persist_device_param.mock.calls.map((c) => c[1]);

        const updateNeuralIdx = updateKeys.indexOf('neuralEnabled');
        const updateEngineIdx = updateKeys.indexOf('engineMode');
        expect(updateNeuralIdx).toBeGreaterThanOrEqual(0);
        expect(updateEngineIdx).toBeGreaterThanOrEqual(0);
        expect(updateNeuralIdx).toBeLessThan(updateEngineIdx);

        const persistNeuralIdx = persistKeys.indexOf('neuralEnabled');
        const persistEngineIdx = persistKeys.indexOf('engineMode');
        expect(persistNeuralIdx).toBeGreaterThanOrEqual(0);
        expect(persistEngineIdx).toBeGreaterThanOrEqual(0);
        expect(persistNeuralIdx).toBeLessThan(persistEngineIdx);
    });
});
