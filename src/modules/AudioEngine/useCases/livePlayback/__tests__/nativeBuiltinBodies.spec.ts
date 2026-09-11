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
import { isLatencyCompensatedByEngine } from '../isLatencyCompensatedByEngine';
import { BUILTIN_PARAM_NAME_SHAPE, nativeBuiltinBody, type NativeBuiltinBody } from '../nativeBuiltinBodies';

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

/** `FermenterPatch['macros']` (`#/modules/Fermenter/models`) is an 8-slot tuple. */
const FERMENTER_MACRO_COUNT = 8;

describe('nativeBuiltinBody', () => {
    it('answers for every type the engine registers, and for nothing else', () => {
        expect(nativeBuiltinBody('knead')).not.toBeNull();
        expect(nativeBuiltinBody('fermenter')).not.toBeNull();
        expect(nativeBuiltinBody('grand-boule')).not.toBeNull();
        expect(nativeBuiltinBody('gluten')).not.toBeNull();
        expect(nativeBuiltinBody('crust')).not.toBeNull();
        expect(nativeBuiltinBody('grinder')).not.toBeNull();
        expect(nativeBuiltinBody('bacteria')).not.toBeNull();
        expect(nativeBuiltinBody('proof')).not.toBeNull();
        expect(nativeBuiltinBody('builtin-eq')).toBeNull();
        expect(nativeBuiltinBody('external-plugin')).toBeNull();
    });

    // The mapper case-folds a device type before resolving it, because the same
    // body is spelled as a display name as often as a key on the web side.
    it('resolves a type spelled as a display name, the way the mapper folds it', () => {
        expect(nativeBuiltinBody('Fermenter')).toBe(nativeBuiltinBody('fermenter'));
        expect(nativeBuiltinBody('Bacteria')).toBe(nativeBuiltinBody('bacteria'));
    });

    // Mirrors `BuiltinEffectType::sounds_notes`, which is what decides whether
    // the engine gives the body a note store.
    it('states which bodies sound notes', () => {
        expect(bodyOf('fermenter').soundsNotes).toBe(true);
        expect(bodyOf('grand-boule').soundsNotes).toBe(true);
        expect(bodyOf('knead').soundsNotes).toBe(false);
        expect(bodyOf('gluten').soundsNotes).toBe(false);
        expect(bodyOf('crust').soundsNotes).toBe(false);
        expect(bodyOf('grinder').soundsNotes).toBe(false);
        expect(bodyOf('bacteria').soundsNotes).toBe(false);
        expect(bodyOf('proof').soundsNotes).toBe(false);
    });

    // Mirrors `PluginCore::declared_latency_frames`, which is what decides
    // whether the mapper publishes a latency for the body at registration.
    // Every entry answers, because a body that declares a figure and is left
    // counted on this side too is compensated twice.
    it('states which bodies the engine compensates for itself', () => {
        expect(bodyOf('bacteria').latencyCompensatedByEngine).toBe(true);
        expect(bodyOf('proof').latencyCompensatedByEngine).toBe(true);
        expect(bodyOf('knead').latencyCompensatedByEngine).toBe(false);
        expect(bodyOf('fermenter').latencyCompensatedByEngine).toBe(false);
        expect(bodyOf('grand-boule').latencyCompensatedByEngine).toBe(false);
        expect(bodyOf('gluten').latencyCompensatedByEngine).toBe(false);
        expect(bodyOf('crust').latencyCompensatedByEngine).toBe(false);
        expect(bodyOf('grinder').latencyCompensatedByEngine).toBe(false);
    });

    // A device type with no native body is nothing the engine could be
    // compensating, and the predicate is read on project device types — which
    // include `external-plugin` and every Web Audio-only built-in.
    it('answers the compensation question for a type with no native body', () => {
        expect(isLatencyCompensatedByEngine('bacteria')).toBe(true);
        expect(isLatencyCompensatedByEngine('Bacteria')).toBe(true);
        expect(isLatencyCompensatedByEngine('external-plugin')).toBe(false);
        expect(isLatencyCompensatedByEngine('builtin-eq')).toBe(false);
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
            expect(bodyOf('fermenter').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME_SHAPE);
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
            expect(bodyOf('grand-boule').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME_SHAPE);
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
            expect(bodyOf('gluten').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME_SHAPE);
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
            expect(bodyOf('crust').parameterName(paramId)).toMatch(BUILTIN_PARAM_NAME_SHAPE);
        }
        expect(bodyOf('crust').addressesParameter('attack_auto')).toBe(false);
        expect(bodyOf('crust').addressesParameter('bogus')).toBe(false);
    });
});

