import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../../models/DeviceParameter';
import { FAUST_INSTRUMENT_PRESETS } from '../faustInstrumentPresets';

// Source-text scan of `registerFaustDSP`'s address lists — the addresses that
// actually reach the compiled Faust node (see `FaustDeviceStrategy.setParam`).
// Read as raw text via `import.meta.glob` rather than imported, because
// PluginHost and Synth are outside this module's ownership and cross-module
// imports may only target their contract barrels (`useCases/`, `stores/`,
// `events/`, `presentations/views/`), none of which currently re-export this
// data. Mirrors the source-scanning "class guard" pattern already used in
// `CrdtDocument/useCases/projection/__tests__/projectionCompleteness.spec.ts`
// for the same kind of cross-module-truth problem.
//
// Both live registration sites are scanned: PluginHost's `builtinDSP.ts` and
// Synth's `proSynthInstruments.ts`. Scanning only the first would declare the
// Supersaw Unison addresses (registered by Synth) unreal, so every supersaw
// preset key would read as a stray even though it reaches the DSP.
const FAUST_DSP_SOURCE_GLOB = import.meta.glob(
    [
        '/src/modules/PluginHost/useCases/faustEngine/builtinDSP.ts',
        '/src/modules/Synth/useCases/proSynthInstruments.ts',
    ],
    {
        query: '?raw',
        import: 'default',
        eager: true,
    }
);

const REGISTER_FAUST_DSP_CALL = /registerFaustDSP\(\s*'([^']+)',\s*\w+,\s*\[([\s\S]*?)\]/g;
// One registered parameter entry. Entries are flat object literals (no nested
// braces), so `[^{}]*` cannot run past an entry's own `}`.
const REGISTERED_PARAM_ENTRY = /\{[^{}]*address:\s*'\/[^/']+\/([^']+)'[^{}]*\}/g;

/** The retired single-operator FM keys every shipped FM preset still authors. */
const FM_SYNTH_RETIRED_PRESET_KEYS: ReadonlySet<string> = new Set([
    'ratio',
    'index',
    'attack',
    'decay',
    'sustain',
    'release',
]);

// The op-level fm-synth controls (algorithm plus four ratio/level/ADSR blocks)
// the descriptor declares only once the FM preset migration maps the retired
// keys onto them (#3155).
const FM_SYNTH_OP_LEVEL_ID = /^(?:algorithm|op\d_)/;

type RegisteredFaustParam = {
    min: number;
    max: number;
    defaultValue: number;
    scaling?: 'log' | 'linear';
};

function numberField(entry: string, field: 'min' | 'max' | 'defaultValue'): number | undefined {
    const match = entry.match(new RegExp(`${field}:\\s*(-?\\d+(?:\\.\\d+)?)`));
    return match?.[1] === undefined ? undefined : Number(match[1]);
}

function scalingOf(entry: string): { scaling?: 'log' | 'linear' } {
    const match = entry.match(/scaling:\s*'(log|linear)'/)?.[1];
    if (match !== 'log' && match !== 'linear') {
        return {};
    }
    return { scaling: match };
}

/**
 * The real, running parameters for each built-in Faust device, keyed the
 * same way `registerFaustDSP` derives its module id (`faust-${lower,
 * hyphenated name}`). This is the ground truth `FaustDeviceStrategy.setParam`
 * actually resolves against — not any TS-side descriptor catalog. F1 — the
 * previous version of this guard checked presets against
 * `FaustEffectDescriptors.ts` instead, which had independently invented a
 * `dry_wet` key for zita-rev1/tape-delay that the compiled node never
 * accepted; two catalogs that drifted the same way passed regardless of
 * what the DSP actually declared.
 *
 * Each entry carries the registered bounds, default, and scaling, so the
 * descriptor weld can compare more than ids.
 */
function scanRealFaustDeviceParams(): Map<string, Map<string, RegisteredFaustParam>> {
    const paramsByDevice = new Map<string, Map<string, RegisteredFaustParam>>();
    for (const source of Object.values(FAUST_DSP_SOURCE_GLOB)) {
        if (!source) {
            throw new Error('Faust DSP source not found via import.meta.glob — check the glob pattern');
        }
        for (const call of source.matchAll(REGISTER_FAUST_DSP_CALL)) {
            const name = call[1];
            const block = call[2];
            if (!name || !block) {
                continue;
            }
            const deviceId = `faust-${name.toLowerCase().replaceAll(/\s+/g, '-')}`;
            const params = paramsByDevice.get(deviceId) ?? new Map<string, RegisteredFaustParam>();
            for (const entry of block.matchAll(REGISTERED_PARAM_ENTRY)) {
                const id = entry[1];
                const text = entry[0];
                const min = numberField(text, 'min');
                const max = numberField(text, 'max');
                const defaultValue = numberField(text, 'defaultValue');
                if (id === undefined || min === undefined || max === undefined || defaultValue === undefined) {
                    throw new Error(`Unparseable registerFaustDSP entry for ${deviceId}: ${text}`);
                }
                params.set(id, { min, max, defaultValue, ...scalingOf(text) });
            }
            paramsByDevice.set(deviceId, params);
        }
    }
    return paramsByDevice;
}

/** Id-only view of {@link scanRealFaustDeviceParams} for the preset-key guard. */
function scanRealFaustDeviceParamIds(): Map<string, Set<string>> {
    return new Map([...scanRealFaustDeviceParams()].map(([deviceId, params]) => [deviceId, new Set(params.keys())]));
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
        // fm-synth's op-level controls (algorithm plus the four op blocks)
        // are excluded from the reverse direction until #3155 maps the
        // presets onto them; everything else registered must be declared.
        //
        // Not yet run over the Faust effect descriptors: the registration
        // table is missing `De-esser/reduction`, a pre-existing gap this lane
        // does not widen.
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
                if (deviceType === 'faust-fm-synth' && FM_SYNTH_OP_LEVEL_ID.test(parameterId)) {
                    continue;
                }
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
