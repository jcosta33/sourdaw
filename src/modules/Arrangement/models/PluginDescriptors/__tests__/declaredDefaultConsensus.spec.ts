import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NATIVE_DSP_DEVICE_TYPES, type NativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';

/**
 * A device's default for one parameter is written down in up to three places,
 * and nothing checked that they say the same number.
 *
 * The three are not redundant copies — each is read by a different surface:
 *
 * - The **descriptor** (`BUILTIN_PLUGINS`) supplies `defaultValue` to the
 *   generic Inspector and to the automation lane, which draws its baseline at
 *   the declared default.
 * - The **module default patch** (`DEFAULT_PATCH` and friends under
 *   `src/modules/<Device>/models/`) is the state a freshly added device
 *   actually gets, and the state the param bridge pushes to the engine.
 * - The **panel reset value** (`defaultValue` on a knob) is where a
 *   double-click puts the control.
 *
 * So a disagreement is not cosmetic. Grinder's noise gate is what it costs:
 * `7690f7139` reworked `NoiseGate` so the user's attack and release times drive
 * the *gain* stage as well as the detector (before it, the open ramp was a
 * hard-coded `0.05` coefficient and the close was a hard-coded `*= 0.999`), and
 * raised `DEFAULT_PATCH` from 0.5 ms / 50 ms to 2 ms / 120 ms to suit the new
 * shape. `2b080af5a` then authored the panel knobs with the same 2 / 120. The
 * parameter-metadata table and its inlined descriptor copy were never touched,
 * so for four months a fresh Grinder showed 2 ms / 120 ms on its own panel
 * while the Inspector and the automation lane called the default 0.5 ms / 50 ms
 * — the lane drawing its baseline four times and 2.4 times away from the value
 * the device was actually running.
 *
 * ## Why the population is derived
 *
 * Two independent enumerations, so a device or a panel cannot join without
 * joining the census:
 *
 * - `DEFAULT_SOURCES` is a total `Record` over `NativeDspDeviceType`. Adding a
 *   native device fails to compile until someone says where its defaults live,
 *   the same way `NATIVE_DSP_DEVICE_TYPES` breaks the hydration table.
 * - The patch-source and panel legs are both *discovered* from the filesystem
 *   and compared against what is declared. A second default table appearing in
 *   a device module, or a panel binding its parameter ids where it previously
 *   did not, reds this file without anyone editing it.
 *
 * ## What the third leg cannot see
 *
 * The panel reset value is a literal JSX prop, not a derived value, so it is
 * only machine-readable where the same element also names its parameter id.
 * Two element shapes do that — `param="gateAttack"` (Grinder, Gluten) and
 * `onChange={(value) => setParam('damping', value)}` (Dutch Oven) — and both
 * are scanned. The remaining panels bind through a member expression on a
 * sub-object (`patch.mic1.positionX`), a table row (`param.defaultValue`), or a
 * setter whose parameter name is not a literal, and those knobs have **no**
 * third leg here: `PANELS_WITHOUT_PARAM_BINDING` names each one and why. That
 * is a real hole, and it is enumerated rather than papered over — a two-leg
 * census that is honest beats a three-leg one that guesses.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

function readSource(relativePath: string): string {
    return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

// ── Leg two: the module default patch ────────────────────────────────────────

/**
 * The top-level scalar fields of one exported object literal.
 *
 * Only the top level: a nested object is a different scope (Grinder's `mic1`,
 * Proof's `eqBands`) whose keys are not device parameter ids, and folding them
 * in would let an unrelated `gain` vouch for the device-level one. Booleans
 * fold to 0/1 because that is the wire form every param bridge sends and the
 * form the descriptor declares them in (`type: 'int'`, min 0, max 1).
 */
function readObjectScalars(relativePath: string, exportName: string): Map<string, number> {
    const source = readSource(relativePath);
    const anchor = new RegExp(`^export const ${exportName}\\b[^=]*=\\s*(?:Object\\.freeze\\()?\\{`, 'm');
    const opening = anchor.exec(source);
    if (opening === null) {
        return new Map();
    }

    let depth = 0;
    let index = opening.index + opening[0].length - 1;
    const start = index;
    for (; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{' || char === '[') {
            depth += 1;
        }
        if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0) {
                break;
            }
        }
    }

    const scalars = new Map<string, number>();
    let nesting = 0;
    for (const rawLine of source.slice(start + 1, index).split('\n')) {
        const line = rawLine.trim();
        if (nesting === 0) {
            const pair = /^([A-Za-z_$][\w$]*)\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?|true|false)\s*,?\s*(?:\/\/.*)?$/.exec(
                line
            );
            if (pair !== null) {
                const literal = pair[2]!;
                if (literal === 'true') {
                    scalars.set(pair[1]!, 1);
                } else if (literal === 'false') {
                    scalars.set(pair[1]!, 0);
                } else {
                    scalars.set(pair[1]!, Number(literal));
                }
            }
        }
        nesting += (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
    }

    return scalars;
}