/**
 * Grinder carries no translation table: its engine spells its own parameters
 * in camelCase (`crates/daw-dsp/src/grinder/engine.rs`), and project truth
 * authors the same camelCase ids for them, so a project id already is the
 * engine's own name. What this body resolves is therefore a question of wire
 * shape alone, the same `BUILTIN_PARAM_NAME_SHAPE` every other body's
 * translated output is held to above — never a closed list, because the
 * engine's own vocabulary already reaches past a fixed set into the
 * dynamically named `neuralCustomConvWeight{layer}_{idx}` family
 * (`crates/daw-dsp/src/grinder/neural.rs`).
 */
describe('the grinder body', () => {
    it('keeps the names the project already stores, because the engine answers to those names', () => {
        expect(bodyOf('grinder').parameterName('inputGain')).toBe('inputGain');
        expect(bodyOf('grinder').projectPatch({ inputGain: 3, gain: 8 })).toEqual({
            inputGain: 3,
            gain: 8,
        });
    });

    // The wire narrows every value to an `f32`, and shape is the whole of what
    // the carrier refuses by: a non-number has no value to send, and a key a
    // hyphen or a space breaks the shape would refuse the whole batch if it
    // reached the wire, so both are dropped here first.
    it('drops an entry the wire has no number to send, or a key shaped unlike any built-in name', () => {
        expect(
            bodyOf('grinder').projectPatch({
                inputGain: 3,
                presetName: 'Bright Lead',
                'not-a-name': 1,
            })
        ).toEqual({ inputGain: 3 });
    });

    // The engine's own vocabulary reaches past the fixed automatable slots
    // into a dynamically named family the renderer cannot enumerate, so
    // admission is the shape check alone — never a closed list the way the
    // other bodies' translation tables are.
    it('admits a well-shaped id whether it is a fixed slot or a dynamically named one', () => {
        expect(bodyOf('grinder').addressesParameter('inputGain')).toBe(true);
        expect(bodyOf('grinder').addressesParameter('neuralCustomConvWeight3_2')).toBe(true);
    });

    // A key no built-in's vocabulary could ever spell refuses by shape,
    // exactly as `BuiltinParamName::parse` refuses it on the Rust side.
    it('refuses a key shaped unlike any built-in name', () => {
        expect(bodyOf('grinder').addressesParameter('auto-makeup')).toBe(false);
        expect(bodyOf('grinder').addressesParameter('not a name')).toBe(false);
        expect(bodyOf('grinder').addressesParameter('')).toBe(false);
    });

    // Persistence only adds keys and never removes one, so a record that once
    // selected a factory voice can still carry an imported profile's
    // `neuralCustom*` keys beside `neuralModelSlot`. `neuralModelMode` says
    // which source is live, and the projection has to drop the other source's
    // keys rather than forward both — the native engine rewrites every layer
    // and scalar from `neuralModelSlot` whatever order it lands in, so a
    // stale slot next to an imported profile would render the factory voice.
    it("keeps only the imported profile's keys when neuralModelMode selects the imported source", () => {
        expect(
            bodyOf('grinder').projectPatch({
                gain: 5,
                neuralModelSlot: 1,
                neuralCustomTier: 1,
                neuralCustomConvWeight0_0: 0.1,
                neuralModelMode: 1,
            })
        ).toEqual({
            gain: 5,
            neuralCustomTier: 1,
            neuralCustomConvWeight0_0: 0.1,
            neuralModelMode: 1,
        });
    });

    // The mirror case: a built-in voice record with stale `neuralCustom*`
    // keys from a profile that was once imported. Harmless only because the
    // engine happens to apply the slot last — a fixed apply order cannot
    // serve both records, so the projection drops the custom keys instead.
    it('keeps only the built-in slot when neuralModelMode selects the built-in source', () => {
        expect(
            bodyOf('grinder').projectPatch({
                gain: 5,
                neuralModelSlot: 1,
                neuralCustomTier: 1,
                neuralCustomConvWeight0_0: 0.1,
                neuralModelMode: 0,
            })
        ).toEqual({
            gain: 5,
            neuralModelSlot: 1,
            neuralModelMode: 0,
        });
    });

    // A record from before `neuralModelMode` existed has no mode key at all;
    // missing means built-in, the same as an explicit 0.
    it('treats a missing neuralModelMode as the built-in source', () => {
        expect(
            bodyOf('grinder').projectPatch({
                neuralModelSlot: 2,
                neuralCustomInputDrive: 1.2,
            })
        ).toEqual({ neuralModelSlot: 2 });
    });

    // The live `updateDevicePatch` door sends the worklet's structured patch,
    // which has no numeric keys at all, so it still projects to nothing.
    it('still projects a structured patch to nothing', () => {
        expect(
            bodyOf('grinder').projectPatch({
                neuralModelMode: 'imported',
                profile: { inputDrive: 1 },
            })
        ).toEqual({});
    });
});

