import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopBridge';

import { createCrumbsRecordFeedNode } from '../../engine/CrumbsRecordFeedNode';
import { audioEngine } from '../createWebAudioEngine';

import { crumbsRecordFeedSession, destroyCrumbsRecordFeedTap } from './crumbsRecordFeedSession';
import { feedCrumbsRecordInput } from './feedCrumbsRecordInput';
import { inputMonitoringSession } from './inputMonitoringSession';

async function createAndInstallTap(generation: number): Promise<void> {
    try {
        const ctx = audioEngine.context;
        const handle = await createCrumbsRecordFeedNode(ctx, (audioBytes) => feedCrumbsRecordInput(audioBytes));
        if (generation !== crumbsRecordFeedSession.generation || crumbsRecordFeedSession.armedInstances.size === 0) {
            // Superseded by a stop/re-arm cycle, or nobody is armed anymore:
            // this handle is the stale one, and it destroys itself rather
            // than leaking a tap that feeds every quantum forever.
            handle.destroy();
            return;
        }
        // Structural guard: an installed handle is destroyed before any
        // replacement lands, so two taps can never both be live.
        destroyCrumbsRecordFeedTap();
        crumbsRecordFeedSession.handle = handle;
        const sink = ctx.createGain();
        sink.gain.value = 0;
        handle.workletNode.connect(sink);
        sink.connect(ctx.destination);
        crumbsRecordFeedSession.silentSink = sink;
        const { monitorSource } = inputMonitoringSession;
        if (monitorSource) {
            handle.attachTo(monitorSource);
        }
    } catch (error) {
        logger.warn(`[CrumbsRecordFeed] record tap unavailable: ${String(error)}`);
    } finally {
        if (crumbsRecordFeedSession.startingGeneration === generation) {
            crumbsRecordFeedSession.startingGeneration = null;
        }
    }
}

/**
 * Arm the record feed for one crumbs instance: it shares (or starts) the tap
 * on the monitored input bus.
 *
 * Called from the crumbs arm use case once that instance's native arm is
 * accepted. If input monitoring is not running yet there is nothing to tap —
 * the tap attaches when monitoring starts (`startInputMonitoring` calls
 * `attachCrumbsRecordFeedToMonitorSource`), because the monitored input bus
 * is the feed's one and only source. Idempotent per instance, and inert
 * outside the desktop app.
 */
export function startCrumbsRecordFeed(instanceId: string): void {
    if (!isDesktopRuntime()) {
        return;
    }
    crumbsRecordFeedSession.armedInstances.add(instanceId);
    if (crumbsRecordFeedSession.handle !== null || crumbsRecordFeedSession.startingGeneration !== null) {
        // A tap is already installed or a current start is bringing the
        // shared tap up: this instance joins it.
        return;
    }
    const generation = ++crumbsRecordFeedSession.generation;
    crumbsRecordFeedSession.startingGeneration = generation;
    void createAndInstallTap(generation);
}
