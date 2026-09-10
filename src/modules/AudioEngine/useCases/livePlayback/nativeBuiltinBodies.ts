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

/**
 * The wire shape `BuiltinParamName::parse` admits
 * (`crates/daw-engine/src/timeline.rs`): 1 to `BUILTIN_PARAM_NAME_CAPACITY`
 * ASCII letters, digits and underscores. The carrier does not keep a
 * vocabulary table for any one instrument, so this is the whole of what it
 * refuses by — snake_case and camelCase both parse, because Fermenter spells
 * one and Grinder spells the other.
 */
export const BUILTIN_PARAM_NAME_SHAPE = /^[A-Za-z0-9_]{1,32}$/;

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

/**
 * Mirrors [numericParametersOnly] for a body with no translation table of its
 * own: Grinder's project-side parameter ids already are the engine's own
 * camelCase names, so there is nothing to look up, only the wire shape to
 * hold every entry to before it reaches a batch a single ill-shaped key would
 * refuse whole.
 */
function shapedNumericParametersOnly(
    parameterValues: Readonly<Record<string, unknown>>
): Readonly<Record<string, number>> {
    return Object.fromEntries(
        Object.entries(parameterValues).filter(
            (entry): entry is [string, number] =>
                typeof entry[1] === 'number' && BUILTIN_PARAM_NAME_SHAPE.test(entry[0])
        )
    );
}

/**
 * Mirrors [shapedNumericParametersOnly] for Grinder's own persisted split
 * between a factory voice and an imported neural capture: persistence only
 * adds keys and never removes one, so a record that once selected a factory
 * voice can still carry an imported profile's `neuralCustom*` keys beside
 * `neuralModelSlot`, or the reverse. `NeuralCapture::load_builtin_model`
 * rewrites every layer and scalar whenever `neuralModelSlot` reaches it,
 * whatever order it lands in among the record's other keys, so the record's
 * own `neuralModelMode` — greater than 0.5 selects the imported profile,
 * missing or not selects the built-in slot — has to pick which source
 * travels, because the worklet's structured patch applies only one source at
 * a time.
 */
