/**
 * The quit path (REQ-012).
 *
 * Rust drop order is load bearing — the engine's CPAL stream has to be released
 * before the CLAP runtimes it reads — and Node does not reliably run
 * destructors at process exit. So shutdown is explicit: `before-quit` calls the
 * addon's `shutdown()`, which retires discovery, closes every plugin editor and
 * sweeps the retirement vec in that one correct order, and only then does the
 * process end.
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

import type { Timers } from './timers.js';

/** How long the cascade gets before the shell stops waiting for it. */
export const SHUTDOWN_DEADLINE_MS = 5_000;

export type ShutdownOutcome =
    /** The cascade finished. Its report is diagnostic; nothing in it fails the exit. */
    | { readonly status: 'completed'; readonly report: unknown }
    /** The cascade threw. Quit continues: a failed teardown is not a reason to stay open. */
    | { readonly status: 'failed'; readonly reason: string }
    /** The deadline passed first. The caller force-quits. */
    | { readonly status: 'timed-out'; readonly deadlineMs: number };

export type RunShutdownInput = {
    /** The addon's `shutdown()`. May return a value or a promise of one. */
    readonly shutdown: () => unknown;
    readonly deadlineMs?: number;
    readonly timers: Timers;
};

/**
 * Run the exit cascade, bounded by the deadline.
 *
 * Resolves rather than rejects on every path: the caller's next act is to end
 * the process, and a rejection there would be an unhandled one on the way out.
 *
 * The bound holds for any shutdown that yields the JS thread. It cannot bound
 * one that blocks it — a timer cannot fire on a thread that is inside a native
 * call — and the CLAP contract puts editor teardown on that thread on purpose.
 * Bounding that case needs a watchdog outside the blocked thread, tracked as
 * issue 2096.
 */
export const runShutdownWithDeadline = async ({
    shutdown,
    deadlineMs = SHUTDOWN_DEADLINE_MS,
    timers,
}: RunShutdownInput): Promise<ShutdownOutcome> => {
    let deadlineTimer: { readonly cancel: () => void } | undefined;
    const deadline = new Promise<ShutdownOutcome>((resolve) => {
        deadlineTimer = timers.setTimer(() => resolve({ status: 'timed-out', deadlineMs }), deadlineMs);
    });

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
    }
};

/** The one member of `before-quit`'s event the handler uses. */
export type PreventableEvent = { readonly preventDefault: () => void };

export type QuitDependencies = {
    /** End the process. Called after the cascade settles or the deadline passes. */
    readonly exit: (code: number) => void;
    readonly report: (outcome: ShutdownOutcome) => void;
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
    { exit, report }: QuitDependencies
): ((event: PreventableEvent) => void) => {
    let started = false;

    return (event) => {
        if (started) {
            return;
        }
        started = true;
        event.preventDefault();
        void run().then((outcome) => {
            report(outcome);
            exit(outcome.status === 'timed-out' ? 1 : 0);
        });
    };
};
