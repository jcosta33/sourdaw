import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { superviseProcess, type ProcessSupervisorInput } from '../processSupervisor';

const roots: string[] = [];
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function run(script: string, overrides: Partial<ProcessSupervisorInput> = {}) {
    return superviseProcess({
        executable: process.execPath,
        arguments: ['--input-type=module', '--eval', script],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        outputLimitBytes: 4_096,
        ...overrides,
    });
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('superviseProcess', () => {
    it.each([
        [0, 'hello', 'warning'],
        [7, 'failed', 'details'],
    ])('should hash streams and preserve exit status %i without raw output', async (code, stdout, stderr) => {
        const output = await run(
            `process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exitCode=${code}`
        );

        expect(output).toEqual({
            reason: { kind: 'exit', code },
            stdout: { sha256: hash(stdout), bytes: Buffer.byteLength(stdout) },
            stderr: { sha256: hash(stderr), bytes: Buffer.byteLength(stderr) },
        });
        expect(JSON.stringify(output)).not.toMatch(new RegExp(`${stdout}|${stderr}`));
    });

    it('should distinguish direct-child signal termination', async () => {
        expect(await run("process.kill(process.pid, 'SIGTERM')")).toMatchObject({
            reason: { kind: 'signal', signal: 'SIGTERM' },
        });
    });

    it('should provide an empty environment instead of inheriting secrets', async () => {
        const key = 'SOURDAW_PROCESS_SUPERVISOR_SECRET';
        const previous = process.env[key];
        process.env[key] = 'private-token';
        try {
            const output = await run(`process.stdout.write(process.env.${key} ?? 'missing')`);
            expect(output).toMatchObject({
                reason: { kind: 'exit', code: 0 },
                stdout: { sha256: hash('missing'), bytes: 7 },
            });
            expect(JSON.stringify(output)).not.toContain('private-token');
        } finally {
            if (previous === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous;
            }
        }
    });

    it('should kill and reap a direct child at the exact timeout', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const processIdPath = join(root, 'pid.txt');
        roots.push(root);
        const startedAt = Date.now();
        const script = `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(processIdPath)},String(process.pid));setInterval(()=>{},1000)`;
        const output = await run(script, { timeoutMs: 100 });

        expect(output.reason).toEqual({ kind: 'timeout' });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
        const processId = Number(await readFile(processIdPath, 'utf8'));
        expect(() => process.kill(processId, 0)).toThrow();
    });

    it('should kill a timed-out process group before a grandchild can write late', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const readyPath = join(root, 'ready.txt');
        const latePath = join(root, 'late.txt');
        roots.push(root);
        const grandchild = `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(readyPath)},'ready');setTimeout(()=>writeFileSync(${JSON.stringify(latePath)},'late'),250);setInterval(()=>{},1000)`;
        const child = `import {spawn} from 'node:child_process';spawn(process.execPath,['--input-type=module','--eval',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000)`;

        expect(await run(child, { timeoutMs: 150 })).toMatchObject({ reason: { kind: 'timeout' } });
        await expect(access(readyPath)).resolves.toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 150));
        await expect(access(latePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should kill the whole group when grandchild output crosses the byte limit', async () => {
        const grandchild = `process.stdout.write('x'.repeat(1000));setInterval(()=>{},1000)`;
        const child = `import {spawn} from 'node:child_process';spawn(process.execPath,['--eval',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000)`;
        const output = await run(child, { outputLimitBytes: 32 });

        expect(output.reason).toEqual({ kind: 'output-limit' });
        expect(output.stdout.bytes).toBe(33);
        expect(JSON.stringify(output)).not.toContain('xxx');
    });

    it('should kill remaining group members after the direct child exits', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const latePath = join(root, 'late.txt');
        roots.push(root);
        const grandchild = `process.stdout.write('ready');setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(latePath)},'late'),100)`;
        const child = `import {spawn} from 'node:child_process';const child=spawn(process.execPath,['--eval',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{child.stdout.destroy();child.unref()})`;

        expect(await run(child)).toMatchObject({ reason: { kind: 'exit', code: 0 } });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await expect(access(latePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should return a redacted spawn error', async () => {
        const output = await superviseProcess({
            executable: '/definitely/missing/sourdaw-supervisor',
            arguments: [],
            cwd: process.cwd(),
            timeoutMs: 100,
            outputLimitBytes: 100,
        });

        expect(output).toEqual({
            reason: { kind: 'spawn-error' },
            stdout: { sha256: hash(''), bytes: 0 },
            stderr: { sha256: hash(''), bytes: 0 },
        });
    });
});
