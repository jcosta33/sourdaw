#!/usr/bin/env node

/**
 * What does a musician actually see in the packaged desktop app's own status
 * bar while a plugin is sounding, and what does the native engine report
 * underneath it?
 *
 * This is the pre-cutover baseline instrument for #3070. Before the native
 * audio path takes over playback, the numbers the app itself publishes have to
 * exist as a recorded figure taken on a real machine from a real packaged
 * build. Otherwise "the cutover improved latency" is a claim with nothing on
 * the other side of the comparison, and a dropout the cutover introduced is
 * indistinguishable from one that was always there.
 *
 * It measures the shipped artefact, not a paraphrase of it: the
 * `electron-builder` output, launched as the user launches it, driven over the
 * Chrome DevTools Protocol through the product's own UI — launch screen,
 * browser panel, plugin scan, plugin load, transport play. Every figure comes
 * from the product's own readouts, the status-bar elements written by
 * `useStatusBarMetrics.ts` plus the native `engine_rt_diagnostics` command over
 * the preload bridge. Nothing here recomputes a quantity the app computes,
 * because a harness that recomputes the readout measures the harness.
 *
 * Launch and preconditions
 * ------------------------
 * The app is launched against a fresh, temporary `--user-data-dir` rather than
 * the operator's own Electron profile: a shared profile can hold a project
 * persisted by an earlier build, and every project mutation this harness
 * performs — adding a track, loading a plugin — is refused against a project
 * already on disk. A fresh profile always lands on the launch screen, so the
 * driver waits for `#launch-new-project` and, after clicking it, waits for the
 * launch overlay (`AppShell.tsx`'s `[role="dialog"][aria-label="Sourdaw — start
 * a project"]`) to leave the DOM — the workspace renders underneath that
 * overlay, so the status bar existing is not by itself proof the overlay is
 * gone. Loading the harness plugin is likewise not trusted on the click alone:
 * the driver polls the engine dot's own title until it reports both a ready
 * device instance and an audio track strip, because the next gate — a running
 * meter — holds on an empty project too and would otherwise pass on a plugin
 * that was never loaded.
 *
 * Why jsdom and Vitest cannot answer any of this
 * ----------------------------------------------
 * The quantities are properties of the shipped runtime, not of our source.
 * `baseLatency` and `outputLatency` are the packaged Chromium's numbers for
 * this machine's audio device and exist in no simulated DOM. The master peak
 * level only becomes non-silent when a real CLAP binary is scanned, `dlopen`ed,
 * instantiated and rendered by the real host — a mocked scanner proves nothing
 * about whether plugin audio reaches the meter. The native counters come from a
 * Rust ring buffer inside the packaged binary, which no unit test has.
 *
 * What each leg establishes
 * -------------------------
 * IDLE — the control. Playback running, nothing else touching the main thread.
 *   A figure taken only under load cannot be told apart from a contended box;
 *   IDLE is what makes the loaded leg legible.
 *
 * UI-LOAD — the same measurement with the main thread deliberately busy, which
 *   is the state a DAW main thread is actually in during playback: timeline
 *   redraw and meter updates every frame. The generator is a synchronous spin
 *   every animation frame plus a periodic longer burst, mirroring the shape of
 *   the UI load in `scripts/measureTransportClock.ts` — which keeps its
 *   generator private inside a `page.evaluate` closure, so it is restated here
 *   rather than imported.
 *
 * Dropouts under load are RECORDED, never a failure — pre-cutover
 * --------------------------------------------------------------
 * Before the native cutover the plugin renders through Web Audio and the
 * worklet bridge; the native master carries no plugin audio yet. A bridge
 * counter or a stream error seen here therefore describes the pre-cutover
 * arrangement, which is the thing this record exists to capture, and failing on
 * it would mean the baseline could not be taken at all. The one outcome that
 * *is* a failure is the plugin never reaching the meter, because then the run
 * measured a silent app and every number in it is about nothing.
 *
 *   0  MEASURED     — the run held; the record is the result.
 *   1  FAILED       — the master level never exceeded the audible floor after
 *                     the plugin was loaded. Plugin audio never arrived.
 *   2  NOT MEASURED — a precondition or a UI step did not hold. Nothing was
 *                     measured and nothing is claimed.
 *
 * Usage: `pnpm desktop:measure [--app <path>] [--seconds <n>] [--json <path>]`.
 * A number without its machine is not a measurement, so the record carries the
 * git sha, whether the tree was clean, the host, and the packaged app's own
 * Chromium and Electron versions.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';

import {
    emptyDiagnostics,
    printDiagnostics,
    subscribeDiagnostics,
    waitForLivePluginOnTrack,
    type Diagnostics,
} from './desktopLatencyDiagnostics.ts';
import {
    dismissOnboardingTour,
    openEffectsTab,
    openNewProjectFromLaunchScreen,
    waitForWorkspaceOrLaunchScreen,
} from './desktopLatencyLaunch.ts';
import { recoverQuarantinedHarnessPlugin } from './desktopLatencyPreferencesRecovery.ts';
import {
    computeCounterDeltas,
    decideVerdict,
    describeAudibleFloor,
    findAppPageTarget,
    parseArgs,
    parseEngineTitle,
    parseLatencyMs,
    parseMasterLevelDb,
    type AppPageTarget,
    type DesktopLatencyArgs,
} from './desktopLatencyReadings.ts';
import {
    machineProvenance,
    readBundleVersion,
    reportLeg,
    writeRecord,
    type AppStartedAt,
    type DesktopLatencyRecord,
    type DiagnosticsEntry,
    type EngineEventRecord,
    type LegRecord,
    type SampleRecord,
} from './desktopLatencyRecord.ts';
import {
    startUiLoad,
    stopUiLoad,
    UI_LOAD_BURST_MS,
    UI_LOAD_BURST_PERIOD_MS,
    UI_LOAD_SPIN_MS,
} from './desktopLatencyUiLoad.ts';
import { harnessPluginDestination } from './installHarnessPlugin.ts';

const EXIT_MEASURED = 0;
const EXIT_FAILED = 1;
const EXIT_NOT_MEASURED = 2;

const SAMPLE_INTERVAL_MS = 1_000;
const STEP_TIMEOUT_MS = 15_000;
const APP_READY_TIMEOUT_MS = 30_000;
const QUIT_GRACE_MS = 10_000;

/** `electron/scan.ts`'s own `SCAN_TIMEOUT_MS` bounds a scan at 120 s; this adds margin on top of it. */
const SCAN_STEP_TIMEOUT_MS = 150_000;

