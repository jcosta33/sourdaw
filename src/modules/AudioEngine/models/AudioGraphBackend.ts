/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AudioGraphBackend — the seam a renderer sits behind
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One backend turns a mixer configuration and a set of scheduled clips into
 * sound. Web Audio is one; the native `daw-engine` is meant to be another on
 * desktop. This file is the contract both answer to, so that swapping them is
 * a composition-root decision rather than a rewrite of the graph code.
 *
 * ── Why the commands look like they do ────────────────────────────────────
 *
 * The shape is deliberately **a command batch applied to a stateful backend**,
 * not a set of imperative methods, because that is the shape the native side
 * already has: `crates/daw-engine/src/scheduler.rs` drains a lock-free queue of
 * `GraphCommand` on the audio callback, and every variant that carries heap
 * memory carries it already built. A contract of methods would have to be
 * re-serialised into that queue at the boundary by hand, and each hand
 * translation is somewhere the two runtimes can drift. A contract of commands
 * maps onto it mechanically.
 *
 * It aligns the web audio strip and the native timeline
 * (`crates/daw-engine/src/timeline.rs`) across the four timeline behaviors
 * delivered in jcosta33/sourdaw#2085:
 *
 *   1. A **pre-fader solo gate** distinct from the post-fader mute gate
 *      ({@link AudioGraphParameterTarget}). Placed ahead of send taps and the
 *      fader, so a non-soloed track does not feed its cue bus or reverb tail.
 *   2. **Bus device chains** ({@link AudioGraphCreateBusStripCommand}). A bus
 *      hosts its own insert chain ahead of the bus fader.
 *   3. **Cancel-and-replace automation** ({@link AudioGraphParameterWrite}).
 *      Pending ramps re-anchor and replace on interactive parameter writes.
 *   4. **Per-clip fades, the anti-click micro-fade, and playback rate**
 *      ({@link AudioGraphClipPlayback}).
 *
 * ── Addressing: one strip id space ────────────────────────────────────────
 *
 * **Tracks and buses share a single id space, and every `trackId` in this file
 * means {@link AudioGraphStripId} — the id of a strip, whatever kind it is.**
 * This is contract law, not an implementation accident: project truth gives a
 * bus and an audio track the same kind of id from the same pool, an output id
 * names either without saying which, and a bus is a strip in every other
 * respect ({@link AudioGraphCreateBusStripCommand}). A backend that kept two
 * id spaces would have to be told which one an output id came from, and the
 * caller does not know.
 *
 * The consequence is that there is no bus-addressed form of
 * {@link AudioGraphSetTrackOutputCommand}, {@link AudioGraphParameterTarget},
 * or the device-chain commands, and none is needed: a bus fader, a bus pan, a
 * bus output and a bus chain edit are all addressed by putting the bus's strip
 * id in `trackId`. `create-track-strip` and `create-bus-strip` are separate
 * only because creation is where the two differ — a bus sums, a track does not.
 *
 * A native backend that splits the spaces internally — `daw-engine` does, with
 * `SetTrackOutput`/`SetBusOutput` and `AutomationTarget::TrackGain`/`BusGain` —
 * resolves the strip id against its own two registries at the boundary. That is
 * a lookup, not a reinterpretation, and it is the backend's job precisely
 * because only the backend knows which of its registries holds the strip.
 *
 * **Routing constraint.** This contract permits any strip to route to any of
 * `master`, a bus, or a track, and does not carve out bus outputs. `daw-engine`
 * honours `bus -> track`: the bus is rendered before the destination strip so
 * the signal enters that strip's device chain. A backend that cannot honour a
 * route must **refuse the batch** rather than drop the route, because a dropped
 * route is a strip that silently stops reaching the mix.
 *
 * ── What is deliberately *not* here ───────────────────────────────────────
 *
 * **Device construction.** A backend routes strips, parameters, clips and
 * transport; which concrete node a `builtin-filter` becomes is the device
 * registry's question, and it is already answered once for both the live and
 * the offline path. Commands therefore carry {@link Device} — project truth —
 * and the backend composes with the registry it has.
 *
 * **Node handles.** Nothing in this contract hands back an `AudioNode`, because
 * a native backend has none to hand back. A backend that needs to expose its
 * own graph to the rest of a runtime does so on its own type, beside this one.
 */

import { type RuntimeGraphCorrelation } from './RuntimeGraphDelta';
import { type Device } from './TrackViewTypes';

