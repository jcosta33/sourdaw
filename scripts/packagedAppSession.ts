/**
 * One packaged-app session: pick a debug port, spawn the shipped binary
 * against an isolated profile, connect to its renderer over the Chrome
 * DevTools Protocol, and tear all of it down again — on success, on failure,
 * and on an operator cancelling the run.
 *
 * Both drivers that speak to the shipped artefact use this: the latency
 * measurement (`desktopLatencyProcess.ts`) and the agent-workspace proof
 * (`proveDesktopAgentWorkspace.ts`). A second copy of the spawn and teardown
 * would let the two drift onto different profiles, different override
 * stripping, or different signal handling, and a harness that launches the
 * app differently than the measurement did is no longer measuring the same
 * thing.
 *
 * Most of this file spawns a real process and drives a live `Page`, so — like
 * the drivers themselves — it is not unit-testable without Playwright.
 * `stripPayloadOverrides` is pure and `removeProfileDir` is testable because
 * its file-system call is injectable; both carry their own specs.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';

import { chromium, type Browser, type Page } from 'playwright';

import { printDiagnostics, subscribeDiagnostics, type Diagnostics } from './desktopLatencyDiagnostics.ts';
import { findAppPageTarget, type AppPageTarget } from './desktopLatencyReadings.ts';
import { sleep } from './desktopLatencySleep.ts';

const QUIT_GRACE_MS = 10_000;
const APP_READY_TIMEOUT_MS = 30_000;
const APP_URL_PREFIX = 'app://sourdaw/';

/** Every UI step is bounded by default; a selector that never appears must name its step, not hang the run. */
export const STEP_TIMEOUT_MS = 15_000;

/**
 * `electron/main.ts`'s own default window size. The runner's screen can clamp
 * the window Electron asks for, and a renderer laid out narrower than the app
 * ever ships collapses responsive surfaces into compact variants no driver
 * here is written against — the exact way the nightly job silently dropped the
 * app into the status bar's compact layout on 2026-09-09. Viewport emulation
 * over CDP changes only what the renderer lays out; it does not touch the
 * native engine's audio rendering or the OS audio device stream.
 */
const DEFAULT_WINDOW_VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * The env vars that redirect the packaged app to files
 * `readPayloadIdentity` (`desktopLatencyRecord.ts`) never hashed:
 * `electron/native.ts`'s `NATIVE_ADDON_PATH_ENV` and
 * `NATIVE_SCAN_HELPER_PATH_ENV` override where the native addon and the
 * plugin-scan helper are loaded from, and `electron/scanWorker.ts`'s
 * `SCAN_WORKER_COMMAND_ENV` carries a leaf-launch command that can itself
 * name a different scan helper binary. A run that inherited any of these
 * from the operator's own shell would drive a binary the record's payload
 * identity says nothing about.
 */
const PAYLOAD_OVERRIDE_ENV_KEYS = [
    'SOURDAW_NATIVE_ADDON',
    'SOURDAW_PLUGIN_SCAN_HELPER',
    'SOURDAW_PLUGIN_SCAN_WORKER_COMMAND',
] as const;

export type StrippedEnv = { env: NodeJS.ProcessEnv; dropped: string[] };

/**
 * Copies `env` with the payload-override keys removed, naming which of them
 * were actually set so a bisecting operator sees what was dropped rather
 * than silently driving a different binary than the one it printed.
 *
 * Pure — takes the environment as an argument and returns a copy rather than
 * mutating `process.env` in place, which is what lets a spec exercise it
 * without touching the real process environment.
 */
export function stripPayloadOverrides(env: NodeJS.ProcessEnv): StrippedEnv {
    const dropped: string[] = PAYLOAD_OVERRIDE_ENV_KEYS.filter((key) => env[key] !== undefined);
    const droppedKeys = new Set<string>(dropped);
    const stripped: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(env).filter(([key]) => !droppedKeys.has(key))
    );
    return { env: stripped, dropped };
}

export type ProfileRemoval = { removed: true } | { removed: false; reason: string };

