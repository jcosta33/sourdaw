import { spawn, type ChildProcess } from 'node:child_process';
import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { GUARD_FAILURES_DIR, guardFailureReceiptPath, type GuardFailureReceipt } from '../prContract';
import {
    acquireResourceLock,
    clearGuardFailureReceipt,
    detectAuthorLane,
    enterResourceSession,
    hasExplicitTarget,
    main as runGuardCli,
    parseCgroupAvailableBytes,
    parseCliArgs,
    parseMemAvailableBytes,
    pnpmScriptName,
    psSamplingArgs,
    readGuardFailureReceipt,
    resolveDefaultMaxRssBytes,
    writeGuardFailureReceipt,
    RESOURCE_ROOT_ENV,
    RESOURCE_SESSION_ENV,
    runGuardedCommand,
    type DetectedLane,
    type GuardedCommandResult,
    type ResourceProfile,
    type WriteGuardFailureReceiptPorts,
} from '../resourceGuard';
import { parseArgs as parseLintArgs } from '../runLint';

function fixtureRoot(label: string): string {
    return mkdtempSync(join(tmpdir(), `sourdaw-resource-${label}-`));
}

const abundantMemoryBytes = 128 * 1024 ** 3;
const enforcementAdmissionRoot = fixtureRoot('enforcement');

afterAll(() => rmSync(enforcementAdmissionRoot, { recursive: true, force: true }));

function runIsolatedGuardedCommand(
    input: Parameters<typeof runGuardedCommand>[0]
): ReturnType<typeof runGuardedCommand> {
    return runGuardedCommand({ ...input, admissionRoot: enforcementAdmissionRoot });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error('condition timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function killAndWait(pid: number | undefined): Promise<void> {
    if (pid === undefined || !isAlive(pid)) {
        return;
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        return;
    }
    await waitUntil(() => !isAlive(pid));
}

async function waitForClose(child: ChildProcess, timeoutMs = 2_000): Promise<number | null> {
    if (child.exitCode !== null) {
        return child.exitCode;
    }
    return Promise.race([
        new Promise<number | null>((resolve) => child.once('close', resolve)),
        new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error('child close timed out')), timeoutMs)
        ),
    ]);
}

