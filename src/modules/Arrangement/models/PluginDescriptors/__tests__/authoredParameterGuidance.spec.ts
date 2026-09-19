import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';
import {
    type DeviceParameterGuidance,
    type PluginDescriptor,
    type PluginDescriptorGuidance,
} from '../../DeviceParameterTypes';
import { BUILTIN_EFFECT_DESCRIPTORS } from '../BuiltinEffectDescriptors';
import { FAUST_EFFECT_DESCRIPTORS } from '../FaustEffectDescriptors';
import { defaultCenteredRange } from '../GuidanceProfiles';
import { NATIVE_DSP_DESCRIPTORS } from '../NativeDspDescriptors';

/**
 * `assertGuidanceCoverage` (in `DescriptorGuidance.ts`) only proves a
 * descriptor has *some* guidance for every parameter and rejects the two
 * literal generic strings `'continuous-control'`/`'audible-parameter'`. It
 * does not catch guidance authored once per device and copied onto every
 * parameter — the shape `declaredControl`'s fallback produces — because
 * copied text still satisfies "non-empty and not the literal placeholder".
 *
 * This file censuses every effect descriptor's `parameterOverrides` for the
 * defect that check cannot see: role text shared across a device's own
 * parameters, a `typicalRange` equal to the generic default-centered
 * fallback, and an effect descriptor that never joined the census at all.
 * Instrument descriptors are excluded by the pinned id list below; a later,
 * out-of-scope change empties that list as instruments gain the same
 * per-parameter authoring.
 */

// ── Population: every effect descriptor is named, and only once ────────────

/**
 * Every effect-category descriptor id this file censuses.
 *
 * Pinned rather than derived from `category` so a new effect descriptor that
 * forgets to extend this list fails loudly here instead of silently
 * inheriting whatever the shared fallback produces.
 */
const EFFECT_IDS_UNDER_CENSUS = [
    // BuiltinEffectDescriptors.ts (19)
    'builtin-eq',
    'builtin-compressor',
    'builtin-reverb',
    'builtin-delay',
    'builtin-gain',
    'builtin-sidechain-compressor',
    'builtin-chorus',
    'builtin-phaser',
    'builtin-distortion',
    'builtin-limiter',
    'builtin-flanger',
    'builtin-tremolo',
    'builtin-bitcrusher',
    'builtin-filter',
    'builtin-autopan',
    'builtin-convolution-reverb',
    'builtin-stereo-widener',
    'builtin-deesser',
    'builtin-lufs-meter',
    // NativeDspDescriptors.ts (2)
    'dutch-oven',
    'native-scoring',
    // FaustEffectDescriptors.ts (12)
    'faust-zita-rev1-reverb',
    'faust-1176-compressor',
    'faust-multiband-compressor',
    'faust-pro-parametric-eq',
    'faust-tape-delay',
    'faust-brick-wall-limiter',
    'faust-spring-reverb',
    'faust-noise-gate',
    'faust-gain-utility',
    'faust-lufs-meter',
    'faust-stereo-widener',
    'faust-de-esser',
] as const;

/**
 * Every instrument-family descriptor id in `BUILTIN_PLUGINS`, excluded from
 * this census. Instruments still use the shared `declaredControl` fallback;
 * authoring their per-parameter guidance is a later, separately scoped
 * change that will empty this list rather than extend it.
 */
const INSTRUMENT_IDS_EXCLUDED = [
    // BuiltinInstrumentDescriptors.ts
    'builtin-synth',
    'builtin-drum-kit',
    // FaustInstrumentDescriptors.ts
    'faust-rhodes',
    'faust-fm-synth',
    'faust-supersaw-unison',
    // Standalone instrument descriptor files
    'bacteria',
    'builtin-crumbs',
    'crust',
    'fermenter',
    'gluten',
    'grand-boule',
    'grinder',
    'knead',
    'levain',
    'proof',
    'toaster',
    'yeast',
    // Synth/drum variants generated in DeviceParameter.ts from the
    // builtin-synth/builtin-drum-kit instrument bases above.
    'builtin-synth-mellotron',
    'builtin-synth-strings',
    'builtin-synth-808bass',
    'builtin-synth-brass',
    'builtin-drum-machine-808',
    'builtin-drum-machine-analog',
    'builtin-drum-machine-electronic',
    'builtin-drum-machine-acoustic',
] as const;

