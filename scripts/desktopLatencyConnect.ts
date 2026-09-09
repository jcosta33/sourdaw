/**
 * Connecting to the already-spawned packaged app over the Chrome DevTools
 * Protocol and driving it, through its own UI, all the way to a playing
 * project with the harness plugin live on a track — the two legs this
 * harness measures are samples taken while that holds.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; this file still drives a live `Page`
 * and speaks CDP, so — like the driver, and unlike `desktopLatencyReadings.ts`
 * — it is not unit-testable without Playwright.
 */

import { chromium, type Browser, type Page } from 'playwright';

import { subscribeDiagnostics, waitForLivePluginOnTrack, type Diagnostics } from './desktopLatencyDiagnostics.ts';
import {
    dismissAlphaNotice,
    dismissOnboardingTour,
    openEffectsTab,
    openNewProjectFromLaunchScreen,
    waitForWorkspaceOrLaunchScreen,
} from './desktopLatencyLaunch.ts';
import {
    describePlayStart,
    resolvePlayStart,
    type PlayStartProbe,
    type PlayStartRecord,
} from './desktopLatencyPlayStart.ts';
import { recoverQuarantinedHarnessPlugin } from './desktopLatencyPreferencesRecovery.ts';
import {
    computeCounterDeltas,
    computeGaugeReadings,
    findAppPageTarget,
    parseEngineTitle,
    parseLatencyMs,
    parseMasterLevelDb,
    readStatusBarInDocument,
    type AppPageTarget,
    type StatusBarReading,
} from './desktopLatencyReadings.ts';
import {
    type AppStartedAt,
    type DiagnosticsEntry,
    type EngineEventRecord,
    type LegRecord,
    type SampleRecord,
} from './desktopLatencyRecord.ts';
import { sleep } from './desktopLatencySleep.ts';
import {
    startUiLoad,
    stopUiLoad,
    UI_LOAD_BURST_MS,
    UI_LOAD_BURST_PERIOD_MS,
    UI_LOAD_SPIN_MS,
} from './desktopLatencyUiLoad.ts';

const SAMPLE_INTERVAL_MS = 1_000;
const STEP_TIMEOUT_MS = 15_000;
const APP_READY_TIMEOUT_MS = 30_000;

/** `AppShell`'s transport toolbar — shared by the Play click and the play-start probe's capture listener so both target the same element. */
const PLAY_BUTTON_SELECTOR = '[aria-label="Playback controls"] [aria-label="Play"]';

/**
 * How long `installPlayStartProbe`'s in-page poll loop keeps polling
 * `engine_transport_position`, *counted from the gesture*, before giving up
 * on ever seeing `playing`. Generous against `STEP_TIMEOUT_MS`: a native roll
 * that has not landed within 5 s of the click is itself the finding this
 * probe exists to catch, not a timeout to tune away.
 *
 * The window cannot be counted from install: the click that follows install
 * may spend up to `STEP_TIMEOUT_MS` on Playwright's own actionability checks
 * before it ever lands, and an install-anchored deadline would have the loop
 * give up and remove its listener before a late click ever reached it —
 * reporting "the play click never reached the capture listener" for a click
 * that simply took its own allowance to arrive. Before the gesture, the loop
 * instead lives for that same `STEP_TIMEOUT_MS` allowance (`installPlayStartProbe`'s
 * `armMs`), so a click that is ever going to land inside its own actionability
 * budget always finds the listener still attached, and "never reached the
 * capture listener" is true by construction once that budget has passed.
 */
const PLAY_START_PROBE_WINDOW_MS = 5_000;

/**
 * The scratch key `installPlayStartProbe` stores its poll-loop promise under
 * on the page's own `globalThis`, and `readPlayStartProbe` reads and deletes
 * it from. Shared as a constant, passed into both evaluations as an
 * argument, so the two functions can never drift onto different keys.
 */
const PLAY_START_PROBE_KEY = '__sourdawPlayStartProbe';

/** `electron/scan.ts`'s own `SCAN_TIMEOUT_MS` bounds a scan at 120 s; this adds margin on top of it. */
const SCAN_STEP_TIMEOUT_MS = 150_000;

