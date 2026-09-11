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

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { mapCrustParamToDspParam } from '../../models/CrustDspParamNames';
import { mapGlutenParamToDspParam } from '../../models/GlutenDspParamNames';
import { mapGrandBouleParamToDspParam } from '../../models/GrandBouleDspParamNames';
import { mapToasterKitParamToDspParam } from '../../models/ToasterKitParamNames';

/**
 * The wire shape `BuiltinParamName::parse` admits
 * (`crates/daw-engine/src/timeline.rs`): 1 to `BUILTIN_PARAM_NAME_CAPACITY`
 * ASCII letters, digits and underscores. The carrier does not keep a
 * vocabulary table for any one instrument, so this is the whole of what it
 * refuses by — snake_case and camelCase both parse, because Fermenter spells
 * one and Grinder spells the other. The capacity is 40, not a round number:
 * Levain's own vocabulary needs it, its longest name,
 * `legato_portamento_velocity_threshold`, is 36 bytes, four short of a
 * narrower carrier.
 */
export const BUILTIN_PARAM_NAME_SHAPE = /^[A-Za-z0-9_]{1,40}$/;

export type NativeBuiltinBody = Readonly<{
    /** Whether the engine registers a note store for this body (mirror of `BuiltinEffectType::sounds_notes`). */
    soundsNotes: boolean;
    /** The engine's name for one of this body's parameters, from the id a panel or lane authors. */
    parameterName: (paramId: string) => string;
    /** The engine's flat record for this body's patch, from project truth's `parameterValues`. */
    projectPatch: (parameterValues: Readonly<Record<string, unknown>>) => Readonly<Record<string, number>>;
    /** Whether this body resolves a project-side parameter id at all — the renderer's mirror of `builtin_parameter` in `crates/daw-engine/src/graph.rs`. */
    addressesParameter: (paramId: string) => boolean;
    /**
     * Whether a clip note's own release belongs to this body.
     *
     * A keyboard instrument holds the key a clip note names until the note
     * ends, so its release is part of the part. A pad-addressed drum machine
     * holds no key to lift: a pad is struck and decays on its own envelope, and
     * a release arriving mid-decay chokes it. The web carrier already draws
     * that line — `scheduleTrackClips.ts` withholds the release for the Toaster
     * (`if (!isToaster)`) and the live worklet posts `noteOn` alone — so a
     * native carrier that sent one would sound the same arrangement two ways.
     *
     * This is about a *clip's* release only. The engine's own stop still
     * releases every pad it holds (`ActiveEffect::release_sounding_notes`,
     * `crates/daw-engine/src/scheduler.rs`), and the body cannot tell that
     * release from a stored one, so the exception belongs to the producer and
     * not to `ToasterBody::deliver`.
     *
     * Read only for a body that is a note sink, so a body that sounds no notes
     * answers `true`: there is no clip release to withhold from it, and `false`
     * would read as a rule about a part it never receives.
     */
    takesClipNoteReleases: boolean;
    /**
     * Whether the native engine compensates this body's own group delay for a
     * strip it carries.
     *
     * True only for a body the mapper declares a latency for at registration
     * (`PluginCore::declared_latency_frames`, `crates/daw-engine/src/scheduler.rs`).
     * The engine then holds every route meeting that strip back by the figure
     * itself, so the renderer's own sum must not count the device a second
     * time — the same exclusion `getDeviceLatencyMs` makes for
     * `external-plugin`, and for the same reason.
     */
    latencyCompensatedByEngine: boolean;
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
 * The sampler's engine name for one project parameter id, read from the module
 * that owns that vocabulary.
 *
 * Asked at call time rather than held: the sink is registered by the
 * composition root, and this table is built when the module loads.
 */
function levainEngineParameterName({ paramId }: { paramId: string }): string | null {
    return getAudioDeviceRuntimeSink().nativeBuiltinParameterName({ deviceType: 'levain', paramId });
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

/**
 * The Proof parameter name the graph owns, and which the body therefore never
 * applies to its chain.
 *
 * `PROOF_GRAPH_OWNED` in `crates/daw-engine/src/scheduler.rs` is the same name,
 * and that constant carries the reason: a device's bypass is the graph's own
 * `GraphCommand::SetBypass`, which skips the body's pass and re-declares its
 * latency, so a value written into the chain instead would leave the graph
 * still running a body it believes is switched out.
 *
 * `ab_bypass` is deliberately not here. It is runtime-only in the project —
 * `setProofParam` has refused to persist it since 11563e86b (2026-08-16), so a
 * row saved after that commit never carries it — but it is a chain control all
 * the same: the panel's A/B compare returns the gain-matched dry signal from
 * the head of the chain, and a compare pressed while the session rolls
 * natively has to be audible on the carrier that is sounding. Withholding it
 * would leave the chip reading "A / dry" over the processed mix.
 *
 * Unlike [BACTERIA_CONTROL_THREAD_ONLY], this is not dropped on the control
 * thread — a live `set_param` still forwards it, because the arm it engages
 * there is a session gesture, not a saved value. A row saved before
 * 11563e86b can still carry `ab_bypass: 1`; `ProofBody::load_patch`
 * (`crates/daw-engine/src/scheduler.rs`) refuses that one name at the record
 * door with its own constant (`PROOF_RECORD_REFUSED`) rather than through this
 * one, so an old record cannot map the body dry against the panel's default.
 * It stays in [projectPatch] all the same: the record is the mapper's, and the
 * mapper reads a device's bypass from the record's own `bypassed` field rather
 * than from a parameter.
 */
const PROOF_GRAPH_OWNED: ReadonlySet<string> = new Set(['bypass']);

const NATIVE_BUILTIN_BODIES = new Map<string, NativeBuiltinBody>([
    [
        'knead',
        {
            soundsNotes: false,
            parameterName: (paramId) => paramId,
            projectPatch: numericParametersOnly,
            addressesParameter: (paramId) => KNEAD_ENGINE_PARAM_NAMES.has(paramId),
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
        },
    ],
    [
        'fermenter',
        {
            soundsNotes: true,
            parameterName: (paramId) => mapFermenterParamToDspParam({ paramId }),
            projectPatch: (parameterValues) => mapFermenterPatchToDspPatch({ patch: parameterValues }),
            addressesParameter: (paramId) => FERMENTER_PARAM_IDS.has(paramId),
            // A keyboard synth: a clip note holds its key until the note ends.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
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
            // A sampled piano: a clip note holds its key until the note ends.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
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
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
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
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
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
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
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
             * This engine reports a real group delay, and it is the one body
             * here whose delay the native engine compensates itself: the
             * mapper declares the figure at registration and the audio thread
             * re-reads it after every write, so a strip the engine carries is
             * aligned from its first block and stays aligned across a mid-roll
             * parameter change (`BacteriaBody`,
             * `crates/daw-engine/src/scheduler.rs`). Hence
             * `latencyCompensatedByEngine`: on an engine-carried strip this
             * device is excluded from the renderer's own sum, or the delay
             * would be counted twice. A web-carried strip is unaffected — its
             * `BacteriaNode` reports the same figure into
             * `externalLatencyRegistry`, and that is what aligns it.
             */
            parameterName: (paramId) => paramId,
            projectPatch: shapedNumericParametersOnly,
            addressesParameter: (paramId) =>
                BUILTIN_PARAM_NAME_SHAPE.test(paramId) && !isBacteriaControlThreadOnly(paramId),
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: true,
        },
    ],
    [
        'proof',
        {
            soundsNotes: false,
            /**
             * No table, for the same reason as Grinder's and Bacteria's entries
             * above: Proof's chain spells its own parameters in snake_case and
             * project truth authors the same ids, so the id a panel or a lane
             * writes already is the name `ProofChain::set_param` takes. Its
             * addressing is inside the shape rule rather than beside it — a
             * name carries the stage it routes to as a prefix (`eq_`, `dyneq_`,
             * `match_`, `dyn_`, `img_`, `exc_`, `lim_`, `dither_`), and the
             * chain decodes the prefix itself.
             *
             * The record also carries the five `chain_order_{n}` keys spelling
             * the module order, which the chain has no `set_param` arm for at
             * all: `ProofBody` reads them and calls the chain's own `reorder`.
             * They are ordinary shaped names here, so they travel in the
             * record and answer a live write like any other.
             *
             * `addressesParameter` refuses the one name the graph owns — see
             * [PROOF_GRAPH_OWNED] — so an automation lane spelling it is never
             * built into a write. A panel write skips this gate entirely
             * (`updateDeviceParam.ts` sends every live write natively through
             * `nativeBuiltinWriteTarget`), reaches the native door regardless,
             * and is dropped there by `ProofBody::set_param`. `ab_bypass` is not
             * that name: the panel's compare reaches the chain on whichever
             * carrier is sounding, and the project has not persisted it since
             * 11563e86b (2026-08-16) — an older row that still carries it is
             * refused only where a saved record loads
             * (`ProofBody::load_patch`'s `PROOF_RECORD_REFUSED`), not here.
             *
             * The limiter's look-ahead is a real group delay, and the native
             * engine compensates it itself: the mapper declares the figure at
             * registration and the audio thread re-reads it after every write,
             * so a write of `lim_lookahead` — the one name that moves this
             * body's figure — realigns the mix rather than sliding it
             * (`ProofBody`, `crates/daw-engine/src/scheduler.rs`). Hence
             * `latencyCompensatedByEngine`: on an engine-carried strip this
             * device is excluded from the renderer's own sum, or the delay
             * would be counted twice.
             *
             * The chain's meters and its LUFS reading stay on the web twin.
             * They are display, not audio, and nothing on the engine side
             * reads them.
             */
            parameterName: (paramId) => paramId,
            projectPatch: shapedNumericParametersOnly,
            addressesParameter: (paramId) => BUILTIN_PARAM_NAME_SHAPE.test(paramId) && !PROOF_GRAPH_OWNED.has(paramId),
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: true,
        },
    ],
    [
        'toaster',
        {
            soundsNotes: true,
            /**
             * The automation surface is only the four descriptor ids Toaster
             * declares (`masterGain`, `reverbMix`, `delayMix`, `swing`) —
             * `TOASTER_DESCRIPTOR.parameters` — so those are the only keys
             * `device.parameterValues` ever actually holds. `swing` resolves
             * here like the other three even though no Rust arm answers it
             * (`descriptorEngineParamWeld.spec.ts` exempts it: swing shifts
             * the schedule, not the audio, and is applied host-side); refusing
             * it here would gate a live automation write off the native door
             * for a name the panel and every other producer still address.
             *
             * The kit itself — engine type, tuning, decay, tone, drive,
             * filtering, sends, and the send-effect internals — is not a
             * `parameterValues` entry at all. It is pushed as engine control
             * writes (`projectToasterKitToEngineMessages`) from the device's
             * `deviceState`, which reaches the native record through
             * `projectDeviceForNativeBody`'s own merge rather than through
             * this table.
             */
            parameterName: (paramId) => mapToasterKitParamToDspParam({ paramId }) ?? paramId,
            projectPatch: tablePatch(mapToasterKitParamToDspParam),
            addressesParameter: (paramId) => mapToasterKitParamToDspParam({ paramId }) !== null,
            // The one body that declines a clip's release. A pad is struck and
            // decays on its own envelope; `DrumVoice::release`
            // (`crates/daw-dsp/src/toaster/voice.rs`) turns a note-off into a
            // choke fade, which is why the web carrier withholds it too
            // (`scheduleTrackClips.ts`). Stop still releases every held pad.
            takesClipNoteReleases: false,
            // The engine reports no latency for this body and the worklet
            // declares none either, so there is nothing here for the renderer
            // to exclude from its own sum.
            latencyCompensatedByEngine: false,
        },
    ],
    [
        'levain',
        {
            soundsNotes: true,
            /**
             * The orchestral sampler. Unlike every other body here it is not
             * built from its record at all: `map_device` builds the instance
             * from a *sample bank* the renderer staged under the device's own
             * `sampleBankKey`, and answers `Err` for the device by name when no
             * committed bank stands there — refusing the batch whole on any
             * strip that contributes audio (`crates/sourdaw-native/src/commands/
             * graph.rs`). The key reaches the wire through
             * `projectDeviceForNativeBody`; this row is only the vocabulary the
             * built instance then answers to.
             *
             * Its vocabulary is the one this table does not hold itself. Two
             * families of project id reach it — the patch's own fields, whose
             * ids invert the engine names `projectLevainPatchToEngineParameters`
             * emits, and the wider automation surface `LEVAIN_DESCRIPTOR`
             * declares — and both are Levain's to spell. Asked for through the
             * runtime sink rather than imported, because Levain's panel writes
             * to the engine directly and so imports this module: reading its
             * map from here would close a cycle. The fallback is unreachable for
             * anything a lane can spell, because `readLiveAutomationWrites`
             * gates on `addressesParameter` before it asks for a name.
             *
             * The articulation choice is not a `parameterValues` entry: it is a
             * string in `Device.deviceState`, folded into the record as
             * `current_articulation` by `projectDeviceForNativeBody`'s merge.
             */
            parameterName: (paramId) => levainEngineParameterName({ paramId }) ?? paramId,
            projectPatch: tablePatch(levainEngineParameterName),
            addressesParameter: (paramId) => levainEngineParameterName({ paramId }) !== null,
            // A sampled orchestral instrument: a clip note holds its key until
            // the note ends, and its release is what triggers the release zones.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: false,
        },
    ],
    [
        'dutch-oven',
        {
            soundsNotes: false,
            /**
             * No table, for the same reason as Grinder's, Bacteria's and
             * Proof's entries above: the reverb spells its own parameters in
             * snake_case and project truth authors the same ids, so the id a
             * panel or a lane writes already is the name
             * `ProofChamberInstance::set_param` takes. The vocabulary is a
             * union across the engines an `algorithm` write selects between —
             * a name the selected engine has no arm for is dropped by that
             * engine, exactly as it is under the worklet — so admission here is
             * the shape check and nothing narrower.
             *
             * No name is withheld from that door, unlike Bacteria's two
             * allocating arms or Proof's `bypass`. The device's bypass is not a
             * parameter at all here: it arrives as the record's own `bypassed`
             * field and travels as the graph's `GraphCommand::SetBypass`, and
             * the `dutch-oven` descriptor declares no `bypass` row for a lane
             * to spell. Nor is there an engine-selection or IR route that skips
             * the wire — `algorithm` and `vintage` are ordinary numeric names
             * the instance answers, and `load_ir` has no caller anywhere in the
             * application.
             *
             * `fdn_damping_version` is the one name the record carries that no
             * panel shows. `addDevice`
             * (`#/modules/Arrangement/useCases/device/addDevice.ts`) merges the
             * descriptor's `internalParameterValues` into `parameterValues` at
             * creation, so every saved reverb persists it, and it is exactly
             * the name that must travel: it picks which damping curve the two
             * FDN tanks open on, and withholding it would render every saved
             * FDN patch on the legacy curve.
             *
             * Every engine an `algorithm` write selects is algorithmic and
             * reports no group delay, yet the mapper still declares a figure
             * for this body at registration and the audio thread re-reads it
             * after every write (`PluginCore::declared_latency_frames`,
             * `crates/daw-engine/src/scheduler.rs`). That declaration is what
             * `latencyCompensatedByEngine` mirrors: on an engine-carried strip
             * this device is excluded from the renderer's own sum, because the
             * engine is the one holding the figure — today zero, and whatever
             * the instance reports if a latent engine ever becomes reachable.
             */
            parameterName: (paramId) => paramId,
            projectPatch: shapedNumericParametersOnly,
            addressesParameter: (paramId) => BUILTIN_PARAM_NAME_SHAPE.test(paramId),
            // Sounds no notes, so no clip release is ever addressed to it.
            takesClipNoteReleases: true,
            latencyCompensatedByEngine: true,
        },
    ],
]);

export function nativeBuiltinBody(deviceType: string): NativeBuiltinBody | null {
    return NATIVE_BUILTIN_BODIES.get(deviceType.toLowerCase()) ?? null;
}