/** Room for two clicks, two "External Plugins" waits, and one onboarding-tour dismissal in between, each individually bounded at `STEP_TIMEOUT_MS`. */
const EFFECTS_TAB_STEP_TIMEOUT_MS = STEP_TIMEOUT_MS * 3;

const APP_URL_PREFIX = 'app://sourdaw/';

/** `crates/sourdaw-harness-tone/src/descriptor.rs` — the name the plugin row shows. */
const HARNESS_PLUGIN_NAME = 'Sourdaw Harness Tone';

/**
 * The console text `refreshEngineRtDiagnostics.ts` produces for each drained
 * event. Matched as a substring rather than a prefix on purpose: the packaged
 * build's console writer prepends `[Sourdaw][WARN]`, so a `startsWith` check
 * against the AudioEngine marker would never fire in the artefact this harness
 * measures.
 */
const STREAM_ERROR_MARKER = '[AudioEngine] native engine streamError';

const STATUS_BAR_SELECTOR = 'footer[aria-label="Application status"]';

/** A fresh, per-run Electron profile — never the operator's own `~/Library/Application Support/sourdaw`. */
const PROFILE_DIR_PREFIX = 'sourdaw-desktop-measure-';

type EngineDiagnosticsReading = {
    running: boolean;
    counters: Record<string, number>;
    events: EngineEventRecord[];
};

type StatusBarReading = {
    sampleRateText: string;
    latencyText: string;
    latencyTitle: string;
    engineTitle: string;
    masterLevelText: string;
};

async function pickFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
                server.close(() => reject(new Error('the OS did not report a bound TCP port')));
                return;
            }
            const { port } = address;
            server.close(() => resolve(port));
        });
    });
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The name of the step currently running, read by the `console`/`pageerror`
 * listeners in `connectAndMeasure` so a diagnostics entry can say what the
 * driver was doing when it fired, not just when.
 */
let activeStep = '';

/**
 * Every UI step is bounded. Without this a selector that never appears hangs
 * the run instead of reporting which step did not hold, and an unattributed
 * hang teaches nothing.
 */
