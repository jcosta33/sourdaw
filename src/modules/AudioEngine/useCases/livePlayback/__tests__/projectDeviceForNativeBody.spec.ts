/**
 * What a device says once it is addressed to the native engine (#3893).
 *
 * The engine resolves every key of a device's `parameterValues` against the
 * built-in's own vocabulary and refuses the whole batch over one it cannot
 * name, so a Fermenter chain sent in the ids a panel authors takes down every
 * strip travelling with it. The cases below therefore read the record that
 * reaches the wire, not the record the project holds.
 *
 * The projector is pure, so nothing is mocked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Device, type DeviceStateChunk } from '#/modules/Arrangement/stores';
import {
    grinderNeuralLibraryStore,
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    readGrinderNeuralModelContent,
} from '#/modules/Grinder/stores';

import { setAudioDeviceRuntimeSink } from '../../../engine/audioDeviceRuntimeSink';
import { projectDeviceForNativeBody } from '../projectDeviceForNativeBody';

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'knead', bypassed: false, parameterValues: {}, ...overrides };
}

const A_DEVICE_STATE: DeviceStateChunk = { version: 1, data: { kit: { name: 'Plain Bread' } } };

describe('projectDeviceForNativeBody', () => {
    afterEach(() => {
        setAudioDeviceRuntimeSink({});
    });

    it('uses supplied preparation dependencies without consulting the current runtime sink', () => {
        const unexpected = () => {
            throw new Error('Live projection was consulted');
        };
        setAudioDeviceRuntimeSink({
            projectNativeDeviceState: unexpected,
            nativeSampleBankKey: unexpected,
            nativeModAssignments: unexpected,
        });
        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'alternate', type: 'levain', parameterValues: { gain: 0.9 } }),
            {
                nativeSampleBankKey: ({ deviceState }) => {
                    expect(deviceState).toBeUndefined();
                    return 'levain:provided';
                },
                // Called unconditionally, the same as the bank-key hook above;
                // this device names no table, so `null` is the honest answer.
                nativeModAssignments: () => null,
                projectNativeDeviceState: () => ({ gain: 0.25, 'invalid key': 1, ignored: Number.NaN }),
            }
        );
        expect(projected.sampleBankKey).toBe('levain:provided');
        expect(projected.parameterValues).toEqual({ gain: 0.25 });
    });

    // The two vocabularies differ on both halves of the mapping: an override
    // renames the parameter outright, and everything else is the same word
    // respelled. A projector that did only one of them would still red here.
    it('spells a fermenter chain in the names the instrument answers to', () => {
        const projected = projectDeviceForNativeBody(
            createDevice({
                id: 'device-a',
                type: 'fermenter',
                parameterValues: { oscEngine: 2, filterCutoff: 800, oscLevel: 0.5 },
            })
        );

        expect(projected.parameterValues).toEqual({ engine: 2, cutoff: 800, osc_level: 0.5 });
    });

    it('leaves everything but the parameters of a projected device alone', () => {
        const device = createDevice({ id: 'device-a', type: 'fermenter', bypassed: true, name: 'Lead' });

        expect(projectDeviceForNativeBody(device)).toEqual({ ...device, parameterValues: {} });
    });

    // `knead` already names its parameters the way the engine does, so the
    // record it sends has to be the record the project holds.
    it('carries a knead chain through in the names the project already stores', () => {
        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'knead', parameterValues: { shift_semitones: 3 } })
        );

        expect(projected.parameterValues).toEqual({ shift_semitones: 3 });
    });

    // The engine case-folds a device type, so the renderer has to admit the
    // same spellings or a display-cased chain silently keeps its panel ids.
    it('projects a device whose type is spelled as a display name', () => {
        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'Fermenter', parameterValues: { oscEngine: 1 } })
        );

        expect(projected.parameterValues).toEqual({ engine: 1 });
    });

    // A hosted plugin's parameters are the plugin's own and the renderer holds
    // no vocabulary for them, so the projector must not so much as copy the
    // device: an identity check is what proves it never reached the record.
    it('returns a hosted plugin device exactly as it stands', () => {
        const device = createDevice({
            id: 'device-a',
            name: 'Pro-Q',
            type: 'plugin',
            externalPluginId: 'clap:com.example.eq',
            externalInstanceId: 'inst-1',
            parameterValues: { oscEngine: 2 },
        });

        expect(projectDeviceForNativeBody(device)).toBe(device);
    });

    it('returns a device of a type the engine builds no body for exactly as it stands', () => {
        const device = createDevice({ id: 'device-a', type: 'builtin-eq', parameterValues: { oscEngine: 2 } });

        expect(projectDeviceForNativeBody(device)).toBe(device);
    });

    // `Device.deviceState` never crosses the wire, so a body whose audible
    // identity lives there — Toaster's kit — needs it folded into the record
    // here. The kit wins on the overlapping name, the same way the web offline
    // path resolves it: `parameterValues` replays first, the kit hydrates after.
    it('merges a projected deviceState over the table projection, the kit winning on overlap', () => {
        setAudioDeviceRuntimeSink({
            projectNativeDeviceState: ({ deviceId, deviceType, deviceState }) => {
                expect(deviceId).toBe('device-a');
                expect(deviceType).toBe('toaster');
                expect(deviceState).toBe(A_DEVICE_STATE);
                return { master_gain: 0.4, delay_time: 375 };
            },
        });
        const projected = projectDeviceForNativeBody(
            createDevice({
                id: 'device-a',
                type: 'toaster',
                parameterValues: { masterGain: 0.9, swing: 0.2 },
                deviceState: A_DEVICE_STATE,
            })
        );

        expect(projected.parameterValues).toEqual({ master_gain: 0.4, swing: 0.2, delay_time: 375 });
    });

    // The wire narrows every value to an `f32` and refuses a key shaped unlike
    // any built-in's vocabulary, taking the whole batch with it — the same
    // hazard `tablePatch` guards `parameterValues` against, so a value crossing
    // this seam gets the same defence.
    it('drops a mis-shaped or non-finite key from the projected deviceState', () => {
        setAudioDeviceRuntimeSink({
            projectNativeDeviceState: () => ({
                master_gain: 0.4,
                'not a name': 1,
                lofi_bits: Number.NaN,
            }),
        });
        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'toaster', deviceState: A_DEVICE_STATE })
        );

        expect(projected.parameterValues).toEqual({ master_gain: 0.4 });
    });

    // A `null` projection means this device type carries nothing beyond
    // `parameterValues` (or the projector does not recognise it), and must
    // leave the table projection exactly as it stood.
    it('leaves the table projection untouched when the projector answers null', () => {
        setAudioDeviceRuntimeSink({ projectNativeDeviceState: () => null });
        const projected = projectDeviceForNativeBody(
            createDevice({
                id: 'device-a',
                type: 'grand-boule',
                parameterValues: { masterGain: 0.6 },
                deviceState: A_DEVICE_STATE,
            })
        );

        expect(projected.parameterValues).toEqual({ master_gain: 0.6 });
    });

    // Not every arm reads `deviceState` at all: Grand Boule's calibration
    // lives in its per-device store, keyed by `deviceId`, so the sink must be
    // asked (and its answer folded in) even for a device that has committed
    // no state chunk. Skipping the call here is what left a fresh native body
    // on the DSP's own defaults regardless of a calibrated store (#4302).
    it('calls the sink and folds its answer in for a body-backed device with no deviceState', () => {
        setAudioDeviceRuntimeSink({
            projectNativeDeviceState: ({ deviceId, deviceType, deviceState }) => {
                expect(deviceId).toBe('device-a');
                expect(deviceType).toBe('grand-boule');
                expect(deviceState).toBeUndefined();
                return { sustain_threshold: 0.4 };
            },
        });

        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'grand-boule', parameterValues: { masterGain: 0.6 } })
        );

        expect(projected.parameterValues).toEqual({ master_gain: 0.6, sustain_threshold: 0.4 });
    });

    // A device with no native body holds no vocabulary the projector could
    // address, so asking it would be pointless at best — and at worst a sink
    // implementation could be handed a device type it never expects.
    it('never calls the projector for a device with no native body', () => {
        let called = false;
        setAudioDeviceRuntimeSink({
            projectNativeDeviceState: () => {
                called = true;
                return null;
            },
        });

        projectDeviceForNativeBody(createDevice({ id: 'device-a', type: 'builtin-eq', deviceState: A_DEVICE_STATE }));

        expect(called).toBe(false);
    });

    // One body is built from staged material rather than from its record, so
    // the key the engine looks that material up under has to ride beside the
    // record. Without it `map_device` refuses the device by name.
    it('carries the bank key the sink reads off a device’s own state', () => {
        setAudioDeviceRuntimeSink({
            nativeSampleBankKey: ({ deviceType, deviceState }) => {
                expect(deviceType).toBe('levain');
                expect(deviceState).toBe(A_DEVICE_STATE);
                return 'levain:violin-1';
            },
        });

        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'levain', deviceState: A_DEVICE_STATE })
        );

        expect(projected.sampleBankKey).toBe('levain:violin-1');
    });

    // Absent rather than `undefined`: the payload for every body built from its
    // record stays exactly what the engine took before banks existed.
    it('leaves the field off a device whose state names no bank', () => {
        setAudioDeviceRuntimeSink({ nativeSampleBankKey: () => null });

        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'toaster', deviceState: A_DEVICE_STATE })
        );

        expect(Object.hasOwn(projected, 'sampleBankKey')).toBe(false);
    });

    // A device that has committed no state still sounds something, and only the
    // owning module knows what. Skipping the sink here sent a fresh Levain out
    // naming no bank, and `map_device` refuses the batch whole over one such
    // device on an audible strip — the whole project then declines native
    // carriage rather than playing its default instrument.
    it('asks the sink for the bank of a device holding no state at all', () => {
        const asked: { deviceType: string; deviceState: DeviceStateChunk | undefined }[] = [];
        setAudioDeviceRuntimeSink({
            nativeSampleBankKey: (input) => {
                asked.push(input);
                return input.deviceState === undefined ? 'levain:violin-1' : null;
            },
        });

        const projected = projectDeviceForNativeBody(createDevice({ id: 'device-a', type: 'levain' }));

        expect(projected.sampleBankKey).toBe('levain:violin-1');
        expect(asked).toEqual([{ deviceType: 'levain', deviceState: undefined }]);
    });

    it('leaves the field off a stateless device whose type sounds no bank', () => {
        setAudioDeviceRuntimeSink({ nativeSampleBankKey: () => null });

        const projected = projectDeviceForNativeBody(createDevice({ id: 'device-a', type: 'fermenter' }));

        expect(Object.hasOwn(projected, 'sampleBankKey')).toBe(false);
    });

    // A Bacteria device's modulation-assignment table rides the same seam as
    // the bank key and the projected deviceState: only the owning module can
    // decode `deviceState`, so this is where the sink's answer is folded into
    // the record the native body receives (#4685 slice 2).
    it('carries the modulation-assignment table the sink reads off a bacteria device’s state', () => {
        setAudioDeviceRuntimeSink({
            nativeModAssignments: ({ deviceType, deviceState }) => {
                expect(deviceType).toBe('bacteria');
                expect(deviceState).toBe(A_DEVICE_STATE);
                return [{ sourceId: 0, targetParam: 1, amount: 0.9 }];
            },
        });

        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'bacteria', deviceState: A_DEVICE_STATE })
        );

        expect(projected.modAssignments).toEqual([{ sourceId: 0, targetParam: 1, amount: 0.9 }]);
    });

    it('leaves the field off a device whose modulation-assignment hook answers null', () => {
        setAudioDeviceRuntimeSink({ nativeModAssignments: () => null });

        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'bacteria', deviceState: A_DEVICE_STATE })
        );

        expect(Object.hasOwn(projected, 'modAssignments')).toBe(false);
    });
});

describe('native Grinder saved-project full network projection', () => {
    function importedEntry(): NonNullable<typeof grinderNeuralLibraryStore.value>['entries'][number] {
        return {
            id: 'imported',
            source: 'imported',
            name: 'Linear reference',
            family: 'Reference',
            placement: 'amp-capture',
            description: 'test',
            importedAt: 1,
            sourceFileName: 'linear.nam',
            sourceFileText: null,
            profile: {
                derivedFrom: 'nam',
                sourceArchitecture: 'Linear',
                sourceSampleRate: 48000,
                sourceWeightCount: 2,
                preferredTier: 'standard',
                inputDrive: 1,
                asymmetry: 0,
                outputTrim: 1,
                contourMix: 0,
                recurrentBias: 0,
                convWeights: [[0, 1, 0]],
                modelDigest: '0001-0002-0003-0004',
                model: {
                    architecture: 'Linear',
                    version: null,
                    sampleRate: 48000,
                    config: { receptive_field: 2, bias: false },
                    weights: [0.25, -0.5],
                },
            },
        };
    }

    function savedDevice(): Device {
        return createDevice({
            id: 'd-nam',
            type: 'grinder',
            parameterValues: {
                engineMode: 1,
                neuralModelMode: 1,
                neuralModelSlot: 2,
                neuralCustomTier: 0,
                neuralCustomInputDrive: 1,
                neuralCustomAsymmetry: 0,
                neuralCustomOutputTrim: 1,
                neuralCustomContourMix: 0,
                neuralCustomLstmBias: 0,
                neuralCustomConvWeight0_0: 0,
                neuralCustomConvWeight0_1: 1,
                neuralCustomConvWeight0_2: 0,
                neuralCustomModelDigest0: 1,
                neuralCustomModelDigest1: 2,
                neuralCustomModelDigest2: 3,
                neuralCustomModelDigest3: 4,
            },
        });
    }

    function entryWithModelBytes(byteLength: number) {
        const entry = importedEntry();
        const model = entry.profile.model;
        if (!model) {
            throw new Error('Full model fixture is required');
        }
        const config = { ...model.config, description: '' };
        const emptyContent = JSON.stringify({
            architecture: model.architecture,
            config,
            weights: model.weights,
            sample_rate: model.sampleRate,
        });
        const contentOverhead = new TextEncoder().encode(emptyContent).byteLength;
        entry.profile.model = {
            ...model,
            config: { ...config, description: `é${'x'.repeat(byteLength - contentOverhead - 2)}` },
        };
        return entry;
    }

    afterEach(() => {
        vi.restoreAllMocks();
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
    });

    it('resolves an unopened persisted model identity and refuses its missing library content', () => {
        const entry = importedEntry();
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, hydrated: true, entries: [entry] });
        const device = savedDevice();
        const projected = projectDeviceForNativeBody(device);
        expect(JSON.parse(projected.grinderModel?.modelJson ?? 'null')).toEqual({
            architecture: 'Linear',
            sample_rate: 48000,
            config: { receptive_field: 2, bias: false },
            weights: [0.25, -0.5],
        });
        expect(projected.parameterValues.neuralModelSlot).toBeUndefined();
        expect(device).not.toHaveProperty('grinderModel');
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
        expect(() => projectDeviceForNativeBody(device)).toThrow(/unavailable/);
    });

    it('assigns fresh native request identity without changing the owned content or saved device', () => {
        const entry = importedEntry();
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry] });
        const device = savedDevice();
        const original = structuredClone(device);
        const uuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
        const modelJson = readGrinderNeuralModelContent(device.parameterValues);
        expect(uuid).not.toHaveBeenCalled();
        const first = projectDeviceForNativeBody(device);
        const second = projectDeviceForNativeBody(device);
        expect(first.grinderModel).toEqual({ requestId: '11111111-1111-4111-8111-111111111111', modelJson });
        expect(second.grinderModel).toEqual({ requestId: '22222222-2222-4222-8222-222222222222', modelJson });
        expect(uuid).toHaveBeenCalledTimes(2);
        expect(device).toEqual(original);
        expect(device).not.toHaveProperty('grinderModel');
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
        expect(first.grinderModel?.modelJson).toBe(modelJson);
    });

    it('refuses unavailable or ambiguous content before allocating native request identity', () => {
        const device = savedDevice();
        const uuid = vi.spyOn(crypto, 'randomUUID');
        expect(() => projectDeviceForNativeBody(device)).toThrow(
            'Imported Grinder NAM content is unavailable in the neural library'
        );
        const entry = importedEntry();
        const missing = { ...entry, profile: { ...entry.profile, model: null } };
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry, missing] });
        expect(() => projectDeviceForNativeBody(device)).toThrow(
            'Imported Grinder NAM identity is ambiguous in the neural library'
        );
        expect(
            projectDeviceForNativeBody(
                createDevice({
                    id: 'factory',
                    type: 'grinder',
                    parameterValues: {
                        neuralModelMode: 0,
                        neuralModelSlot: 1,
                    },
                })
            )
        ).not.toHaveProperty('grinderModel');
        expect(
            projectDeviceForNativeBody(
                createDevice({
                    id: 'legacy',
                    type: 'grinder',
                    parameterValues: {
                        neuralModelMode: 1,
                        neuralCustomInputDrive: 1,
                    },
                })
            )
        ).not.toHaveProperty('grinderModel');
        expect(uuid).not.toHaveBeenCalled();
    });

    it('admits exactly 1 MiB of UTF-8 model content and refuses one byte more before request allocation', () => {
        const device = savedDevice();
        const uuid = vi.spyOn(crypto, 'randomUUID');
        const oversized = entryWithModelBytes(1_048_577);
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [oversized] });
        const oversizedContent = readGrinderNeuralModelContent(device.parameterValues);
        expect(new TextEncoder().encode(oversizedContent).byteLength).toBe(1_048_577);
        expect(oversizedContent?.length).toBe(1_048_576);
        expect(() => projectDeviceForNativeBody(device)).toThrow(
            'Imported Grinder NAM exceeds the native model byte limit'
        );
        expect(uuid).not.toHaveBeenCalled();
        const boundary = entryWithModelBytes(1_048_576);
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [boundary] });
        const content = readGrinderNeuralModelContent(device.parameterValues);
        expect(new TextEncoder().encode(content).byteLength).toBe(1_048_576);
        expect(projectDeviceForNativeBody(device).grinderModel?.modelJson).toBe(content);
        expect(uuid).toHaveBeenCalledTimes(1);
    });
});
