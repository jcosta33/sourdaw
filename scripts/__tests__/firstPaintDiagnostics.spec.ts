import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CAPABILITIES_MARKER,
    first_paint_boot_progress,
    format_first_paint_timeout_diagnosis,
    REACT_FIRST_RENDER_MARKER,
    VITE_CONNECTED_MARKER,
    wait_for_console_marker,
    type FirstPaintTimeline,
} from '../../tests/e2e/firstPaintDiagnostics';

/**
 * Behavioral coverage for the launch-screen first-paint diagnosis
 * (tests/e2e/firstPaintDiagnostics.ts). Vitest excludes `tests/e2e/**`, so
 * this spec lives beside the other e2e-harness coverage in
 * `scripts/__tests__/`. The module turns the one artifact every CI run keeps —
 * the console stream — into the boot-phase diagnosis a timed-out first-paint
 * wait must carry (#4781: a red smoke leg whose page state was unrecoverable).
 */

const clock = { now: 0 };

function timelineWith(events: Array<[number, string]>): FirstPaintTimeline {
    return { startedAtMs: 0, events: events.map(([atMs, text]) => ({ atMs, text })) };
}

describe('first paint boot progress', () => {
    it('reports no progress from an empty console', () => {
        expect(first_paint_boot_progress(timelineWith([]))).toEqual({
            viteConnectedAtMs: null,
            reactFirstRenderAtMs: null,
            wasmBootedAtMs: null,
            capabilitiesLoggedAtMs: null,
        });
    });

    it('reads each boot milestone from the log lines the app actually emits', () => {
        const progress = first_paint_boot_progress(
            timelineWith([
                [300, '[vite] connecting...'],
                [340, VITE_CONNECTED_MARKER],
                [
                    1_200,
                    '%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold',
                ],
                [11_500, 'using deprecated parameters for `initSync()`; pass a single object instead'],
                [11_560, '[DEV][INFO] [capabilities] {"isDesktopRuntime":false,"hasSharedArrayBuffer":true}'],
            ])
        );

        expect(progress).toEqual({
            viteConnectedAtMs: 340,
            reactFirstRenderAtMs: 1_200,
            wasmBootedAtMs: 11_500,
            capabilitiesLoggedAtMs: 11_560,
        });
    });

    it('takes the first occurrence when a marker logs more than once', () => {
        const progress = first_paint_boot_progress(
            timelineWith([
                [500, VITE_CONNECTED_MARKER],
                [9_000, VITE_CONNECTED_MARKER],
            ])
        );

        expect(progress.viteConnectedAtMs).toBe(500);
    });
});

describe('first paint timeout diagnosis', () => {
    it('reproduces the run 36202813096 shape: vite connected, a late React render, boot never finished', () => {
        // The failing leg: [vite] connected at once, the React devtools banner
        // 58s later, then silence until the 90s allowance expired — no
        // initSync, no [capabilities].
        const message = format_first_paint_timeout_diagnosis({
            timeline: timelineWith([
                [300, '[vite] connecting...'],
                [340, VITE_CONNECTED_MARKER],
                [58_400, `%c${REACT_FIRST_RENDER_MARKER} font-weight:bold`],
            ]),
            timeoutMs: 90_000,
            waitedMs: 90_012,
            underlyingMessage: 'expect(locator).toBeVisible() failed\nError: element(s) not found',
        });

        expect(message).toContain('did not mount within 90000ms');
        expect(message).toContain('Vite client connected +0.3s');
        expect(message).toContain('React first render +58.4s');
        expect(message).toContain('WASM booted never');
        expect(message).toContain('[capabilities] (bootstrap complete) never');
        expect(message).toContain('the WASM bootstrap');
        expect(message).toContain('Console tail:');
        expect(message).toContain('[vite] connected.');
        expect(message).toContain('element(s) not found');
    });

    it('names the dev-server handshake when the page logged nothing at all', () => {
        const message = format_first_paint_timeout_diagnosis({
            timeline: timelineWith([]),
            timeoutMs: 45_000,
            waitedMs: 45_000,
            underlyingMessage: 'expect(locator).toBeVisible() failed',
        });

        expect(message).toContain('Vite client connected never');
        expect(message).toContain('the dev-server handshake');
        expect(message).toContain('The page logged no console messages.');
    });

    it('distinguishes a completed boot from a stalled one', () => {
        const booted = format_first_paint_timeout_diagnosis({
            timeline: timelineWith([
                [200, VITE_CONNECTED_MARKER],
                [900, `%c${REACT_FIRST_RENDER_MARKER} font-weight:bold`],
                [10_000, 'using deprecated parameters for `initSync()`; pass a single object instead'],
                [10_050, '[DEV][INFO] [capabilities] {}'],
            ]),
            timeoutMs: 45_000,
            waitedMs: 45_000,
            underlyingMessage: 'expect(locator).toBeVisible() failed',
        });
        const stalledAtWasm = format_first_paint_timeout_diagnosis({
            timeline: timelineWith([
                [200, VITE_CONNECTED_MARKER],
                [900, `%c${REACT_FIRST_RENDER_MARKER} font-weight:bold`],
                [10_000, 'using deprecated parameters for `initSync()`; pass a single object instead'],
            ]),
            timeoutMs: 45_000,
            waitedMs: 45_000,
            underlyingMessage: 'expect(locator).toBeVisible() failed',
        });

        expect(booted).toContain('the launch overlay mount');
        expect(stalledAtWasm).toContain('the [capabilities] log');
        expect(stalledAtWasm).not.toContain('the launch overlay mount');
    });

    it('bounds the console tail so the error stays readable', () => {
        const message = format_first_paint_timeout_diagnosis({
            timeline: timelineWith(
                Array.from({ length: 30 }, (_, index) => [index * 10, `noise ${index}`] as [number, string])
            ),
            timeoutMs: 45_000,
            waitedMs: 45_000,
            underlyingMessage: 'expect(locator).toBeVisible() failed',
        });

        expect(message).toContain('noise 29');
        expect(message).not.toContain('noise 21\n');
        expect(message).not.toContain('noise 0\n');
    });
});

describe('console marker readiness wait', () => {
    beforeEach(() => {
        clock.now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns at once when the timeline already carries the marker', async () => {
        const timeline = timelineWith([[1_000, `[DEV][INFO] ${CAPABILITIES_MARKER} {}`]]);

        await expect(wait_for_console_marker(timeline, CAPABILITIES_MARKER, 5_000)).resolves.toBeUndefined();
    });

    it('resolves when the marker arrives while waiting', async () => {
        vi.useFakeTimers();
        try {
            const timeline = timelineWith([]);
            const waiting = wait_for_console_marker(timeline, CAPABILITIES_MARKER, 60_000);
            // The wait polls on a 100ms timer; deliver the marker before the
            // first poll fires.
            timeline.events.push({ atMs: 50, text: `[DEV][INFO] ${CAPABILITIES_MARKER} {}` });
            await vi.advanceTimersByTimeAsync(100);

            await expect(waiting).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('refuses with the cold-handover message when the deadline passes without the marker', async () => {
        const waiting = wait_for_console_marker(timelineWith([]), CAPABILITIES_MARKER, 10_000);
        clock.now = 10_500;

        await expect(waiting).rejects.toThrow('The page never logged "[capabilities]"');
        await expect(waiting).rejects.toThrow('refuses to hand a cold server to the timed first-paint waits');
    });
});
