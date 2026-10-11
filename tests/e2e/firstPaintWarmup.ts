import { resolve } from 'node:path';

import { chromium, type FullConfig } from '@playwright/test';

import { assertServingCheckoutIdentity } from '../../scripts/e2eServerIdentity';
import { DIRECT_E2E_VIEWPORT_NAME } from '../../src/app/resolveAppComposition';

import { LAUNCH_SCREEN_NAME } from './e2eUtils';
import { attach_first_paint_console, CAPABILITIES_MARKER, wait_for_console_marker } from './firstPaintDiagnostics';

/**
 * One-time bound for the dev server's cold module transform. Playwright's
 * `webServer.url` answers as soon as Vite serves the HTML shell, long before
 * the SPA and WASM module graph has compiled, so whichever test navigated
 * first used to absorb that compile inside its own first-paint allowance and
 * time out on cold CI hardware. This bound is paid once per run, outside every
 * test's observation window; the per-test first-paint bounds stay as they are
 * and keep measuring a warm module graph.
 */
const COLD_FIRST_PAINT_TIMEOUT_MS = 180_000;

function remainingWarmupTime(deadline: number): number {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) {
        throw new Error('First-paint warmup exceeded its deadline before the launch overlay appeared');
    }
    return remaining;
}

function formatWarmupSeconds(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(1)}s`;
}

/**
 * Global setup: navigate to the app once and wait out the cold launch path
 * before the first test observes it, so the dev server's module graph is warm
 * and the per-test first-paint bounds measure warm mounting. Readiness is the
 * app's own `[capabilities]` boot marker, not merely the overlay being
 * visible: the overlay is the first paint, while the cold launch path keeps
 * building and booting WASM past that point — work a first test's timed
 * allowance must not have to measure (#4781: an offline smoke run whose
 * warmup had finished still spent its first test's whole 90s allowance on the
 * cold build tail and never reached `[capabilities]`).
 *
 * The web server plugin starts (and health-checks) the server before global
 * setup runs, so the navigation always has a live origin to hit. Before any
 * of that, the serving-checkout identity is asserted: when the URL answers
 * with another checkout's marker, this run would silently verify that
 * checkout's code, so it aborts instead (see ../../scripts/e2eServerIdentity.ts).
 */
// oxlint-disable-next-line import/no-default-export -- Playwright resolves globalSetup by default export.
export default async function warmFirstPaint(config: FullConfig): Promise<void> {
    const baseURL = config.projects[0]?.use.baseURL;
    if (baseURL === undefined) {
        throw new Error('First-paint warmup requires the project baseURL naming the app server');
    }

    await assertServingCheckoutIdentity(baseURL, resolve(import.meta.dirname, '../..'));

    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ baseURL });
        // Direct composition, as in e2eUtils: the launch overlay then renders
        // in the main frame instead of inside the display-scale host iframe.
        // The name rides the argument channel; an init script's free
        // variables do not exist in the page realm.
        await page.addInitScript((viewportName: string) => {
            window.name = viewportName;
        }, DIRECT_E2E_VIEWPORT_NAME);
        const timeline = attach_first_paint_console(page);
        const startedAtMs = performance.now();
        const deadline = performance.now() + COLD_FIRST_PAINT_TIMEOUT_MS;
        await page.goto('/', { timeout: remainingWarmupTime(deadline) });
        await page.getByLabel(LAUNCH_SCREEN_NAME).waitFor({ state: 'visible', timeout: remainingWarmupTime(deadline) });
        const overlayPaidMs = performance.now() - startedAtMs;
        await wait_for_console_marker(timeline, CAPABILITIES_MARKER, remainingWarmupTime(deadline));
        const bootPaidMs = performance.now() - startedAtMs;
        console.log(
            `[first-paint warmup] launch overlay after ${formatWarmupSeconds(overlayPaidMs)}, ` +
                `boot capabilities after ${formatWarmupSeconds(bootPaidMs)}; ` +
                `${formatWarmupSeconds(Math.max(COLD_FIRST_PAINT_TIMEOUT_MS - bootPaidMs, 0))} of the ` +
                `${COLD_FIRST_PAINT_TIMEOUT_MS / 1000}s cold allowance remains for the tests' own waits`
        );
    } finally {
        await browser.close();
    }
}
