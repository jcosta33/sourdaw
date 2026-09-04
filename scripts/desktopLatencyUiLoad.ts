/**
 * The synthetic UI load the ui-load leg runs under: a synchronous spin every
 * animation frame plus a periodic longer burst, mirroring the shape of the
 * load in `scripts/measureTransportClock.ts` — which keeps its generator
 * private inside a `page.evaluate` closure, so it is restated here rather
 * than imported.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; these helpers still drive a live
 * `Page`, so — like that driver, and unlike `desktopLatencyReadings.ts` —
 * this file is not unit-testable without Playwright.
 */

import { type Page } from 'playwright';

export const UI_LOAD_SPIN_MS = 6;
export const UI_LOAD_BURST_MS = 40;
export const UI_LOAD_BURST_PERIOD_MS = 500;

const LOAD_HANDLE_KEY = '__desktopLatencyUiLoad';

export async function startUiLoad(page: Page): Promise<void> {
    await page.evaluate(
        (input: { key: string; spinMs: number; burstMs: number; burstPeriodMs: number }) => {
            const spin = (ms: number): void => {
                const until = performance.now() + ms;
                // A deliberate synchronous burn. Spinning on the clock is the
                // only portable way to hold the main thread for a known span.
                while (performance.now() < until) {
                    /* hold the thread */
                }
            };
            // The stop handle is a flag on `globalThis` rather than a closure:
            // the frame callback reads it, so `stopUiLoad` only has to write a
            // boolean across the evaluate boundary that separates the two.
            Reflect.set(globalThis, input.key, true);
            let lastBurst = performance.now();
            const frame = (): void => {
                if (Reflect.get(globalThis, input.key) !== true) {
                    return;
                }
                spin(input.spinMs);
                if (performance.now() - lastBurst >= input.burstPeriodMs) {
                    lastBurst = performance.now();
                    spin(input.burstMs);
                }
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        },
        {
            key: LOAD_HANDLE_KEY,
            spinMs: UI_LOAD_SPIN_MS,
            burstMs: UI_LOAD_BURST_MS,
            burstPeriodMs: UI_LOAD_BURST_PERIOD_MS,
        }
    );
}

export async function stopUiLoad(page: Page): Promise<void> {
    await page.evaluate((key: string) => {
        if (Reflect.get(globalThis, key) !== true) {
            throw new Error('the UI load generator was not running');
        }
        Reflect.set(globalThis, key, false);
    }, LOAD_HANDLE_KEY);
}
