/**
 * The plugin-scan supervisor (REQ-007, AC-019).
 *
 * AC-019 is `kill -9` on the utility process mid-scan. The kill itself is an OS
 * act that needs a packaged app; what it *produces* is an `exit` with no
 * `message`, and that is a signal this supervisor can be handed directly. So the
 * acceptance criterion is driven here through the exit path, and the assertion
 * that matters is not only that the scan fails but that the next one still runs
 * — a supervisor that keeps a dead handle reports the first crash correctly and
 * is then permanently broken, which no smoke test would notice.
 */
import { describe, expect, it, vi } from 'vitest';

import { createScanSupervisor, SCAN_TIMEOUT_MS, type ScanProcess } from '../scan.js';

import type { Timers } from '../timers.js';

type FakeProcess = ScanProcess & {
    readonly sent: unknown[];
    readonly killed: () => number;
    readonly reply: (message: unknown) => void;
    readonly exit: () => void;
};

const fakeProcess = (): FakeProcess => {
    const sent: unknown[] = [];
    const messageListeners: ((message: unknown) => void)[] = [];
    const exitListeners: (() => void)[] = [];
    let kills = 0;
    return {
        sent,
        killed: () => kills,
        postMessage: (message) => sent.push(message),
        onMessage: (listener) => messageListeners.push(listener),
        onExit: (listener) => exitListeners.push(listener),
        kill: () => {
            kills += 1;
        },
        reply: (message) => {
            for (const listener of [...messageListeners]) {
                listener(message);
            }
        },
        exit: () => {
            for (const listener of [...exitListeners]) {
                listener();
            }
        },
    };
};

const manualTimers = (): { timers: Timers; fire: () => void; cancelled: () => number } => {
    let pending: (() => void) | undefined;
    let cancels = 0;
    return {
        cancelled: () => cancels,
        fire: () => pending?.(),
        timers: {
            setTimer: (callback) => {
                pending = callback;
                return {
                    cancel: () => {
                        cancels += 1;
                        pending = undefined;
                    },
                };
            },
        },
    };
};

const supervisorOver = (processes: FakeProcess[]) => {
    const { timers, fire, cancelled } = manualTimers();
    let index = 0;
    const forked: FakeProcess[] = [];
    const supervisor = createScanSupervisor({
        timers,
        fork: () => {
            const next = processes[index] ?? fakeProcess();
            index += 1;
            forked.push(next);
            return next;
        },
    });
    return { supervisor, fire, cancelled, forked, forks: () => index };
};

describe('running a scan', () => {
    it('forks a worker, hands it the roots, and answers with its result', async () => {
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: ['/Library/Audio/Plug-Ins/CLAP'] });
        expect(worker.sent).toEqual([{ paths: ['/Library/Audio/Plug-Ins/CLAP'] }]);
        worker.reply({ ok: true, result: [{ id: 'com.example.synth' }] });

        await expect(scan).resolves.toEqual([{ id: 'com.example.synth' }]);
    });

    it('rejects with the worker error rather than resolving empty', async () => {
        // An empty result and a failed scan look identical in the plugin list,
        // and the second one must not be presented as "you have no plugins".
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: [] });
        worker.reply({ ok: false, error: 'the scan roots are not readable' });

        await expect(scan).rejects.toThrow(/the scan roots are not readable/u);
    });

    it('rejects a message it cannot recognise instead of passing it through', async () => {
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: [] });
        worker.reply({ plugins: [] });

        await expect(scan).rejects.toThrow(/unrecognised message/u);
    });

    it('ends the worker and cancels the deadline once it has answered', async () => {
        const worker = fakeProcess();
        const { supervisor, cancelled } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: [] });
        worker.reply({ ok: true, result: [] });
        await scan;

        expect(worker.killed()).toBe(1);
        expect(cancelled()).toBe(1);
        expect(supervisor.isRunning()).toBe(false);
    });
});

