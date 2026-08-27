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

/**
 * Empty rather than throwing when the path is gone.
 *
 * The declaration maps are built at module scope, so a renamed or moved file
 * used to throw during collection and the whole file reported zero tests run —
 * a crash, not a finding. Missing content now flows into the vacuity guards,
 * which name the file and the export.
 */
function readSource(relativePath: string): string {
    try {
        return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
    } catch {
        return '';
    }
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
    // Any exported const name, not only SCREAMING_CASE. Nothing in a device
    // module spells a declaration otherwise today, which is exactly why the
    // narrower pattern would have gone on looking correct.
    const pattern = /^export const ([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:Object\.freeze\()?([{[])/gm;
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

function collectFiles(dir: string, suffix: string, found: string[]): void {
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
                collectFiles(relativePath, suffix, found);
            }
        } else if (entry.name.endsWith(suffix) && !entry.name.endsWith('.spec.ts')) {
            found.push(relativePath);
        }
    }
}

/** Recursive: a declaration moved into `models/patches/` must not leave the census. */
function listModelFiles(moduleDir: string): string[] {
    const found: string[] = [];
    collectFiles(`${moduleDir}/models`, '.ts', found);
    return found.sort();
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

/**
 * Every `.tsx` under a device module's `presentations/` tree that declares a
 * reset literal.
 *
 * Scoped to the device modules `DEFAULT_SOURCES` names. A module with no
 * descriptor has no default to agree with, so its knobs are not evidence — and
 * scanning them made this plugin-descriptor spec red on a knob added to the
 * mixer strip, which import-derived test selection cannot see (the coupling is
 * `readFileSync`, not `import`) and which would therefore land on `main` and be
 * found by someone on an unrelated branch. That is how a guard earns deletion.
 */
function listPanelFiles(moduleDir: string): string[] {
    const candidates: string[] = [];
    collectFiles(`${moduleDir}/presentations`, '.tsx', candidates);
    return candidates.filter((file) => readSource(file).includes('defaultValue=')).sort();
}

// ── Where each device writes its defaults down ───────────────────────────────

type PatchSource = {
    readonly file: string;
    readonly exportName: string;
    readonly shape: DeclarationShape;
    /**
     * How many of the device's descriptor parameters this declaration resolves,
     * and which ones it does not.
     *
     * Pinned per declaration and asserted for **equality**, not as a floor. One
     * global `>=` over the whole leg let routine edits buy silence: adding a
     * parameter to Gluten raised the total to 429, and extracting
     * `oscLevel: 0.8` to a constant in `FermenterPatch.ts` then dropped one
     * silently — `DEFAULT_PATCH.oscLevel` left the census while the number
     * stayed above the floor. The same argument the `PANEL_FILES` docstring
     * makes about pinning both numbers rather than their difference applies
     * here, to the leg carrying most of the comparisons.
     *
     * `unresolved` is what stops the repair from being a silent decrement: a
     * declaration that stops covering a parameter has to name it here, so the
     * edit says which control left rather than only that one did.
     */
    readonly resolved: number;
    readonly unresolved: readonly string[];
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
            {
                file: 'src/modules/Fermenter/models/FermenterPatch.ts',
                exportName: 'DEFAULT_PATCH',
                shape: 'object',
                resolved: 105,
                unresolved: [],
            },
            // The 105-row parameter table, re-exported through
            // `useCases/fermenterQueries/` and read by `MacroMatrixEditor`. A
            // fourth declaration of every Fermenter default, invisible to this
            // census until the scanner learned to read arrays.
            {
                file: 'src/modules/Fermenter/models/FermenterPatch.ts',
                exportName: 'FERMENTER_PARAMS',
                shape: 'table',
                resolved: 105,
                unresolved: [],
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
            {
                file: 'src/modules/Gluten/models/GlutenPatch.ts',
                exportName: 'DEFAULT_PATCH',
                shape: 'object',
                resolved: 38,
                unresolved: ['topology', 'style', 'detection', 'stereoMode', 'blendTopology'],
            },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    crust: {
        moduleDir: 'src/modules/Crust',
        patchSources: [
            {
                file: 'src/modules/Crust/models/CrustPatch.ts',
                exportName: 'DEFAULT_CRUST_PATCH',
                shape: 'object',
                resolved: 16,
                unresolved: [],
            },
        ],
        noPatchReason: '',
        noPanelReason:
            '`CrustControlZone` declares two reset literals and both forward a prop (`defaultValue={def}`) from a ' +
            'shared knob wrapper, so neither is a literal at the call site this scanner reads.',
    },
    bacteria: {
        moduleDir: 'src/modules/Bacteria',
        patchSources: [
            {
                file: 'src/modules/Bacteria/models/BacteriaPatch.ts',
                exportName: 'DEFAULT_PATCH',
                shape: 'object',
                resolved: 28,
                unresolved: [
                    'crossoverMode',
                    'distortionMode',
                    'drive',
                    'asymmetry',
                    'foldbackThreshold',
                    'bitDepth',
                    'sampleRateReduce',
                    'breakdownDepth',
                    'filterMode',
                    'filterCutoff',
                    'filterResonance',
                    'filterEnvAmount',
                    'chorusRate',
                    'chorusDepth',
                    'chorusFeedback',
                    'chorusMix',
                    'phaserRate',
                    'phaserDepth',
                    'phaserFeedback',
                    'phaserMix',
                    'grainSize',
                    'grainDensity',
                    'grainPosOffset',
                    'grainPitch',
                    'grainMix',
                    'spectralBlur',
                    'spectralMix',
                    'freqShiftHz',
                    'freqShiftMix',
                    'lofiAmount',
                    'codecArtifact',
                    'convolutionMix',
                    'convolutionSeparation',
                    'gain',
                ],
            },
            // The descriptor advertises the per-band controls at device level —
            // `drive`, `filterCutoff`, `grainSize` and the rest are one band's
            // fields — so the band defaults are the second half of this device's
            // declaration, not a nested detail.
            {
                file: 'src/modules/Bacteria/models/BacteriaPatch.ts',
                exportName: 'DEFAULT_BAND',
                shape: 'object',
                resolved: 31,
                unresolved: [
                    'mix',
                    'inputGain',
                    'outputGain',
                    'bandCount',
                    'crossoverFreq1',
                    'crossoverFreq2',
                    'crossoverFreq3',
                    'crossoverFreq4',
                    'crossoverFreq5',
                    'crossoverSlope',
                    'crossoverMode',
                    'distortionMode',
                    'filterMode',
                    'macro1',
                    'macro2',
                    'macro3',
                    'macro4',
                    'macro5',
                    'macro6',
                    'macro7',
                    'macro8',
                    'morphX',
                    'morphY',
                    'lfo1Rate',
                    'lfo1Shape',
                    'lfo1Amount',
                    'lfo2Rate',
                    'lfo2Shape',
                    'lfo2Amount',
                    'envFollowerAttack',
                    'envFollowerRelease',
                ],
            },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    grinder: {
        moduleDir: 'src/modules/Grinder',
        patchSources: [
            {
                file: 'src/modules/Grinder/models/GrinderPatch.ts',
                exportName: 'DEFAULT_PATCH',
                shape: 'object',
                resolved: 40,
                unresolved: ['engineMode'],
            },
            // The table the Arrangement descriptor was copied out of. It is the
            // source this PR's second fix corrects, and until the scanner read
            // arrays it was the one declaration nothing here could see.
            {
                file: 'src/modules/Grinder/models/GrinderPatch.ts',
                exportName: 'GRINDER_PARAMS',
                shape: 'table',
                resolved: 41,
                unresolved: [],
            },
        ],
        noPatchReason: '',
        noPanelReason: '',
    },
    proof: {
        moduleDir: 'src/modules/Proof',
        patchSources: [
            {
                file: 'src/modules/Proof/models/ProofPatch.ts',
                exportName: 'DEFAULT_PATCH',
                shape: 'object',
                resolved: 3,
                unresolved: [],
            },
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
                resolved: 27,
                unresolved: ['algorithm'],
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
            'device-owned parameters, so there are no descriptor defaults to compare.',
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
        file: 'src/modules/Proof/models/ProofPatch.ts',
        exportName: 'TARGET_LABELS',
        reason: 'Display labels for delivery targets, not device-parameter defaults.',
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
        file: 'src/modules/Gluten/models/GlutenTopologyGating.ts',
        exportName: 'GLUTEN_TOPOLOGY_LABELS',
        reason:
            'Display names for the topology selector, and for the sentence a disabled control shows. String ' +
            'values, keyed by topology rather than by parameter — the same shape and the same job as the Dutch ' +
            'Oven’s `ALGORITHM_LABELS` above.',
    },
    {
        file: 'src/modules/Gluten/models/GlutenTopologyGating.ts',
        exportName: 'GLUTEN_TOPOLOGY_OWNED_CONTROLS',
        reason:
            'Which patch keys each topology’s Character card already renders behind its own conditional. A list ' +
            'of key *names* per topology, with no values of any kind, used to account for every name the ' +
            'worklet can send when the gap census is derived.',
    },
    {
        file: 'src/modules/ProofChamber/models/ProofChamberAlgorithmGating.ts',
        exportName: 'DECAY_EQ_HEADROOM_CEILING',
        reason:
            'The `decay` at which the Decay Rate EQ runs out of per-pass loss to redistribute, per algorithm — a ' +
            'boundary the panel gates on, not a default anything is initialised to. It shares a *name* with the ' +
            '`decay` parameter and no meaning with it: `DEFAULT_PARAMS.decay` is 0.5 and this is 0.999, and a census ' +
            'that compared them would report a disagreement between two numbers that answer different questions. ' +
            'Welded to the engine by `proofChamberDecayEqHeadroom.spec.ts`, which reads the value out of the Rust ' +
            'guard that measures it.',
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
    ...([0, 1, 2, 3, 4, 5] as const).map((band) => ({
        deviceId: 'dutch-oven' as const,
        paramId: `decay_eq_${band}`,
        patchKey: `decayEq${band}`,
        reason:
            'Derived snake→camel stops at a trailing digit — `toCamelCase` only uppercases `_[a-z]` — so ' +
            '`decay_eq_0` resolves to `decayEq_0` while `ProofChamberEngineState` spells the field `decayEq0`. ' +
            'The difference is the underscore before the band index and nothing else; the field is named for ' +
            'the house camelCase convention rather than for the wire id.',
    })),
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

/**
 * Empty, and that is a state this file is built to hold.
 *
 * The one row it ever carried was `dutch-oven.damping`, recorded by #1525 and
 * closed by #1546: the descriptor and the Rust plate constructor moved from
 * Dattorro's 0.0005 — which is bypass, 0.0087 dB at Nyquist — up to the 0.3
 * that `DEFAULT_PARAMS` and the panel knob had been claiming. Nothing is
 * suppressed here now, so the two directions below reduce to one: any
 * disagreement at all reds.
 *
 * The forward assertion is what keeps that honest, and it needs no row to
 * work — `isDeclaredDivergence` returns false for every parameter, so a
 * descriptor value drifting back to 0.0005 lands in `disagreements` on the
 * next run. The gap that a row *would* leave open is the reason to delete one
 * rather than let it sit: a listed pair is skipped in the forward direction
 * entirely.
 */
const KNOWN_DEFAULT_DIVERGENCES: readonly DefaultDivergence[] = [];

/**
 * Every `.tsx` under a device module's `presentations/` tree that declares a
 * reset literal, and how many of its literals this scanner can attribute.
 *
 * `readable` is pinned on every row and asserted for equality. That is the
 * anti-vacuity claim: a panel that starts naming its parameter ids reds here
 * rather than joining the census unnoticed, and a scanner that stops matching
 * reds too.
 *
 * `declared` is pinned **only where `readable` is non-zero** — the files this
 * census actually reads. Pinning it everywhere meant a knob added anywhere in
 * the app reddened a plugin-descriptor spec while nothing the census can read
 * had changed. The developer would not see it either: this file couples through
 * `readFileSync`, not `import`, so dependency-derived selection cannot see it, and with CI
 * suspended the red lands on `main` for someone on an unrelated branch to
 * find. A guard with that cost profile gets deleted rather than fixed.
 *
 * Count provenance: measured on `34896396b` by `defaultValue=` occurrences and
 * by `readPanelResetValues().size` per file. Rows with `readable: 0` are the
 * enumerated hole, and the per-device `noPanelReason` says why for each.
 */
const PANEL_FILES: readonly { readonly file: string; readonly declared?: number; readonly readable: number }[] = [
    { file: 'src/modules/Bacteria/presentations/components/BandStrip.tsx', declared: 1, readable: 1 },
    { file: 'src/modules/Bacteria/presentations/views/BacteriaPanel.tsx', readable: 0 },
    { file: 'src/modules/Crumbs/presentations/components/CrumbsControls.tsx', declared: 14, readable: 10 },
    { file: 'src/modules/Crust/presentations/components/CrustControlZone.tsx', readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/AdditiveSection.tsx', declared: 4, readable: 4 },
    { file: 'src/modules/Fermenter/presentations/components/CrumbsSection.tsx', declared: 2, readable: 2 },
    { file: 'src/modules/Fermenter/presentations/components/EffectsSection.tsx', declared: 22, readable: 21 },
    { file: 'src/modules/Fermenter/presentations/components/EnvelopeSection.tsx', readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/FilterSection.tsx', declared: 5, readable: 5 },
    { file: 'src/modules/Fermenter/presentations/components/FmSection.tsx', declared: 4, readable: 2 },
    { file: 'src/modules/Fermenter/presentations/components/GranularSection.tsx', declared: 6, readable: 6 },
    { file: 'src/modules/Fermenter/presentations/components/KarplusSection.tsx', readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/LayerStack.tsx', readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/LfoSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Fermenter/presentations/components/MacroStrip.tsx', readable: 0 },
    { file: 'src/modules/Fermenter/presentations/components/ModulationSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Fermenter/presentations/components/OscillatorSection.tsx', declared: 5, readable: 5 },
    { file: 'src/modules/Fermenter/presentations/components/UnisonSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Fermenter/presentations/components/WarpSection.tsx', declared: 3, readable: 3 },
    { file: 'src/modules/Gluten/presentations/views/GlutenPanel.tsx', declared: 25, readable: 22 },
    { file: 'src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx', readable: 0 },
    { file: 'src/modules/GrandBoule/presentations/components/MorphPanel.tsx', readable: 0 },
    { file: 'src/modules/GrandBoule/presentations/components/PerNoteEditor.tsx', readable: 0 },
    { file: 'src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx', readable: 0 },
    { file: 'src/modules/Grinder/presentations/views/GrinderPanel.tsx', declared: 33, readable: 25 },
    { file: 'src/modules/Levain/presentations/components/ExpressionPanel.tsx', readable: 0 },
    { file: 'src/modules/Levain/presentations/components/HumanizePanel.tsx', readable: 0 },
    { file: 'src/modules/Levain/presentations/components/LegatoTuning.tsx', readable: 0 },
    { file: 'src/modules/Levain/presentations/components/LevainMacroStrip.tsx', readable: 0 },
    { file: 'src/modules/Levain/presentations/components/MicBlendSlider.tsx', readable: 0 },
    { file: 'src/modules/Levain/presentations/views/LevainPanel.tsx', readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofDynSection.tsx', readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofEqSection.tsx', readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofExciterSection.tsx', readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofImagerSection.tsx', readable: 0 },
    { file: 'src/modules/Proof/presentations/components/ProofLimiterSection.tsx', readable: 0 },
    { file: 'src/modules/Proof/presentations/views/ProofPanel.tsx', readable: 0 },
    { file: 'src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx', declared: 18, readable: 17 },
    { file: 'src/modules/Toaster/presentations/views/ToasterPanel.tsx', readable: 0 },
    { file: 'src/modules/Tuner/presentations/views/TunerPanel.tsx', readable: 0 },
];

/*
 * There is deliberately no global comparison floor here any more.
 *
 * Both legs pin their contributors individually and assert equality — the patch
 * leg through `resolved`/`unresolved` on each `PatchSource`, the panel leg
 * through `readable` on each `PANEL_FILES` row. A single `>=` total over either
 * leg let one edit pay for another's loss: adding a parameter to Gluten and
 * extracting a Fermenter default to a constant cancelled out, and a declaration
 * left the census with the total still above the line.
 */

// ── Resolution ───────────────────────────────────────────────────────────────

function toCamelCase(id: string): string {
    return id.replaceAll(/_([a-z])/g, (_full, letter: string) => letter.toUpperCase());
}

const CENSUSED_DEVICE_IDS = NATIVE_DSP_DEVICE_TYPES.filter(
    (deviceType) => DEFAULT_SOURCES[deviceType].patchSources.length > 0
);

const DEFAULT_SOURCES_LIST = NATIVE_DSP_DEVICE_TYPES.flatMap((deviceType) => DEFAULT_SOURCES[deviceType].patchSources);

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
        // hole: `readable` is pinned per file, so a panel that starts naming its
        // parameter ids reds instead of joining the census unnoticed.
        const discovered = NATIVE_DSP_DEVICE_TYPES.flatMap((deviceType) =>
            listPanelFiles(DEFAULT_SOURCES[deviceType].moduleDir)
        );
        expect(discovered.sort()).toEqual(PANEL_FILES.map((row) => row.file).sort());

        const wrong: string[] = [];
        for (const row of PANEL_FILES) {
            const readable = readPanelResetValues(row.file).size;
            if (readable !== row.readable) {
                wrong.push(`${row.file}: readable ${readable} (pinned ${row.readable})`);
            }
            // Only where the census reads something. A file it reads nothing
            // from has no coverage ratio to state, and pinning the total there
            // turned an unrelated knob into a red on this spec.
            if (row.declared !== undefined && countResetLiterals(row.file) !== row.declared) {
                wrong.push(`${row.file}: declared ${countResetLiterals(row.file)} (pinned ${row.declared})`);
            }
            if (row.declared === undefined && row.readable > 0) {
                wrong.push(`${row.file}: reads ${row.readable} knobs but pins no declared total`);
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

    // The "is every module that declares reset literals accounted for" test is
    // gone with the repo-wide panel scan. A module with no device descriptor has
    // no default for its knobs to agree with, so its panels were never evidence
    // — they only made this spec red on unrelated work.

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
        expect(compared).toBe(DEFAULT_SOURCES_LIST.reduce((total, source) => total + source.resolved, 0));
    });

    it('every declaration resolves exactly the parameters it is pinned to resolve', () => {
        // Per declaration and by equality, so a parameter leaving one of them
        // cannot be absorbed by a parameter arriving in another. `unresolved`
        // makes the repair name the control that left rather than only decrement
        // a total.
        const wrong: string[] = [];

        for (const deviceType of CENSUSED_DEVICE_IDS) {
            const descriptor = DESCRIPTOR_DEFAULTS.get(deviceType)!;
            for (const { source, defaults } of PATCH_DECLARATIONS.get(deviceType)!) {
                const unresolved = [...descriptor.keys()].filter(
                    (paramId) => declaredKeyFor(deviceType, paramId, defaults) === null
                );
                const resolved = descriptor.size - unresolved.length;
                if (resolved !== source.resolved || unresolved.join() !== source.unresolved.join()) {
                    wrong.push(
                        `${deviceType} ${source.exportName}: resolves ${resolved} (pinned ${source.resolved}), ` +
                            `unresolved [${unresolved.join(',')}] (pinned [${source.unresolved.join(',')}])`
                    );
                }
            }
        }

        expect(wrong).toEqual([]);
    });

    it('the panel reset value is the module default and the descriptor default', () => {
        // The third source. It is the one that decided Grinder: the panel knob
        // and the patch agreed on 2 / 120 against the descriptor's 0.5 / 50, so
        // the descriptor was outvoted by two independently authored surfaces.
        //
        // How many knobs this loop sees is pinned per file in `PANEL_FILES`
        // rather than totalled here, so there is no global count to keep.
        const disagreements: string[] = [];

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
    });

    it('every recorded divergence still diverges, and still names a real parameter', () => {
        // Reverse direction on the divergence table. A row that is fixed —
        // whether by correcting the descriptor or by moving the module — has to
        // be deleted, so this cannot become a place drift goes to be forgotten.
        //
        // With the table empty the walk below never executes and
        // `expect(stale).toEqual([])` passes unconditionally — a test that
        // cannot fail under any change while still reporting green. That is a
        // dormant guard rather than a live one, and the line below is what says
        // so out loud: it pins the emptiness that makes the walk dormant, so
        // adding a row is the act that turns the walk back on, and this
        // assertion goes with it.
        expect(KNOWN_DEFAULT_DIVERGENCES).toHaveLength(0);

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
        ]
            .filter((row) => row.reason.trim().length === 0)
            .map((row) => row.id);

        expect(unreasoned).toEqual([]);
    });
});