/**
 * The id of a strip — a track or a bus, drawn from one space.
 *
 * Named rather than left as a bare `string` so that a field called `trackId`
 * carrying a bus id reads as the law it is, not as a mistake. See the
 * addressing section in this file's header.
 */
export type AudioGraphStripId = string;

/**
 * Where a send taps the strip.
 *
 * A pre-fader send taps ahead of the fader and the mute gate — that is what
 * makes a cue or monitor mix keep working while the engineer pulls the fader
 * down — and therefore *behind* the solo gate, which is the whole reason the
 * solo gate is a separate node. A post-fader send taps after the panner, so it
 * rides the fader.
 */
export type AudioGraphSendTap = 'pre-fader' | 'post-fader';

/**
 * Where a strip's output goes.
 *
 * `bus` and `track` are the same id space (see the header): the distinction is
 * what the caller *believes* the destination is, and a backend that finds the
 * id in the other registry may honour it. A destination this backend cannot
 * route to is refused, never dropped.
 */
export type AudioGraphRouteTarget =
    | Readonly<{ kind: 'master' }>
    | Readonly<{ kind: 'bus'; busId: AudioGraphStripId }>
    | Readonly<{ kind: 'track'; trackId: AudioGraphStripId }>;

/**
 * The mixer state a strip is built with.
 *
 * `gain` and `pan` are **project truth in project units** — a linear amplitude
 * that may sit above the fader ceiling, and a pan on this app's −50…50 scale.
 * The backend owns the level law: it applies the fader clamp and the pan scale
 * itself, so a stored gain above unity cannot render louder than it plays back
 * and a second implementation of the clamp cannot drift from the first.
 *
 * `vcaMultiplier` folds in *before* the clamp, which is the order the live
 * strip composes in: clamping first and multiplying after is a different number
 * whenever the product crosses unity.
 */
export type AudioGraphStripState = Readonly<{
    /** Stored linear amplitude, before the fader clamp and before the VCA fold. */
    gain: number;
    /** −50…50, this app's pan scale. */
    pan: number;
    /** The post-fader mute gate. */
    muted: boolean;
    /**
     * The pre-fader solo gate — silencing a track the engineer is not
     * listening to, upstream of its send taps. Distinct from `muted` so
     * releasing solo cannot clear a mute the user actually pressed.
     */
    soloGated: boolean;
    /** The track's VCA group master as a plain multiplier; `1` outside a group. */
    vcaMultiplier: number;
}>;

/**
 * A device chain, in project order, as one splice.
 *
 * Ordering is the whole content of a chain command: the device *identities* and
 * their parameters are project truth, and where they sit relative to each other
 * is what the backend has to reproduce. Generators (instruments, zero-input
 * nodes) accumulate into the chain input rather than displacing it, which is
 * the fan-in the web `rebuildChain` permits and a strictly serial chain cannot
 * express.
 */
export type AudioGraphDeviceChain = readonly Device[];

/**
 * A parameter a backend can be told to write.
 *
 * Every target names a **position on the strip**, never a node, so a backend
 * that realises the strip differently still answers the same command. The value
 * domain is stated per target and is always project truth; the backend applies
 * the law. Every one of these accepts any {@link AudioGraphParameterWrite}.
 */
export type AudioGraphStripParameterTarget =
    /** Stored linear amplitude, pre-clamp and pre-VCA. */
    | Readonly<{ kind: 'track-fader'; trackId: AudioGraphStripId }>
    /** −50…50. */
    | Readonly<{ kind: 'track-pan'; trackId: AudioGraphStripId }>
    /** The post-fader gate: `0` silences, `1` opens. */
    | Readonly<{ kind: 'track-mute-gate'; trackId: AudioGraphStripId }>
    /** The pre-fader gate: `0` silences, `1` opens. */
    | Readonly<{ kind: 'track-solo-gate'; trackId: AudioGraphStripId }>
    /** Stored linear send level, clamped to `[0, 1]`. */
    | Readonly<{ kind: 'track-send-level'; trackId: AudioGraphStripId; busId: AudioGraphStripId }>;

/**
 * A device's own parameter, in the device's units.
 *
 * Two families answer to one shape. A built-in names its parameter, and the
 * backend maps that name onto a closed set it knows. A hosted plugin's
 * parameters are the plugin's own numeric ids, opaque to the backend and
 * spelled here as strings; the plugin resolves them when the stamp reaches the
 * block it is due on.
 *
 * Addressed by its own command ({@link AudioGraphWriteDeviceParameterCommand})
 * rather than sharing `write-parameter`, because it is not a strip position and
 * it does not accept the same writes: a backend that owns its per-device
 * smoothing lands the value at a block boundary, not at a sample offset, so
 * only {@link AudioGraphStepWrite} has a meaning here. Keeping the two apart at
 * the command level makes a ramp aimed at a device parameter fail to compile
 * rather than be accepted and quietly discarded.
 */