/**
 * `openEffectsTab` performs up to five operations in sequence, each
 * individually bounded at `STEP_TIMEOUT_MS`: a click, an "External Plugins"
 * wait, a full `dismissOnboardingTour` call, a second click, and a second
 * "External Plugins" wait. Sized to that worst case — not a smaller
 * multiple — so the outer `step()` timer here never fires before
 * `openEffectsTab`'s own internal logic has had the full budget its retry
 * needs, which would otherwise throw a bare timeout instead of the
 * `describeElementAtCentre` diagnostic that logic produces on a genuine
 * second failure.
 */
const EFFECTS_TAB_STEP_TIMEOUT_MS = STEP_TIMEOUT_MS * 5;

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

/**
 * The status bar collapses its secondary readouts — "Out" among them — into a
 * Radix Popover behind `button[aria-label="More application status"]` at or
 * below `COMPACT_STATUS_BAR_MAX_WIDTH` (1199 px) in `StatusBar.tsx`. Electron
 * asks for a 1440×900 window in `electron/main.ts`, but the runner's own
 * screen can clamp that request narrower than 1200 px — the exact way the
 * nightly job silently dropped the app into the compact layout on 2026-09-09
 * and lost the "Out" readout this harness reads. Pinning the viewport to the
 * app's own default window size, right after connecting, keeps the expanded
 * layout regardless of the runner's screen. Viewport emulation over CDP
 * changes only what the renderer lays out; it does not touch the native
 * engine's audio rendering or the OS audio device stream this harness
 * measures.
 */
const EXPANDED_STATUS_BAR_VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * The one outcome an aborted pre-connect `fetch` and an already-tripped
 * `signal` are both reported as, so `launchAndMeasure`'s caller sees one
 * consistent reason rather than a raw `AbortError` in one case and a named
 * message in the other.
 */
const SPAWN_ABORTED_BEFORE_CONNECT_MESSAGE = 'the packaged app process failed before its page target ever appeared';

/** `fetch` rejects with a `DOMException` named `AbortError` when its `signal` fires, in both the browser and Node's own `undici`-backed implementation. */
function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

type EngineDiagnosticsReading = {
    running: boolean;
    counters: Record<string, number>;
    events: EngineEventRecord[];
};

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
 *
 * `signal`, when given, is checked at the top of every iteration and passed
 * into the `fetch` itself: if the packaged process has already failed to
 * spawn, the debug port this polls will never open, and without a way to
 * cut the loop short it would keep polling a dead port for the rest of
 * `APP_READY_TIMEOUT_MS` regardless. Checking only at the top of the loop
 * would still leave one in-flight `fetch` to complete or time out on its
 * own; passing the signal into the `fetch` call itself aborts that request
 * too, so an abort during the request is not silently swallowed by the
 * catch block below as "the app has not opened the port yet" — `isAbortError`
 * recognises it and reports the same aborted outcome the top-of-loop check
 * does. `launchAndMeasure` aborts as soon as it has the spawn error in hand,
 * so this rejection, arriving after that, never reaches a caller —
 * `Promise.race` there has already settled on the spawn error by the time
 * it does.
 */
