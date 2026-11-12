import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, vi } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

it('retains runner and process-group evidence when a real worker hook times out', () => {
    const fixture = mkdtempSync(join(root, 'scripts/__tests__/vitest-progress-'));
    try {
        const spec = join(fixture, 'failure.spec.ts');
        const config = join(fixture, 'vitest.config.mjs');
        writeFileSync(
            spec,
            "import { beforeEach, it, expect } from 'vitest'; beforeEach(() => new Promise(() => {})); it('fails', () => expect(1).toBe(2));\n"
        );
        writeFileSync(
            config,
            `export default { test: { include: [${JSON.stringify(spec)}], environment: 'node', hookTimeout: 50, setupFiles: [${JSON.stringify(join(root, 'scripts/vitestProgressSetup.ts'))}] } };\n`
        );
        const result = spawnSync(
            process.execPath,
            [join(root, 'scripts/runVitestZeroTestGuard.ts'), '--config', config],
            {
                cwd: root,
                encoding: 'utf8',
                env: { ...process.env, SOURDAW_VITEST_DIAGNOSTICS_DIR: fixture },
            }
        );
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain('Hook timed out');
        const journal = readdirSync(fixture).find((name) => name.startsWith('vitest-progress-'));
        expect(journal).toBeDefined();
        const journalPath = join(fixture, journal!);
        expect(statSync(journalPath).mode & 0o777).toBe(0o700);
        expect(statSync(join(journalPath, 'worker-setup.json')).mode & 0o777).toBe(0o600);
        const text = readdirSync(journalPath)
            .map((name) => readFileSync(join(journalPath, name), 'utf8'))
            .join('\n');
        for (const event of ['runner-start', 'module-queued', 'worker-setup', 'module-collected', 'case-ready']) {
            expect(text).toContain(event);
        }
        expect(result.stderr).toContain(journal);
        const ready = JSON.parse(readFileSync(join(journalPath, 'case-ready.json'), 'utf8'));
        expect(ready).toMatchObject({ event: 'case-ready', caseStatus: { mode: 'run' } });
        // Vitest may deliver the ready callback after the worker has recorded the hook failure.
        expect(['pending', 'failed']).toContain(ready.caseStatus.state);
        const runner = JSON.parse(readFileSync(join(journalPath, 'runner-start.json'), 'utf8'));
        const failure = JSON.parse(readFileSync(join(journalPath, 'module-failure.json'), 'utf8'));
        expect(failure).toMatchObject({
            event: 'module-failure',
            detail: spec,
            pid: runner.pid,
            parentPid: runner.parentPid,
            observation: { monotonicNs: expect.stringMatching(/^\d+$/), processGroup: { status: expect.any(String) } },
        });
        expect(['available', 'unavailable']).toContain(failure.observation.processGroup.status);
        if (failure.observation.processGroup.status === 'available') {
            expect(failure.observation.processGroup.rows).toContainEqual(
                expect.objectContaining({ pid: runner.pid, parentPid: runner.parentPid })
            );
        }
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
}, 30_000);

it('reports filtered skipped cases as ready without claiming their bodies ran', () => {
    const fixture = mkdtempSync(join(root, 'scripts/__tests__/vitest-progress-'));
    try {
        const spec = join(fixture, 'filtered.spec.ts');
        const config = join(fixture, 'vitest.config.mjs');
        const entered = join(fixture, 'body-entered');
        writeFileSync(
            spec,
            "import { writeFileSync } from 'node:fs'; import { it, expect } from 'vitest'; it('filtered case', () => { writeFileSync(process.env.SOURDAW_TEST_BODY_MARKER, 'entered'); expect(true).toBe(true); });\n"
        );
        writeFileSync(
            config,
            `export default { test: { include: [${JSON.stringify(spec)}], environment: 'node' } };\n`
        );
        const result = spawnSync(
            process.execPath,
            [join(root, 'scripts/runVitestZeroTestGuard.ts'), '--config', config, '-t', 'does-not-match'],
            {
                cwd: root,
                encoding: 'utf8',
                env: { ...process.env, SOURDAW_VITEST_DIAGNOSTICS_DIR: fixture, SOURDAW_TEST_BODY_MARKER: entered },
            }
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('zero executed assertions');
        expect(existsSync(entered)).toBe(false);
        const journal = readdirSync(fixture).find((name) => name.startsWith('vitest-progress-'));
        expect(journal).toBeDefined();
        const journalPath = join(fixture, journal!);
        const ready = JSON.parse(readFileSync(join(journalPath, 'case-ready.json'), 'utf8'));
        expect(ready).toMatchObject({ event: 'case-ready', detail: 'filtered case', caseStatus: { state: 'skipped' } });
        expect(['skip', 'run', 'only', 'todo']).toContain(ready.caseStatus.mode);
        expect(existsSync(join(journalPath, 'test-start.json'))).toBe(false);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
}, 30_000);

it('records production setup before a blocked test module can be collected', async () => {
    const fixture = mkdtempSync(join(root, 'scripts/__tests__/vitest-progress-'));
    const spec = join(fixture, 'blocked.spec.ts');
    const entered = join(fixture, 'entered');
    writeFileSync(
        spec,
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(entered)}, 'entered'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n`
    );
    const child = spawn(process.execPath, [join(root, 'scripts/runVitestZeroTestGuard.ts'), spec], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SOURDAW_VITEST_DIAGNOSTICS_DIR: fixture },
    });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    try {
        await vi.waitFor(
            () => {
                const journal = readdirSync(fixture).find((name) => name.startsWith('vitest-progress-'));
                expect(journal).toBeDefined();
                const files = readdirSync(join(fixture, journal!));
                expect(readFileSync(entered, 'utf8')).toBe('entered');
                expect(files).toContain('worker-setup.json');
                expect(files).toContain('module-queued.json');
                expect(files).not.toContain('module-collected.json');
            },
            { timeout: 20_000 }
        );
    } finally {
        if (child.pid !== undefined) {
            try {
                process.kill(-child.pid, 'SIGKILL');
            } catch {
                /* Already exited. */
            }
        }
        await closed;
        rmSync(fixture, { recursive: true, force: true });
    }
}, 30_000);

it('keeps builtin spawn interception available after production worker setup', () => {
    const fixture = mkdtempSync(join(root, 'scripts/__tests__/vitest-progress-'));
    try {
        const spec = join(fixture, 'interception.spec.ts');
        writeFileSync(
            spec,
            `import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
const { restore } = vi.hoisted(() => {
    const builtin = process.getBuiltinModule('node:child_process');
    const original = builtin.spawnSync;
    builtin.spawnSync = () => { throw new Error('intercepted safe echo'); };
    return { restore: () => { builtin.spawnSync = original; } };
});
afterAll(restore);
it('intercepts safe echo', () => {
    const journal = process.env.SOURDAW_VITEST_PROGRESS;
    expect(journal).toBeTypeOf('string');
    if (!journal) throw new Error('worker progress journal unavailable');
    const setup = JSON.parse(readFileSync(join(journal, 'worker-setup.json'), 'utf8'));
    expect(setup).toMatchObject({ event: 'worker-setup', pid: process.pid });
    expect(() => spawnSync('echo', ['probe'])).toThrow('intercepted safe echo');
});
`
        );
        const result = spawnSync(process.execPath, [join(root, 'scripts/runVitestZeroTestGuard.ts'), spec], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, SOURDAW_VITEST_DIAGNOSTICS_DIR: fixture },
        });
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toContain('1 passed');
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
}, 30_000);
