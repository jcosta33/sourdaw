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

import { afterEach, describe, expect, it } from 'vitest';

import { type Device, type DeviceStateChunk } from '#/modules/Arrangement/stores';

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
            projectNativeDeviceState: ({ deviceType, deviceState }) => {
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

    it('leaves the field off a device holding no state at all', () => {
        let called = false;
        setAudioDeviceRuntimeSink({
            nativeSampleBankKey: () => {
                called = true;
                return 'levain:violin-1';
            },
        });

        const projected = projectDeviceForNativeBody(createDevice({ id: 'device-a', type: 'levain' }));

        expect(Object.hasOwn(projected, 'sampleBankKey')).toBe(false);
        expect(called).toBe(false);
    });
});
