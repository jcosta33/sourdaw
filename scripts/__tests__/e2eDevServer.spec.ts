// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const launcher = pathToFileURL(resolve(root, 'scripts/e2eDevServer.ts')).href;

function startFixture(program: string): ChildProcess {
    const runner = `import { runE2eDevServer } from ${JSON.stringify(launcher)}; runE2eDevServer(${JSON.stringify(root)}, 6123, process.execPath, ['-e', ${JSON.stringify(program)}]);`;
    return spawn(process.execPath, ['--input-type=module', '-e', runner], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function capture(child: ChildProcess) {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolveClose({ code, signal }));
    });
    return { closed, output: () => ({ stdout, stderr }) };
}

function waitForReady(child: ChildProcess): Promise<void> {
    return new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture did not become ready')), 10_000);
        child.stdout?.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('fixture-ready')) {
                clearTimeout(timer);
                resolveReady();
            }
        });
        child.once('close', () => {
            clearTimeout(timer);
            reject(new Error('fixture exited before readiness'));
        });
    });
}

function records(stderr: string): Record<string, unknown>[] {
    return stderr
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('observed e2e dev server', () => {
    it('records the child identity and failure after retaining both output streams', async () => {
        const child = startFixture(
            "console.log('fixture-stdout'); console.log('fixture-pid=' + process.pid); console.error('fixture-stderr'); process.exitCode = 7;"
        );
        const result = capture(child);
        expect(await result.closed).toEqual({ code: 7, signal: null });
        const { stdout, stderr } = result.output();
        expect(stdout).toContain('fixture-stdout');
        expect(stderr).toContain('fixture-stderr');
        const [start, exit] = records(stderr);
        expect(start).toMatchObject({ source: 'e2e-dev-server', event: 'start', root, port: 6123 });
        expect(start?.pid).toBe(Number(stdout.match(/fixture-pid=(\d+)/)?.[1]));
        expect(start?.time).toEqual(expect.any(String));
        expect(exit).toMatchObject({ event: 'exit', code: 7, signal: null, runId: start?.runId });
    });

    it('propagates an unexpected child signal', async () => {
        const child = startFixture("process.kill(process.pid, 'SIGTERM');");
        const result = capture(child);
        expect(await result.closed).toEqual({ code: null, signal: 'SIGTERM' });
        expect(records(result.output().stderr)).toContainEqual(
            expect.objectContaining({ event: 'exit', code: null, signal: 'SIGTERM' })
        );
    });

    it('records cleanup and bounds a child that ignores termination', async () => {
        const child = startFixture(
            "process.on('SIGTERM', () => {}); console.log('fixture-ready'); setInterval(() => {}, 1000);"
        );
        const result = capture(child);
        await waitForReady(child);
        child.kill('SIGTERM');
        expect(await result.closed).toEqual({ code: null, signal: 'SIGKILL' });
        expect(records(result.output().stderr)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ event: 'cleanup', signal: 'SIGTERM' }),
                expect.objectContaining({ event: 'exit', code: null, signal: 'SIGKILL' }),
            ])
        );
    }, 12_000);
});
