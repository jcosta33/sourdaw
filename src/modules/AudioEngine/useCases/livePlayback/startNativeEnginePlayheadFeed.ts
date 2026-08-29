import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import {
    nativeEnginePlayheadFeed,
    pollNativeEnginePlayheadOnce,
    NATIVE_ENGINE_PLAYHEAD_FEED_ID,
} from './nativeEnginePlayheadFeedState';

/**
 * Begin reading the native engine's playhead once per animation frame.
 *
 * Idempotent: a second start on a running feed changes nothing, so a session
 * that restarts without a stop cannot end up with two registrations.
 */
export function startNativeEnginePlayheadFeed(): void {
    if (nativeEnginePlayheadFeed.running) {
        return;
    }
    nativeEnginePlayheadFeed.running = true;
    // A new run, so a request the previous one left in flight can neither be
    // adopted here nor hold this run's first frame back.
    nativeEnginePlayheadFeed.epoch += 1;
    nativeEnginePlayheadFeed.reading = null;
    animationScheduler.register(NATIVE_ENGINE_PLAYHEAD_FEED_ID, pollNativeEnginePlayheadOnce);
}
