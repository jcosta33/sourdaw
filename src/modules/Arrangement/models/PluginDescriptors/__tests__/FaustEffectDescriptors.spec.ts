import { describe, expect, it } from 'vitest';

import {
    isOutputMeter,
    scanRealFaustDeviceParams,
} from '../../../repositories/presets/__tests__/faustRegistrationScan';
import { FAUST_EFFECT_PRESETS } from '../../../repositories/presets/faustEffectPresets';
import { FAUST_EFFECT_DESCRIPTORS } from '../FaustEffectDescriptors';

describe('FaustEffectDescriptors', () => {
    it('exports effect descriptors', () => {
        expect(FAUST_EFFECT_DESCRIPTORS.length).toBeGreaterThan(0);
    });

    it('every descriptor has a unique faust- prefixed id', () => {
        const ids = new Set<string>();
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(desc.id).toMatch(/^faust-/);
            expect(ids.has(desc.id)).toBe(false);
            ids.add(desc.id);
        }
    });

    it('every descriptor has non-empty name and vendor', () => {
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(desc.name).toBeTruthy();
            expect(desc.vendor).toBeTruthy();
        }
    });

    it('every descriptor has a valid category', () => {
        const validCategories = new Set(['effect', 'analyzer', 'utility']);
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(validCategories.has(desc.category)).toBe(true);
        }
    });

    it('every descriptor has a parameters array', () => {
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(Array.isArray(desc.parameters)).toBe(true);
        }
    });

    it('includes well-known faust effect ids', () => {
        const ids = FAUST_EFFECT_DESCRIPTORS.map((d) => d.id);
        expect(ids).toContain('faust-1176-compressor');
        expect(ids).toContain('faust-tape-delay');
        expect(ids).toContain('faust-zita-rev1-reverb');
    });

    // Pre-existing registration-side default drift this weld pins but does not
    // repair: in both entries the descriptor matches the DSP's own hslider
    // init and only the builtinDSP.ts row drifted, so the repair is a one-line
    // registration edit and this line's deletion in the same change. The list
    // must only ever shrink; an empty list deletes the constant and leaves the
    // plain equality below.
    const KNOWN_EFFECT_REGISTRATION_DRIFT: readonly string[] = [
        'faust-noise-gate/threshold: declared default -40 != registered -60',
        'faust-spring-reverb/mix: declared default 0.3 != registered 0.25',
    ];

    it('welds the Faust effect descriptors to the registrations, ids and bounds, in both directions', () => {
        // The #3156 defect class: `De-esser/reduction` was declared here and
        // compiled by the DSP but had no `registerFaustDSP` row, so neither
        // catalog carried the other's default/range source for it — and the
        // De-esser threshold row stated a default no other catalog shared.
        // `shippedDspCompile.spec.ts` welds descriptors and registration
        // addresses against the compiled node, but nothing compared these two
        // TS catalogs to each other, so an omitted or misstated row passed
        // every existing check. Both directions, bounds and defaults included:
        // a declared id with no row is an unwelded control, and a row no
        // descriptor declares is an invisible one.
        //
        // Bargraph rows (LUFS Meter's momentary/short_term) are excluded from
        // the reverse direction: they are meters the node emits, not settable
        // controls, and the analyzer descriptor deliberately declares none.
        //
        // Scaling is not compared here, unlike the instrument weld: Faust
        // slider declarations carry no scaling, the registration's optional
        // scaling field has no runtime reader, and the descriptor owns UI
        // scaling — so descriptor/registration scaling divergence has no DSP
        // arbiter and is not a bounds defect.
        const realParamsByDevice = scanRealFaustDeviceParams();
        const mismatches: string[] = [];
        for (const descriptor of FAUST_EFFECT_DESCRIPTORS) {
            const registered = realParamsByDevice.get(descriptor.id);
            if (!registered) {
                throw new Error(`Expected a registerFaustDSP registration for ${descriptor.id}`);
            }
            const declared = new Map(descriptor.parameters.map((parameter) => [parameter.id, parameter]));

            for (const [parameterId, parameter] of declared) {
                const entry = registered.get(parameterId);
                if (!entry) {
                    mismatches.push(`${descriptor.id}/${parameterId}: declared but not registered`);
                    continue;
                }
                if (parameter.minValue !== entry.min) {
                    mismatches.push(
                        `${descriptor.id}/${parameterId}: declared min ${parameter.minValue} != registered ${entry.min}`
                    );
                }
                if (parameter.maxValue !== entry.max) {
                    mismatches.push(
                        `${descriptor.id}/${parameterId}: declared max ${parameter.maxValue} != registered ${entry.max}`
                    );
                }
                if (parameter.defaultValue !== entry.defaultValue) {
                    mismatches.push(
                        `${descriptor.id}/${parameterId}: declared default ${parameter.defaultValue} != registered ${entry.defaultValue}`
                    );
                }
            }

            for (const [parameterId, entry] of registered) {
                if (isOutputMeter(entry)) {
                    continue;
                }
                if (!declared.has(parameterId)) {
                    mismatches.push(`${descriptor.id}/${parameterId}: registered but not declared`);
                }
            }
        }
        expect([...mismatches].sort()).toEqual(KNOWN_EFFECT_REGISTRATION_DRIFT);
    });
});

describe('faustEffectPresets', () => {
    it('exports presets', () => {
        expect(FAUST_EFFECT_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id', () => {
        const ids = new Set<string>();
        for (const preset of FAUST_EFFECT_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(ids.has(preset.id)).toBe(false);
            ids.add(preset.id);
        }
    });

    it('every preset has a non-empty name', () => {
        for (const preset of FAUST_EFFECT_PRESETS) {
            expect(preset.name).toBeTruthy();
        }
    });

    it('every preset has at least one device', () => {
        for (const preset of FAUST_EFFECT_PRESETS) {
            expect(preset.devices.length).toBeGreaterThan(0);
        }
    });

    it('every device has a faust- prefixed type', () => {
        for (const preset of FAUST_EFFECT_PRESETS) {
            for (const device of preset.devices) {
                expect(device.type).toMatch(/^faust-/);
            }
        }
    });
});
