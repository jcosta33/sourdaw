import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';

/**
 * A control's declared range and its actual UI travel can disagree, and nothing
 * in this repo noticed.
 *
 * While they disagree and nothing clamps against the declaration, nothing
 * visibly breaks — the knob sweeps its own travel and the engine takes whatever
 * arrives. The moment a write routes through `setDeviceParameter`, which clamps
 * to `minValue`/`maxValue`, **the knob truncates mid-sweep**. #1474 found three
 * on Crumbs by hand (`masterGain` declared 0..1 against a 0..2 knob, `decay`
 * 2 s against 5 s, `release` 5 s against 10 s) and said explicitly that nothing
 * checks this. `release` additionally feeds the export tail
 * (`CrumbsDescriptor.ts:28`, `tail.parameterId: 'release'`), so the
 * under-declaration would have cut a long release short in a bounce.
 *
 * ## What this census compares, and what it cannot
 *
 * The honest statement of the invariant is a **three-way** one:
 *
 *     declared range  ==  knob travel  ==  engine clamp
 *
 * Two of those legs are derivable for every parameter this file compares; the
 * third is derivable for 112 of the 192. So the census is **three-way where it
 * can be and two-way where it cannot**, and it says which is which rather than
 * implying uniform coverage. A two-way row that is honest beats a three-way one
 * that fabricates a clamp from a comment.
 *
 * **Leg 1 — declared range.** `param.minValue` / `param.maxValue`, read off
 * `BUILTIN_PLUGINS` at test time. This is the number `setDeviceParameter` clamps
 * to, so it is the leg that does the truncating.
 *
 * **Leg 2 — knob travel.** The `min={…}` / `max={…}` numeric literals on the
 * control, read out of the device's `presentations/` TSX. There is no single
 * place this lives: `RotaryKnob` takes `min`/`max` as optional props
 * (`src/components/daw/RotaryKnob.tsx:58-59`) defaulting to **0..100**
 * (`:106-107`), and every panel wraps it in its own local `Knob` that forwards
 * them. What varies between panels is not the travel but the *binding* — how the
 * element says which parameter it drives. That variance is itself a finding and
 * is enumerated in `BINDING_ATTRIBUTES` below.
 *
 * **Leg 3 — engine clamp.** The two-sided numeric `value.clamp(a, b)` in the
 * Rust `set_param` arm, read the way `descriptorEngineParamWeld` reads the arm
 * names. Covers 112 of 192; every shape it cannot read is named in
 * `ENGINE_CLAMP_COVERAGE`, at the point where the derivation stops.
 *
 * ## Coverage is part of the claim
 *
 * A total is not a census. The first revision of this file said "184 across 13
 * devices" and was 184 across **seven** — `native-scoring`, `toaster`, `levain`,
 * `proof`, `yeast` and `grand-boule` were all at zero, and #1474's exact defect
 * could be re-created on `masterGain` in three of them at once, against three
 * shipped `max={2}` knobs, with every assertion green. Four of those six are now
 * covered; two are not, and both are named with their cause in the per-device
 * pin. **`comparedPerDevice` is asserted by identity for that reason** — a
 * device that silently falls to zero is the failure mode this census exists to
 * catch, turned on itself.
 *
 * ## Why the comparison is not a tautology
 *
 * The trap this campaign has been bitten by (`descriptorEngineParamWeld`'s
 * cross-engine blind spot) is an expected value derived from the same source as
 * the actual. It is a live risk *here specifically*, because for a device with
 * no bespoke panel the generic inspector control reads its slider bounds
 * straight off the descriptor —
 * `TimelineEditor/presentations/views/Inspector/DeviceParameterControl.tsx:205-206`
 * (`const min = isLog ? 0 : param.minValue`) — so comparing those two would be
 * comparing `param.minValue` with itself and would pass on every possible
 * defect. Those devices are therefore **excluded by construction** and counted
 * as `generic-ui`; only devices with a hand-written panel, whose literals were
 * typed by a person independently of the descriptor, are compared.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

// ── Source reading ─────────────────────────────────────────────────────────

function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/\/\/[^\n]*/g, ' ');
}

/**
 * The braced expression starting at `openIndex`.
 *
 * String-aware, because a `readout={`${x}%`}` or a label containing a brace
 * would otherwise close the expression early and truncate the attribute.
 */