export type AudioGraphDeviceParameterTarget = Readonly<{
    kind: 'device-parameter';
    trackId: AudioGraphStripId;
    deviceId: string;
    parameterId: string;
}>;

export type AudioGraphParameterTarget = AudioGraphStripParameterTarget | AudioGraphDeviceParameterTarget;

/**
 * A device on a strip, addressed as itself rather than through one of its
 * parameters.
 *
 * Carries no `kind`, unlike {@link AudioGraphDeviceParameterTarget}: it belongs
 * to no union, so there is nothing for a discriminant to tell it apart from.
 */
export type AudioGraphDeviceTarget = Readonly<{
    trackId: AudioGraphStripId;
    deviceId: string;
}>;

/**
 * Land `value` at `landTime`, replacing whatever was already scheduled.
 *
 * This is the lane-playback primitive, and the replacement half is the part a
 * backend cannot drop: the write path re-issues it on every scheduler tick, so
 * each tick has to *continue* the trajectory from where the parameter actually
 * is rather than compound onto a target scheduled by the previous tick. A
 * backend that appends will overrun whatever queue it keeps and strand the
 * parameter at a stale target.
 *
 * `startTime` is where the trajectory is re-anchored; `landTime` is where the
 * value arrives. Both are absolute times on the backend's own clock. A caller
 * that needs a minimum ramp span — a zero-length ramp steps, which is the
 * scheduler-grain stair-step the ramp exists to remove — has already applied it
 * to `landTime`.
 */
export type AudioGraphRampWrite = Readonly<{
    shape: 'ramp-to';
    value: number;
    startTime: number;
    landTime: number;
}>;

/**
 * Approach `value` exponentially from wherever the parameter is, with time
 * constant `timeConstantSeconds`. The shape an interactive mixer move uses:
 * it never lands exactly, which is what keeps a dragged fader from zipping.
 */
export type AudioGraphSmoothedWrite = Readonly<{
    shape: 'smoothed';
    value: number;
    time: number;
    /** τ, in seconds. The live mixer writers use 5–10 ms. */
    timeConstantSeconds: number;
}>;

/** Take `value` at `time` with no glide. */
export type AudioGraphStepWrite = Readonly<{
    shape: 'step';
    value: number;
    time: number;
}>;

/**
 * Hold the parameter wherever it is and drop every pending event.
 *
 * Transport stop, so a ramp scheduled toward a compensated future time does not
 * keep gliding after playback ends. Carries no value by construction — a hold
 * that named a value would be a write, and would jump.
 */
export type AudioGraphHoldWrite = Readonly<{
    shape: 'hold';
    time: number;
}>;

export type AudioGraphParameterWrite =
    AudioGraphRampWrite | AudioGraphSmoothedWrite | AudioGraphStepWrite | AudioGraphHoldWrite;

/**
 * The material a playback reads from.
 *
 * `sourceId` is the identity and is what a backend addresses; `buffer` is the
 * **web realisation** of that identity and is the one payload in this contract
 * a native backend cannot receive — an `AudioBuffer` is a main-thread Web Audio
 * handle, while `daw-engine`'s material is channel vectors owned control-side.
 * The header's rule about node handles applies symmetrically to what is handed
 * *in*: the identity crosses the seam, the realisation does not.
 *
 * A backend resolves `sourceId` against whatever pool it owns, and one that
 * cannot — because it needs the buffer and did not get one — refuses the batch.
 * It never plays silence, because a silent clip is indistinguishable from a
 * correctly rendered rest.
 */
export type AudioGraphClipSource = Readonly<{
    /** Stable identity of the decoded material, addressable by any backend. */
    sourceId: string;
    /** Decoded material, for a backend whose material *is* an `AudioBuffer`. */
    buffer?: AudioBuffer;
}>;

/**
 * One playback of one piece of source material.
 *
 * Sample-accurate by construction: `startTime`, `sourceOffsetSeconds` and
 * `durationSeconds` are the three numbers that decide which frames are heard
 * and when, and they are given rather than derived so a loop iteration, a
 * region-start trim and a comped take are all the same command.
 */
