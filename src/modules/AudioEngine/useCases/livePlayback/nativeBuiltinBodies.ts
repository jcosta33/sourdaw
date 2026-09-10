/**
 * The built-in device types `daw-engine` builds a body for, and the vocabulary
 * each body answers to (#3893).
 *
 * The engine's own registry is `BuiltinEffectType` in
 * `crates/daw-engine/src/scheduler.rs`, and the mapper resolves a device type
 * through it rather than through a list of its own, so the vocabulary the
 * engine can build and the vocabulary the mapper admits are one fact. This is
 * the renderer's mirror of that fact, and it has to stay one too: a type listed
 * here that `BuiltinEffectType::from_name` does not know makes the carrier law
 * promise a strip the mapper then refuses by name (`no_native_body`), taking
 * the whole batch with it; a type the engine builds and this file omits leaves
 * that strip on Web Audio for a body the engine was ready to run. Matched
 * lowercase because the mapper case-folds — a project's device type is authored
 * on the web side, where the same body is spelled as a display name as often as
 * a key.
 *
 * The vocabulary matters as much as the admission. A built-in's parameters
 * reach the engine as the *instrument's* names, while project truth stores the
 * ids a panel and an automation lane author, and the two are spelled
 * differently on purpose for a Fermenter. Naming the translation per body here
 * keeps every producer that sends a chain — the live topology, the mid-roll
 * splice, a live write — speaking one vocabulary rather than each carrying its
 * own guess at it.
 *
 * The registry now also states which project-side ids a body resolves at all.
 * The descriptor law (`isDeviceParameterAutomatable`) fails open on a name the
 * descriptor never declares — Knead's own descriptor declares no parameters,
 * so that law alone admits every id a lane can spell — and the engine refuses
 * the whole `write-device-parameter` batch on one name it cannot resolve
 * (`DeviceParam::from_name`, `crates/daw-engine/src/timeline.rs`). A caller
 * deciding whether to admit a lane needs both: the declared law, and this
 * file's own answer for what the body actually addresses.
 */

import {
    FERMENTER_PARAMS,
    mapFermenterParamToDspParam,
    mapFermenterPatchToDspPatch,
} from '#/modules/Fermenter/useCases';

import { mapCrustParamToDspParam } from '../../models/CrustDspParamNames';
import { mapGlutenParamToDspParam } from '../../models/GlutenDspParamNames';
import { mapGrandBouleParamToDspParam } from '../../models/GrandBouleDspParamNames';

export type NativeBuiltinBody = Readonly<{
    /** Whether the engine registers a note store for this body (mirror of `BuiltinEffectType::sounds_notes`). */
    soundsNotes: boolean;
    /** The engine's name for one of this body's parameters, from the id a panel or lane authors. */
    parameterName: (paramId: string) => string;
    /** The engine's flat record for this body's patch, from project truth's `parameterValues`. */
    projectPatch: (parameterValues: Readonly<Record<string, unknown>>) => Readonly<Record<string, number>>;
    /** Whether this body resolves a project-side parameter id at all — the renderer's mirror of `builtin_parameter` in `crates/daw-engine/src/graph.rs`. */
    addressesParameter: (paramId: string) => boolean;
}>;

/**
 * A body whose parameter ids are already the engine's names keeps them, and
 * carries only what the engine can apply: anything but a number has no value
 * the wire could narrow to an `f32`.
 */