function readBraced(source: string, openIndex: number): string {
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
        if (char === '"' || char === "'" || char === '`') {
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

/**
 * The opening JSX tag starting at `start`.
 *
 * Depth tracking is what makes this usable: an `onChange={(v) => setParam('x',
 * v)}` attribute contains `>` inside an arrow function, and a naive scan to the
 * first `>` would cut the tag in half and lose every prop after it — including
 * `min` and `max`, which are conventionally written after `onChange`.
 */
function readTag(source: string, start: number): string | null {
    let depth = 0;
    let inString = false;
    let quote = '';
    for (let index = start; index < source.length; index++) {
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
        if (char === '"' || char === "'" || char === '`') {
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
            continue;
        }
        if (char === '>' && depth === 0) {
            return source.slice(start, index + 1);
        }
    }
    return null;
}

function collectTsx(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__') {
                continue;
            }
            collectTsx(full, out);
            continue;
        }
        if (entry.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:e-?\d+)?`;

/** The value of JSX attribute `name`: a braced expression, or a quoted string. */
function readAttribute(tag: string, name: string): string | null {
    const attribute = new RegExp(String.raw`\b${name}=`, 'g');
    let match = attribute.exec(tag);
    while (match !== null) {
        const after = match.index + match[0].length;
        if (tag[after] === '{') {
            return readBraced(tag, after);
        }
        const quoted = /^(["'])((?:[^\\]|\\.)*?)\1/.exec(tag.slice(after));
        if (quoted !== null) {
            return quoted[0];
        }
        match = attribute.exec(tag);
    }
    return null;
}

/**
 * The parameter id a binding expression names, if it names one literally.
 *
 * Reading the id from a *named attribute* rather than from anywhere in the tag
 * is load-bearing, and an earlier revision got it wrong. Crust's `AutoKnob`
 * carries two writes — `onAutoChange={(auto) => setParam('attackAuto', auto)}`
 * and `onChange={(v) => setParam('attack', v)}` (`CrustControlZone.tsx:302-306`)
 * — and a tag-wide scan attributed the knob's 0..100 travel to `attackAuto`,
 * whose declared range is the 0..1 of a boolean. That reported two disagreements
 * that do not exist. The auto toggle is not a knob and has no travel; only the
 * value binding does.
 *
 * ## The id is not always the first argument
 *
 * An earlier revision anchored the call form to `…Param(` immediately followed
 * by the literal, which silently excluded every panel that passes a device id
 * first. `ToasterPanel.tsx:618-656` writes
 * `setToasterKitParam(deviceId, 'swing', value)` and `LevainPanel.tsx:313-321`
 * writes `setLevainParamWithAudio(deviceId, 'masterGain', value)` — four
 * kit-scoped Toaster knobs and Levain's master, all with numeric bounds, all
 * invisible. So the literal is now taken from **any** argument position.
 *
 * The safety condition for widening it is `exactly one` string literal in the
 * argument list. `setBacteriaBandParamWithAudio(deviceId, bandIndex, 'chorusFeedback', value)`
 * still resolves unambiguously; a call carrying two literals resolves to
 * nothing rather than to a coin flip, and lands in the unbound count where it
 * can be seen.
 */
function readBoundParamId(expression: string | null): string | null {
    if (expression === null) {
        return null;
    }
    const bare = /^["']([\w-]+)["']$/.exec(expression) ?? /^\{\s*["']([\w-]+)["']\s*\}$/.exec(expression);
    if (bare !== null) {
        return bare[1]!;
    }

    // A `set…Param…(` / `update…Param…(` / `on…Param…(` call, or Crumbs'
    // `onStackChange`. `setGrandBouleMasterGain(…)` deliberately does not match:
    // its parameter id lives in the *function name*, not in any argument, so
    // there is no literal to read and pretending otherwise would invent one.
    const callSite = /\b(?:set|update|on)\w*(?:[Pp]aram\w*|StackChange)\(/.exec(expression);
    if (callSite !== null) {
        const args = readParenthesised(expression, callSite.index + callSite[0].length - 1);
        const literals = [...args.matchAll(/(?<![\w$])['"]([\w-]+)['"]/g)].map((hit) => hit[1]!);
        if (literals.length === 1) {
            return literals[0]!;
        }
    }

    // An object-argument write. Two shapes occur and they mean opposite things:
    // Crumbs' `onStackChange({ stackCount: v })` names the parameter with the
    // *key*, while Proof's `onPatchChange({ key: 'imgMonoBassFreq', value })`
    // names it with the key's *value*. Reading the key name in both cases is
    // what produced the phantom `byParam` entry `"key"` — an id no descriptor
    // declares, invisible to `compared` and to the per-device gap pins.
    const objectArgument = /\(\s*\{\s*(\w+)\s*:\s*(?:'([\w-]+)')?/.exec(expression);
    if (objectArgument !== null) {
        const keyName = objectArgument[1]!;
        const keyValue = objectArgument[2];
        if (['key', 'param', 'paramId', 'id'].includes(keyName)) {
            return keyValue ?? null;
        }
        return keyName;
    }
    return null;
}

/** The parenthesised argument list starting at `openIndex`, brace- and string-aware. */
function readParenthesised(source: string, openIndex: number): string {
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
        if (char === '"' || char === "'" || char === '`') {
            inString = true;
            quote = char;
            continue;
        }
        if (char === '(') {
            depth++;
            continue;
        }
        if (char === ')') {
            depth--;
            if (depth === 0) {
                return source.slice(openIndex, index + 1);
            }
        }
    }
    return source.slice(openIndex);
}

// ── The population, and how each device binds a knob to a parameter ────────

/**
 * The JSX attributes a panel may use to say which parameter a knob drives, in
 * the order they are tried.
 *
 * **The variance is the finding.** There is no single place knob travel lives
 * and no single way a control names its parameter. Four spellings are in use
 * across eleven hand-written panels, and all four are load-bearing today:
 *
 *   - `param="threshold"`                          Gluten (`GlutenPanel.tsx:653-660`)
 *   - `paramId="distMix"`                          Fermenter (`EffectsSection.tsx:127-137`)
 *   - `k="mix"`                                    Bacteria (`BacteriaPanel.tsx:548-553`)
 *   - `onChange={(v) => setParam('lookahead', v)}` Crumbs, Crust, ProofChamber
 *                                                  (`CrustControlZone.tsx:291-296`)
 *
 * Recorded rather than normalised: normalising is a refactor of eleven panels,
 * and this census has to be able to run *before* that refactor rather than as
 * its reward. The list is deliberately not "any attribute holding a string" —
 * `id=` and `key=` mean something else on most elements, and accepting them
 * globally bound knobs to the wrong parameter.
 *
 * `onChange` is read last because a control can carry two writes. Crust's
 * `AutoKnob` has `onAutoChange={(auto) => setParam('attackAuto', auto)}`
 * alongside `onChange={(v) => setParam('attack', v)}`
 * (`CrustControlZone.tsx:302-306`); the toggle is not a knob and has no travel.
 */
const BINDING_ATTRIBUTES = ['param', 'paramId', 'k', 'onChange'] as const;

/**
 * A device with a hand-written panel: where its controls live, and how its
 * panel's vocabulary becomes descriptor ids.
 *
 * `translation` is read from source rather than imported, for the same reason
 * `descriptorEngineParamWeld` reads the worklet tables from source: importing
 * `ProofChamberState.ts` from an Arrangement spec is a deep cross-module import
 * into `models/`, which `deps:validate` forbids.
 */
type PanelBinding = {
    readonly presentationRoot: string;
    readonly translation:
        | { readonly kind: 'identity' }
        | { readonly kind: 'table'; readonly source: string }
        | { readonly kind: 'switch'; readonly source: string };
};

const PANEL_BINDINGS: Readonly<Record<string, PanelBinding>> = {
    'builtin-crumbs': {
        presentationRoot: 'src/modules/Crumbs/presentations',
        translation: { kind: 'identity' },
    },
    'dutch-oven': {
        presentationRoot: 'src/modules/ProofChamber/presentations',
        // The panel speaks camelCase and the descriptor speaks the Rust
        // snake_case (`shimmerAmount` → `shimmer_amount`, `earlyLateBalance` →
        // `early_late`); `ProofChamberPanel.setParam` performs the translation
        // through this same table before it calls `setDeviceParameter`
        // (`ProofChamberPanel.tsx:227-240`).
        translation: { kind: 'table', source: 'src/modules/ProofChamber/models/ProofChamberState.ts' },
    },
    'native-scoring': {
        presentationRoot: 'src/modules/Tuner/presentations',
        translation: { kind: 'identity' },
    },
    fermenter: {
        presentationRoot: 'src/modules/Fermenter/presentations',
        translation: { kind: 'identity' },
    },
    toaster: {
        presentationRoot: 'src/modules/Toaster/presentations',
        translation: { kind: 'identity' },
    },
    levain: {
        presentationRoot: 'src/modules/Levain/presentations',
        translation: { kind: 'identity' },
    },
    gluten: {
        presentationRoot: 'src/modules/Gluten/presentations',
        translation: { kind: 'identity' },
    },
    bacteria: {
        presentationRoot: 'src/modules/Bacteria/presentations',
        translation: { kind: 'identity' },
    },
    grinder: {
        presentationRoot: 'src/modules/Grinder/presentations',
        translation: { kind: 'identity' },
    },
    proof: {
        presentationRoot: 'src/modules/Proof/presentations',
        // Proof's descriptor ids are the Rust snake_case ones; its panel writes
        // camelCase patch keys and `setProofParamWithPatch` translates them on
        // the way to the engine. Reading that switch is the join.
        translation: {
            kind: 'switch',
            source: 'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts',
        },
    },
    yeast: {
        presentationRoot: 'src/modules/Yeast/presentations',
        translation: { kind: 'identity' },
    },
    crust: {
        presentationRoot: 'src/modules/Crust/presentations',
        translation: { kind: 'identity' },
    },
    'grand-boule': {
        presentationRoot: 'src/modules/GrandBoule/presentations',
        translation: { kind: 'identity' },
    },
};

function readTranslationTable(source: string): ReadonlyMap<string, string> {
    const text = stripComments(readFileSync(join(REPO_ROOT, source), 'utf8'));
    const declaration = text.indexOf('const PARAM_MAP');
    if (declaration === -1) {
        return new Map();
    }
    const block = readBraced(text, text.indexOf('{', declaration));
    const entry = /([A-Za-z_]\w*)\s*:\s*'([\w-]+)'/g;
    return new Map([...block.matchAll(entry)].map((match) => [match[1]!, match[2]!]));
}

/**
 * A `case 'panelKey': return { name: 'engine_key', … }` switch.
 *
 * Proof's panel speaks camelCase and its descriptor speaks the Rust snake_case;
 * the translation is a switch rather than an object literal
 * (`Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:276-300`), and it
 * is the same production code the panel's writes actually go through. Reading it
 * is what turns Proof from three uncovered parameters into three three-way rows.
 */
function readTranslationSwitch(source: string): ReadonlyMap<string, string> {
    const text = stripComments(readFileSync(join(REPO_ROOT, source), 'utf8')).replaceAll(/\s+/g, ' ');
    const arm = /case '([\w-]+)': return \{ name: '([\w-]+)'/g;
    return new Map([...text.matchAll(arm)].map((match) => [match[1]!, match[2]!]));
}

// ── Leg 2: knob travel ─────────────────────────────────────────────────────

type KnobTravel = {
    readonly paramId: string;
    readonly min: number;
    readonly max: number;
    readonly at: string;
};

/** Knob elements in one file that carry both numeric bounds and a literal id. */
function readKnobsFromFile(file: string): {
    bound: KnobTravel[];
    unbound: number;
} {
    const source = stripComments(readFileSync(file, 'utf8'));
    const bound: KnobTravel[] = [];
    let unbound = 0;
    const tagStart = /<([A-Z]\w*)/g;
    let match = tagStart.exec(source);
    while (match !== null) {
        const tag = readTag(source, match.index);
        if (tag !== null) {
            const min = new RegExp(String.raw`\bmin=\{(${NUMBER})\}`).exec(tag);
            const max = new RegExp(String.raw`\bmax=\{(${NUMBER})\}`).exec(tag);
            if (min !== null && max !== null) {
                let paramId: string | null = null;
                for (const attribute of BINDING_ATTRIBUTES) {
                    paramId = readBoundParamId(readAttribute(tag, attribute));
                    if (paramId !== null) {
                        break;
                    }
                }
                if (paramId === null) {
                    unbound++;
                } else {
                    bound.push({
                        paramId,
                        min: Number(min[1]),
                        max: Number(max[1]),
                        at: `${file.slice(REPO_ROOT.length + 1)}:${source.slice(0, match.index).split('\n').length}`,
                    });
                }
            }
        }
        match = tagStart.exec(source);
    }
    return { bound, unbound };
}

function buildPanelTranslator(binding: PanelBinding): (id: string) => string {
    if (binding.translation.kind === 'identity') {
        return (id) => id;
    }
    if (binding.translation.kind === 'switch') {
        const table = readTranslationSwitch(binding.translation.source);
        return (id) => table.get(id) ?? id;
    }
    const table = readTranslationTable(binding.translation.source);
    return (id) => table.get(id) ?? id;
}

function readPanelKnobs(deviceId: string): { byParam: ReadonlyMap<string, KnobTravel[]>; unbound: number } {
    const binding = PANEL_BINDINGS[deviceId]!;
    const translate = buildPanelTranslator(binding);

    const byParam = new Map<string, KnobTravel[]>();
    let unbound = 0;
    for (const file of collectTsx(join(REPO_ROOT, binding.presentationRoot))) {
        const read = readKnobsFromFile(file);
        unbound += read.unbound;
        for (const knob of read.bound) {
            const id = translate(knob.paramId);
            const existing = byParam.get(id);
            if (existing === undefined) {
                byParam.set(id, [{ ...knob, paramId: id }]);
                continue;
            }
            existing.push({ ...knob, paramId: id });
        }
    }
    return { byParam, unbound };
}

// ── Leg 3: the engine clamp ────────────────────────────────────────────────

/**
 * Where each device's `set_param` arms live.
 *
 * Directories, not file lists, so a sub-processor added beside an existing one
 * is picked up without an edit here. Unioned per device rather than split by
 * exclusive-dispatch alternative the way `descriptorEngineParamWeld` splits Dutch
 * Oven's: that split exists to stop one algorithm vouching for another's
 * *coverage*, and the question here is different — a clamp found anywhere on the
 * path is a real bound the value meets. Where two alternatives clamp the same
 * name differently the scanner refuses to guess (see `contested` below) rather
 * than picking one.
 *
 * `null` means the device has no Rust engine at all, so leg 3 does not exist for
 * it — not that it was skipped. Yeast is a MIDI FX rack implemented entirely in
 * TypeScript (see the device table in `CLAUDE.md`).
 */
const ENGINE_SOURCES: Readonly<Record<string, string | null>> = {
    'builtin-crumbs': 'crates/daw-dsp/src/crumbs',
    'dutch-oven': 'crates/proof-chamber/src',
    'native-scoring': 'crates/scoring/src',
    fermenter: 'crates/daw-dsp/src/fermenter',
    toaster: 'crates/daw-dsp/src/toaster',
    levain: 'crates/daw-dsp/src/levain',
    gluten: 'crates/daw-dsp/src/gluten',
    bacteria: 'crates/daw-dsp/src/bacteria',
    grinder: 'crates/daw-dsp/src/grinder',
    proof: 'crates/daw-dsp/src/proof',
    crust: 'crates/daw-dsp/src/crust',
    'grand-boule': 'crates/daw-dsp/src/grand_boule',
    yeast: null,
};

function collectRust(path: string, out: string[] = []): string[] {
    for (const entry of readdirSync(path)) {
        const full = join(path, entry);
        if (statSync(full).isDirectory()) {
            collectRust(full, out);
            continue;
        }
        if (entry.endsWith('.rs')) {
            out.push(full);
        }
    }
    return out;
}

/** Bodies of every function whose name mentions a parameter, as `descriptorEngineParamWeld` reads them. */
function readParamFunctionBodies(source: string): string[] {
    const bodies: string[] = [];
    const signature = /\bfn\s+([A-Za-z_]\w*param\w*)\s*(?:<[^>]*>)?\s*\(/gi;
    let match = signature.exec(source);
    while (match !== null) {
        const openIndex = source.indexOf('{', match.index + match[0].length);
        if (openIndex !== -1) {
            bodies.push(readBraced(source, openIndex));
        }
        match = signature.exec(source);
    }
    return bodies;
}

type Clamp = readonly [number, number];

/**
 * Two-sided numeric clamps, per string match-arm name.
 *
 * The body is split at each arm header (`"a" | "b" => …`) and the segment up to
 * the next header is searched for `value.clamp(lit, lit)`, optionally preceded
 * by a cast. Segmenting rather than searching backwards from each `clamp` is
 * what stops a multi-statement arm attributing its neighbour's bound.
 *
 * Shapes deliberately NOT read, because reading them would mean inventing an
 * endpoint or a domain — see `ENGINE_CLAMP_COVERAGE`:
 *   - one-sided `value.max(0.0)` / `.min(n)`
 *   - remapped `(value / 10.0).clamp(0.0, 1.0)` (`grinder/pedals.rs:36-38`) and
 *     `(value * 0.01).clamp(0.0, 1.0)` (`crust/engine.rs:389`), where the clamp
 *     bounds the *transformed* value and say nothing about the wire domain
 *   - named-constant bounds; `MAX_BANDS`, `MAX_BURSTS` and `MAX_VOICES` are each
 *     defined more than once with different values in different modules
 *     (`crust/bands.rs:19` = 5 against `bacteria/engine.rs:22` = 6), so a
 *     name-only resolver picks the wrong one
 */
function readClampsFromFiles(files: readonly string[]): {
    byName: ReadonlyMap<string, Clamp>;
    contested: readonly string[];
} {
    const found = new Map<string, Set<string>>();
    const armHeader = /"([\w-]+)"((?:\s*\|\s*"[\w-]+")*)\s*=>/g;
    // A cast is allowed between `value` and `.clamp`, but no arithmetic: the
    // leading `(` of `(value / 10.0)` is excluded by requiring `value` or
    // `(value as T)` immediately before the call.
    const clamp = new RegExp(
        String.raw`(?:value|\(\s*value\s+as\s+\w+\s*\))\.clamp\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)`
    );

    for (const file of files) {
        for (const body of readParamFunctionBodies(stripComments(readFileSync(file, 'utf8')))) {
            const flattened = body.replaceAll(/\s+/g, ' ');
            const headers = [...flattened.matchAll(armHeader)];
            for (const [index, header] of headers.entries()) {
                const start = header.index + header[0].length;
                const end = headers[index + 1]?.index ?? flattened.length;
                const hit = clamp.exec(flattened.slice(start, end));
                if (hit === null) {
                    continue;
                }
                const names = [header[1]!, ...[...header[2]!.matchAll(/"([\w-]+)"/g)].map((alt) => alt[1]!)];
                for (const name of names) {
                    const spans = found.get(name) ?? new Set<string>();
                    spans.add(`${Number(hit[1])},${Number(hit[2])}`);
                    found.set(name, spans);
                }
            }
        }
    }

    const byName = new Map<string, Clamp>();
    const contested: string[] = [];
    for (const [name, spans] of found) {
        if (spans.size > 1) {
            contested.push(name);
            continue;
        }
        const [min, max] = [...spans][0]!.split(',');
        byName.set(name, [Number(min), Number(max)]);
    }
    return { byName, contested };
}

/** `filterCutoff` → `filter_cutoff`, the translation every camelCase worklet performs. */
function camelToSnake(paramId: string): string {
    return paramId.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function readEngineClamps(deviceId: string): {
    byName: ReadonlyMap<string, Clamp>;
    contested: readonly string[];
} {
    const root = ENGINE_SOURCES[deviceId];
    if (root === null || root === undefined) {
        return { byName: new Map(), contested: [] };
    }
    return readClampsFromFiles(collectRust(join(REPO_ROOT, root)));
}

// ── The join ───────────────────────────────────────────────────────────────

type Comparison = {
    readonly deviceId: string;
    readonly paramId: string;
    readonly declared: readonly [number, number];
    readonly travel: readonly [number, number];
    readonly clamp: Clamp | null;
    readonly at: string;
};

type Census = {
    readonly compared: readonly Comparison[];
    readonly agree: readonly Comparison[];
    readonly disagree: readonly Comparison[];
    /** Declared parameters with no knob the scanner could bind, per device. */
    readonly noKnob: ReadonlyMap<string, readonly string[]>;
    /** Parameters bound to two knobs whose travel differs — no single actual. */
    readonly ambiguous: readonly string[];
    /** `legalSet` selectors: a set of legal values, not a span. */
    readonly notContinuous: readonly string[];
    /** Knob elements with bounds but no literal id the scanner could read. */
    readonly unboundKnobs: ReadonlyMap<string, number>;
    /**
     * Ids the scanner *did* resolve that no descriptor on that device declares.
     *
     * A binding that resolves to the wrong string is worse than one that
     * resolves to nothing: it is absent from `compared`, absent from `noKnob`,
     * and absent from `unboundKnobs`, so every existing pin stays green while a
     * control goes uncovered. Counted separately for exactly that reason.
     */
    readonly strayBindings: ReadonlyMap<string, readonly string[]>;
    /** Compared parameters per device — a zero here means the device is uncovered. */
    readonly comparedPerDevice: ReadonlyMap<string, number>;
    /** Compared rows that also carry a derived engine clamp — the three-way subset. */
    readonly threeWay: readonly Comparison[];
    /** Three-way rows where the clamp disagrees with the declared range. */
    readonly clampDisagree: readonly Comparison[];
    /**
     * Arm names whose clamp differs between two files on the same device, so no
     * single interval can be claimed. The seventh not-derivable shape.
     */
    readonly contestedClamps: ReadonlyMap<string, readonly string[]>;
};

function buildCensus(): Census {
    const compared: Comparison[] = [];
    const agree: Comparison[] = [];
    const disagree: Comparison[] = [];
    const noKnob = new Map<string, readonly string[]>();
    const ambiguous: string[] = [];
    const notContinuous: string[] = [];
    const unboundKnobs = new Map<string, number>();
    const threeWay: Comparison[] = [];
    const clampDisagree: Comparison[] = [];
    const strayBindings = new Map<string, readonly string[]>();
    const comparedPerDevice = new Map<string, number>();
    const contestedClamps = new Map<string, readonly string[]>();

    for (const descriptor of BUILTIN_PLUGINS) {
        const binding = PANEL_BINDINGS[descriptor.id];
        if (binding === undefined) {
            continue;
        }
        const panel = readPanelKnobs(descriptor.id);
        const engine = readEngineClamps(descriptor.id);
        unboundKnobs.set(descriptor.id, panel.unbound);
        contestedClamps.set(descriptor.id, [...engine.contested].sort());
        const declaredIds = new Set(descriptor.parameters.map((param) => param.id));
        strayBindings.set(descriptor.id, [...panel.byParam.keys()].filter((id) => !declaredIds.has(id)).sort());
        const missing: string[] = [];
        let comparedHere = 0;

        for (const param of descriptor.parameters) {
            if (param.legalSet !== undefined) {
                notContinuous.push(`${descriptor.id}.${param.id}`);
                continue;
            }
            const knobs = panel.byParam.get(param.id);
            if (knobs === undefined) {
                missing.push(param.id);
                continue;
            }
            const spans = new Set(knobs.map((knob) => `${knob.min}..${knob.max}`));
            if (spans.size > 1) {
                ambiguous.push(`${descriptor.id}.${param.id}`);
                continue;
            }
            const knob = knobs[0]!;
            // The engine spells a parameter either exactly as the descriptor
            // does or in the snake_case a worklet translated it to. Trying both
            // and taking whichever the arms answer to is conservative: a name
            // that resolves to neither yields no clamp and lands outside the
            // three-way subset rather than being compared against a guess.
            const clamp = engine.byName.get(param.id) ?? engine.byName.get(camelToSnake(param.id)) ?? null;
            const row: Comparison = {
                deviceId: descriptor.id,
                paramId: param.id,
                declared: [param.minValue, param.maxValue],
                travel: [knob.min, knob.max],
                clamp,
                at: knob.at,
            };
            compared.push(row);
            comparedHere++;
            if (clamp !== null) {
                threeWay.push(row);
                if (clamp[0] !== param.minValue || clamp[1] !== param.maxValue) {
                    clampDisagree.push(row);
                }
            }
            if (knob.min === param.minValue && knob.max === param.maxValue) {
                agree.push(row);
                continue;
            }
            disagree.push(row);
        }
        noKnob.set(descriptor.id, missing.sort());
        comparedPerDevice.set(descriptor.id, comparedHere);
    }

    return {
        compared,
        agree,
        disagree,
        noKnob,
        ambiguous,
        notContinuous,
        unboundKnobs,
        strayBindings,
        comparedPerDevice,
        threeWay,
        clampDisagree,
        contestedClamps,
    };
}

const CENSUS = buildCensus();

// ── Findings ───────────────────────────────────────────────────────────────

type RangeDisagreement = {
    readonly deviceId: string;
    readonly paramId: string;
    readonly declared: readonly [number, number];
    readonly travel: readonly [number, number];
    /**
     * The engine clamp, when leg 3 reaches this parameter. `null` is a claim
     * that has to survive assertion, not a shrug: if a clamp becomes derivable
     * the row reds until someone re-reads the verdict in the light of it.
     */
    readonly clamp: readonly [number, number] | null;
    /** `declared`, `knob`, or `unresolved` — which side this lane judges wrong. */
    readonly wrongSide: 'declared' | 'knob' | 'unresolved';
    readonly reason: string;
};

/**
 * Declared range and knob travel that disagree today.
 *
 * Recorded rather than silently exempted, and asserted **in both directions**:
 * a listed row must still disagree with exactly the numbers written here, and an
 * unlisted disagreement reds immediately. A row that stops being a defect reds
 * until it is deleted, so this table cannot become the place defects go to be
 * forgotten — the same discipline `KNOWN_ENGINE_GAPS` uses in
 * `descriptorEngineParamWeld.spec.ts`.
 *
 * Nothing here is "fixed" by widening the declaration to match the knob. That
 * makes the census green in one line and is the evasion this task most invites:
 * a declaration is only wrong if something independent of the declaration says
 * so, and for two of the three legs that something is the engine.
 */
const KNOWN_RANGE_DISAGREEMENTS: readonly RangeDisagreement[] = [
    {
        deviceId: 'fermenter',
        paramId: 'lfoRate',
        declared: [0, 5000],
        travel: [0, 20],
        clamp: [0, 5000],
        wrongSide: 'knob',
        reason:
            'The **mirror** of #1474, not a repeat of it. #1474 found three ranges declared *narrower* than the knob, ' +
            'where a clamp against the declaration would truncate the sweep. This one is declared 250× *wider*: the ' +
            'LFO Rate knob travels 0..20 Hz (`Fermenter/presentations/components/LfoSection.tsx:123`) while ' +
            '`FERMENTER_DESCRIPTOR` declares 0..5000 (`FermenterDescriptor.ts`, `lfoRate`). Nothing truncates — the ' +
            'defect points the other way. An automation lane drawn on LFO Rate offers a curve up to 5000, the lane ' +
            'picker scales its editor to that span, and 99.6% of the drawable range is travel the panel never ' +
            'offers.\n\n' +
            '**The knob is the wrong side, and leg 3 is what settles it.** ' +
            '`crates/daw-dsp/src/fermenter/layer.rs:631` is ' +
            '`"lfo_rate" => self.lfo_rate.set(value.clamp(0.0, 5000.0))` — the two-sided literal shape, which this ' +
            "census derives (the row's `clamp` above is read, not typed). So the *engine* independently agrees with " +
            'the declaration at 0..5000, and the descriptor is not a stray copy of anything: the DSP was built to ' +
            'accept audio-rate LFO, which is a real synthesis technique and the reason a modulator would be given ' +
            'that ceiling deliberately.\n\n' +
            'An earlier revision of this row marked it `unresolved` and asserted that `lfo_rate` "is not statically ' +
            'resolvable to a clamp". That was simply false — the census was already deriving the clamp while the ' +
            'prose beside it denied the clamp existed. It also floated a theory that 5000 was copied from ' +
            '`audioModRate` (declared [0..5000] on the same descriptor); the engine clamp rules that out, because a ' +
            'copied *descriptor* number would not also appear as a hand-written bound in the Rust.\n\n' +
            'Two legs against one, so the knob is the under-provisioned side. **Not fixed here.** Widening a shipped ' +
            "control's travel 250× changes its feel across its whole useful range, and a 0..5000 Hz LFO wants a log " +
            'taper rather than the linear one it has — that is a control-design change, not a number change, and it ' +
            'belongs to whoever owns the synth. Recorded with the evidence that identifies the side.',
    },
];

/**
 * Leg 3 — the engine clamp — and precisely where its derivation stops.
 *
 * Written here, at the point the derivation stops, rather than only in a PR
 * description: a future lane reading this file will otherwise assume the third
 * leg is covered everywhere and build on it. It is **not** a population-wide
 * equality. It covers 112 of the 192 compared parameters — the ones whose arm
 * contains a two-sided numeric `value.clamp(a, b)`. The remaining 80 are not
 * skipped for effort; each shape below yields no interval to compare, and
 * inventing one is exactly the "fabricate a clamp from a comment" this census
 * must not do.
 *
 *  1. **No clamp at all.** `self.x = value` / `x.set(value)` — 52 arms across
 *     the scanned crates. Crumbs' `master_gain.set(value)`
 *     (`crates/daw-dsp/src/crumbs/engine.rs:717`) is #1474's own example, and it
 *     is why the descriptor was the only thing that could have truncated that
 *     knob. "Unbounded" is not a range that can be equal or unequal to 0..2.
 *  2. **One-sided.** `value.max(0.0)` — 21 arms, including Crumbs `decay`
 *     (`crumbs/engine.rs:729`) and `release` (`:739`), plus `attack` (`:719`) and
 *     `hold` (`:724`), which #1474 did not name but are the same shape. A floor
 *     with no ceiling gives one endpoint; the other would have to be invented.
 *  3. **Clamp on a *transformed* value.** `(value / 10.0).clamp(0.0, 1.0)`
 *     (`grinder/pedals.rs:36-38`), `(value * 0.01).clamp(0.0, 1.0)`
 *     (`crust/engine.rs:389`). The bound describes the post-transform value, so
 *     reading `0..1` off it would assert a wire domain of 0..1 for a control
 *     whose wire domain is 0..10 or 0..100 — a false disagreement on every row.
 *     The scanner's regex requires `value` or `(value as T)` immediately before
 *     `.clamp`, which excludes these by construction.
 *  4. **Clamp one or more hops away.** ~118 arms are pure pass-throughs to a
 *     sub-processor's own `set_param` (`toaster/engines/mod.rs:409-435`,
 *     `proof-chamber/src/lib.rs:154`), and ~27 hand the raw value to a setter
 *     that may or may not clamp inside (`bacteria/engine.rs:815-824`).
 *  5. **Named-constant bounds.** Resolvable in principle, refused in practice:
 *     `MAX_BANDS`, `MAX_BURSTS` and `MAX_VOICES` are each defined more than once
 *     with different values in different modules (`crust/bands.rs:19` = 5 against
 *     `bacteria/engine.rs:22` = 6), so a name-only resolver picks the wrong one.
 *  6. **Two files on one device clamping the same name differently.** Unioning
 *     arm names across a device's sources means a name can carry two intervals,
 *     and there is then no single clamp to claim. `readClampsFromFiles` collects
 *     these as `contested` and refuses the name outright rather than picking a
 *     file. Live today on `gluten` (`ratio`, `attack`), `dutch-oven` (`decay`,
 *     `damping`), `bacteria` (`spectralBlur`) and seven Toaster arms.
 *     **`gluten.ratio` and `gluten.attack` are in the compared population**, so
 *     they are two-way rows for this reason and not for one of the others — the
 *     distinction is why this needs its own entry rather than being folded into
 *     "clamp applied in a callee".
 *  7. **Crumbs' enum dispatch, specifically.** The public `set_param`
 *     (`crumbs/mod.rs:95-101`) clamps nothing: it maps the name to a
 *     `CrumbsParam` through `parse_crumbs_param` (`crumbs/types.rs:321`) and
 *     dispatches into `crumbs/engine.rs:715`, where the arms are enum variants
 *     rather than string literals. **This scanner therefore reads zero clamps
 *     for Crumbs** — the device #1474's three defects were found on. Its knob
 *     leg is fully covered (13 of 13 parameters compared, `noKnob` 0), so the
 *     defect class is caught there; but a Crumbs-only clamp defect is invisible
 *     to this file, and closing that needs a name→variant→clamp join that this
 *     lane did not build.
 *
 * `notDerivable` is asserted rather than merely described, so that a later lane
 * that closes one of these shapes has to come here and delete the row.
 */
const ENGINE_CLAMP_COVERAGE = {
    derivable: 'two-sided numeric `value.clamp(a, b)` in the `set_param` arm body',
    notDerivable: [
        'bare assignment (`self.x = value`, `x.set(value)`) — no interval exists',
        'one-sided (`value.max(0.0)`, `.min(n)`) — one endpoint only, the other would have to be invented',
        'clamp on a transformed value (`(value / 10.0).clamp(…)`) — bounds the result, not the wire domain',
        'clamp applied in a callee or in a sub-processor the arm delegates to',
        'named-constant bounds — the same constant name is defined with different values in different modules',
        'contested — two files on one device clamp the same arm name to different intervals',
        'Crumbs: enum-variant arms behind `parse_crumbs_param`, not string arms',
    ],
} as const;

type ClampDisagreement = {
    readonly deviceId: string;
    readonly paramId: string;
    readonly declared: readonly [number, number];
    readonly clamp: readonly [number, number];
    /**
     * `engine-narrower` — the descriptor and knob offer travel the DSP silently
     * discards; the user turns the knob through a dead zone. This is the mirror
     * of #1474 and the one that costs something.
     *
     * `engine-wider` — the engine tolerates more than the UI offers. Nothing is
     * truncated and nothing is dead; the product simply exposes less than the
     * DSP can do. Recorded for completeness, not as a defect.
     */
    readonly direction: 'engine-narrower' | 'engine-wider';
    readonly reason: string;
};

/**
 * Declared range and engine clamp that disagree, for the 107 parameters where
 * the clamp is derivable.
 *
 * Every row's verdict is a **claim with its evidence**, not a settled fact — the
 * point of writing them next to the data rather than in a merged PR body is that
 * the next person to touch one of these numbers can check the reasoning.
 *
 * Nothing here is fixed by editing the declaration to match, and for a reason
 * that is specific rather than procedural: in five of the seven rows the
 * *declaration and the knob already agree with each other*, so the declaration
 * is the side with two votes. Changing it to match the engine would move the
 * knob's travel out of agreement and trade one disagreement for another.
 * Asserted in both directions — a row that stops disagreeing reds until deleted.
 */
const KNOWN_CLAMP_DISAGREEMENTS: readonly ClampDisagreement[] = [
    {
        deviceId: 'fermenter',
        paramId: 'samplerStart',
        declared: [0, 1],
        clamp: [0, 0.99],
        direction: 'engine-narrower',
        reason:
            '`"sampler_start" => self.sampler_start = value.clamp(0.0, 0.99)` ' +
            '(`crates/daw-dsp/src/fermenter/layer.rs:722`). **The engine is right and the disagreement is cosmetic.** ' +
            'A start point of exactly 1.0 is the end of the sample, i.e. nothing to play; the 0.99 ceiling is a ' +
            'degenerate-case guard, and its partner `samplerEnd` carries the mirror floor. The dead zone is the top 1% ' +
            'of a knob whose useful travel is the other 99%. Recorded rather than fixed because narrowing the declared ' +
            'range to 0.99 would retroactively clamp automation curves in saved projects for no audible gain — a ' +
            'data-affecting change that does not belong in a census.',
    },
    {
        deviceId: 'fermenter',
        paramId: 'samplerEnd',
        declared: [0, 1],
        clamp: [0.01, 1],
        direction: 'engine-narrower',
        reason:
            '`"sampler_end" => self.sampler_end = value.clamp(0.01, 1.0)` (`fermenter/layer.rs:723`). Mirror of ' +
            '`samplerStart` and the same verdict: the engine floor is a degenerate-case guard, the dead zone is the ' +
            'bottom 1%, and the fix is not worth clamping saved automation for.',
    },
    {
        deviceId: 'bacteria',
        paramId: 'chorusFeedback',
        declared: [-1, 1],
        clamp: [-0.95, 0.95],
        direction: 'engine-narrower',
        reason:
            '`"chorusFeedback" => self.feedback = value.clamp(-0.95, 0.95)` ' +
            '(`crates/daw-dsp/src/bacteria/chorus.rs:93`). **The engine is right and this one is not cosmetic — it is ' +
            'the mirror of #1474 with real user-visible cost.** A delay-line feedback coefficient at |1.0| does not ' +
            'decay: the loop sustains or grows without bound, so 0.95 is a stability limit rather than a taste ' +
            'choice, and it cannot move. What is wrong is the pair that agree with each other: the descriptor declares ' +
            '±1 and the knob travels ±1 (`Bacteria/presentations/views/BacteriaPanel.tsx:1074`), so the top 5% of ' +
            'travel at each end is a dead zone — the user pushes feedback to 100%, the readout says 100%, and the ' +
            'sound stops changing at 95%.\n\n' +
            '**Confidence and what I did not do.** I am confident the engine is correct (unconditional for a feedback ' +
            'coefficient) and confident the current state is a defect (five per cent of a knob does nothing). I am ' +
            'NOT confident which of the other two to move, and did not guess: narrowing the declaration to ±0.95 ' +
            "clamps saved automation, and narrowing the knob changes a shipped control's feel. Both are product " +
            'decisions. This is the second row I would like a second pair of eyes on.',
    },
    {
        deviceId: 'bacteria',
        paramId: 'phaserFeedback',
        declared: [-1, 1],
        clamp: [-0.95, 0.95],
        direction: 'engine-narrower',
        reason:
            '`"phaserFeedback" => self.feedback = value.clamp(-0.95, 0.95)` (`bacteria/chorus.rs:220`). Same defect, ' +
            'same engine reasoning, same unresolved question as `chorusFeedback` — an all-pass feedback path is as ' +
            'unstable at |1.0| as a delay one. Listed separately rather than folded in because the two are separate ' +
            'declarations and either could be fixed without the other.',
    },
    {
        deviceId: 'fermenter',
        paramId: 'fmModAmount',
        declared: [0, 4],
        clamp: [0, 10],
        direction: 'engine-wider',
        reason:
            '`"fm_mod_amount" => self.fm_mod_amount = value.clamp(0.0, 10.0)` (`fermenter/layer.rs:676`). No defect ' +
            'and nothing dead: the descriptor and the knob agree on 0..4 and everything in that span reaches the DSP ' +
            'intact. The engine merely tolerates more index than the UI offers. Recorded so the direction is on the ' +
            'record — if someone later widens the knob to 10 expecting the engine to be the limit, this row already ' +
            'says it is not.',
    },
    {
        deviceId: 'bacteria',
        paramId: 'grainSize',
        declared: [10, 500],
        clamp: [1, 500],
        direction: 'engine-wider',
        reason:
            '`"grainSize" => self.grain_size_ms = value.clamp(1.0, 500.0)` ' +
            '(`crates/daw-dsp/src/bacteria/granular.rs:99`). Engine floor 1 ms against a UI floor of 10 ms. Not a ' +
            'defect — the UI declines to offer the bottom 9 ms, which at 1 ms grains is closer to a buzz than a ' +
            'texture. Nothing is truncated and nothing is inert.',
    },
    {
        deviceId: 'bacteria',
        paramId: 'grainDensity',
        declared: [1, 100],
        clamp: [0.1, 100],
        direction: 'engine-wider',
        reason:
            '`"grainDensity" => self.density = value.clamp(0.1, 100.0)` (`bacteria/granular.rs:100`). Engine floor ' +
            '0.1 grains/s against a UI floor of 1. Same reading as `grainSize`: the UI offers a subset of what the ' +
            'DSP accepts, which truncates nothing.',
    },
];

describe('declared parameter range agrees with the knob that drives it', () => {
    it('reads real knob travel out of the panels it claims to read', () => {
        // An absence assertion needs a presence pin (ADR 0015 rule 4). If
        // `readTag` regressed, or the binding attributes stopped matching, every
        // device would report zero bound knobs and the equality assertion below
        // would pass vacuously on an empty population. Pin travel from four
        // panels that use four *different* binding attributes, including the
        // exact parameter #1474 fixed.
        const crumbs = readPanelKnobs('builtin-crumbs').byParam;
        expect(crumbs.get('masterGain')?.[0]?.min).toBe(0);
        expect(crumbs.get('masterGain')?.[0]?.max).toBe(2); // onChange binding
        expect(crumbs.get('release')?.[0]?.max).toBe(10);

        const gluten = readPanelKnobs('gluten').byParam;
        expect(gluten.get('threshold')?.[0]?.min).toBe(-60); // param= binding
        expect(gluten.get('ratio')?.[0]?.max).toBe(20);

        const bacteria = readPanelKnobs('bacteria').byParam;
        expect(bacteria.get('mix')?.[0]?.max).toBe(1); // k= binding

        const chamber = readPanelKnobs('dutch-oven').byParam;
        // Reached only through the PARAM_MAP translation: the panel spells this
        // `shimmerAmount`, the descriptor spells it `shimmer_amount`.
        expect(chamber.get('shimmer_amount')?.[0]?.max).toBe(1);
        expect(chamber.get('early_late')?.[0]?.max).toBe(1);
    });

    it('compares a population derived from the descriptors, not a hand-kept list', () => {
        // Hand-maintained device lists have been wrong four times in this
        // campaign, so the set of devices with a bespoke panel is *derived* from
        // `hasCustomUI` and the binding table is required to cover it exactly. A
        // device that gains a custom panel without an entry here reds; an entry
        // for a device that loses its panel reds too.
        const withCustomUi = BUILTIN_PLUGINS.filter((descriptor) => descriptor.hasCustomUI === true)
            .map((descriptor) => descriptor.id)
            .sort();
        expect(Object.keys(PANEL_BINDINGS).sort()).toStrictEqual(withCustomUi);
    });

    it('excludes generic-UI devices, whose slider bounds are the declaration itself', () => {
        // The tautology guard, asserted rather than described. A device with no
        // bespoke panel renders through `DeviceParameterControl`, which sets
        // `min`/`max` from `param.minValue`/`param.maxValue` — comparing those
        // would compare the declaration with itself. Prove the exclusion is real
        // by naming devices that are in `BUILTIN_PLUGINS` and out of the
        // compared population.
        const comparedDevices = new Set(CENSUS.compared.map((row) => row.deviceId));
        expect(comparedDevices.has('builtin-synth')).toBe(false);
        expect(comparedDevices.has('builtin-eq')).toBe(false);
        expect(comparedDevices.has('faust-1176-compressor')).toBe(false);
        expect(BUILTIN_PLUGINS.some((descriptor) => descriptor.id === 'builtin-synth')).toBe(true);
    });

    it('every declared range that has a knob equals that knob’s travel', () => {
        const unexpected = CENSUS.disagree.filter(
            (row) =>
                !KNOWN_RANGE_DISAGREEMENTS.some(
                    (known) => known.deviceId === row.deviceId && known.paramId === row.paramId
                )
        );
        expect(
            unexpected.map(
                (row) =>
                    `${row.deviceId}.${row.paramId} declared[${row.declared.join('..')}] knob[${row.travel.join('..')}] ${row.at}`
            )
        ).toStrictEqual([]);
    });

    it('every recorded disagreement is still a disagreement, with the numbers recorded', () => {
        // The other direction. A row that stops disagreeing — because someone
        // fixed the declaration or the knob — must red until the row is deleted,
        // so the table cannot outlive the defect it documents.
        for (const known of KNOWN_RANGE_DISAGREEMENTS) {
            const row = CENSUS.disagree.find(
                (candidate) => candidate.deviceId === known.deviceId && candidate.paramId === known.paramId
            );
            expect(row, `${known.deviceId}.${known.paramId} no longer disagrees — delete the row`).toBeDefined();
            expect(row!.declared).toStrictEqual(known.declared);
            expect(row!.travel).toStrictEqual(known.travel);
            // The engine clamp is part of the recorded evidence, so it is
            // asserted like the rest of it. This is the assertion the first
            // revision of the `lfoRate` row needed and did not have: its prose
            // said leg 3 could not reach `lfo_rate` while the census beside it
            // was already deriving 0..5000. A verdict that misdescribes its own
            // evidence now reds.
            expect(row!.clamp).toStrictEqual(known.clamp);
        }
    });

    it('records how much of the population each leg actually covers', () => {
        // Count provenance. These are pinned so the census cannot silently
        // shrink: a refactor that renames a binding attribute, or moves a panel
        // out of `presentations/`, drops parameters out of `compared` into
        // `noKnob` without changing any assertion above. Pinning the split turns
        // that into a red.
        //
        // compared = descriptor parameters on a bespoke-panel device that the
        // scanner bound to exactly one knob with two numeric bounds.
        expect(CENSUS.compared.length).toBe(192);
        expect(CENSUS.agree.length).toBe(191);
        expect(CENSUS.disagree.length).toBe(1);
        expect(CENSUS.ambiguous).toStrictEqual([]);

        // threeWay = the subset of `compared` that ALSO has a derivable engine
        // clamp. 112 of 192 is the honest size of the three-way census; the
        // other 80 are two-way only, for the shapes named in
        // `ENGINE_CLAMP_COVERAGE.notDerivable`.
        expect(CENSUS.threeWay.length).toBe(112);
        expect(CENSUS.clampDisagree.length).toBe(7);

        // `legalSet` selectors: oversampling factors and the like. A set of legal
        // values has no "travel" — the control steps between members rather than
        // sweeping — so the three-way comparison does not apply and forcing it
        // would report every one of them as a disagreement.
        expect(CENSUS.notContinuous.length).toBe(3);
    });

    it('pins compared coverage per device, so a device at zero is stated not implied', () => {
        // **The most important assertion in this file**, and the one it shipped
        // without. A total of 192 says nothing about distribution: the first
        // revision reported "184 across 13 devices" while six of the thirteen
        // were at zero, and #1474's exact defect could be re-created on
        // `masterGain` in Toaster, Levain and GrandBoule simultaneously — three
        // shipped `max={2}` knobs — with the spec still green. A census whose
        // coverage can silently shrink is the failure mode this file exists to
        // prevent, applied to itself.
        expect(Object.fromEntries(CENSUS.comparedPerDevice)).toStrictEqual({
            'builtin-crumbs': 13,
            'dutch-oven': 17,
            fermenter: 57,
            gluten: 24,
            bacteria: 42,
            grinder: 25,
            crust: 6,
            // Reached only because `readBoundParamId` takes the id from any
            // argument position: `setToasterKitParam(deviceId, 'swing', value)`.
            toaster: 4,
            // `setLevainParamWithAudio(deviceId, 'masterGain', value)`, same reason.
            levain: 1,
            // Reached only through the `setProofParamWithPatch` switch, which
            // translates the panel's camelCase to the descriptor's snake_case.
            proof: 3,

            // ── The zeros. Each is a real gap with a real cause. ──────────────
            //
            // The Tuner has no knobs: `a4_hz` is a numeric field, `mute` and
            // `tone` are toggles. Nothing to compare, and no defect implied.
            'native-scoring': 0,
            // Yeast declares four rack-level parameters and its panel renders 48
            // per-processor controls that name none of them. The largest blind
            // spot in the file; see `unboundKnobs`.
            yeast: 0,
            // GrandBoule encodes the parameter in the *function name* —
            // `setGrandBouleMasterGain({ deviceId, engine, store, gain: value })`
            // (`GrandBoulePanel.tsx:371-381`) — so there is no literal id to
            // read, and inventing one from the function name would be guessing.
            // Its three declared parameters include a `masterGain` on a shipped
            // `max={2}` knob, i.e. exactly #1474's shape, uncovered.
            'grand-boule': 0,
        });
    });

    it('counts bindings that resolved to an id no descriptor declares', () => {
        // A binding that resolves to the *wrong* string is worse than one that
        // resolves to nothing: it is absent from `compared`, from `noKnob` and
        // from `unboundKnobs`, so every other pin stays green while a control
        // goes uncovered. `ProofImagerSection.tsx:121` was one —
        // `onPatchChange({ key: 'imgMonoBassFreq', … })` resolved to the literal
        // key name `"key"`, a phantom entry for a knob travelling 40..200.
        //
        // Asserted by identity, not count, because which ids these are is the
        // whole diagnostic value: `toaster`'s eight are pad-scoped writes that
        // share a spelling with no kit parameter, `levain`'s fifteen are
        // engine-config values, and Proof's three snake_case entries are
        // parameters the switch translates but the descriptor does not declare.
        expect(Object.fromEntries(CENSUS.strayBindings)).toStrictEqual({
            'builtin-crumbs': [],
            'dutch-oven': [],
            fermenter: [],
            gluten: [],
            yeast: [],
            crust: [],
            'grand-boule': [],
            'native-scoring': [],
            toaster: ['decay', 'drive', 'filterCutoff', 'lofiBits', 'lofiMix', 'pan', 'tone', 'volume'],
            levain: [
                'amount',
                'dynamicCrossfadeTime',
                'dynamicMax',
                'fastThresholdMs',
                'pan',
                'portamentoVelocityThreshold',
                'slowThresholdMs',
                'timingMaxMs',
                'tuningMaxCents',
                'vibratoDepthMax',
                'vibratoOnsetDelay',
                'vibratoRateMax',
                'vibratoRateMin',
                'vibratoVarMax',
                'volume',
            ],
            bacteria: [
                'filterEnvAttack',
                'filterEnvRelease',
                'lorenzBeta',
                'lorenzRho',
                'lorenzSigma',
                'lorenzSpeed',
                'stepSeqRate',
                'stepSeqSteps',
                'tubeBias',
            ],
            grinder: ['distance', 'positionX', 'positionY'],
            proof: ['dynBands', 'excBands', 'imgBandWidth', 'img_mono_bass_freq', 'lim_lookahead', 'lim_release'],
        });
    });

    it('names the arm names two files clamp differently, the seventh unreadable shape', () => {
        // `contested` was computed and forwarded and never read — a shape the
        // file's own prose claimed was enumerated in `ENGINE_CLAMP_COVERAGE`
        // while being absent from it. `gluten.ratio` and `gluten.attack` are in
        // `compared` (the presence pin even asserts `ratio` max 20), so they are
        // two-way rows for *this* reason and not one of the other six.
        expect(Object.fromEntries(CENSUS.contestedClamps)).toStrictEqual({
            'builtin-crumbs': [],
            fermenter: [],
            levain: [],
            grinder: [],
            proof: [],
            yeast: [],
            crust: [],
            'grand-boule': [],
            'native-scoring': [],
            'dutch-oven': ['damping', 'decay'],
            gluten: ['attack', 'ratio'],
            bacteria: ['spectralBlur'],
            toaster: ['amp_decay', 'base_freq', 'noise_level', 'pitch_amount', 'pitch_decay', 'ratio', 'tone'],
        });

        // The refusal is the point: a contested name must yield no clamp at all
        // rather than whichever file the directory walk reached first.
        expect(readEngineClamps('gluten').byName.has('ratio')).toBe(false);
        expect(CENSUS.threeWay.some((row) => row.deviceId === 'gluten' && row.paramId === 'ratio')).toBe(false);
        expect(CENSUS.compared.some((row) => row.deviceId === 'gluten' && row.paramId === 'ratio')).toBe(true);
    });

    it('reads real clamps out of the Rust it claims to read', () => {
        // Presence pin for leg 3, on the same reasoning as the knob pin: if the
        // arm segmentation or the clamp regex went blind, every device would
        // report zero clamps, `threeWay` would empty, and the equality assertion
        // would pass vacuously. Pin clamps from four crates, verified by reading
        // the arm.
        expect(readEngineClamps('bacteria').byName.get('filterCutoff')).toStrictEqual([20, 20000]);
        expect(readEngineClamps('fermenter').byName.get('osc_coarse')).toStrictEqual([-24, 24]);
        expect(readEngineClamps('crust').byName.get('ceiling')).toStrictEqual([-24, 0]);
        expect(readEngineClamps('grand-boule').byName.get('velocity_curve')).toStrictEqual([0.5, 2]);

        // And the shape that must stay ABSENT. `(value / 10.0).clamp(0.0, 1.0)`
        // at `crates/daw-dsp/src/grinder/pedals.rs:36-38` bounds the transformed
        // value, not the wire domain; reading it as 0..1 would report a false
        // disagreement against a control whose wire domain is 0..10. If the
        // regex ever stops requiring `value` immediately before `.clamp`, this
        // reds.
        expect(readEngineClamps('grinder').byName.has('drive')).toBe(false);

        // Crumbs is the device #1474's defects were found on, and this scanner
        // reads NOTHING for it — the arms are enum variants behind
        // `parse_crumbs_param`, not string literals. Pinned so the gap is a
        // stated fact rather than an assumption; the day someone builds the
        // name→variant join, this reds and the note above has to be rewritten.
        expect(readEngineClamps('builtin-crumbs').byName.size).toBe(0);
    });

    it('every derivable engine clamp equals the declared range', () => {
        const unexpected = CENSUS.clampDisagree.filter(
            (row) =>
                !KNOWN_CLAMP_DISAGREEMENTS.some(
                    (known) => known.deviceId === row.deviceId && known.paramId === row.paramId
                )
        );
        expect(
            unexpected.map(
                (row) =>
                    `${row.deviceId}.${row.paramId} declared[${row.declared.join('..')}] clamp[${row.clamp?.join('..')}]`
            )
        ).toStrictEqual([]);
    });

    it('every recorded clamp disagreement is still one, with the numbers recorded', () => {
        for (const known of KNOWN_CLAMP_DISAGREEMENTS) {
            const row = CENSUS.clampDisagree.find(
                (candidate) => candidate.deviceId === known.deviceId && candidate.paramId === known.paramId
            );
            expect(row, `${known.deviceId}.${known.paramId} no longer disagrees — delete the row`).toBeDefined();
            expect(row!.declared).toStrictEqual(known.declared);
            expect(row!.clamp).toStrictEqual(known.clamp);
            // The direction is part of the claim, not a label: `engine-narrower`
            // means the user is offered travel the DSP discards, which is the
            // defect; `engine-wider` means the UI offers less than the DSP
            // accepts, which is not. A row whose direction flips has changed
            // meaning and must be re-judged rather than carried over.
            const narrower = known.clamp[0] > known.declared[0] || known.clamp[1] < known.declared[1];
            expect(narrower ? 'engine-narrower' : 'engine-wider').toBe(known.direction);
        }
    });

    it('names every parameter the knob leg could not reach, per device', () => {
        // The honest scope statement, asserted rather than described. These are
        // declared parameters on a device that *has* a bespoke panel, where the
        // scanner found no knob binding that id. They are NOT proof of a missing
        // control — most are booleans, mode selectors and segmented controls that
        // have no `min`/`max` at all, and the rest are knobs whose id the scanner
        // cannot read (see the unbound count below). They are listed so a reader
        // knows exactly which parameters this census says nothing about.
        //
        // Asserted by **identity**, not cardinality. The title promises names,
        // and a count does not keep that promise: a refactor that drops one
        // parameter out of `compared` while another enters leaves every count
        // unchanged and every assertion green, which is the same silent-shrink
        // failure the per-device pin above exists to stop.
        expect(Object.fromEntries(CENSUS.noKnob)).toStrictEqual({
            // Crumbs is fully covered on the knob leg: 13 of 13 declared
            // parameters bound to a knob. That matters more than the zero looks
            // — it is the device #1474's three defects were on, so the mutation
            // that re-creates one of them cannot slip through a coverage hole.
            'builtin-crumbs': [],
            // The booleans and the `saturation_type` selector. Everything else on
            // Dutch Oven resolves through the PARAM_MAP translation.
            'dutch-oven': ['freeze', 'saturation', 'saturation_type', 'shimmer'],
            // The Tuner panel drives `a4_hz` through a numeric field rather than
            // a knob, and `mute`/`tone` are toggles.
            'native-scoring': ['a4_hz', 'mute', 'tone'],
            // Fermenter is the largest gap by far, and the reason is a single
            // shape rather than 48 unrelated omissions: several sections drive
            // knobs from a config array — `{ label: 'A', key: 'Attack',
            // min: 0.001, max: 5 }` mapped over at `EnvelopeSection.tsx:101-114`
            // — and compose the id at runtime as `${activeEnv}${key}` (`:60`), so
            // the id `ampAttack` exists in no literal the scanner can read.
            // Travel IS derivable there; the binding is not. Making these
            // comparable means either binding the config rows to full ids in the
            // panel, or driving the panel under jsdom and reading `aria-valuemin`
            // off the rendered `role="slider"` (`RotaryKnob.tsx:373-377`) — a
            // real option, and the obvious next census.
            fermenter: [
                'activeLayer',
                'ampAttack',
                'ampDecay',
                'ampRelease',
                'ampSustain',
                'audioModTarget',
                'chaosAmount',
                'chaosSpeed',
                'eqHighFreq',
                'eqHighGain',
                'eqHighQ',
                'eqLowFreq',
                'eqLowGain',
                'eqLowQ',
                'eqMidFreq',
                'eqMidGain',
                'eqMidQ',
                'filterAttack',
                'filterDecay',
                'filterMode',
                'filterModel',
                'filterRelease',
                'filterSustain',
                'fmAlgorithm',
                'fmLevel1',
                'fmLevel2',
                'fmLevel3',
                'fmLevel4',
                'fmRatio1',
                'fmRatio2',
                'fmRatio3',
                'fmRatio4',
                'ksBrightness',
                'ksDamping',
                'layerLevel',
                'layerPan',
                'lfoShape',
                'noiseColor',
                'numLayers',
                'oscDrift',
                'oscEngine',
                'oscWaveform',
                'portamentoMode',
                'portamentoTime',
                'reverbType',
                'samplerMode',
                'voiceDrive',
                'warpMode',
            ],
            // All four kit parameters are covered. **The comment that used to sit
            // here said the opposite** — that Toaster's knobs are "all pad-scoped
            // and go through `set_pad_param`" — and the source contradicts it:
            // `ToasterPanel.tsx:618-656` renders four kit-scoped `<Knob>`s on
            // exactly these ids. The real cause of the old zero was the scanner
            // requiring the id as the first call argument. A wrong stated reason
            // is worse than a bare count, because it sends the next reader to
            // look in the wrong place.
            toaster: [],
            // Five of Levain's six. **Also previously mis-stated**: the old
            // comment claimed none of its knobs drive descriptor parameters, and
            // `masterGain` does (`LevainPanel.tsx:313-321`, `max={2}`). These
            // five are toggles and mode selectors with no `min`/`max`.
            levain: ['autoDivisi', 'ensembleTiming', 'humanize', 'legatoEnabled', 'vibratoDepth'],
            gluten: [
                'allButtons',
                'autoMakeup',
                'autoRelease',
                'blendTopology',
                'deltaListen',
                'detection',
                'extSidechain',
                'feedForward',
                'gainMatchBypass',
                'limitMode',
                'recovery',
                'scEqEnabled',
                'scHpfEnabled',
                'scLpfEnabled',
                'stereoMode',
                'style',
                'thrust',
                'topology',
            ],
            bacteria: [
                'bandCount',
                'crossoverFreq1',
                'crossoverFreq2',
                'crossoverFreq3',
                'crossoverFreq4',
                'crossoverFreq5',
                'crossoverMode',
                'crossoverSlope',
                'distortionMode',
                'filterMode',
                'lfo1Shape',
                'lfo2Shape',
                'macro1',
                'macro2',
                'macro3',
                'macro4',
                'macro5',
                'macro6',
                'macro7',
                'macro8',
            ],
            grinder: [
                'bright',
                'channel',
                'cleanBlend',
                'couplingCapCharge',
                'engineMode',
                'fat',
                'gridConduction',
                'inputGain',
                'inputImpedance',
                'limiterThreshold',
                'micBlend',
                'millerCapacitance',
                'outputGain',
                'outputMix',
                'powerAmpBias',
                'tubeAge',
            ],
            // All three covered, through the `setProofParamWithPatch` switch.
            // **The old comment here was also wrong** — it said Proof's sections
            // "bind through a local `key` variable rather than a literal". They
            // bind through `onPatchChange({ key: 'limCeiling', … })`, a literal
            // the scanner was mis-reading as the id `"key"`.
            proof: [],
            yeast: ['arp_gate', 'arp_mode', 'arp_rate', 'arp_swing'],
            crust: [
                'attackAuto',
                'ceiling',
                'channelLinkRelease',
                'channelLinkTransient',
                'deltaListen',
                'gain',
                'releaseAuto',
                'satEnabled',
                'truePeak',
            ],
            // Including a `masterGain` on a shipped `max={2}` knob — #1474's
            // exact shape, uncovered, because the id is in the function name.
            'grand-boule': ['masterGain', 'soundboardSend', 'sympatheticSend'],
        });
    });

    it('counts the knobs whose parameter id it cannot read, so the gap cannot grow unseen', () => {
        // Complement of the above: elements that DO carry `min`/`max` numeric
        // bounds but bind no literal id. Every one of these is a control this
        // census is blind to. Pinned per device so a panel refactor that breaks
        // more bindings reds rather than quietly widening the blind spot.
        const perDevice = Object.fromEntries(CENSUS.unboundKnobs);
        expect(perDevice).toStrictEqual({
            'builtin-crumbs': 0,
            'dutch-oven': 0,
            'native-scoring': 0,
            fermenter: 8,
            // Zero, not twelve: the four kit knobs now bind. The old twelve was
            // the scanner failing, not the panel.
            toaster: 0,
            levain: 1,
            gluten: 0,
            bacteria: 1,
            grinder: 0,
            proof: 10,
            // Yeast's `ProcessorParams.tsx` renders one control per MIDI
            // processor kind from a switch, and none of them names a descriptor
            // parameter — Yeast's four declared parameters are rack-level. This
            // is the largest single blind spot in the file and it is 48 controls
            // wide.
            yeast: 48,
            crust: 2,
            'grand-boule': 10,
        });
    });

    it('states the third leg’s coverage rather than implying it', () => {
        // Not decoration: this is the assertion that keeps the file honest about
        // how much of the population is three-way. If a later lane closes one of
        // these shapes — most usefully the Crumbs enum-variant join — this list
        // shrinks and the test reds, which is the prompt to come back and say so.
        expect(ENGINE_CLAMP_COVERAGE.notDerivable.length).toBe(7);
    });
});
