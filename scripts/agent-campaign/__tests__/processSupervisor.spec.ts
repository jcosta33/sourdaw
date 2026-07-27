import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    superviseTrustedProcess,
    type ProcessSupervisorDependencies,
    type TrustedProcessSupervisorInput,
} from '../processSupervisor';

const roots: string[] = [];
const sentinelPath = join(process.cwd(), 'scripts/agent-campaign/processSupervisorSentinel.ts');

function run(
    script: string,
    overrides: Partial<TrustedProcessSupervisorInput> = {},
    dependencies: Partial<ProcessSupervisorDependencies> = {}
) {
    return superviseTrustedProcess(
        {
            executable: process.execPath,
            arguments: ['--eval', script],
            cwd: process.cwd(),
            timeoutMs: 1_000,
            ...overrides,
        },
        { sentinelPath: () => sentinelPath, ...dependencies }
    );
}

async function temporarySentinel(source: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
    const path = join(root, 'sentinel.mjs');
    roots.push(root);
    await writeFile(path, source);
    return path;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('superviseTrustedProcess', () => {
    it.each([0, 7])('should preserve exact exit %i without exposing ignored streams', async (code) => {
        const token = `private-${code}`;
        const output = await run(
            `process.stdout.write(${JSON.stringify(token)});process.stderr.write(${JSON.stringify(token)});process.exitCode=${code}`
        );
        expect(output).toEqual({
            reason: { kind: 'exit', code },
            streamEvidence: null,
        });
        expect(JSON.stringify(output)).not.toContain(token);
    });

    it('should preserve exact signal termination', async () => {
        expect(await run("process.kill(process.pid,'SIGTERM')")).toMatchObject({
            reason: { kind: 'signal', signal: 'SIGTERM' },
        });
    });

    it('should give the sentinel and executor an empty environment', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const environmentPath = join(root, 'environment.txt');
        roots.push(root);
        process.env.SOURDAW_SUPERVISOR_SECRET = 'private-token';
        const output = await run(
            `require('node:fs').writeFileSync(${JSON.stringify(environmentPath)},process.env.SOURDAW_SUPERVISOR_SECRET??'missing')`
        );
        delete process.env.SOURDAW_SUPERVISOR_SECRET;
        expect(output).toMatchObject({ reason: { kind: 'exit', code: 0 }, streamEvidence: null });
        expect(await readFile(environmentPath, 'utf8')).toBe('missing');
        expect(JSON.stringify(output)).not.toContain('private-token');
    });

    it('should time out and reap a direct executor', async () => {
        const startedAt = Date.now();
        const output = await run('setInterval(()=>{},1000)', { timeoutMs: 100 });
        expect(output.reason).toEqual({ kind: 'timeout' });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
    });

    it('should kill a timed-out group before a grandchild can write late', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const readyPath = join(root, 'ready.txt');
        const latePath = join(root, 'late.txt');
        roots.push(root);
        const grandchild = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(readyPath)},'ready');setTimeout(()=>fs.writeFileSync(${JSON.stringify(latePath)},'late'),250);setInterval(()=>{},1000)`;
        const child = `const {spawn}=require('node:child_process');spawn(process.execPath,['--eval',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000)`;

        expect(await run(child, { timeoutMs: 150 })).toMatchObject({ reason: { kind: 'timeout' } });
        await expect(access(readyPath)).resolves.toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 150));
        await expect(access(latePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should kill a started grandchild after its direct executor exits', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const latePath = join(root, 'late.txt');
        roots.push(root);
        const grandchild = `process.stdout.write('ready');setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(latePath)},'late'),100)`;
        const child = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--eval',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{child.stdout.destroy();child.unref()})`;

        expect(await run(child)).toMatchObject({ reason: { kind: 'exit', code: 0 } });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await expect(access(latePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each([
        ["process.send({kind:'unexpected'});setInterval(()=>{},1000)", 'malformed-ipc'],
        [
            "process.on('message',()=>{});process.send({kind:'ready'});process.send({kind:'ready'});setInterval(()=>{},1000)",
            'malformed-ipc',
        ],
    ])('should reject invalid sentinel IPC %#', async (source, reason) => {
        const injectedSentinel = await temporarySentinel(source);
        expect(await run('', {}, { sentinelPath: () => injectedSentinel })).toMatchObject({
            reason: { kind: reason },
        });
    });

    it('should fail a sentinel that never becomes ready', async () => {
        const injectedSentinel = await temporarySentinel('setInterval(()=>{},1000)');
        expect(await run('', {}, { sentinelPath: () => injectedSentinel, startupTimeoutMs: 20 })).toMatchObject({
            reason: { kind: 'sentinel-failure' },
        });
    });

    it('should preserve a trusted executor spawn failure', async () => {
        expect(await run('', { executable: '/definitely/missing/trusted-executor' })).toMatchObject({
            reason: { kind: 'spawn-error' },
        });
    });

    it('should fail closed on unsupported platforms', async () => {
        expect(await run('', {}, { platform: 'linux' })).toMatchObject({
            reason: { kind: 'unsupported-platform' },
        });
    });

    it('should bound cleanup that cannot be confirmed', async () => {
        const output = await run(
            'process.exitCode=0',
            {},
            {
                cleanupPollMs: 1,
                cleanupTimeoutMs: 20,
                groupExists: () => true,
            }
        );
        expect(output.reason).toEqual({ kind: 'termination-unconfirmed' });
    });

    it.each([
        [{ executable: 'relative-executor' }, {}],
        [{ arguments: ['invalid\u0000argument'] }, {}],
        [{}, { sentinelPath: () => `${sentinelPath}\u0000invalid` }],
    ])('should redact synchronous or NUL launch failure %#', async (overrides, dependencies) => {
        const output = await run('', overrides, dependencies);
        expect(output).toMatchObject({ reason: { kind: 'launch-error' } });
        expect(JSON.stringify(output)).not.toContain('invalid');
    });
});
