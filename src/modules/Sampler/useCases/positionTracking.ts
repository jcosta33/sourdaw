/**
 * Playback position tracking.
 * Polls the backend at 30Hz and provides a rAF-interpolated position
 * for smooth 60fps cursor rendering.
 */

import { logger } from '#/infra/logger/appLogger';
import { getSamplerPosition } from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';

type PositionListener = (frame: number) => void;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rafId: number | null = null;
let lastPolledFrame = 0;
let prevPolledFrame = 0;
let pollTimestamp = 0;
let interpolatedFrame = 0;
const listeners = new Set<PositionListener>();

const POLL_INTERVAL_MS = 33; // ~30Hz

function startPolling(): void {
    if (pollTimer !== null) {return;}

    pollTimestamp = performance.now();

    pollTimer = setInterval(async () => {
        const state = samplerStore.value;
        if (!state?.instanceId) {return;}

        try {
            prevPolledFrame = lastPolledFrame;
            lastPolledFrame = await getSamplerPosition(state.instanceId);
            pollTimestamp = performance.now();
        } catch (err) {
            logger.warn('Sampler position poll failed:', err);
        }
    }, POLL_INTERVAL_MS);

    // rAF loop for 60fps interpolation.
    function tick(): void {
        const now = performance.now();
        const elapsed = now - pollTimestamp;
        const t = Math.min(elapsed / POLL_INTERVAL_MS, 1);

        // Linear interpolation between last two polled positions.
        interpolatedFrame = prevPolledFrame + (lastPolledFrame - prevPolledFrame) * t;

        for (const listener of listeners) {
            listener(interpolatedFrame);
        }

        rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
}

function stopPolling(): void {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

export function subscribeToPosition(listener: PositionListener): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
        startPolling();
    }

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            stopPolling();
        }
    };
}

export function getInterpolatedPosition(): number {
    return interpolatedFrame;
}