async function step<Result>(
    name: string,
    run: () => Promise<Result>,
    timeoutMs: number = STEP_TIMEOUT_MS
): Promise<Result> {
    activeStep = name;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`the step "${name}" did not complete within ${timeoutMs} ms`));
        }, timeoutMs);
    });
    try {
        const result = await Promise.race([run(), expiry]);
        process.stdout.write(`  step: ${name} … ${String(Date.now() - startedAt)} ms\n`);
        return result;
    } catch (error) {
        process.stdout.write(`  step: ${name} FAILED after ${String(Date.now() - startedAt)} ms\n`);
        throw error;
    } finally {
        clearTimeout(timer);
        activeStep = '';
    }
}

type CdpVersion = { browser: string; userAgent: string };

function asCdpVersion(payload: unknown): CdpVersion {
    if (typeof payload !== 'object' || payload === null) {
        throw new TypeError('/json/version did not answer with an object');
    }
    const browser: unknown = Reflect.get(payload, 'Browser');
    const userAgent: unknown = Reflect.get(payload, 'User-Agent');
    return {
        browser: typeof browser === 'string' ? browser : 'unknown',
        userAgent: typeof userAgent === 'string' ? userAgent : 'unknown',
    };
}

/**
 * `connectOverCDP` must not be called until the app's page target exists and
 * has already parsed its document. In the run that hung, the page was listed
 * with an empty title while its child workers were still spawning, and one of
 * those workers detached again, unsolicited, in the middle of Playwright's own
 * auto-attach handshake; every command Playwright sent got answered, and the
 * connect promise still never resolved. Every run where `/json/list` already
 * carried the page — a real url and a non-empty, parsed title — connected in
 * about 50 ms instead. Polling this cheap, connect-free endpoint until the
 * page is actually there is what keeps `connectOverCDP` from ever attaching to
 * a target still mid-creation.
 */
async function waitForAppPageTarget(port: number): Promise<AppPageTarget> {
    const deadline = Date.now() + APP_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`);
            if (response.ok) {
                const target = findAppPageTarget(await response.json(), APP_URL_PREFIX);
                if (target !== null) {
                    return target;
                }
            }
        } catch {
            // The app has not opened the port yet. Keep polling until the deadline.
        }
        await sleep(100);
    }
    throw new Error(
        `no page at ${APP_URL_PREFIX} with a parsed document appeared within ${String(APP_READY_TIMEOUT_MS)} ms`
    );
}

async function readCdpVersion(port: number): Promise<CdpVersion> {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`);
    if (!response.ok) {
        throw new Error(`http://127.0.0.1:${String(port)}/json/version answered with HTTP ${String(response.status)}`);
    }
    return asCdpVersion(await response.json());
}

async function findAppPage(browser: Browser): Promise<Page> {
    const deadline = Date.now() + APP_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        for (const context of browser.contexts()) {
            for (const page of context.pages()) {
                if (page.url().startsWith(APP_URL_PREFIX)) {
                    return page;
                }
            }
        }
        await sleep(250);
    }
    throw new Error(`no page at ${APP_URL_PREFIX} appeared within ${APP_READY_TIMEOUT_MS} ms`);
}

/**
 * Reads the status bar by structure rather than by class name: a readout is the
 * second of exactly two sibling spans whose first one is the label. Class names
 * on these elements are styling and change without notice; the label beside the
 * value is what the product means.
 */
async function readStatusBar(page: Page): Promise<StatusBarReading> {
    return page.evaluate((selector: string) => {
        const footer = document.querySelector(selector);
        if (footer === null) {
            throw new Error('the status bar is not in the document');
        }
        const valueSpan = (label: string): HTMLElement => {
            for (const row of footer.querySelectorAll('div')) {
                const spans = row.querySelectorAll(':scope > span');
                const first = spans[0];
                const second = spans[1];
                if (spans.length === 2 && first?.textContent?.trim() === label && second instanceof HTMLElement) {
                    return second;
                }
            }
            throw new Error(`the status bar has no readout labelled "${label}"`);
        };
        const engineDot = footer.querySelector('[title^="Engine: "]');
        if (engineDot === null) {
            throw new Error('the status bar has no engine dot');
        }
        const latency = valueSpan('Latency');
        const latencyTitle = latency.querySelector('span[title]')?.getAttribute('title');
        if (latencyTitle === undefined || latencyTitle === null) {
            throw new Error('the Latency readout carries no title');
        }
        return {
            sampleRateText: valueSpan('Rate').textContent ?? '',
            latencyText: latency.textContent ?? '',
            latencyTitle,
            engineTitle: engineDot.getAttribute('title') ?? '',
            masterLevelText: valueSpan('Out').textContent ?? '',
        };
    }, STATUS_BAR_SELECTOR);
}

