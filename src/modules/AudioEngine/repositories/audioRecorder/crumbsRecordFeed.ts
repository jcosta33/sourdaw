import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopBridge';

import { createCrumbsRecordFeedNode, type CrumbsRecordFeedHandle } from '../../engine/CrumbsRecordFeedNode';
import { audioEngine } from '../createWebAudioEngine';

import { feedCrumbsRecordInput } from './feedCrumbsRecordInput';
import { inputMonitoringSession } from './inputMonitoringSession';

/**
 * Session state for the crumbs record feed tap.
 *
 * The tap exists only while a crumbs recording is armed — the same gate the
 * plugin relay uses (its worklet exists only for a live bridged plugin) — so
 * an idle app runs no per-quantum IPC at all. Arm and stop are idempotent:
 * `start` while armed keeps the existing tap, `stop` while disarmed is a
 * no-op.
 */
type CrumbsRecordFeedSession = {
    armed: boolean;
    handle: CrumbsRecordFeedHandle | null;
    /** Zero-gain sink that keeps the tap pulled by the render quantum. */
    silentSink: GainNode | null;
    /** Guards against a second arm starting a parallel tap while the
     * worklet module registration is still in flight. */
    starting: Promise<void> | null;
};

const session: CrumbsRecordFeedSession = {
    armed: false,
    handle: null,
    silentSink: null,
    starting: null,
};

function destroyTap(): void {
    session.handle?.destroy();
    session.handle = null;
    try {
        session.silentSink?.disconnect();
    } catch {
        // The context may already be closed around us.
    }
    session.silentSink = null;
}

/** Connect the live monitor source to the armed tap, if both exist. */
export function attachCrumbsRecordFeedToMonitorSource(): void {
    const { monitorSource } = inputMonitoringSession;
    if (session.armed && session.handle && monitorSource) {
        session.handle.attachTo(monitorSource);
    }
}

/**
 * Arm the record feed: install the tap on the monitored input bus.
 *
 * Called from the crumbs arm use case once the native arm is accepted. If
 * input monitoring is not running yet there is nothing to tap — the tap
 * attaches when monitoring starts (`startInputMonitoring` calls
 * {@link attachCrumbsRecordFeedToMonitorSource}), because the monitored input
 * bus is the feed's one and only source.
 */
export function startCrumbsRecordFeed(): void {
    if (!isDesktopRuntime() || session.armed || session.starting) {
        return;
    }
    session.armed = true;
    session.starting = (async () => {
        try {
            const ctx = audioEngine.context;
            const handle = await createCrumbsRecordFeedNode(ctx, (audioBytes) => feedCrumbsRecordInput(audioBytes));
            // Disarmed while the worklet module was registering: the stop
            // path could not destroy what did not exist yet.
            if (!session.armed) {
                handle.destroy();
                return;
            }
            session.handle = handle;
            const sink = ctx.createGain();
            sink.gain.value = 0;
            handle.workletNode.connect(sink);
            sink.connect(ctx.destination);
            session.silentSink = sink;
            attachCrumbsRecordFeedToMonitorSource();
        } catch (error) {
            logger.warn(`[CrumbsRecordFeed] record tap unavailable: ${String(error)}`);
        } finally {
            session.starting = null;
        }
    })();
}

/** Disarm the record feed: stop posting blocks and tear the tap down. */
export function stopCrumbsRecordFeed(): void {
    session.armed = false;
    session.starting = null;
    destroyTap();
}
