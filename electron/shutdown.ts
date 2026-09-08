/**
 * The quit path (REQ-012).
 *
 * Node does not reliably run destructors at process exit, so shutdown is
 * explicit: `before-quit` calls the addon's `shutdown()`, which retires
 * discovery, closes every plugin editor, takes engine-owned runtimes out of the
 * audio graph and sweeps the retirement vec, in that one correct order, and
 * only then does the process end.
 *
 * The cascade does not release the engine's audio stream, and cannot: taking
 * runtimes out of the graph is something it asks the running engine to do. No
 * destructor releases it afterwards either — quit ends at `app.exit()`, so no
 * Rust `Drop` on the host state runs on this path, whatever `AppState`'s field
 * order guarantees on the paths where it does. What keeps the still-open stream
 * off a freed CLAP
 * runtime is the cascade's own `Arc` discipline
 * (`crates/sourdaw-native/src/shutdown.rs`): a runtime's removal from the
 * scheduler is queued first, the runtime is retired, and it is freed only once
 * every other holder — the scheduler included — has let go of its reference.
 * One the scheduler never releases inside the waiting budget is retained rather
 * than freed, and reported as an unreclaimed retirement. Leaking it past exit is
 * the deliberate trade: the process is ending regardless, and freeing memory a
 * live audio callback may still read is the worse outcome.
 *
 * The deadline is the other half. A third-party plugin editor that refuses to
 * die must not wedge quit: a musician who asked the app to close and watched
 * nothing happen will kill it, and killing it is worse than force-quitting it.
 * So the cascade runs against a deadline and the shell exits past it.
 *
 * Every moving part is injected — the clock, the exit — because a quit path
 * that can only be exercised by quitting a real app is a quit path with no test
 * at all.
 */

import { Worker } from 'node:worker_threads';

import { systemTimers, type Timers } from './timers.js';

import type { RendererSessionQuiesceOutcome } from './channels.js';

/** How long the cascade gets before the shell stops waiting for it. */
export const SHUTDOWN_DEADLINE_MS = 5_000;

export type ShutdownOutcome =
    /** The cascade finished. Its report is diagnostic; nothing in it fails the exit. */
    | { readonly status: 'completed'; readonly report: unknown }
    /** The cascade threw. Quit continues: a failed teardown is not a reason to stay open. */
    | { readonly status: 'failed'; readonly reason: string }
    /** The deadline passed first. The caller force-quits. */
    | { readonly status: 'timed-out'; readonly deadlineMs: number };

export type Watchdog = {
    readonly disarm: () => void;
};

export type WatchdogSpawner = (deadlineMs: number, targetPid?: number) => Watchdog;

export const spawnShutdownWatchdog: WatchdogSpawner = (
    deadlineMs: number,
    targetPid: number = process.pid
): Watchdog => {
    const workerCode = `
        const { workerData } = require('node:worker_threads');
        const timer = setTimeout(() => {
            try {
                process.kill(workerData.targetPid, 'SIGKILL');
            } catch {
                process.exit(1);
            }
        }, workerData.deadlineMs);
    `;
    let worker: Worker | undefined;
    try {
        worker = new Worker(workerCode, {
            eval: true,
            workerData: { deadlineMs, targetPid },
        });
        worker.unref();
    } catch {
        // If worker threads cannot be spawned in the environment, degrade gracefully
    }
    return {
        disarm: () => {
            if (worker !== undefined) {
                void worker.terminate();
                worker = undefined;
            }
        },
    };
};

export type RunShutdownInput = {
    /** The addon's `shutdown()`. May return a value or a promise of one. */
    readonly shutdown: () => unknown;
    readonly deadlineMs?: number;
    readonly timers: Timers;
    readonly armWatchdog?: WatchdogSpawner;
};

/**
 * Run the exit cascade, bounded by the deadline.
 *
 * Resolves rather than rejects on every path: the caller's next act is to end
 * the process, and a rejection there would be an unhandled one on the way out.
 *
 * The bound holds for any shutdown that yields the JS thread as well as one
 * that blocks it synchronously: an out-of-thread watchdog worker is armed before
 * the cascade begins and forcefully kills the process if the deadline passes,
 * bounding synchronous native CLAP editor hangs on the main thread.
 */
export const runShutdownWithDeadline = async ({
    shutdown,
    deadlineMs = SHUTDOWN_DEADLINE_MS,
    timers,
    armWatchdog = spawnShutdownWatchdog,
}: RunShutdownInput): Promise<ShutdownOutcome> => {
    let deadlineTimer: { readonly cancel: () => void } | undefined;
    const deadline = new Promise<ShutdownOutcome>((resolve) => {
        deadlineTimer = timers.setTimer(() => resolve({ status: 'timed-out', deadlineMs }), deadlineMs);
    });

    const watchdog = armWatchdog(deadlineMs);

    const cascade = (async (): Promise<ShutdownOutcome> => {
        try {
            return { status: 'completed', report: await shutdown() };
        } catch (error) {
            return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
        }
    })();

    try {
        return await Promise.race([cascade, deadline]);
    } finally {
        deadlineTimer?.cancel();
        watchdog.disarm();
    }
};

