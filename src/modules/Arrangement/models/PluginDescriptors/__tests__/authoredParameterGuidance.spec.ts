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
 * This file censuses every descriptor whose `parameterOverrides` have been
 * fully authored for defects that check cannot see: role text shared across a device's own
 * parameters, a `typicalRange` equal to the generic default-centered
 * fallback, and an effect descriptor that never joined the census at all.
 * Descriptors not yet authored are excluded by the pinned id list below; a
 * later, separately scoped change removes each id as its guidance joins the
 * same census.
 */

// ── Population: every descriptor is named, and only once ───────────────────

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

const SYNTH_FAMILY_IDS_UNDER_CENSUS = [
    'builtin-synth',
    'builtin-synth-mellotron',
    'builtin-synth-strings',
    'builtin-synth-808bass',
    'builtin-synth-brass',
] as const;

const AUTHORED_DESCRIPTOR_IDS_UNDER_CENSUS = [...EFFECT_IDS_UNDER_CENSUS, ...SYNTH_FAMILY_IDS_UNDER_CENSUS] as const;

/**
 * Every descriptor id in `BUILTIN_PLUGINS` whose parameter guidance has not
 * joined this census. This includes seven standalone effects as well as the
 * remaining instrument families; all still use shared fallback guidance.
 */
const DESCRIPTOR_IDS_EXCLUDED = [
    // BuiltinInstrumentDescriptors.ts
    'builtin-drum-kit',
    // FaustInstrumentDescriptors.ts
    'faust-rhodes',
    'faust-fm-synth',
    'faust-supersaw-unison',
    // Standalone effect descriptor files
    'bacteria',
    'crust',
    'gluten',
    'grinder',
    'knead',
    'proof',
    'yeast',
    // Standalone instrument descriptor files
    'builtin-crumbs',
    'fermenter',
    'grand-boule',
    'levain',
    'toaster',
    // Drum variants generated in DeviceParameter.ts from builtin-drum-kit.
    'builtin-drum-machine-808',
    'builtin-drum-machine-analog',
    'builtin-drum-machine-electronic',
    'builtin-drum-machine-acoustic',
] as const;

/** Devices with too few parameters to name a sibling in their interactions. */
const DEVICES_WITHOUT_A_SIBLING_PARAMETER = new Set(['builtin-gain']);

/**
 * Every `${descriptor.id}/${parameter.id}` whose authored `typicalRange`
 * deliberately excludes the parameter's own `defaultValue`, with the one
 * engineering reason the default sits outside the range musicians actually
 * dial in. A parameter that starts excluding its default without a row here
 * fails the census below; a row whose parameter no longer excludes its
 * default (a stale entry) fails it too.
 */