export type AudioGraphClipPlayback = Readonly<{
    trackId: AudioGraphStripId;
    /** What is played. */
    source: AudioGraphClipSource;
    /** Absolute time on the backend's clock at which the first frame is heard. */
    startTime: number;
    /** Where playback enters the source material, in the source's own time. */
    sourceOffsetSeconds: number;
    /**
     * How long the clip sounds, on the **destination** timeline: a stretched
     * clip that plays for two seconds plays for two seconds whatever its rate.
     */
    durationSeconds: number;
    /**
     * Source frames consumed per destination frame. `1` is unmodified;
     * anything else is varispeed resampling (transposition/speed), matching
     * native `ClipPlayback::playback_rate` in `crates/daw-engine/src/timeline.rs`
     * (pitch-preserving stretch is a device-shaped transform, not a clip
     * attribute).
     */
    playbackRate: number;
    /** The clip's own level, as a linear amplitude. */
    gain: number;
    /** Per-clip fades, and the anti-click floor both of them are held to. */
    fade: AudioGraphClipFade;
}>;

/**
 * How a clip's level enters and leaves.
 *
 * A clip **always** fades, even when the user set no fade: starting or stopping
 * a buffer on a non-zero sample steps the output and clicks. `microFadeSeconds`
 * is that floor, and it is also the minimum a user's own fade is held to.
 * Either side may be suppressed — a loop iteration that continues from the
 * previous one must not re-fade at the seam — which is what `fadeIn` and
 * `fadeOut` being absent means.
 */
export type AudioGraphClipFade = Readonly<{
    /**
     * Absent when this playback continues an unbroken sound. Present with no
     * `reachesFullAt` when the clip carries no fade of its own and only the
     * anti-click floor applies.
     *
     * Absolute rather than a duration for the same reason the playback itself
     * is: every edge in this command is addressed on one clock, so a backend
     * never has to add two numbers that were rounded separately to find out
     * which frame something happens on.
     */
    fadeIn?: Readonly<{ reachesFullAt?: number }>;
    /** Absent when the sound continues past this playback. */
    fadeOut?: Readonly<{ beginsAt?: number }>;
    /** The anti-click floor, applied whether or not the user asked for a fade. */
    microFadeSeconds: number;
}>;

export type AudioGraphCreateTrackStripCommand = Readonly<{
    kind: 'create-track-strip';
    trackId: AudioGraphStripId;
    /** Names the track in every device-failure message the chain build emits. */
    name: string;
    state: AudioGraphStripState;
    devices: AudioGraphDeviceChain;
    /**
     * Whether `state.muted` reaches the strip at all. A stem export renders a
     * muted track's content so it stays usable in another DAW; a mixdown bakes
     * the mute in.
     */
    honorMuted: boolean;
    /**
     * Whether anything this strip produces can reach the output. A strip built
     * only to keep the routing graph faithful, and never scheduled, contributes
     * silence by construction — so a device on it that cannot be built is not
     * worth refusing the whole render over.
     */
    contributesAudio: boolean;
}>;

/**
 * A bus strip: a summing input, its own device chain, and an output.
 *
 * Identical in kind to a track strip, matching the native timeline bus which
 * hosts its own device chain ahead of the bus fader (delivered in #2085). The
 * command is separate from {@link AudioGraphCreateTrackStripCommand} because
 * **creation** differs — a bus sums its inputs — not because a bus is addressed
 * differently afterwards.
 * Once built, a bus is reached by putting `busId` in the `trackId` of every
 * other command: one strip id space, stated as law in this file's header.
 */
export type AudioGraphCreateBusStripCommand = Readonly<{
    kind: 'create-bus-strip';
    busId: AudioGraphStripId;
    name: string;
    state: AudioGraphStripState;
    devices: AudioGraphDeviceChain;
    honorMuted: boolean;
    contributesAudio: boolean;
}>;

/**
 * Point a strip's output somewhere. `trackId` is a strip id, so this is also
 * how a bus's output is set — there is no `set-bus-output`.
 */
export type AudioGraphSetTrackOutputCommand = Readonly<{
    kind: 'set-track-output';
    trackId: AudioGraphStripId;
    target: AudioGraphRouteTarget;
}>;

export type AudioGraphAddSendCommand = Readonly<{
    kind: 'add-send';
    trackId: AudioGraphStripId;
    busId: AudioGraphStripId;
    tap: AudioGraphSendTap;
    /** Stored linear level, clamped to `[0, 1]` by the backend. */
    level: number;
}>;

export type AudioGraphRemoveSendCommand = Readonly<{
    kind: 'remove-send';
    trackId: AudioGraphStripId;
    busId: AudioGraphStripId;
}>;

