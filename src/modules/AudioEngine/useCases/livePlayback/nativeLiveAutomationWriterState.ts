/**
 * The one live automation writer this process may hold (#3068, D3.c.4b).
 *
 * ## Why a window, and why it is measured against a mirrored ledger
 *
 * The engine holds no automation curve. Each `RampedParam` holds a fixed queue
 * of [`AUTOMATION_QUEUE_CAPACITY`] stamped writes, which the audio thread
 * consumes as the playhead passes them, and a write past that ceiling refuses
 * the whole batch (`QueueBudgets::charge_automation` in
 * `crates/sourdaw-native/src/commands/graph.rs`). So the curve stays on this
 * side and reaches the engine as a moving window: far enough ahead that a frame
 * the renderer misses cannot starve the parameter, never wider than the ledger
 * that admits it.
 *
 * A fixed per-pump count cannot express that ceiling. The control-side ledger
 * frees a slot per stamp, not per batch — a queued write releases only once the
 * echoed playhead has passed its *start* frame or, for a stamp a looping
 * playhead never passes, once the seam half of `proven_popped` proves one
 * whole pass ran with it queued — and a curved lane compiles onto a 10 ms
 * grid, so a 0.1 s lookahead can hold ten writes for one parameter. Sending a
 * fixed six would be refused two ticks in three on exactly the lanes
 * automation matters most for. {@link LiveAutomationWriterTarget} therefore
 * mirrors the ledger: what a pump may add is the capacity minus what the
 * mirror still believes is queued, minus {@link AUTOMATION_QUEUE_MARGIN}.
 *
 * ## Why module state
 *
 * The same reason the live session's and the playhead feed's are: the engine
 * these writes address is process-wide, so a second writer object would be a
 * second belief about a thing there is only one of.
 *
 * ## Why the epoch
 *
 * A batch can outlive the pass that issued it. Stop, seek, or a loop edit ends
 * a pass while a pump's bridge round trip is still out, and that answer must
 * not advance a cursor into a pass that no longer exists — the cursors would
 * then be a claim about writes the engine either never received or has already
 * had cancelled under it. The epoch numbers the passes: a settled pump belongs
 * to the epoch that issued it, and an epoch that has ended owns nothing. The
 * playhead feed stamps its own reads with it for the same reason, so a position
 * read before a re-arm cannot window the pass that replaced it.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphParameterTarget, type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';

/** How far ahead of the engine's own clock one pump admits writes. */
export const AUTOMATION_WINDOW_SECONDS = 0.1;

/** `AUTOMATION_QUEUE_CAPACITY` in `crates/daw-engine/src/timeline.rs`. */
export const AUTOMATION_QUEUE_CAPACITY = 8;

/**
 * `DEVICE_PARAM_QUEUE_CAPACITY` in `crates/daw-engine/src/timeline.rs`.
 *
 * Not a second automation queue: one queue per *effect*, shared by every
 * parameter of the plugin in it — so the mirror charges every device slot of
 * one `(trackId, deviceId)` against this one ceiling, not against a ceiling
 * each (`QueueBudgets::charge_device_param` keys per effect).
 */
export const DEVICE_PARAM_QUEUE_CAPACITY = 64;

/**
 * One slot this side never fills. The mirror releases on the echoed playhead,
 * and that echo is a frame or two behind the engine's own; the same echo is
 * also the newest wrap count a send tick can anchor at, however much newer the
 * engine's own is by the time the batch lands. The margin is what keeps those
 * lags from turning into a refusal.
 */
export const AUTOMATION_QUEUE_MARGIN = 1;

/**
 * `SEAMS_PROVING_A_WHOLE_PASS` in `crates/sourdaw-native/src/commands/graph.rs`.
 *
 * How many seams must close after a stamp is known queued before one whole
 * pass is proven to have run with it there. One is not enough: the seam that
 * closes first ends the pass the stamp was admitted into, and the playhead may
 * already have been past the stamp when it landed, so that pass proves nothing
 * about it. The pass between the first and second seam is the earliest one
 * that ran from the region's start with the stamp queued.
 */
export const SEAMS_PROVING_A_WHOLE_PASS = 2;

/**
 * One write the mirror believes the engine's queue still holds.
 *
 * Frames, not seconds, because both the release proof and the cancellation law
 * this mirrors compare frames — `graph.rs` rounds every stamp through
 * `seconds_to_frames` before it charges anything.
 *
 * Mutable, the way `release_landed`'s `retain_mut` mutates `PendingStamp` in
 * place: the fence and the anchor land on the stamp after it enters the
 * ledger, and an admission's queue arrays share these objects with the slot's.
 */
export type LiveAutomationQueuedStamp = {
    /** What the release proof compares: `PendingStamp::at_frame`. */
    startFrame: number;
    /** What a replace's cancellation compares: `PendingStamp::lands_at`. */
    landFrame: number;
    /**
     * `PendingStamp::admitted_batch`: the engine fence number of the batch that
     * carried this stamp, read off the apply result's `admittedBatch` — what a
     * snapshot's `batchesApplied` reaches once that batch has drained. `null`
     * when the backend reports no fence (a mapping or an in-process renderer
     * has none), which is what the anchor's fallback answers for. Both the
     * playhead and seam release proofs in `provenPopped` require `batchesApplied >=
     * admittedBatch` (matching `crates/sourdaw-native/src/commands/graph.rs:913-920, 950`).
     */
    admittedBatch: number | null;
    /**
     * `PendingStamp::landed_wraps`: the engine's loop-wrap count the seam half
     * of `proven_popped` measures {@link SEAMS_PROVING_A_WHOLE_PASS} from. The
     * engine sets it only from `release_landed` — which runs only as a batch
     * is admitted — and only once this stamp's own batch has drained, so the
     * mirror sets it only on a tick that sends a batch and whose snapshot has
     * reached {@link admittedBatch}. When that fence is `null` there is no
     * drain to wait on, and the first tick that finds the stamp queued anchors
     * it instead, the cadence the mirror ran before fences were read. `null`
     * until either sets it.
     */
    seamAnchor: number | null;
};

