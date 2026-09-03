/**
 * Everything the driver needs to say what the page itself reported while it
 * ran, and to confirm the harness plugin actually landed on a track rather
 * than trusting the load click alone.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; these helpers still drive a live
 * `Page`, so — like that driver, and unlike `desktopLatencyReadings.ts` —
 * this file is not unit-testable without Playwright.
 */

import { type Page } from 'playwright';

import { hasLivePluginOnTrack } from './desktopLatencyReadings.ts';
import { type DiagnosticsEntry, type DiagnosticsRecord } from './desktopLatencyRecord.ts';

/** `AppShell.tsx` — the status bar footer, which carries the engine dot this module reads on its own. */
const STATUS_BAR_SELECTOR = 'footer[aria-label="Application status"]';

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Diagnostics = DiagnosticsRecord;

/**
 * Populated as soon as the app's page is connected and read for the rest of
 * the run, including from inside a caught step failure: a failed run without
 * this is a `NOT MEASURED` with no way to tell which step misbehaved and what
 * the page itself said while it did.
 */
export function emptyDiagnostics(): Diagnostics {
    return { pageErrors: [], consoleWarningsAndErrors: [] };
}

/**
 * Every `console` warning/error and every `pageerror`, timestamped and
 * attributed to whatever step `getActiveStep` reports at the moment it
 * fires. Kept separate from the stream-error `console` slicing each leg
 * already does: that one is scoped to a leg's own window and matched on one
 * marker string, this one is unscoped and answers "what did the page say,
 * ever, about anything".
 */
export function subscribeDiagnostics(page: Page, diagnostics: Diagnostics, getActiveStep: () => string): void {
    page.on('console', (message) => {
        const type = message.type();
        if (type === 'warning' || type === 'error') {
            diagnostics.consoleWarningsAndErrors.push({
                at: new Date().toISOString(),
                step: getActiveStep(),
                text: message.text(),
            });
        }
    });
    page.on('pageerror', (error) => {
        diagnostics.pageErrors.push({ at: new Date().toISOString(), step: getActiveStep(), text: error.message });
    });
}

export function printDiagnostics(diagnostics: Diagnostics): void {
    process.stdout.write('\nDIAGNOSTICS\n');
    if (diagnostics.pageErrors.length === 0 && diagnostics.consoleWarningsAndErrors.length === 0) {
        process.stdout.write('  none\n');
        return;
    }
    const line = (kind: string, entry: DiagnosticsEntry): string =>
        `  ${kind.padEnd(9)} [${entry.step === '' ? '(none)' : entry.step}] ${entry.at} ${entry.text}\n`;
    for (const entry of diagnostics.pageErrors) {
        process.stdout.write(line('pageerror', entry));
    }
    for (const entry of diagnostics.consoleWarningsAndErrors) {
        process.stdout.write(line('console', entry));
    }
}

async function readEngineTitle(page: Page): Promise<string> {
    return page.evaluate((selector: string) => {
        const footer = document.querySelector(selector);
        const engineDot = footer?.querySelector('[title^="Engine: "]');
        return engineDot?.getAttribute('title') ?? '';
    }, STATUS_BAR_SELECTOR);
}

function describePageErrors(pageErrors: readonly DiagnosticsEntry[]): string {
    return pageErrors.length === 0
        ? '(none)'
        : pageErrors
              .map((entry) => `${entry.at} [${entry.step === '' ? '(none)' : entry.step}] ${entry.text}`)
              .join('; ');
}

/**
 * The next gate the driver checks — a running master meter — holds on an
 * empty project too, so it cannot tell "the plugin loaded" from "nothing is
 * on this track at all". `hasLivePluginOnTrack` reads the two engine-dot
 * counts that only move once a device is actually instantiated on a track,
 * so a load click that silently failed is caught here instead of producing a
 * baseline over a silent app with no hint why.
 */
export async function waitForLivePluginOnTrack(
    page: Page,
    pageErrors: readonly DiagnosticsEntry[],
    timeoutMs: number
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (hasLivePluginOnTrack(await readEngineTitle(page))) {
            return;
        }
        await sleep(250);
    }
    const engineTitle = await readEngineTitle(page);
    const rowCount = await page.locator('[role="row"]').count();
    throw new Error(
        `the plugin never went live on a track — engine dot "${engineTitle}", ` +
            `${String(rowCount)} track-list rows, page errors: ${describePageErrors(pageErrors)}`
    );
}
