import { logger } from '#/infra/logger/appLogger';

import type { createDeviceReadinessDiagnostics } from '../../engine/deviceReadinessDiagnostics';
import type { TrackNode } from '../../engine/TrackNode';
import type { AudioDeviceWaitResult } from '../../models/AudioEngineState';

export type DeviceLoadWaitPorts = Readonly<{
    trackNodes: ReadonlyMap<string, TrackNode>;
    pendingDevicePromises: Set<Promise<unknown>>;
    deviceReadinessDiagnostics: ReturnType<typeof createDeviceReadinessDiagnostics>;
}>;

type ReadinessDiagnostics = DeviceLoadWaitPorts['deviceReadinessDiagnostics'];
type CapturedLoad = ReturnType<TrackNode['capturePendingDeviceLoads']>[number] & {
    observation: ReturnType<ReadinessDiagnostics['captureWaitState']>;
};

type LoadStage = ReturnType<CapturedLoad['observation']['read']>['stage'];
/** Last stage each load reported, keyed by its token id. */
type LoadStages = Map<CapturedLoad['token']['tokenId'], LoadStage>;

type LoadDeadlines = { expired: Set<Promise<unknown>>; nextDeadline: number };

/** Each load's deadline restarts on its own last progress, so a slow load that keeps reporting is never cut off. */
function readLoadDeadlines(
    pending: readonly CapturedLoad[],
    lastKnownStage: LoadStages,
    { waitStartedAtMs, timeoutMs, now }: Readonly<{ waitStartedAtMs: number; timeoutMs: number; now: number }>
): LoadDeadlines {
    const expired = new Set<Promise<unknown>>();
    let nextDeadline = Number.POSITIVE_INFINITY;
    for (const load of pending) {
        const state = load.observation.read();
        if (state.stage !== null) {
            lastKnownStage.set(load.token.tokenId, state.stage);
        }
        const deadline = Math.max(waitStartedAtMs, state.lastActivityAtMs) + timeoutMs;
        if (deadline <= now) {
            expired.add(load.promise);
        } else {
            nextDeadline = Math.min(nextDeadline, deadline);
        }
    }
    return { expired, nextDeadline };
}

function readPendingLoads(
    capturedLoads: readonly CapturedLoad[],
    pendingDevicePromises: ReadonlySet<Promise<unknown>>
): CapturedLoad[] {
    return capturedLoads.filter(({ promise }) => pendingDevicePromises.has(promise));
}

async function raceUntil(allSettled: Promise<boolean>, delayMs: number): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
        allSettled,
        new Promise<false>((resolve) => {
            timeoutId = setTimeout(() => resolve(false), Math.max(0, delayMs));
        }),
    ]);
    if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
    }
    return settled;
}

function summarizeLoads(
    capturedLoads: readonly CapturedLoad[],
    lastKnownStage: ReadonlyMap<CapturedLoad['token']['tokenId'], LoadStage>
): AudioDeviceWaitResult {
    const devices = capturedLoads.map(({ token, observation }) => {
        const state = observation.read();
        return {
            deviceId: token.deviceId,
            status: state.status === 'pending' ? ('cancelled' as const) : state.status,
            stage: state.status === 'ready' ? null : (state.stage ?? lastKnownStage.get(token.tokenId) ?? null),
        };
    });
    let status: AudioDeviceWaitResult['status'] = 'ready';
    if (devices.some((device) => device.status === 'failed')) {
        status = 'failed';
    } else if (devices.some((device) => device.status === 'cancelled')) {
        status = 'cancelled';
    }
    return { status, devices };
}

/**
 * Waits for every device load pending when called. A load that stops reporting
 * progress for `timeoutMs` is timed out on its strip; the rest keep waiting.
 */
export async function waitForDeviceLoads(
    { trackNodes, pendingDevicePromises, deviceReadinessDiagnostics }: DeviceLoadWaitPorts,
    timeoutMs = 10000
): Promise<AudioDeviceWaitResult> {
    const capturedPromises = new Set(pendingDevicePromises);
    if (capturedPromises.size === 0) {
        return { status: 'ready', devices: [] };
    }

    const pendingLoads = [...trackNodes.values()].flatMap((trackNode) => trackNode.capturePendingDeviceLoads());
    const capturedLoads: CapturedLoad[] = pendingLoads
        .filter(({ promise }) => capturedPromises.has(promise))
        .map((load) => ({ ...load, observation: deviceReadinessDiagnostics.captureWaitState(load.token) }));
    try {
        const lastKnownStage = new Map(
            capturedLoads.map(({ token, observation }) => [token.tokenId, observation.read().stage])
        );
        const waitStartedAtMs = Date.now();
        const allSettled = Promise.allSettled(capturedPromises).then(() => true);

        for (
            let pending = readPendingLoads(capturedLoads, pendingDevicePromises);
            pending.length > 0;
            pending = readPendingLoads(capturedLoads, pendingDevicePromises)
        ) {
            const now = Date.now();
            const { expired, nextDeadline } = readLoadDeadlines(pending, lastKnownStage, {
                waitStartedAtMs,
                timeoutMs,
                now,
            });
            if (expired.size > 0) {
                logger.warn(`[AudioEngine] Device loading timed out (${expired.size} pending)`);
                for (const trackNode of trackNodes.values()) {
                    trackNode.timeoutPendingDeviceLoads(expired);
                }
                continue;
            }

            if (await raceUntil(allSettled, nextDeadline - now)) {
                break;
            }
        }
        for (const promise of capturedPromises) {
            pendingDevicePromises.delete(promise);
        }
        return summarizeLoads(capturedLoads, lastKnownStage);
    } finally {
        for (const load of capturedLoads) {
            load.observation.release();
        }
    }
}