const DEFAULT_EXCLUDING_WINDOWS: ReadonlyMap<string, string> = new Map([
    [
        'builtin-synth/vibratoRate',
        'Zero disables the base synth vibrato LFO; 4–7 Hz describes the natural active motion musicians dial in when vibratoDepth is raised.',
    ],
    [
        'builtin-synth-strings/vibratoRate',
        'Zero keeps the Analog Strings variant vibrato disabled; 4–7 Hz describes the active orchestral-style motion used with vibratoDepth.',
    ],
    [
        'builtin-synth-strings/stereoSpread',
        'Analog Strings deliberately defaults to the maximum spread of 1 for a fully separated ensemble; ordinary width work stays inside 0–0.75.',
    ],
    [
        'builtin-synth-808bass/waveform',
        'The 808 Bass variant deliberately defaults to sine (index 0) for a pure fundamental; the normal subtractive palette begins at triangle (index 1).',
    ],
    [
        'builtin-synth-808bass/sustain',
        'The 808 Bass variant deliberately defaults to zero sustain so decay defines the whole hit; held synth notes normally retain 0.3–0.8.',
    ],
    [
        'builtin-synth-808bass/subOscLevel',
        'The 808 Bass variant deliberately defaults to a full-level octave-down sine; general layering uses the lower 0–0.7 window to preserve bass headroom.',
    ],
    [
        'builtin-synth-808bass/vibratoRate',
        'Zero keeps the 808 Bass variant pitch stable; 4–7 Hz describes active vibrato rather than its disabled state.',
    ],
    [
        'builtin-synth-brass/vibratoRate',
        'Zero keeps the Classic Brass variant vibrato disabled by default; 4–7 Hz describes the active brass-style motion used with vibratoDepth.',
    ],
    [
        'builtin-reverb/rev-predelay',
        'The 10 ms default sits near zero separation; deliberately spacing the tail from the source calls for the longer, audible gap the window covers.',
    ],
    [
        'builtin-reverb/rev-lowcut',
        'The 80 Hz default is a minimal safety cut; carving audible mud out of the tail needs the higher, more deliberate cut the window covers.',
    ],
    [
        'builtin-delay/delay-lowcut',
        'The 80 Hz default is a minimal safety cut; thinning repeats out over time needs the higher, more deliberate cut the window covers.',
    ],
    [
        'builtin-delay/delay-highcut',
        'The 12000 Hz default leaves repeats almost unfiltered; deliberately darkening the echo trail for distance needs the lower corner the window covers.',
    ],
    [
        'builtin-distortion/dist-output',
        '0 dB is the neutral, untrimmed default; trimming only becomes necessary once dist-drive has added level, which is why the window sits below zero.',
    ],
    [
        'builtin-bitcrusher/crush-rate',
        'A rate of 1 applies no sample-rate reduction at all; any audible crushing starts above 1, which is what the window covers.',
    ],
    [
        'builtin-convolution-reverb/conv-predelay',
        'The 10 ms default sits near zero separation; deliberately spacing the impulse tail from the source calls for the longer gap the window covers.',
    ],
    [
        'builtin-stereo-widener/width-mono-bass',
        'The 200 Hz default is a cautious, wide safety net; tighter control over where bass content actually lives needs the lower crossover the window covers.',
    ],
    [
        'builtin-lufs-meter/lufs-window',
        'The momentary default (index 0) jitters too fast for a reliable read; mixing decisions read short-term or integrated, which is what the window covers.',
    ],
    [
        'faust-zita-rev1-reverb/damping',
        'The 6000 Hz default leaves the tail nearly unfiltered above the corner; audibly darkening a bright tail needs the lower corner the window covers.',
    ],
    [
        'faust-noise-gate/hold',
        'The 10 ms default hold is close to the minimum needed to avoid instant re-triggering; taming chatter on a decaying signal needs the longer window.',
    ],
    [
        'faust-stereo-widener/mono_bass',
        '0 Hz disables mono-bass summing entirely; a stable low end needs the real crossover the window covers.',
    ],
    [
        'dutch-oven/high_cut',
        'The 12000 Hz default leaves the tail nearly unfiltered; deliberately darkening a bright tail needs the lower, more audible cut the window covers.',
    ],
]);

const EFFECT_DESCRIPTORS: readonly PluginDescriptor[] = [
    ...BUILTIN_EFFECT_DESCRIPTORS,
    ...NATIVE_DSP_DESCRIPTORS,
    ...FAUST_EFFECT_DESCRIPTORS,
];

const SYNTH_FAMILY_DESCRIPTORS: readonly PluginDescriptor[] = BUILTIN_PLUGINS.filter((descriptor) =>
    (SYNTH_FAMILY_IDS_UNDER_CENSUS as readonly string[]).includes(descriptor.id)
);