/**
 * Splice a device into a chain at `index`, clamped to the chain's length.
 *
 * Separate from strip creation because a chain is edited while it plays, and
 * the position is the payload: the device itself is project truth the registry
 * builds, and `index` is the only thing a backend has to be told.
 */
export type AudioGraphInsertDeviceCommand = Readonly<{
    kind: 'insert-device';
    trackId: AudioGraphStripId;
    device: Device;
    index: number;
}>;

export type AudioGraphRemoveDeviceCommand = Readonly<{
    kind: 'remove-device';
    trackId: AudioGraphStripId;
    deviceId: string;
}>;

/** Write a position on the strip. Any write shape is defined for these. */
export type AudioGraphWriteParameterCommand = Readonly<{
    kind: 'write-parameter';
    target: AudioGraphStripParameterTarget;
    write: AudioGraphParameterWrite;
}>;

/**
 * Write a device's own parameter.
 *
 * Its own command, carrying its own narrower write type, so that the one
 * pairing a backend would have to silently discard — a ramp aimed at a
 * parameter that only steps — cannot be constructed at all.
 */
export type AudioGraphWriteDeviceParameterCommand = Readonly<{
    kind: 'write-device-parameter';
    target: AudioGraphDeviceParameterTarget;
    write: AudioGraphStepWrite;
}>;

/**
 * Land a whole record of a device's own parameters at the next audio callback,
 * replacing each parameter's current value and leaving whatever the device's
 * stamp queue is holding untouched.
 *
 * The immediate counterpart of {@link AudioGraphWriteDeviceParameterCommand},
 * and a record rather than one write, because what reaches here is a patch: a
 * Fermenter's is around a hundred keys, and a morph or a macro drag reloads the
 * whole record at animation-frame rate. A stamped write cannot carry that — a
 * backend's per-device queue holds a few dozen pending stamps in total, so one
 * patch overruns it several times over — while a value applied on the next
 * callback queues nothing.
 *
 * It addresses a **native built-in** only. An externally hosted plugin's
 * parameters are the plugin's own, addressed over the plugin host's control
 * path, and a backend refuses one aimed there rather than mapping it through a
 * built-in vocabulary that cannot name it.
 *
 * Keys are the built-in's own native parameter names — for a Fermenter, the
 * instrument's snake_case vocabulary, not the camelCase descriptor ids a panel
 * authors. A key the device has no address for refuses the whole batch, naming
 * the device and the key, exactly as {@link
 * AudioGraphWriteDeviceParameterCommand} does: a batch reported applied while
 * some of its values went nowhere is worse than one refused.
 */
export type AudioGraphSetDeviceParametersCommand = Readonly<{
    kind: 'set-device-parameters';
    target: AudioGraphDeviceTarget;
    values: Readonly<Record<string, number>>;
}>;

/**
 * The most parameters one {@link AudioGraphSetDeviceParametersCommand} may
 * carry, mirroring the native mapper's `MAX_IMMEDIATE_DEVICE_PARAMETERS`
 * (`crates/sourdaw-native/src/commands/graph.rs`).
 *
 * The engine charges a record's key count against that ceiling before it parses
 * a single name, and refuses the whole batch over a record that crosses it, so
 * a producer that sends a patch as one record has to know where the line is.
 * The figure is sized from this side rather than from a claimed instrument
 * vocabulary: a Fermenter's patch is one key per field plus one per macro slot,
 * and 128 holds a full one with headroom. This mirror is what pins that fit —
 * the Rust doc says so, and the spec beside it renders every factory preset
 * through the same projection the wire uses and reads the key count.
 */
export const MAX_IMMEDIATE_DEVICE_PARAMETERS = 128;

export type AudioGraphScheduleClipCommand = Readonly<{
    kind: 'schedule-clip';
    playback: AudioGraphClipPlayback;
}>;

/**
 * One note and the position on the backend's clock it sounds at.
 *
 * No block offset: the backend places the note inside whichever block renders
 * `time`, from `time` itself, so a producer stating an offset would be stating a
 * number the backend overwrites. A note therefore survives a locate and every
 * pass a loop makes over it, because it names a position in the arrangement
 * rather than a moment in a queue.
 */
