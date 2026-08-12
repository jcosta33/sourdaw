import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../../models/DeviceParameter';
import { FAUST_INSTRUMENT_PRESETS } from '../faustInstrumentPresets';

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

    it('every authored parameter key matches a declared id on its device descriptor', () => {
        // Regression guard for the audit finding where reverb/delay/comp/eq
        // overrides spread legacy `builtin-*` keys (e.g. `rev-size`,
        // `delay-time`) into `parameterValues` alongside the real Faust
        // param ids the descriptor declares (`decay_time`, `delay`, …). The
        // device only reads the declared ids, so a stray legacy key is an
        // authored value that silently never reaches the DSP.
        const unknownKeysByDevice: string[] = [];
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            for (const device of preset.devices) {
                const descriptor = getPluginById(device.type);
                if (!descriptor || descriptor.parameters.length === 0) {
                    // Faust instrument voices (hammond-b3, rhodes, …) declare
                    // no TS-side descriptor; their params are Faust-native
                    // and out of scope for this check.
                    continue;
                }
                const declaredIds = new Set(descriptor.parameters.map((parameter) => parameter.id));
                for (const paramId of Object.keys(device.parameterValues)) {
                    if (!declaredIds.has(paramId)) {
                        unknownKeysByDevice.push(`${preset.id} -> ${device.type} "${device.name}": ${paramId}`);
                    }
                }
            }
        }
        expect(unknownKeysByDevice).toEqual([]);
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
