import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NATIVE_DSP_DEVICE_TYPES, type NativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';

/**
 * A device's default for one parameter is written down in several places, and
 * nothing checked that they say the same number.
 *
 * They are not redundant copies — each is read by a different surface, and
 * which surface reads which is worth stating exactly, because an earlier
 * revision of this comment got it backwards and a wrong verdict followed:
 *
 * - The **descriptor** (`BUILTIN_PLUGINS`) is what a freshly added device
 *   sends to the engine. `addDevice` seeds `parameterValues` from every
 *   descriptor `param.value` (`addDevice.ts:61-65`) and then calls
 *   `updateDeviceParam` once per parameter (`addDevice.ts:103-105`) whenever
 *   the track has a live strip. It also supplies the Inspector readout and the
 *   automation lane's baseline.
 * - The **module default declarations** under `src/modules/<Device>/models/`
 *   are what the *panel* renders, and what the param bridge pushes on preset
 *   load and snapshot recall. They are **not** what a new instance sends to the
 *   engine, and this was the mis-model: `syncGrinderPatchToAudio` has exactly
 *   two callers — `loadGrinderPatchWithAudio` and
 *   `recallGrinderSnapshotWithAudio` — neither reached on add or on mount, and
 *   `registerChamberInstance` writes only `chamberStore`. There are two shapes
 *   and a device can have both: an object patch (`DEFAULT_PATCH`) and a
 *   parameter table (`GRINDER_PARAMS`, `FERMENTER_PARAMS` — arrays of
 *   `{ id, min, max, default }` rows).
 * - The **panel reset value** (`defaultValue` on a knob) is where a
 *   double-click puts the control.
 *
 * So when these disagree, the engine and the panel are showing the user two
 * different numbers for the same control, and the first double-click jumps
 * from one to the other. Grinder is the case this change fixes: `7690f7139`
 * reworked `NoiseGate` so the user's attack and release times drive the *gain*
 * stage as well as the detector, and raised `DEFAULT_PATCH` from 0.5 ms / 50 ms
 * to 2 ms / 120 ms; `2b080af5a` authored the panel knobs with the same 2 / 120.
 * The parameter table and its inlined descriptor copy were never touched, so a
 * fresh Grinder ran 0.5 / 50 in the engine, read 2 / 120 on its own panel, and
 * offered the lane a baseline four times and 2.4 times from the panel figure.
 *
 * Nobody has heard that: `gateEnabled` defaults to false, the descriptor
 * advertises no `gateEnabled` at all, so `addDevice` never writes it and the
 * Rust gate stays bypassed. The claim this file makes is **consistency**, not
 * voicing — which of 0.5 / 50 and 2 / 120 is the better gate is a separate
 * question, and 2 ms is in fact slow for an attack next to the sub-millisecond
 * defaults on comparable gates. Whoever opens that question starts here.
 *
 * ## Every source is compared to the descriptor, never merged
 *
 * An earlier revision merged a device's declarations into one map before
 * comparing. That hides the defect it exists to catch: `GRINDER_PARAMS` and
 * `DEFAULT_PATCH` both declare `gateAttack`, and a merge lets the later one
 * answer for the earlier. Each source is now resolved and compared on its own,
 * so two declarations that disagree with each other cannot both be reported as
 * agreeing with the descriptor.
 *
 * ## Why the population is derived
 *
 * Three independent enumerations, so nothing joins the codebase without
 * joining the census:
 *
 * - `DEFAULT_SOURCES` is a total `Record` over `NativeDspDeviceType`. Adding a
 *   native device fails to compile until someone says where its defaults live.
 * - **Module declarations** are discovered from the filesystem in both shapes:
 *   every exported object literal, *and* every exported table whose body
 *   contains a numeric `default:` or `defaultValue:`. Matching only `= {`
 *   is what let `GRINDER_PARAMS` — an array — sit beside `DEFAULT_PATCH`
 *   disagreeing with it, unseen.
 * - **Panel files** are discovered by walking each device module's whole
 *   `presentations/` tree, not just `views/`. Scanning `views/` alone missed
 *   Fermenter's entire control surface, which lives in
 *   `presentations/components/`, and there is no `panel:` field to hand-write:
 *   a device's panel leg is derived from its `moduleDir`, so a device cannot be
 *   quietly excluded from it.
 *
 * ## What the third leg can and cannot read
 *
 * The panel reset value is a literal JSX prop, not a derived value, so it is
 * only machine-readable where the same element also names its parameter. Three
 * element shapes do, and all three are scanned:
 *
 * - `param="gateAttack"` — Grinder, Gluten
 * - `paramId="oscLevel"` — Fermenter's sections
 * - an `onChange` arrow whose call takes the id as its **first** argument,
 *   `onChange={(value) => setParam('damping', value)}` — Dutch Oven, Crumbs
 *
 * First argument only, deliberately. Toaster writes
 * `setToasterPadParam(deviceId, selectedPadIndex, 'decay', value)` and Proof
 * writes `updateBand(i, 'threshold', value)`; a reader that took a quoted
 * argument from any position would read a device id or a band index as a
 * parameter name. Those knobs stay unread, and `PANEL_FILES` records for every
 * discovered file how many reset literals it declares and how many of them this
 * scanner can attribute — both numbers, not their difference, so a newly
 * readable binding cannot be absorbed by an equal rise in the total.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

function readSource(relativePath: string): string {
    return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

// ── Leg two: what the module declares ────────────────────────────────────────

/** The balanced body of one exported const's object or array literal. */
function readExportBody(source: string, exportName: string): string | null {
    const anchor = new RegExp(`^export const ${exportName}\\b[^=]*=\\s*(?:Object\\.freeze\\()?[{[]`, 'm');
    const opening = anchor.exec(source);
    if (opening === null) {
        return null;
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

    return source.slice(start + 1, index);
}

function toNumber(literal: string): number {
    if (literal === 'true') {
        return 1;
    }
    if (literal === 'false') {
        return 0;
    }
    return Number(literal);
}

/**
 * The top-level scalar fields of an exported object literal.
 *
 * Only the top level: a nested object is a different scope (Grinder's `mic1`,
 * Proof's `eqBands`) whose keys are not device parameter ids, and folding them
 * in would let an unrelated `gain` vouch for the device-level one. Booleans
 * fold to 0/1 because that is the wire form every param bridge sends and the
 * form the descriptor declares them in (`type: 'int'`, min 0, max 1).
 */
function readObjectScalars(relativePath: string, exportName: string): Map<string, number> {
    const body = readExportBody(readSource(relativePath), exportName);
    const scalars = new Map<string, number>();
    if (body === null) {
        return scalars;
    }

    let nesting = 0;
    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (nesting === 0) {
            const pair = /^([A-Za-z_$][\w$]*)\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?|true|false)\s*,?\s*(?:\/\/.*)?$/.exec(
                line
            );
            if (pair !== null) {
                scalars.set(pair[1]!, toNumber(pair[2]!));
            }
        }
        nesting += (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
    }

    return scalars;
}