export type AudioGraphMidiNoteEvent = Readonly<{
    /** Absolute position on the backend's clock. */
    time: number;
    note: number;
    velocity: number;
    /** `0` through `15`. */
    channel: number;
    isNoteOn: boolean;
    /**
     * The chance this note sounds, `0` through `1`. Absent means it always
     * plays, which is what a producer writing plain notes wants and what the
     * backend's live note path already answers.
     */
    probability?: number;
    clipIdHash?: number;
    eventIdHash?: number;
    absoluteOccurrenceIndex?: number;
}>;

/**
 * Write notes into the note store a device holds.
 *
 * A rewrite is an {@link AudioGraphClearMidiCommand} and this together, in one
 * {@link AudioGraphCommandBatch}: a batch is one visibility, so the clear
 * settles against the store the whole batch left and reads a note-off it
 * stripped as *moved* rather than deleted. Split across two batches the clear
 * lands first and releases a note the rewrite only meant to lengthen — which is
 * why this is a command in the batch rather than a call of its own.
 *
 * Visible together is not the same as succeeding together. A backend refuses a
 * device holding no note store, and a batch past what its store can hold,
 * while the clear stays applied either way.
 */
export type AudioGraphScheduleMidiCommand = Readonly<{
    kind: 'schedule-midi';
    target: AudioGraphDeviceTarget;
    /**
     * The project's probability seed — `midiStore`'s `probabilitySeed`, minted
     * once per project — which every carrier rolls a chance note with.
     *
     * A project value rather than a note's, so it is stated once for the whole
     * command. It is required rather than defaulted because the roll mixes it
     * first: a stand-in is itself a seed, and it would decide a chance note
     * differently from the live and offline Web Audio carriers, so one
     * arrangement would voice one way in the browser and another way through a
     * backend that supplied its own.
     */
    probabilitySeed: number;
    notes: readonly AudioGraphMidiNoteEvent[];
}>;

/**
 * Play one note now on a device that sinks notes.
 *
 * The note is handed to the device at the head of the first block the backend
 * renders after this batch is applied, and it sounds whether or not the
 * transport is playing: a key struck on a keyboard names no timeline position,
 * so there is none for a stopped playhead to withhold it from. A note that
 * *does* have one travels as {@link AudioGraphScheduleMidiCommand} instead.
 *
 * A backend releases it on a stop or a locate exactly as it releases a stored
 * note, so a note whose note-off never arrives cannot hold an instrument down
 * for the rest of the session. A loop wrap does not: it lifts a stored key,
 * whose note-off lies past the seam and will never render, and leaves a key the
 * player is holding down — no DAW takes a musician's hands off the keyboard
 * where a region starts again.
 */
export type AudioGraphSendMidiNoteCommand = Readonly<{
    kind: 'send-midi-note';
    target: AudioGraphDeviceTarget;
    note: number;
    velocity: number;
    /** `0` through `15`. */
    channel: number;
    isNoteOn: boolean;
}>;

/**
 * Drop the device's scheduled notes between `fromTime` and `toTime`.
 *
 * Half-open, so a producer rewriting one bar clears exactly its span and the
 * note starting the next bar borders the window without being inside it.
 * `toTime` of `null` is the end of the store, so `0` with a null end clears it.
 *
 * A clear naming a device holding no note store is refused by name, on the
 * same terms as `schedule-midi`, so a producer clears only devices it could
 * have scheduled.
 */
export type AudioGraphClearMidiCommand = Readonly<{
    kind: 'clear-midi';
    target: AudioGraphDeviceTarget;
    fromTime: number;
    toTime: number | null;
}>;

/**
 * Where the playhead is and whether it is moving.
 *
 * A backend whose transport is fixed for the lifetime of the render — an
 * offline bounce is one — refuses this rather than accepting it and doing
 * nothing, so a caller that assumed it could seek finds out.
 */
export type AudioGraphSetTransportCommand = Readonly<{
    kind: 'set-transport';
    playing: boolean;
    /** Absolute position on the backend's clock. */
    positionSeconds: number;
    /**
     * Whether this write is also a locate. Absent means it is.
     *
     * A locate is destructive: the backend seeks, and a seek drops every mixer
     * write already queued at or past the frame it lands on. A strip states its
     * fader, its pan and each send level as writes at frame 0, so a transport
     * write that locates to the session head *after* those strips were built
     * erases the mix they declared — which is what a second batch that only
     * needs to start playback would otherwise do.
     *
     * `false` says "roll from where you already stand". The position still
     * travels and must still be truthful, because the backend reports it; only
     * the seek is withheld.
     */
    locate?: boolean;
}>;

