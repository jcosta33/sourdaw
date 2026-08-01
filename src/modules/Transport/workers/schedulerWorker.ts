/**
 * Web Worker for driving the main playhead scheduler clock.
 *
 * Browsers throttle \`setTimeout\` and \`setInterval\` on the main thread to 1000ms
 * when a tab is in the background. Web Workers are exempt from this aggressive
 * throttling, allowing the sequencer to maintain steady timing even when the
 * DAW is running in an inactive tab.
 */

type SchedulerMessage = { type: 'start'; interval: number; generation: number } | { type: 'stop' };

type SchedulerTick = {
    type: 'tick';
    generation: number;
    sequence: number;
    scheduledAtMs: number;
    sentAtMs: number;
};

function isSchedulerMessage(value: unknown): value is SchedulerMessage {
    if (typeof value !== 'object' || value === null || !('type' in value)) {
        return false;
    }
    if (value.type === 'stop') {
        return true;
    }
    return (
        value.type === 'start' &&
        'interval' in value &&
        typeof value.interval === 'number' &&
        Number.isFinite(value.interval) &&
        'generation' in value &&
        typeof value.generation === 'number' &&
        Number.isSafeInteger(value.generation) &&
        value.generation > 0
    );
}

function highResolutionEpochMs(): number {
    return performance.timeOrigin + performance.now();
}

let timerId: ReturnType<typeof setInterval> | null = null;
let nextScheduledAtMs = 0;
let tickSequence = 0;
let schedulerGeneration = 0;

self.onmessage = (event: MessageEvent<unknown>) => {
    const msg = event.data;

    if (!isSchedulerMessage(msg)) {
        return;
    }

    if (msg.type === 'start') {
        const intervalMs = msg.interval > 0 ? msg.interval : 10;
        if (timerId !== null) {
            clearInterval(timerId);
        }
        schedulerGeneration = msg.generation;
        tickSequence = 0;
        nextScheduledAtMs = highResolutionEpochMs() + intervalMs;
        timerId = setInterval(() => {
            const sentAtMs = highResolutionEpochMs();
            const elapsedIntervals = Math.max(1, Math.floor((sentAtMs - nextScheduledAtMs) / intervalMs) + 1);
            tickSequence += elapsedIntervals;
            const scheduledAtMs = nextScheduledAtMs + (elapsedIntervals - 1) * intervalMs;
            nextScheduledAtMs += elapsedIntervals * intervalMs;
            const tick: SchedulerTick = {
                type: 'tick',
                generation: schedulerGeneration,
                sequence: tickSequence,
                scheduledAtMs,
                sentAtMs,
            };
            self.postMessage(tick);
        }, intervalMs);
    } else {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
            nextScheduledAtMs = 0;
            tickSequence = 0;
            schedulerGeneration = 0;
        }
    }
};

// Marks this file as a module so its types resolve under `moduleResolution:
// bundler` and it can be side-effect imported by its spec for coverage. The
// worker is loaded via `new Worker(new URL(...))`, which bundles it as a module
// worker regardless; an empty export is a no-op at runtime.
export {};
