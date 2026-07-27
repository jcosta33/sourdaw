import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    PROCESS_SUPERVISOR_SENTINEL_ROLE,
    type SentinelMessage,
    type SentinelOutcomeMessage,
    type TrustedCodeOwnedExecutorStartMessage,
} from '../processSupervisorSentinel';

const sentinelPath = join(process.cwd(), 'scripts/agent-campaign/processSupervisorSentinel.ts');
const sentinels: ChildProcess[] = [];
const roots: string[] = [];

function waitForMessage(sentinel: ChildProcess): Promise<SentinelMessage> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sentinel message timed out')), 2_000);
        sentinel.once('error', reject);
        sentinel.once('message', (message: SentinelMessage) => {
            clearTimeout(timer);
            resolve(message);
        });
    });
}

async function startSentinel() {
    const sentinel = spawn(
        process.execPath,
        ['--no-warnings', '--experimental-strip-types', sentinelPath, PROCESS_SUPERVISOR_SENTINEL_ROLE],
        {
            detached: true,
            env: {},
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        }
    );
    sentinels.push(sentinel);
    expect(await waitForMessage(sentinel)).toEqual({ kind: 'ready' });
    return sentinel;
}

function sendStart(sentinel: ChildProcess, overrides: Partial<TrustedCodeOwnedExecutorStartMessage> = {}): void {
    sentinel.send({
        kind: 'start-trusted-code-owned-executor',
        executable: process.execPath,
        arguments: ['--eval', 'process.exitCode=0'],
        cwd: process.cwd(),
        ...overrides,
    });
}

