/**
 * Playback position tracking.
 * Polls the backend at 30Hz and provides a rAF-interpolated position
 * for smooth 60fps cursor rendering.
 */

import { logger } from '#/infra/logger/appLogger';
import { getSamplerPosition } from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';

type PositionListener = (frame: number) => void;

// §103.1 — Coalesce 6 module-level \`let\`s + the listeners set into one
// \`pollingSession\` holder so the tracking state lives behind a single
// named handle.
const pollingSession = {
    pollTimer: null as ReturnType<typeof setInterval> | null,
    rafId: null as number | null,
    lastPolledFrame: 0,
    prevPolledFrame: 0,
    pollTimestamp: 0,
    interpolatedFrame: 0,
    listeners: new Set<PositionListener>(),
};

const POLL_INTERVAL_MS = 33; // ~30Hz

function startPolling(): void {
    if (pollingSession.pollTimer !== null) {
        return;
    }

    pollingSession.pollTimestamp = performance.now();

    pollingSession.pollTimer = setInterval(async () => {
        const state = samplerStore.value;
        if (!state?.instanceId) {
            return;
        }

        try {
            pollingSession.prevPolledFrame = pollingSession.lastPolledFrame;
            pollingSession.lastPolledFrame = await getSamplerPosition(state.instanceId);
            pollingSession.pollTimestamp = performance.now();
        } catch (err) {
            logger.warn('Sampler position poll failed:', err);
        }
    }, POLL_INTERVAL_MS);

    // rAF loop for 60fps interpolation.
    function tick(): void {
        const now = performance.now();
        const elapsed = now - pollingSession.pollTimestamp;
        const t = Math.min(elapsed / POLL_INTERVAL_MS, 1);

        // Linear interpolation between last two polled positions.
        pollingSession.interpolatedFrame =
            pollingSession.prevPolledFrame +
            (pollingSession.lastPolledFrame - pollingSession.prevPolledFrame) * t;

        for (const listener of pollingSession.listeners) {
            listener(pollingSession.interpolatedFrame);
        }

        pollingSession.rafId = requestAnimationFrame(tick);
    }

    pollingSession.rafId = requestAnimationFrame(tick);
}

function stopPolling(): void {
    if (pollingSession.pollTimer !== null) {
        clearInterval(pollingSession.pollTimer);
        pollingSession.pollTimer = null;
    }
    if (pollingSession.rafId !== null) {
        cancelAnimationFrame(pollingSession.rafId);
        pollingSession.rafId = null;
    }
}

export function subscribeToPosition(listener: PositionListener): () => void {
    pollingSession.listeners.add(listener);
    if (pollingSession.listeners.size === 1) {
        startPolling();
    }

    return () => {
        pollingSession.listeners.delete(listener);
        if (pollingSession.listeners.size === 0) {
            stopPolling();
        }
    };
}

export function getInterpolatedPosition(): number {
    return pollingSession.interpolatedFrame;
}
