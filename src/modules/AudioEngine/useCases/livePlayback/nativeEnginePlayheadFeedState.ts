/**
 * The one native-engine playhead feed this process may hold (#3067, D3.c.4b).
 *
 * ## Why a poll on the animation frame
 *
 * The engine publishes its position once per audio callback — hundreds of times
 * a second — into a slot that keeps only the newest value. Pushing that across
 * the bridge would wake the renderer per audio block to deliver a number
 * nothing is going to paint. So the seam is a poll, driven from the same
 * `animationScheduler` the cursor's own painting runs on: at most one reading
 * per animation frame, and none at all while the window is not painting, which
 * is exactly when a position nobody can see costs nothing to miss.
 *
 * One request is in flight at a time. A bridge round trip that outlasts a frame
 * must not stack: the reading is a level, not a stream, so a late answer that
 * arrives behind a newer one has nothing to contribute.
 *
 * ## Why the epoch, and not a boolean
 *
 * A bridge round trip can outlive the session that issued it. Stop and play
 * again inside one round trip — a transport tap, or any stop the user
 * immediately reverses — and the feed is running again by the time the old
 * promise resolves, so a `running` check adopts the previous session's position
 * onto the new one. The in-flight flag is the same defect from the other side:
 * released by the stale settlement, it makes the new session's first frame skip
 * its own poll, and released by the new session's own poll it never clears at
 * all. The epoch numbers the sessions. A reading is adopted only by the epoch
 * that asked for it, and a request belongs to an epoch that has since ended
 * exactly as much as it belongs to no one.
 *
 * Module state rather than a parameter for the same reason the live session's
 * is: the engine it reads is process-wide, so a second feed object would be a
 * second belief about a thing there is only one of.
 */

import { logger } from '#/infra/logger/appLogger';

import { type EngineTransportPosition } from '../../models/EngineTransportPosition';
import { getEngineTransportPosition } from '../../repositories/engineTransport/getEngineTransportPosition';

import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';
import { pumpNativeLiveAutomationWriter } from './pumpNativeLiveAutomationWriter';

/** The scheduler id this feed registers its per-frame poll under. */
export const NATIVE_ENGINE_PLAYHEAD_FEED_ID = 'audio-engine/native-engine-playhead';

export const nativeEnginePlayheadFeed: {
    running: boolean;
    /**
     * Which run of the feed is current. Bumped by every start and every stop,
     * so no two runs ever share a number and a settled request can always tell
     * whether the run that issued it is still the live one.
     */
    epoch: number;
    /** The epoch whose request is unanswered, or `null` when none is. */
    inFlightEpoch: number | null;
    reading: EngineTransportPosition | null;
} = {
    running: false,
    epoch: 0,
    inFlightEpoch: null,
    reading: null,
};

/** Ask the engine where it is, unless this run's previous ask is unanswered. */
export function pollNativeEnginePlayheadOnce(): void {
    const epoch = nativeEnginePlayheadFeed.epoch;
    // The pass this read belongs to. A locate or a loop edit re-arms the writer
    // without touching this feed's own run, so the feed's epoch alone cannot
    // tell a reading of the world the new pass lives in from one of the world
    // it replaced — and a reading of the old one would window the new pass at
    // the position the musician just left.
    const writerEpoch = nativeLiveAutomationWriter.epoch;
    // Only this run's own unanswered request holds the line. A request left
    // behind by an earlier run must not make this run skip its first frame.
    if (nativeEnginePlayheadFeed.inFlightEpoch === epoch) {
        return;
    }
    nativeEnginePlayheadFeed.inFlightEpoch = epoch;
    void getEngineTransportPosition()
        .then((reading) => {
            // A reading that lands after its own run ended belongs to a session
            // that is over; keeping it would let the next session start on a
            // stale position.
            if (nativeEnginePlayheadFeed.epoch !== epoch || !nativeEnginePlayheadFeed.running) {
                return;
            }
            nativeEnginePlayheadFeed.reading = reading;
            if (!reading.playing) {
                return;
            }
            // The progress tick is also the automation writer's clock. It is
            // the cadence `crates/sourdaw-native/src/commands/graph.rs` names
            // when it leaves the per-pass re-arm to this side: the snapshot
            // carries both the position the next window is measured from and
            // the wrap count that says a loop seam closed.
            void pumpNativeLiveAutomationWriter({
                positionSeconds: reading.positionSeconds,
                loopWraps: reading.loopWraps,
                writerEpoch,
            });
        })
        .catch((error: unknown) => {
            // A refused poll is not a reason to stop polling: the engine mutex
            // can be momentarily unavailable, and the next frame asks again.
            logger.warn('[AudioEngine] native transport position poll failed:', error);
        })
        .finally(() => {
            // Release only what this request claimed. A newer run may already
            // have a request of its own out, and clearing that would let the
            // frame after it stack a second one.
            if (nativeEnginePlayheadFeed.inFlightEpoch === epoch) {
                nativeEnginePlayheadFeed.inFlightEpoch = null;
            }
        });
}