/** Every exported SCREAMING_CASE const in a file whose initializer is an object literal. */
function findObjectExports(relativePath: string): string[] {
    const source = readSource(relativePath);
    const pattern = /^export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(?:Object\.freeze\()?\{/gm;
    const names: string[] = [];
    let match: RegExpExecArray | null = pattern.exec(source);
    while (match !== null) {
        names.push(match[1]!);
        match = pattern.exec(source);
    }
    return names;
}

function listModelFiles(moduleDir: string): string[] {
    let entries: string[];
    try {
        entries = readdirSync(join(REPO_ROOT, moduleDir, 'models'));
    } catch {
        return [];
    }
    return entries
        .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
        .map((entry) => `${moduleDir}/models/${entry}`);
}

// ── Leg three: the panel reset value ─────────────────────────────────────────

/**
 * Knob elements that name both their parameter id and their reset literal.
 *
 * The element text cannot be matched with `[^>]*` — `onChange={(v) => …}` puts
 * a `>` inside the tag — so the scanner walks forward from the opening name
 * tracking brace depth and quotes, and stops at the first `>` outside both.
 */
function readPanelResetValues(relativePath: string): Map<string, number> {
    const source = readSource(relativePath);
    const openings = /<[A-Z][\w.]*(?=[\s/>])/g;
    const resets = new Map<string, number>();

    let opening: RegExpExecArray | null = openings.exec(source);
    while (opening !== null) {
        let depth = 0;
        let quote = '';
        let cursor = opening.index;
        for (; cursor < source.length; cursor += 1) {
            const char = source[cursor]!;
            if (quote !== '') {
                if (char === quote) {
                    quote = '';
                }
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {
                quote = char;
            } else if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
            } else if (char === '>' && depth === 0) {
                break;
            }
        }

        const element = source.slice(opening.index, cursor + 1);
        const paramId =
            /\bparam="([\w$]+)"/.exec(element) ??
            /\bonChange=\{\([\w, ]*\)\s*=>\s*set[A-Za-z]*\(\s*'([\w$]+)'\s*,/.exec(element);
        const reset = /\bdefaultValue=\{(-?\d+(?:\.\d+)?)\}/.exec(element);
        if (paramId !== null && reset !== null) {
            resets.set(paramId[1] ?? paramId[2]!, Number(reset[1]!));
        }

        opening = openings.exec(source);
    }

    return resets;
}

function listPanelFiles(): string[] {
    const modules = readdirSync(join(REPO_ROOT, 'src/modules'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    const panels: string[] = [];
    for (const moduleName of modules) {
        let entries: string[];
        try {
            entries = readdirSync(join(REPO_ROOT, 'src/modules', moduleName, 'presentations/views'));
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.endsWith('.tsx')) {
                continue;
            }
            const relativePath = `src/modules/${moduleName}/presentations/views/${entry}`;
            if (readSource(relativePath).includes('defaultValue=')) {
                panels.push(relativePath);
            }
        }
    }
    return panels;
}

// ── Where each device writes its defaults down ───────────────────────────────

type PatchSource = {
    readonly file: string;
    readonly exportName: string;
};

type DeviceDefaults = {
    readonly moduleDir: string;
    /**
     * The object literals whose top-level scalars are device parameter
     * defaults. More than one when the device splits its defaults — Bacteria
     * keeps the per-band controls in `DEFAULT_BAND` and the device-level ones
     * in `DEFAULT_PATCH`, and the descriptor flattens both into one namespace.
     * Empty means the device has no such object at all, and `noPatchReason`
     * says why.
     */
    readonly patchSources: readonly PatchSource[];
    /** The panel whose knobs name their parameter ids, or null. */
    readonly panel: string | null;
    readonly noPatchReason: string;
};

const DEFAULT_SOURCES: Record<NativeDspDeviceType, DeviceDefaults> = {
    fermenter: {
        moduleDir: 'src/modules/Fermenter',
        patchSources: [{ file: 'src/modules/Fermenter/models/FermenterPatch.ts', exportName: 'DEFAULT_PATCH' }],
        panel: null,
        noPatchReason: '',
    },
    toaster: {
        moduleDir: 'src/modules/Toaster',
        patchSources: [],
        panel: null,
        noPatchReason:
            'Toaster has no device-level default object. Its four descriptor parameters (masterGain, reverbMix, ' +
            'delayMix, swing) are kit-level and live in the store the kit loader seeds; `models/ToasterKit.ts` ' +
            'exports only `DEFAULT_PAD_NAMES` and `DEFAULT_ENGINE_TYPES`, which are pad identity, not parameter ' +
            'values. There is no second declaration to disagree with the descriptor, so the device has one leg.',
    },
    levain: {
        moduleDir: 'src/modules/Levain',
        patchSources: [],
        panel: null,
        noPatchReason:
            'Levain declares no default patch. `models/LevainPatch.ts` exports four sub-configs (expression, ' +
            'legato, humanize, release-trigger) whose keys are none of the six descriptor parameter ids; the ' +
            'instrument manifest supplies the rest at load time. One leg.',
    },
    'builtin-crumbs': {
        moduleDir: 'src/modules/Crumbs',
        patchSources: [],
        panel: null,
        noPatchReason:
            'Crumbs holds its per-pad envelope and filter values on the pad records the sampler builds when a ' +
            'sample is assigned, not in a default-patch object. `models/CrumbsTypes.ts` exports only scalar ' +
            'constants (`DEFAULT_PAD_COLOR`, `DEFAULT_PAD_COUNT`). One leg.',
    },
    'grand-boule': {
        moduleDir: 'src/modules/GrandBoule',
        patchSources: [],
        panel: null,
        noPatchReason:
            'GrandBoule has no default object under `models/`; its three descriptor parameters are seeded into ' +
            'the store by the engine bootstrap. `GrandBoulePanel` does declare reset literals that agree with the ' +
            'descriptor (0.7 / 0.6 / 0.25) but binds them through a use-case lambda with no parameter-id literal, ' +
            'so no leg here can read them — see `PANELS_WITHOUT_PARAM_BINDING`.',
    },
    gluten: {
        moduleDir: 'src/modules/Gluten',
        patchSources: [{ file: 'src/modules/Gluten/models/GlutenPatch.ts', exportName: 'DEFAULT_PATCH' }],
        panel: 'src/modules/Gluten/presentations/views/GlutenPanel.tsx',
        noPatchReason: '',
    },
    crust: {
        moduleDir: 'src/modules/Crust',
        patchSources: [{ file: 'src/modules/Crust/models/CrustPatch.ts', exportName: 'DEFAULT_CRUST_PATCH' }],
        panel: null,
        noPatchReason: '',
    },
    bacteria: {
        moduleDir: 'src/modules/Bacteria',
        patchSources: [
            { file: 'src/modules/Bacteria/models/BacteriaPatch.ts', exportName: 'DEFAULT_PATCH' },
            // The descriptor advertises the per-band controls at device level —
            // `drive`, `filterCutoff`, `grainSize` and the rest are one band's
            // fields — so the band defaults are the second half of this device's
            // declaration, not a nested detail.
            { file: 'src/modules/Bacteria/models/BacteriaPatch.ts', exportName: 'DEFAULT_BAND' },
        ],
        panel: null,
        noPatchReason: '',
    },
    grinder: {
        moduleDir: 'src/modules/Grinder',
        patchSources: [{ file: 'src/modules/Grinder/models/GrinderPatch.ts', exportName: 'DEFAULT_PATCH' }],
        panel: 'src/modules/Grinder/presentations/views/GrinderPanel.tsx',
        noPatchReason: '',
    },
    proof: {
        moduleDir: 'src/modules/Proof',
        patchSources: [{ file: 'src/modules/Proof/models/ProofPatch.ts', exportName: 'DEFAULT_PATCH' }],
        panel: null,
        noPatchReason: '',
    },
    'dutch-oven': {
        moduleDir: 'src/modules/ProofChamber',
        patchSources: [{ file: 'src/modules/ProofChamber/models/ProofChamberState.ts', exportName: 'DEFAULT_PARAMS' }],
        panel: 'src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx',
        noPatchReason: '',
    },
    'native-scoring': {
        moduleDir: 'src/modules/Tuner',
        patchSources: [],
        panel: null,
        noPatchReason:
            'The Tuner has no parameter-default object. `DEFAULT_TUNER_STATE` is measurement output — frequency, ' +
            'cents, confidence, the detected note — and shares no key with the three descriptor parameters ' +
            '(a4_hz, mute, tone). The reference pitch lives in `models/A4Reference.ts` as a bare scalar. One leg.',
    },
    knead: {
        moduleDir: 'src/modules/Knead',
        patchSources: [],
        panel: null,
        noPatchReason:
            'Knead has no `models/` directory at all — the module is handlers, stores and use cases — and no ' +
            'descriptor either, so there is nothing to compare. One leg, and it is empty.',
    },
};

/**
 * Object literals inside a censused device module that are *not* parameter
 * defaults.
 *
 * This is the reverse direction of the patch-source discovery: every
 * SCREAMING_CASE object export under a device module's `models/` must be either
 * a declared leg above or a row here. A second default table appearing beside
 * an existing one — the exact shape that produced the Grinder drift, where
 * `GRINDER_PARAMS` sat next to `DEFAULT_PATCH` disagreeing with it — cannot be
 * added without this file failing.
 */
const NON_DEFAULT_MODEL_OBJECTS: readonly {
    readonly file: string;
    readonly exportName: string;
    readonly reason: string;
}[] = [
    {
        file: 'src/modules/Grinder/models/GrinderPatch.ts',
        exportName: 'DEFAULT_MIC',
        reason:
            'The default state of one cabinet microphone, held under `mic1`/`mic2` inside the patch. Its keys ' +
            '(positionX, distance, …) are not descriptor parameter ids — the descriptor advertises only ' +
            '`micBlend` and `roomAmount` at device level.',
    },
    {
        file: 'src/modules/Proof/models/ProofPatch.ts',
        exportName: 'PROOF_PATCH_RANGES',
        reason:
            'Min/max bounds, not defaults. Declared-range agreement is a different claim with its own census ' +
            '(`declaredRangeVsKnobTravel.spec.ts`); this file only reads the value a control starts at.',
    },
    {
        file: 'src/modules/GrandBoule/models/GrandBouleMidiCalibration.ts',
        exportName: 'MIDI_CALIBRATION_RANGES',
        reason: 'Velocity-curve calibration bounds for MIDI input. Not a device parameter, and not a default.',
    },
    {
        file: 'src/modules/Levain/models/LevainPatch.ts',
        exportName: 'ARTICULATION_ID_BY_TYPE',
        reason: 'A lookup from articulation type to sample-set id. No numeric parameter values.',
    },
    {
        file: 'src/modules/Levain/models/LevainPatch.ts',
        exportName: 'DEFAULT_EXPRESSION_CONFIG',
        reason:
            'Per-articulation expression mapping held inside the instrument, not a device parameter default. ' +
            'None of its keys is one of Levain’s six descriptor parameter ids.',
    },
    {
        file: 'src/modules/Levain/models/LevainPatch.ts',
        exportName: 'DEFAULT_LEGATO_CONFIG',
        reason: 'Legato transition timings inside the instrument. No descriptor parameter id among its keys.',
    },
    {
        file: 'src/modules/Levain/models/LevainPatch.ts',
        exportName: 'DEFAULT_HUMANIZE_CONFIG',
        reason:
            'Humanisation spreads inside the instrument. Levain’s descriptor advertises a single `humanize` ' +
            'amount, which this object does not declare.',
    },
    {
        file: 'src/modules/Levain/models/LevainPatch.ts',
        exportName: 'DEFAULT_RELEASE_TRIGGER_CONFIG',
        reason: 'Release-sample trigger settings inside the instrument. No descriptor parameter id among its keys.',
    },
    {
        file: 'src/modules/Fermenter/models/FermenterDspParam.ts',
        exportName: 'FERMENTER_DSP_PARAM_OVERRIDES',
        reason:
            'A name map — descriptor id to Rust `set_param` arm (`filterCutoff` → `cutoff`). Its values are ' +
            'strings, so it declares no default at all.',
    },
    {
        file: 'src/modules/Crumbs/models/CrumbsParameterMap.ts',
        exportName: 'CRUMBS_PARAM_TARGETS',
        reason:
            'A routing table: which sub-object of the pad each persisted parameter id writes into. Values are ' +
            '`{ kind, key }` records, not numbers.',
    },
    {
        file: 'src/modules/Proof/models/ProofPatch.ts',
        exportName: 'TARGET_LUFS',
        reason:
            'Loudness targets per delivery format (streaming −14, club −6, …). Keyed by target name rather ' +
            'than by parameter id, and none of the three Proof descriptor parameters appears in it.',
    },
    {
        file: 'src/modules/ProofChamber/models/ProofChamberState.ts',
        exportName: 'ALGORITHM_MAP',
        reason: 'Algorithm label to the wire integer stored in the project file. A vocabulary, not a default.',
    },
    {
        file: 'src/modules/ProofChamber/models/ProofChamberState.ts',
        exportName: 'SPACE_PRESETS',
        reason:
            'Per-space preset overlays applied *on top of* `DEFAULT_PARAMS`, so they are presets rather than ' +
            'defaults. Worth noting for the `damping` row below: the `hall` overlay a fresh Dutch Oven runs ' +
            '(`DEFAULT_PARAMS.space` is `hall`) also says `damping: 0.3`, so the descriptor’s 0.0005 is ' +
            'outvoted a third time.',
    },
    {
        file: 'src/modules/ProofChamber/models/ProofChamberState.ts',
        exportName: 'PARAM_MAP',
        reason: 'The camelCase→snake_case name map the bridge uses to reach the Rust engine. String values.',
    },
    {
        file: 'src/modules/Tuner/models/TunerState.ts',
        exportName: 'DEFAULT_TUNER_STATE',
        reason:
            'Measurement output — the detected pitch before anything has been measured. Shares no key with the ' +
            'Tuner’s three descriptor parameters.',
    },
];

/**
 * Descriptor ids whose module counterpart is a label union, not a number.
 *
 * The patch stores `topology: 'vca'` where the descriptor stores the wire
 * integer the engine matches on; the label→integer map lives in the param
 * bridge. Comparing them here would mean duplicating that map into a test, so
 * these are excluded — and the exclusion is checked in both directions: the day
 * a patch key becomes numeric, its row here reds.
 */
const LABEL_UNION_PARAMS: readonly { readonly deviceId: NativeDspDeviceType; readonly paramIds: readonly string[] }[] =
    [
        { deviceId: 'grinder', paramIds: ['engineMode'] },
        { deviceId: 'gluten', paramIds: ['topology', 'style', 'detection', 'stereoMode', 'blendTopology'] },
        { deviceId: 'bacteria', paramIds: ['crossoverMode', 'distortionMode', 'filterMode'] },
        { deviceId: 'dutch-oven', paramIds: ['algorithm'] },
    ];

/**
 * Descriptor ids the module spells differently, beyond snake_case→camelCase.
 *
 * Snake to camel is derived, so `mod_rate`→`modRate` needs no row. This is only
 * for names that differ in substance.
 */
const PARAM_KEY_ALIASES: readonly {
    readonly deviceId: NativeDspDeviceType;
    readonly paramId: string;
    readonly patchKey: string;
    readonly reason: string;
}[] = [
    {
        deviceId: 'dutch-oven',
        paramId: 'early_late',
        patchKey: 'earlyLateBalance',
        reason:
            'The engine arm and the descriptor call it `early_late`; `ProofChamberEngineState` calls it ' +
            '`earlyLateBalance`. One control, two spellings, and the bridge maps between them.',
    },
];

/**
 * (device, parameter) triples where the declarations disagree, recorded rather
 * than fixed, with the verdict on which source is wrong.
 *
 * Asserted in both directions. A listed row that stops disagreeing reds until
 * the row is deleted; an unlisted disagreement reds immediately.
 */
type DefaultDivergence = {
    readonly deviceId: NativeDspDeviceType;
    readonly paramId: string;
    readonly reason: string;
};

const KNOWN_DEFAULT_DIVERGENCES: readonly DefaultDivergence[] = [
    {
        deviceId: 'dutch-oven',
        paramId: 'damping',
        reason:
            'Descriptor 0.0005 against 0.3 in both `DEFAULT_PARAMS` and the panel knob. **The descriptor is the ' +
            'wrong one**, and its number has a traceable origin: 0.0005 is the literal the Rust plate seeds its ' +
            '`damping` field with (`crates/proof-chamber/src/proof_chamber.rs:394`), an internal one-pole ' +
            'coefficient that holds only until the first parameter write. It was transcribed into the descriptor ' +
            'as if it were a user-facing default. It is not one: `ProofChamberPanel` renders damping as a ' +
            'percentage (`formatValue(params.damping, "%")`), so a fresh Dutch Oven reads 30% on its own panel ' +
            'while the Inspector and the automation lane call the default 0.05%. Recorded, not fixed here: ' +
            'ProofChamber is being changed on another lane (`feat/dutch-oven-panel-algorithm-gating`), and a ' +
            'descriptor edit under it belongs with that work, not under a Grinder fix.',
    },
];

/**
 * Panels that declare reset literals but do not name the parameter each one
 * belongs to, so the third leg cannot read them.
 *
 * Both directions. The count is the number of `defaultValue=` literals the
 * panel declares that this file cannot attribute; if a panel starts binding its
 * parameter ids, its knobs join the census and the count here stops matching.
 */
const PANELS_WITHOUT_PARAM_BINDING: readonly {
    readonly file: string;
    readonly unreadable: number;
    readonly reason: string;
}[] = [
    {
        file: 'src/modules/Bacteria/presentations/views/BacteriaPanel.tsx',
        unreadable: 1,
        reason: 'One shared knob wrapper forwarding `defaultValue={defaultValue}` — a prop, not a literal.',
    },
    {
        file: 'src/modules/Gluten/presentations/views/GlutenPanel.tsx',
        unreadable: 1,
        reason:
            'The shared `Knob` wrapper (`defaultValue={defaultValue}`). Every one of its twenty-four call sites ' +
            'passes `param="…"` and is censused.',
    },
    {
        file: 'src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx',
        unreadable: 9,
        reason:
            'One wrapper plus eight knobs that bind through a use-case call with no parameter-id literal — ' +
            '`onChange={(value) => setGrandBouleMasterGain({ deviceId, engine, store, gain: value })}`. The id is ' +
            'the *function chosen*, not an argument, so no scanner can recover it without a hand-written map from ' +
            'use case to parameter — which would be a fourth declaration to drift.',
    },
    {
        file: 'src/modules/Grinder/presentations/views/GrinderPanel.tsx',
        unreadable: 8,
        reason:
            'One shared `GrinderKnob` wrapper; six microphone knobs bound to `patch.mic1.positionX` and siblings, ' +
            'which are sub-object fields and not descriptor parameters; and one pedal knob whose reset comes from ' +
            'a table row (`defaultValue={param.defaultValue}`) rather than a literal. The other twenty-five are ' +
            'censused.',
    },
    {
        file: 'src/modules/Levain/presentations/views/LevainPanel.tsx',
        unreadable: 1,
        reason: 'A shared knob wrapper forwarding its prop.',
    },
    {
        file: 'src/modules/MixerConsole/presentations/views/MixerPanel.tsx',
        unreadable: 1,
        reason: 'A channel-strip control, not a device parameter — the mixer is not a plugin with a descriptor.',
    },
    {
        file: 'src/modules/Proof/presentations/views/ProofPanel.tsx',
        unreadable: 9,
        reason:
            'Proof binds through `onPatchChange({ key: "limCeiling", value, isTransient })` — an object property ' +
            'inside the lambda rather than the first positional argument the scanner reads. Only three of the ' +
            'nine are descriptor parameters anyway; the rest are per-band EQ and dynamics controls the descriptor ' +
            'does not advertise.',
    },
    {
        file: 'src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx',
        unreadable: 1,
        reason: "The shared `Knob` wrapper. The other seventeen bind through `setParam('…', value)` and are censused.",
    },
    {
        file: 'src/modules/Setlist/presentations/views/SetlistPanel.tsx',
        unreadable: 2,
        reason: 'Setlist is show control, not a device — no descriptor, nothing to agree with.',
    },
    {
        file: 'src/modules/Toaster/presentations/views/ToasterPanel.tsx',
        unreadable: 13,
        reason:
            "Every Toaster knob binds through `setToasterPadParam(deviceId, selectedPadIndex, 'decay', value)`, " +
            'where the id is the *third* argument. The scanner reads only the first, deliberately: widening it to ' +
            'any quoted argument would let a pad index or a device id be read as a parameter name.',
    },
    {
        file: 'src/modules/Tuner/presentations/views/TunerPanel.tsx',
        unreadable: 1,
        reason: 'A shared knob wrapper forwarding its prop.',
    },
    {
        file: 'src/modules/Yeast/presentations/views/YeastPanel.tsx',
        unreadable: 3,
        reason:
            'Yeast is the MIDI FX rack: its three arpeggiator knobs bind through a rack-slot setter keyed by slot ' +
            'index. It also has no native engine, so it is outside `DEFAULT_SOURCES` entirely.',
    },
];

/**
 * How many (device, parameter) comparisons the census actually performs.
 *
 * Count provenance: measured on `c2ec90b4d` + this change, by summing the
 * descriptor parameters each censused device resolves against a patch scalar.
 * descriptor-vs-patch 282 = fermenter 105 + bacteria 59 + grinder 40 + gluten
 * 38 + crust 16 + proof 3 + dutch-oven 21 (20 direct plus `early_late` through
 * its alias). descriptor-vs-panel 66 = grinder 25 + gluten 24 + dutch-oven 17.
 *
 * Pinned because every leg here is a regex over source text, and a regex that
 * silently stops matching turns this file into a test that compares nothing and
 * passes. A rename that moves an export, a panel that restyles its knobs, a
 * prettier pass that wraps a literal onto its own line — each would drop rows
 * without dropping an assertion. The floor is what makes that visible. Raise it
 * when the census genuinely widens; a *drop* is the bug it exists to catch.
 */
const MIN_PATCH_COMPARISONS = 282;
const MIN_PANEL_COMPARISONS = 66;

// ── Resolution ───────────────────────────────────────────────────────────────

function toCamelCase(id: string): string {
    return id.replaceAll(/_([a-z])/g, (_full, letter: string) => letter.toUpperCase());
}

const CENSUSED_DEVICE_IDS = NATIVE_DSP_DEVICE_TYPES.filter(
    (deviceType) => DEFAULT_SOURCES[deviceType].patchSources.length > 0
);

/** deviceId → descriptor parameter id → declared default. */
const DESCRIPTOR_DEFAULTS = new Map<string, Map<string, number>>(
    BUILTIN_PLUGINS.map((plugin) => [
        plugin.id,
        new Map(plugin.parameters.map((parameter) => [parameter.id, parameter.defaultValue])),
    ])
);

/** deviceId → module patch key → declared default, unioned across that device's sources. */
const PATCH_DEFAULTS = new Map<NativeDspDeviceType, Map<string, number>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => {
        const merged = new Map<string, number>();
        for (const source of DEFAULT_SOURCES[deviceType].patchSources) {
            for (const [key, value] of readObjectScalars(source.file, source.exportName)) {
                merged.set(key, value);
            }
        }
        return [deviceType, merged];
    })
);

const PANEL_RESETS = new Map<NativeDspDeviceType, Map<string, number>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => {
        const panel = DEFAULT_SOURCES[deviceType].panel;
        return [deviceType, panel === null ? new Map<string, number>() : readPanelResetValues(panel)];
    })
);

function isLabelUnion(deviceId: NativeDspDeviceType, paramId: string): boolean {
    return LABEL_UNION_PARAMS.some((row) => row.deviceId === deviceId && row.paramIds.includes(paramId));
}

/** The module key a descriptor id resolves to, or null when the module never declares it. */
function patchKeyFor(deviceId: NativeDspDeviceType, paramId: string): string | null {
    const alias = PARAM_KEY_ALIASES.find((row) => row.deviceId === deviceId && row.paramId === paramId);
    if (alias !== undefined) {
        return alias.patchKey;
    }
    const scalars = PATCH_DEFAULTS.get(deviceId)!;
    if (scalars.has(paramId)) {
        return paramId;
    }
    const camel = toCamelCase(paramId);
    if (scalars.has(camel)) {
        return camel;
    }
    return null;
}

/** The descriptor id a panel's parameter key belongs to, or null when unadvertised. */
function descriptorIdForPanelKey(deviceId: NativeDspDeviceType, panelKey: string): string | null {
    const descriptor = DESCRIPTOR_DEFAULTS.get(deviceId)!;
    if (descriptor.has(panelKey)) {
        return panelKey;
    }
    const alias = PARAM_KEY_ALIASES.find((row) => row.deviceId === deviceId && row.patchKey === panelKey);
    if (alias !== undefined && descriptor.has(alias.paramId)) {
        return alias.paramId;
    }
    // Dutch Oven's panel spells its ids in camelCase while the descriptor
    // spells them snake_case, so resolve that way round before calling a knob
    // unadvertised.
    return [...descriptor.keys()].find((id) => toCamelCase(id) === panelKey) ?? null;
}

function isDeclaredDivergence(deviceId: NativeDspDeviceType, paramId: string): boolean {
    return KNOWN_DEFAULT_DIVERGENCES.some((row) => row.deviceId === deviceId && row.paramId === paramId);
}

describe('a device default is the same number wherever it is declared', () => {
    it('reads the module default objects it claims to read', () => {
        // The vacuity guard for leg two. An export that has been renamed or
        // reshaped yields an empty map, and every later comparison would then
        // pass by comparing nothing.
        const empty: string[] = [];
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            for (const source of DEFAULT_SOURCES[deviceType].patchSources) {
                if (readObjectScalars(source.file, source.exportName).size === 0) {
                    empty.push(`${deviceType}: ${source.file}#${source.exportName}`);
                }
            }
        }

        expect(empty).toEqual([]);
    });

    it('reads the panel reset values it claims to read', () => {
        // The same guard for leg three, plus the reverse direction on the
        // holes: a panel that starts naming its parameter ids has to be
        // recensused rather than left in the unreadable list.
        const discovered = listPanelFiles().sort();
        expect(discovered).toEqual(PANELS_WITHOUT_PARAM_BINDING.map((row) => row.file).sort());

        const wrong: string[] = [];
        for (const row of PANELS_WITHOUT_PARAM_BINDING) {
            const declared = (readSource(row.file).match(/defaultValue=/g) ?? []).length;
            const readable = readPanelResetValues(row.file).size;
            if (declared - readable !== row.unreadable) {
                wrong.push(`${row.file}: declared ${declared}, readable ${readable}, row claims ${row.unreadable}`);
            }
        }

        expect(wrong).toEqual([]);
    });

    it('every device module’s default objects are either a census leg or named as something else', () => {
        // Population derivation, reverse direction. `GRINDER_PARAMS` sitting
        // beside `DEFAULT_PATCH` and disagreeing with it is what this catches:
        // a second table cannot appear in a device module without a decision
        // recorded here.
        const unclaimed: string[] = [];
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            const config = DEFAULT_SOURCES[deviceType];
            for (const file of listModelFiles(config.moduleDir)) {
                for (const exportName of findObjectExports(file)) {
                    const isLeg = config.patchSources.some(
                        (source) => source.file === file && source.exportName === exportName
                    );
                    const isNamed = NON_DEFAULT_MODEL_OBJECTS.some(
                        (row) => row.file === file && row.exportName === exportName
                    );
                    if (!isLeg && !isNamed) {
                        unclaimed.push(`${file}#${exportName}`);
                    }
                }
            }
        }

        expect(unclaimed).toEqual([]);
    });

    it('every device without a default-patch object still has none, and says why', () => {
        // The other half: a device declared leg-less must not have quietly
        // grown a default table, and a device that has one must not be sitting
        // behind a reason.
        const wrong: string[] = [];
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            const config = DEFAULT_SOURCES[deviceType];
            const hasSources = config.patchSources.length > 0;
            if (hasSources && config.noPatchReason.length > 0) {
                wrong.push(`${deviceType}: has patch sources and a reason for having none`);
            }
            if (!hasSources && config.noPatchReason.trim().length === 0) {
                wrong.push(`${deviceType}: no patch sources and no reason`);
            }
            if (!hasSources) {
                const stray = listModelFiles(config.moduleDir).flatMap((file) =>
                    findObjectExports(file)
                        .filter((exportName) =>
                            NON_DEFAULT_MODEL_OBJECTS.every((row) => row.file !== file || row.exportName !== exportName)
                        )
                        .map((exportName) => `${file}#${exportName}`)
                );
                for (const entry of stray) {
                    wrong.push(`${deviceType}: undeclared object export ${entry}`);
                }
            }
        }

        expect(wrong).toEqual([]);
    });

    it('the descriptor default is the module default', () => {
        // The load-bearing comparison. Both sides are read out of the files
        // production compiles, and they are different files maintained by
        // different work — the descriptors were split out of the modules in
        // `27d7ce794` and have been duplicates ever since.
        const disagreements: string[] = [];
        let compared = 0;

        for (const deviceType of CENSUSED_DEVICE_IDS) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(deviceType);
            expect(descriptor, `${deviceType} has no descriptor`).toBeDefined();
            const scalars = PATCH_DEFAULTS.get(deviceType)!;

            for (const [paramId, declared] of descriptor!) {
                if (isLabelUnion(deviceType, paramId)) {
                    continue;
                }
                const key = patchKeyFor(deviceType, paramId);
                if (key === null) {
                    disagreements.push(`${deviceType}.${paramId}: the module declares no default for it`);
                    continue;
                }
                compared += 1;
                const moduleValue = scalars.get(key)!;
                if (moduleValue !== declared && !isDeclaredDivergence(deviceType, paramId)) {
                    disagreements.push(`${deviceType}.${paramId}: descriptor ${declared}, module ${moduleValue}`);
                }
            }
        }

        expect(disagreements).toEqual([]);
        expect(compared).toBeGreaterThanOrEqual(MIN_PATCH_COMPARISONS);
    });

    it('the panel reset value is the module default and the descriptor default', () => {
        // The third source. It is the one that decided Grinder: the panel knob
        // and the patch agreed on 2 / 120 against the descriptor's 0.5 / 50, so
        // the descriptor was outvoted by two independently authored surfaces.
        const disagreements: string[] = [];
        let compared = 0;

        for (const deviceType of CENSUSED_DEVICE_IDS) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(deviceType)!;
            const scalars = PATCH_DEFAULTS.get(deviceType)!;

            for (const [panelKey, reset] of PANEL_RESETS.get(deviceType)!) {
                const paramId = descriptorIdForPanelKey(deviceType, panelKey);
                if (paramId === null) {
                    disagreements.push(`${deviceType}.${panelKey}: panel knob for an unadvertised parameter`);
                    continue;
                }

                compared += 1;
                const declared = descriptor.get(paramId)!;
                if (declared !== reset && !isDeclaredDivergence(deviceType, paramId)) {
                    disagreements.push(`${deviceType}.${paramId}: panel ${reset}, descriptor ${declared}`);
                }
                const key = patchKeyFor(deviceType, paramId);
                if (key !== null && scalars.get(key) !== reset) {
                    disagreements.push(`${deviceType}.${paramId}: panel ${reset}, module ${scalars.get(key)!}`);
                }
            }
        }

        expect(disagreements).toEqual([]);
        expect(compared).toBeGreaterThanOrEqual(MIN_PANEL_COMPARISONS);
    });

    it('every recorded divergence still diverges, and still names a real parameter', () => {
        // Reverse direction on the divergence table. A row that is fixed —
        // whether by correcting the descriptor or by moving the module — has to
        // be deleted, so this cannot become a place drift goes to be forgotten.
        const stale: string[] = [];
        for (const row of KNOWN_DEFAULT_DIVERGENCES) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(row.deviceId);
            const declared = descriptor?.get(row.paramId);
            if (declared === undefined) {
                stale.push(`${row.deviceId}.${row.paramId}: not a descriptor parameter`);
                continue;
            }
            const key = patchKeyFor(row.deviceId, row.paramId);
            const moduleValue = key === null ? undefined : PATCH_DEFAULTS.get(row.deviceId)!.get(key);
            const panelResets = PANEL_RESETS.get(row.deviceId)!;
            const panelKey = [...panelResets.keys()].find(
                (candidate) => descriptorIdForPanelKey(row.deviceId, candidate) === row.paramId
            );
            const panelValue = panelKey === undefined ? undefined : panelResets.get(panelKey);
            const agrees =
                (moduleValue === undefined || moduleValue === declared) &&
                (panelValue === undefined || panelValue === declared);
            if (agrees) {
                stale.push(`${row.deviceId}.${row.paramId}: the declarations agree now`);
            }
        }

        expect(stale).toEqual([]);
    });

    it('every label-union exclusion still names a parameter the module stores as a label', () => {
        // Reverse direction on the exclusions. If a patch key becomes numeric
        // the row is a lie, and the parameter belongs in the census.
        const stale: string[] = [];
        for (const row of LABEL_UNION_PARAMS) {
            const scalars = PATCH_DEFAULTS.get(row.deviceId)!;
            const descriptor = DESCRIPTOR_DEFAULTS.get(row.deviceId)!;
            for (const paramId of row.paramIds) {
                if (!descriptor.has(paramId)) {
                    stale.push(`${row.deviceId}.${paramId}: not a descriptor parameter`);
                }
                if (scalars.has(paramId)) {
                    stale.push(`${row.deviceId}.${paramId}: the module stores a number for it now`);
                }
            }
        }

        expect(stale).toEqual([]);
    });

    it('every alias still bridges a name the module uses and the descriptor does not', () => {
        const broken: string[] = [];
        for (const row of PARAM_KEY_ALIASES) {
            const scalars = PATCH_DEFAULTS.get(row.deviceId)!;
            if (!scalars.has(row.patchKey)) {
                broken.push(`${row.deviceId}.${row.paramId}: no ${row.patchKey} in the module default`);
            }
            if (scalars.has(row.paramId) || scalars.has(toCamelCase(row.paramId))) {
                broken.push(`${row.deviceId}.${row.paramId}: resolves without the alias, so the alias is dead`);
            }
        }

        expect(broken).toEqual([]);
    });

    it('every declared row carries a reason', () => {
        const unreasoned = [
            ...KNOWN_DEFAULT_DIVERGENCES.map((row) => ({ id: `${row.deviceId}.${row.paramId}`, reason: row.reason })),
            ...PARAM_KEY_ALIASES.map((row) => ({ id: `${row.deviceId}.${row.paramId}`, reason: row.reason })),
            ...NON_DEFAULT_MODEL_OBJECTS.map((row) => ({ id: `${row.file}#${row.exportName}`, reason: row.reason })),
            ...PANELS_WITHOUT_PARAM_BINDING.map((row) => ({ id: row.file, reason: row.reason })),
        ]
            .filter((row) => row.reason.trim().length === 0)
            .map((row) => row.id);

        expect(unreasoned).toEqual([]);
    });
});
