/**
 * Where the native transport has to roll from, given how long its start took
 * (#3577).
 *
 * A session start is not instant: the probe, the topology batch, the plugin
 * re-bind, the transport maps and the MIDI arm are each an awaited bridge round
 * trip, and Web Audio's own transport has been rolling since the gesture that
 * began them. Rolling the engine at the gesture position would therefore start
 * it behind what the listener is already hearing, and the position feed would
 * pull the cursor back with it the moment the session took the carried strips
 * over. So the roll is aimed at where Web Audio has reached by the time the
 * command is sent, and the elapsed time is what this computes.
 *
 * ── The clock is the audio context's ──────────────────────────────────────
 *
 * `startPlayheadScheduler` integrates `AudioContext.currentTime` to advance the
 * playhead, so that clock is the one that placed every frame of Web Audio
 * material this session is catching up to. Measuring the start against
 * `performance.now()` or `Date.now()` would compare two clocks that are free to
 * drift, and the drift would land as an offset between the two engines — which
 * is the very thing being removed.
 *
 * ── The elapsed time is clamped at zero ───────────────────────────────────
 *
 * A suspended context's clock does not advance, and the play gesture's resume
 * is fired rather than awaited, so `now` can read the same value the anchor
 * did — or, if the context was replaced under the start, an earlier one. A
 * negative elapsed time would roll the engine *behind* the gesture position and
 * repeat audio Web Audio has already sounded, so the clamp makes a stalled or
 * reset clock mean "no time passed" rather than "time ran backwards".
 *
 * ── A projection that crosses the loop end wraps ──────────────────────────
 *
 * Web Audio wraps at the seam while the session is starting, so a projection
 * that has crossed the loop end describes a playhead that is already back
 * inside the region; rolling the engine past the end would put the two carriers
 * a whole loop apart. The wrap mirrors the scheduler's own
 * (`startPlayheadScheduler.ts`: `loopStart + ((newPosition - loopStart) %
 * loopLength)`) so both engines land on the same seam arithmetic rather than on
 * two roundings of it.
 *
 * A position that already stands at or past the loop end plays straight
 * through, untouched: that is the engine's stated meaning of a locate past the
 * loop end (`repositionNativeLiveGraphSession.ts`), and the region cannot pull
 * a playhead into itself that never entered it.
 */

import { type EngineLoopRegion } from '../../models/EngineTransportPosition';

export type RollProjectionInput = Readonly<{
    /** Where the gesture asked playback to begin, on the engine's clock. */
    positionSeconds: number;
    /** The context clock reading taken with {@link positionSeconds}. */
    anchoredAtContextSeconds: number;
    /** The context clock reading taken as the roll is about to be sent. */
    nowContextSeconds: number;
    /** The region this session's maps installed, as requested. */
    loopRegion: EngineLoopRegion | null;
    /** Whether the engine answered that it will actually wrap at that region. */
    loopEnabled: boolean;
}>;

export function projectRollPosition(input: RollProjectionInput): number {
    const elapsedSeconds = Math.max(input.nowContextSeconds - input.anchoredAtContextSeconds, 0);
    const projectedSeconds = input.positionSeconds + elapsedSeconds;
    const region = input.loopRegion;
    if (!input.loopEnabled || region === null) {
        return projectedSeconds;
    }
    const loopLengthSeconds = region.endSeconds - region.startSeconds;
    if (loopLengthSeconds <= 0) {
        return projectedSeconds;
    }
    if (input.positionSeconds >= region.endSeconds) {
        return projectedSeconds;
    }
    if (projectedSeconds < region.endSeconds) {
        return projectedSeconds;
    }
    return region.startSeconds + ((projectedSeconds - region.startSeconds) % loopLengthSeconds);
}
