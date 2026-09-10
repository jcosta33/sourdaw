/**
 * The renderer's mirror of the built-in bodies `daw-engine` builds (#3893).
 *
 * Two facts are under test and both are mirrors of something on the Rust side,
 * which is exactly why they need pinning here: what the engine will build a
 * body for, and what one record of a body's parameters may say. A mirror that
 * drifts is not caught by either side alone — the engine refuses a batch it
 * finds unrepresentable, and the renderer never learns it promised one.
 *
 * The registry is pure, so nothing is mocked. The Fermenter vocabulary is the
 * module's own, read through its published translation rather than restated.
 * The Knead vocabulary is welded the same way, below, against the Rust arms
 * themselves rather than against a hand-copied list that could drift from
 * them without either side noticing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FERMENTER_PARAMS, getFermenterFactoryPresets } from '#/modules/Fermenter/useCases';

import { MAX_IMMEDIATE_DEVICE_PARAMETERS } from '../../../models/AudioGraphBackend';
import { CRUST_DSP_PARAM_NAMES } from '../../../models/CrustDspParamNames';
import { GLUTEN_DSP_PARAM_NAMES } from '../../../models/GlutenDspParamNames';
import { GRAND_BOULE_DSP_PARAM_NAMES } from '../../../models/GrandBouleDspParamNames';
import { nativeBuiltinBody, type NativeBuiltinBody } from '../nativeBuiltinBodies';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

/** Strip line and block comments so brace matching does not see prose. */
function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/\/\/[^\n]*/g, ' ');
}

/**
 * The braced block starting at `openIndex`, skipping string literals so a
 * quoted brace inside the block cannot close it early.
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

/**
 * Every string-literal match arm inside `DeviceParam::from_name`
 * (`crates/daw-engine/src/timeline.rs`) — the closed set of names Knead's
 * body resolves. Read from the Rust source itself rather than restated, so a
 * new or removed arm on the Rust side moves this set without an edit here.
 */
