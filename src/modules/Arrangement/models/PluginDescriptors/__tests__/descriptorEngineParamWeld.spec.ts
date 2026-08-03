import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    NATIVE_DSP_DEVICE_TYPES,
    resolveNativeDspDeviceType,
    type NativeDspDeviceType,
} from '#/utils/nativeDspDeviceTypes';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';

/**
 * A descriptor is a contract with an engine, and nothing checked that the
 * engine answers to every id the descriptor advertises.
 *
 * `BACTERIA_DESCRIPTOR` shipped `bandGain`. The engine's per-band gain arm is
 * `gain`, and every layer between them forwards a parameter name verbatim —
 * `updateDeviceParam` → `BacteriaNode.setParam` → the worklet port → Rust
 * `set_param`. So `bandGain` reached `BandChain::set_param`, fell through its
 * catch-all to thirteen sub-processors that each ignored it, and returned
 * successfully. The parameter was marked automatable, so the lane picker
 * offered "Band Gain", a user could draw a ±24 dB curve, nothing moved, and the
 * curve persisted into the project file. Worse than an inert knob: it consumes
 * an automation lane and survives save and reload.
 *
 * `nativeDspDeviceTypeWeld.spec.ts` welds device *types* to their factories.
 * This is the same weld one level down — parameter *ids* to `set_param` arms.
 *
 * Per ADR 0015 the population is enumerated, not listed. Both ends are read out
 * of the files production compiles: the descriptors from `BUILTIN_PLUGINS`, the
 * accepted names from the Rust `set_param` arms, and the camelCase→snake_case
 * translation from the worklet processor that performs it. All three are
 * maintained by work with no reason to think about this file, so a new orphan
 * appears here without anyone editing it.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

/**
 * Where each native device's `set_param` arms live.
 *
 * Typed as a total `Record` over the canonical type union on purpose: adding a
 * native device makes this fail to compile until someone says which sources
 * answer for it, the same way `NATIVE_DSP_DEVICE_TYPES` breaks the hydration
 * table. A directory rather than a file list, so a sub-processor added beside
 * an existing one is picked up without an edit here.
 */
const ENGINE_SOURCE_ROOTS: Record<NativeDspDeviceType, string> = {
    fermenter: 'crates/daw-dsp/src/fermenter',
    toaster: 'crates/daw-dsp/src/toaster',
    levain: 'crates/daw-dsp/src/levain',
    'builtin-crumbs': 'crates/daw-dsp/src/crumbs',
    'grand-boule': 'crates/daw-dsp/src/grand_boule',
    gluten: 'crates/daw-dsp/src/gluten',
    crust: 'crates/daw-dsp/src/crust',
    bacteria: 'crates/daw-dsp/src/bacteria',
    grinder: 'crates/daw-dsp/src/grinder',
    proof: 'crates/daw-dsp/src/proof',
    // The ProofChamber reverb ships under its bakery name in device ids.
    'dutch-oven': 'crates/proof-chamber/src',
    // The Tuner, whose engine is the `scoring` crate.
    'native-scoring': 'crates/scoring/src',
    knead: 'crates/daw-dsp/src/knead',
};

const SERVICES = 'src/modules/AudioEngine/services';
const WORKLETS = 'src/modules/AudioEngine/worklets';

/**
 * How a descriptor id becomes the string the Rust engine matches on.
 *
 * The worklet processors are not importable here — each ends in a top-level
 * `registerProcessor` and pulls in the wasm bindings — so the translation is
 * read from their source, exactly as the Rust arms are. A device whose
 * processor grows a new mapping is therefore covered without an edit here; only
 * a device that invents a *new shape* of translation needs one, and the total
 * `Record` makes that a compile error rather than a silent identity assumption.
 */
type NameTranslation =
    | { readonly kind: 'identity' }
    | { readonly kind: 'table'; readonly source: string; readonly constName: string }
    | { readonly kind: 'camelToSnake'; readonly source: string; readonly functionName: string };