async function stopSentinel(sentinel: ChildProcess): Promise<void> {
    if (sentinel.pid === undefined) {
        return;
    }
    const processGroupId = sentinel.pid;
    try {
        process.kill(-processGroupId, 'SIGKILL');
    } catch {
        sentinel.unref();
        return;
    }
    for (let index = 0; index < 400; index += 1) {
        try {
            process.kill(-processGroupId, 0);
        } catch {
            sentinel.unref();
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('sentinel group did not terminate');
}

afterEach(async () => {
    await Promise.all(sentinels.splice(0).map(stopSentinel));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('processSupervisorSentinel', () => {
    it.each([0, 7])('should report exact exit %i and remain alive for its owner', async (code) => {
        const sentinel = await startSentinel();
        sendStart(sentinel, { arguments: ['--eval', `process.exitCode=${code}`] });

        expect(await waitForMessage(sentinel)).toEqual({ kind: 'exit', code });
        expect(() => process.kill(Number(sentinel.pid), 0)).not.toThrow();
    });

    it('should report exact signal termination', async () => {
        const sentinel = await startSentinel();
        sendStart(sentinel, { arguments: ['--eval', "process.kill(process.pid,'SIGTERM')"] });
        expect(await waitForMessage(sentinel)).toEqual({ kind: 'signal', signal: 'SIGTERM' });
    });

    it('should forward streams without leaking them through IPC and withhold inherited secrets', async () => {
        const sentinel = await startSentinel();
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        sentinel.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
        sentinel.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
        const secret = 'private-token';
        process.env.SOURDAW_SENTINEL_SECRET = secret;
        sendStart(sentinel, {
            arguments: [
                '--eval',
                "process.stdout.write(process.env.SOURDAW_SENTINEL_SECRET??'missing');process.stderr.write('warning')",
            ],
        });

        const outcome = await waitForMessage(sentinel);
        delete process.env.SOURDAW_SENTINEL_SECRET;
        expect(Buffer.concat(stdout).toString()).toBe('missing');
        expect(Buffer.concat(stderr).toString()).toBe('warning');
        expect(JSON.stringify(outcome)).not.toMatch(/private-token|missing|warning/);
    });

    it('should flush forwarded bytes before reporting terminal IPC', async () => {
        const sentinel = await startSentinel();
        let byteCount = 0;
        sentinel.stdout?.on('data', (chunk: Buffer) => {
            byteCount += chunk.byteLength;
        });
        sendStart(sentinel, {
            arguments: ['--eval', 'process.stdout.write(Buffer.alloc(4194304,97))'],
        });

        expect(await waitForMessage(sentinel)).toEqual({ kind: 'exit', code: 0 });
        expect(byteCount).toBe(4_194_304);
    });

    it.each([{ stream: 'stdout' }, { stream: 'stderr' }] as const)(
        'should drain executor $stream after the owner closes its pipe',
        async ({ stream }) => {
            const sentinel = await startSentinel();
            sentinel[stream]?.destroy();
            const token = `private-${stream}-token`;
            sendStart(sentinel, {
                arguments: ['--eval', `process.${stream}.write(${JSON.stringify(token)}.repeat(200000))`],
            });

            const outcome = await waitForMessage(sentinel);
            expect(outcome).toEqual({ kind: 'spawn-error' });
            expect(JSON.stringify(outcome)).not.toContain(token);
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(() => process.kill(Number(sentinel.pid), 0)).not.toThrow();
        }
    );

    it('should let a destination error override an earlier executor exit', async () => {
        const sentinel = await startSentinel();
        sentinel.stdout?.destroy();
        sendStart(sentinel, {
            arguments: ['--eval', "process.stdout.write('private-token');process.exit(0)"],
        });
        const outcome = await waitForMessage(sentinel);
        expect(outcome).toEqual({ kind: 'spawn-error' });
        expect(JSON.stringify(outcome)).not.toContain('private-token');
    });

    it('should remain alive when its owner disconnects before executor outcome', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-sentinel-'));
        const readyPath = join(root, 'ready.txt');
        const outcomePath = join(root, 'outcome.txt');
        roots.push(root);
        const sentinel = await startSentinel();
        const script = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(readyPath)},'ready');setTimeout(()=>fs.writeFileSync(${JSON.stringify(outcomePath)},'done'),200)`;
        sendStart(sentinel, { arguments: ['--eval', script] });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await expect(access(readyPath)).resolves.toBeUndefined();
        sentinel.disconnect();

        await new Promise((resolve) => setTimeout(resolve, 200));
        await expect(access(outcomePath)).resolves.toBeUndefined();
        expect(() => process.kill(Number(sentinel.pid), 0)).not.toThrow();
    });

    it('should keep the sentinel as group leader after the executor exits', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-sentinel-'));
        const identityPath = join(root, 'identity.txt');
        roots.push(root);
        const sentinel = await startSentinel();
        const script = `const {execFileSync}=require('node:child_process');require('node:fs').writeFileSync(${JSON.stringify(identityPath)},process.pid+':'+execFileSync('/bin/ps',['-o','pgid=','-p',String(process.pid)],{encoding:'utf8'}).trim())`;
        sendStart(sentinel, { arguments: ['--eval', script] });

        expect(await waitForMessage(sentinel)).toEqual({ kind: 'exit', code: 0 });
        const [executorId, processGroupId] = (await readFile(identityPath, 'utf8')).split(':').map(Number);
        expect([executorId === sentinel.pid, processGroupId]).toEqual([false, sentinel.pid]);
        expect(() => process.kill(Number(sentinel.pid), 0)).not.toThrow();
    });

    it('should redact spawn failure', async () => {
        const sentinel = await startSentinel();
        sendStart(sentinel, { executable: '/definitely/missing/sourdaw-executor' });
        expect(await waitForMessage(sentinel)).toEqual({ kind: 'spawn-error' });
    });

    it.each([
        ['empty executable', { executable: '' }],
        ['relative executable', { executable: relative(process.cwd(), process.execPath) }],
        ['NUL executable', { executable: `${process.execPath}\u0000invalid` }],
        ['empty cwd', { cwd: '' }],
        ['relative cwd', { cwd: '.' }],
        ['NUL cwd', { cwd: `${process.cwd()}\u0000invalid` }],
        ['NUL argument', { arguments: ['invalid\u0000argument'] }],
    ])('should reject %s before spawn', async (_case, overrides) => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-sentinel-'));
        const forbiddenPath = join(root, 'forbidden.txt');
        roots.push(root);
        const sentinel = await startSentinel();
        const script = `require('node:fs').writeFileSync(${JSON.stringify(forbiddenPath)},'bad')`;
        sendStart(sentinel, { arguments: ['--eval', script], ...overrides });
        expect(await waitForMessage(sentinel)).toEqual({ kind: 'spawn-error' });
        await expect(access(forbiddenPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should reject malformed IPC and remain alive', async () => {
        const sentinel = await startSentinel();
        sentinel.send({ kind: 'start-trusted-code-owned-executor', executable: 42 });
        expect(await waitForMessage(sentinel)).toEqual({ kind: 'spawn-error' });
        expect(() => process.kill(Number(sentinel.pid), 0)).not.toThrow();
    });

    it('should reject a second start without launching it', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-sentinel-'));
        const forbiddenPath = join(root, 'forbidden.txt');
        roots.push(root);
        const sentinel = await startSentinel();
        sendStart(sentinel, { arguments: ['--eval', 'setInterval(()=>{},1000)'] });
        sendStart(sentinel, {
            arguments: ['--eval', `require('node:fs').writeFileSync(${JSON.stringify(forbiddenPath)},'bad')`],
        });

        const outcome: SentinelOutcomeMessage = await waitForMessage(sentinel);
        expect(outcome).toEqual({ kind: 'spawn-error' });
        await expect(access(forbiddenPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
