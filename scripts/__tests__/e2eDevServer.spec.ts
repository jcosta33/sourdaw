// @vitest-environment node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const launcher = pathToFileURL(resolve(root, 'scripts/e2eDevServer.ts')).href;

async function withFixture(
    program: string,
    check: (fixture: {
        output: () => { stdout: string; stderr: string };
        closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
        waitForReady: () => Promise<void>;
        terminate: () => void;
    }) => Promise<void>,
    command = process.execPath
): Promise<void> {
    const guardedProgram = `setTimeout(() => process.exit(99), 7000).unref(); ${program}`;
    const runner = `import { runE2eDevServer } from ${JSON.stringify(launcher)}; runE2eDevServer(${JSON.stringify(root)}, 6123, ${JSON.stringify(command)}, ['-e', ${JSON.stringify(guardedProgram)}]);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', runner], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let exited = false;
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('exit', () => (exited = true));
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => _resolve({ code, signal }));
    });
    const terminate = (): void => {
        if (!exited && child.pid !== undefined && child.pid > 0) {
            child.kill('SIGTERM');
        }
    };
    const watchdog = setTimeout(terminate, 8_000);
    const forceStop = setTimeout(() => {
        if (!exited && child.pid !== undefined && child.pid > 0) {
            child.kill('SIGKILL');
        }
    }, 11_000);
    const waitForReady = (): Promise<void> =>
        new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('fixture did not become ready')), 5_000);
            const checkOutput = (): void => {
                if (!stdout.includes('fixture-ready')) {
                    return;
                }
                clearTimeout(timer);
                child.stdout.off('data', checkOutput);
                _resolve();
            };
            child.stdout.on('data', checkOutput);
            checkOutput();
            void closed.then(() => {
                clearTimeout(timer);
                child.stdout.off('data', checkOutput);
                reject(new Error('fixture exited before readiness'));
            }, reject);
        });
    try {
        await check({ output: () => ({ stdout, stderr }), closed, waitForReady, terminate });
    } finally {
        clearTimeout(watchdog);
        terminate();
        try {
            await closed;
        } finally {
            clearTimeout(forceStop);
        }
    }
}

function records(stderr: string): Record<string, unknown>[] {
    return stderr
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('observed e2e dev server', () => {
    it('records the child identity and failure after retaining both output streams', async () => {
        await withFixture(
            "console.log('fixture-stdout'); console.log('fixture-pid=' + process.pid); console.error('fixture-stderr'); process.exitCode = 7;",
            async ({ closed, output }) => {
                expect(await closed).toEqual({ code: 7, signal: null });
                const { stdout, stderr } = output();
                expect(stdout).toContain('fixture-stdout');
                expect(stderr).toContain('fixture-stderr');
                const [start, exit] = records(stderr);
                expect(start).toMatchObject({ source: 'e2e-dev-server', event: 'start', root, port: 6123 });
                expect(start?.pid).toBe(Number(stdout.match(/fixture-pid=(\d+)/)?.[1]));
                expect(start?.time).toEqual(expect.any(String));
                expect(exit).toMatchObject({ event: 'exit', code: 7, signal: null, runId: start?.runId });
            }
        );
    }, 15_000);

    it('retains the cause when the child cannot spawn', async () => {
        await withFixture(
            '',
            async ({ closed, output }) => {
                const outcome = await closed;
                expect(outcome.signal).toBeNull();
                expect(outcome.code).not.toBe(0);
                expect(records(output().stderr)).toContainEqual(
                    expect.objectContaining({
                        event: 'spawn-error',
                        code: 'ENOENT',
                        message: 'spawn <executable> ENOENT',
                    })
                );
            },
            resolve(root, 'missing-e2e-server-command')
        );
    }, 15_000);

    it.skipIf(process.platform === 'win32')(
        'propagates an unexpected child signal',
        async () => {
            await withFixture("process.kill(process.pid, 'SIGTERM');", async ({ closed, output }) => {
                expect(await closed).toEqual({ code: null, signal: 'SIGTERM' });
                expect(records(output().stderr)).toContainEqual(
                    expect.objectContaining({ event: 'exit', code: null, signal: 'SIGTERM' })
                );
            });
        },
        15_000
    );

    it.skipIf(process.platform === 'win32')(
        'records cleanup and bounds a child that ignores termination',
        async () => {
            await withFixture(
                "process.on('SIGTERM', () => {}); console.log('fixture-ready'); setInterval(() => {}, 1000);",
                async ({ closed, output, waitForReady, terminate }) => {
                    await waitForReady();
                    terminate();
                    expect(await closed).toEqual({ code: null, signal: 'SIGKILL' });
                    expect(records(output().stderr)).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ event: 'cleanup', signal: 'SIGTERM' }),
                            expect.objectContaining({ event: 'exit', code: null, signal: 'SIGKILL' }),
                        ])
                    );
                }
            );
        },
        15_000
    );
});
