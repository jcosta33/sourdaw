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
            combinedOutputByteCap: 1_000_000,
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
    it.each([0, 7])('should preserve exact exit %i without exposing raw streams', async (code) => {
        const token = `private-${code}`;
        const output = await run(
            `process.stdout.write(${JSON.stringify(token)});process.stderr.write(${JSON.stringify(token)});process.exitCode=${code}`
        );
        expect(output.reason).toEqual({ kind: 'exit', code });
        expect(output.streamEvidence?.combinedByteCount).toBe(Buffer.byteLength(token) * 2);
        expect(JSON.stringify(output)).not.toContain(token);
    });

    it('should return exact byte counts and SHA-256 digests without raw output', async () => {
        const output = await run("process.stdout.write(Buffer.alloc(100000,97));process.stderr.write('world')");
        expect(output).toEqual({
            reason: { kind: 'exit', code: 0 },
            streamEvidence: {
                stdout: {
                    byteCount: 100_000,
                    sha256: '6d1cf22d7cc09b085dfc25ee1a1f3ae0265804c607bc2074ad253bcc82fd81ee',
                },
                stderr: {
                    byteCount: 5,
                    sha256: '486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7',
                },
                combinedByteCount: 100_005,
            },
        });
        expect(JSON.stringify(output)).not.toContain('world');
    });

    it('should hash split multibyte output as exact bytes', async () => {
        const script =
            "const value=Buffer.from('🥐');process.stdout.write(value.subarray(0,2));process.stdout.write(value.subarray(2))";
        const output = await run(script, { combinedOutputByteCap: 4 });
        expect(output.streamEvidence).toEqual({
            stdout: {
                byteCount: 4,
                sha256: '2e037269436db82a4ce80082caade93628c8e37c1f967b6e03d3554c9d0aeba5',
            },
            stderr: {
                byteCount: 0,
                sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
            combinedByteCount: 4,
        });
    });

    it('should enforce one combined byte cap across both streams', async () => {
        const token = 'private-combined-cap';
        const output = await run(
            `process.stdout.write(${JSON.stringify(token)});process.stderr.write(${JSON.stringify(token)})`,
            { combinedOutputByteCap: Buffer.byteLength(token) * 2 - 1 }
        );
        expect(output).toEqual({
            reason: { kind: 'output-cap-exceeded' },
            streamEvidence: null,
        });
        expect(JSON.stringify(output)).not.toContain(token);
    });

    it('should reject a large crossing chunk without publishing prefix evidence', async () => {
        const token = 'private-large-chunk';
        const output = await run(`process.stdout.write(${JSON.stringify(token)}.repeat(8192))`, {
            combinedOutputByteCap: 1_000,
        });
        expect(output).toEqual({
            reason: { kind: 'output-cap-exceeded' },
            streamEvidence: null,
        });
        expect(JSON.stringify(output)).not.toContain(token);
    });

    it('should let a delayed output-cap crossing replace terminal IPC', async () => {
        const source =
            "process.on('message',()=>process.send({kind:'exit',code:0},()=>setTimeout(()=>process.stdout.write('overflow',()=>process.exit(0)),20)));process.send({kind:'ready'})";
        const injectedSentinel = await temporarySentinel(source);
        const output = await run(
            '',
            { combinedOutputByteCap: 4 },
            {
                sentinelPath: () => injectedSentinel,
                killGroup: () => undefined,
                groupExists: () => false,
            }
        );
        expect(output).toEqual({
            reason: { kind: 'output-cap-exceeded' },
            streamEvidence: null,
        });
    });

    it('should let a delayed output-cap crossing replace signal IPC', async () => {
        const source =
            "process.on('message',()=>process.send({kind:'signal',signal:'SIGTERM'},()=>setTimeout(()=>process.stdout.write('overflow',()=>process.exit(0)),20)));process.send({kind:'ready'})";
        const injectedSentinel = await temporarySentinel(source);
        const output = await run(
            '',
            { combinedOutputByteCap: 4 },
            {
                sentinelPath: () => injectedSentinel,
                killGroup: () => undefined,
                groupExists: () => false,
            }
        );
        expect(output).toEqual({
            reason: { kind: 'output-cap-exceeded' },
            streamEvidence: null,
        });
    });

    it('should let cleanup uncertainty dominate output-cap overflow', async () => {
        const output = await run(
            "process.stdout.write('overflow');setInterval(()=>{},1000)",
            { combinedOutputByteCap: 4 },
            {
                cleanupPollMs: 1,
                cleanupTimeoutMs: 20,
                groupExists: () => true,
            }
        );
        expect(output).toEqual({
            reason: { kind: 'termination-unconfirmed' },
            streamEvidence: null,
        });
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
        expect(output).toMatchObject({ reason: { kind: 'exit', code: 0 } });
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

    it('should kill an overflowing group before a grandchild late effect', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const latePath = join(root, 'late.txt');
        roots.push(root);
        const grandchild = `process.stdout.write('overflow');setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(latePath)},'late'),100);setInterval(()=>{},1000)`;
        const child = `require('node:child_process').spawn(process.execPath,['--eval',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000)`;
        expect(await run(child, { combinedOutputByteCap: 4 })).toEqual({
            reason: { kind: 'output-cap-exceeded' },
            streamEvidence: null,
        });
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
        "process.send({kind:'unexpected'});setInterval(()=>{},1000)",
        "process.on('message',()=>{});process.send({kind:'ready'});process.send({kind:'ready'});setInterval(()=>{},1000)",
        "process.on('message',()=>process.send({kind:'signal',signal:'SIGBOGUS'}));process.send({kind:'ready'})",
    ])('should reject invalid sentinel IPC %#', async (source) => {
        const injectedSentinel = await temporarySentinel(source);
        expect(await run('', {}, { sentinelPath: () => injectedSentinel })).toMatchObject({
            reason: { kind: 'malformed-ipc' },
        });
    });

    it('should kill a disconnected sentinel before its late effect', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sourdaw-supervisor-'));
        const latePath = join(root, 'late.txt');
        roots.push(root);
        const source = `process.on('message',()=>{setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(latePath)},'late'),100);process.disconnect()});process.send({kind:'ready'});setInterval(()=>{},1000)`;
        const injectedSentinel = await temporarySentinel(source);
        expect(await run('', {}, { sentinelPath: () => injectedSentinel })).toMatchObject({
            reason: { kind: 'sentinel-failure' },
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await expect(access(latePath)).rejects.toMatchObject({ code: 'ENOENT' });
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
            "process.stdout.write('private-incomplete')",
            {},
            {
                cleanupPollMs: 1,
                cleanupTimeoutMs: 20,
                groupExists: () => true,
            }
        );
        expect(output).toEqual({ reason: { kind: 'termination-unconfirmed' }, streamEvidence: null });
    });

    it.each([
        [{ executable: 'relative-executor' }, {}],
        [{ arguments: ['invalid\u0000argument'] }, {}],
        [{ timeoutMs: 2_147_483_648 }, {}],
        [{ combinedOutputByteCap: 0 }, {}],
        [{ combinedOutputByteCap: 1.5 }, {}],
        [{}, { sentinelPath: () => `${sentinelPath}\u0000invalid` }],
    ])('should redact synchronous or NUL launch failure %#', async (overrides, dependencies) => {
        const output = await run('', overrides, dependencies);
        expect(output).toMatchObject({ reason: { kind: 'launch-error' } });
        expect(JSON.stringify(output)).not.toContain('invalid');
    });
});