/**
 * The `default` of every row in an exported parameter table.
 *
 * `{ id: 'gateAttack', label: 'Gate Atk', min: 0.1, max: 50, default: 2 }`.
 * `key`/`defaultValue` are accepted alongside `id`/`default` because
 * `PER_NOTE_PARAM_DESCRIPTORS` uses that spelling — a table this scanner must
 * see in order to say anything true about whether it is a device-parameter
 * declaration.
 */
function readTableDefaults(relativePath: string, exportName: string): Map<string, number> {
    const body = readExportBody(readSource(relativePath), exportName);
    const defaults = new Map<string, number>();
    if (body === null) {
        return defaults;
    }

    for (const row of body.matchAll(/\{[^{}]*\}/g)) {
        const id = /\b(?:id|key):\s*'([\w$]+)'/.exec(row[0]);
        const value = /\b(?:default|defaultValue):\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?|true|false)/.exec(row[0]);
        if (id !== null && value !== null) {
            defaults.set(id[1]!, toNumber(value[1]!));
        }
    }

    return defaults;
}

type DeclarationShape = 'object' | 'table';

function readDeclaredDefaults(relativePath: string, exportName: string, shape: DeclarationShape): Map<string, number> {
    if (shape === 'table') {
        return readTableDefaults(relativePath, exportName);
    }
    return readObjectScalars(relativePath, exportName);
}

/**
 * Every exported const in a file that could be declaring parameter defaults.
 *
 * Two ways to qualify, because there are two shapes and the earlier revision of
 * this file only knew one. An object literal qualifies on sight — its top-level
 * scalars are candidate parameter values. Anything else, array included,
 * qualifies when its body contains a numeric `default:` or `defaultValue:`,
 * which is what a parameter table looks like from the outside.
 */
