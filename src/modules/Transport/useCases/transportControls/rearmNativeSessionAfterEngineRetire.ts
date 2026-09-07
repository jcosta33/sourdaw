/**
 * Restart the native session, at the live playhead, after a lost engine was
 * retired mid-play (#3960).
 *
 * `retireOrphanedNativeEngine` empties the engine slot a stalled session left
 * behind and bumps `nativeEngineRearmStore`. That is an offer, not a command:
 * the AudioEngine module owns the engine, but whether a musician is still
 * playing — and from what beat — is the transport's own state, so the decision
 * lands here.
 *
 * ── The guard is claimed before the reload, not after ─────────────────────
 *
 * Reloading the plugins the retire destroyed is a round trip per instance, and
 * the same device that killed the first engine can kill the re-armed one while
 * that reload is still in the air. Claiming
 * `claimNativeSessionRearm` up front is what makes the second offer a no-op
 * instead of a second re-arm queued behind the first — a flapping headset would
 * otherwise cycle the renderer through restarts for as long as it flaps. A
 * second loss in the same play leaves the transport on Web Audio, which still
 * sounds every strip; the musician's next stop and play boots an engine again.
 *
 * ── The position is read at the start, not at the offer ───────────────────
 *
 * The reload is awaited between the two, and the transport keeps rolling
 * across it. Capturing the beat when the offer arrived would start the engine
 * behind the Web Audio playhead by however long the plugins took to load, and
 * the native programme would sound against a timeline that had already moved
 * on. `playheadPositionRef` is the live channel the scheduler writes, so
 * reading it at the moment of the start is reading where the musician actually
 * is.
 */

import { logger } from '#/infra/logger/appLogger';
import { nativeEngineRearmStore } from '#/modules/AudioEngine/stores';
import { claimNativeSessionRearm } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../ensureTrackStrips';

import { startNativeSessionAtBeat } from './startNativeSessionAtBeat';

async function rearmNativeSession(tempo: number): Promise<void> {
    const strips = ensureTrackStrips({ collectExternalPluginActivations: true });
    if (strips.status === 'failed') {
        logger.warn(`Native session re-arm found no usable strips to rebuild: ${strips.reason}`);
        return;
    }
    // Awaited, not fired: the retire forgot every instance the engine drained,
    // so the start batch would attach none of them if it ran first — and no
    // later batch reloads a plugin the projection already believes is live.
    await Promise.allSettled(strips.externalPluginActivations);
    // The reload spans seconds, one round trip per instance, and the transport
    // keeps running across it — a Stop that lands inside must win. Without
    // this re-read, a settled activation would still start a session, booting
    // an engine rolling from beat 0 with the transport stopped and nothing
    // left to park it.
    if (!getTransportState()?.isPlaying) {
        logger.info('The play ended while the native session reloaded; the re-arm stays down.');
        return;
    }
    startNativeSessionAtBeat(playheadPositionRef.current, tempo);
}

/**
 * Subscribes to `nativeEngineRearmStore` and returns the unsubscribe. Callers
 * own the teardown, the same contract `syncTransportMapsToNativeSession`
 * follows.
 */
export function rearmNativeSessionAfterEngineRetire(): () => void {
    return nativeEngineRearmStore.subscribe(() => {
        const state = getTransportState();
        if (!state?.isPlaying) {
            // Nothing is rolling, so there is nothing to re-arm: the next play
            // boots an engine of its own on the current default device.
            return;
        }
        if (!claimNativeSessionRearm()) {
            logger.info(
                'A second native engine loss in the same play; the transport stays on Web Audio until the next play.'
            );
            return;
        }
        void rearmNativeSession(state.tempo);
    });
}