/**
 * Drains the native ring through the product's own bridge. The app polls this
 * same command once a second, so what this call returns is what the app's poll
 * did not already take — which is why the leg records the console reports too.
 */
async function readEngineDiagnostics(page: Page): Promise<EngineDiagnosticsReading> {
    return page.evaluate(async () => {
        const bridge: unknown = Reflect.get(globalThis, 'sourdaw');
        if (typeof bridge !== 'object' || bridge === null) {
            throw new TypeError('window.sourdaw is absent — this is not the packaged desktop app');
        }
        const invoke: unknown = Reflect.get(bridge, 'invoke');
        if (typeof invoke !== 'function') {
            throw new TypeError('window.sourdaw.invoke is absent');
        }
        // `typeof` proves the bridge member is callable; nothing at runtime can
        // prove its signature, so the shape is named once here and everything
        // it answers with is validated below as `unknown` rather than trusted.
        const call = invoke as (command: string, args: readonly unknown[]) => Promise<unknown>;
        const payload: unknown = await call('engine_rt_diagnostics', []);
        if (typeof payload !== 'object' || payload === null) {
            throw new TypeError('engine_rt_diagnostics did not answer with an object');
        }
        const counters: Record<string, number> = {};
        for (const [name, value] of Object.entries(payload)) {
            if (typeof value === 'number') {
                counters[name] = value;
            }
        }
        const readString = (event: unknown, key: string): string => String(Reflect.get(Object(event), key));
        const rawEvents: unknown = Reflect.get(payload, 'events');
        const events = Array.isArray(rawEvents)
            ? rawEvents.map((event: unknown) => ({
                  type: readString(event, 'type'),
                  side: readString(event, 'side'),
                  kind: readString(event, 'kind'),
              }))
            : [];
        return { running: Reflect.get(payload, 'running') === true, counters, events };
    });
}

async function sample(page: Page, t: number): Promise<{ record: SampleRecord; events: EngineEventRecord[] }> {
    const status = await readStatusBar(page);
    const diagnostics = await readEngineDiagnostics(page);
    const engine = parseEngineTitle(status.engineTitle);
    return {
        record: {
            t,
            sampleRateText: status.sampleRateText,
            latencyMs: parseLatencyMs(status.latencyText),
            latencyTitle: status.latencyTitle,
            engineState: engine.state,
            missedRenderDeadlines: engine.missedRenderDeadlines,
            engineDetectedDropouts: engine.engineDetectedDropouts,
            masterLevelText: status.masterLevelText,
            masterLevelDb: parseMasterLevelDb(status.masterLevelText),
            diagnostics: { running: diagnostics.running, counters: diagnostics.counters },
        },
        events: diagnostics.events,
    };
}

function maxMasterLevelDb(samples: readonly SampleRecord[]): number | null {
    const levels = samples.map((entry) => entry.masterLevelDb).filter((level) => level !== null);
    return levels.length === 0 ? null : Math.max(...levels);
}

type LegInput = {
    page: Page;
    name: string;
    load: string;
    seconds: number;
    consoleLog: readonly string[];
};

async function runLeg({ page, name, load, seconds, consoleLog }: LegInput): Promise<LegRecord> {
    const consoleStart = consoleLog.length;
    const startedAt = Date.now();
    const samples: SampleRecord[] = [];
    const drained: EngineEventRecord[] = [];

    for (let index = 0; index < seconds; index++) {
        const taken = await sample(page, Date.now() - startedAt);
        samples.push(taken.record);
        drained.push(...taken.events);
        const nextAt = startedAt + (index + 1) * SAMPLE_INTERVAL_MS;
        const wait = nextAt - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) {
        throw new Error(`the ${name} leg collected no sample`);
    }

    return {
        name,
        seconds,
        load,
        samples,
        counterDeltas: computeCounterDeltas(first.diagnostics.counters, last.diagnostics.counters),
        streamErrors: { drained, console: consoleLog.slice(consoleStart) },
        masterLevelDbMax: maxMasterLevelDb(samples),
    };
}