async function waitForAppPageTarget(port: number, signal?: AbortSignal): Promise<AppPageTarget> {
    const deadline = Date.now() + APP_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (signal?.aborted === true) {
            throw new Error(SPAWN_ABORTED_BEFORE_CONNECT_MESSAGE);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`, { signal });
            if (response.ok) {
                const target = findAppPageTarget(await response.json(), APP_URL_PREFIX);
                if (target !== null) {
                    return target;
                }
            }
        } catch (error) {
            if (isAbortError(error)) {
                throw new Error(SPAWN_ABORTED_BEFORE_CONNECT_MESSAGE, { cause: error });
            }
            // The app has not opened the port yet. Keep polling until the deadline.
        }
        await sleep(100);
    }
    throw new Error(
        `no page at ${APP_URL_PREFIX} with a parsed document appeared within ${String(APP_READY_TIMEOUT_MS)} ms`
    );
}

async function readCdpVersion(port: number, signal?: AbortSignal): Promise<CdpVersion> {
    let response: Response;
    try {
        response = await fetch(`http://127.0.0.1:${String(port)}/json/version`, { signal });
    } catch (error) {
        throw isAbortError(error) ? new Error(SPAWN_ABORTED_BEFORE_CONNECT_MESSAGE, { cause: error }) : error;
    }
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
 * Hands `readStatusBarInDocument` itself to `page.evaluate`, which serialises
 * it by its own source text and runs that text inside the page — the one
 * walk this harness reads the status bar with, run where the DOM actually is
 * rather than copied by hand into a second in-page version. See
 * `readStatusBarInDocument`'s own doc comment in `desktopLatencyReadings.ts`
 * for why it has to stay self-contained for this to work.
 */
async function readStatusBar(page: Page): Promise<StatusBarReading> {
    return page.evaluate(readStatusBarInDocument, { selector: STATUS_BAR_SELECTOR });
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

/**
 * Installs a capture-phase click listener on `document`, then starts an
 * un-awaited in-page poll loop against `engine_transport_position` and
 * stores its promise on the page's own `globalThis` under
 * `PLAY_START_PROBE_KEY` for `readPlayStartProbe` to collect later. The loop
 * polls back-to-back — no `setTimeout` between polls — until the engine
 * reports `playing` or its deadline elapses. The IPC round trip is what
 * paces the loop, stamped on both sides (`issuedAtMs` before it,
 * `answeredAtMs` after), but it is the engine's own callback period — read
 * once from `engine_rt_diagnostics` after the loop closes — that actually
 * bounds how tight a bracket `resolvePlayStart` can draw around the moment
 * the engine rolled: a `playing:false` answer can be stale by up to one whole
 * callback, however fast the round trip that fetched it was. The two stamps
 * and the callback period together are what let `resolvePlayStart` draw a
 * sound bracket instead of one keyed to the poll loop's own cadence.
 *
 * The loop's deadline is armed in two stages, because the click that follows
 * this call is not instantaneous: before the gesture lands, the loop only
 * lives for `armMs` — the click's own actionability allowance — and once
 * `onClick` records `gestureAtMs` the deadline becomes `gestureAtMs +
 * windowMs` instead. Arming the window on install instead would let a click
 * that spends close to its full allowance on actionability find the listener
 * already torn down, misreporting a slow-but-real click as one that never
 * reached the capture listener.
 *
 * Split from the read into its own awaited evaluation, called before the
 * click in `driveToPlayingProject`, because the click has to find the
 * capture listener already attached: an unawaited `page.evaluate` dispatched
 * back-to-back with the click gives Playwright's own CDP transport no
 * ordering guarantee that the listener installs before the click event
 * fires, which is exactly the race that used to leave `gestureAtMs` null.
 * Awaiting this evaluation before the click proves the listener is attached
 * — it does not wait for the poll loop itself, which keeps running in the
 * page after this call returns.
 *
 * Any rejection inside the loop — an `invoke` rejection, a non-object
 * answer, or the closing diagnostics read failing — is caught rather than
 * left to reject the stored promise: an unawaited in-page promise that
 * rejects surfaces first as an unhandled rejection attributed to the app
 * itself, and would otherwise cost the whole run its play-start record. The
 * catch instead resolves with `failure` set to the error's message, which
 * `resolvePlayStart` reports as a `not-observed` outcome.
 *
 * `PLAY_START_PROBE_KEY` is this harness's own scratch on the page under
 * test; `readPlayStartProbe` removes it once it has collected the result.
 */
async function installPlayStartProbe(page: Page): Promise<void> {
    await page.evaluate(
        ({ selector, windowMs, armMs, key }: { selector: string; windowMs: number; armMs: number; key: string }) => {
            const bridge: unknown = Reflect.get(globalThis, 'sourdaw');
            if (typeof bridge !== 'object' || bridge === null) {
                throw new TypeError('window.sourdaw is absent — this is not the packaged desktop app');
            }
            const invoke: unknown = Reflect.get(bridge, 'invoke');
            if (typeof invoke !== 'function') {
                throw new TypeError('window.sourdaw.invoke is absent');
            }
            const call = invoke as (command: string, args: readonly unknown[]) => Promise<unknown>;

            // Held in an object rather than a bare `let` so the ternary in the
            // loop condition below reads a property, not a closure-reassigned
            // local: a bare `let number | null` reassigned only inside
            // `onClick` type-narrows the else branch of `gesture.atMs === null
            // ? … : …` to `never` under this project's type-aware lint pass,
            // which does not widen a captured local back out across a closure
            // boundary the way `tsc` itself does.
            const gesture: { atMs: number | null } = { atMs: null };
            const onClick = (event: Event): void => {
                if (event.target instanceof Element && event.target.closest(selector) !== null) {
                    gesture.atMs = performance.now();
                    document.removeEventListener('click', onClick, true);
                }
            };
            document.addEventListener('click', onClick, true);

            const pollLoop = (async () => {
                const polls: {
                    issuedAtMs: number;
                    answeredAtMs: number;
                    playing: boolean;
                    positionSeconds: number;
                }[] = [];
                try {
                    const installedAtMs = performance.now();
                    while (
                        gesture.atMs === null
                            ? performance.now() < installedAtMs + armMs
                            : performance.now() < gesture.atMs + windowMs
                    ) {
                        const issuedAtMs = performance.now();
                        const payload: unknown = await call('engine_transport_position', []);
                        const answeredAtMs = performance.now();
                        if (typeof payload !== 'object' || payload === null) {
                            throw new TypeError('engine_transport_position did not answer with an object');
                        }
                        const playing = Reflect.get(payload, 'playing') === true;
                        const positionSeconds = Number(Reflect.get(payload, 'positionSeconds'));
                        polls.push({ issuedAtMs, answeredAtMs, playing, positionSeconds });
                        if (playing) {
                            break;
                        }
                    }

                    document.removeEventListener('click', onClick, true);

                    // Read after the bracket above is fully closed, so this
                    // round trip cannot itself perturb the poll loop it explains.
                    const diagnostics: unknown = await call('engine_rt_diagnostics', []);
                    if (typeof diagnostics !== 'object' || diagnostics === null) {
                        throw new TypeError('engine_rt_diagnostics did not answer with an object');
                    }
                    const outputBufferFrames = Number(Reflect.get(diagnostics, 'outputBufferFrames'));
                    const sampleRate = Number(Reflect.get(diagnostics, 'sampleRate'));
                    const callbackPeriodMs = sampleRate > 0 ? (outputBufferFrames / sampleRate) * 1000 : 0;

                    return { gestureAtMs: gesture.atMs, callbackPeriodMs, polls, failure: null };
                } catch (error) {
                    document.removeEventListener('click', onClick, true);
                    const message = error instanceof Error ? error.message : String(error);
                    return { gestureAtMs: gesture.atMs, callbackPeriodMs: 0, polls, failure: message };
                }
            })();

            Reflect.set(globalThis, key, pollLoop);
        },
        {
            selector: PLAY_BUTTON_SELECTOR,
            windowMs: PLAY_START_PROBE_WINDOW_MS,
            armMs: STEP_TIMEOUT_MS,
            key: PLAY_START_PROBE_KEY,
        }
    );
}

/**
 * Collects the poll loop `installPlayStartProbe` started, awaiting its
 * result and removing the scratch key so a later run never finds a stale
 * promise left over from this one.
 */
async function readPlayStartProbe(page: Page): Promise<PlayStartProbe> {
    return page.evaluate(async (key: string) => {
        const pollLoop: unknown = Reflect.get(globalThis, key);
        if (pollLoop === undefined) {
            throw new TypeError(`no play-start probe was installed under "${key}"`);
        }
        const result = await (pollLoop as Promise<PlayStartProbe>);
        Reflect.deleteProperty(globalThis, key);
        return result;
    }, PLAY_START_PROBE_KEY);
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
    // The loop above takes `seconds` samples at t≈0,1,…,(seconds−1) s and
    // waits out the final interval before exiting; this closing sample,
    // taken right here with no further wait, is what makes `first`→`last`
    // below span the leg's whole `seconds` window instead of stopping one
    // interval short of it.
    const closing = await sample(page, Date.now() - startedAt);
    samples.push(closing.record);
    drained.push(...closing.events);

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
        gaugeReadings: computeGaugeReadings(first.diagnostics.counters, last.diagnostics.counters),
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

type AppStartedResult = { startedAt: AppStartedAt; playStart: PlayStartRecord };

async function driveToPlayingProject(
    page: Page,
    harnessPluginPath: string,
    pageErrors: readonly DiagnosticsEntry[]
): Promise<AppStartedResult> {
    const startedAt = await step('wait for the workspace or the launch screen', () =>
        waitForWorkspaceOrLaunchScreen(page, STEP_TIMEOUT_MS)
    );

    if (startedAt === 'launch-screen') {
        await step('open a new project from the launch screen', () =>
            openNewProjectFromLaunchScreen(page, STEP_TIMEOUT_MS)
        );
    }

    // `AppShell.tsx` opens this the moment the project is initialized on a
    // fresh profile, before the onboarding tour below ever starts — and its
    // modal overlay marks every sibling `aria-hidden`, which is what the tour
    // step used to race against. Placed here so it also covers the
    // `workspace` start path, which skips the launch-screen click above but
    // not this dialog.
    await step('dismiss the alpha notice', () => dismissAlphaNotice(page, STEP_TIMEOUT_MS));

    await step('show the browser panel', async () => {
        const panel = page.locator('[aria-label="Browser panel"]');
        if ((await panel.count()) === 0) {
            await page.locator('[aria-label="Toggle browser"]').click({ timeout: STEP_TIMEOUT_MS });
        }
        await panel.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    });

    // Traced on #3070: fresh profile → alpha notice → onboarding tour, in
    // that order. The tour spotlights the tab bar before this driver ever
    // clicks it; the harness measures audio, not onboarding.
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

    // Awaited before the click below dispatches: the capture listener has to
    // already be attached in the page when the click's own CDP sequence
    // fires, and this await is what proves that ordering instead of leaving
    // it to two evaluations Playwright could otherwise dispatch out of order.
    await step('install the play-start probe', () => installPlayStartProbe(page));
    await step('start playback', async () => {
        await page.locator(PLAY_BUTTON_SELECTOR).click({ timeout: STEP_TIMEOUT_MS });
        await page
            .locator('[aria-label="Playback controls"] [aria-label="Pause"]')
            .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    });
    const probe = await step(
        'read the play-start probe',
        () => readPlayStartProbe(page),
        PLAY_START_PROBE_WINDOW_MS + STEP_TIMEOUT_MS
    );
    const playStart = resolvePlayStart(probe);
    process.stdout.write(`${describePlayStart(playStart)}\n`);

    return { startedAt, playStart };
}

async function stopPlayback(page: Page): Promise<void> {
    const pause = page.locator('[aria-label="Playback controls"] [aria-label="Pause"]');
    if ((await pause.count()) > 0) {
        await pause.click({ timeout: STEP_TIMEOUT_MS });
    }
}

type MeasuredLegsAndStart = { legs: LegRecord[]; startedAt: AppStartedAt; playStart: PlayStartRecord };

export type MeasuredLegs = MeasuredLegsAndStart & { version: CdpVersion };

async function measureLegs(
    page: Page,
    seconds: number,
    consoleLog: readonly string[],
    harnessPluginPath: string,
    pageErrors: readonly DiagnosticsEntry[]
): Promise<MeasuredLegsAndStart> {
    const { startedAt, playStart } = await driveToPlayingProject(page, harnessPluginPath, pageErrors);

    const idle = await runLeg({
        page,
        name: 'idle',
        load: 'playback running, no main-thread work beyond the app itself',
        seconds,
        consoleLog,
    });

    // `runLeg`'s own closing sample above just ran; `startUiLoad` is a single
    // `page.evaluate` round trip, so the ui-load leg's own opening sample
    // below follows the idle leg's closing one by that one call's latency
    // rather than a whole recorded second going unsampled between the legs.
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

    return { legs: [idle, uiLoad], startedAt, playStart };
}

export async function connectAndMeasure(
    port: number,
    seconds: number,
    harnessPluginPath: string,
    diagnostics: Diagnostics,
    signal?: AbortSignal
): Promise<MeasuredLegs> {
    const target = await waitForAppPageTarget(port, signal);
    process.stdout.write(`page              ${target.url} "${target.title}"\n`);

    const version = await readCdpVersion(port, signal);
    process.stdout.write(`browser           ${version.browser}\n`);
    process.stdout.write(`user agent        ${version.userAgent}\n`);

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
    try {
        const page = await findAppPage(browser);
        await page.setViewportSize(EXPANDED_STATUS_BAR_VIEWPORT);
        subscribeDiagnostics(page, diagnostics, () => activeStep);
        const consoleLog: string[] = [];
        page.on('console', (message) => {
            const text = message.text();
            if (text.includes(STREAM_ERROR_MARKER)) {
                consoleLog.push(text);
            }
        });
        const { legs, startedAt, playStart } = await measureLegs(
            page,
            seconds,
            consoleLog,
            harnessPluginPath,
            diagnostics.pageErrors
        );
        return { legs, version, startedAt, playStart };
    } finally {
        await browser.close();
    }
}