/**
 * `rmSync`'s default `maxRetries` is 0, so a file a still-exiting Chromium
 * helper process creates while the recursive removal walks the profile
 * directory turns into a thrown `ENOTEMPTY` instead of a completed removal.
 * `maxRetries`/`retryDelay` make Node retry `EBUSY`, `EMFILE`, `ENFILE`,
 * `ENOTEMPTY`, and `EPERM`, which is enough for a process that is already
 * exiting to finish clearing its own files. Node 24's `fs.rmSync` sleeps
 * `i * retryDelay / 1000` whole seconds between retries on POSIX (integer
 * division in `src/node_file.cc`), so `retryDelay` only takes effect in
 * whole-second increments; the values below give two attempts, at 0 s and
 * after a 1 s sleep, then a 2 s sleep before the throw, so a removal that
 * never succeeds costs 3 s.
 */
function removeDirectoryWithRetries(path: string, rm: typeof rmSync): void {
    rm(path, { recursive: true, force: true, maxRetries: 1, retryDelay: 1000 });
}

/**
 * Removes the temporary profile directory without ever throwing: a run's
 * verdict is about what it drove, not about temp cleanup, so a removal
 * failure is reported to the caller instead of raised.
 */
export function removeProfileDir(profileDir: string, rm: typeof rmSync = rmSync): ProfileRemoval {
    try {
        removeDirectoryWithRetries(profileDir, rm);
        return { removed: true };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { removed: false, reason };
    }
}

function reportProfileRemoval(profileDir: string, removal: ProfileRemoval): void {
    if (removal.removed) {
        return;
    }
    process.stdout.write(`profile directory left behind: ${profileDir} (${removal.reason})\n`);
}

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

/**
 * An operator cancelling a run sends the driver SIGINT or SIGTERM. Node
 * installs no default handler for either that also tears down what the
 * driver itself started: with none registered here, the signal's default
 * action terminates the driver immediately, leaving `Sourdaw.app` holding
 * the audio device and the temporary profile directory behind in
 * `$TMPDIR`. The handler removes itself and re-raises the same signal once
 * `quitApp` and the profile removal have run, so the process still ends the
 * way the operator asked — the default terminating behaviour is restored,
 * never swallowed.
 */
function installTeardownOnSignal(signal: NodeJS.Signals, child: ChildProcess, profileDir: string): () => void {
    const handler = (): void => {
        void (async () => {
            await quitApp(child);
            reportProfileRemoval(profileDir, removeProfileDir(profileDir));
            process.off(signal, handler);
            process.kill(process.pid, signal);
        })();
    };
    process.on(signal, handler);
    return () => process.off(signal, handler);
}

/**
 * The name of the step currently running, read by the `console`/`pageerror`
 * listeners this module subscribes so a diagnostics entry can say what the
 * driver was doing when it fired, not just when.
 */
let activeStep = '';

/**
 * Every UI step is bounded. Without this a selector that never appears hangs
 * the run instead of reporting which step did not hold, and an unattributed
 * hang teaches nothing.
 */
