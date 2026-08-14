import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    acquireResourceLock,
    enterResourceSession,
    hasExplicitTarget,
    parseCliArgs,
    RESOURCE_SESSION_ENV,
    runGuardedCommand,
} from '../resourceGuard';
import { parseArgs as parseLintArgs } from '../runLint';

function fixtureRoot(label: string): string {
    return mkdtempSync(join(tmpdir(), `sourdaw-resource-${label}-`));
}

const abundantMemoryBytes = 16 * 1024 ** 3;

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
    it('rejects a second owner until release', () => {
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

    it('inherits the admitted session', () => {
        const root = fixtureRoot('inherit');
        const previous = process.env[RESOURCE_SESSION_ENV];
        try {
            const first = enterResourceSession({ root });
            process.env[RESOURCE_SESSION_ENV] = first.token;
            const inherited = enterResourceSession({ root });

            expect(inherited.token).toBe(first.token);
            inherited.release();
            expect(readFileSync(join(first.lockPath, 'owner.json'), 'utf8')).toContain(first.token);
            first.release();
        } finally {
            if (previous === undefined) {
                delete process.env[RESOURCE_SESSION_ENV];
            } else {
                process.env[RESOURCE_SESSION_ENV] = previous;
            }
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('resource enforcement', () => {
    it('refuses work below the memory floor', async () => {
        const result = await runGuardedCommand({
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            profile: 'focused',
            availableMemoryBytes: 0,
        });

        expect(result.reason).toBe('pressure');
        expect(result.durationMs).toBe(0);
    });

    it('kills commands that exceed their deadline', async () => {
        const result = await runGuardedCommand({
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5000)'],
            profile: 'focused',
            timeoutMs: 50,
            maxRssBytes: 1024 ** 4,
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
            const result = await runGuardedCommand({
                command: process.execPath,
                args: [
                    '-e',
                    `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: true, stdio: 'ignore' }); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); setInterval(() => {}, 1000);`,
                ],
                profile: 'focused',
                timeoutMs: 100,
                maxRssBytes: 1024 ** 4,
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
            const result = await runGuardedCommand({
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
            guard = spawn(
                process.execPath,
                [
                    '--experimental-strip-types',
                    'scripts/resourceGuard.ts',
                    '--profile',
                    'focused',
                    '--',
                    process.execPath,
                    '-e',
                    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`,
                ],
                { cwd: process.cwd(), stdio: 'ignore' }
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
        const result = await runGuardedCommand({
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
        const result = await runGuardedCommand({
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 5000)'],
            profile: 'focused',
            memorySampler: () => (samples++ === 0 ? abundantMemoryBytes : undefined),
            hostSampleIntervalMs: 10,
            sampleIntervalMs: 10,
            timeoutMs: 5_000,
        });

        expect(result.reason).toBe('monitor');
    });

    it('keeps only the output tail', async () => {
        const result = await runGuardedCommand({
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
            const result = await runGuardedCommand({
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
                requireTarget: true,
                showOutput: true,
                command: 'pnpm',
                args: ['test'],
            }
        );
    });

    it('requires targets for focused repository commands', () => {
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };

        for (const script of [
            'test:run',
            'test:e2e',
            'format',
            'cargo:fmt',
            'cargo:test',
            'cargo:check',
            'cargo:clippy',
            'cargo:bench',
            'cargo:fuzz',
        ]) {
            expect(packageJson.scripts[script]).toContain('--require-target');
        }
        expect(packageJson.scripts.format).toMatch(/prettier --write --$/);
        expect(() => parseCliArgs(['--profile', 'focused', '--require-target', '--', 'vitest', 'run'])).not.toThrow();
    });

    it('guards every non-interactive repository command', () => {
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        const exempt = new Set(['deliver', 'dev', 'dev:no-hmr', 'preview', 'tauri:dev', 'wasm:all']);

        for (const [name, command] of Object.entries(packageJson.scripts)) {
            if (!exempt.has(name)) {
                expect(command, name).toMatch(/resourceGuard\.ts|runLint\.ts/);
            }
        }
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
