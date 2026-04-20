/**
 * Playback position tracking.
 * Polls the backend at 30Hz and provides a rAF-interpolated position
 * for smooth 60fps cursor rendering.
 */

import { logger } from '#/infra/logger/appLogger';
import { isTauri } from '#/utils/tauriBridge';

import { getCrumbsPosition } from '../repositories/crumbsBridge';

type PositionListener = (frame: number) => void;

type PollingSession = {
    pollTimer: ReturnType<typeof setInterval> | null;
    rafId: number | null;
    lastPolledFrame: number;
    prevPolledFrame: number;
    pollTimestamp: number;
    interpolatedFrame: number;
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

    // Crumbs position data is sourced from the Rust audio host via Tauri IPC.
    // On the browser build the bridge has nothing to answer with, so the 30 Hz
    // poll would otherwise spam a warn per tick — just stay idle.
    if (!isTauri()) {
        return;
    }

    session.pollTimestamp = performance.now();

    session.pollTimer = setInterval(async () => {
        try {
            session.prevPolledFrame = session.lastPolledFrame;
            session.lastPolledFrame = await getCrumbsPosition(instanceId);
            session.pollTimestamp = performance.now();
        } catch (error) {
            logger.warn(`Crumbs position poll failed for ${instanceId}:`, error);
        }
    }, POLL_INTERVAL_MS);

    // rAF loop for 60fps interpolation.
    function tick(): void {
        const now = performance.now();
        const elapsed = now - session.pollTimestamp;
        const t = Math.min(elapsed / POLL_INTERVAL_MS, 1);

        // Linear interpolation between last two polled positions.
        session.interpolatedFrame = session.prevPolledFrame + (session.lastPolledFrame - session.prevPolledFrame) * t;

        for (const listener of session.listeners) {
            listener(session.interpolatedFrame);
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

export function getInterpolatedPosition(instanceId: string): number {
    return sessions.get(instanceId)?.interpolatedFrame ?? 0;
}