function findDeclarationExports(relativePath: string): { name: string; shape: DeclarationShape }[] {
    const source = readSource(relativePath);
    const pattern = /^export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(?:Object\.freeze\()?([{[])/gm;
    const found: { name: string; shape: DeclarationShape }[] = [];

    let match: RegExpExecArray | null = pattern.exec(source);
    while (match !== null) {
        const name = match[1]!;
        const isObject = match[2] === '{';
        const body = readExportBody(source, name) ?? '';
        const declaresDefaults = /\b(?:default|defaultValue):\s*-?\d/.test(body);
        if (isObject || declaresDefaults) {
            found.push({ name, shape: declaresDefaults && !isObject ? 'table' : 'object' });
        }
        match = pattern.exec(source);
    }

    return found;
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

/** Every JSX opening tag in a file, brace- and quote-aware. */
function readElements(source: string): string[] {
    const openings = /<[A-Z][\w.]*(?=[\s/>])/g;
    const elements: string[] = [];

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
        elements.push(source.slice(opening.index, cursor + 1));
        opening = openings.exec(source);
    }

    return elements;
}

/** Knob elements that name both their parameter and their reset literal. */
function readPanelResetValues(relativePath: string): Map<string, number> {
    const resets = new Map<string, number>();

    for (const element of readElements(readSource(relativePath))) {
        const reset = /\bdefaultValue=\{(-?\d+(?:\.\d+)?)\}/.exec(element);
        if (reset === null) {
            continue;
        }
        const paramId =
            /\bparam(?:Id)?="([\w$]+)"/.exec(element)?.[1] ??
            /\bonChange=\{\([\w, ]*\)\s*=>\s*[\w.]+\(\s*'([\w$]+)'\s*,/.exec(element)?.[1];
        if (paramId !== undefined) {
            resets.set(paramId, Number(reset[1]!));
        }
    }

    return resets;
}

function countResetLiterals(relativePath: string): number {
    return (readSource(relativePath).match(/defaultValue=/g) ?? []).length;
}

/** Every `.tsx` under one directory tree that declares a reset literal. */
function collectPanelFiles(dir: string, found: string[]): void {
    let entries: import('node:fs').Dirent[];
    try {
        entries = readdirSync(join(REPO_ROOT, dir), { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const relativePath = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') {
                collectPanelFiles(relativePath, found);
            }
        } else if (entry.name.endsWith('.tsx') && readSource(relativePath).includes('defaultValue=')) {
            found.push(relativePath);
        }
    }
}

/** Every `.tsx` under a module's `presentations/` tree that declares a reset literal. */
function listPanelFiles(moduleDir: string): string[] {
    const found: string[] = [];
    collectPanelFiles(`${moduleDir}/presentations`, found);
    return found.sort();
}

function listAllModuleDirs(): string[] {
    return readdirSync(join(REPO_ROOT, 'src/modules'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `src/modules/${entry.name}`)
        .sort();
}

// ── Where each device writes its defaults down ───────────────────────────────

type PatchSource = {
    readonly file: string;
    readonly exportName: string;
    readonly shape: DeclarationShape;
};

type DeviceDefaults = {
    /**
     * The module that owns the device. Both the model scan and the panel scan
     * are derived from this — there is no per-device file list to fall out of
     * date, and no way to exclude a device's panels by omission.
     */
    readonly moduleDir: string;
    readonly patchSources: readonly PatchSource[];
    /** Why the device declares no defaults under `models/`. Empty when it does. */
    readonly noPatchReason: string;
    /** Why no knob in the module's `presentations/` tree is readable. Empty when some are. */
    readonly noPanelReason: string;
};

const DEFAULT_SOURCES: Record<NativeDspDeviceType, DeviceDefaults> = {
    fermenter: {
        moduleDir: 'src/modules/Fermenter',
        patchSources: [
            { file: 'src/modules/Fermenter/models/FermenterPatch.ts', exportName: 'DEFAULT_PATCH', shape: 'object' },
            // The 105-row parameter table, re-exported through
            // `useCases/fermenterQueries/` and read by `MacroMatrixEditor`. A
            // fourth declaration of every Fermenter default, invisible to this
            // census until the scanner learned to read arrays.
            {
                file: 'src/modules/Fermenter/models/FermenterPatch.ts',
                exportName: 'FERMENTER_PARAMS',
                shape: 'table',
            },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    toaster: {
        moduleDir: 'src/modules/Toaster',
        patchSources: [],
        noPatchReason:
            'Toaster has no device-level default declaration. Its four descriptor parameters (masterGain, ' +
            'reverbMix, delayMix, swing) are kit-level and live in the store the kit loader seeds; ' +
            '`models/ToasterKit.ts` exports pad identity (`DEFAULT_PAD_NAMES`, `DEFAULT_ENGINE_TYPES`, ' +
            '`PAD_COLORS`) and no parameter values at all.',
        noPanelReason:
            '`ToasterPanel` declares thirteen reset literals and binds every one through ' +
            "`setToasterPadParam(deviceId, selectedPadIndex, 'decay', value)`, where the id is the third " +
            'argument. This scanner reads the first only; widening it would read `deviceId` and the pad index as ' +
            'parameter names.',
    },
    levain: {
        moduleDir: 'src/modules/Levain',
        patchSources: [],
        noPatchReason:
            'Levain declares no default patch. `models/LevainPatch.ts` exports four sub-configs (expression, ' +
            'legato, humanize, release-trigger) whose keys are none of the six descriptor parameter ids; the ' +
            'instrument manifest supplies the rest at load time.',
        noPanelReason:
            "Levain's eighteen reset literals sit on knobs that write a *fragment* of a sub-config — " +
            '`onChange={(v) => onChange({ amount: v })}` — so the id is an object key inside a lambda and names ' +
            'a field of `DEFAULT_HUMANIZE_CONFIG` rather than a descriptor parameter.',
    },
    'builtin-crumbs': {
        moduleDir: 'src/modules/Crumbs',
        patchSources: [],
        noPatchReason:
            'Crumbs holds its per-pad envelope and filter values on the pad records the sampler builds when a ' +
            'sample is assigned, not in a default-patch object. `models/CrumbsTypes.ts` exports only scalar ' +
            'constants (`DEFAULT_PAD_COLOR`, `DEFAULT_PAD_COUNT`).',
        noPanelReason: '',
    },
    'grand-boule': {
        moduleDir: 'src/modules/GrandBoule',
        patchSources: [],
        noPatchReason:
            'GrandBoule declares no defaults for its three descriptor parameters; they are seeded into the store ' +
            'by the engine bootstrap. Its two `models/` tables that do declare defaults — ' +
            '`MIDI_CALIBRATION_RANGES` and `PER_NOTE_PARAM_DESCRIPTORS` — describe MIDI response and per-note ' +
            'offsets, and share no key with the descriptor.',
        noPanelReason:
            "GrandBoule's nineteen reset literals bind through a use-case call whose parameter identity is the " +
            '*function chosen*, not an argument — `onChange={(value) => setGrandBouleMasterGain({ deviceId, ' +
            'engine, store, gain: value })}`. Recovering the id needs a hand-written use-case→parameter map, ' +
            'which would be one more declaration to drift. The literals do agree with the descriptor by ' +
            'inspection (0.7 / 0.6 / 0.25); nothing here checks that.',
    },
    gluten: {
        moduleDir: 'src/modules/Gluten',
        patchSources: [
            { file: 'src/modules/Gluten/models/GlutenPatch.ts', exportName: 'DEFAULT_PATCH', shape: 'object' },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    crust: {
        moduleDir: 'src/modules/Crust',
        patchSources: [
            { file: 'src/modules/Crust/models/CrustPatch.ts', exportName: 'DEFAULT_CRUST_PATCH', shape: 'object' },
        ],
        noPatchReason: '',
        noPanelReason:
            '`CrustControlZone` declares two reset literals and both forward a prop (`defaultValue={def}`) from a ' +
            'shared knob wrapper, so neither is a literal at the call site this scanner reads.',
    },
    bacteria: {
        moduleDir: 'src/modules/Bacteria',
        patchSources: [
            { file: 'src/modules/Bacteria/models/BacteriaPatch.ts', exportName: 'DEFAULT_PATCH', shape: 'object' },
            // The descriptor advertises the per-band controls at device level —
            // `drive`, `filterCutoff`, `grainSize` and the rest are one band's
            // fields — so the band defaults are the second half of this device's
            // declaration, not a nested detail.
            { file: 'src/modules/Bacteria/models/BacteriaPatch.ts', exportName: 'DEFAULT_BAND', shape: 'object' },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    grinder: {
        moduleDir: 'src/modules/Grinder',
        patchSources: [
            { file: 'src/modules/Grinder/models/GrinderPatch.ts', exportName: 'DEFAULT_PATCH', shape: 'object' },
            // The table the Arrangement descriptor was copied out of. It is the
            // source this PR's second fix corrects, and until the scanner read
            // arrays it was the one declaration nothing here could see.
            { file: 'src/modules/Grinder/models/GrinderPatch.ts', exportName: 'GRINDER_PARAMS', shape: 'table' },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    proof: {
        moduleDir: 'src/modules/Proof',
        patchSources: [
            { file: 'src/modules/Proof/models/ProofPatch.ts', exportName: 'DEFAULT_PATCH', shape: 'object' },
        ],
        noPatchReason: '',
        noPanelReason:
            "Proof's twenty-four reset literals bind either through " +
            "`onPatchChange({ key: 'limCeiling', value })` — an object property, not a positional argument — " +
            "or through `updateBand(i, 'threshold', value)`, where the id is second and the first argument is a " +
            'band index. Only three of the twenty-four are descriptor parameters in any case; the rest are ' +
            'per-band EQ and dynamics controls the descriptor does not advertise.',
    },
    'dutch-oven': {
        moduleDir: 'src/modules/ProofChamber',
        patchSources: [
            {
                file: 'src/modules/ProofChamber/models/ProofChamberState.ts',
                exportName: 'DEFAULT_PARAMS',
                shape: 'object',
            },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    'native-scoring': {
        moduleDir: 'src/modules/Tuner',
        patchSources: [],
        noPatchReason:
            'The Tuner has no parameter-default declaration. `DEFAULT_TUNER_STATE` is measurement output — ' +
            'frequency, cents, confidence, the detected note — and shares no key with the three descriptor ' +
            'parameters (a4_hz, mute, tone). The reference pitch lives in `models/A4Reference.ts` as a bare ' +
            'scalar.',
        noPanelReason:
            "`TunerPanel`'s single reset literal forwards a prop from a shared knob wrapper, so there is no " +
            'literal at a call site to attribute.',
    },
    knead: {
        moduleDir: 'src/modules/Knead',
        patchSources: [],
        noPatchReason:
            'Knead has no `models/` directory at all — the module is handlers, stores and use cases — and no ' +
            'descriptor either, so there is nothing to compare.',
        noPanelReason: 'Knead has no `presentations/` directory; its controls live in the shared mixer strip.',
    },
};

/**
 * Declarations inside a censused device module that are *not* device parameter
 * defaults.
 *
 * The reverse direction of discovery: every candidate export under a device
 * module's `models/` must be either a declared leg above or a row here. This is
 * what a second parameter table cannot get past — the shape that produced the
 * Grinder drift, where `GRINDER_PARAMS` sat beside `DEFAULT_PATCH` disagreeing
 * with it for four months.
 */
const NON_DEFAULT_MODEL_DECLARATIONS: readonly {
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
        reason:
            'Velocity-curve and CC-smoothing calibration, keyed by its own names (velocityCurveExponent, ' +
            'velocityFloor, …). It does declare five numeric defaults, which is why the scanner surfaces it, but ' +
            "none of its keys is one of GrandBoule's three descriptor parameters.",
    },
    {
        file: 'src/modules/GrandBoule/models/GrandBoulePerNoteParams.ts',
        exportName: 'PER_NOTE_PARAM_DESCRIPTORS',
        reason:
            'Eight per-note *offsets* — hammer hardness, string stiffness and so on — each defaulting to 1.0 as ' +
            'a multiplier against the model. A table in the same shape as `GRINDER_PARAMS` (keyed `key` with ' +
            '`defaultValue`), which is why it is read and named here, but its ids are per-note trims and the ' +
            'descriptor advertises none of them.',
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
            'defaults. Note for the `damping` row below, where an earlier revision of this file counted the ' +
            '`hall` overlay as a third vote for 0.3: it is not one. `expandSpacePreset` has a single production ' +
            'caller — the space-tile click handler in `ProofChamberPanel` — so no overlay runs until a user ' +
            'picks a space, and `DEFAULT_PARAMS.space` naming `hall` does not mean the hall overlay has been ' +
            'applied.',
    },
    {
        file: 'src/modules/ProofChamber/models/ProofChamberState.ts',
        exportName: 'PARAM_MAP',
        reason: 'The camelCase→snake_case name map the bridge uses to reach the Rust engine. String values.',
    },
    {
        file: 'src/modules/ProofChamber/models/ProofChamberAlgorithmGating.ts',
        exportName: 'ALGORITHM_LABELS',
        reason:
            'Display names for the algorithm selector. String values, keyed by algorithm rather than by ' +
            'parameter. Arrived on main from the Dutch Oven panel-gating lane and was surfaced here by discovery ' +
            'rather than by anyone remembering to declare it, which is the population rule doing its job.',
    },
    {
        file: 'src/modules/Tuner/models/TunerState.ts',
        exportName: 'DEFAULT_TUNER_STATE',
        reason:
            'Measurement output — the detected pitch before anything has been measured. Shares no key with the ' +
            "Tuner's three descriptor parameters.",
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
    /**
     * The three legs as measured when the row was written.
     *
     * Pinned because suppressing a parameter suppresses it everywhere: with
     * only a "does it still disagree" check, moving `DEFAULT_PARAMS.damping` to
     * 0.0005 and leaving the panel at 0.3 kept this file green, because the
     * panel still disagreed with the descriptor and the row still applied. A
     * half-resolved divergence would have looked exactly like an untouched one.
     * Any leg moving now reds until the row is rewritten or deleted.
     */
    readonly observed: {
        readonly descriptor: number;
        readonly declared: readonly number[];
        readonly panel: number | null;
    };
    readonly reason: string;
};

const KNOWN_DEFAULT_DIVERGENCES: readonly DefaultDivergence[] = [
    {
        deviceId: 'dutch-oven',
        paramId: 'damping',
        observed: { descriptor: 0.0005, declared: [0.3], panel: 0.3 },
        reason:
            'Three values, two of which agree. Descriptor `0.0005`; Rust plate constructor `0.0005` ' +
            '(`crates/proof-chamber/src/proof_chamber.rs:394`); `DEFAULT_PARAMS` and the panel knob `0.3`. ' +
            'There is no scaling between them — `proof_chamber.rs:471` is ' +
            '`"damping" => self.damping = value.clamp(0.0, 0.9999)`, so the knob writes the constructor\'s field ' +
            'directly and the two numbers are the same quantity. ' +
            'What a fresh instance runs is `0.0005`: `addDevice` writes every descriptor `param.value` through ' +
            '`updateDeviceParam`, and nothing pushes `DEFAULT_PARAMS` — `registerChamberInstance` writes only ' +
            '`chamberStore`, and `expandSpacePreset` runs solely from the space-tile click handler, so the ' +
            '`hall` overlay is not a third vote for 0.3. So the engine is damped at 0.0005 while the panel reads ' +
            '30% and the spectrogram draws 0.3, and the first double-click on Damp is a 600x jump in the ' +
            'coefficient. `damping` is the only field where `DEFAULT_PARAMS` departs from the constructor; every ' +
            'other Dutch Oven default matches it exactly, and the file header cites Dattorro 1997, whose damping ' +
            'is 0.0005. ' +
            'Two ways to close it, and they are not equivalent. Move `DEFAULT_PARAMS` and the panel to 0.0005: ' +
            'the panel then tells the truth about what every existing project has been hearing, and nothing ' +
            'sounds different. Move the descriptor and the constructor to 0.3: the panel keeps its current ' +
            'reading and the reverb gains real damping, at the cost of changing the sound of every new instance ' +
            'and departing from the paper the implementation is transcribed from. That is a voicing decision, ' +
            'not a consistency one, so it is recorded here rather than taken — and ProofChamber is being changed ' +
            'on another lane (`feat/dutch-oven-panel-algorithm-gating`) besides.',
    },
];

/**
 * Every `.tsx` under any module's `presentations/` tree that declares a reset
 * literal, with how many it declares and how many this scanner can attribute.
 *
 * **Both numbers, not their difference.** Pinning `declared − readable` let a
 * newly readable knob raise both and keep the row matching, so a binding could
 * be added to an uncensused panel and change nothing — which is exactly what a
 * census of panel bindings must not allow.
 *
 * Count provenance: measured on `6db20efd3` by `defaultValue=` occurrences and
 * by `readPanelResetValues().size` per file. Rows with `readable: 0` are the
 * enumerated hole; the per-device `noPanelReason` says why for the devices, and
 * the non-device modules are named individually below.
 */
const PANEL_FILES: readonly { readonly file: string; readonly declared: number; readonly readable: number }[] = [
    { file: 'src/modules/Bacteria/presentations/components/BandStrip.tsx', declared: 1, readable: 1 },
    { file: 'src/modules/Bacteria/presentations/views/BacteriaPanel.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Crumbs/presentations/components/CrumbsControls.tsx', declared: 14, readable: 10 },
    { file: 'src/modules/Crust/presentations/components/CrustControlZone.tsx', declared: 2, readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/AdditiveSection.tsx', declared: 4, readable: 4 },
    { file: 'src/modules/Fermenter/presentations/components/CrumbsSection.tsx', declared: 2, readable: 2 },
    { file: 'src/modules/Fermenter/presentations/components/EffectsSection.tsx', declared: 22, readable: 21 },
    { file: 'src/modules/Fermenter/presentations/components/EnvelopeSection.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/FilterSection.tsx', declared: 5, readable: 5 },
    { file: 'src/modules/Fermenter/presentations/components/FmSection.tsx', declared: 4, readable: 2 },
    { file: 'src/modules/Fermenter/presentations/components/GranularSection.tsx', declared: 6, readable: 6 },
    { file: 'src/modules/Fermenter/presentations/components/KarplusSection.tsx', declared: 2, readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/LayerStack.tsx', declared: 2, readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/LfoSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Fermenter/presentations/components/MacroStrip.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/ModulationSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Fermenter/presentations/components/OscillatorSection.tsx', declared: 5, readable: 5 },
    { file: 'src/modules/Fermenter/presentations/components/UnisonSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Fermenter/presentations/components/WarpSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Gluten/presentations/views/GlutenPanel.tsx', declared: 25, readable: 24 },
    { file: 'src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx', declared: 6, readable: 0 },
    { file: 'src/modules/GrandBoule/presentations/components/MorphPanel.tsx', declared: 3, readable: 0 },
    { file: 'src/modules/GrandBoule/presentations/components/PerNoteEditor.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx', declared: 9, readable: 0 },
    { file: 'src/modules/Grinder/presentations/views/GrinderPanel.tsx', declared: 33, readable: 25 },
    { file: 'src/modules/Levain/presentations/components/ExpressionPanel.tsx', declared: 5, readable: 0 },
    { file: 'src/modules/Levain/presentations/components/HumanizePanel.tsx', declared: 5, readable: 0 },
    { file: 'src/modules/Levain/presentations/components/LegatoTuning.tsx', declared: 3, readable: 0 },
    { file: 'src/modules/Levain/presentations/components/LevainMacroStrip.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Levain/presentations/components/MicBlendSlider.tsx', declared: 3, readable: 0 },
    { file: 'src/modules/Levain/presentations/views/LevainPanel.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/MixerConsole/presentations/views/Mixer/ExpandedChannelStrip.tsx', declared: 2, readable: 0 },
    { file: 'src/modules/MixerConsole/presentations/views/MixerPanel.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofDynSection.tsx', declared: 5, readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofEqSection.tsx', declared: 3, readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofExciterSection.tsx', declared: 2, readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofImagerSection.tsx', declared: 2, readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofLimiterSection.tsx', declared: 3, readable: 0 },
    { file: 'src/modules/Proof/presentations/views/ProofPanel.tsx', declared: 9, readable: 0 },
    { file: 'src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx', declared: 18, readable: 17 },
    { file: 'src/modules/Setlist/presentations/views/SetlistPanel.tsx', declared: 2, readable: 0 },
    {
        file: 'src/modules/TimelineEditor/presentations/views/Inspector/DeviceParameterControl.tsx',
        declared: 2,
        readable: 0,
    },
    { file: 'src/modules/Toaster/presentations/views/ToasterPanel.tsx', declared: 13, readable: 0 },
    { file: 'src/modules/Tuner/presentations/views/TunerPanel.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Yeast/presentations/components/ProcessorParams.tsx', declared: 1, readable: 0 },
    { file: 'src/modules/Yeast/presentations/views/YeastPanel.tsx', declared: 3, readable: 0 },
];

/**
 * Modules that declare reset literals but own no native device, so no
 * `noPanelReason` covers them.
 */
const NON_DEVICE_PANEL_MODULES: readonly { readonly moduleDir: string; readonly reason: string }[] = [
    {
        moduleDir: 'src/modules/MixerConsole',
        reason: 'Channel-strip controls. The mixer is not a plugin and has no descriptor to agree with.',
    },
    {
        moduleDir: 'src/modules/Setlist',
        reason: 'Show control — set ordering and cue timings, not device parameters.',
    },
    {
        moduleDir: 'src/modules/TimelineEditor',
        reason:
            '`DeviceParameterControl` is the generic Inspector row. Its reset value is `param.defaultValue` read ' +
            'from the descriptor at runtime, so it is the descriptor leg rendered, not a fourth declaration.',
    },
    {
        moduleDir: 'src/modules/Yeast',
        reason:
            'Yeast is the MIDI FX rack: its arpeggiator knobs bind through a rack-slot setter keyed by slot ' +
            'index. It has no native engine either, so it is outside `DEFAULT_SOURCES`.',
    },
];

/**
 * How many comparisons the census performs.
 *
 * Count provenance: measured on `6db20efd3` + this change.
 *
 * Patch 428 = the sum over (device, declaration, descriptor parameter) of the
 * parameters each declaration resolves: fermenter 105 (`DEFAULT_PATCH`) + 105
 * (`FERMENTER_PARAMS`), grinder 40 + 41, bacteria 59, gluten 38, crust 16,
 * proof 3, dutch-oven 21 (20 direct plus `early_late` through its alias). The
 * two table declarations are the 146 this census could not see at all before.
 *
 * Grinder's two differ by one because `engineMode` is a label in
 * `DEFAULT_PATCH` (`'circuit'`) and an integer in `GRINDER_PARAMS`
 * (`default: 0`). The integer is compared; the label is not comparable without
 * duplicating the bridge's label map into a test.
 *
 * Panel 134 = grinder 25 + gluten 24 + dutch-oven 17 + bacteria 1 + crumbs 10 +
 * fermenter 57 across eleven section files. The fermenter and crumbs knobs were
 * outside the scan entirely — `views/` only — and Fermenter's whole control
 * surface lives in `presentations/components/`.
 *
 * Pinned because every leg here is a regex over source text, and a regex that
 * silently stops matching turns this file into a test that compares nothing and
 * passes. Raise it when the census genuinely widens; a *drop* is the bug it
 * exists to catch.
 */
const MIN_PATCH_COMPARISONS = 428;
const MIN_PANEL_COMPARISONS = 134;

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

/** deviceId → one map per declaration, never merged. */
const PATCH_DECLARATIONS = new Map<NativeDspDeviceType, { source: PatchSource; defaults: Map<string, number> }[]>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => [
        deviceType,
        DEFAULT_SOURCES[deviceType].patchSources.map((source) => ({
            source,
            defaults: readDeclaredDefaults(source.file, source.exportName, source.shape),
        })),
    ])
);

const PANEL_RESETS = new Map<NativeDspDeviceType, Map<string, number>>(
    NATIVE_DSP_DEVICE_TYPES.map((deviceType) => {
        const merged = new Map<string, number>();
        for (const file of listPanelFiles(DEFAULT_SOURCES[deviceType].moduleDir)) {
            for (const [paramId, reset] of readPanelResetValues(file)) {
                merged.set(paramId, reset);
            }
        }
        return [deviceType, merged];
    })
);

function isLabelUnion(deviceId: NativeDspDeviceType, paramId: string): boolean {
    return LABEL_UNION_PARAMS.some((row) => row.deviceId === deviceId && row.paramIds.includes(paramId));
}

/** The key one declaration uses for a descriptor id, or null when it declares none. */
function declaredKeyFor(deviceId: NativeDspDeviceType, paramId: string, defaults: Map<string, number>): string | null {
    const alias = PARAM_KEY_ALIASES.find((row) => row.deviceId === deviceId && row.paramId === paramId);
    if (alias !== undefined && defaults.has(alias.patchKey)) {
        return alias.patchKey;
    }
    if (defaults.has(paramId)) {
        return paramId;
    }
    const camel = toCamelCase(paramId);
    if (defaults.has(camel)) {
        return camel;
    }
    return null;
}

/** The same, against everything the device declares anywhere. */
function declaresAnywhere(deviceId: NativeDspDeviceType, paramId: string): boolean {
    return PATCH_DECLARATIONS.get(deviceId)!.some(
        (declaration) => declaredKeyFor(deviceId, paramId, declaration.defaults) !== null
    );
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
    it('reads the module declarations it claims to read', () => {
        // The vacuity guard for leg two. An export that has been renamed or
        // reshaped yields an empty map, and every later comparison would then
        // pass by comparing nothing.
        const empty: string[] = [];
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            for (const { source, defaults } of PATCH_DECLARATIONS.get(deviceType)!) {
                if (defaults.size === 0) {
                    empty.push(`${deviceType}: ${source.file}#${source.exportName}`);
                }
            }
        }

        expect(empty).toEqual([]);
    });

    it('reads every panel file, and pins how much of each one it can attribute', () => {
        // The vacuity guard for leg three, and the reverse direction on the
        // hole. `readable` is pinned per file rather than `declared − readable`
        // so that adding a binding to an unread panel cannot be absorbed by an
        // equal rise in the total.
        const discovered = listAllModuleDirs().flatMap((moduleDir) => listPanelFiles(moduleDir));
        expect(discovered.sort()).toEqual(PANEL_FILES.map((row) => row.file).sort());

        const wrong: string[] = [];
        for (const row of PANEL_FILES) {
            const declared = countResetLiterals(row.file);
            const readable = readPanelResetValues(row.file).size;
            if (declared !== row.declared || readable !== row.readable) {
                wrong.push(
                    `${row.file}: declared ${declared} (pinned ${row.declared}), readable ${readable} (pinned ${row.readable})`
                );
            }
        }

        expect(wrong).toEqual([]);
    });

    it('every device module’s declarations are either a census leg or named as something else', () => {
        // Population derivation, reverse direction, in both shapes. An object
        // patch or a parameter *table* appearing beside an existing one cannot
        // be added without a decision recorded here — which is the shape that
        // produced this PR's defect.
        const unclaimed: string[] = [];
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            const config = DEFAULT_SOURCES[deviceType];
            for (const file of listModelFiles(config.moduleDir)) {
                for (const { name } of findDeclarationExports(file)) {
                    const isLeg = config.patchSources.some(
                        (source) => source.file === file && source.exportName === name
                    );
                    const isNamed = NON_DEFAULT_MODEL_DECLARATIONS.some(
                        (row) => row.file === file && row.exportName === name
                    );
                    if (!isLeg && !isNamed) {
                        unclaimed.push(`${file}#${name}`);
                    }
                }
            }
        }

        expect(unclaimed).toEqual([]);
    });

    it('every device with no declaration and every device with no readable knob says why', () => {
        // Both reasons asserted the same way and in both directions: a reason
        // is required exactly when the thing it explains is absent, so a device
        // cannot carry a stale excuse for a gap it no longer has, and cannot
        // have a gap with no stated cause.
        const wrong: string[] = [];
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            const config = DEFAULT_SOURCES[deviceType];

            const hasDeclarations = config.patchSources.length > 0;
            if (hasDeclarations === config.noPatchReason.trim().length > 0) {
                wrong.push(
                    `${deviceType}: patch sources ${hasDeclarations ? 'present' : 'absent'} with reason ${hasDeclarations ? 'present' : 'absent'}`
                );
            }

            const readable = PANEL_RESETS.get(deviceType)!.size;
            if (readable > 0 === config.noPanelReason.trim().length > 0) {
                wrong.push(
                    `${deviceType}: ${readable} readable knobs with reason ${config.noPanelReason.length > 0 ? 'present' : 'absent'}`
                );
            }
        }

        expect(wrong).toEqual([]);
    });

    it('every module that declares reset literals is a censused device or named as something else', () => {
        const unclaimed = listAllModuleDirs()
            .filter((moduleDir) => listPanelFiles(moduleDir).length > 0)
            .filter(
                (moduleDir) =>
                    !NATIVE_DSP_DEVICE_TYPES.some(
                        (deviceType) => DEFAULT_SOURCES[deviceType].moduleDir === moduleDir
                    ) && !NON_DEVICE_PANEL_MODULES.some((row) => row.moduleDir === moduleDir)
            );

        expect(unclaimed).toEqual([]);
    });

    it('the descriptor default is what every module declaration says', () => {
        // The load-bearing comparison, per declaration rather than per device.
        // Both sides are read out of the files production compiles, and they
        // are different files maintained by different work — the descriptors
        // were split out of the modules in `27d7ce794` and have been duplicates
        // ever since.
        const disagreements: string[] = [];
        let compared = 0;

        for (const deviceType of CENSUSED_DEVICE_IDS) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(deviceType);
            expect(descriptor, `${deviceType} has no descriptor`).toBeDefined();

            for (const [paramId, declared] of descriptor!) {
                if (!declaresAnywhere(deviceType, paramId)) {
                    // Nothing numeric to compare. Either the module stores it
                    // as a label — declared, excluded, and checked below — or
                    // it genuinely declares no default and that is the finding.
                    if (!isLabelUnion(deviceType, paramId)) {
                        disagreements.push(`${deviceType}.${paramId}: the module declares no default for it`);
                    }
                    continue;
                }
                for (const { source, defaults } of PATCH_DECLARATIONS.get(deviceType)!) {
                    const key = declaredKeyFor(deviceType, paramId, defaults);
                    if (key === null) {
                        continue;
                    }
                    compared += 1;
                    const moduleValue = defaults.get(key)!;
                    if (moduleValue !== declared && !isDeclaredDivergence(deviceType, paramId)) {
                        disagreements.push(
                            `${deviceType}.${paramId}: descriptor ${declared}, ${source.exportName} ${moduleValue}`
                        );
                    }
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

        // Every device with a descriptor, not only those with a module
        // declaration. Crumbs has ten readable knobs and no default-patch
        // object, so restricting this loop to `CENSUSED_DEVICE_IDS` silently
        // dropped the only leg it has.
        for (const deviceType of NATIVE_DSP_DEVICE_TYPES) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(deviceType);
            if (descriptor === undefined) {
                continue;
            }

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
                for (const { source, defaults } of PATCH_DECLARATIONS.get(deviceType)!) {
                    const key = declaredKeyFor(deviceType, paramId, defaults);
                    if (key !== null && defaults.get(key) !== reset && !isDeclaredDivergence(deviceType, paramId)) {
                        disagreements.push(
                            `${deviceType}.${paramId}: panel ${reset}, ${source.exportName} ${defaults.get(key)!}`
                        );
                    }
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
            const declared = DESCRIPTOR_DEFAULTS.get(row.deviceId)?.get(row.paramId);
            if (declared === undefined) {
                stale.push(`${row.deviceId}.${row.paramId}: not a descriptor parameter`);
                continue;
            }

            const moduleValues = PATCH_DECLARATIONS.get(row.deviceId)!
                .map(({ defaults }) => {
                    const key = declaredKeyFor(row.deviceId, row.paramId, defaults);
                    return key === null ? undefined : defaults.get(key);
                })
                .filter((value) => value !== undefined);

            const panelResets = PANEL_RESETS.get(row.deviceId)!;
            const panelKey = [...panelResets.keys()].find(
                (candidate) => descriptorIdForPanelKey(row.deviceId, candidate) === row.paramId
            );
            const panelValue = panelKey === undefined ? undefined : panelResets.get(panelKey);

            const agrees =
                moduleValues.every((value) => value === declared) &&
                (panelValue === undefined || panelValue === declared);
            if (agrees) {
                stale.push(`${row.deviceId}.${row.paramId}: the declarations agree now`);
                continue;
            }

            // Every leg as pinned, so a partial resolution cannot hide behind a
            // divergence that is still technically present.
            const measured = {
                descriptor: declared,
                declared: moduleValues,
                panel: panelValue ?? null,
            };
            if (JSON.stringify(measured) !== JSON.stringify(row.observed)) {
                stale.push(
                    `${row.deviceId}.${row.paramId}: measured ${JSON.stringify(measured)}, row pins ${JSON.stringify(row.observed)}`
                );
            }
        }

        expect(stale).toEqual([]);
    });

    it('every label-union exclusion still names a parameter the module stores as a label', () => {
        // Reverse direction on the exclusions. If a declaration becomes numeric
        // the row is a lie, and the parameter belongs in the census.
        const stale: string[] = [];
        for (const row of LABEL_UNION_PARAMS) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(row.deviceId)!;
            for (const paramId of row.paramIds) {
                if (!descriptor.has(paramId)) {
                    stale.push(`${row.deviceId}.${paramId}: not a descriptor parameter`);
                }
                // The row earns its place while *some* declaration still stores
                // a label. Grinder is why this is per declaration rather than
                // per device: `DEFAULT_PATCH` holds `engineMode: 'circuit'`
                // while `GRINDER_PARAMS` holds `default: 0`, so the exclusion is
                // true of one and false of the other — and the numeric one is
                // compared rather than waved through.
                const declarations = PATCH_DECLARATIONS.get(row.deviceId)!;
                if (declarations.every(({ defaults }) => defaults.has(paramId))) {
                    stale.push(`${row.deviceId}.${paramId}: every declaration stores a number for it now`);
                }
            }
        }

        expect(stale).toEqual([]);
    });

    it('every alias still bridges a name the module uses and the descriptor does not', () => {
        const broken: string[] = [];
        for (const row of PARAM_KEY_ALIASES) {
            const declarations = PATCH_DECLARATIONS.get(row.deviceId)!;
            if (!declarations.some(({ defaults }) => defaults.has(row.patchKey))) {
                broken.push(`${row.deviceId}.${row.paramId}: no ${row.patchKey} in any declaration`);
            }
            if (
                declarations.some(({ defaults }) => defaults.has(row.paramId) || defaults.has(toCamelCase(row.paramId)))
            ) {
                broken.push(`${row.deviceId}.${row.paramId}: resolves without the alias, so the alias is dead`);
            }
        }

        expect(broken).toEqual([]);
    });

    it('every declared row carries a reason', () => {
        const unreasoned = [
            ...KNOWN_DEFAULT_DIVERGENCES.map((row) => ({ id: `${row.deviceId}.${row.paramId}`, reason: row.reason })),
            ...PARAM_KEY_ALIASES.map((row) => ({ id: `${row.deviceId}.${row.paramId}`, reason: row.reason })),
            ...NON_DEFAULT_MODEL_DECLARATIONS.map((row) => ({
                id: `${row.file}#${row.exportName}`,
                reason: row.reason,
            })),
            ...NON_DEVICE_PANEL_MODULES.map((row) => ({ id: row.moduleDir, reason: row.reason })),
        ]
            .filter((row) => row.reason.trim().length === 0)
            .map((row) => row.id);

        expect(unreasoned).toEqual([]);
    });
});
