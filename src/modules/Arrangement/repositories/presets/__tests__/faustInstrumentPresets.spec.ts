import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../../models/DeviceParameter';
import { FAUST_INSTRUMENT_PRESETS } from '../faustInstrumentPresets';

import { scanRealFaustDeviceParamIds, scanRealFaustDeviceParams } from './faustRegistrationScan';

/**
 * The envelope keys every shipped additive preset still authors. The additive
 * DSP hardcodes its ADSR, so these never reached the audio; they stay authored
 * until the DSP grows real envelope controls or the presets drop the dead keys
 * (follow-up filed from #3172's widened compile scan).
 */
const ADDITIVE_SYNTH_RETIRED_PRESET_KEYS: ReadonlySet<string> = new Set(['attack', 'decay', 'sustain', 'release']);

/**
 * The ground truth an authored preset key is checked against.
 *
 * A Faust device is checked against the registration scan — the addresses the
 * compiled node actually accepts — whether or not a TS-side descriptor exists,
 * because a descriptor-less Faust voice (hammond-b3, minimoog-lead, …) still
 * has that real contract. A faust- device with no registration has no address
 * table to compare keys against (a preset naming an unregistered device is a
 * device-resolution defect, not a stray-key one). Native `builtin-*` devices
 * have no Faust compiler in the loop, so their own TS descriptor is the
 * legitimate ground truth; a device with neither has nothing to compare
 * against.
 */
function realParamIdsOf(deviceType: string, realIdsByDevice: Map<string, Set<string>>): Set<string> | null {
    if (deviceType.startsWith('faust-')) {
        return realIdsByDevice.get(deviceType) ?? null;
    }
    const descriptor = getPluginById(deviceType);
    if (!descriptor || descriptor.parameters.length === 0) {
        return null;
    }
    return new Set(descriptor.parameters.map((parameter) => parameter.id));
}

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
                const realIds = realParamIdsOf(device.type, realIdsByDevice);
                if (!realIds) {
                    continue;
                }
                for (const paramId of Object.keys(device.parameterValues)) {
                    if (device.type === 'faust-additive-synth' && ADDITIVE_SYNTH_RETIRED_PRESET_KEYS.has(paramId)) {
                        // Same shape as the fm-synth guard above: excluded by
                        // name, not by skipping the device, so a new additive
                        // key that misses the DSP still goes red here.
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

    it('FM synth factory presets author current four-operator controls inside real bounds', () => {
        const registeredParams = scanRealFaustDeviceParams().get('faust-fm-synth');
        if (!registeredParams) {
            throw new Error('Expected a registerFaustDSP registration for faust-fm-synth');
        }

        const fmDevices = FAUST_INSTRUMENT_PRESETS.flatMap((preset) =>
            preset.devices
                .filter((device) => device.type === 'faust-fm-synth')
                .map((device) => ({ presetId: preset.id, device }))
        );
        const timbreFingerprints = new Set<string>();

        for (const { presetId, device } of fmDevices) {
            const parameterIds = Object.keys(device.parameterValues);
            expect(parameterIds).not.toEqual(
                expect.arrayContaining(['ratio', 'index', 'attack', 'decay', 'sustain', 'release'])
            );
            expect(parameterIds).not.toContain('freq');
            expect(parameterIds).not.toContain('gate');
            expect(parameterIds.some((parameterId) => parameterId.startsWith('op1_'))).toBe(true);
            expect(parameterIds.some((parameterId) => /^op[2-4]_/.test(parameterId))).toBe(true);

            for (const [parameterId, value] of Object.entries(device.parameterValues)) {
                const registeredParam = registeredParams.get(parameterId);
                if (!registeredParam) {
                    throw new Error(`${presetId}/${parameterId}: authored but not registered`);
                }
                expect(value).toBeGreaterThanOrEqual(registeredParam.min);
                expect(value).toBeLessThanOrEqual(registeredParam.max);
            }

            timbreFingerprints.add(
                JSON.stringify(
                    Object.entries(device.parameterValues)
                        .filter(([parameterId]) => parameterId !== 'gain')
                        .sort(([left], [right]) => left.localeCompare(right))
                )
            );
        }

        expect(timbreFingerprints.size).toBe(fmDevices.length);
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