/**
 * Bacteria's vocabulary is welded by shape rather than by a table, like
 * Grinder's above: project truth authors the engine's own camelCase ids, and
 * the engine's two addressing families — a `band{N}_` prefix aiming a name at
 * one band, and `stepSeqVal_{n}` indexing a sequencer step — live inside the
 * shape rule rather than beside it, so there is no closed list to hold the
 * translation to.
 *
 * What is its own is the refusal: two of the engine's arms allocate, so the
 * native audio-thread door drops those names
 * (`BACTERIA_CONTROL_THREAD_ONLY`, `crates/daw-engine/src/scheduler.rs`). This
 * is what `addressesParameter` answers, which is what gates an *automation*
 * write off the native route entirely (`readLiveAutomationWrites.ts`); a
 * panel write does not consult this answer and reaches the native door
 * regardless, where the same refusal drops it on the Rust side instead.
 */
describe('the bacteria body', () => {
    it('keeps the names the project already stores, because the engine answers to those names', () => {
        expect(bodyOf('bacteria').parameterName('band3_filterCutoff')).toBe('band3_filterCutoff');
        expect(
            bodyOf('bacteria').projectPatch({
                band3_filterCutoff: 1200,
                crossoverFreq2: 800,
                stepSeqVal_31: 0.25,
                macro8: 0.5,
            })
        ).toEqual({
            band3_filterCutoff: 1200,
            crossoverFreq2: 800,
            stepSeqVal_31: 0.25,
            macro8: 0.5,
        });
    });

    // The wire narrows every value to an `f32`, and shape is the whole of what
    // the carrier refuses by: a non-number has no value to send, and a key a
    // hyphen or a space breaks the shape would refuse the whole batch if it
    // reached the wire, so both are dropped here first.
    it('drops an entry the wire has no number to send, or a key shaped unlike any built-in name', () => {
        expect(
            bodyOf('bacteria').projectPatch({
                band0_drive: 8,
                presetName: 'Rot',
                'not-a-name': 1,
            })
        ).toEqual({ band0_drive: 8 });
    });

    // The engine's vocabulary reaches past the fixed automatable slots into
    // two dynamically named families the renderer cannot enumerate, so
    // admission is the shape check — with the allocating pair taken back out.
    it('admits a well-shaped id, band-prefixed or not', () => {
        expect(bodyOf('bacteria').addressesParameter('band0_convolutionSeparation')).toBe(true);
        expect(bodyOf('bacteria').addressesParameter('stepSeqVal_31')).toBe(true);
        expect(bodyOf('bacteria').addressesParameter('bandCount')).toBe(true);
    });

    // A live single-key write of either allocating name is refused by this
    // gate, because the native door drops it: reporting it as carried would
    // leave the write nowhere at all. Both spellings the engine reaches the
    // stage by are refused — a bare name is broadcast to all six bands, and a
    // `band{N}_` prefix aims it at one.
    it('refuses the two names whose engine arms allocate, bare or band-prefixed', () => {
        expect(bodyOf('bacteria').addressesParameter('phaserStages')).toBe(false);
        expect(bodyOf('bacteria').addressesParameter('band0_phaserStages')).toBe(false);
        expect(bodyOf('bacteria').addressesParameter('convolutionIr')).toBe(false);
        expect(bodyOf('bacteria').addressesParameter('band5_convolutionIr')).toBe(false);
        // Any digit, not only the six bands that exist: the engine strips the
        // prefix first and bounds-checks the band afterwards, and the Rust
        // door reads it the same way.
        expect(bodyOf('bacteria').addressesParameter('band9_phaserStages')).toBe(false);
        // The sixth character is never read by the engine, only skipped, so a
        // refusal that required the historical `_` there would miss these:
        // `apply_param` reads both as band 0's `convolutionIr` and
        // `phaserStages` all the same.
        expect(bodyOf('bacteria').addressesParameter('band00convolutionIr')).toBe(false);
        expect(bodyOf('bacteria').addressesParameter('band0XphaserStages')).toBe(false);
    });

    // A near-miss of the refusal, so the prefix strip is pinned as the engine's
    // own reading rather than as a substring match: `phaserStagesTrim` is not
    // the refused name, and `band9_` is not a band the engine addresses.
    // `bandCount` and `band0_phaserStagesTrim` stay admitted too — neither is
    // a `band{digit}` prefix followed by one of the two allocating names, so
    // reading the prefix as loosely as the engine does must not sweep them in.
    it('refuses only the allocating names themselves', () => {
        expect(bodyOf('bacteria').addressesParameter('phaserStagesTrim')).toBe(true);
        expect(bodyOf('bacteria').addressesParameter('band0_phaserRate')).toBe(true);
        expect(bodyOf('bacteria').addressesParameter('bandCount')).toBe(true);
        expect(bodyOf('bacteria').addressesParameter('band0_phaserStagesTrim')).toBe(true);
    });

    // A key no built-in's vocabulary could ever spell refuses by shape,
    // exactly as `BuiltinParamName::parse` refuses it on the Rust side.
    it('refuses a key shaped unlike any built-in name', () => {
        expect(bodyOf('bacteria').addressesParameter('crossover-slope')).toBe(false);
        expect(bodyOf('bacteria').addressesParameter('not a name')).toBe(false);
        expect(bodyOf('bacteria').addressesParameter('')).toBe(false);
    });
});

