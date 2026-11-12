import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, vi } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

it('retains real runner, worker, collection and test-start events on failure', () => {
    const fixture = mkdtempSync(join(root, 'scripts/__tests__/vitest-progress-'));
    try {
        const spec = join(fixture, 'failure.spec.ts');
        const config = join(fixture, 'vitest.config.mjs');
        writeFileSync(spec, "import { it, expect } from 'vitest'; it('fails', () => expect(1).toBe(2));\n");
        writeFileSync(
            config,
            `export default { test: { include: [${JSON.stringify(spec)}], environment: 'node', setupFiles: [${JSON.stringify(join(root, 'scripts/vitestProgressSetup.ts'))}] } };\n`
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
        const journal = readdirSync(fixture).find((name) => name.startsWith('vitest-progress-'));
        expect(journal).toBeDefined();
        const journalPath = join(fixture, journal!);
        expect(statSync(journalPath).mode & 0o777).toBe(0o700);
        expect(statSync(join(journalPath, 'worker-setup.json')).mode & 0o777).toBe(0o600);
        const text = readdirSync(journalPath)
            .map((name) => readFileSync(join(journalPath, name), 'utf8'))
            .join('\n');
        for (const event of ['runner-start', 'module-queued', 'worker-setup', 'module-collected', 'test-start']) {
            expect(text).toContain(event);
        }
        expect(result.stderr).toContain(journal);
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
