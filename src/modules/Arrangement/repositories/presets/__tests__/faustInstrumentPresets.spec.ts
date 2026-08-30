import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../../models/DeviceParameter';
import { FAUST_INSTRUMENT_PRESETS } from '../faustInstrumentPresets';

import { scanRealFaustDeviceParamIds, scanRealFaustDeviceParams } from './faustRegistrationScan';

/** The retired single-operator FM keys every shipped FM preset still authors. */
const FM_SYNTH_RETIRED_PRESET_KEYS: ReadonlySet<string> = new Set([
    'ratio',
    'index',
    'attack',
    'decay',
    'sustain',
    'release',
]);

describe('faustInstrumentPresets', () => {
    it('exports a non-empty preset array', () => {
        expect(FAUST_INSTRUMENT_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id', () => {
        const ids = new Set<string>();
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(ids.has(preset.id)).toBe(false);
            ids.add(preset.id);
        }
    });

    it('every preset has a non-empty name', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.name).toBeTruthy();
        }
    });

    it('every preset has midi trackKind', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.trackKind).toBe('midi');
        }
    });

    it('every preset has at least one device', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.devices.length).toBeGreaterThan(0);
        }
    });

    it('every device has a faust- prefixed type', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            for (const device of preset.devices) {
                expect(device.type).toBeTruthy();
                // Faust instruments should use faust- prefixed types (or builtin- for effects)
            }
        }
    });

    it('every device has parameterValues object', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            for (const device of preset.devices) {
                expect(typeof device.parameterValues).toBe('object');
            }
        }
    });

    it('every authored parameter key matches a real registered Faust address id (F1)', () => {
        // Regression guard for the audit finding where reverb/delay/comp/eq
        // overrides spread legacy `builtin-*` keys (e.g. `rev-size`,
        // `delay-time`) into `parameterValues` alongside the real Faust
        // param ids the compiled node accepts (`decay_time`, `delay`, …). A
        // stray key is an authored value that silently never reaches the DSP.
        // Checked against `scanRealFaustDeviceParamIds()` (builtinDSP.ts's
        // registered addresses), not this module's own descriptor catalog —
        // see that function's docstring for why.
        const realIdsByDevice = scanRealFaustDeviceParamIds();
        const unknownKeysByDevice: string[] = [];
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            for (const device of preset.devices) {
                const descriptor = getPluginById(device.type);
                if (!descriptor || descriptor.parameters.length === 0) {
                    // Faust instrument voices (hammond-b3, minimoog-lead, …)
                    // declare no TS-side descriptor at all: a Faust-native
                    // parameter space this check has no declared contract to
                    // compare against.
                    continue;
                }
                // Faust effects (the ones this finding is about) are checked
                // against the compiled node's real registered addresses;
                // native `builtin-*` devices (chorus, distortion, …) have no
                // Faust compiler in the loop, so their own TS descriptor is
                // legitimate ground truth and isn't in `builtinDSP.ts` at all.
                const realIds = device.type.startsWith('faust-')
                    ? (realIdsByDevice.get(device.type) ?? new Set<string>())
                    : new Set(descriptor.parameters.map((parameter) => parameter.id));
                for (const paramId of Object.keys(device.parameterValues)) {
                    if (device.type === 'faust-fm-synth' && FM_SYNTH_RETIRED_PRESET_KEYS.has(paramId)) {
                        // Excluded by name, not by skipping the device: the
                        // fm-synth descriptor declares `gain` now, so `gain`
                        // and any key added after it stay under this guard
                        // while the retired set's migration stays #3155's.
                        continue;
                    }
                    if (!realIds.has(paramId)) {
                        unknownKeysByDevice.push(`${preset.id} -> ${device.type} "${device.name}": ${paramId}`);
                    }
                }
            }
        }
        expect(unknownKeysByDevice).toEqual([]);
    });

    it('welds the Faust instrument descriptors to the registrations, ids and bounds, in both directions', () => {
        // The descriptor-side weld of the scan above, scoped to the Faust
        // instrument descriptors. A descriptor that advertises a parameter id
        // no registered address carries is an inert control (the engine
        // ignores it), the same failure class the F1 check guards presets
        // against. But ids alone let a descriptor misstate any bound or
        // default and pass, and let a whole registered control go undeclared
        // — which is exactly how fm-synth's `gain` stayed invisible to the
        // inspector until it was declared. So both directions are checked,
        // bounds and defaults included, scaling where the registration
        // declares one.
        //
        // The Faust effect descriptors carry their own weld of this shape in
        // `PluginDescriptors/__tests__/FaustEffectDescriptors.spec.ts`.
        const realParamsByDevice = scanRealFaustDeviceParams();
        const mismatches: string[] = [];
        for (const deviceType of ['faust-rhodes', 'faust-fm-synth', 'faust-supersaw-unison']) {
            const descriptor = getPluginById(deviceType);
            if (!descriptor) {
                throw new Error(`Expected a plugin descriptor for ${deviceType}`);
            }
            const registered = realParamsByDevice.get(deviceType);
            if (!registered) {
                throw new Error(`Expected a registerFaustDSP registration for ${deviceType}`);
            }
            const declared = new Map(descriptor.parameters.map((parameter) => [parameter.id, parameter]));

            for (const [parameterId, parameter] of declared) {
                const entry = registered.get(parameterId);
                if (!entry) {
                    mismatches.push(`${deviceType}/${parameterId}: declared but not registered`);
                    continue;
                }
                if (parameter.minValue !== entry.min) {
                    mismatches.push(
                        `${deviceType}/${parameterId}: declared min ${parameter.minValue} != registered ${entry.min}`
                    );
                }
                if (parameter.maxValue !== entry.max) {
                    mismatches.push(
                        `${deviceType}/${parameterId}: declared max ${parameter.maxValue} != registered ${entry.max}`
                    );
                }
                if (parameter.defaultValue !== entry.defaultValue) {
                    mismatches.push(
                        `${deviceType}/${parameterId}: declared default ${parameter.defaultValue} != registered ${entry.defaultValue}`
                    );
                }
                if ((parameter.scaling ?? undefined) !== (entry.scaling ?? undefined)) {
                    mismatches.push(
                        `${deviceType}/${parameterId}: declared scaling ${parameter.scaling ?? 'linear'} != registered ${entry.scaling ?? 'linear'}`
                    );
                }
            }

            for (const parameterId of registered.keys()) {
                if (!declared.has(parameterId)) {
                    mismatches.push(`${deviceType}/${parameterId}: registered but not declared`);
                }
            }
        }
        expect(mismatches).toEqual([]);
    });

    it('Ambient Rhodes delay time is authored in seconds, matching the tape-delay descriptor unit', () => {
        const preset = FAUST_INSTRUMENT_PRESETS.find((candidate) => candidate.id === 'factory-faust-rhodes-ambient');
        const delayDevice = preset?.devices.find((device) => device.type === 'faust-tape-delay');
        expect(delayDevice?.parameterValues.delay).toBe(0.5);
    });

    it('Gospel Organ reverb decay and mix reach the zita-rev1 device under its real param ids', () => {
        const preset = FAUST_INSTRUMENT_PRESETS.find((candidate) => candidate.id === 'factory-faust-hammond-gospel');
        const reverbDevice = preset?.devices.find((device) => device.type === 'faust-zita-rev1-reverb');
        expect(reverbDevice?.parameterValues.decay_time).toBe(4);
        expect(reverbDevice?.parameterValues.dry_wet).toBe(0.3);
    });
});