function numericParametersOnly(parameterValues: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> {
    return Object.fromEntries(
        Object.entries(parameterValues).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    );
}

/** `DeviceParam::from_name` in `crates/daw-engine/src/timeline.rs`: the closed set of names Knead's body resolves. */
const KNEAD_ENGINE_PARAM_NAMES: ReadonlySet<string> = new Set([
    'shift_semitones',
    'retune_speed_ms',
    'formant_preserve',
]);

/**
 * The ids `FERMENTER_PARAMS` authors. Macro slots (`macro0`..`macro7`) are
 * deliberately excluded: project truth stores them as one `macros` array, not
 * as individually keyed `parameterValues` entries, so no lane parameter id
 * ever resolves to one.
 */
const FERMENTER_PARAM_IDS: ReadonlySet<string> = new Set(FERMENTER_PARAMS.map((param) => param.id));

/**
 * One body's patch, in the engine's own vocabulary, from a table that answers
 * `null` for an id the body does not address.
 *
 * Project truth's `parameterValues` for a device is an open record — a preset
 * name, a morph state, anything a panel has ever persisted there — so an entry
 * the body does not address is dropped rather than forwarded. Forwarding one
 * would cost the whole batch: `builtin_named_parameter`
 * (`crates/sourdaw-native/src/commands/graph.rs`) refuses a key carrying an
 * uppercase letter, and one refused key fails the entire chain mapping.
 */
function tablePatch(
    engineName: (input: { paramId: string }) => string | null
): (parameterValues: Readonly<Record<string, unknown>>) => Readonly<Record<string, number>> {
    return (parameterValues) => {
        const patch: Record<string, number> = {};
        for (const [paramId, value] of Object.entries(parameterValues)) {
            const name = engineName({ paramId });
            if (name !== null && typeof value === 'number') {
                patch[name] = value;
            }
        }
        return patch;
    };
}

const NATIVE_BUILTIN_BODIES = new Map<string, NativeBuiltinBody>([
    [
        'knead',
        {
            soundsNotes: false,
            parameterName: (paramId) => paramId,
            projectPatch: numericParametersOnly,
            addressesParameter: (paramId) => KNEAD_ENGINE_PARAM_NAMES.has(paramId),
        },
    ],
    [
        'fermenter',
        {
            soundsNotes: true,
            parameterName: (paramId) => mapFermenterParamToDspParam({ paramId }),
            projectPatch: (parameterValues) => mapFermenterPatchToDspPatch({ patch: parameterValues }),
            addressesParameter: (paramId) => FERMENTER_PARAM_IDS.has(paramId),
        },
    ],
    [
        'grand-boule',
        {
            soundsNotes: true,
            /**
             * The fallback is unreachable for anything a lane or a panel can
             * spell: `descriptorEngineParamWeld.spec.ts` pins every
             * `GRAND_BOULE_DESCRIPTOR` parameter id to an entry in this table,
             * and `readLiveAutomationWrites` gates on `addressesParameter`
             * before it asks for a name.
             */
            parameterName: (paramId) => mapGrandBouleParamToDspParam({ paramId }) ?? paramId,
            projectPatch: tablePatch(mapGrandBouleParamToDspParam),
            addressesParameter: (paramId) => mapGrandBouleParamToDspParam({ paramId }) !== null,
        },
    ],
    [
        'gluten',
        {
            soundsNotes: false,
            /**
             * The fallback is unreachable for anything a lane or a panel can
             * spell: `descriptorEngineParamWeld.spec.ts` pins every
             * `GLUTEN_DESCRIPTOR` parameter id to an entry in this table, and
             * `readLiveAutomationWrites` gates on `addressesParameter` before
             * it asks for a name.
             */
            parameterName: (paramId) => mapGlutenParamToDspParam({ paramId }) ?? paramId,
            projectPatch: tablePatch(mapGlutenParamToDspParam),
            addressesParameter: (paramId) => mapGlutenParamToDspParam({ paramId }) !== null,
        },
    ],
    [
        'crust',
        {
            soundsNotes: false,
            /**
             * The fallback is unreachable for anything a lane or a panel can
             * spell: `descriptorEngineParamWeld.spec.ts` pins every
             * `CRUST_DESCRIPTOR` parameter id to an entry in this table, and
             * `readLiveAutomationWrites` gates on `addressesParameter` before
             * it asks for a name.
             */
            parameterName: (paramId) => mapCrustParamToDspParam({ paramId }) ?? paramId,
            projectPatch: tablePatch(mapCrustParamToDspParam),
            addressesParameter: (paramId) => mapCrustParamToDspParam({ paramId }) !== null,
        },
    ],
]);

export function nativeBuiltinBody(deviceType: string): NativeBuiltinBody | null {
    return NATIVE_BUILTIN_BODIES.get(deviceType.toLowerCase()) ?? null;
}
