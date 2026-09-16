import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    NATIVE_DSP_DEVICE_TYPES,
    resolveNativeDspDeviceType,
    type NativeDspDeviceType,
} from '#/utils/nativeDspDeviceTypes';
import { DUTCH_OVEN_ENGINE_BY_WIRE_VALUE, NATIVE_DSP_ENGINE_GAPS } from '#/utils/nativeDspEngineGaps';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';
import { isDeviceParameterAutomatable, isInternalDeviceParameter } from '../../DeviceParameterLaw';

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
 *
 * ## Why the census is per *engine* and not per crate
 *
 * The first revision of this file resolved each device against one directory of
 * Rust sources, unioned. That is the right shape for a device whose
 * `set_param` reaches every sub-processor it owns — Gluten broadcasts a name to
 * its VCA, opto, FET and diode topologies at once, so an arm found anywhere
 * under `gluten/` really is an arm the device answers to.
 *
 * It is the wrong shape for a device that dispatches *exclusively*: one of
 * several alternatives is live, chosen at runtime, and only that one receives
 * the write. Dutch Oven is that device. `ProofChamberInstance::forward_to_engine`
 * (`crates/proof-chamber/src/lib.rs`) forwards to whichever `ReverbEngine`
 * variant is currently selected, and the seven variants have seven different
 * arm sets. Unioning them says "some algorithm handles this", which is not the
 * claim a user's knob makes.
 *
 * #1481 is what that costs. `early_late` was advertised, automatable, sent
 * correctly by the panel, and dropped by `ProofChamber::set_param`'s `_ => {}`
 * on the **plate** — the algorithm every project runs until something writes
 * the selector. The census passed it because `FdnReverb::set_param`
 * (`fdn.rs:299`) had the arm. A different engine vouched for it.
 *
 * So the population here is (device, engine, parameter), and the load-bearing
 * assertion is the one about the *default* engine: whatever a freshly
 * constructed device runs must answer every id the descriptor advertises, with
 * no exemption table in front of it.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

/**
 * One alternative a device can be running.
 *
 * `variants` names the Rust enum variants the selector dispatch constructs this
 * alternative as — two wire values can land on one engine (`Fdn8` and `Fdn16`
 * are both `FdnReverb`), so the mapping is many-to-one. Empty for a device with
 * no selector.
 *
 * `sources` are the files reachable *only* while this alternative is live.
 * Empty means the device has one alternative and everything is shared.
 */
type EngineAlternative = {
    readonly engineId: string;
    readonly variants: readonly string[];
    readonly sources: readonly string[];
};

/** Where the wire value → engine dispatch lives, and which descriptor id drives it. */
type EngineSelector = {
    readonly paramId: string;
    readonly source: string;
    readonly enumName: string;
};

/**
 * Where each native device's `set_param` arms live, split by which of them a
 * given write can actually reach.
 *
 * Typed as a total `Record` over the canonical type union on purpose: adding a
 * native device makes this fail to compile until someone says which sources
 * answer for it, the same way `NATIVE_DSP_DEVICE_TYPES` breaks the hydration
 * table. Directories rather than file lists wherever possible, so a
 * sub-processor added beside an existing one is picked up without an edit here;
 * a directory listed as shared yields everything under it *minus* the files an
 * alternative claims and minus the out-of-band sub-trees, so adding a file to
 * one engine does not silently widen the others.
 */
type DeviceEngines = {
    readonly sharedSources: readonly string[];
    readonly alternatives: readonly EngineAlternative[];
    /** The alternative a freshly-constructed device runs. */
    readonly defaultEngineId: string;
    readonly selector: EngineSelector | null;
    /**
     * Sub-trees whose arms are reached through a *different* entry point than
     * the one a descriptor parameter takes, and which therefore must not vouch
     * for a descriptor id.
     */
    readonly outOfBand: readonly { readonly path: string; readonly reason: string }[];
};

/** A device with one engine: nothing is exclusive, so the sole alternative owns no sources. */
function singleEngine(root: string): DeviceEngines {
    return {
        sharedSources: [root],
        alternatives: [{ engineId: 'engine', variants: [], sources: [] }],
        defaultEngineId: 'engine',
        selector: null,
        outOfBand: [],
    };
}

const PROOF_CHAMBER = 'crates/proof-chamber/src';