/**
 * Shadow the backend's monitor: keep rendering, contribute nothing to the
 * output a listener hears.
 *
 * A session mode, deliberately not the master fader. The master fader is
 * project truth that a save and a bounce both read; this says only whether
 * *this* backend's audio is currently allowed to reach the speakers, so a
 * second engine can hold a live programme — rendering it block-accurately,
 * advancing its own playhead, walking its own loop seams — while another one
 * remains the audible path. Lifting it is the cutover.
 *
 * Silence means true zeros at the output, not a small gain, so a leak is
 * something a test can assert the absence of exactly. The change lands at the
 * next block boundary with no ramp, which makes a cutover from a non-zero
 * programme a step; a backend that wants to declick it owns that.
 *
 * A backend with no monitor to shadow — an offline render is one — refuses
 * this rather than accepting it and doing nothing.
 */
export type AudioGraphSetMonitorShadowCommand = Readonly<{
    kind: 'set-monitor-shadow';
    shadowed: boolean;
}>;

/**
 * Where the master fader stands, as a linear amplitude on the same scale a
 * strip's `gain` uses — `1` is unity and the ceiling is the fader's headroom,
 * not unity.
 *
 * Session-level, like the monitor gate above and unlike everything else in
 * this union: it addresses no strip, so it appears in no
 * {@link AudioGraphStripReport}, and it is deliberately not a
 * {@link AudioGraphStripParameterTarget}. A fader is a gesture, and a gesture
 * has no timeline coordinate: where the hand left it is true at every position,
 * including one the transport reaches by seeking or by wrapping a loop. So this
 * is a target the backend approaches from wherever its fader currently stands,
 * never a change stamped at a frame — which also means no ordering against a
 * locate, and no queue for a drag to overrun.
 *
 * A backend that applies the master level from the project rather than from a
 * live gesture — an offline render is one — refuses this rather than accepting
 * it and doing nothing.
 */
export type AudioGraphSetMasterGainCommand = Readonly<{
    kind: 'set-master-gain';
    gain: number;
}>;

export type AudioGraphCommand =
    | AudioGraphCreateTrackStripCommand
    | AudioGraphCreateBusStripCommand
    | AudioGraphSetTrackOutputCommand
    | AudioGraphAddSendCommand
    | AudioGraphRemoveSendCommand
    | AudioGraphInsertDeviceCommand
    | AudioGraphRemoveDeviceCommand
    | AudioGraphWriteParameterCommand
    | AudioGraphWriteDeviceParameterCommand
    | AudioGraphSetDeviceParametersCommand
    | AudioGraphScheduleClipCommand
    | AudioGraphScheduleMidiCommand
    | AudioGraphSendMidiNoteCommand
    | AudioGraphClearMidiCommand
    | AudioGraphSetTransportCommand
    | AudioGraphSetMonitorShadowCommand
    | AudioGraphSetMasterGainCommand;

/**
 * The correlation a graph write carries, shared with the live delta protocol
 * through the type both name ({@link RuntimeGraphCorrelation}).
 *
 * Shared rather than restated: a second correlation vocabulary with the same
 * job and different words is how two revision checks end up disagreeing about
 * what "stale" means. Bound to the *named* type rather than to
 * `RuntimeGraphDelta['correlation']` so that a reshape of the delta protocol
 * does not silently reshape this file's `schemaVersion` 1 batches.
 */
export type AudioGraphCorrelation = RuntimeGraphCorrelation;

/**
 * One batch, applied whole.
 *
 * `correlation` is optional and its absence is meaningful: a render of a
 * snapshot cannot go stale, because there is no live document racing it. A
 * write into a graph that *is* racing one carries the correlation and is
 * refused when it has already lost.
 */
export type AudioGraphCommandBatch = Readonly<{
    schemaVersion: 1;
    correlation?: AudioGraphCorrelation;
    /**
     * Whether this batch replaces the backend's graph rather than adding to
     * it.
     *
     * A stateful backend keeps its strips between batches and there is no
     * remove-strip command, so a producer that rebuilds a whole topology — the
     * live one rebuilds it every play, because the session drifts between
     * plays — would otherwise collide with the strip ids it created last time.
     * Marking the batch makes the replacement the backend's job, and therefore
     * atomic: nothing is ever observable holding half of each topology.
     *
     * A backend that builds a fresh graph for every batch has nothing to
     * replace and satisfies this by construction.
     */
    replaceTopology?: boolean;
    commands: readonly AudioGraphCommand[];
}>;

