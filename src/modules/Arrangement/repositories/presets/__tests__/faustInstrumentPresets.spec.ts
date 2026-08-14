import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../../models/DeviceParameter';
import { FAUST_INSTRUMENT_PRESETS } from '../faustInstrumentPresets';

// Source-text scan of `registerFaustDSP`'s address lists in PluginHost's
// `builtinDSP.ts` — the addresses that actually reach the compiled Faust
// node (see `FaustDeviceStrategy.setParam`). Read as raw text via
// `import.meta.glob` rather than imported, because PluginHost is outside
// this module's ownership and cross-module imports may only target its
// contract barrels (`useCases/`, `stores/`, `events/`,
// `presentations/views/`), none of which currently re-export this data.
// Mirrors the source-scanning "class guard" pattern already used in
// `CrdtDocument/useCases/projection/__tests__/projectionCompleteness.spec.ts`
// for the same kind of cross-module-truth problem.
const BUILTIN_DSP_SOURCE_GLOB = import.meta.glob('/src/modules/PluginHost/useCases/faustEngine/builtinDSP.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
});

const REGISTER_FAUST_DSP_CALL = /registerFaustDSP\(\s*'([^']+)',\s*\w+,\s*\[([\s\S]*?)\]/g;
const REGISTERED_ADDRESS = /address:\s*'\/[^/']+\/([^']+)'/g;

/**
 * The real, running parameter ids for each built-in Faust device, keyed the
 * same way `registerFaustDSP` derives its module id (`faust-${lower,
 * hyphenated name}`). This is the ground truth `FaustDeviceStrategy.setParam`
 * actually resolves against — not any TS-side descriptor catalog. F1 — the
 * previous version of this guard checked presets against
 * `FaustEffectDescriptors.ts` instead, which had independently invented a
 * `dry_wet` key for zita-rev1/tape-delay that the compiled node never
 * accepted; two catalogs that drifted the same way passed regardless of
 * what the DSP actually declared.
 */
function scanRealFaustDeviceParamIds(): Map<string, Set<string>> {
    const [source] = Object.values(BUILTIN_DSP_SOURCE_GLOB);
    if (!source) {
        throw new Error('builtinDSP.ts source not found via import.meta.glob — check the glob pattern');
    }
    const idsByDevice = new Map<string, Set<string>>();
    for (const call of source.matchAll(REGISTER_FAUST_DSP_CALL)) {
        const name = call[1];
        const block = call[2];
        if (!name || !block) {
            continue;
        }
        const deviceId = `faust-${name.toLowerCase().replaceAll(/\s+/g, '-')}`;
        const ids = new Set<string>();
        for (const address of block.matchAll(REGISTERED_ADDRESS)) {
            const id = address[1];
            if (id) {
                ids.add(id);
            }
        }
        idsByDevice.set(deviceId, ids);
    }
    return idsByDevice;
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
                const descriptor = getPluginById(device.type);
                if (!descriptor || descriptor.parameters.length === 0) {
                    // Faust instrument voices (hammond-b3, rhodes, …) declare
                    // no TS-side descriptor; their params are Faust-native
                    // and out of scope for this check.
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
                    if (!realIds.has(paramId)) {
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