const ENGINE_SOURCES: Record<NativeDspDeviceType, DeviceEngines> = {
    fermenter: singleEngine('crates/daw-dsp/src/fermenter'),
    toaster: {
        ...singleEngine('crates/daw-dsp/src/toaster'),
        outOfBand: [
            {
                path: 'crates/daw-dsp/src/toaster/engines',
                reason:
                    'Toaster has the same exclusive-dispatch shape Dutch Oven does — `PadEngine::set_param` ' +
                    '(`toaster/engines/mod.rs:409-441`) forwards to one of twenty-nine variants — but no descriptor ' +
                    'parameter enters it. The pad path is a different entry point (`set_pad_param`, ' +
                    '`toaster/engine.rs:486`) with its own `PAD_PARAM_MAP`, while the four ids the descriptor ' +
                    'advertises are kit-level and land in `toaster/engine.rs`. Excluded so a pad-engine arm cannot ' +
                    'vouch for a device-level id: the day someone adds a pad parameter to the descriptor, this reds ' +
                    'instead of resolving against whichever of the twenty-nine happens to spell it the same way.',
            },
        ],
    },
    levain: singleEngine('crates/daw-dsp/src/levain'),
    'builtin-crumbs': singleEngine('crates/daw-dsp/src/crumbs'),
    'grand-boule': singleEngine('crates/daw-dsp/src/grand_boule'),
    gluten: singleEngine('crates/daw-dsp/src/gluten'),
    crust: singleEngine('crates/daw-dsp/src/crust'),
    bacteria: singleEngine('crates/daw-dsp/src/bacteria'),
    grinder: singleEngine('crates/daw-dsp/src/grinder'),
    proof: singleEngine('crates/daw-dsp/src/proof'),
    // The ProofChamber reverb ships under its bakery name in device ids, and is
    // the one device whose descriptor writes cross an exclusive dispatch.
    // Shared keeps `lib.rs` (the `algorithm` and `vintage` arms every engine
    // sees) and the stages the engines share — `early_reflections.rs` is used
    // by the plate and the FDN both, `vintage.rs` runs after every algorithm.
    'dutch-oven': {
        sharedSources: [PROOF_CHAMBER],
        alternatives: [
            { engineId: 'plate', variants: ['Plate'], sources: [`${PROOF_CHAMBER}/proof_chamber.rs`] },
            { engineId: 'fdn', variants: ['Fdn8', 'Fdn16'], sources: [`${PROOF_CHAMBER}/fdn.rs`] },
            { engineId: 'spring', variants: ['Spring'], sources: [`${PROOF_CHAMBER}/spring.rs`] },
            { engineId: 'reverse', variants: ['Reverse'], sources: [`${PROOF_CHAMBER}/reverse.rs`] },
            { engineId: 'convolution', variants: ['Convolution'], sources: [`${PROOF_CHAMBER}/convolution.rs`] },
            { engineId: 'hybrid', variants: ['Hybrid'], sources: [`${PROOF_CHAMBER}/hybrid.rs`] },
        ],
        defaultEngineId: 'plate',
        selector: { paramId: 'algorithm', source: `${PROOF_CHAMBER}/lib.rs`, enumName: 'ReverbEngine' },
        outOfBand: [],
    },
    // The Tuner, whose engine is the `scoring` crate.
    'native-scoring': singleEngine('crates/scoring/src'),
    knead: singleEngine('crates/daw-dsp/src/knead'),
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
    // device-level `param` message automation reads `TOASTER_KIT_PARAM_NAMES`,
    // which the worklet now imports from `models/` rather than keeping its own
    // copy (#3124).
    toaster: {
        kind: 'table',
        source: 'src/modules/AudioEngine/models/ToasterKitParamNames.ts',
        constName: 'TOASTER_KIT_PARAM_NAMES',
    },
    levain: { kind: 'table', source: `${SERVICES}/levainProcessor.ts`, constName: 'PARAM_MAP' },
    'builtin-crumbs': { kind: 'identity' },
    // Grand Boule's two processors share one core, and the map lives there.
    'grand-boule': { kind: 'table', source: `${WORKLETS}/grandBouleEngineCore.ts`, constName: 'PARAM_MAP' },
    // Gluten's two hosts share one table, and the model file is where it lives.
    gluten: {
        kind: 'table',
        source: 'src/modules/AudioEngine/models/GlutenDspParamNames.ts',
        constName: 'GLUTEN_DSP_PARAM_NAMES',
    },
    // Crust's two hosts share one table, and the model file is where it lives.
    crust: {
        kind: 'table',
        source: 'src/modules/AudioEngine/models/CrustDspParamNames.ts',
        constName: 'CRUST_DSP_PARAM_NAMES',
    },
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
const NATIVE_TYPES_WITHOUT_DESCRIPTOR: Readonly<Partial<Record<NativeDspDeviceType, string>>> = {};

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
const PARAM_EXEMPTIONS: readonly ParamExemption[] = [
    {
        deviceId: 'toaster',
        paramId: 'swing',
        reason:
            'Host-side by design, and it works. Swing shifts the *schedule*, not the audio, so there is nothing for a ' +
            'Rust engine arm to do: `toasterSwingProjection` takes the automation lanes and the evaluator directly ' +
            '(`toasterSwingProjection.ts:24-28`, iterating them at `:59`), and `scheduleMidiNotes.ts:632-636` feeds it ' +
            'both. Automation reaches it — `toasterSwingProjection.spec.ts` covers "delays odd sixteenths from ' +
            'canonical parent automation" — the path simply is not the engine one.\n\n' +
            'Recorded as an exemption rather than as debt because it is not broken. An earlier revision of this census ' +
            'filed it as a known orphan on the reasoning that "automation only reaches `updateDeviceParam`, which ends ' +
            'at the engine". That is true of the engine route and irrelevant here, and leaving it in the debt table ' +
            'would have sent someone to fix a working feature.',
    },
];

/**
 * Orphans this census found that are **not** fixed, and are **not** legitimate.
 *
 * Deliberately a separate table from `PARAM_EXEMPTIONS`, on the same principle
 * as the `deps:validate` baseline: known debt is exact and reviewable, and it
 * is not the same statement as "this is fine". A row here says the parameter is
 * broken in the way `bandGain` was — advertised, automatable, and inert — and
 * that fixing it is more than a name change. It is asserted in both directions,
 * so the row cannot outlive the defect.
 *
 * Neither table can hold a **default-engine** gap. That assertion takes no
 * exemptions at all, because a parameter dead on the engine every project runs
 * is the defect this census exists for.
 */
const KNOWN_ORPHANS: readonly ParamExemption[] = [];

/**
 * A descriptor id one engine answers to under a *different* name, because the
 * dispatcher rewrites it on the way in.
 *
 * Not a translation table entry: the worklet sends `diffusion` to every
 * algorithm, and only the spring path re-sends it. Asserted in both directions
 * — the target must be a name that engine really answers to, and the row must
 * still be needed — so an alias cannot outlive the shim that justifies it.
 */
type EngineAlias = {
    readonly deviceId: NativeDspDeviceType;
    readonly engineId: string;
    readonly paramId: string;
    readonly handledAs: string;
    readonly reason: string;
};

const ENGINE_PARAM_ALIASES: readonly EngineAlias[] = [
    {
        deviceId: 'dutch-oven',
        engineId: 'spring',
        paramId: 'diffusion',
        handledAs: 'dispersion',
        reason:
            'The dispatcher re-sends it: `forward_to_engine` (`lib.rs:285-290`) calls `s.set_param(name, value)` and then, when the name is ' +
            '`diffusion`, calls `s.set_param("dispersion", value)`. A spring reverb disperses rather than diffuses, so ' +
            'the engine spells its arm `dispersion` and only this one algorithm needs the bridge. The literal is a ' +
            'call argument, not a match arm, so the arm scanner cannot see it and the shim has to be declared.',
    },
];

/**
 * Descriptor parameters a *non-default* engine drops on the floor.
 *
 * The table itself is `NATIVE_DSP_ENGINE_GAPS` in `#/utils/nativeDspEngineGaps`,
 * because it is no longer only a test fixture: `ProofChamberPanel` gates its
 * controls on the same rows, so that a gap closed in Rust re-enables the knob
 * with no panel edit and no second list to drift. The assertions that keep it
 * honest stay here — a listed parameter that gains an arm reds until the row is
 * deleted, and an unlisted gap reds immediately — so moving it changed where it
 * lives, not what it has to survive.
 *
 * Each row also carries a `kind` per parameter: `unbuilt` for a stage nobody has
 * written yet, `structural` for a category error no DSP will ever close. Only
 * the census's own reasons live in that file; the panel treatment lives in
 * `src/modules/ProofChamber/models/ProofChamberAlgorithmGating.ts`.
 */
const KNOWN_ENGINE_GAPS = NATIVE_DSP_ENGINE_GAPS;

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

/** Absolute `.rs` files under `path`, which may itself be a file. */
function collectRustSources(path: string): string[] {
    if (statSync(path).isFile()) {
        return path.endsWith('.rs') ? [path] : [];
    }
    const files: string[] = [];
    for (const entry of readdirSync(path)) {
        const full = join(path, entry);
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

function absolute(relativePath: string): string {
    return join(REPO_ROOT, relativePath);
}

/** True when `file` is `root` or sits under it. */
function isUnder(file: string, root: string): boolean {
    return file === root || file.startsWith(root + sep);
}

// ── Rust const references ──────────────────────────────────────────────────

type RustConstReferences = {
    /** The wire name an all-caps arm identifier resolves to, when it names a literal `&str` const. */
    readonly wireName: (identifier: string) => string | null;
    /** The number an all-caps bound identifier resolves to, when it names a literal numeric const. */
    readonly number: (identifier: string) => number | null;
};

type RustConstDeclaration =
    { readonly kind: 'string'; readonly text: string } | { readonly kind: 'number'; readonly value: number };

const RUST_NUMBER = String.raw`-?\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:e-?\d(?:_?\d)*)?`;

/**
 * Follows one Rust file's const references to the values their modules author.
 *
 * Copied from `declaredRangeVsKnobTravel.spec.ts` in this directory, which
 * authored it when the shared-constants campaign replaced literal `set_param`
 * arms and bounds with named consts; keep the two copies in sync. The sibling
 * is craft-baselined for `no-long-array-chain` and this file is not, so the
 * one chain it carries is bound to named steps here.
 *
 * A const arrives through `use crate::params::{…}`, a path-qualified
 * `use crate::params::DECAY`, `use super::DEFAULT_THRESHOLD_DB`, or as a
 * module-local declaration. The local name is bound to the module the `use`
 * path names, and the module's own `(pub)? const NAME: TYPE = VALUE;` is read
 * **as text** — never through an import, because nothing in `crates/` is
 * importable from a browser spec.
 *
 * Resolves only a const whose value is a numeric literal or a double-quoted
 * string literal. Everything else — a computed value, a tuple const, a `pub
 * use` re-export, a glob import, or a path into another crate — stays
 * unresolved, and the arm or wire value carrying it falls out of the census
 * rather than being guessed at.
 */
function readRustConstReferences(file: string): RustConstReferences {
    const source = stripComments(readFileSync(file, 'utf8'));

    /** The crate's `src/` directory: `crate::` paths root here. */
    let crateRoot = dirname(file);
    while (basename(crateRoot) !== 'src' && dirname(crateRoot) !== crateRoot) {
        crateRoot = dirname(crateRoot);
    }
    if (basename(crateRoot) !== 'src') {
        return { wireName: () => null, number: () => null };
    }

    /**
     * The file's own module path in crate terms (`gluten/vca.rs` →
     * `['gluten', 'vca']`, `gluten/mod.rs` → `['gluten']`, a crate-root
     * `lib.rs` → `[]`): `super::` walks up this list, `self::` extends it.
     */
    const fileSegment = relative(crateRoot, file);
    const pathSegments = fileSegment
        .split(sep)
        .map((part, index, all) => (index === all.length - 1 ? part.replace(/\.rs$/, '') : part));
    if (pathSegments[pathSegments.length - 1] === 'mod') {
        pathSegments.pop();
    }
    // The crate-root file is the root module itself, not a child of one.
    const moduleSegments = fileSegment === 'lib.rs' || fileSegment === 'main.rs' ? [] : pathSegments;

    /** `crate::proof::metering` → that module's file, trying both Rust layouts. */
    const moduleFile = (segments: readonly string[]): string | null => {
        if (segments.length === 0) {
            return (
                [join(crateRoot, 'lib.rs'), join(crateRoot, 'main.rs')].find((candidate) => existsSync(candidate)) ??
                null
            );
        }
        const base = join(crateRoot, ...segments);
        return [`${base}.rs`, join(base, 'mod.rs')].find((candidate) => existsSync(candidate)) ?? null;
    };

    // Local name → the module file and const name a `use` binds it to.
    const imports = new Map<string, { readonly file: string | null; readonly name: string }>();
    for (const statement of source.matchAll(/^[ \t]*(pub\s+)?use\s+([^;]+);/gm)) {
        if (statement[1] !== undefined) {
            // A re-export: the value's author is another hop away, so it stays
            // a gap rather than being chased through `pub use` chains.
            continue;
        }
        const tree = statement[2]!;
        if (tree.includes('*')) {
            continue;
        }
        const braced = /^([\w:]*::)?\{([^}]*)\}$/.exec(tree);
        const single = braced === null ? /^([\w:]*::)?(\w+)(?:\s+as\s+(\w+))?$/.exec(tree) : null;
        if (braced === null && single === null) {
            continue;
        }
        const prefix = (braced?.[1] ?? single![1] ?? '').split('::').filter((segment) => segment !== '');
        let items: readonly { readonly name: string; readonly local: string }[];
        if (braced !== null) {
            const clauses = braced[2]!.split(',').map((item) => /^(\w+)(?:\s+as\s+(\w+))?$/.exec(item.trim()));
            items = clauses
                .filter((item): item is RegExpExecArray => item !== null)
                .map((item) => ({ name: item[1]!, local: item[2] ?? item[1]! }));
        } else {
            items = [{ name: single![2]!, local: single![3] ?? single![2]! }];
        }
        if (items.length === 0) {
            continue;
        }

        // `crate::` roots at the crate; `self::` extends this file's module;
        // `super::` (repeatable) walks up it, and may then hand back to
        // `crate::`/`self::`. Any other head is another crate, whose sources
        // this census has no business reading.
        let base: readonly string[] | null = null;
        let rest = [...prefix];
        if (rest[0] === 'crate') {
            base = [];
            rest = rest.slice(1);
        } else if (rest[0] === 'self') {
            base = moduleSegments;
            rest = rest.slice(1);
        } else if (rest[0] === 'super') {
            let supers = 0;
            while (rest[supers] === 'super') {
                supers++;
            }
            const after = rest[supers];
            if (after === 'crate') {
                base = [];
                rest = rest.slice(supers + 1);
            } else if ((after === undefined || after === 'self') && supers <= moduleSegments.length) {
                base = moduleSegments.slice(0, moduleSegments.length - supers);
                rest = rest.slice(supers + (after === 'self' ? 1 : 0));
            }
        }
        if (base === null) {
            continue;
        }
        const target = moduleFile([...base, ...rest]);
        for (const item of items) {
            imports.set(item.local, { file: target, name: item.name });
        }
    }

    /** One module file's literal const declarations, read once per run. */
    const declarationsFor = (path: string | null): ReadonlyMap<string, RustConstDeclaration | null> => {
        if (path === null) {
            return new Map();
        }
        const cached = rustConstDeclarations.get(path);
        if (cached !== undefined) {
            return cached;
        }
        const declarations = new Map<string, RustConstDeclaration | null>();
        const text = stripComments(readFileSync(path, 'utf8'));
        const declaration =
            /(?:^|\n)[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?const[ \t]+([A-Z][A-Z0-9_]*)[ \t]*:[ \t]*([^=\n]+?)[ \t]*=[ \t]*([^;\n]+);/g;
        for (const match of text.matchAll(declaration)) {
            const type = match[2]!.trim();
            const value = match[3]!.trim();
            if (type === '&str' || type === "&'static str") {
                const string = /^"([\w-]+)"$/.exec(value);
                declarations.set(match[1]!, string === null ? null : { kind: 'string', text: string[1]! });
                continue;
            }
            const numericType = /^(?:f32|f64|u\d+|i\d+|usize|isize)$/.test(type);
            const numericLiteral = new RegExp(`^${RUST_NUMBER}$`).test(value);
            if (numericType && numericLiteral) {
                declarations.set(match[1]!, { kind: 'number', value: Number(value.replaceAll('_', '')) });
                continue;
            }
            declarations.set(match[1]!, null);
        }
        rustConstDeclarations.set(path, declarations);
        return declarations;
    };

    const own = declarationsFor(file);
    const declarationFor = (identifier: string): RustConstDeclaration | null => {
        const local = own.get(identifier);
        if (local !== undefined) {
            return local;
        }
        const binding = imports.get(identifier);
        if (binding === undefined) {
            return null;
        }
        return declarationsFor(binding.file).get(binding.name) ?? null;
    };

    return {
        wireName: (identifier) => {
            const declaration = declarationFor(identifier);
            return declaration !== null && declaration.kind === 'string' ? declaration.text : null;
        },
        number: (identifier) => {
            const declaration = declarationFor(identifier);
            return declaration !== null && declaration.kind === 'number' ? declaration.value : null;
        },
    };
}

/**
 * Module-file const declarations are shared by every scanned file that imports
 * them (`params.rs` is read by half the crate), so they are parsed once.
 */
const rustConstDeclarations = new Map<string, ReadonlyMap<string, RustConstDeclaration | null>>();

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
 * Every wire name in match-arm position, including `"a" | "b" => …` chains.
 *
 * An arm element may be a string literal or an all-caps const the
 * shared-constants campaign substituted for one (`MIX =>`); the const resolves
 * through `readRustConstReferences`, and one that names no literal `&str` is
 * skipped rather than guessed at. Whitespace is collapsed first so an arm list
 * broken across lines reads the same as one written on a single line.
 */
function readMatchArmNames(body: string, references: RustConstReferences): string[] {
    const flattened = body.replaceAll(/\s+/g, ' ');
    // One arm element: a string literal, or an all-caps const. All-caps only,
    // so a `_ =>` wildcard, an enum variant (`None =>`), and a local binding
    // can never pose as a wire name.
    const element = String.raw`(?:"([\w-]+)"|([A-Z][A-Z0-9_]*))`;
    const arm = new RegExp(String.raw`${element}(?=(?: \| (?:"[\w-]+"|[A-Z][A-Z0-9_]*))* =>)`, 'g');
    const names: string[] = [];
    for (const match of flattened.matchAll(arm)) {
        const literal = match[1];
        if (literal !== undefined) {
            names.push(literal);
            continue;
        }
        const identifier = match[2];
        const resolved = identifier === undefined ? null : references.wireName(identifier);
        if (resolved !== null) {
            names.push(resolved);
        }
    }
    return names;
}

function readArmsFromFiles(files: readonly string[]): ReadonlySet<string> {
    const names = new Set<string>();
    for (const file of files) {
        const references = readRustConstReferences(file);
        for (const body of readParamFunctionBodies(stripComments(readFileSync(file, 'utf8')))) {
            for (const name of readMatchArmNames(body, references)) {
                names.add(name);
            }
        }
    }
    return names;
}

/**
 * The Rust files a write reaches, split into the ones every alternative sees
 * and the ones each alternative owns alone.
 *
 * A shared directory yields everything under it *minus* whatever an alternative
 * claims and minus the out-of-band sub-trees. That subtraction is the whole
 * point: `crates/proof-chamber/src` listed as shared must not hand `fdn.rs`'s
 * arms to the plate.
 */
function resolveEngineFiles(deviceType: NativeDspDeviceType): {
    shared: readonly string[];
    perEngine: ReadonlyMap<string, readonly string[]>;
} {
    const config = ENGINE_SOURCES[deviceType];
    const perEngine = new Map<string, readonly string[]>();
    const claimed: string[] = [];

    for (const alternative of config.alternatives) {
        const files = alternative.sources.flatMap((source) => collectRustSources(absolute(source)));
        perEngine.set(alternative.engineId, files);
        claimed.push(...alternative.sources.map((source) => absolute(source)));
    }

    const excluded = [...claimed, ...config.outOfBand.map((entry) => absolute(entry.path))];
    const shared = config.sharedSources
        .flatMap((source) => collectRustSources(absolute(source)))
        .filter((file) => !excluded.some((root) => isUnder(file, root)));

    return { shared, perEngine };
}

/**
 * Wire value → engine id, read out of the selector's dispatch.
 *
 * The wire value on the left of the arrow is what distinguishes the dispatch
 * from every other `match` over the same enum: `process` and `get_latency`
 * bind a variant on the *left* of `=>`, this one names one on the right. The
 * value arrives as a digit or — since the shared-constants campaign named the
 * wire ids — as the const holding one (`ALGORITHM_FDN8 =>`), resolved through
 * `readRustConstReferences`; a const that names no literal number is skipped
 * rather than guessed at. The pattern used to require a payload parenthesis
 * too, and the variants a wire value selects no longer carry one, because the
 * engines moved out of the enum so that selecting one stops allocating on the
 * render thread.
 */
function readSelectorWireValues(deviceType: NativeDspDeviceType): ReadonlyMap<number, string> {
    const config = ENGINE_SOURCES[deviceType];
    if (config.selector === null) {
        return new Map();
    }
    const source = readSource(config.selector.source).replaceAll(/\s+/g, ' ');
    const dispatch = new RegExp(String.raw`(\d+|[A-Z][A-Z0-9_]*) => ${config.selector.enumName}::(\w+)\b`, 'g');
    const references = readRustConstReferences(absolute(config.selector.source));
    const byVariant = new Map<string, string>();
    for (const alternative of config.alternatives) {
        for (const variant of alternative.variants) {
            byVariant.set(variant, alternative.engineId);
        }
    }

    const wire = new Map<number, string>();
    for (const match of source.matchAll(dispatch)) {
        const engineId = byVariant.get(match[2]!);
        if (engineId === undefined) {
            continue;
        }
        const value = /^\d+$/.test(match[1]!) ? Number(match[1]!) : references.number(match[1]!);
        if (value !== null) {
            wire.set(value, engineId);
        }
    }
    return wire;
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

type NativeDescriptor = {
    readonly deviceType: NativeDspDeviceType;
    readonly paramIds: readonly string[];
    readonly legalSets: ReadonlyMap<string, readonly number[]>;
    readonly internalParameterValues: ReadonlyMap<string, number>;
};

const NATIVE_DESCRIPTORS: readonly NativeDescriptor[] = BUILTIN_PLUGINS.flatMap((descriptor) => {
    const deviceType = resolveNativeDspDeviceType(descriptor.id);
    if (deviceType === null) {
        return [];
    }
    const legalSets = new Map<string, readonly number[]>();
    for (const param of descriptor.parameters) {
        if (param.legalSet !== undefined) {
            legalSets.set(param.id, param.legalSet.values);
        }
    }
    const internalParameterValues = new Map(Object.entries(descriptor.internalParameterValues ?? {}));
    return [
        {
            deviceType,
            paramIds: [...descriptor.parameters.map((param) => param.id), ...internalParameterValues.keys()],
            legalSets,
            internalParameterValues,
        },
    ];
});

const ENGINE_FILES = new Map(NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [deviceType, resolveEngineFiles(deviceType)]));

/** Arms every alternative of a device inherits — the dispatcher's own and the always-present stages. */
const SHARED_PARAM_NAMES = new Map<NativeDspDeviceType, ReadonlySet<string>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [deviceType, readArmsFromFiles(ENGINE_FILES.get(deviceType)!.shared)])
);

/** Arms only the named alternative answers to. */
const ENGINE_PARAM_NAMES = new Map<NativeDspDeviceType, ReadonlyMap<string, ReadonlySet<string>>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [
        deviceType,
        new Map(
            [...ENGINE_FILES.get(deviceType)!.perEngine].map(([engineId, files]) => [
                engineId,
                readArmsFromFiles(files),
            ])
        ),
    ])
);

