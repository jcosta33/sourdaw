import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { nativeEnginePlayheadFeed, NATIVE_ENGINE_PLAYHEAD_FEED_ID } from './nativeEnginePlayheadFeedState';

/**
 * Stop reading, and forget the last position read.
 *
 * Forgetting matters: a reading kept across a stop would still answer while the
 * engine is parked, and the next play would open on the position the previous
 * one ended at.
 */
export function stopNativeEnginePlayheadFeed(): void {
    if (!nativeEnginePlayheadFeed.running) {
        return;
    }
    nativeEnginePlayheadFeed.running = false;
    nativeEnginePlayheadFeed.reading = null;
    animationScheduler.unregister(NATIVE_ENGINE_PLAYHEAD_FEED_ID);
}