/** Devices with too few parameters to name a sibling in their interactions. */
const DEVICES_WITHOUT_A_SIBLING_PARAMETER = new Set(['builtin-gain']);

const EFFECT_DESCRIPTORS: readonly PluginDescriptor[] = [
    ...BUILTIN_EFFECT_DESCRIPTORS,
    ...NATIVE_DSP_DESCRIPTORS,
    ...FAUST_EFFECT_DESCRIPTORS,
];

function requireGuidance(descriptor: PluginDescriptor): PluginDescriptorGuidance {
    if (!descriptor.guidance) {
        throw new Error(`${descriptor.id} has no guidance; applyDescriptorGuidance should have rejected this`);
    }
    return descriptor.guidance;
}

function normalizeRoleText(role: string): string {
    return role.trim().toLowerCase();
}

describe('authoredParameterGuidance', () => {
    it('EFFECT_IDS_UNDER_CENSUS and INSTRUMENT_IDS_EXCLUDED together name every descriptor exactly once', () => {
        const allIds = BUILTIN_PLUGINS.map((descriptor) => descriptor.id);
        const censusIds = new Set<string>([...EFFECT_IDS_UNDER_CENSUS, ...INSTRUMENT_IDS_EXCLUDED]);

        const catalogIdsNotCensused = allIds.filter((id) => !censusIds.has(id));
        expect(catalogIdsNotCensused).toEqual([]);

        const censusIdsNotInCatalog: string[] = [];
        for (const id of censusIds) {
            if (!allIds.includes(id)) {
                censusIdsNotInCatalog.push(id);
            }
        }
        expect(censusIdsNotInCatalog).toEqual([]);

        expect(EFFECT_IDS_UNDER_CENSUS.length).toBe(new Set(EFFECT_IDS_UNDER_CENSUS).size);
        expect(INSTRUMENT_IDS_EXCLUDED.length).toBe(new Set(INSTRUMENT_IDS_EXCLUDED).size);

        const overlap = EFFECT_IDS_UNDER_CENSUS.filter((id) =>
            (INSTRUMENT_IDS_EXCLUDED as readonly string[]).includes(id)
        );
        expect(overlap).toEqual([]);
    });

    it('every excluded id actually names an instrument-family descriptor in BUILTIN_PLUGINS', () => {
        const catalogById = new Map(BUILTIN_PLUGINS.map((descriptor) => [descriptor.id, descriptor]));
        const effectDescriptorIds = new Set(EFFECT_DESCRIPTORS.map((descriptor) => descriptor.id));
        for (const id of INSTRUMENT_IDS_EXCLUDED) {
            const descriptor = catalogById.get(id);
            expect(descriptor, `${id} must exist in BUILTIN_PLUGINS`).toBeDefined();
            // The instrument-family files (BuiltinInstrumentDescriptors.ts,
            // FaustInstrumentDescriptors.ts, and the standalone ingredient
            // descriptors) never feed BUILTIN_EFFECT_DESCRIPTORS,
            // NATIVE_DSP_DESCRIPTORS, or FAUST_EFFECT_DESCRIPTORS; an id
            // showing up in both would mean this list is masking a real
            // effect descriptor from the census below.
            expect(effectDescriptorIds.has(id), `${id} must be absent from the three effect descriptor exports`).toBe(
                false
            );
        }
    });

    it('EFFECT_IDS_UNDER_CENSUS names exactly the descriptors exported by the three effect descriptor files, no more and no fewer', () => {
        const exportedIds = EFFECT_DESCRIPTORS.map((descriptor) => descriptor.id);

        const exportedNotCensused = exportedIds.filter(
            (id) => !(EFFECT_IDS_UNDER_CENSUS as readonly string[]).includes(id)
        );
        expect(exportedNotCensused).toEqual([]);

        const censusedNotExported = EFFECT_IDS_UNDER_CENSUS.filter((id) => !exportedIds.includes(id));
        expect(censusedNotExported).toEqual([]);
    });

    it('every parameter of every censused effect descriptor carries a semanticRole and perceptualRole unique within its device', () => {
        const violations: string[] = [];
        for (const descriptor of EFFECT_DESCRIPTORS) {
            const guidance = requireGuidance(descriptor);
            const seenSemanticRoles = new Map<string, string>();
            const seenPerceptualRoles = new Map<string, string>();
            for (const parameter of descriptor.parameters) {
                const parameterGuidance = guidance.parameters[parameter.id] as DeviceParameterGuidance;
                const semanticKey = normalizeRoleText(parameterGuidance.semanticRole);
                const perceptualKey = normalizeRoleText(parameterGuidance.perceptualRole);
                const duplicateSemanticOwner = seenSemanticRoles.get(semanticKey);
                if (duplicateSemanticOwner !== undefined) {
                    violations.push(
                        `${descriptor.id}: semanticRole "${parameterGuidance.semanticRole}" reused by ${parameter.id} and ${duplicateSemanticOwner}`
                    );
                }
                const duplicatePerceptualOwner = seenPerceptualRoles.get(perceptualKey);
                if (duplicatePerceptualOwner !== undefined) {
                    violations.push(
                        `${descriptor.id}: perceptualRole "${parameterGuidance.perceptualRole}" reused by ${parameter.id} and ${duplicatePerceptualOwner}`
                    );
                }
                seenSemanticRoles.set(semanticKey, parameter.id);
                seenPerceptualRoles.set(perceptualKey, parameter.id);
            }
        }
        expect(violations).toEqual([]);
    });

    it('every parameter of every censused effect descriptor declares a typicalRange narrower than the full bounds and different from the generic default-centered fallback', () => {
        const violations: string[] = [];
        for (const descriptor of EFFECT_DESCRIPTORS) {
            const guidance = requireGuidance(descriptor);
            for (const parameter of descriptor.parameters) {
                const parameterGuidance = guidance.parameters[parameter.id] as DeviceParameterGuidance;
                const { typicalRange } = parameterGuidance;
                if (typicalRange.minimum < parameter.minValue || typicalRange.maximum > parameter.maxValue) {
                    violations.push(`${descriptor.id}/${parameter.id}: typicalRange escapes the declared bounds`);
                    continue;
                }
                const fallback = defaultCenteredRange(parameter);
                const epsilon = 1e-9;
                const matchesFallback =
                    Math.abs(typicalRange.minimum - fallback.minimum) < epsilon &&
                    Math.abs(typicalRange.maximum - fallback.maximum) < epsilon;
                if (matchesFallback) {
                    violations.push(
                        `${descriptor.id}/${parameter.id}: typicalRange [${typicalRange.minimum}, ${typicalRange.maximum}] equals the generic default-centered fallback`
                    );
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('every parameter of every censused effect descriptor with a sibling names that sibling by id in its interactions', () => {
        const violations: string[] = [];
        for (const descriptor of EFFECT_DESCRIPTORS) {
            if (DEVICES_WITHOUT_A_SIBLING_PARAMETER.has(descriptor.id) || descriptor.parameters.length <= 1) {
                continue;
            }
            const guidance = requireGuidance(descriptor);
            const siblingIds = descriptor.parameters.map((parameter) => parameter.id);
            for (const parameter of descriptor.parameters) {
                const parameterGuidance = guidance.parameters[parameter.id] as DeviceParameterGuidance;
                const otherIds = siblingIds.filter((id) => id !== parameter.id);
                const namesASibling = parameterGuidance.interactions.some((interaction) =>
                    otherIds.some((siblingId) => interaction.includes(siblingId))
                );
                if (!namesASibling) {
                    violations.push(
                        `${descriptor.id}/${parameter.id}: interactions name no sibling parameter id (${otherIds.join(', ')})`
                    );
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('every parameter of every censused effect descriptor declares non-empty risks, unique within its device', () => {
        const violations: string[] = [];
        for (const descriptor of EFFECT_DESCRIPTORS) {
            const guidance = requireGuidance(descriptor);
            const seenRisks = new Map<string, string>();
            for (const parameter of descriptor.parameters) {
                const parameterGuidance = guidance.parameters[parameter.id] as DeviceParameterGuidance;
                if (
                    parameterGuidance.risks.length === 0 ||
                    parameterGuidance.risks.some((risk) => risk.trim().length === 0)
                ) {
                    violations.push(`${descriptor.id}/${parameter.id}: risks is empty or contains a blank entry`);
                    continue;
                }
                const risksKey = parameterGuidance.risks.map(normalizeRoleText).join('|');
                const duplicateOwner = seenRisks.get(risksKey);
                if (duplicateOwner !== undefined) {
                    violations.push(`${descriptor.id}: risks reused verbatim by ${parameter.id} and ${duplicateOwner}`);
                }
                seenRisks.set(risksKey, parameter.id);
            }
        }
        expect(violations).toEqual([]);
    });
});