const SELECTOR_WIRE_VALUES = new Map<NativeDspDeviceType, ReadonlyMap<number, string>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [deviceType, readSelectorWireValues(deviceType)])
);

const TRANSLATORS = new Map<NativeDspDeviceType, (paramId: string) => string>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [deviceType, buildTranslator(deviceType)])
);

/**
 * Engine ids a wire value can actually select.
 *
 * A device with no selector has exactly its default. Dutch Oven's convolution
 * and hybrid engines are built and render but no `algorithm` value constructs
 * them (`lib.rs:338-357`), so they are deliberately absent: a census that
 * demanded descriptor coverage from an engine nothing can reach would be
 * inventing work.
 */
function selectableEngineIds(deviceType: NativeDspDeviceType): readonly string[] {
    const config = ENGINE_SOURCES[deviceType];
    if (config.selector === null) {
        return [config.defaultEngineId];
    }
    return [...new Set(SELECTOR_WIRE_VALUES.get(deviceType)!.values())];
}

function engineAnswersTo(deviceType: NativeDspDeviceType, engineId: string, paramId: string): boolean {
    const translated = TRANSLATORS.get(deviceType)!(paramId);
    const shared = SHARED_PARAM_NAMES.get(deviceType)!;
    const own = ENGINE_PARAM_NAMES.get(deviceType)!.get(engineId);

    if (shared.has(translated) || own?.has(translated) === true) {
        return true;
    }

    const alias = ENGINE_PARAM_ALIASES.find(
        (row) => row.deviceId === deviceType && row.engineId === engineId && row.paramId === paramId
    );
    if (alias === undefined) {
        return false;
    }
    return shared.has(alias.handledAs) || own?.has(alias.handledAs) === true;
}