/** One parameter's share of the pass: its curve, how much of it has landed, and what the engine still holds. */
export type LiveAutomationWriterTarget = {
    target: AudioGraphParameterTarget;
    /** This target's writes for its span, ascending by start time. */
    writes: readonly AudioGraphParameterWrite[];
    /** How many of {@link writes} the engine has accepted. */
    cursor: number;
    /** The mirror of this parameter's engine-side queue, ascending by start frame. */
    queued: LiveAutomationQueuedStamp[];
};

/**
 * One pass over one span, and the span it takes after a seam.
 *
 * A loop is two spans, not one. The engine wraps only a playhead that is
 * already below the loop end (`Scheduler::frames_until_loop_end`), so the take
 * the musician is listening to runs from wherever they started playing to that
 * end — and the region entire is what every later pass runs. Both are read at
 * arm, because the seam arrives on an animation frame and re-reading the stores
 * there would put a projection on the tick that has to send writes.
 */
export type LiveAutomationWriterPass = {
    /**
     * The strips the session's topology actually built. Held rather than
     * re-read, because a write addressed to a strip the engine does not hold
     * refuses the whole batch — and a re-arm after a seek must not start
     * naming strips a later project edit added.
     */
    stripTracks: readonly Track[];
    sampleRate: number;
    /** Where the session's programme ends, on the engine clock. */
    programmeEndSeconds: number;
    /** Where this pass began, on the engine clock. */
    entrySeconds: number;
    /**
     * The engine fence number of the command that put the transport where this
     * pass begins, or `null` when no such command reported one.
     *
     * A pass is armed after a locate, a roll or a maps install has *resolved*,
     * and resolving means the batch was fenced onto the engine's command ring
     * — not that the audio thread drained it. So the readings that arrive next
     * may still be from before the move. This number is what dates them: a
     * snapshot whose `batchesApplied` has not reached it was read in the world
     * this pass replaced, and nothing on that snapshot's face says so.
     */
    provenAfterBatch: number | null;
    /** Whether the engine will actually wrap this pass. */
    looping: boolean;
    /** The span being sent now. */
    targets: LiveAutomationWriterTarget[];
    /** The whole loop region, taken at the first seam; `null` when nothing wraps. */
    loopTargets: LiveAutomationWriterTarget[] | null;
    /**
     * The engine's cumulative wrap count as of the last snapshot this pass saw,
     * or `null` until it has seen one. The counter is monotonic for the life of
     * the engine's scheduler rather than of a pass, so the first snapshot
     * establishes it; a seam closed before that snapshot is caught by the
     * playhead instead (see `pumpNativeLiveAutomationWriter`).
     */
    lastLoopWraps: number | null;
    /**
     * The floor of the engine's `last_wrap_frame` for this pass's loop, or
     * `null` when the pass does not wrap.
     *
     * The engine records the frame its block walk had reached when the seam
     * closed — `block_start + span` in `Scheduler::advance_playhead`, always at
     * or past the loop end — and the seam half of `proven_popped` releases
     * every stamp stamped strictly below it. That frame is published nowhere
     * this side reads, so the mirror holds the loop end frame: below every
     * `last_wrap_frame` the engine can record, and above every start frame the
     * arm's own end clip admits, so the proof releases exactly the stamps the
     * engine's does and never one it would not.
     */
    wrapFloorFrame: number | null;
    /** Whether this pass has already reported the engine's queue full. */
    queueFullReported: boolean;
};

export const nativeLiveAutomationWriter: {
    /**
     * Which pass is current. Bumped by every arm and every disarm, so no two
     * passes ever share a number and a settled batch can always tell whether
     * the pass that issued it is still the live one.
     */
    epoch: number;
    /** The epoch whose batch is unanswered, or `null` when none is. */
    inFlightEpoch: number | null;
    pass: LiveAutomationWriterPass | null;
    /**
     * What the previous arm excluded. Every locate and every loop edit re-arms,
     * so a lane the producer cannot carry would otherwise be reported on each
     * of them; the set is what is worth saying, not the number of times it was
     * recomputed.
     */
    reportedExclusions: string | null;
    /**
     * A re-read the pass owes, recorded rather than taken (#3568).
     *
     * A plugin the engine takes mid-roll is spliced into its chain by a route
     * the pump itself can reach — an automation batch reports the attach, and
     * the splice answers it. The pass must be re-read once that splice lands,
     * because the projection could not see a device the chain did not hold; but
     * a splice that armed the writer directly would make the writer's own pump
     * reach back into the arm that starts it, which is a cycle in the module
     * graph and a re-entrant arm at runtime.
     *
     * So the splice states what it needs and the playhead feed takes it, on the
     * next reading, immediately before the pump that would have sent the pass.
     * The engine position that reading carries is fresher than anything the
     * splice could have supplied, and the pump behind it is the same one.
     */
    pendingRearm: Readonly<{ provenAfterBatch: number | null }> | null;
} = {
    epoch: 0,
    inFlightEpoch: null,
    pass: null,
    reportedExclusions: null,
    pendingRearm: null,
};

/** Where a write's trajectory is anchored: a ramp's start, any other shape's own stamp. */
export function writeStartSeconds(write: AudioGraphParameterWrite): number {
    if (write.shape === 'ramp-to') {
        return write.startTime;
    }
    return write.time;
}