describe('the proof body', () => {
    // The chain spells its own parameters in snake_case and project truth
    // authors the same ids, so there is no table to consult — the id a panel
    // writes already is the name `ProofChain::set_param` takes.
    it('keeps the names the project already stores, because the chain answers to those names', () => {
        expect(bodyOf('proof').parameterName('lim_ceiling')).toBe('lim_ceiling');
        expect(bodyOf('proof').projectPatch({ lim_ceiling: -0.3 })).toEqual({ lim_ceiling: -0.3 });
    });

    // The five order keys are what no `SetParam` behind the record could stand
    // in for: `ProofChain` has no arm for them at all, and `ProofBody` is what
    // turns them into the chain's own `reorder`. A record that dropped them
    // would open every saved project at the factory module order.
    it('carries the module order the record spells', () => {
        expect(
            bodyOf('proof').projectPatch({
                chain_order_0: 4,
                chain_order_1: 0,
                chain_order_2: 1,
                chain_order_3: 2,
                chain_order_4: 3,
            })
        ).toEqual({ chain_order_0: 4, chain_order_1: 0, chain_order_2: 1, chain_order_3: 2, chain_order_4: 3 });
    });

    // The wire narrows every value to an `f32`, and shape is the whole of what
    // the carrier refuses by: a non-number has no value to send, and a key a
    // hyphen or a space breaks the shape would refuse the whole batch if it
    // reached the wire, so both are dropped here first.
    it('drops an entry the wire has no number to send, or a key shaped unlike any built-in name', () => {
        expect(
            bodyOf('proof').projectPatch({
                lim_ceiling: -0.3,
                presetName: 'Loud',
                'not-a-name': 1,
            })
        ).toEqual({ lim_ceiling: -0.3 });
    });

    // The record is the mapper's, and the mapper reads a device's bypass from
    // the record's own `bypassed` field. The graph-owned name travels with it
    // all the same rather than being filtered here: `ProofBody::load_patch`
    // routes the record through the same door the audio thread uses, which is
    // where it is dropped, so no second rule is needed on this side.
    it('leaves the graph-owned name in the record for the body to drop', () => {
        expect(bodyOf('proof').projectPatch({ bypass: 1, ab_bypass: 1, lim_ceiling: -0.3 })).toEqual({
            bypass: 1,
            ab_bypass: 1,
            lim_ceiling: -0.3,
        });
    });

    // The chain's vocabulary is eight EQ bands, four dynamics bands, four
    // exciter bands, the imager, the limiter and the ditherer, each addressed
    // by a stage prefix the chain decodes itself, so admission is the shape
    // check — with the one name the graph owns taken back out.
    it('admits a well-shaped id, whichever stage it is prefixed for', () => {
        expect(bodyOf('proof').addressesParameter('eq_band0_gain')).toBe(true);
        expect(bodyOf('proof').addressesParameter('dyn_band2_ratio')).toBe(true);
        expect(bodyOf('proof').addressesParameter('img_width1')).toBe(true);
        expect(bodyOf('proof').addressesParameter('lim_lookahead')).toBe(true);
        expect(bodyOf('proof').addressesParameter('dither_bits')).toBe(true);
        expect(bodyOf('proof').addressesParameter('chain_order_3')).toBe(true);
    });

    // A live single-key write of the graph-owned name is refused by this gate,
    // because the native door drops it: reporting it as carried would leave the
    // write nowhere at all. The device's bypass is the graph's own command.
    it('refuses the one name the graph owns', () => {
        expect(bodyOf('proof').addressesParameter('bypass')).toBe(false);
    });

    // The panel's A/B compare returns the gain-matched dry signal from the head
    // of the chain, and the native body runs that arm, so a compare pressed
    // while the session rolls natively has to reach the carrier that is
    // sounding. Runtime-only in the project is about persistence, not about
    // which carrier hears it.
    it('addresses the A/B compare so a natively carried chain hears it', () => {
        expect(bodyOf('proof').addressesParameter('ab_bypass')).toBe(true);
    });

    // A near-miss of the refusal, so the name is pinned as itself rather than
    // as a substring match: it is neither a prefix nor a suffix of a chain name
    // the body must keep addressing.
    it('refuses only the graph-owned name itself', () => {
        expect(bodyOf('proof').addressesParameter('bypassed')).toBe(true);
        expect(bodyOf('proof').addressesParameter('dyn_bypass')).toBe(true);
    });

    // A key no built-in's vocabulary could ever spell refuses by shape,
    // exactly as `BuiltinParamName::parse` refuses it on the Rust side.
    it('refuses a key shaped unlike any built-in name', () => {
        expect(bodyOf('proof').addressesParameter('chain-order-0')).toBe(false);
        expect(bodyOf('proof').addressesParameter('not a name')).toBe(false);
        expect(bodyOf('proof').addressesParameter('')).toBe(false);
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