describe('resource admission', () => {
    it('serializes admission updates', () => {
        const root = fixtureRoot('collision');
        try {
            const first = acquireResourceLock({ root, command: 'first' });
            expect(() => acquireResourceLock({ root, command: 'second' })).toThrow(/validation is busy/);
            first.release();

            acquireResourceLock({ root }).release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('admits concurrent validations when memory covers both reservations', async () => {
        const root = fixtureRoot('parallel');
        try {
            const first = await enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 8 * 1024 ** 3,
            });
            const second = await enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 8 * 1024 ** 3,
            });

            expect(first.token).not.toBe(second.token);
            expect(readFileSync(first.reservationPath, 'utf8')).toContain(first.token);
            expect(readFileSync(second.reservationPath, 'utf8')).toContain(second.token);
            first.release();
            second.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('waits until memory can cover another reservation', async () => {
        const root = fixtureRoot('wait');
        try {
            const first = await enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 3 * 1024 ** 3,
            });
            let admitted = false;
            const waits: string[] = [];
            const secondPromise = enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 3 * 1024 ** 3,
                waitIntervalMs: 10,
                onWait: (message) => waits.push(message),
            }).then((session) => {
                admitted = true;
                return session;
            });

            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(admitted).toBe(false);
            expect(waits).toHaveLength(1);
            expect(waits[0]).toMatch(/need 4096 MiB, 3072 MiB available/);
            first.release();

            const second = await secondPromise;
            expect(admitted).toBe(true);
            second.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('retains a crashed owner reservation while its child is alive', async () => {
        const root = fixtureRoot('orphan');
        try {
            const first = await enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 3 * 1024 ** 3,
            });
            const owner = JSON.parse(readFileSync(first.reservationPath, 'utf8')) as Record<string, unknown>;
            writeFileSync(
                first.reservationPath,
                JSON.stringify({
                    ...owner,
                    pid: 2_147_483_647,
                    childPid: process.pid,
                    childStartedAt: owner.processStartedAt,
                })
            );
            let admitted = false;
            const secondPromise = enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 3 * 1024 ** 3,
                waitIntervalMs: 10,
            }).then((session) => {
                admitted = true;
                return session;
            });

            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(admitted).toBe(false);
            first.release();

            const second = await secondPromise;
            second.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('retains an admitted crash window through the command deadline', async () => {
        const root = fixtureRoot('spawn-crash');
        try {
            const first = await enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 3 * 1024 ** 3,
                processToken: 'admitted-process',
                orphanTimeoutMs: 5_000,
            });
            const owner = JSON.parse(readFileSync(first.reservationPath, 'utf8')) as Record<string, unknown>;
            writeFileSync(first.reservationPath, JSON.stringify({ ...owner, pid: 2_147_483_647 }));
            let admitted = false;
            const secondPromise = enterResourceSession({
                root,
                requiredRssBytes: 1024 ** 3,
                availableMemoryBytes: 3 * 1024 ** 3,
                waitIntervalMs: 10,
            }).then((session) => {
                admitted = true;
                return session;
            });

            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(admitted).toBe(false);
            first.release();

            const second = await secondPromise;
            second.release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each([
        ['missing process', 2_147_483_647, 'gone'],
        ['reused pid', process.pid, 'different process'],
    ])('reclaims stale ownership: %s', (_label, pid, processStartedAt) => {
        const root = fixtureRoot('stale');
        try {
            const first = acquireResourceLock({ root });
            writeFileSync(
                join(first.path, 'owner.json'),
                JSON.stringify({
                    token: 'stale',
                    pid,
                    cwd: '/gone',
                    command: 'gone',
                    startedAt: '2020-01-01',
                    processStartedAt,
                })
            );

            acquireResourceLock({ root }).release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(['missing', 'truncated'])('reclaims an unreadable lock owner: %s', (shape) => {
        const root = fixtureRoot('corrupt');
        const lockPath = join(root, 'sourdaw-validation.lock');
        try {
            mkdirSync(lockPath);
            if (shape === 'truncated') {
                writeFileSync(join(lockPath, 'owner.json'), '{');
            }

            acquireResourceLock({ root }).release();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('never reclaims while another process owns recovery', () => {
        const root = fixtureRoot('reaper');
        try {
            const first = acquireResourceLock({ root });
            writeFileSync(
                join(first.path, 'owner.json'),
                JSON.stringify({
                    token: 'stale',
                    pid: 2_147_483_647,
                    cwd: '/gone',
                    command: 'gone',
                    startedAt: '2020-01-01',
                    processStartedAt: 'gone',
                })
            );
            mkdirSync(`${first.path}.reaper`);

            expect(() => acquireResourceLock({ root })).toThrow(/recovery is busy/);
            expect(readFileSync(join(first.path, 'owner.json'), 'utf8')).toContain('stale');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('inherits the admitted session', async () => {
        const root = fixtureRoot('inherit');
        const previous = process.env[RESOURCE_SESSION_ENV];
        const previousRoot = process.env[RESOURCE_ROOT_ENV];
        try {
            const first = await enterResourceSession({ root, availableMemoryBytes: abundantMemoryBytes });
            process.env[RESOURCE_SESSION_ENV] = first.token;
            process.env[RESOURCE_ROOT_ENV] = root;
            const inherited = await enterResourceSession({ availableMemoryBytes: abundantMemoryBytes });

            expect(inherited.token).toBe(first.token);
            inherited.release();
            expect(readFileSync(first.reservationPath, 'utf8')).toContain(first.token);
            first.release();
        } finally {
            if (previous === undefined) {
                delete process.env[RESOURCE_SESSION_ENV];
            } else {
                process.env[RESOURCE_SESSION_ENV] = previous;
            }
            if (previousRoot === undefined) {
                delete process.env[RESOURCE_ROOT_ENV];
            } else {
                process.env[RESOURCE_ROOT_ENV] = previousRoot;
            }
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('linux memory sampling', () => {
    it('reads MemAvailable, not MemFree, from meminfo', () => {
        const meminfo = [
            'MemTotal:        8039352 kB',
            'MemFree:          161184 kB',
            'MemAvailable:    5872400 kB',
            'Buffers:          312244 kB',
        ].join('\n');
        expect(parseMemAvailableBytes(meminfo)).toBe(5872400 * 1024);
    });

    it('returns undefined when MemAvailable is absent', () => {
        expect(parseMemAvailableBytes('MemTotal: 8039352 kB\nMemFree: 161184 kB\n')).toBeUndefined();
    });

    it('caps host availability at the cgroup remainder', () => {
        expect(parseCgroupAvailableBytes('8589934592', '2147483648')).toBe(6 * 1024 ** 3);
        expect(parseCgroupAvailableBytes('max', '2147483648')).toBeUndefined();
    });
});

describe('process table sampling', () => {
    const psColumns = 'pid=,ppid=,pgid=,rss=,command=';

    it.each([
        ['darwin session', 'darwin', 'session-token', ['eww', '-axo', psColumns]],
        ['non-darwin session', 'linux', 'session-token', ['eww', 'axo', psColumns]],
        ['sessionless', 'linux', undefined, ['-axo', psColumns]],
    ] as const)('pins the %s ps args', (_label, hostPlatform, sessionToken, expected) => {
        expect(psSamplingArgs(hostPlatform, sessionToken)).toEqual(expected);
    });

    it('separates darwin sessions from other platforms by only the second dash', () => {
        // Unifying the two session forms either way breaks one platform's `ps`, so they
        // must stay distinct in exactly that argument.
        const darwin = psSamplingArgs('darwin', 'session-token');
        const linux = psSamplingArgs('linux', 'session-token');
        expect(darwin).toEqual([linux[0], `-${linux[1]}`, ...linux.slice(2)]);
    });
});

describe('resource enforcement', () => {
    it('rechecks capacity before spawning', async () => {
        let samples = 0;
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            profile: 'focused',
            memorySampler: () => (samples++ === 1 ? 0 : abundantMemoryBytes),
            admissionWaitIntervalMs: 1,
        });

        expect(result.code).toBe(0);
        expect(samples).toBeGreaterThan(2);
    });

    it('refuses work below the memory floor', async () => {
        let samples = 0;
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5000)'],
            profile: 'focused',
            memorySampler: () => (samples++ < 3 ? abundantMemoryBytes : 0),
            hostSampleIntervalMs: 10,
            sampleIntervalMs: 10,
        });

        expect(result.reason).toBe('pressure');
    });

    it('kills commands that exceed their deadline', async () => {
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5000)'],
            profile: 'focused',
            timeoutMs: 50,
            maxRssBytes: 2 * 1024 ** 3,
            availableMemoryBytes: abundantMemoryBytes,
            sampleIntervalMs: 20,
        });

        expect(result.reason).toBe('timeout');
    });

    it('kills detached descendants after a deadline', async () => {
        const root = fixtureRoot('descendant');
        const pidPath = join(root, 'pid');
        let descendantPid: number | undefined;
        try {
            const result = await runIsolatedGuardedCommand({
                command: process.execPath,
                args: [
                    '-e',
                    `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: true, stdio: 'ignore' }); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); setInterval(() => {}, 1000);`,
                ],
                profile: 'focused',
                timeoutMs: 100,
                maxRssBytes: 2 * 1024 ** 3,
                availableMemoryBytes: abundantMemoryBytes,
                sampleIntervalMs: 20,
            });
            const recordedPid = Number(readFileSync(pidPath, 'utf8'));
            descendantPid = recordedPid;

            expect(result.reason).toBe('timeout');
            expect(() => process.kill(recordedPid, 0)).toThrow();
        } finally {
            await killAndWait(descendantPid);
            rmSync(root, { recursive: true, force: true });
        }
    }, 10_000);

    it('cleans a detached child that outlives its launcher', async () => {
        const root = fixtureRoot('leak');
        const pidPath = join(root, 'pid');
        let childPid: number | undefined;
        try {
            const result = await runIsolatedGuardedCommand({
                command: process.execPath,
                args: [
                    '-e',
                    `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); child.unref(); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
                ],
                profile: 'focused',
                availableMemoryBytes: abundantMemoryBytes,
            });
            const recordedPid = Number(readFileSync(pidPath, 'utf8'));
            childPid = recordedPid;

            expect(result.reason).toBeUndefined();
            expect(isAlive(childPid)).toBe(false);
        } finally {
            await killAndWait(childPid);
            rmSync(root, { recursive: true, force: true });
        }
    }, 10_000);

    it('escalates a repeated signal and waits for child cleanup', async () => {
        const root = fixtureRoot('signal');
        const pidPath = join(root, 'pid');
        let guard: ChildProcess | undefined;
        let childPid: number | undefined;
        try {
            const childEnv: NodeJS.ProcessEnv = { ...process.env, [RESOURCE_ROOT_ENV]: root };
            delete childEnv[RESOURCE_SESSION_ENV];
            guard = spawn(
                process.execPath,
                [
                    'scripts/resourceGuard.ts',
                    '--profile',
                    'focused',
                    '--',
                    process.execPath,
                    '-e',
                    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`,
                ],
                { cwd: process.cwd(), env: childEnv, stdio: 'ignore' }
            );
            await waitUntil(() => existsSync(pidPath));
            const recordedPid = Number(readFileSync(pidPath, 'utf8'));
            childPid = recordedPid;
            guard.kill('SIGTERM');
            await new Promise((resolve) => setTimeout(resolve, 50));
            guard.kill('SIGTERM');
            const code = await waitForClose(guard);

            expect(code).toBe(143);
            expect(() => process.kill(recordedPid, 0)).toThrow();
        } finally {
            guard?.kill('SIGKILL');
            await killAndWait(childPid);
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('kills commands that exceed the RSS cap', async () => {
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5000)'],
            profile: 'focused',
            timeoutMs: 5_000,
            maxRssBytes: 1,
            availableMemoryBytes: abundantMemoryBytes,
            sampleIntervalMs: 20,
        });

        expect(result.reason).toBe('memory');
        expect(result.peakRssBytes).toBeGreaterThan(1);
    });

    it('stops after repeated host-memory sampler failures', async () => {
        let samples = 0;
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5000)'],
            profile: 'focused',
            memorySampler: () => (samples++ < 3 ? abundantMemoryBytes : undefined),
            hostSampleIntervalMs: 10,
            sampleIntervalMs: 10,
            timeoutMs: 5_000,
        });

        expect(result.reason).toBe('monitor');
    });

    it('terminates the child and releases when an injected sampler throws mid-run', async () => {
        const root = fixtureRoot('sampler-throw');
        // The throw must land in the wrapped pre-timer sample(), so the gate has to be ordered
        // by the guard's own code, not by child timing: setSessionProcessIdentity publishes
        // childPid to a '<token>.state.*.json' file beside the reservation synchronously,
        // before that sample runs. The recorded pid comes from that guard-published
        // reservation state, parent-ordered by code; the guard's catch may SIGKILL the child
        // before any child-written pid file would appear.
        const reservationsRoot = join(enforcementAdmissionRoot, 'sourdaw-validation.reservations');
        let recordedChildPid = 0;
        const childIdentityPublished = () =>
            existsSync(reservationsRoot) &&
            readdirSync(reservationsRoot).some((name) => {
                if (!name.includes('.state.') || !name.endsWith('.json')) {
                    return false;
                }
                const stateMatch = /"childPid":\s*(\d+)/.exec(readFileSync(join(reservationsRoot, name), 'utf8'));
                if (!stateMatch) {
                    return false;
                }
                recordedChildPid = Number(stateMatch[1]);
                return true;
            });
        let childPid: number | undefined;
        try {
            await expect(
                runIsolatedGuardedCommand({
                    command: process.execPath,
                    args: ['-e', 'setInterval(() => {}, 1000)'],
                    profile: 'focused',
                    memorySampler: () => {
                        if (childIdentityPublished()) {
                            throw new Error('injected sampler failure');
                        }
                        return abundantMemoryBytes;
                    },
                    hostSampleIntervalMs: 10,
                    sampleIntervalMs: 10,
                    timeoutMs: 5_000,
                })
            ).rejects.toThrow('injected sampler failure');
            const recordedPid = recordedChildPid;
            expect(recordedPid).toBeGreaterThan(0);
            childPid = recordedPid;

            await waitUntil(() => !isAlive(recordedPid));
            expect(() => process.kill(recordedPid, 0)).toThrow();
            // The pre-rejection run held exactly one reservation and one state file, so an empty
            // reservations root proves the catch released the session.
            expect(readdirSync(reservationsRoot)).toEqual([]);
        } finally {
            await killAndWait(childPid);
            rmSync(root, { recursive: true, force: true });
        }
    }, 10_000);

    it('stops under reason monitor when an injected sampler throws on a sample tick', async () => {
        const root = fixtureRoot('sampler-tick-throw');
        // Mirrors the mid-run throw test, but only the first gated sampler call succeeds: every
        // later call throws on a timer tick, which must stop the run under 'monitor' instead of
        // escaping into setInterval and killing the guard host.
        const reservationsRoot = join(enforcementAdmissionRoot, 'sourdaw-validation.reservations');
        let recordedChildPid = 0;
        const childIdentityPublished = () =>
            existsSync(reservationsRoot) &&
            readdirSync(reservationsRoot).some((name) => {
                if (!name.includes('.state.') || !name.endsWith('.json')) {
                    return false;
                }
                const stateMatch = /"childPid":\s*(\d+)/.exec(readFileSync(join(reservationsRoot, name), 'utf8'));
                if (!stateMatch) {
                    return false;
                }
                recordedChildPid = Number(stateMatch[1]);
                return true;
            });
        let throwing = false;
        let childPid: number | undefined;
        try {
            const result = await runIsolatedGuardedCommand({
                command: process.execPath,
                args: ['-e', 'setInterval(() => {}, 1000)'],
                profile: 'focused',
                memorySampler: () => {
                    if (!childIdentityPublished()) {
                        return abundantMemoryBytes;
                    }
                    if (throwing) {
                        throw new Error('injected sampler tick failure');
                    }
                    throwing = true;
                    return abundantMemoryBytes;
                },
                hostSampleIntervalMs: 10,
                sampleIntervalMs: 10,
                timeoutMs: 5_000,
            });

            expect(result.reason).toBe('monitor');
            const recordedPid = recordedChildPid;
            expect(recordedPid).toBeGreaterThan(0);
            childPid = recordedPid;

            await waitUntil(() => !isAlive(recordedPid));
            expect(() => process.kill(recordedPid, 0)).toThrow();
        } finally {
            await killAndWait(childPid);
            rmSync(root, { recursive: true, force: true });
        }
    }, 10_000);

    it.each([
        ['admission recheck', 1],
        ['post-admission read', 2],
    ])('releases the admitted reservation when an injected sampler throws: %s', async (_label, throwOnSample) => {
        // The sampler runs in a fixed order before any spawn: enterResourceSession's
        // admission check, the loop recheck, then the post-loop pressure read. Counting
        // from zero, the second call lands in the wrapped recheck and the third in the
        // post-loop read; the first admission pass has already created the reservations
        // root, so both throws must leave it empty.
        const reservationsRoot = join(enforcementAdmissionRoot, 'sourdaw-validation.reservations');
        let samples = 0;
        await expect(
            runIsolatedGuardedCommand({
                command: process.execPath,
                args: ['-e', 'process.exit(0)'],
                profile: 'focused',
                memorySampler: () => {
                    if (samples++ === throwOnSample) {
                        throw new Error('injected admission sampler failure');
                    }
                    return abundantMemoryBytes;
                },
            })
        ).rejects.toThrow('injected admission sampler failure');

        expect(existsSync(reservationsRoot) ? readdirSync(reservationsRoot) : []).toEqual([]);
    });

    it('keeps only the output tail', async () => {
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: ['-e', "process.stderr.write('x'.repeat(100000)); process.exit(2)"],
            profile: 'focused',
            outputLimitBytes: 1_024,
            availableMemoryBytes: abundantMemoryBytes,
        });

        expect(result.code).toBe(2);
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1_024);
        expect(result.omittedBytes).toBeGreaterThan(0);
    });

    it.each([
        ['stricter', '1024', '1', '1', 1_024, '1', '1'],
        // The heap ceiling is the run's RSS budget — the focused profile's
        // 4 GiB here — not a constant below it. The RSS monitor is what makes a
        // run safe; a lower heap ceiling only aborts commands whose legitimate
        // peak sits between the two.
        ['at the budget', '8192', '8', '8', 4_096, '2', '2'],
    ])(
        'preserves or tightens caller limits: %s',
        async (_label, heap, cargo, rust, expectedHeap, expectedCargo, expectedRust) => {
            const result = await runIsolatedGuardedCommand({
                command: process.execPath,
                args: [
                    '-e',
                    'console.log(JSON.stringify({ node: process.execArgv, options: process.env.NODE_OPTIONS, cargo: process.env.CARGO_BUILD_JOBS, rust: process.env.RUST_TEST_THREADS }))',
                ],
                profile: 'focused',
                availableMemoryBytes: abundantMemoryBytes,
                env: {
                    ...process.env,
                    NODE_OPTIONS: `--max-old-space-size=${heap}`,
                    CARGO_BUILD_JOBS: cargo,
                    RUST_TEST_THREADS: rust,
                },
            });
            const reported = JSON.parse(result.output) as { options: string; cargo: string; rust: string };

            expect(reported.options).toContain(`--max-old-space-size=${expectedHeap}`);
            expect(reported.cargo).toBe(expectedCargo);
            expect(reported.rust).toBe(expectedRust);
        }
    );
});

describe('resource CLI', () => {
    it('parses guard options and the child command', () => {
        expect(parseCliArgs(['--profile', 'broad', '--require-target', '--show-output', '--', 'pnpm', 'test'])).toEqual(
            {
                profile: 'broad',
                explicitProfile: true,
                maxRssBytes: undefined,
                requireTarget: true,
                showOutput: true,
                command: 'pnpm',
                args: ['test'],
                recover: false,
            }
        );
    });

    it('parses an explicit memory estimate', () => {
        expect(parseCliArgs(['--max-rss-mib', '6144', '--', 'pnpm', 'test']).maxRssBytes).toBe(6144 * 1024 ** 2);
        expect(() => parseCliArgs(['--max-rss-mib', '511', '--', 'pnpm', 'test'])).toThrow(/at least 512/);
    });

    it('stays available as the opt-in guard script', () => {
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(packageJson.scripts.guard).toBe('node scripts/resourceGuard.ts');
        expect(() => parseCliArgs(['--profile', 'focused', '--require-target', '--', 'vitest', 'run'])).not.toThrow();
    });

    it('never wraps the web build', () => {
        // Guard admission refuses on low memory, which is the resting state
        // of cloud build containers — a guarded build breaks every deploy.
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(packageJson.scripts.build).not.toMatch(/resourceGuard\.ts/);
    });

    it('keeps the format target separator', () => {
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(packageJson.scripts.format).toMatch(/prettier --write --$/);
    });

    it('pins validation worker limits', () => {
        expect(readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')).toMatch(
            /maxWorkers:\s*Number\(env\.VITEST_MAX_WORKERS \?\? 2\)/
        );
        expect(readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8')).toMatch(/workers:\s*1/);
    });

    it('requires narrow lint targets unless full lint is explicit', () => {
        expect(parseLintArgs(['src/app/bootstrap.ts'])).toEqual({
            files: ['src/app/bootstrap.ts'],
            fix: false,
            full: false,
        });
        expect(parseLintArgs(['--full'])).toEqual({ files: [], fix: false, full: true });
        expect(() => parseLintArgs([])).toThrow(/file target required/);
        expect(() => parseLintArgs(['--full', 'src'])).toThrow(/does not accept file targets/);
        expect(() => parseLintArgs(['--full', '--fix'])).toThrow(/forbidden/);
    });

    it('requires a real narrow target', () => {
        const root = fixtureRoot('target');
        const file = join(root, 'target.spec.ts');
        const directory = join(root, 'tests');
        try {
            writeFileSync(file, '');
            mkdirSync(directory);

            expect(hasExplicitTarget([file])).toBe(true);
            expect(hasExplicitTarget([directory])).toBe(true);
            expect(hasExplicitTarget(['run', '--', 'adjustmentLayerHandlers'])).toBe(true);
            expect(hasExplicitTarget(['test'])).toBe(false);
            expect(hasExplicitTarget(['check', '-p', 'daw-dsp'])).toBe(true);
            expect(hasExplicitTarget(['-p', 'daw-dsp', 'grinder::'])).toBe(true);
            expect(hasExplicitTarget(['--bail', '1'])).toBe(false);
            expect(hasExplicitTarget(['--maxWorkers', '2'])).toBe(false);
            expect(hasExplicitTarget(['src'])).toBe(false);
            expect(hasExplicitTarget(['--dir', directory])).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('default budgets', () => {
    it.each([
        { profile: 'broad' as const, command: 'pnpm', args: ['typecheck:test'], expected: 6 * 1024 ** 3 },
        {
            profile: 'broad' as const,
            command: 'pnpm',
            args: ['run', 'typecheck:test'],
            expected: 6 * 1024 ** 3,
        },
        { profile: 'focused' as const, command: 'pnpm', args: ['typecheck:test'], expected: 6 * 1024 ** 3 },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['test:run', 'src/x.spec.ts'],
            expected: 4 * 1024 ** 3,
        },
        { profile: 'extended' as const, command: 'node', args: ['typecheck:test'], expected: 4 * 1024 ** 3 },
        { profile: 'focused' as const, command: 'pnpm', args: ['constructor'], expected: 4 * 1024 ** 3 },
        { profile: 'focused' as const, command: 'pnpm', args: ['deps:validate'], expected: 5.5 * 1024 ** 3 },
        { profile: 'broad' as const, command: 'pnpm', args: ['run', 'deps:validate'], expected: 5.5 * 1024 ** 3 },
        { profile: 'focused' as const, command: 'pnpm', args: ['test:e2e'], expected: 5.5 * 1024 ** 3 },
        { profile: 'broad' as const, command: 'pnpm', args: ['run', 'test:e2e'], expected: 5.5 * 1024 ** 3 },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['test:e2e', 'tests/e2e/exportAudioEvidence.spec.ts'],
            expected: 5.5 * 1024 ** 3,
        },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['test:e2e:browser-ai-webgpu-admission'],
            expected: 5.5 * 1024 ** 3,
        },
        {
            profile: 'broad' as const,
            command: 'pnpm',
            args: ['--config.verify-deps-before-run=false', 'typecheck:test'],
            expected: 6 * 1024 ** 3,
        },
        {
            profile: 'broad' as const,
            command: 'pnpm',
            args: ['--config.verify-deps-before-run=false', 'run', 'typecheck:test'],
            expected: 6 * 1024 ** 3,
        },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['--filter', 'sourdaw', 'deps:validate'],
            expected: 5.5 * 1024 ** 3,
        },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['--filter=sourdaw', 'deps:validate'],
            expected: 5.5 * 1024 ** 3,
        },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['-C', 'packages/app', 'test:e2e'],
            expected: 5.5 * 1024 ** 3,
        },
        {
            profile: 'focused' as const,
            command: 'pnpm',
            args: ['--dir', 'packages/app', 'test:e2e'],
            expected: 5.5 * 1024 ** 3,
        },
        {
            profile: 'broad' as const,
            command: 'pnpm',
            args: ['--silent', 'run', 'typecheck:test'],
            expected: 6 * 1024 ** 3,
        },
    ])('resolves $profile/$command/$args to $expected bytes', ({ profile, command, args, expected }) => {
        expect(resolveDefaultMaxRssBytes({ profile, command, args })).toBe(expected);
    });

    it('wires the resolved default budget through runGuardedCommand', async () => {
        const root = fixtureRoot('default-budget');
        try {
            // A real pnpm cold start costs over a second on a loaded CI runner; this shim
            // stands in for the binary so the test observes the resolver's budget wiring,
            // not pnpm's startup time.
            writeFileSync(join(root, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
            const shimEnv = { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ''}` };

            const typecheckResult = await runIsolatedGuardedCommand({
                command: 'pnpm',
                args: ['typecheck:test'],
                profile: 'focused',
                cwd: root,
                env: shimEnv,
                availableMemoryBytes: abundantMemoryBytes,
            });
            expect(typecheckResult.code).toBe(0);
            expect(typecheckResult.maxRssBytes).toBe(6 * 1024 ** 3);

            const prefixedResult = await runIsolatedGuardedCommand({
                command: 'pnpm',
                args: ['--config.verify-deps-before-run=false', 'typecheck:test'],
                profile: 'focused',
                cwd: root,
                env: shimEnv,
                availableMemoryBytes: abundantMemoryBytes,
            });
            expect(prefixedResult.code).toBe(0);
            expect(prefixedResult.maxRssBytes).toBe(6 * 1024 ** 3);

            const e2eResult = await runIsolatedGuardedCommand({
                command: 'pnpm',
                args: ['test:e2e', 'tests/e2e/exportAudioEvidence.spec.ts'],
                profile: 'focused',
                cwd: root,
                env: shimEnv,
                availableMemoryBytes: abundantMemoryBytes,
            });
            expect(e2eResult.code).toBe(0);
            expect(e2eResult.maxRssBytes).toBe(5.5 * 1024 ** 3);

            const otherResult = await runIsolatedGuardedCommand({
                command: 'pnpm',
                args: ['other'],
                profile: 'focused',
                cwd: root,
                env: shimEnv,
                availableMemoryBytes: abundantMemoryBytes,
            });
            expect(otherResult.code).toBe(0);
            expect(otherResult.maxRssBytes).toBe(4 * 1024 ** 3);

            const explicitResult = await runIsolatedGuardedCommand({
                command: 'pnpm',
                args: ['typecheck:test'],
                profile: 'focused',
                cwd: root,
                maxRssBytes: 5 * 1024 ** 3,
                env: shimEnv,
                availableMemoryBytes: abundantMemoryBytes,
            });
            expect(explicitResult.code).toBe(0);
            expect(explicitResult.maxRssBytes).toBe(5 * 1024 ** 3);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('pnpmScriptName', () => {
    it.each([
        { command: 'pnpm', args: ['typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['run', 'typecheck:test'], expected: 'typecheck:test' },
        {
            command: 'pnpm',
            args: ['--config.verify-deps-before-run=false', 'typecheck:test'],
            expected: 'typecheck:test',
        },
        {
            command: 'pnpm',
            args: ['--config.verify-deps-before-run=false', 'run', 'typecheck:test'],
            expected: 'typecheck:test',
        },
        { command: 'pnpm', args: ['--filter', 'sourdaw', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['-F', 'sourdaw', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['--filter=sourdaw', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['-C', '/tmp', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['--dir', '/tmp', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['--dir=/tmp', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['--silent', 'typecheck:test'], expected: 'typecheck:test' },
        { command: 'pnpm', args: ['-s', 'typecheck:test'], expected: 'typecheck:test' },
        {
            command: 'pnpm',
            args: ['--config.foo=bar', '--dir', '/tmp', '--silent', 'run', 'typecheck:test'],
            expected: 'typecheck:test',
        },
        { command: 'pnpm', args: ['--silent'], expected: undefined },
        { command: 'pnpm', args: ['--filter', 'sourdaw'], expected: undefined },
        { command: 'pnpm', args: ['--'], expected: undefined },
        { command: 'node', args: ['--config.foo=bar', 'typecheck:test'], expected: undefined },
    ])('resolves script name for $command with $args to $expected', ({ command, args, expected }) => {
        expect(pnpmScriptName(command, args)).toBe(expected);
    });
});

/**
 * Issue #4118: a lane whose node_modules symlinks into another checkout rewrites that checkout's
 * install metadata on every pnpm run, and the next pnpm run in the real owner aborts every
 * trusted delivery script with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. The guard is the
 * shared entry every local verification flows through, so the preflight runs there, before
 * anything it wraps can write through the link.
 */
describe('pnpm modules preflight', () => {
    function okResult(): GuardedCommandResult {
        return {
            code: 0,
            signal: null,
            output: '',
            omittedBytes: 0,
            peakRssBytes: 1024 ** 2,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 10,
        };
    }

    it("refuses before any command runs when the checkout holds another project's install", async () => {
        const errors: string[] = [];
        let commandRan = false;
        let laneProbed = false;

        const code = await runGuardCli(['--', 'pnpm', 'test:run', 'x.spec.ts'], {
            detectLane: () => {
                laneProbed = true;
                return undefined;
            },
            runCommand: async () => {
                commandRan = true;
                return okResult();
            },
            assertModulesPreflight: () => {
                throw new Error('refusing: foreign pnpm install record');
            },
            error: (message) => errors.push(message),
        });

        expect(code).toBe(1);
        expect(errors).toEqual(['refusing: foreign pnpm install record']);
        expect(commandRan).toBe(false);
        expect(laneProbed).toBe(false);
    });

    it('refuses a --recover re-execution before the recovery runs', async () => {
        const errors: string[] = [];

        const code = await runGuardCli(['--recover'], {
            detectLane: () => undefined,
            assertModulesPreflight: () => {
                throw new Error('refusing: foreign pnpm install record');
            },
            error: (message) => errors.push(message),
        });

        expect(code).toBe(1);
        expect(errors).toEqual(['refusing: foreign pnpm install record']);
    });

    it('wires the real preflight by default and stands down outside a git checkout', async () => {
        const root = fixtureRoot('preflight-default');
        try {
            let commandRan = false;
            const code = await runGuardCli(['--', 'pnpm', 'test:run', 'x.spec.ts'], {
                cwd: root,
                detectLane: () => undefined,
                runCommand: async () => {
                    commandRan = true;
                    return okResult();
                },
            });
            expect(code).toBe(0);
            expect(commandRan).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('guard failure stop enforcement', () => {
    function fakeResult(overrides: Partial<GuardedCommandResult> = {}): GuardedCommandResult {
        return {
            code: 0,
            signal: null,
            output: '',
            omittedBytes: 0,
            peakRssBytes: 1024 ** 2,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 100,
            ...overrides,
        };
    }

    it('parses --recover flag in parseCliArgs', () => {
        expect(parseCliArgs(['--recover'])).toEqual({
            profile: 'focused',
            explicitProfile: false,
            maxRssBytes: undefined,
            requireTarget: false,
            showOutput: false,
            command: '',
            args: [],
            recover: true,
        });

        expect(parseCliArgs(['--recover', '--max-rss-mib', '2048', '--show-output'])).toEqual({
            profile: 'focused',
            explicitProfile: false,
            maxRssBytes: 2048 * 1024 ** 2,
            requireTarget: false,
            showOutput: true,
            command: '',
            args: [],
            recover: true,
        });

        expect(parseCliArgs(['--profile', 'broad', '--recover'])).toEqual({
            profile: 'broad',
            explicitProfile: true,
            maxRssBytes: undefined,
            requireTarget: false,
            showOutput: false,
            command: '',
            args: [],
            recover: true,
        });
    });

    it('detects author lane from inside worktree and returns undefined outside', () => {
        const repoRoot = realpathSync(fixtureRoot('detect-repo'));
        const worktreeDir = join(repoRoot, '.agents', 'worktrees', 'agent-42-feature');
        mkdirSync(worktreeDir, { recursive: true });
        mkdirSync(join(repoRoot, '.git'), { recursive: true });

        try {
            const mockCapture = (_command: string, args: string[]): string => {
                if (args.includes('--git-common-dir')) {
                    return join(repoRoot, '.git');
                }
                if (args.includes('--show-toplevel')) {
                    return worktreeDir;
                }
                if (args.includes('--abbrev-ref')) {
                    return 'agent/42/feature';
                }
                if (args.includes('HEAD')) {
                    return '1111111111111111111111111111111111111111';
                }
                return '';
            };

            const detected = detectAuthorLane(worktreeDir, mockCapture);
            expect(detected).toEqual({
                primaryRoot: repoRoot,
                laneName: 'agent-42-feature',
                branch: 'agent/42/feature',
                headSha: '1111111111111111111111111111111111111111',
                worktreePath: worktreeDir,
            });

            // Outside worktree: inside repoRoot itself
            const outside = detectAuthorLane(repoRoot, mockCapture);
            expect(outside).toBeUndefined();
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('writes, reads, and clears guard failure receipts', () => {
        const repoRoot = fixtureRoot('receipts');
        const laneName = 'agent-99-fix';
        const receipt: GuardFailureReceipt = {
            version: 1,
            lane: laneName,
            branch: 'agent/99/fix',
            headSha: '2222222222222222222222222222222222222222',
            failedAt: '2026-09-07T12:00:00.000Z',
            reason: 'memory',
            command: 'pnpm',
            args: ['test:run', 'test.spec.ts'],
            profile: 'focused',
            peakRssBytes: 5 * 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 500,
        };

        try {
            expect(readGuardFailureReceipt(repoRoot, laneName)).toBeUndefined();
            expect(clearGuardFailureReceipt(repoRoot, laneName)).toBe(false);

            writeGuardFailureReceipt(repoRoot, receipt);
            expect(existsSync(guardFailureReceiptPath(repoRoot, laneName))).toBe(true);

            const read = readGuardFailureReceipt(repoRoot, laneName);
            expect(read).toEqual(receipt);

            expect(clearGuardFailureReceipt(repoRoot, laneName)).toBe(true);
            expect(existsSync(guardFailureReceiptPath(repoRoot, laneName))).toBe(false);
            expect(readGuardFailureReceipt(repoRoot, laneName)).toBeUndefined();
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('verifies writeGuardFailureReceipt performs an atomic write using candidate renaming', () => {
        const repoRoot = fixtureRoot('receipts-atomic');
        const laneName = 'agent-99-atomic';
        const receipt: GuardFailureReceipt = {
            version: 1,
            lane: laneName,
            branch: 'agent/99/atomic',
            headSha: '2222222222222222222222222222222222222222',
            failedAt: '2026-09-07T12:00:00.000Z',
            reason: 'memory',
            command: 'pnpm',
            args: ['test:run', 'test.spec.ts'],
            profile: 'focused',
            peakRssBytes: 5 * 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 500,
        };

        const targetPath = guardFailureReceiptPath(repoRoot, laneName);
        const writtenPaths: string[] = [];
        const renameCalls: Array<{
            source: string;
            target: string;
            candidateExistedBeforeRename: boolean;
            candidateContentBeforeRename: string;
            targetExistedBeforeRename: boolean;
        }> = [];

        try {
            const ports: WriteGuardFailureReceiptPorts = {
                writeFileSync: (path, data, options) => {
                    writtenPaths.push(String(path));
                    writeFileSync(path, data, options);
                },
                renameSync: (source, target) => {
                    const sourcePath = String(source);
                    const targetPathStr = String(target);
                    const candidateExistedBeforeRename = existsSync(source);
                    const candidateContentBeforeRename = candidateExistedBeforeRename
                        ? readFileSync(source, 'utf8')
                        : '';
                    const targetExistedBeforeRename = existsSync(target);
                    renameCalls.push({
                        source: sourcePath,
                        target: targetPathStr,
                        candidateExistedBeforeRename,
                        candidateContentBeforeRename,
                        targetExistedBeforeRename,
                    });
                    renameSync(source, target);
                },
            };

            writeGuardFailureReceipt(repoRoot, receipt, ports);

            expect(writtenPaths).toHaveLength(1);
            expect(renameCalls).toHaveLength(1);
            const renameCall = renameCalls[0];
            expect(renameCall).toBeDefined();
            if (renameCall === undefined) {
                throw new Error('expected renameCall to be defined');
            }
            expect(writtenPaths[0]).toBe(renameCall.source);
            expect(writtenPaths[0]).not.toBe(targetPath);
            expect(renameCall.target).toBe(targetPath);
            expect(renameCall.source).toMatch(
                new RegExp(`^${targetPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.candidate-[0-9a-f-]+$`)
            );
            expect(renameCall.candidateExistedBeforeRename).toBe(true);
            expect(renameCall.targetExistedBeforeRename).toBe(false);
            expect(JSON.parse(renameCall.candidateContentBeforeRename)).toEqual(receipt);
            expect(existsSync(renameCall.source)).toBe(false);
            expect(existsSync(targetPath)).toBe(true);
            expect(readGuardFailureReceipt(repoRoot, laneName)).toEqual(receipt);
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('writes guard-failure receipt on memory/timeout/monitor/leak failure in an author lane', async () => {
        const repoRoot = fixtureRoot('lane-fail');
        const laneName = 'agent-101-work';
        const headSha = '3333333333333333333333333333333333333333';
        const lane: DetectedLane = {
            primaryRoot: repoRoot,
            laneName,
            branch: 'agent/101/work',
            headSha,
            worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
        };

        const logs: string[] = [];
        const errors: string[] = [];

        try {
            for (const reason of ['memory', 'timeout', 'monitor', 'leak'] as const) {
                const code = await runGuardCli(['--', 'pnpm', 'test:run', 'test.spec.ts'], {
                    cwd: lane.worktreePath,
                    detectLane: () => lane,
                    runCommand: async () =>
                        fakeResult({
                            code: 1,
                            reason,
                            peakRssBytes: 6 * 1024 ** 3,
                            maxRssBytes: 4 * 1024 ** 3,
                            durationMs: 300,
                        }),
                    log: (msg) => logs.push(msg),
                    error: (msg) => errors.push(msg),
                });

                expect(code).toBe(1);
                const receipt = readGuardFailureReceipt(repoRoot, laneName);
                expect(receipt).toBeDefined();
                expect(receipt?.reason).toBe(reason);
                expect(receipt?.headSha).toBe(headSha);
                expect(receipt?.command).toBe('pnpm');
                expect(receipt?.args).toEqual(['test:run', 'test.spec.ts']);
                expect(errors).toContain(
                    `guard: recorded guard-failure receipt in ${GUARD_FAILURES_DIR}/${laneName}.json; lane is stopped`
                );
                clearGuardFailureReceipt(repoRoot, laneName);
            }
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('refuses verification when active receipt matches current headSha', async () => {
        const repoRoot = fixtureRoot('lane-refuse');
        const laneName = 'agent-102-stopped';
        const headSha = '4444444444444444444444444444444444444444';
        const lane: DetectedLane = {
            primaryRoot: repoRoot,
            laneName,
            branch: 'agent/102/stopped',
            headSha,
            worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
        };

        const receipt: GuardFailureReceipt = {
            version: 1,
            lane: laneName,
            branch: lane.branch,
            headSha,
            failedAt: '2026-09-07T12:00:00.000Z',
            reason: 'memory',
            command: 'pnpm',
            args: ['test:run', 'test.spec.ts'],
            profile: 'focused',
            peakRssBytes: 5 * 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 500,
        };
        writeGuardFailureReceipt(repoRoot, receipt);

        let commandRan = false;
        const errors: string[] = [];

        try {
            const code = await runGuardCli(['--', 'pnpm', 'test:run', 'test.spec.ts'], {
                cwd: lane.worktreePath,
                detectLane: () => lane,
                runCommand: async () => {
                    commandRan = true;
                    return fakeResult();
                },
                error: (msg) => errors.push(msg),
            });

            expect(code).toBe(1);
            expect(commandRan).toBe(false);
            expect(errors[0]).toMatch(
                /guard: refusing verification: active guard-failure receipt exists for lane agent-102-stopped/
            );
            expect(errors[0]).toMatch(/A timeout, RSS kill, or memory-monitor failure is a stop/);
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('admits verification and clears receipt when headSha changes and verification succeeds', async () => {
        const repoRoot = fixtureRoot('lane-admit');
        const laneName = 'agent-103-advance';
        const oldHeadSha = '5555555555555555555555555555555555555555';
        const newHeadSha = '6666666666666666666666666666666666666666';

        const lane: DetectedLane = {
            primaryRoot: repoRoot,
            laneName,
            branch: 'agent/103/advance',
            headSha: newHeadSha,
            worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
        };

        const receipt: GuardFailureReceipt = {
            version: 1,
            lane: laneName,
            branch: lane.branch,
            headSha: oldHeadSha,
            failedAt: '2026-09-07T12:00:00.000Z',
            reason: 'timeout',
            command: 'pnpm',
            args: ['test:run', 'test.spec.ts'],
            profile: 'focused',
            peakRssBytes: 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 600_000,
        };
        writeGuardFailureReceipt(repoRoot, receipt);

        let commandRan = false;
        const logs: string[] = [];

        try {
            const code = await runGuardCli(['--', 'pnpm', 'test:run', 'test.spec.ts'], {
                cwd: lane.worktreePath,
                detectLane: () => lane,
                runCommand: async () => {
                    commandRan = true;
                    return fakeResult({ code: 0 });
                },
                log: (msg) => logs.push(msg),
            });

            expect(code).toBe(0);
            expect(commandRan).toBe(true);
            expect(readGuardFailureReceipt(repoRoot, laneName)).toBeUndefined();
            expect(logs).toContain(
                `guard: failure resolved by committed change ${newHeadSha.slice(0, 9)}; receipt cleared`
            );
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    it('does not clear receipt when headSha changes but verification command differs from failed command, and clears it once matching command succeeds', async () => {
        const repoRoot = fixtureRoot('lane-mismatched-command');
        const laneName = 'agent-108-mismatch';
        const oldHeadSha = '5555555555555555555555555555555555555555';
        const newHeadSha = '6666666666666666666666666666666666666666';

        const lane: DetectedLane = {
            primaryRoot: repoRoot,
            laneName,
            branch: 'agent/108/mismatch',
            headSha: newHeadSha,
            worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
        };

        const receipt: GuardFailureReceipt = {
            version: 1,
            lane: laneName,
            branch: lane.branch,
            headSha: oldHeadSha,
            failedAt: '2026-09-07T12:00:00.000Z',
            reason: 'timeout',
            command: 'pnpm',
            args: ['test:run', 'test.spec.ts'],
            profile: 'focused',
            peakRssBytes: 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 600_000,
        };
        writeGuardFailureReceipt(repoRoot, receipt);

        try {
            // Unrelated command succeeds under new headSha: receipt should NOT be cleared
            const code1 = await runGuardCli(['--', 'pnpm', 'lint', 'src/x.ts'], {
                cwd: lane.worktreePath,
                detectLane: () => lane,
                runCommand: async () => fakeResult({ code: 0 }),
            });
            expect(code1).toBe(0);
            expect(readGuardFailureReceipt(repoRoot, laneName)).toBeDefined();

            // Matching command succeeds under new headSha: receipt SHOULD be cleared
            const code2 = await runGuardCli(['--', 'pnpm', 'test:run', 'test.spec.ts'], {
                cwd: lane.worktreePath,
                detectLane: () => lane,
                runCommand: async () => fakeResult({ code: 0 }),
            });
            expect(code2).toBe(0);
            expect(readGuardFailureReceipt(repoRoot, laneName)).toBeUndefined();
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });

    describe('--recover workflow', () => {
        it('refuses --recover outside an author worktree', async () => {
            const errors: string[] = [];
            const code = await runGuardCli(['--recover'], {
                detectLane: () => undefined,
                error: (msg) => errors.push(msg),
            });
            expect(code).toBe(1);
            expect(errors[0]).toContain('--recover must be run inside an author worktree');
        });

        it('reports clean when no receipt exists for the lane', async () => {
            const repoRoot = fixtureRoot('recover-none');
            const laneName = 'agent-104-clean';
            const lane: DetectedLane = {
                primaryRoot: repoRoot,
                laneName,
                branch: 'agent/104/clean',
                headSha: '7777777777777777777777777777777777777777',
                worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
            };

            const logs: string[] = [];
            try {
                const code = await runGuardCli(['--recover'], {
                    cwd: lane.worktreePath,
                    detectLane: () => lane,
                    log: (msg) => logs.push(msg),
                });
                expect(code).toBe(0);
                expect(logs).toContain(`guard: no active guard-failure receipt for lane ${laneName}`);
            } finally {
                rmSync(repoRoot, { recursive: true, force: true });
            }
        });

        it('re-executes receipt command on --recover and clears receipt on success', async () => {
            const repoRoot = fixtureRoot('recover-success');
            const laneName = 'agent-105-recover';
            const headSha = '8888888888888888888888888888888888888888';
            const lane: DetectedLane = {
                primaryRoot: repoRoot,
                laneName,
                branch: 'agent/105/recover',
                headSha,
                worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
            };

            const receipt: GuardFailureReceipt = {
                version: 1,
                lane: laneName,
                branch: lane.branch,
                headSha,
                failedAt: '2026-09-07T12:00:00.000Z',
                reason: 'memory',
                command: 'pnpm',
                args: ['test:run', 'heavy.spec.ts'],
                profile: 'focused',
                peakRssBytes: 5 * 1024 ** 3,
                maxRssBytes: 4 * 1024 ** 3,
                durationMs: 1200,
            };
            writeGuardFailureReceipt(repoRoot, receipt);

            let capturedCommand: string | undefined;
            let capturedArgs: string[] | undefined;
            let capturedMaxRss: number | undefined;
            const logs: string[] = [];

            try {
                const code = await runGuardCli(['--recover', '--max-rss-mib', '6144'], {
                    cwd: lane.worktreePath,
                    detectLane: () => lane,
                    runCommand: async (input) => {
                        capturedCommand = input.command;
                        capturedArgs = input.args;
                        capturedMaxRss = input.maxRssBytes;
                        return fakeResult({ code: 0, peakRssBytes: 5.5 * 1024 ** 3 });
                    },
                    log: (msg) => logs.push(msg),
                });

                expect(code).toBe(0);
                expect(capturedCommand).toBe('pnpm');
                expect(capturedArgs).toEqual(['test:run', 'heavy.spec.ts']);
                expect(capturedMaxRss).toBe(6144 * 1024 ** 2);
                expect(readGuardFailureReceipt(repoRoot, laneName)).toBeUndefined();
                expect(logs).toContain(`guard: recovery succeeded; guard-failure receipt cleared for lane ${laneName}`);
            } finally {
                rmSync(repoRoot, { recursive: true, force: true });
            }
        });

        it('retains updated receipt when --recover run fails', async () => {
            const repoRoot = fixtureRoot('recover-fail');
            const laneName = 'agent-106-recover-fail';
            const headSha = '9999999999999999999999999999999999999999';
            const lane: DetectedLane = {
                primaryRoot: repoRoot,
                laneName,
                branch: 'agent/106/recover-fail',
                headSha,
                worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
            };

            const receipt: GuardFailureReceipt = {
                version: 1,
                lane: laneName,
                branch: lane.branch,
                headSha,
                failedAt: '2026-09-07T12:00:00.000Z',
                reason: 'memory',
                command: 'pnpm',
                args: ['test:run', 'heavy.spec.ts'],
                profile: 'focused',
                peakRssBytes: 5 * 1024 ** 3,
                maxRssBytes: 4 * 1024 ** 3,
                durationMs: 1200,
            };
            writeGuardFailureReceipt(repoRoot, receipt);

            const errors: string[] = [];

            try {
                const code = await runGuardCli(['--recover'], {
                    cwd: lane.worktreePath,
                    detectLane: () => lane,
                    runCommand: async () =>
                        fakeResult({
                            code: 1,
                            reason: 'memory',
                            peakRssBytes: 5.8 * 1024 ** 3,
                            maxRssBytes: 4 * 1024 ** 3,
                            durationMs: 1500,
                        }),
                    error: (msg) => errors.push(msg),
                });

                expect(code).toBe(1);
                const updated = readGuardFailureReceipt(repoRoot, laneName);
                expect(updated).toBeDefined();
                expect(updated?.peakRssBytes).toBe(5.8 * 1024 ** 3);
                expect(errors).toContain(`guard: recovery failed; lane ${laneName} remains stopped`);
            } finally {
                rmSync(repoRoot, { recursive: true, force: true });
            }
        });

        it('uses receipt profile by default and respects explicit --profile on --recover', async () => {
            const repoRoot = fixtureRoot('recover-profile');
            const laneName = 'agent-107-recover-profile';
            const headSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
            const lane: DetectedLane = {
                primaryRoot: repoRoot,
                laneName,
                branch: 'agent/107/recover-profile',
                headSha,
                worktreePath: join(repoRoot, '.agents', 'worktrees', laneName),
            };

            const receipt: GuardFailureReceipt = {
                version: 1,
                lane: laneName,
                branch: lane.branch,
                headSha,
                failedAt: '2026-09-07T12:00:00.000Z',
                reason: 'memory',
                command: 'pnpm',
                args: ['test:run', 'heavy.spec.ts'],
                profile: 'broad',
                peakRssBytes: 5 * 1024 ** 3,
                maxRssBytes: 4 * 1024 ** 3,
                durationMs: 1200,
            };
            writeGuardFailureReceipt(repoRoot, receipt);

            let capturedProfile: ResourceProfile | undefined;
            try {
                await runGuardCli(['--recover'], {
                    cwd: lane.worktreePath,
                    detectLane: () => lane,
                    runCommand: async (input) => {
                        capturedProfile = input.profile;
                        return fakeResult({ code: 0 });
                    },
                });
                expect(capturedProfile).toBe('broad');

                writeGuardFailureReceipt(repoRoot, { ...receipt, profile: 'focused' });

                await runGuardCli(['--recover', '--profile', 'extended'], {
                    cwd: lane.worktreePath,
                    detectLane: () => lane,
                    runCommand: async (input) => {
                        capturedProfile = input.profile;
                        return fakeResult({ code: 0 });
                    },
                });
                expect(capturedProfile).toBe('extended');
            } finally {
                rmSync(repoRoot, { recursive: true, force: true });
            }
        });
    });
});
