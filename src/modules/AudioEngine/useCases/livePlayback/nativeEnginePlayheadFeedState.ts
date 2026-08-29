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
 * Module state rather than a parameter for the same reason the live session's
 * is: the engine it reads is process-wide, so a second feed object would be a
 * second belief about a thing there is only one of.
 */

import { logger } from '#/infra/logger/appLogger';

import { type EngineTransportPosition } from '../../models/EngineTransportPosition';
import { getEngineTransportPosition } from '../../repositories/engineTransport/getEngineTransportPosition';

/** The scheduler id this feed registers its per-frame poll under. */
export const NATIVE_ENGINE_PLAYHEAD_FEED_ID = 'audio-engine/native-engine-playhead';

export const nativeEnginePlayheadFeed: {
    running: boolean;
    inFlight: boolean;
    reading: EngineTransportPosition | null;
} = {
    running: false,
    inFlight: false,
    reading: null,
};

/** Ask the engine where it is, unless a previous ask is still unanswered. */
export function pollNativeEnginePlayheadOnce(): void {
    if (nativeEnginePlayheadFeed.inFlight) {
        return;
    }
    nativeEnginePlayheadFeed.inFlight = true;
    void getEngineTransportPosition()
        .then((reading) => {
            // A reading that lands after the feed stopped belongs to a session
            // that is over; keeping it would let the next session start on a
            // stale position.
            if (nativeEnginePlayheadFeed.running) {
                nativeEnginePlayheadFeed.reading = reading;
            }
        })
        .catch((error: unknown) => {
            // A refused poll is not a reason to stop polling: the engine mutex
            // can be momentarily unavailable, and the next frame asks again.
            logger.warn('[AudioEngine] native transport position poll failed:', error);
        })
        .finally(() => {
            nativeEnginePlayheadFeed.inFlight = false;
        });
}