/**
 * `PluginBrowser`'s scan trigger has two shapes: its empty-state branch shows
 * a plain "Scan Plugins" button (no `aria-label`), and only once
 * `supportedPlugins.length > 0` does it switch to the icon-only
 * `[aria-label="Rescan plugins"]` button instead. The scan store is not
 * persisted, so a cold app always shows the empty-state button first.
 */
async function clickPluginScanTrigger(page: Page): Promise<void> {
    const scanPluginsButton = page.getByRole('button', { name: 'Scan Plugins', exact: true });
    if ((await scanPluginsButton.count()) > 0) {
        await scanPluginsButton.click({ timeout: STEP_TIMEOUT_MS });
        return;
    }
    await page.locator('[aria-label="Rescan plugins"]').click({ timeout: STEP_TIMEOUT_MS });
}

/**
 * The scanner walks every platform plugin root out of process and the product
 * allows it up to `SCAN_TIMEOUT_MS` in `electron/scan.ts`, so this polls
 * rather than assuming a short, fixed wait. `PluginBrowser` renders the
 * "Scanning for plugins..." `DawInlineHint` only while `state.isScanning`; the
 * first poll waits for that hint to appear, or 2 s, whichever comes first, so
 * a click that never started a scan is not read as an instant completion.
 */
async function waitForScanToFinish(page: Page): Promise<number> {
    const hint = page.getByText('Scanning for plugins...', { exact: true });
    await hint.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {
        // Not seen within 2 s: either the scan already finished, or the click
        // never started one. Either way the poll below decides, not this wait.
    });

    const startedAt = Date.now();
    const deadline = startedAt + SCAN_STEP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if ((await hint.count()) === 0) {
            return Date.now() - startedAt;
        }
        await sleep(500);
    }
    throw new Error(`the plugin scan did not finish within ${SCAN_STEP_TIMEOUT_MS} ms`);
}

async function driveToPlayingProject(
    page: Page,
    harnessPluginPath: string,
    pageErrors: readonly DiagnosticsEntry[]
): Promise<AppStartedAt> {
    const startedAt = await step('wait for the workspace or the launch screen', () =>
        waitForWorkspaceOrLaunchScreen(page, STEP_TIMEOUT_MS)
    );

    if (startedAt === 'launch-screen') {
        await step('open a new project from the launch screen', () =>
            openNewProjectFromLaunchScreen(page, STEP_TIMEOUT_MS)
        );
    }

    await step('show the browser panel', async () => {
        const panel = page.locator('[aria-label="Browser panel"]');
        if ((await panel.count()) === 0) {
            await page.locator('[aria-label="Toggle browser"]').click({ timeout: STEP_TIMEOUT_MS });
        }
        await panel.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    });

    // Traced on #3070: on a fresh, isolated profile the sidebar's tab bar
    // mounts seconds after the panel container above is visible, and the
    // first-run tour then spotlights it before this driver ever clicks it.
    await step('dismiss the onboarding tour', () => dismissOnboardingTour(page, STEP_TIMEOUT_MS));

    await step('open the Effects tab', () => openEffectsTab(page, STEP_TIMEOUT_MS), EFFECTS_TAB_STEP_TIMEOUT_MS);

    await step(
        'scan for the harness plugin',
        async () => {
            await clickPluginScanTrigger(page);
            const scanMs = await waitForScanToFinish(page);
            process.stdout.write(`scan completed in ${(scanMs / 1000).toFixed(1)} s\n`);
        },
        SCAN_STEP_TIMEOUT_MS
    );

    await step(
        'recover the harness plugin from quarantine if the first scan skipped it',
        () =>
            recoverQuarantinedHarnessPlugin(page, HARNESS_PLUGIN_NAME, harnessPluginPath, {
                stepTimeoutMs: STEP_TIMEOUT_MS,
                scanStepTimeoutMs: SCAN_STEP_TIMEOUT_MS,
            }),
        SCAN_STEP_TIMEOUT_MS
    );

    await step('find the harness plugin in the list', async () => {
        try {
            await page.getByText(HARNESS_PLUGIN_NAME, { exact: true }).first().waitFor({ timeout: STEP_TIMEOUT_MS });
        } catch {
            const panelText = await page.locator('[aria-label="Browser panel"]').innerText();
            const collapsed = panelText.replaceAll(/\s+/g, ' ').trim().slice(0, 600);
            throw new Error(
                `"${HARNESS_PLUGIN_NAME}" never appeared in the plugin list — browser panel showed: "${collapsed}"`
            );
        }
    });

    await step('load the harness plugin onto a new track', async () => {
        await page.getByText(HARNESS_PLUGIN_NAME, { exact: true }).first().click({ timeout: STEP_TIMEOUT_MS });
    });

    await step('confirm the plugin is live on a track', () =>
        waitForLivePluginOnTrack(page, pageErrors, STEP_TIMEOUT_MS)
    );

    await step('wait for the engine to report a running meter', async () => {
        const deadline = Date.now() + STEP_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const status = await readStatusBar(page);
            if (status.masterLevelText.trim() !== 'n/a' && status.engineTitle.startsWith('Engine: running')) {
                return;
            }
            await sleep(250);
        }
        const status = await readStatusBar(page);
        throw new Error(
            `the engine never reported a running meter — engine dot "${status.engineTitle.slice(0, 40)}", master "${status.masterLevelText}"`
        );
    });

    await step('start playback', async () => {
        await page.locator('[aria-label="Playback controls"] [aria-label="Play"]').click({ timeout: STEP_TIMEOUT_MS });
        await page
            .locator('[aria-label="Playback controls"] [aria-label="Pause"]')
            .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    });

    return startedAt;
}