const PARAM_NAME_TRANSLATIONS: Record<NativeDspDeviceType, NameTranslation> = {
    fermenter: { kind: 'camelToSnake', source: `${SERVICES}/fermenterProcessor.ts`, functionName: 'camelToSnake' },
    // Pad-scoped writes go through `set_pad_param` and PAD_PARAM_MAP; the
    // device-level `param` message automation uses reads KIT_PARAM_MAP.
    toaster: { kind: 'table', source: `${SERVICES}/toasterProcessor.ts`, constName: 'KIT_PARAM_MAP' },
    levain: { kind: 'table', source: `${SERVICES}/levainProcessor.ts`, constName: 'PARAM_MAP' },
    'builtin-crumbs': { kind: 'identity' },
    // Grand Boule's two processors share one core, and the map lives there.
    'grand-boule': { kind: 'table', source: `${WORKLETS}/grandBouleEngineCore.ts`, constName: 'PARAM_MAP' },
    gluten: { kind: 'table', source: `${SERVICES}/glutenProcessor.ts`, constName: 'PARAM_MAP' },
    crust: { kind: 'table', source: `${SERVICES}/crustProcessor.ts`, constName: 'PARAM_MAP' },
    bacteria: { kind: 'table', source: `${SERVICES}/bacteriaProcessor.ts`, constName: 'PARAM_MAP' },
    grinder: { kind: 'table', source: `${SERVICES}/grinderProcessor.ts`, constName: 'PARAM_MAP' },
    proof: { kind: 'identity' },
    'dutch-oven': { kind: 'identity' },
    'native-scoring': { kind: 'identity' },
    knead: { kind: 'identity' },
};

/**
 * Native device types with no entry in `BUILTIN_PLUGINS`.
 *
 * A native type with no descriptor is invisible to this census, so it has to be
 * named rather than silently skipped.
 */
const NATIVE_TYPES_WITHOUT_DESCRIPTOR: Readonly<Partial<Record<NativeDspDeviceType, string>>> = {
    knead: 'Knead is a track-level pitch-correction insert with no host parameter surface — its engine exposes no string-addressed `set_param` at all, only typed setters such as `set_shift_semitones`.',
};

type ParamExemption = {
    readonly deviceId: NativeDspDeviceType;
    readonly paramId: string;
    readonly reason: string;
};

/**
 * Descriptor parameters that legitimately have no engine arm.
 *
 * Every row is asserted in both directions: it must still be a parameter the
 * descriptor declares, and it must still resolve to a name the engine does not
 * answer to. An exempt id that gains an arm reds until the row is deleted, so
 * this table cannot quietly become the place orphans go to be forgotten.
 */
const PARAM_EXEMPTIONS: readonly ParamExemption[] = [];

/**
 * Orphans this census found that are **not** fixed, and are **not** legitimate.
 *
 * Deliberately a separate table from `PARAM_EXEMPTIONS`, on the same principle
 * as the `deps:validate` baseline: known debt is exact and reviewable, and it
 * is not the same statement as "this is fine". A row here says the parameter is
 * broken in the way `bandGain` was — advertised, automatable, and inert — and
 * that fixing it is more than a name change. It is asserted in both directions,
 * so the row cannot outlive the defect.
 */
const KNOWN_ORPHANS: readonly ParamExemption[] = [
    {
        deviceId: 'toaster',
        paramId: 'swing',
        reason:
            'Swing is real, but it lives host-side: `projectToasterStepEvents` shifts step start beats by `kit.swing`, ' +
            'and the Rust engine has no sequencer to put it in. The panel writes it through `setToasterKitParam` into ' +
            'the kit store, so the knob works — but automation and modulation only reach `updateDeviceParam`, which ' +
            'ends at the engine, and the engine drops it. Fixing it means giving the host-side sequencer a way to read ' +
            'the automated value at schedule time, which is a write-path change, not a rename. Do not "fix" it by ' +
            'clearing `automatable`: ADR 0016 ruling 2 says build the inert capability, not delete it.',
    },
];

// ── Source reading ─────────────────────────────────────────────────────────

/** Strip line and block comments so neither brace matching nor scanning sees prose. */
function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/\/\/[^\n]*/g, ' ');
}

/**
 * The braced block starting at `openIndex`.
 *
 * Brace matching skips string literals, because a `format!("{name}")` inside a
 * `set_param` arm would otherwise close the block early and truncate the arms
 * that follow — which would report false orphans.
 */
function readBalancedBlock(source: string, openIndex: number): string {
    let depth = 0;
    let inString = false;
    let quote = '';
    for (let index = openIndex; index < source.length; index++) {
        const char = source[index]!;
        if (inString) {
            if (char === '\\') {
                index++;
                continue;
            }
            if (char === quote) {
                inString = false;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
            continue;
        }
        if (char === '{') {
            depth++;
            continue;
        }
        if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(openIndex, index + 1);
            }
        }
    }
    return source.slice(openIndex);
}

function readSource(relativePath: string): string {
    return stripComments(readFileSync(join(REPO_ROOT, relativePath), 'utf8'));
}

// ── Rust side: the names `set_param` matches on ────────────────────────────