function defaultEngineAnswersTo(deviceType: NativeDspDeviceType, paramId: string): boolean {
    return engineAnswersTo(deviceType, ENGINE_SOURCES[deviceType].defaultEngineId, paramId);
}

const ALL_DECLARED_ROWS: readonly ParamExemption[] = [...PARAM_EXEMPTIONS, ...KNOWN_ORPHANS];

function isDeclared(deviceType: NativeDspDeviceType, paramId: string): boolean {
    return ALL_DECLARED_ROWS.some((row) => row.deviceId === deviceType && row.paramId === paramId);
}

function isDeclaredGap(deviceType: NativeDspDeviceType, engineId: string, paramId: string): boolean {
    return KNOWN_ENGINE_GAPS.some(
        (row) =>
            row.deviceId === deviceType &&
            row.engineId === engineId &&
            row.params.some((param) => param.paramId === paramId)
    );
}

describe('descriptor parameter ids are welded to engine set_param arms', () => {
    it('reads the Rust arms it claims to read', () => {
        // An absence assertion needs a presence pin (ADR 0015 rule 4). If the
        // repo-root walk or the arm regex went blind every device would report
        // an empty set, but a subtler break — bodies truncated at the first
        // `format!`, or arms only ever read from one file — would not show up in
        // the orphan list at all. Pin arms from three different files, and the
        // shape that must stay absent.
        const bacteria = SHARED_PARAM_NAMES.get('bacteria')!;

        expect(bacteria.has('crossoverFreq1')).toBe(true); // engine.rs, BacteriaEngine
        expect(bacteria.has('gain')).toBe(true); // engine.rs, BandChain
        expect(bacteria.has('grainSize')).toBe(true); // granular.rs
        expect(bacteria.has('bandGain')).toBe(false);
    });

    it('keeps one alternative’s arms out of the next one’s set', () => {
        // The pin for the split itself. Before it, all five reverb engines read
        // out of one directory and any arm satisfied all of them. `matrix` is
        // the FDN's feedback-matrix selector and exists nowhere else; `dispersion`
        // is the spring's; `reverse_time` is the reverse engine's. Each must be
        // visible to exactly its own engine, and the shared set — `lib.rs` and
        // the stages every algorithm runs — must hold the two globals and none
        // of the three.
        const dutchOven = ENGINE_PARAM_NAMES.get('dutch-oven')!;
        const shared = SHARED_PARAM_NAMES.get('dutch-oven')!;

        expect(dutchOven.get('fdn')!.has('matrix')).toBe(true);
        expect(dutchOven.get('plate')!.has('matrix')).toBe(false);
        expect(dutchOven.get('spring')!.has('dispersion')).toBe(true);
        expect(dutchOven.get('plate')!.has('dispersion')).toBe(false);
        expect(dutchOven.get('reverse')!.has('reverse_time')).toBe(true);
        expect(dutchOven.get('fdn')!.has('reverse_time')).toBe(false);

        expect(shared.has('algorithm')).toBe(true); // lib.rs, before the forward
        expect(shared.has('vintage')).toBe(true);
        expect(shared.has('fdn_damping_version')).toBe(true);
        expect(shared.has('matrix')).toBe(false);
        expect(shared.has('dispersion')).toBe(false);
    });

    it('welds private descriptor defaults to exact supported engine wire values', () => {
        const descriptor = NATIVE_DESCRIPTORS.find((entry) => entry.deviceType === 'dutch-oven')!;
        const declaredVersion = descriptor.internalParameterValues.get('fdn_damping_version');
        const source = readSource(`${PROOF_CHAMBER}/lib.rs`);
        const armStart = source.indexOf('"fdn_damping_version" =>');
        const arm = readBalancedBlock(source, source.indexOf('{', armStart));
        const supportedVersions = [...arm.matchAll(/(\d+)\.0\s*=>\s*(\d+)/g)]
            .filter((match) => match[1] === match[2])
            .map((match) => Number(match[1]));

        expect(declaredVersion).toBe(2);
        expect(supportedVersions).toContain(declaredVersion);
        expect(isInternalDeviceParameter({ deviceType: 'dutch-oven', paramId: 'fdn_damping_version' })).toBe(true);
        expect(isDeviceParameterAutomatable({ deviceType: 'dutch-oven', paramId: 'fdn_damping_version' })).toBe(false);
    });

    it('does not let an out-of-band sub-tree vouch for a device-level id', () => {
        // Toaster's pad engines are reached through `set_pad_param`, never
        // through the descriptor's route. These three are arms no file outside
        // `engines/` carries — the kick's transient click, the modal engine's
        // exciter and the cymbal's shimmer — so if the exclusion stopped
        // working they would appear in the device's arm set and a descriptor
        // could advertise any of them and pass.
        const toaster = SHARED_PARAM_NAMES.get('toaster')!;

        expect(toaster.has('master_gain')).toBe(true); // engine.rs, kit level
        expect(toaster.has('click_level')).toBe(false);
        expect(toaster.has('exciter_length')).toBe(false);
        expect(toaster.has('shimmer_rate')).toBe(false);
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

    it('the default engine is one the device declares', () => {
        const undeclared = NATIVE_DSP_DEVICE_TYPES.filter(
            (deviceType) =>
                !ENGINE_SOURCES[deviceType].alternatives.some(
                    (alternative) => alternative.engineId === ENGINE_SOURCES[deviceType].defaultEngineId
                )
        );

        expect(undeclared).toEqual([]);
    });

    it('the wire values the Rust dispatch accepts are the ones the descriptor calls legal', () => {
        // Two independent sources: the numbers `ProofChamberInstance::set_param`
        // constructs an engine for, and the `legalSet` the descriptor publishes
        // for the same parameter. A new algorithm wired in Rust without a
        // descriptor update — or a descriptor that keeps advertising a value the
        // dispatch dropped — shows up here rather than as a selector that lands
        // on the fallback.
        const drift: string[] = [];

        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            const selector = ENGINE_SOURCES[deviceType].selector;
            if (selector === null) {
                continue;
            }
            const descriptor = NATIVE_DESCRIPTORS.find((entry) => entry.deviceType === deviceType);
            const declared = [...(descriptor?.legalSets.get(selector.paramId) ?? [])].sort((a, b) => a - b);
            const dispatched = [...SELECTOR_WIRE_VALUES.get(deviceType)!.keys()].sort((a, b) => a - b);
            if (declared.join(',') !== dispatched.join(',')) {
                drift.push(
                    `${deviceType}.${selector.paramId}: descriptor [${declared.join(', ')}] vs Rust [${dispatched.join(', ')}]`
                );
            }
        }

        expect(drift).toEqual([]);
    });

    it('every advertised parameter reaches the engine the device runs by default', () => {
        // The assertion #1481 needed and did not have. `early_late` was welded
        // by `fdn.rs` while `ProofChamber::set_param` dropped it, and the plate
        // is what a freshly constructed Dutch Oven is — so every project heard a
        // dead knob while the census stayed green. No exemption table stands in
        // front of this one.
        const orphans: string[] = [];
        for (const { deviceType, paramIds } of NATIVE_DESCRIPTORS) {
            for (const paramId of paramIds) {
                if (!defaultEngineAnswersTo(deviceType, paramId) && !isDeclared(deviceType, paramId)) {
                    orphans.push(`${deviceType}.${ENGINE_SOURCES[deviceType].defaultEngineId}.${paramId}`);
                }
            }
        }

        expect(orphans).toEqual([]);
    });

    it('every advertised parameter reaches every selectable engine, or the gap is named', () => {
        // The rest of the matrix. A parameter one algorithm handles and another
        // drops is not automatically a defect — but it is never a non-event
        // either, because `ProofChamberPanel` renders every control whatever the
        // algorithm, so the user gets a live knob wired to nothing. Each gap has
        // to be named in `KNOWN_ENGINE_GAPS` with a reason.
        const gaps: string[] = [];
        for (const { deviceType, paramIds } of NATIVE_DESCRIPTORS) {
            for (const engineId of selectableEngineIds(deviceType)) {
                for (const paramId of paramIds) {
                    if (
                        !engineAnswersTo(deviceType, engineId, paramId) &&
                        !isDeclared(deviceType, paramId) &&
                        !isDeclaredGap(deviceType, engineId, paramId)
                    ) {
                        gaps.push(`${deviceType}.${engineId}.${paramId}`);
                    }
                }
            }
        }

        expect(gaps).toEqual([]);
    });

    it('every named engine gap still names a parameter that engine still drops', () => {
        // Both reverse directions for the gap table in one place: the row must
        // still describe a descriptor parameter, the engine must still be
        // selectable, and the arm must still be missing. The moment someone
        // writes the DSP, the row is a lie and has to go.
        const stale: string[] = [];
        for (const row of KNOWN_ENGINE_GAPS) {
            const descriptor = NATIVE_DESCRIPTORS.find((entry) => entry.deviceType === row.deviceId);
            if (!selectableEngineIds(row.deviceId).includes(row.engineId)) {
                stale.push(`${row.deviceId}.${row.engineId}: not a selectable engine`);
                continue;
            }
            for (const { paramId } of row.params) {
                if (descriptor?.paramIds.includes(paramId) !== true) {
                    stale.push(`${row.deviceId}.${row.engineId}.${paramId}: not a descriptor parameter`);
                    continue;
                }
                if (engineAnswersTo(row.deviceId, row.engineId, paramId)) {
                    stale.push(`${row.deviceId}.${row.engineId}.${paramId}: the engine answers to it now`);
                }
            }
        }

        expect(stale).toEqual([]);
    });

    it('every alias still bridges a name the engine answers to, and is still needed', () => {
        const broken: string[] = [];
        for (const row of ENGINE_PARAM_ALIASES) {
            const shared = SHARED_PARAM_NAMES.get(row.deviceId)!;
            const own = ENGINE_PARAM_NAMES.get(row.deviceId)!.get(row.engineId);
            const translated = TRANSLATORS.get(row.deviceId)!(row.paramId);

            if (!shared.has(row.handledAs) && own?.has(row.handledAs) !== true) {
                broken.push(`${row.deviceId}.${row.engineId}.${row.paramId}: no ${row.handledAs} arm to bridge to`);
            }
            if (shared.has(translated) || own?.has(translated) === true) {
                broken.push(`${row.deviceId}.${row.engineId}.${row.paramId}: answered directly, alias is dead`);
            }
        }

        expect(broken).toEqual([]);
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
        // go to be forgotten: the moment *any* selectable engine answers to one
        // of these, the row is a lie and has to be deleted.
        const wired = ALL_DECLARED_ROWS.filter((row) =>
            selectableEngineIds(row.deviceId).some((engineId) => engineAnswersTo(row.deviceId, engineId, row.paramId))
        ).map((row) => `${row.deviceId}.${row.paramId}`);

        expect(wired).toEqual([]);
    });

    it('the wire value → engine map production reads is the dispatch Rust performs', () => {
        // `ProofChamberPanel` gates its controls on the gap table, and to pick
        // the row it needs to know which engine the selected algorithm runs.
        // Production cannot read `lib.rs` — it ships to a browser — so it
        // declares the mapping in `#/utils/nativeDspEngineGaps`. This is the
        // weld for that declaration: the dispatch is scanned out of the Rust
        // exactly as the arms are, and the two must agree in both directions.
        // A new algorithm wired in Rust, or a renumbered one, reds here rather
        // than silently pointing the panel at the wrong engine's gap row.
        const fromRust = SELECTOR_WIRE_VALUES.get('dutch-oven')!;
        const declared = new Map(
            Object.entries(DUTCH_OVEN_ENGINE_BY_WIRE_VALUE).map(([wire, engineId]) => [Number(wire), engineId])
        );

        const asSortedPairs = (map: ReadonlyMap<number, string>): string[] =>
            [...map].sort((a, b) => a[0] - b[0]).map(([wire, engineId]) => `${wire}=${engineId}`);

        expect(asSortedPairs(declared)).toEqual(asSortedPairs(fromRust));
        // Presence pin: an empty scan would make the two agree vacuously.
        expect(asSortedPairs(fromRust)).toEqual(['0=plate', '1=fdn', '2=fdn', '3=spring', '6=reverse']);
    });

    it('every structural gap row says why no DSP will ever close it', () => {
        // A `structural` row claims the parameter is a category error rather
        // than a defect, which is the claim that stops someone filing DSP work
        // for it — and it is the text the panel shows the user. An empty one
        // would disable a control and explain nothing.
        const unexplained = KNOWN_ENGINE_GAPS.flatMap((row) =>
            row.params
                .filter((param) => param.kind === 'structural' && param.note.trim().length === 0)
                .map((param) => `${row.deviceId}.${row.engineId}.${param.paramId}`)
        );

        expect(unexplained).toEqual([]);
    });

    it('every declared row carries a reason', () => {
        const unreasoned = [
            ...ALL_DECLARED_ROWS.map((row) => ({ id: `${row.deviceId}.${row.paramId}`, reason: row.reason })),
            ...KNOWN_ENGINE_GAPS.map((row) => ({ id: `${row.deviceId}.${row.engineId}`, reason: row.reason })),
            ...ENGINE_PARAM_ALIASES.map((row) => ({
                id: `${row.deviceId}.${row.engineId}.${row.paramId}`,
                reason: row.reason,
            })),
            ...Object.entries(ENGINE_SOURCES).flatMap(([deviceType, config]) =>
                config.outOfBand.map((entry) => ({ id: `${deviceType}:${entry.path}`, reason: entry.reason }))
            ),
        ]
            .filter((row) => row.reason.trim().length === 0)
            .map((row) => row.id);

        expect(unreasoned).toEqual([]);
    });
});
