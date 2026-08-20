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
 * It is deliberately **larger** than today's `GraphCommand`, because the web
 * strip expresses four behaviors the native timeline cannot yet
 * (jcosta33/sourdaw#2085), and a contract sized to the smaller of the two would
 * make the native backend's gaps invisible until the null test failed:
 *
 *   1. A **pre-fader solo gate** distinct from the post-fader mute gate
 *      ({@link AudioGraphParameterTarget}). The native strip has one `muted`
 *      flag applied post-fader; folding solo into it puts the gate downstream
 *      of the pre-fader send tap, so a non-soloed track keeps feeding its cue
 *      bus.
 *   2. **Bus device chains** ({@link AudioGraphCreateBusStripCommand}). A send
 *      bus that cannot host a reverb defeats the purpose of a send bus.
 *   3. **Cancel-and-replace automation** ({@link AudioGraphParameterWrite}).
 *      The web write path re-anchors and replaces the pending ramp on every
 *      interactive tick; an append-only queue of fixed slots cannot receive
 *      that, and there is no equivalent of holding a param on transport stop.
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
 * today refuses `bus -> track` outright (`Timeline::set_bus_output` records
 * `invalid_bus_routing` and drops the command). A backend that cannot honour a
 * route must **refuse the batch** rather than drop the route, because a dropped
 * route is a strip that silently stops reaching the mix. Closing that gap —
 * either by supporting bus -> track natively or by narrowing this law — is a
 * D3 obligation, and it is stated here so it is not discovered as a silence.
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
 * A built-in device's own parameter, in the device's units.
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
     * anything else is the clip's stretch or its transposition, and the native
     * `TimelineClip` has nowhere to put it today (#2085 §4).
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
 * Identical in kind to a track strip, and that is the point — #2085 §2 records
 * the native bus as gain-plus-routing with nowhere to put an insert, which
 * makes a reverb bus unrepresentable. The command is separate from
 * {@link AudioGraphCreateTrackStripCommand} because **creation** differs — a
 * bus sums its inputs — not because a bus is addressed differently afterwards.
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

export type AudioGraphScheduleClipCommand = Readonly<{
    kind: 'schedule-clip';
    playback: AudioGraphClipPlayback;
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
    | AudioGraphScheduleClipCommand
    | AudioGraphSetTransportCommand;

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
    commands: readonly AudioGraphCommand[];
}>;

/** What a strip-creating command actually built. */
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
 * The outcome vocabulary of `RuntimeGraphDeltaResult`, applied to a batch.
 *
 * The three states mean exactly what they mean there — `rejected` is refused
 * before the graph changed, `applied` is whole, `needs-reconcile` is a partial
 * application the caller must resolve against project truth — and the extra
 * field is the reports, because a batch that builds strips has to say what it
 * built.
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
          reports: readonly AudioGraphStripReport[];
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