function collectRustSources(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
            files.push(...collectRustSources(full));
            continue;
        }
        if (entry.endsWith('.rs')) {
            files.push(full);
        }
    }
    return files;
}

/**
 * Bodies of every function in `source` whose name mentions a parameter.
 *
 * Confining the arm scan to these is what keeps unrelated string matches out —
 * `parse_crumbs_mode`'s `"quick" | "drum" | "slice"` arms are not parameter
 * names, and counting them would let a descriptor advertise `quick` and pass.
 */
function readParamFunctionBodies(source: string): string[] {
    const bodies: string[] = [];
    const signature = /\bfn\s+([A-Za-z_]\w*param\w*)\s*(?:<[^>]*>)?\s*\(/gi;
    let match = signature.exec(source);
    while (match !== null) {
        const openIndex = source.indexOf('{', match.index + match[0].length);
        if (openIndex !== -1) {
            bodies.push(readBalancedBlock(source, openIndex));
        }
        match = signature.exec(source);
    }
    return bodies;
}

/**
 * Every string literal in match-arm position, including `"a" | "b" => …` chains.
 *
 * Whitespace is collapsed first so an arm list broken across lines reads the
 * same as one written on a single line.
 */
function readMatchArmNames(body: string): string[] {
    const flattened = body.replaceAll(/\s+/g, ' ');
    const arm = /"([\w-]+)"(?=(?: \| "[\w-]+")* =>)/g;
    return [...flattened.matchAll(arm)].map((match) => match[1]!);
}

function readEngineParamNames(deviceType: NativeDspDeviceType): ReadonlySet<string> {
    const names = new Set<string>();
    for (const file of collectRustSources(join(REPO_ROOT, ENGINE_SOURCE_ROOTS[deviceType]))) {
        for (const body of readParamFunctionBodies(stripComments(readFileSync(file, 'utf8')))) {
            for (const name of readMatchArmNames(body)) {
                names.add(name);
            }
        }
    }
    return names;
}

// ── TypeScript side: the translation each processor performs ───────────────

function readTranslationTable(sourcePath: string, constName: string): ReadonlyMap<string, string> {
    const source = readSource(sourcePath);
    const declaration = source.indexOf(`const ${constName}`);
    if (declaration === -1) {
        return new Map();
    }
    const block = readBalancedBlock(source, source.indexOf('{', declaration));
    const entry = /([A-Za-z_]\w*)\s*:\s*'([\w-]+)'/g;
    return new Map([...block.matchAll(entry)].map((match) => [match[1]!, match[2]!]));
}

/**
 * The `snake === 'x' → return 'y'` overrides inside a camelCase→snake_case
 * translator, so a device that renames one parameter out of band does not
 * silently become an orphan here.
 */
function readCamelToSnakeOverrides(sourcePath: string, functionName: string): ReadonlyMap<string, string> {
    const source = readSource(sourcePath);
    const declaration = source.indexOf(`function ${functionName}`);
    if (declaration === -1) {
        return new Map();
    }
    const block = readBalancedBlock(source, source.indexOf('{', declaration)).replaceAll(/\s+/g, ' ');
    const override = /=== '(\w+)'\s*\)\s*\{\s*return '(\w+)'/g;
    return new Map([...block.matchAll(override)].map((match) => [match[1]!, match[2]!]));
}

function buildTranslator(deviceType: NativeDspDeviceType): (paramId: string) => string {
    const translation = PARAM_NAME_TRANSLATIONS[deviceType];

    if (translation.kind === 'identity') {
        return (paramId) => paramId;
    }

    if (translation.kind === 'table') {
        const table = readTranslationTable(translation.source, translation.constName);
        return (paramId) => table.get(paramId) ?? paramId;
    }

    const overrides = readCamelToSnakeOverrides(translation.source, translation.functionName);
    return (paramId) => {
        const snake = paramId.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        return overrides.get(snake) ?? snake;
    };
}

// ── Population ─────────────────────────────────────────────────────────────

const NATIVE_DESCRIPTORS = BUILTIN_PLUGINS.flatMap((descriptor) => {
    const deviceType = resolveNativeDspDeviceType(descriptor.id);
    if (deviceType === null) {
        return [];
    }
    return [{ deviceType, paramIds: descriptor.parameters.map((param) => param.id) }];
});

const ENGINE_PARAM_NAMES = new Map<NativeDspDeviceType, ReadonlySet<string>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [deviceType, readEngineParamNames(deviceType)])
);

const TRANSLATORS = new Map<NativeDspDeviceType, (paramId: string) => string>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [deviceType, buildTranslator(deviceType)])
);

