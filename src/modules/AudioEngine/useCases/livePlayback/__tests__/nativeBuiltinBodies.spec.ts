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
 */

import { describe, expect, it } from 'vitest';

import { FERMENTER_PARAMS, getFermenterFactoryPresets } from '#/modules/Fermenter/useCases';

import { MAX_IMMEDIATE_DEVICE_PARAMETERS } from '../../../models/AudioGraphBackend';
import { nativeBuiltinBody, type NativeBuiltinBody } from '../nativeBuiltinBodies';

/** The registry entry under test, with the `null` case already refused. */
function bodyOf(deviceType: string): NativeBuiltinBody {
    const body = nativeBuiltinBody(deviceType);
    if (!body) {
        throw new Error(`no native built-in body for '${deviceType}'`);
    }
    return body;
}

/**
 * `FermenterParamName::parse` in `crates/daw-engine/src/timeline.rs`: one to
 * `FERMENTER_PARAM_NAME_CAPACITY` bytes of lowercase ASCII letters, digits and
 * underscores. A name outside it is refused by shape, taking its batch with it.
 */
const FERMENTER_PARAM_NAME = /^[a-z0-9_]{1,32}$/;

/** `FermenterPatch['macros']` (`#/modules/Fermenter/models`) is an 8-slot tuple. */
const FERMENTER_MACRO_COUNT = 8;

describe('nativeBuiltinBody', () => {
    it('answers for every type the engine registers, and for nothing else', () => {
        expect(nativeBuiltinBody('knead')).not.toBeNull();
        expect(nativeBuiltinBody('fermenter')).not.toBeNull();
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
        expect(bodyOf('knead').soundsNotes).toBe(false);
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
            expect(bodyOf('fermenter').parameterName(paramId)).toMatch(FERMENTER_PARAM_NAME);
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
    // admitting any id a lane can spell for it (#3893).
    it('resolves exactly the names the engine parses, and nothing else', () => {
        expect(bodyOf('knead').addressesParameter('shift_semitones')).toBe(true);
        expect(bodyOf('knead').addressesParameter('retune_speed_ms')).toBe(true);
        expect(bodyOf('knead').addressesParameter('formant_preserve')).toBe(true);
        expect(bodyOf('knead').addressesParameter('pitch')).toBe(false);
    });
});
