/**
 * Hold the Web Audio transport start until the native session has answered.
 *
 * ── Why a play waits at all ───────────────────────────────────────────────
 *
 * A play on a desktop build starts two carriers of the same arrangement, and
 * they have to open at the same position: the session's MIDI arm queues the
 * note pass from the beat play opens on, and the engine delivers only the
 * notes at or after the block it starts rendering. The session's own start
 * costs several awaited round trips, so the two do not naturally coincide.
 * Making the engine skip forward to wherever Web Audio had reached (#3577)
 * closed the gap from the wrong side: the roll then located past every note-on
 * stamped in the skipped window, and nothing else sounded them — a carried
 * strip's Web Audio gate is pinned to zero shortly after the claim, and a
 * native-hosted instrument has no Web Audio voice at all. So Web Audio waits
 * for the engine instead. A short latency between the click and the first
 * sound is what every established DAW accepts here; dropping the material at
 * the play position is not.
 *
 * ── Why the generation, and `isPlaying` as well ───────────────────────────
 *
 * The wait spans a gesture the musician can end. `schedulerSession.generation`
 * is the identity every ending bumps — `stopPlayheadScheduler` (stop, pause and
 * a seek taken while playing), `disposePlayheadScheduler`, and
 * `startPlayheadScheduler` itself — so comparing it makes a stop, pause, seek
 * or dispose landing inside the hold leave the transport alone, and keeps a
 * seek that has already restarted the scheduler from starting it twice.
 * `isPlaying` cannot carry that identity: it is shared by every play, so a stop
 * and a fresh play inside the hold would leave it true and this continuation
 * would re-snap the new play's scheduler. It is still required alongside the
 * generation because `pausePlayback` clears the flag straight away and only
 * bumps the generation behind its recording flush, so a pause inside the hold
 * can reach the end of the wait with the generation it opened on.
 */

import { getTransportState } from '../../repositories/transport/getTransportState';
import { schedulerSession } from '../playheadScheduler/schedulerSession';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';

/**
 * The nightly desktop-latency record measures the roll landing 75–88 ms after
 * the click, so the cap sits at about three times that: an addon that hangs
 * cannot silence Play, it only costs this long before the transport falls back
 * to the old behaviour — Web Audio ahead of the engine, and the cursor snapping
 * back when the engine's first reading arrives.
 */
const NATIVE_SESSION_HOLD_CAP_MS = 250;

export async function startSchedulerWhenNativeSessionSettles(
    session: Promise<void>,
    generation: number
): Promise<void> {
    let capTimerId: ReturnType<typeof setTimeout> | null = null;
    const holdCap = new Promise<void>((resolve) => {
        capTimerId = setTimeout(resolve, NATIVE_SESSION_HOLD_CAP_MS);
    });

    try {
        await Promise.race([session, holdCap]);
    } finally {
        if (capTimerId !== null) {
            clearTimeout(capTimerId);
        }
    }

    if (schedulerSession.generation !== generation || getTransportState()?.isPlaying !== true) {
        return;
    }
    startPlayheadScheduler();
}