/**
 * What one strip a batch touched actually holds after the whole batch.
 *
 * One report law for every backend: a batch reports every strip it created
 * **or whose device chain it edited** (`insert-device`, `remove-device`),
 * each report reading the realized post-batch chain. A backend that refuses
 * chain edits outright (the web backend refuses `insert-device` and
 * `remove-device`) satisfies the law with creation reports alone — the only
 * chain-touching commands it can apply are creates.
 */
export type AudioGraphStripReport = Readonly<{
    kind: 'track' | 'bus';
    id: string;
    /**
     * Device ids present in the built chain, in graph order.
     *
     * An *observation*, not a restatement of what was asked for: a device the
     * backend degraded rather than built is absent here, and a caller that
     * needs to know a chain is intact has to read this rather than trust the
     * command it sent.
     */
    deviceIds: readonly string[];
}>;

/**
 * One external plugin instance a batch handed to the engine.
 *
 * The instance id is the whole payload. A hosted plugin runs inline on the
 * engine's own clock, so it adds nothing to the device's latency beyond what
 * the plugin itself declares, and the caller needs only to know which instances
 * the start took over.
 */
export type AudioGraphAttachedPlugin = Readonly<{
    instanceId: string;
}>;

/**
 * The outcome vocabulary of `RuntimeGraphDeltaResult`, applied to a batch.
 *
 * The three states mean exactly what they mean there — `rejected` is refused
 * before the graph changed, `applied` is whole, `needs-reconcile` is a partial
 * application the caller must resolve against project truth — and the extra
 * field is the reports, because a batch that touched a strip has to say what
 * that strip now holds ({@link AudioGraphStripReport}: created or chain-edited
 * alike).
 */
export type AudioGraphApplyResult =
    | Readonly<{
          acceptance: 'rejected';
          application: 'not-applied';
          reason: string;
      }>
    | Readonly<{
          acceptance: 'accepted';
          application: 'applied';
          correlation?: AudioGraphCorrelation;
          runtimeRevision: number;
          /**
           * The engine's fence number for this batch: what its
           * `batchesApplied` count reaches once the audio thread has drained
           * it. Present only from a backend that fenced a batch onto a live
           * engine — a mapping and an in-process renderer have no such count.
           *
           * A caller that needs to know a transport reading postdates this
           * batch compares the two. Nothing else on a reading can say it:
           * this call resolves when the batch is queued, not when it is
           * applied.
           */
          admittedBatch?: number;
          reports: readonly AudioGraphStripReport[];
          /**
           * External plugin instances this batch handed to the engine.
           *
           * A native engine starts lazily, on the first batch, and a plugin
           * loaded before that is held by the command layer with no engine
           * behind it — it passes silence. Batches register those instances,
           * and this is the only report of it: the load that created them
           * already answered "no engine", and nothing else revises that answer.
           *
           * Any applied batch may carry one, not only the batch that started
           * the engine, because a batch takes only the instances it reserved
           * room for and leaves the rest to its successor. A caller that reads
           * this on one route and not another leaves an instance the engine is
           * running reported as degraded for the session's whole life.
           *
           * Empty when the batch took none. Absent from a backend that hosts no
           * engine at all, and from one whose payload predates the field.
           */
          attachedPlugins?: readonly AudioGraphAttachedPlugin[];
      }>
    | Readonly<{
          acceptance: 'accepted';
          application: 'needs-reconcile';
          /**
           * Whether the backend attempted and failed to undo the part it did
           * apply. A failed compensation never claims the graph was restored.
           */
          compensation: 'not-attempted' | 'failed';
          correlation?: AudioGraphCorrelation;
          reason: string;
          runtimeRevision: number;
          reports: readonly AudioGraphStripReport[];
      }>;

/**
 * A renderer, behind one seam.
 *
 * Deliberately two methods. Everything a backend does to its graph is a
 * command, so there is exactly one place a new capability can be added and
 * exactly one place a backend can refuse — which is what makes "the native
 * backend does not implement X yet" a value a caller can read rather than a
 * silent no-op.
 */
export type AudioGraphBackend = Readonly<{
    /** Identifies the implementation in diagnostics and in parity reports. */
    backendId: string;
    /**
     * Apply one batch. Commands are applied in order, and a command the
     * backend does not implement refuses the **whole** batch before any of it
     * is applied — a half-applied topology is worse than a refused one.
     *
     * Errors that describe the *project* rather than the command — a device
     * the product claims and this backend cannot render — propagate, because
     * folding them into a result would turn a render the user must be told
     * about into one they are not.
     */
    apply: (batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>;
    /** Release everything the backend holds. Idempotent. */
    dispose: () => void;
}>;