export type BeforeQuitCascadeInput = {
    /** Close shell admission for plugin runtime commands. */
    readonly refusePluginCommands: () => void;
    /** Kill the out-of-process scan worker, if one is running. */
    readonly disposeScanSupervisor?: () => void;
    /** Live native host, or undefined when the addon never loaded. */
    readonly host: { readonly shutdown: () => unknown } | undefined;
    readonly timers: Timers;
    readonly deadlineMs?: number;
    readonly armWatchdog?: WatchdogSpawner;
};

/**
 * The body of `before-quit`: refuse plugin IPC, dispose the scan worker, then
 * run the native cascade under the deadline.
 *
 * Admission must close before `host.shutdown()` so a late `load_plugin` cannot
 * insert an instance after the drain. The scan worker is disposed next — it
 * holds its own addon — then the host cascade, or a completed outcome when no
 * host was loaded.
 */
export const runBeforeQuitCascade = async ({
    refusePluginCommands,
    disposeScanSupervisor,
    host,
    timers,
    deadlineMs,
    armWatchdog,
}: BeforeQuitCascadeInput): Promise<ShutdownOutcome> => {
    refusePluginCommands();
    disposeScanSupervisor?.();
    if (host === undefined) {
        return { status: 'completed', report: undefined };
    }
    return runShutdownWithDeadline({ shutdown: () => host.shutdown(), timers, deadlineMs, armWatchdog });
};

/** The one member of `before-quit`'s event the handler uses. */
export type PreventableEvent = { readonly preventDefault: () => void };

export type QuitDependencies = {
    /** End the process. Called after the cascade settles or the deadline passes. */
    readonly exit: (code: number) => void;
    readonly report: (outcome: ShutdownOutcome) => void;
    /** Resolves false when a renderer-owned dirty-project prompt was cancelled or save failed. */
    readonly canQuit?: () => Promise<boolean>;
    /** Quiesces the approved renderer session before native shutdown drains the host. */
    /** Rejection means renderer authority changed while quiescing; leave the app open. */
    readonly beforeRun?: () => Promise<QuitPreparationOutcome>;
    /** Shared clock so renderer quiescence cannot outlive the shutdown deadline. */
    readonly timers?: Timers;
};

export type QuitPreparationOutcome = RendererSessionQuiesceOutcome | 'timed-out';

const runAfterQuiesceWithinDeadline = async (
    run: () => Promise<ShutdownOutcome>,
    beforeRun: () => Promise<QuitPreparationOutcome>,
    timers: Timers
): Promise<ShutdownOutcome | undefined> => {
    let expired = false;
    let deadlineTimer: { readonly cancel: () => void } | undefined;
    const deadline = new Promise<ShutdownOutcome>((resolve) => {
        deadlineTimer = timers.setTimer(() => {
            expired = true;
            resolve({ status: 'timed-out', deadlineMs: SHUTDOWN_DEADLINE_MS });
        }, SHUTDOWN_DEADLINE_MS);
    });
    const sequence = (async (): Promise<ShutdownOutcome | undefined> => {
        try {
            const quiesced = await beforeRun();
            if (quiesced === 'timed-out') {
                return { status: 'timed-out', deadlineMs: SHUTDOWN_DEADLINE_MS };
            }
            if (quiesced === 'rejected') {
                return undefined;
            }
            // A terminal renderer has already quarantined its project runtime
            // and cannot be made interactive again. Quit was approved before
            // this request, so continue into the native cascade under the same
            // deadline instead of stranding the process behind failed repair.
        } catch {
            // The shell's force-destroy fallback failed. The native cascade is
            // still safer than leaving plugin admission open.
        }
        // A late editor teardown must never begin native shutdown after the
        // deadline has already force-quit the process.
        if (expired) {
            return new Promise<ShutdownOutcome>(() => undefined);
        }
        return run();
    })();

    try {
        return await Promise.race([sequence, deadline]);
    } finally {
        deadlineTimer?.cancel();
    }
};

/**
 * `before-quit`, in the shape the event actually has.
 *
 * The quit is prevented and then re-issued as an explicit exit, because the
 * cascade is asynchronous and Electron will not wait for it: without the
 * `preventDefault` the process ends mid-teardown, which is the exact failure
 * the cascade exists to avoid.
 *
 * The `started` guard is not defensive style. `app.exit()` re-enters this same
 * event, so without it the cascade would run again from inside its own
 * completion and quit would never reach the exit.
 */
export const createQuitHandler = (
    run: () => Promise<ShutdownOutcome>,
    {
        exit,
        report,
        canQuit = async () => true,
        beforeRun = async () => 'success',
        timers = systemTimers,
    }: QuitDependencies
): ((event: PreventableEvent) => void) => {
    let started = false;
    let checkingPermission = false;
    let finalExitAllowed = false;

    return (event) => {
        if (finalExitAllowed) {
            finalExitAllowed = false;
            return;
        }
        event.preventDefault();
        if (started || checkingPermission) {
            return;
        }
        checkingPermission = true;
        void canQuit()
            .then((allowed) => {
                if (allowed) {
                    started = true;
                    checkingPermission = false;
                    void runAfterQuiesceWithinDeadline(run, beforeRun, timers).then((outcome) => {
                        if (outcome === undefined) {
                            started = false;
                            return;
                        }
                        report(outcome);
                        finalExitAllowed = true;
                        exit(outcome.status === 'timed-out' ? 1 : 0);
                    });
                    return;
                }
                checkingPermission = false;
            })
            .catch(() => {
                checkingPermission = false;
            });
    };
};