const AUTHORED_DESCRIPTORS: readonly PluginDescriptor[] = [...EFFECT_DESCRIPTORS, ...SYNTH_FAMILY_DESCRIPTORS];

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
    it('the authored and excluded id lists together name every descriptor exactly once', () => {
        const allIds = BUILTIN_PLUGINS.map((descriptor) => descriptor.id);
        const censusIds = new Set<string>([...AUTHORED_DESCRIPTOR_IDS_UNDER_CENSUS, ...DESCRIPTOR_IDS_EXCLUDED]);

        const catalogIdsNotCensused = allIds.filter((id) => !censusIds.has(id));
        expect(catalogIdsNotCensused).toEqual([]);

        const censusIdsNotInCatalog: string[] = [];
        for (const id of censusIds) {
            if (!allIds.includes(id)) {
                censusIdsNotInCatalog.push(id);
            }
        }
        expect(censusIdsNotInCatalog).toEqual([]);

        expect(AUTHORED_DESCRIPTOR_IDS_UNDER_CENSUS.length).toBe(new Set(AUTHORED_DESCRIPTOR_IDS_UNDER_CENSUS).size);
        expect(DESCRIPTOR_IDS_EXCLUDED.length).toBe(new Set(DESCRIPTOR_IDS_EXCLUDED).size);

        const overlap = AUTHORED_DESCRIPTOR_IDS_UNDER_CENSUS.filter((id) =>
            (DESCRIPTOR_IDS_EXCLUDED as readonly string[]).includes(id)
        );
        expect(overlap).toEqual([]);
    });

    it('every excluded id names a real descriptor outside the authored census', () => {
        const catalogById = new Map(BUILTIN_PLUGINS.map((descriptor) => [descriptor.id, descriptor]));
        const authoredDescriptorIds = new Set(AUTHORED_DESCRIPTORS.map((descriptor) => descriptor.id));
        for (const id of DESCRIPTOR_IDS_EXCLUDED) {
            const descriptor = catalogById.get(id);
            expect(descriptor, `${id} must exist in BUILTIN_PLUGINS`).toBeDefined();
            expect(authoredDescriptorIds.has(id), `${id} must be absent from the authored census`).toBe(false);
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

    it('every parameter of every censused descriptor carries a semanticRole and perceptualRole unique within its device', () => {
        const violations: string[] = [];
        for (const descriptor of AUTHORED_DESCRIPTORS) {
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

    it('every parameter of every censused descriptor declares a typicalRange narrower than the full bounds and different from the generic default-centered fallback', () => {
        const violations: string[] = [];
        for (const descriptor of AUTHORED_DESCRIPTORS) {
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

    it("every typicalRange that excludes the parameter's declared default is a deliberate, listed exception", () => {
        const excludersMissingARow: string[] = [];
        for (const descriptor of AUTHORED_DESCRIPTORS) {
            const guidance = requireGuidance(descriptor);
            for (const parameter of descriptor.parameters) {
                const parameterGuidance = guidance.parameters[parameter.id] as DeviceParameterGuidance;
                const { typicalRange } = parameterGuidance;
                const excludes =
                    parameter.defaultValue < typicalRange.minimum || parameter.defaultValue > typicalRange.maximum;
                if (excludes && !DEFAULT_EXCLUDING_WINDOWS.has(`${descriptor.id}/${parameter.id}`)) {
                    excludersMissingARow.push(`${descriptor.id}/${parameter.id}`);
                }
            }
        }
        expect(excludersMissingARow).toEqual([]);

        const parametersById = new Map<string, { descriptor: PluginDescriptor; parameterId: string }>();
        for (const descriptor of AUTHORED_DESCRIPTORS) {
            for (const parameter of descriptor.parameters) {
                parametersById.set(`${descriptor.id}/${parameter.id}`, { descriptor, parameterId: parameter.id });
            }
        }

        const staleRows: string[] = [];
        for (const key of DEFAULT_EXCLUDING_WINDOWS.keys()) {
            const entry = parametersById.get(key);
            if (!entry) {
                staleRows.push(`${key}: no such censused parameter`);
                continue;
            }
            const { descriptor, parameterId } = entry;
            const guidance = requireGuidance(descriptor);
            const parameter = descriptor.parameters.find((candidate) => candidate.id === parameterId);
            const parameterGuidance = guidance.parameters[parameterId] as DeviceParameterGuidance;
            const { typicalRange } = parameterGuidance;
            const stillExcludes =
                parameter !== undefined &&
                (parameter.defaultValue < typicalRange.minimum || parameter.defaultValue > typicalRange.maximum);
            if (!stillExcludes) {
                staleRows.push(`${key}: no longer excludes its default`);
            }
        }
        expect(staleRows).toEqual([]);
    });

    it('every parameter of every censused descriptor with a sibling names that sibling by id in its interactions', () => {
        const violations: string[] = [];
        for (const descriptor of AUTHORED_DESCRIPTORS) {
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

    it('every parameter of every censused descriptor declares non-empty risks, unique within its device', () => {
        const violations: string[] = [];
        for (const descriptor of AUTHORED_DESCRIPTORS) {
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