export async function step<Result>(
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

export type CdpVersion = { browser: string; userAgent: string };

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
 * The one outcome an aborted pre-connect `fetch` and an already-tripped
 * `signal` are both reported as, so the caller sees one consistent reason
 * rather than a raw `AbortError` in one case and a named message in the other.
 */
const SPAWN_ABORTED_BEFORE_CONNECT_MESSAGE = 'the packaged app process failed before its page target ever appeared';

/** `fetch` rejects with a `DOMException` named `AbortError` when its `signal` fires, in both the browser and Node's own `undici`-backed implementation. */
function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
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
 * does. The launcher aborts as soon as it has the spawn error in hand, so
 * this rejection, arriving after that, never reaches a caller —
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

type ConnectedRenderer = { browser: Browser; page: Page; version: CdpVersion };

async function connectToRenderer(
    port: number,
    diagnostics: Diagnostics,
    signal: AbortSignal
): Promise<ConnectedRenderer> {
    const target = await waitForAppPageTarget(port, signal);
    process.stdout.write(`page              ${target.url} "${target.title}"\n`);

    const version = await readCdpVersion(port, signal);
    process.stdout.write(`browser           ${version.browser}\n`);
    process.stdout.write(`user agent        ${version.userAgent}\n`);

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
    try {
        const page = await findAppPage(browser);
        await page.setViewportSize(DEFAULT_WINDOW_VIEWPORT);
        subscribeDiagnostics(page, diagnostics, () => activeStep);
        return { browser, page, version };
    } catch (error) {
        await browser.close();
        throw error;
    }
}

export type PackagedApp = {
    page: Page;
    version: CdpVersion;
    /** Everything the packaged process has written to stdout and stderr so far. */
    output: () => string;
    /** Closes the CDP connection, quits the app, removes the profile directory, and releases the signal handlers. */
    quit: () => Promise<void>;
};

/**
 * Spawns the packaged binary against the given isolated profile and connects
 * to its renderer, returning the page to drive plus the teardown the caller
 * must run however its own work ends. A launch that fails prints the app's
 * own output and the diagnostics collected so far, tears down what it
 * started, and rethrows; the caller decides what a failed launch means for
 * its verdict. A profile-removal failure is reported on stdout and never
 * thrown, so a temp directory that cannot be deleted does not discard an
 * otherwise-completed run.
 */
export async function launchPackagedApp(
    binary: string,
    profileDir: string,
    diagnostics: Diagnostics
): Promise<PackagedApp> {
    const port = await pickFreePort();
    const { env: spawnEnv, dropped } = stripPayloadOverrides(process.env);
    if (dropped.length > 0) {
        process.stdout.write(
            `dropped override(s) ${dropped.join(', ')} — the packaged app loads only what its payload identity hashed\n`
        );
    }
    const child = spawn(binary, [`--remote-debugging-port=${String(port)}`, `--user-data-dir=${profileDir}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spawnEnv,
    });
    const collected: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => collected.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => collected.push(chunk.toString('utf8')));
    const output = (): string => collected.join('');

    // An async spawn failure (the binary present but not executable, for
    // instance) fires `child`'s own 'error' event; with no listener that is
    // an uncaught exception that skips the teardown below entirely — no
    // verdict line, no quit, and the mkdtemp profile directory leaks. Racing
    // it against the connect routes it into the same failure path a connect
    // failure already takes. `Promise.race` attaches its own handler to this
    // promise at construction, so a rejection that arrives after the race has
    // already settled — the app starts fine, then `child` reports an error
    // much later — is still a handled rejection, not an unhandled one.
    //
    // The race alone only decides which error is reported; it does not stop
    // the losing side from still running. Without `abortController`, a spawn
    // failure that wins the race still leaves the connect polling a debug
    // port that will never open for the rest of `APP_READY_TIMEOUT_MS`, so
    // the process only actually exits about 30 s after printing its verdict.
    // Aborting on the spawn-failure path — and again in `quit`, so a normal
    // run or a connect failure also releases the signal — cuts that poll
    // short. `Promise.race` has already settled on the spawn error by the
    // time the aborted poll's own rejection arrives, so aborting never masks
    // it.
    const abortController = new AbortController();
    const spawnFailure = new Promise<never>((_resolve, reject) => {
        child.once('error', (error) => {
            abortController.abort();
            reject(new Error(`the packaged app process reported an error: ${error.message}`));
        });
    });

    const removeSigintTeardown = installTeardownOnSignal('SIGINT', child, profileDir);
    const removeSigtermTeardown = installTeardownOnSignal('SIGTERM', child, profileDir);

    const quitProcess = async (): Promise<void> => {
        abortController.abort();
        await quitApp(child);
        reportProfileRemoval(profileDir, removeProfileDir(profileDir));
        removeSigintTeardown();
        removeSigtermTeardown();
    };

    let connected: ConnectedRenderer;
    try {
        connected = await Promise.race([connectToRenderer(port, diagnostics, abortController.signal), spawnFailure]);
    } catch (error) {
        process.stdout.write(`\n--- packaged app output ---\n${output().trim()}\n`);
        printDiagnostics(diagnostics);
        await quitProcess();
        throw error;
    }

    return {
        page: connected.page,
        version: connected.version,
        output,
        quit: async () => {
            await connected.browser.close();
            await quitProcess();
        },
    };
}
