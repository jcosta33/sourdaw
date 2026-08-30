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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    createQuitHandler,
    runBeforeQuitCascade,
    runShutdownWithDeadline,
    SHUTDOWN_DEADLINE_MS,
    type ShutdownOutcome,
} from '../shutdown.js';

import type { Timers } from '../timers.js';

const mainSource = readFileSync(resolve('electron/main.ts'), 'utf8');

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

describe('plugin command admission before the cascade', () => {
    it('refuses plugin IPC before native shutdown is invoked', async () => {
        // Pins the live before-quit body (`runBeforeQuitCascade`), not a
        // test-local stand-in: dropping refuse or calling it after shutdown
        // must fail this check.
        const order: string[] = [];
        const { timers } = manualTimers();

        await runBeforeQuitCascade({
            refusePluginCommands: () => {
                order.push('refuse');
            },
            host: {
                shutdown: () => {
                    order.push('shutdown');
                },
            },
            timers,
        });

        expect(order).toEqual(['refuse', 'shutdown']);
    });

    it('wires before-quit through runBeforeQuitCascade', () => {
        // Leaving `shutdown.ts` intact while deleting the main wiring must fail.
        // A no-op refuse callback must fail too — quit would still admit load_plugin.
        expect(mainSource).toMatch(
            /'before-quit',\s*createQuitHandler\(\s*\(\)\s*:\s*Promise<ShutdownOutcome>\s*=>\s*runBeforeQuitCascade\(\{[\s\S]*?refusePluginCommands:\s*\(\)\s*=>\s*pluginCommandAdmission\.refusePluginCommands\(\)/u
        );
    });

    it('clears close authority when a renderer crash exhausts its recreation budget', () => {
        expect(mainSource).toMatch(
            /recreateTimestamps\.length\s*>=\s*MAX_RECREATES[\s\S]*?windowCloseCoordinator\.clearForNoWindow\(\);[\s\S]*?mainWindow\s*=\s*undefined/u
        );
    });

    it('does not recreate a renderer that crashes during approved close or quit teardown', () => {
        expect(mainSource).toMatch(
            /render-process-gone[\s\S]*?!rendererSessionLifecycle\.shouldRecreateAfterCrash\(\)[\s\S]*?destroyCrashedWindow\(\)[\s\S]*?mainWindow\s*=\s*undefined[\s\S]*?return;[\s\S]*?createAndActivateWindow\(\)/u
        );
    });

    it('re-enables crash recovery immediately when a delayed approved close loses renderer authority', () => {
        expect(mainSource).toMatch(
            /createWindowCloseCoordinator\(\{[\s\S]*?onApprovalRevoked:\s*\(\)\s*=>\s*rendererSessionLifecycle\.cancelTeardown\(\)/u
        );
        expect(mainSource).toMatch(
            /rendererSessionLifecycle\.shouldRecreateAfterCrash\(\)[\s\S]*?const replacementWindow\s*=\s*createAndActivateWindow\(\)/u
        );
    });

    it('carries only queued windowless project commands into the exact crash replacement', () => {
        expect(mainSource).toMatch(
            /const replacementWindow\s*=\s*createAndActivateWindow\(\);\s*nativeMenuActionDispatcher\.recoverPendingWindow\(crashedWindow,\s*replacementWindow\);/u
        );
        expect(mainSource).toMatch(
            /recreateTimestamps\.length\s*>=\s*MAX_RECREATES[\s\S]*?nativeMenuActionDispatcher\.clearPending\(crashedWindow/u
        );
    });

    it('wires approved renderer quiescence before the native quit cascade', () => {
        expect(mainSource).toMatch(
            /canQuit:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?windowCloseCoordinator\.requestClose\(\)[\s\S]*?rendererSessionLifecycle\.approveTeardown\(\)[\s\S]*?\},\s*beforeRun:\s*quiesceApprovedMainWindow/u
        );
        expect(mainSource).toMatch(
            /const quiesceApprovedMainWindow[\s\S]*?await destroyMainWindowAfterEditorsDetach\(\)[\s\S]*?const quiesced\s*=\s*destroyed \|\| window\.isDestroyed\(\)[\s\S]*?rendererSessionLifecycle\.cancelTeardown\(\)[\s\S]*?finally\s*\{[\s\S]*?destroyed \|\| window\.isDestroyed\(\)[\s\S]*?mainWindow\s*===\s*window/u
        );
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

    it('prevents every repeated quit while close permission is pending', async () => {
        let resolvePermission: ((allowed: boolean) => void) | undefined;
        const canQuit = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    resolvePermission = resolve;
                })
        );
        const run = vi.fn(async () => completed);
        const handler = createQuitHandler(run, { canQuit, exit: () => undefined, report: () => undefined });
        const first = { preventDefault: vi.fn() };
        const second = { preventDefault: vi.fn() };

        handler(first);
        handler(second);
        resolvePermission?.(true);

        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        expect(first.preventDefault).toHaveBeenCalledTimes(1);
        expect(second.preventDefault).toHaveBeenCalledTimes(1);
        expect(canQuit).toHaveBeenCalledTimes(1);
    });

    it('prevents every repeated quit while the shutdown cascade is pending', async () => {
        let finishRun: ((outcome: ShutdownOutcome) => void) | undefined;
        const run = vi.fn(
            () =>
                new Promise<ShutdownOutcome>((resolve) => {
                    finishRun = resolve;
                })
        );
        const handler = createQuitHandler(run, { exit: () => undefined, report: () => undefined });
        const first = { preventDefault: vi.fn() };
        const second = { preventDefault: vi.fn() };

        handler(first);
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        handler(second);
        finishRun?.(completed);

        await vi.waitFor(() => expect(second.preventDefault).toHaveBeenCalledTimes(1));
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('waits for renderer quiescence before the native cascade and prevents repeated quit meanwhile', async () => {
        let releaseQuiesce: (() => void) | undefined;
        let rendererPresent = true;
        const beforeRun = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    releaseQuiesce = () => {
                        rendererPresent = false;
                        resolve(true);
                    };
                })
        );
        const run = vi.fn(async () => {
            expect(rendererPresent).toBe(false);
            return completed;
        });
        const handler = createQuitHandler(run, { beforeRun, exit: () => undefined, report: () => undefined });
        const first = { preventDefault: vi.fn() };
        const repeated = { preventDefault: vi.fn() };

        handler(first);
        await vi.waitFor(() => expect(beforeRun).toHaveBeenCalledTimes(1));
        handler(repeated);

        expect(run).not.toHaveBeenCalled();
        expect(repeated.preventDefault).toHaveBeenCalledTimes(1);

        releaseQuiesce?.();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    });

    it('force-quits when renderer quiescence never settles and never starts native shutdown while it is interactive', async () => {
        const { timers, fire } = manualTimers();
        const beforeRun = vi.fn(() => new Promise<boolean>(() => undefined));
        const run = vi.fn(async () => completed);
        const exit = vi.fn();
        const handler = createQuitHandler(run, { beforeRun, timers, exit, report: () => undefined });
        const first = { preventDefault: vi.fn() };
        const repeated = { preventDefault: vi.fn() };

        handler(first);
        await vi.waitFor(() => expect(beforeRun).toHaveBeenCalledTimes(1));
        handler(repeated);
        fire();

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
        expect(run).not.toHaveBeenCalled();
        expect(first.preventDefault).toHaveBeenCalledTimes(1);
        expect(repeated.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('keeps the app open when delayed renderer quiescence loses close authority, then permits a fresh quit', async () => {
        const beforeRun = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const run = vi.fn(async () => completed);
        const exit = vi.fn();
        const handler = createQuitHandler(run, { beforeRun, exit, report: () => undefined });

        handler({ preventDefault: () => undefined });
        await vi.waitFor(() => expect(beforeRun).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect(run).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();

        handler({ preventDefault: () => undefined });
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
        expect(run).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['denies', async () => false],
        ['rejects', async () => Promise.reject(new Error('permission failed'))],
    ])('prevents quit and stays open when close permission %s', async (_case, canQuitImplementation) => {
        const run = vi.fn(async () => completed);
        const exit = vi.fn();
        const canQuit = vi.fn(canQuitImplementation);
        const handler = createQuitHandler(run, { canQuit, exit, report: () => undefined });
        const event = { preventDefault: vi.fn() };

        handler(event);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const retry = { preventDefault: vi.fn() };
        handler(retry);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(retry.preventDefault).toHaveBeenCalledTimes(1);
        expect(canQuit).toHaveBeenCalledTimes(2);
        expect(run).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
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