async function stopPlayback(page: Page): Promise<void> {
    const pause = page.locator('[aria-label="Playback controls"] [aria-label="Pause"]');
    if ((await pause.count()) > 0) {
        await pause.click({ timeout: STEP_TIMEOUT_MS });
    }
}

/** SIGTERM, then SIGKILL, then wait for the exit either way: a left-behind app holds the audio device. */
async function quitApp(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const grace = setTimeout(() => child.kill('SIGKILL'), QUIT_GRACE_MS);
    await exited;
    clearTimeout(grace);
}

type MeasuredLegsAndStart = { legs: LegRecord[]; startedAt: AppStartedAt };

type MeasuredLegs = MeasuredLegsAndStart & { version: CdpVersion };

async function measureLegs(
    page: Page,
    seconds: number,
    consoleLog: readonly string[],
    harnessPluginPath: string,
    pageErrors: readonly DiagnosticsEntry[]
): Promise<MeasuredLegsAndStart> {
    const startedAt = await driveToPlayingProject(page, harnessPluginPath, pageErrors);

    const idle = await runLeg({
        page,
        name: 'idle',
        load: 'playback running, no main-thread work beyond the app itself',
        seconds,
        consoleLog,
    });

    await startUiLoad(page);
    const uiLoad = await runLeg({
        page,
        name: 'ui-load',
        load: `${String(UI_LOAD_SPIN_MS)} ms synchronous spin every animation frame, plus a ${String(UI_LOAD_BURST_MS)} ms burst every ${String(UI_LOAD_BURST_PERIOD_MS)} ms`,
        seconds,
        consoleLog,
    });
    await stopUiLoad(page);
    await stopPlayback(page);

    return { legs: [idle, uiLoad], startedAt };
}

function notMeasured(reason: string, jsonPath: string | null): number {
    process.stdout.write(`\nNOT MEASURED: ${reason}\n`);
    if (jsonPath !== null) {
        process.stdout.write('no record written — a run that measured nothing has nothing to record\n');
    }
    return EXIT_NOT_MEASURED;
}

async function connectAndMeasure(
    port: number,
    seconds: number,
    harnessPluginPath: string,
    diagnostics: Diagnostics
): Promise<MeasuredLegs> {
    const target = await waitForAppPageTarget(port);
    process.stdout.write(`page              ${target.url} "${target.title}"\n`);

    const version = await readCdpVersion(port);
    process.stdout.write(`browser           ${version.browser}\n`);
    process.stdout.write(`user agent        ${version.userAgent}\n`);

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
    try {
        const page = await findAppPage(browser);
        subscribeDiagnostics(page, diagnostics, () => activeStep);
        const consoleLog: string[] = [];
        page.on('console', (message) => {
            const text = message.text();
            if (text.includes(STREAM_ERROR_MARKER)) {
                consoleLog.push(text);
            }
        });
        const { legs, startedAt } = await measureLegs(
            page,
            seconds,
            consoleLog,
            harnessPluginPath,
            diagnostics.pageErrors
        );
        return { legs, version, startedAt };
    } finally {
        await browser.close();
    }
}

