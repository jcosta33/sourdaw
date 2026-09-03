/**
 * The packaged app's own process lifecycle: picking a debug port, spawning
 * it, connecting to it and running the measurement, and tearing it down
 * again — on success, on failure, and on an operator cancelling the run.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; this file still spawns a real process
 * and drives a live `Page` through `connectAndMeasure`, so — like the
 * driver, and unlike `desktopLatencyReadings.ts` — it is not unit-testable
 * without Playwright.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';

import { connectAndMeasure, type MeasuredLegs } from './desktopLatencyConnect.ts';
import { printDiagnostics, type Diagnostics } from './desktopLatencyDiagnostics.ts';

const QUIT_GRACE_MS = 10_000;

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
            rmSync(profileDir, { recursive: true, force: true });
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
 * decides what that means for the run's own verdict.
 */
export async function launchAndMeasure(
    binary: string,
    profileDir: string,
    seconds: number,
    pluginPath: string,
    diagnostics: Diagnostics
): Promise<MeasuredLegs> {
    const port = await pickFreePort();
    const child = spawn(binary, [`--remote-debugging-port=${String(port)}`, `--user-data-dir=${profileDir}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
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
    const spawnFailure = new Promise<never>((_resolve, reject) => {
        child.once('error', (error) => {
            reject(new Error(`the packaged app process reported an error: ${error.message}`));
        });
    });

    const removeSigintTeardown = installTeardownOnSignal('SIGINT', child, profileDir);
    const removeSigtermTeardown = installTeardownOnSignal('SIGTERM', child, profileDir);

    try {
        return await Promise.race([connectAndMeasure(port, seconds, pluginPath, diagnostics), spawnFailure]);
    } catch (error) {
        process.stdout.write(`\n--- packaged app output ---\n${output.join('').trim()}\n`);
        printDiagnostics(diagnostics);
        throw error;
    } finally {
        await quitApp(child);
        rmSync(profileDir, { recursive: true, force: true });
        removeSigintTeardown();
        removeSigtermTeardown();
    }
}