describe('one scan at a time', () => {
    it('refuses a second scan while one is running', async () => {
        // Two concurrent scans would multiply the per-plugin child processes and
        // fight over the same policy roots.
        const worker = fakeProcess();
        const { supervisor, forks } = supervisorOver([worker]);

        const first = supervisor.scan({ paths: [] });
        await expect(supervisor.scan({ paths: [] })).rejects.toThrow(/already running/u);
        expect(forks()).toBe(1);

        worker.reply({ ok: true, result: [] });
        await first;
    });

    it('accepts the next scan from inside the previous continuation', async () => {
        // The plugin list refreshes by rescanning when the previous scan
        // settles. Dropping the worker after settling instead of before would
        // make that exact call fail.
        const [first, second] = [fakeProcess(), fakeProcess()];
        const { supervisor } = supervisorOver([first, second]);

        const chained = supervisor.scan({ paths: [] }).then(() => supervisor.scan({ paths: ['/b'] }));
        first.reply({ ok: true, result: [] });
        await vi.waitFor(() => expect(second.sent.length).toBe(1));
        second.reply({ ok: true, result: ['b'] });

        await expect(chained).resolves.toEqual(['b']);
    });
});

describe('a worker that dies mid-scan', () => {
    it('fails the scan when the process exits without answering', async () => {
        // What `kill -9` looks like from here. Electron gives no way to tell a
        // signal from a clean exit at this seam, and the answer is the same for
        // both: this scan failed.
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: [] });
        worker.exit();

        await expect(scan).rejects.toThrow(/exited before it answered/u);
        expect(supervisor.isRunning()).toBe(false);
    });

    it('scans again with a fresh worker after a crash', async () => {
        const [crashed, replacement] = [fakeProcess(), fakeProcess()];
        const { supervisor, forks } = supervisorOver([crashed, replacement]);

        const failed = supervisor.scan({ paths: [] });
        crashed.exit();
        await expect(failed).rejects.toThrow();

        const retry = supervisor.scan({ paths: ['/b'] });
        replacement.reply({ ok: true, result: ['b'] });

        await expect(retry).resolves.toEqual(['b']);
        expect(forks()).toBe(2);
    });

    it('ignores an exit that arrives after the result, and settles once', async () => {
        // A worker that is killed on success exits right after answering.
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: [] });
        worker.reply({ ok: true, result: ['a'] });
        worker.exit();
        worker.reply({ ok: false, error: 'too late' });

        await expect(scan).resolves.toEqual(['a']);
    });
});

describe('a worker that stops answering', () => {
    it('kills it at the deadline and fails the scan', async () => {
        const worker = fakeProcess();
        const { supervisor, fire } = supervisorOver([worker]);

        const scan = supervisor.scan({ paths: [] });
        fire();

        await expect(scan).rejects.toThrow(/timed out/u);
        expect(worker.killed()).toBe(1);
        expect(supervisor.isRunning()).toBe(false);
    });

    it('bounds the whole scan generously, leaving per-plugin timing to the policy', () => {
        expect(SCAN_TIMEOUT_MS).toBe(120_000);
    });
});

describe('disposal on the quit path', () => {
    it('kills a live worker and reports nothing running', () => {
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        void supervisor.scan({ paths: [] }).catch(() => undefined);
        supervisor.dispose();

        expect(worker.killed()).toBe(1);
        expect(supervisor.isRunning()).toBe(false);
    });

    it('is safe to call with no scan in flight', () => {
        const { supervisor } = supervisorOver([]);

        expect(() => supervisor.dispose()).not.toThrow();
    });

    it('is safe to call twice, since quit can re-enter', () => {
        // `app.exit()` re-enters `before-quit`, and the quit handler's guard is
        // the only thing between that and a second cascade.
        const worker = fakeProcess();
        const { supervisor } = supervisorOver([worker]);

        void supervisor.scan({ paths: [] }).catch(() => undefined);
        supervisor.dispose();
        supervisor.dispose();

        expect(worker.killed()).toBe(1);
    });
});