async function main(): Promise<number> {
    let args: DesktopLatencyArgs;
    try {
        args = parseArgs(process.argv);
    } catch (error) {
        process.stdout.write(`\nNOT MEASURED: ${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_NOT_MEASURED;
    }

    const pluginPath = harnessPluginDestination(process.platform, homedir());
    const binary = resolve(args.appPath, 'Contents/MacOS/Sourdaw');

    process.stdout.write('Packaged desktop latency and dropout measurement\n');
    process.stdout.write('===============================================\n');
    const machine = machineProvenance();
    process.stdout.write(
        `host              ${machine.host.platform} ${machine.host.release} ${machine.host.arch}, ${String(machine.host.cores)} logical cores\n`
    );
    process.stdout.write(`load average (1m) ${machine.loadAverage1m.toFixed(2)}\n`);
    process.stdout.write(`git               ${machine.gitSha} (${machine.workingTree})\n`);
    process.stdout.write(`app               ${args.appPath}\n`);

    if (!existsSync(binary)) {
        return notMeasured(`there is no packaged app binary at ${binary}. Run \`pnpm desktop:build\`.`, args.jsonPath);
    }
    if (!existsSync(pluginPath)) {
        return notMeasured(
            `the harness plugin is not installed at ${pluginPath}. Run \`pnpm harness:plugin:install\`.`,
            args.jsonPath
        );
    }

    // Never the operator's own `~/Library/Application Support/sourdaw`: that
    // profile can carry a project persisted by an earlier build, on which the
    // driver's own project mutations (adding a track, loading a plugin) are
    // refused.
    const profileDir = mkdtempSync(join(tmpdir(), PROFILE_DIR_PREFIX));
    process.stdout.write(`profile           isolated (${profileDir})\n`);
    process.stdout.write(`plugin            ${pluginPath}\n`);
    process.stdout.write(`legs              idle and ui-load, ${String(args.seconds)} s each\n`);

    const port = await pickFreePort();
    const child = spawn(binary, [`--remote-debugging-port=${String(port)}`, `--user-data-dir=${profileDir}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));

    const diagnostics = emptyDiagnostics();
    let measured: MeasuredLegs;
    try {
        measured = await connectAndMeasure(port, args.seconds, pluginPath, diagnostics);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stdout.write(`\n--- packaged app output ---\n${output.join('').trim()}\n`);
        printDiagnostics(diagnostics);
        return notMeasured(reason, args.jsonPath);
    } finally {
        await quitApp(child);
        rmSync(profileDir, { recursive: true, force: true });
    }

    process.stdout.write(`started at        ${measured.startedAt}\n`);
    for (const leg of measured.legs) {
        reportLeg(leg);
    }
    printDiagnostics(diagnostics);

    const verdict = decideVerdict(measured.legs);
    const reason =
        verdict === 'measured'
            ? 'the plugin reached the master meter and both legs completed'
            : `the master level never exceeded ${describeAudibleFloor()} after the plugin was loaded`;

    const record: DesktopLatencyRecord = {
        schemaVersion: 1,
        measuredAt: new Date().toISOString(),
        machine,
        app: {
            path: args.appPath,
            bundleVersion: readBundleVersion(args.appPath),
            browser: measured.version.browser,
            userAgent: measured.version.userAgent,
            startedAt: measured.startedAt,
            profile: 'isolated',
        },
        plugin: { path: pluginPath },
        legs: measured.legs,
        diagnostics,
        verdict,
        reason,
    };

    process.stdout.write(`\nVERDICT ${verdict.toUpperCase()} — ${reason}\n`);
    process.stdout.write(
        'Dropouts and stream errors above are recorded, not failed: pre-cutover the plugin renders through Web Audio\n' +
            'and the worklet bridge, and the native master carries no plugin audio yet.\n'
    );

    if (args.jsonPath !== null && verdict === 'measured') {
        writeRecord(args.jsonPath, record);
    }
    if (args.jsonPath !== null && verdict !== 'measured') {
        process.stdout.write('\nno record written — a failed run is not a baseline\n');
    }

    return verdict === 'measured' ? EXIT_MEASURED : EXIT_FAILED;
}

// The pure helpers above are unit-tested, so importing this file must not
// launch a packaged app. `realpathSync`, because the ESM loader realpaths
// `import.meta.url` while `argv[1]` keeps any symlink — see
// `scripts/installHarnessPlugin.ts`, which carries the same guard.
const invokedPath = process.argv[1] === undefined ? '' : realpathSync(resolve(process.argv[1]));
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
