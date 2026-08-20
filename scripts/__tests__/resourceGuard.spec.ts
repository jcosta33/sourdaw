import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
    acquireResourceLock,
    enterResourceSession,
    hasExplicitTarget,
    parseCgroupAvailableBytes,
    parseCliArgs,
    parseMemAvailableBytes,
    psSamplingArgs,
    RESOURCE_ROOT_ENV,
    RESOURCE_SESSION_ENV,
    runGuardedCommand,
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
        ['looser', '4096', '8', '8', 2_048, '2', '2'],
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
                maxRssBytes: undefined,
                requireTarget: true,
                showOutput: true,
                command: 'pnpm',
                args: ['test'],
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
        expect(readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')).toMatch(/maxWorkers:\s*2/);
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