function readKneadEngineArmsFromRust(): readonly string[] {
    const source = stripComments(readFileSync(resolve(REPO_ROOT, 'crates/daw-engine/src/timeline.rs'), 'utf8'));
    const signature = /\bfn\s+from_name\s*\(/;
    const signatureMatch = signature.exec(source);
    if (signatureMatch === null) {
        throw new Error("could not find 'fn from_name' in crates/daw-engine/src/timeline.rs");
    }
    const openIndex = source.indexOf('{', signatureMatch.index + signatureMatch[0].length);
    const body = readBalancedBlock(source, openIndex).replaceAll(/\s+/g, ' ');
    const arm = /"([\w-]+)"(?=(?: \| "[\w-]+")* =>)/g;
    return [...body.matchAll(arm)].map((match) => match[1]!);
}

/** The registry entry under test, with the `null` case already refused. */
function bodyOf(deviceType: string): NativeBuiltinBody {
    const body = nativeBuiltinBody(deviceType);
    if (!body) {
        throw new Error(`no native built-in body for '${deviceType}'`);
    }
    return body;
}

/**
 * `BuiltinParamName::parse` in `crates/daw-engine/src/timeline.rs`: one to
 * `BUILTIN_PARAM_NAME_CAPACITY` bytes of lowercase ASCII letters, digits and
 * underscores. A name outside it is refused by shape, taking its batch with it.
 * The carrier is body-neutral, so it is the shape every named built-in's
 * vocabulary has to satisfy — the Fermenter's and Grand Boule's alike.
 */
const BUILTIN_PARAM_NAME = /^[a-z0-9_]{1,32}$/;

/** `FermenterPatch['macros']` (`#/modules/Fermenter/models`) is an 8-slot tuple. */
const FERMENTER_MACRO_COUNT = 8;

describe('nativeBuiltinBody', () => {
    it('answers for every type the engine registers, and for nothing else', () => {
        expect(nativeBuiltinBody('knead')).not.toBeNull();
        expect(nativeBuiltinBody('fermenter')).not.toBeNull();
        expect(nativeBuiltinBody('grand-boule')).not.toBeNull();
        expect(nativeBuiltinBody('gluten')).not.toBeNull();
        expect(nativeBuiltinBody('crust')).not.toBeNull();
        expect(nativeBuiltinBody('builtin-eq')).toBeNull();
        expect(nativeBuiltinBody('external-plugin')).toBeNull();
    });

    // The mapper case-folds a device type before resolving it, because the same
    // body is spelled as a display name as often as a key on the web side.
    it('resolves a type spelled as a display name, the way the mapper folds it', () => {
        expect(nativeBuiltinBody('Fermenter')).toBe(nativeBuiltinBody('fermenter'));
    });

    // Mirrors `BuiltinEffectType::sounds_notes`, which is what decides whether
    // the engine gives the body a note store.
    it('states which bodies sound notes', () => {
        expect(bodyOf('fermenter').soundsNotes).toBe(true);
        expect(bodyOf('grand-boule').soundsNotes).toBe(true);
        expect(bodyOf('knead').soundsNotes).toBe(false);
        expect(bodyOf('gluten').soundsNotes).toBe(false);
        expect(bodyOf('crust').soundsNotes).toBe(false);
    });
});

describe('the fermenter body', () => {
    it('expands the macro slots the patch carries as an array into one name each', () => {
        expect(bodyOf('fermenter').projectPatch({ macros: [0.5, 0.25] })).toEqual({ macro0: 0.5, macro1: 0.25 });
    });

    // The wire narrows every value to an `f32`, so anything that is not a
    // number is a key the engine could only refuse.
    it('drops an entry the wire has no number to send', () => {
        expect(bodyOf('fermenter').projectPatch({ oscEngine: 2, name: 'Lead' })).toEqual({ engine: 2 });
    });

    // A full patch is one gesture and travels as one record, so the whole
    // vocabulary a panel can author has to fit inside one record's ceiling.
    it('spells the whole authored vocabulary inside one record', () => {
        const names = FERMENTER_PARAMS.map((param) => bodyOf('fermenter').parameterName(param.id));

        expect(new Set(names).size).toBeLessThanOrEqual(MAX_IMMEDIATE_DEVICE_PARAMETERS);
    });

    // Every id the projection can emit, not only the authored ones: a patch's
    // `macros` array expands into `macro0`..`macro7` too (FermenterPatch's
    // macro tuple is 8 slots wide), and those names travel the same wire.
    it('spells every id the projection can emit as a name the engine can parse', () => {
        const macroIds = Array.from({ length: FERMENTER_MACRO_COUNT }, (_, index) => `macro${index}`);
        for (const paramId of [...FERMENTER_PARAMS.map((param) => param.id), ...macroIds]) {
            expect(bodyOf('fermenter').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME);
        }
    });

    // The factory presets are the largest patches the product ships, so they
    // are the evidence that the ceiling holds against real material rather
    // than against a vocabulary nobody loads whole.
    it('projects every factory preset into one record the engine will take', () => {
        const devices = getFermenterFactoryPresets().flatMap((preset) => preset.devices);

        expect(devices.length).toBeGreaterThan(0);
        for (const device of devices) {
            const projected = bodyOf('fermenter').projectPatch(device.parameterValues);
            expect(Object.keys(projected).length).toBeLessThanOrEqual(MAX_IMMEDIATE_DEVICE_PARAMETERS);
        }
    });

    // Every authored id resolves; a macro slot does not, because project truth
    // stores the eight slots as one `macros` array rather than as individually
    // keyed `parameterValues` entries, so no lane parameter id ever spells one.
    it('resolves every authored id, and refuses a macro slot or an unknown id', () => {
        for (const param of FERMENTER_PARAMS) {
            expect(bodyOf('fermenter').addressesParameter(param.id)).toBe(true);
        }
        expect(bodyOf('fermenter').addressesParameter('macro0')).toBe(false);
        expect(bodyOf('fermenter').addressesParameter('bogus')).toBe(false);
    });
});

/**
 * Grand Boule's vocabulary is welded in a chain rather than restated here.
 * `descriptorEngineParamWeld.spec.ts` holds every `GRAND_BOULE_DESCRIPTOR`
 * parameter id to an entry in the worklet's `PARAM_MAP`;
 * `models/__tests__/grandBouleDspParamNames.spec.ts` holds
 * `GRAND_BOULE_DSP_PARAM_NAMES` equal to that map. What is left for this file is
 * the last link: that the registry entry actually answers through that table,
 * rather than through identity or a private copy of it.
 */
describe('the grand boule body', () => {
    it('spells a project id in the instrument vocabulary the engine matches on', () => {
        expect(bodyOf('grand-boule').parameterName('masterGain')).toBe('master_gain');
        expect(bodyOf('grand-boule').projectPatch({ masterGain: 0.2, lidPosition: 1 })).toEqual({
            master_gain: 0.2,
            lid_position: 1,
        });
    });

    // Project truth's `parameterValues` is an open record — a preset name, a
    // morph state, whatever a panel has persisted there — and a key the engine
    // cannot parse fails the whole chain mapping, not just its own write.
    it('drops an entry the instrument does not address or the wire cannot send', () => {
        expect(
            bodyOf('grand-boule').projectPatch({ masterGain: 0.2, presetName: 'Concert', morphEnabled: true })
        ).toEqual({ master_gain: 0.2 });
    });

    it('spells every id in the table as a name the engine parameter carrier admits', () => {
        const paramIds = Object.keys(GRAND_BOULE_DSP_PARAM_NAMES);

        expect(paramIds.length).toBeGreaterThan(0);
        for (const paramId of paramIds) {
            expect(bodyOf('grand-boule').parameterName(paramId)).toBe(GRAND_BOULE_DSP_PARAM_NAMES[paramId]);
            expect(bodyOf('grand-boule').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME);
        }
        expect(new Set(paramIds).size).toBeLessThanOrEqual(MAX_IMMEDIATE_DEVICE_PARAMETERS);
    });

    // The instrument is addressed in camelCase and answers in snake_case, so the
    // engine's own spelling of a parameter is not a project id and must not
    // resolve — admitting it would let a lane author a name the body then hands
    // through unchanged, bypassing the table this whole chain is welded to.
    it('resolves every id in the table, and refuses the engine spelling or an unknown id', () => {
        for (const paramId of Object.keys(GRAND_BOULE_DSP_PARAM_NAMES)) {
            expect(bodyOf('grand-boule').addressesParameter(paramId)).toBe(true);
        }
        expect(bodyOf('grand-boule').addressesParameter('master_gain')).toBe(false);
        expect(bodyOf('grand-boule').addressesParameter('filterCutoff')).toBe(false);
        expect(bodyOf('grand-boule').addressesParameter('bogus')).toBe(false);
    });
});

/**
 * Gluten's vocabulary is welded in a chain, the way Grand Boule's is.
 * `descriptorEngineParamWeld.spec.ts` holds every `GLUTEN_DESCRIPTOR` parameter
 * id to an entry in `GLUTEN_DSP_PARAM_NAMES`, and
 * `models/__tests__/glutenDspParamNames.spec.ts` holds that table to the shape
 * the engine's parameter carrier admits. What is left for this file is the last
 * link: that the registry entry actually answers through that table, rather
 * than through identity or a private copy of it.
 */
describe('the gluten body', () => {
    it('spells a project id in the engine vocabulary the compressor matches on', () => {
        expect(bodyOf('gluten').parameterName('autoMakeup')).toBe('auto_makeup');
        expect(bodyOf('gluten').projectPatch({ autoMakeup: 1, scHpfFreq: 80 })).toEqual({
            auto_makeup: 1,
            sc_hpf_freq: 80,
        });
    });

    // Project truth's `parameterValues` is an open record — a preset name, a
    // panel's own view state, whatever has been persisted there — and a key the
    // engine cannot parse fails the whole chain mapping, not just its own write.
    it('drops an entry the table does not address or the wire cannot send', () => {
        expect(bodyOf('gluten').projectPatch({ mix: 0.5, presetName: 'Glue', sidechainVisible: true })).toEqual({
            mix: 0.5,
        });
    });

    // The compressor is addressed in camelCase and answers in snake_case, so
    // the engine's own spelling of a parameter is not a project id and must not
    // resolve — admitting it would let a lane author a name the body then hands
    // through unchanged, bypassing the table this whole chain is welded to.
    it('resolves every id in the table, and refuses the engine spelling or an unknown id', () => {
        const paramIds = Object.keys(GLUTEN_DSP_PARAM_NAMES);

        expect(paramIds.length).toBeGreaterThan(0);
        for (const paramId of paramIds) {
            expect(bodyOf('gluten').addressesParameter(paramId)).toBe(true);
            expect(bodyOf('gluten').parameterName(paramId)).toBe(GLUTEN_DSP_PARAM_NAMES[paramId]);
            expect(bodyOf('gluten').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME);
        }
        expect(bodyOf('gluten').addressesParameter('auto_makeup')).toBe(false);
        expect(bodyOf('gluten').addressesParameter('bogus')).toBe(false);
    });
});

/**
 * Crust's vocabulary is welded in the same chain Gluten's is.
 * `descriptorEngineParamWeld.spec.ts` holds every `CRUST_DESCRIPTOR` parameter
 * id to an entry in `CRUST_DSP_PARAM_NAMES`, and
 * `models/__tests__/crustDspParamNames.spec.ts` holds that table to the shape
 * the engine's parameter carrier admits. What is left for this file is the last
 * link: that the registry entry actually answers through that table, rather
 * than through identity or a private copy of it.
 */
describe('the crust body', () => {
    it('spells a project id in the engine vocabulary the limiter matches on', () => {
        expect(bodyOf('crust').parameterName('attackAuto')).toBe('attack_auto');
        expect(bodyOf('crust').projectPatch({ attackAuto: 1, scHpfFreq: 80 })).toEqual({
            attack_auto: 1,
            sc_hpf_freq: 80,
        });
    });

    // Project truth's `parameterValues` is an open record — a preset name, a
    // panel's own view state, whatever has been persisted there — and a key the
    // engine cannot parse fails the whole chain mapping, not just its own write.
    it('drops an entry the table does not address or the wire cannot send', () => {
        expect(bodyOf('crust').projectPatch({ ceiling: -0.3, presetName: 'Master', meterVisible: true })).toEqual({
            ceiling: -0.3,
        });
    });

    // The limiter is addressed in camelCase and answers in snake_case, so the
    // engine's own spelling of a parameter is not a project id and must not
    // resolve — admitting it would let a lane author a name the body then hands
    // through unchanged, bypassing the table this whole chain is welded to.
    it('resolves every id in the table, and refuses the engine spelling or an unknown id', () => {
        const paramIds = Object.keys(CRUST_DSP_PARAM_NAMES);

        expect(paramIds.length).toBeGreaterThan(0);
        for (const paramId of paramIds) {
            expect(bodyOf('crust').addressesParameter(paramId)).toBe(true);
            expect(bodyOf('crust').parameterName(paramId)).toBe(CRUST_DSP_PARAM_NAMES[paramId]);
            expect(bodyOf('crust').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME);
        }
        expect(bodyOf('crust').addressesParameter('attack_auto')).toBe(false);
        expect(bodyOf('crust').addressesParameter('bogus')).toBe(false);
    });
});

describe('the knead body', () => {
    it('keeps the names the project already stores, because the engine answers to those names', () => {
        expect(bodyOf('knead').parameterName('shift_semitones')).toBe('shift_semitones');
        expect(bodyOf('knead').projectPatch({ shift_semitones: 3 })).toEqual({ shift_semitones: 3 });
    });

    it('drops an entry the wire has no number to send', () => {
        expect(bodyOf('knead').projectPatch({ shift_semitones: 3, label: 'up a third' })).toEqual({
            shift_semitones: 3,
        });
    });

    // `DeviceParam::from_name` (`crates/daw-engine/src/timeline.rs`) is the
    // closed set this mirrors. Knead's own descriptor declares no parameters
    // at all, so this is the only thing that stops the descriptor law from
    // admitting any id a lane can spell for it (#3893). Welded against the
    // Rust arms themselves — a hard-coded list on either side could drift
    // without either side noticing, the way `KNEAD_ENGINE_PARAM_NAMES` and
    // `DeviceParam::from_name` could before this case read one from the other.
    it('resolves exactly the arms DeviceParam::from_name matches, and nothing else', () => {
        const engineArms = readKneadEngineArmsFromRust();
        // Presence pin: a broken extraction (a truncated body, a signature the
        // regex no longer matches) would yield an empty set, and every
        // assertion below would pass vacuously against it.
        expect(engineArms.length).toBeGreaterThan(0);

        for (const name of engineArms) {
            expect(bodyOf('knead').addressesParameter(name)).toBe(true);
        }

        // Names outside the arms the body must still refuse — including the
        // camelCase spelling of a real arm, since the wire is a snake_case
        // vocabulary and the body must not fold case to admit it.
        const probeNames = ['pitch', 'mix', 'formant', 'shiftSemitones'];
        for (const name of probeNames) {
            expect(bodyOf('knead').addressesParameter(name)).toBe(false);
        }

        // The "nothing else" direction, made mechanical rather than sampled: a
        // candidate universe of the real arms, the probe names, and every id a
        // Fermenter lane can author, filtered down to what the body actually
        // admits, must equal the arm set exactly. A name added to the body's
        // admission on either side without a matching Rust arm — or a Rust arm
        // the body stops admitting — moves this set away from `engineArms`.
        const candidateUniverse = new Set([...engineArms, ...probeNames, ...FERMENTER_PARAMS.map((param) => param.id)]);
        const admitted = [...candidateUniverse].filter((name) => bodyOf('knead').addressesParameter(name));

        expect(new Set(admitted)).toEqual(new Set(engineArms));
    });
});