function engineAnswersTo(deviceType: NativeDspDeviceType, paramId: string): boolean {
    return ENGINE_PARAM_NAMES.get(deviceType)!.has(TRANSLATORS.get(deviceType)!(paramId));
}

const ALL_DECLARED_ROWS: readonly ParamExemption[] = [...PARAM_EXEMPTIONS, ...KNOWN_ORPHANS];

function isDeclared(deviceType: NativeDspDeviceType, paramId: string): boolean {
    return ALL_DECLARED_ROWS.some((row) => row.deviceId === deviceType && row.paramId === paramId);
}

describe('descriptor parameter ids are welded to engine set_param arms', () => {
    it('reads the Rust arms it claims to read', () => {
        // An absence assertion needs a presence pin (ADR 0015 rule 4). If the
        // repo-root walk or the arm regex went blind every device would report
        // an empty set, but a subtler break — bodies truncated at the first
        // `format!`, or arms only ever read from one file — would not show up in
        // the orphan list at all. Pin arms from three different files, and the
        // shape that must stay absent.
        const bacteria = ENGINE_PARAM_NAMES.get('bacteria')!;

        expect(bacteria.has('crossoverFreq1')).toBe(true); // engine.rs, BacteriaEngine
        expect(bacteria.has('gain')).toBe(true); // engine.rs, BandChain
        expect(bacteria.has('grainSize')).toBe(true); // granular.rs
        expect(bacteria.has('bandGain')).toBe(false);
    });

    it('reads the name translation each processor actually performs', () => {
        // Same presence pin for the TypeScript half: an empty table or an empty
        // override map degrades silently into the identity translation, which
        // would report every snake_case device as one giant orphan set — or,
        // worse, would look correct for a device whose names already match.
        const gluten = TRANSLATORS.get('gluten')!;
        const fermenter = TRANSLATORS.get('fermenter')!;

        expect(gluten('autoMakeup')).toBe('auto_makeup');
        expect(gluten('mix')).toBe('mix');
        expect(fermenter('ampAttack')).toBe('amp_attack');
        expect(fermenter('filterCutoff')).toBe('cutoff');
    });

    it('every native device type is either censused or named as descriptor-less', () => {
        const unaccounted = NATIVE_DSP_DEVICE_TYPES.filter(
            (deviceType) =>
                !NATIVE_DESCRIPTORS.some((entry) => entry.deviceType === deviceType) &&
                NATIVE_TYPES_WITHOUT_DESCRIPTOR[deviceType] === undefined
        );

        expect(unaccounted).toEqual([]);
    });

    it('no descriptor-less exemption survives the descriptor that retires it', () => {
        // The reverse direction: a device that gains a descriptor must lose its
        // row here, or the census keeps skipping a device it can now check.
        const stale = Object.keys(NATIVE_TYPES_WITHOUT_DESCRIPTOR).filter((deviceType) =>
            NATIVE_DESCRIPTORS.some((entry) => entry.deviceType === deviceType)
        );

        expect(stale).toEqual([]);
    });

    it('every advertised parameter id is one the engine answers to', () => {
        const orphans: string[] = [];
        for (const { deviceType, paramIds } of NATIVE_DESCRIPTORS) {
            for (const paramId of paramIds) {
                if (!engineAnswersTo(deviceType, paramId) && !isDeclared(deviceType, paramId)) {
                    orphans.push(`${deviceType}.${paramId}`);
                }
            }
        }

        expect(orphans).toEqual([]);
    });

    it('every declared row still names a parameter the descriptor declares', () => {
        const stale = ALL_DECLARED_ROWS.filter(
            (row) =>
                !NATIVE_DESCRIPTORS.some(
                    (entry) => entry.deviceType === row.deviceId && entry.paramIds.includes(row.paramId)
                )
        ).map((row) => `${row.deviceId}.${row.paramId}`);

        expect(stale).toEqual([]);
    });

    it('every declared row still lacks the engine arm it was granted for', () => {
        // The reverse direction that stops either table becoming a place orphans
        // go to be forgotten: the moment the engine answers to one of these, the
        // row is a lie and has to be deleted.
        const wired = ALL_DECLARED_ROWS.filter((row) => engineAnswersTo(row.deviceId, row.paramId)).map(
            (row) => `${row.deviceId}.${row.paramId}`
        );

        expect(wired).toEqual([]);
    });

    it('every declared row carries a reason', () => {
        const unreasoned = ALL_DECLARED_ROWS.filter((row) => row.reason.trim().length === 0).map(
            (row) => `${row.deviceId}.${row.paramId}`
        );

        expect(unreasoned).toEqual([]);
    });
});
