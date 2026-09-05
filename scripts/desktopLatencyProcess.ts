/**
 * The packaged app's own process lifecycle: picking a debug port, spawning
 * it, connecting to it and running the measurement, and tearing it down
 * again — on success, on failure, and on an operator cancelling the run.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; this file still spawns a real process
 * and drives a live `Page` through `connectAndMeasure`, so — like the
 * driver, and unlike `desktopLatencyReadings.ts` — most of it is not
 * unit-testable without Playwright. `stripPayloadOverrides` is pure, and
 * `removeProfileDir` is testable because its file-system call is
 * injectable; it carries its own spec.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';

import { connectAndMeasure, type MeasuredLegs } from './desktopLatencyConnect.ts';
import { printDiagnostics, type Diagnostics } from './desktopLatencyDiagnostics.ts';

const QUIT_GRACE_MS = 10_000;

/**
 * The env vars that redirect the packaged app to files
 * `readPayloadIdentity` (`desktopLatencyRecord.ts`) never hashed:
 * `electron/native.ts`'s `NATIVE_ADDON_PATH_ENV` and
 * `NATIVE_SCAN_HELPER_PATH_ENV` override where the native addon and the
 * plugin-scan helper are loaded from, and `electron/scanWorker.ts`'s
 * `SCAN_WORKER_COMMAND_ENV` carries a leaf-launch command that can itself
 * name a different scan helper binary. A run that inherited any of these
 * from the operator's own shell would measure a binary the record's payload
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
 * than silently measuring a different binary than the one it printed.
 *
 * Pure — takes the environment as an argument and returns a copy rather than
 * mutating `process.env` in place, which is what lets a spec exercise it
 * without touching the real process environment.
 */
export function stripPayloadOverrides(env: NodeJS.ProcessEnv): StrippedEnv {
    const stripped = { ...env };
    const dropped: string[] = [];
    for (const key of PAYLOAD_OVERRIDE_ENV_KEYS) {
        if (stripped[key] !== undefined) {
            dropped.push(key);
            delete stripped[key];
        }
    }
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
 * Removes the temporary profile directory without ever throwing: a
 * measurement's verdict is about latency, not about temp cleanup, so a
 * removal failure is reported to the caller instead of raised.
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
 * An operator cancelling a run sends this driver SIGINT or SIGTERM. Node
 * installs no default handler for either that also tears down what this
 * process itself started: with none registered here, the signal's default
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
 * Spawns the packaged binary against the given isolated profile, connects to
 * it over CDP and runs the full measurement, then tears everything down —
 * the app process, the temporary profile directory, and the signal
 * listeners registered for the run — regardless of how it ends. Rethrows
 * whatever `connectAndMeasure` or the spawn itself failed with; the caller
 * decides what that means for the run's own verdict. A profile-removal
 * failure is reported on stdout and never thrown, so a temp directory that
 * cannot be deleted does not discard an otherwise-completed measurement.
 */
export async function launchAndMeasure(
    binary: string,
    profileDir: string,
    seconds: number,
    pluginPath: string,
    diagnostics: Diagnostics
): Promise<MeasuredLegs> {
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
    const output: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));

    // An async spawn failure (the binary present but not executable, for
    // instance) fires `child`'s own 'error' event; with no listener that is
    // an uncaught exception that skips the try/finally below entirely — no
    // VERDICT line, no quit, and the mkdtemp profile directory leaks. Racing
    // it against the connect-and-measure promise routes it into the same
    // failure path a connect failure already takes. `Promise.race` attaches
    // its own handler to this promise at construction, so a rejection that
    // arrives after the race has already settled — the app starts fine,
    // then `child` reports an error much later — is still a handled
    // rejection, not an unhandled one.
    //
    // The race alone only decides which error is reported; it does not stop
    // the losing side from still running. Without `abortController`, a
    // spawn failure that wins the race still leaves `connectAndMeasure`
    // polling a debug port that will never open for the rest of
    // `APP_READY_TIMEOUT_MS`, so the process only actually exits about 30 s
    // after printing NOT MEASURED. Aborting on the spawn-failure path — and
    // again in `finally`, so a normal run or a connect failure also releases
    // the signal — cuts that poll short. `Promise.race` has already settled
    // on the spawn error by the time the aborted poll's own rejection
    // arrives, so aborting never masks it.
    const abortController = new AbortController();
    const spawnFailure = new Promise<never>((_resolve, reject) => {
        child.once('error', (error) => {
            abortController.abort();
            reject(new Error(`the packaged app process reported an error: ${error.message}`));
        });
    });

    const removeSigintTeardown = installTeardownOnSignal('SIGINT', child, profileDir);
    const removeSigtermTeardown = installTeardownOnSignal('SIGTERM', child, profileDir);

    try {
        return await Promise.race([
            connectAndMeasure(port, seconds, pluginPath, diagnostics, abortController.signal),
            spawnFailure,
        ]);
    } catch (error) {
        process.stdout.write(`\n--- packaged app output ---\n${output.join('').trim()}\n`);
        printDiagnostics(diagnostics);
        throw error;
    } finally {
        abortController.abort();
        await quitApp(child);
        reportProfileRemoval(profileDir, removeProfileDir(profileDir));
        removeSigintTeardown();
        removeSigtermTeardown();
    }
}
