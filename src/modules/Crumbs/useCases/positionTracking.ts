/**
 * Playback position tracking.
 * Polls the backend at 30Hz and provides a rAF-interpolated position
 * for smooth 60fps cursor rendering.
 */

import { logger } from '#/infra/logger/appLogger';

import { getCrumbsPosition } from '../repositories/crumbsBridge/getCrumbsPosition';
import { isCrumbsNativeAvailable } from '../repositories/is-crumbs-native-available';

import { interpolateFrame } from './interpolateFrame';

type PositionListener = (frame: number) => void;

type PollingSession = {
    pollTimer: ReturnType<typeof setInterval> | null;
    rafId: number | null;
    lastPolledFrame: number;
    prevPolledFrame: number;
    pollTimestamp: number;
    interpolatedFrame: number;
    pollInFlight: boolean;
    listeners: Set<PositionListener>;
};

const sessions = new Map<string, PollingSession>();

const POLL_INTERVAL_MS = 33; // ~30Hz

function getOrCreateSession(instanceId: string): PollingSession {
    let session = sessions.get(instanceId);
    if (!session) {
        session = {
            pollTimer: null,
            rafId: null,
            lastPolledFrame: 0,
            prevPolledFrame: 0,
            pollTimestamp: 0,
            interpolatedFrame: 0,
            pollInFlight: false,
            listeners: new Set<PositionListener>(),
        };
        sessions.set(instanceId, session);
    }
    return session;
}

function startPolling(instanceId: string): void {
    const session = getOrCreateSession(instanceId);
    if (session.pollTimer !== null) {
        return;
    }

    // Crumbs position data is sourced from the Rust audio host via native IPC.
    // On the browser build the bridge has nothing to answer with, so the 30 Hz
    // poll would otherwise spam a warn per tick — just stay idle.
    if (!isCrumbsNativeAvailable()) {
        return;
    }

    session.pollTimestamp = performance.now();

    session.pollTimer = setInterval(() => {
        // Skip overlapping polls: setInterval keeps firing on schedule even if a
        // previous getCrumbsPosition await is still pending. Without this guard,
        // out-of-order await resumes could overwrite prev/last out of sequence and
        // feed the interpolator a negative delta.
        if (session.pollInFlight) {
            return;
        }
        session.pollInFlight = true;
        void (async () => {
            try {
                const frame = await getCrumbsPosition(instanceId);
                session.prevPolledFrame = session.lastPolledFrame;
                session.lastPolledFrame = frame;
                session.pollTimestamp = performance.now();
            } catch (error) {
                logger.warn(`Crumbs position poll failed for ${instanceId}:`, error);
            } finally {
                session.pollInFlight = false;
            }
        })();
    }, POLL_INTERVAL_MS);

    // rAF loop for 60fps interpolation.
    function tick(): void {
        const now = performance.now();
        const elapsed = now - session.pollTimestamp;
        const t = Math.min(elapsed / POLL_INTERVAL_MS, 1);

        // Linear interpolation between last two polled positions (reset-guarded).
        session.interpolatedFrame = interpolateFrame(session.prevPolledFrame, session.lastPolledFrame, t);

        for (const listener of session.listeners) {
            // A throwing listener (e.g. a WaveformDisplay cursor mutation after
            // unmount) must not escape the loop — otherwise the rAF below never
            // reschedules and the cursor freezes permanently for every session.
            try {
                listener(session.interpolatedFrame);
            } catch (error) {
                logger.warn(`Crumbs position listener failed for ${instanceId}:`, error);
            }
        }

        session.rafId = requestAnimationFrame(tick);
    }

    session.rafId = requestAnimationFrame(tick);
}

function stopPolling(instanceId: string): void {
    const session = sessions.get(instanceId);
    if (!session) {
        return;
    }

    if (session.pollTimer !== null) {
        clearInterval(session.pollTimer);
        session.pollTimer = null;
    }
    if (session.rafId !== null) {
        cancelAnimationFrame(session.rafId);
        session.rafId = null;
    }
}

export function subscribeToPosition(instanceId: string, listener: PositionListener): () => void {
    const session = getOrCreateSession(instanceId);
    session.listeners.add(listener);

    if (session.listeners.size === 1) {
        startPolling(instanceId);
    }

    return () => {
        session.listeners.delete(listener);
        if (session.listeners.size === 0) {
            stopPolling(instanceId);
            sessions.delete(instanceId);
        }
    };
}
