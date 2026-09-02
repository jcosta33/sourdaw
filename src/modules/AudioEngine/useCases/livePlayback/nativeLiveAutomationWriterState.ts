/**
 * The one live automation writer this process may hold (#3068, D3.c.4b).
 *
 * ## Why a window, and why this size
 *
 * The engine holds no automation curve. Each `RampedParam` holds a fixed queue
 * of [`AUTOMATION_QUEUE_CAPACITY`] stamped writes — eight — which the audio
 * thread consumes as the playhead passes them, and a write past that ceiling
 * refuses the whole batch (`QueueBudgets::charge_automation` in
 * `crates/sourdaw-native/src/commands/graph.rs`). So the curve stays on this
 * side and reaches the engine as a moving window: far enough ahead that a
 * frame the renderer misses cannot starve the parameter, far enough under the
 * ceiling that a batch is not refused for arriving one write too early.
 *
 * {@link AUTOMATION_WINDOW_SECONDS} is that lookahead and
 * {@link AUTOMATION_FILL_BUDGET} is the per-target fill. Six of eight leaves
 * two slots for the writes an earlier pump queued and the engine has not
 * walked past yet — the control-side ledger is deliberately conservative
 * between progress echoes, so headroom is what keeps an ordinary pump from
 * being refused for a slot that is already free.
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
 * to the epoch that issued it, and an epoch that has ended owns nothing.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphParameterWrite, type AudioGraphStripParameterTarget } from '../../models/AudioGraphBackend';

/** How far ahead of the engine's own clock one pump admits writes. */
export const AUTOMATION_WINDOW_SECONDS = 0.1;

/**
 * The most writes one pump admits for one target. Under the engine's
 * eight-slot per-parameter queue by two, so a pump is not refused for slots an
 * earlier one still holds (see this file's header).
 */
export const AUTOMATION_FILL_BUDGET = 6;

/** One parameter's share of the pass: its curve, and how much of it has landed. */
export type LiveAutomationWriterTarget = {
    target: AudioGraphStripParameterTarget;
    /** This target's writes for the whole region, ascending by start time. */
    writes: readonly AudioGraphParameterWrite[];
    /** How many of {@link writes} the engine has accepted. */
    cursor: number;
};

/** One pass over one region: what the writer is playing, and how far it has got. */
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
    regionStartSeconds: number;
    regionEndSeconds: number;
    /** Whether the region is a loop the engine will actually wrap. */
    looping: boolean;
    targets: LiveAutomationWriterTarget[];
    /**
     * The engine's cumulative wrap count as of the last snapshot this pass saw,
     * or `null` until it has seen one. The engine counts wraps since *it*
     * started, not since this pass armed, so the first snapshot establishes the
     * count rather than reporting a seam.
     */
    lastLoopWraps: number | null;
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
} = {
    epoch: 0,
    inFlightEpoch: null,
    pass: null,
};

/** Where a write's trajectory is anchored: a ramp's start, any other shape's own stamp. */
export function writeStartSeconds(write: AudioGraphParameterWrite): number {
    if (write.shape === 'ramp-to') {
        return write.startTime;
    }
    return write.time;
}
