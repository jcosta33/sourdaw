/**
 * Web Worker for driving the main playhead scheduler clock.
 *
 * Browsers throttle \`setTimeout\` and \`setInterval\` on the main thread to 1000ms
 * when a tab is in the background. Web Workers are exempt from this aggressive
 * throttling, allowing the sequencer to maintain steady timing even when the
 * DAW is running in an inactive tab.
 */

type SchedulerMessage = { type: 'start'; interval: number } | { type: 'stop' };

let timerId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (event: MessageEvent<SchedulerMessage>) => {
    const msg = event.data;

    if (msg.type === 'start') {
        const intervalMs = msg.interval > 0 ? msg.interval : 10;
        if (timerId !== null) {
            clearInterval(timerId);
        }
        timerId = setInterval(() => {
            self.postMessage({ type: 'tick' });
        }, intervalMs);
    } else if (msg.type === 'stop') {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    }
};
