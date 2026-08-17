/**
 * The quit path (REQ-012, AC-024).
 *
 * AC-024 asks for a live quit during playback with a plugin editor open, which
 * needs a packaged app and a real plugin — not automatable in this packet. What
 * is automatable is the logic that decides the outcome, and that is what is
 * driven here through the seams `main.ts` wires to Electron: the cascade runs,
 * the deadline is armed, the force-quit fires at it, and `app.exit` is reached
 * exactly once on every path.
 *
 * The residue is recorded in the pull request rather than hidden behind these
 * assertions.
 */
import { describe, expect, it, vi } from 'vitest';

import { createQuitHandler, runShutdownWithDeadline, SHUTDOWN_DEADLINE_MS, type ShutdownOutcome } from '../shutdown.js';

import type { Timers } from '../timers.js';

/** A clock that only moves when the test says so. */
const manualTimers = (): { timers: Timers; fire: () => void; armed: () => number } => {
    let pending: { callback: () => void; ms: number } | undefined;
    let armedCount = 0;
    return {
        armed: () => armedCount,
        fire: () => pending?.callback(),
        timers: {
            setTimer: (callback, ms) => {
                armedCount += 1;
                pending = { callback, ms };
                return {
                    cancel: () => {
                        pending = undefined;
                    },
                };
            },
        },
    };
};

describe('the exit cascade under its deadline', () => {
    it('reports the cascade report when it completes', async () => {
        const { timers } = manualTimers();

        await expect(runShutdownWithDeadline({ shutdown: () => ({ closedEditors: ['a'] }), timers })).resolves.toEqual({
            status: 'completed',
            report: { closedEditors: ['a'] },
        });
    });

    it('awaits a cascade that returns a promise', async () => {
        const { timers } = manualTimers();

        await expect(
            runShutdownWithDeadline({ shutdown: async () => Promise.resolve('done'), timers })
        ).resolves.toEqual({ status: 'completed', report: 'done' });
    });

    it('force-quits at the deadline when the cascade never settles', async () => {
        // A third-party editor that refuses to die must not wedge quit: a
        // musician who cannot close the app will kill it instead, and that is
        // strictly worse than exiting past the deadline.
        const { timers, fire } = manualTimers();
        const outcome = runShutdownWithDeadline({ shutdown: () => new Promise(() => undefined), timers });

        fire();

        await expect(outcome).resolves.toEqual({ status: 'timed-out', deadlineMs: SHUTDOWN_DEADLINE_MS });
    });

    it('arms the deadline before the cascade, not after it', async () => {
        // Armed afterwards, the deadline would never bound the call it exists
        // to bound.
        const { timers, armed } = manualTimers();
        let armedDuringCascade = 0;

        await runShutdownWithDeadline({
            shutdown: () => {
                armedDuringCascade = armed();
                return undefined;
            },
            timers,
        });

        expect(armedDuringCascade).toBe(1);
    });

    it('resolves rather than rejecting when the cascade throws', async () => {
        // The caller's next act is to end the process, so a rejection here
        // would be an unhandled one on the way out. A failed teardown is also
        // not a reason to stay open.
        const { timers } = manualTimers();

        await expect(
            runShutdownWithDeadline({
                shutdown: () => {
                    throw new Error('a plugin editor refused');
                },
                timers,
            })
        ).resolves.toEqual({ status: 'failed', reason: 'a plugin editor refused' });
    });

    it('gives the cascade five seconds', () => {
        expect(SHUTDOWN_DEADLINE_MS).toBe(5_000);
    });
});

describe('the before-quit handler', () => {
    const completed: ShutdownOutcome = { status: 'completed', report: undefined };

    it('prevents the quit, runs the cascade, then exits', async () => {
        // Without the prevent, Electron ends the process mid-teardown, which is
        // the exact failure the cascade exists to avoid.
        const preventDefault = vi.fn();
        const exit = vi.fn();
        const run = vi.fn(async () => completed);
        const handler = createQuitHandler(run, { exit, report: () => undefined });

        handler({ preventDefault });
        await vi.waitFor(() => expect(exit).toHaveBeenCalled());

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('exits non-zero when the deadline decided the outcome', async () => {
        const exit = vi.fn();
        const handler = createQuitHandler(async () => ({ status: 'timed-out', deadlineMs: SHUTDOWN_DEADLINE_MS }), {
            exit,
            report: () => undefined,
        });

        handler({ preventDefault: () => undefined });
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    });

    it('runs the cascade once even though app.exit re-enters before-quit', async () => {
        // Without the guard the cascade re-enters from inside its own
        // completion and quit never reaches the exit.
        const exit = vi.fn();
        const run = vi.fn(async () => completed);
        const handler = createQuitHandler(run, { exit, report: () => undefined });

        handler({ preventDefault: () => undefined });
        handler({ preventDefault: () => undefined });
        await vi.waitFor(() => expect(exit).toHaveBeenCalled());
        handler({ preventDefault: () => undefined });

        expect(run).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it('reports every outcome the shell did not expect', async () => {
        const report = vi.fn();
        const handler = createQuitHandler(async () => ({ status: 'failed', reason: 'lock poisoned' }), {
            exit: () => undefined,
            report,
        });

        handler({ preventDefault: () => undefined });
        await vi.waitFor(() => expect(report).toHaveBeenCalledWith({ status: 'failed', reason: 'lock poisoned' }));
    });
});