function grinderNeuralSourceOnly(patch: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> {
    const shaped = shapedNumericParametersOnly(patch);
    const importedIsLive = (shaped.neuralModelMode ?? 0) > 0.5;
    return Object.fromEntries(
        Object.entries(shaped).filter(([key]) =>
            importedIsLive ? key !== 'neuralModelSlot' : !key.startsWith('neuralCustom')
        )
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
 * (`crates/sourdaw-native/src/commands/graph.rs`) refuses a key shaped unlike
 * any built-in's vocabulary — a space, a hyphen, one past the wire's buffer —
 * and one refused key fails the entire chain mapping.
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

/**
 * The Bacteria parameter names whose engine arms allocate, and which the
 * native audio-thread door therefore drops.
 *
 * `BACTERIA_CONTROL_THREAD_ONLY` in `crates/daw-engine/src/scheduler.rs` is
 * the same pair, and that constant carries the reason: `convolutionIr`
 * rebuilds the cabinet impulse response and `phaserStages` reallocates both
 * all-pass chains past the six the constructor builds. A persisted record
 * still carries them — the mapper applies a device's whole record on the
 * control thread, where those arms are allowed to run — so they stay in
 * [projectPatch].
 *
 * A live single-key write is not refused the same way for every producer.
 * [addressesParameter] is what `readLiveAutomationWrites` gates an automation
 * write on, so an automation write of one of these names never reaches the
 * native door at all. A panel write does not consult [addressesParameter]:
 * `updateDeviceParam.ts` sends it natively through `nativeBuiltinWriteTarget`
 * regardless, so it does reach the door, and `BacteriaBody::set_param`
 * (`crates/daw-engine/src/scheduler.rs`) is what drops it there. Either way
 * the parameter keeps the value the persisted record's patch gave it.
 */
const BACTERIA_CONTROL_THREAD_ONLY: ReadonlySet<string> = new Set(['convolutionIr', 'phaserStages']);

/**
 * `paramId` with an optional `band{digit}` prefix stripped: the bare name the
 * engine resolves once it has picked a band.
 *
 * The same reading `BacteriaEngine::apply_param`
 * (`crates/daw-dsp/src/bacteria/engine.rs`) and `bare_bacteria_param_name`
 * (`crates/daw-engine/src/scheduler.rs`) perform: four bytes of `band`, one
 * decimal digit, then one character the engine skips without reading —
 * historically `_`, but `apply_param` never checks that it is, on any digit
 * rather than only the six bands that exist, because the engine strips first
 * and bounds-checks the band afterwards. The sixth character is matched by
 * `.` rather than pinned to `_` for exactly that reason: a stricter pattern
 * here would read `band00convolutionIr` and `band0XphaserStages` as unmatched
 * bare names while the engine reads both as band 0's `convolutionIr` and
 * `phaserStages`, which is the gap this function exists to close rather than
 * reopen. So `band3_phaserStages`, `band00convolutionIr` and `phaserStages`
 * all reach the same answer here, while `bandCount` is not a prefixed name at
 * all and reads as itself.
 */
function bareBacteriaParamName(paramId: string): string {
    const prefixed = /^band\d.(?<bare>.*)$/s.exec(paramId);
    return prefixed?.groups?.bare ?? paramId;
}

/** Whether a live write of `paramId` is one the native audio-thread door drops. */
function isBacteriaControlThreadOnly(paramId: string): boolean {
    return BACTERIA_CONTROL_THREAD_ONLY.has(bareBacteriaParamName(paramId));
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
    [
        'grinder',
        {
            soundsNotes: false,
            /**
             * No table: Grinder's engine spells its own parameters in
             * camelCase, and project truth authors the same camelCase ids
             * for them, so the id a panel or a lane writes already is the
             * name `GrinderEngine::set_param` takes.
             *
             * A structured patch — the worklet's neural-profile message —
             * projects to nothing here; the Grinder bridge sends that
             * profile as numeric writes in the same names, so the native
             * door and the record carry it. The record's `neuralModelMode`
             * picks which neural source those writes carry — see
             * [grinderNeuralSourceOnly].
             */
            parameterName: (paramId) => paramId,
            projectPatch: grinderNeuralSourceOnly,
            addressesParameter: (paramId) => BUILTIN_PARAM_NAME_SHAPE.test(paramId),
        },
    ],
    [
        'bacteria',
        {
            soundsNotes: false,
            /**
             * No table, for the same reason as Grinder's entry above:
             * Bacteria's engine spells its own parameters in camelCase and
             * project truth authors the same ids, so the id a panel or a lane
             * writes already is the name `BacteriaEngine::set_param` takes.
             * Its two addressing families are inside the shape rule rather
             * than beside it — a `band{N}_` prefix aims a name at one band and
             * `stepSeqVal_{n}` indexes a sequencer step, and the engine
             * decodes both itself.
             *
             * The record needs no narrowing beyond the shape and the wire's
             * number: `encodePatchValue`
             * (`#/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts`)
             * already index-encodes every string selector before it is
             * persisted, and a key the engine has no arm for — `routingMode`,
             * `crossoverSlope`, the modulation flags — falls through its
             * broadcast to sub-processors that ignore it, exactly as it does
             * under the worklet.
             *
             * `addressesParameter` refuses the two names whose engine arms
             * allocate, but that only keeps an automation write off the
             * native door — `readLiveAutomationWrites` gates on this answer
             * before it builds a write. A panel write skips this gate
             * entirely (`updateDeviceParam.ts` sends every live write
             * natively through `nativeBuiltinWriteTarget`), reaches the
             * native door regardless, and is dropped there by
             * `BacteriaBody::set_param`. Either way the persisted record
             * still carries both names, because the mapper applies it
             * control-side where those arms are legal, and the parameter
             * keeps the value that record gave it.
             *
             * The body declares no latency to the native engine even though
             * this engine reports a real one. A settled `externalLatencyRegistry`
             * — filled by the carried strip's gated-shut `BacteriaNode` — does
             * fold into what `getCompensationDelay` hands the native engine,
             * but only at the moment a programme is built: the session's
             * first programme can build before the worklet has reported
             * anything, and a mid-roll parameter change that moves the
             * engine's own latency figure does not rebuild the programme
             * already handed to a running session. Both gaps, and why
             * declaring a figure here today would still double-compensate
             * rather than close them, are written out on `BacteriaBody` in
             * `crates/daw-engine/src/scheduler.rs`; #4153 is the fix, moving
             * the compensation into the engine through `SetEffectLatency`.
             */
            parameterName: (paramId) => paramId,
            projectPatch: shapedNumericParametersOnly,
            addressesParameter: (paramId) =>
                BUILTIN_PARAM_NAME_SHAPE.test(paramId) && !isBacteriaControlThreadOnly(paramId),
        },
    ],
]);

export function nativeBuiltinBody(deviceType: string): NativeBuiltinBody | null {
    return NATIVE_BUILTIN_BODIES.get(deviceType.toLowerCase()) ?? null;
}
