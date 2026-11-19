// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import admissionConfig from '../../tests/e2e/browserAiWebGpuAdmission.playwright.config';
import { isRecord } from '../browserAiMacCrashEvidence';

const launcher = pathToFileURL(resolve(import.meta.dirname, '../e2eDevServer.ts')).href;
const playwrightCli = join(dirname(fileURLToPath(import.meta.resolve('playwright/package.json'))), 'cli.js');
const playwrightTest = import.meta.resolve('@playwright/test');

type Outcome = { code: number | null; signal: NodeJS.Signals | null };

function runNode(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const done = new Promise<Outcome>((_resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => _resolve({ code, signal }));
    });
    return { child, done, output: () => output };
}

function shellWord(word: string): string {
    return `'${word.replaceAll("'", "'\\''")}'`;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isRecord(parsed)) {
        throw new Error('Expected a JSON object from the fixture');
    }
    return parsed;
}

async function withFixture(
    occupied: boolean,
    check: (fixture: {
        stage: string;
        origin: string;
        receipt: (name: string) => ReturnType<typeof readJson>;
        warmup: () => ReturnType<typeof readJson>;
        playwright: (mode: 'crash' | 'healthy') => ReturnType<typeof runNode>;
        direct: (mode: string, flags?: string[], withEvidence?: boolean) => ReturnType<typeof runNode>;
        releaseWarmup: () => Promise<void>;
    }) => Promise<void>
): Promise<void> {
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'sourdaw-webgpu-server-'));
    const stage = join(directory, 'sourdaw-webgpu.0123abcd');
    const reports = join(directory, 'DiagnosticReports');
    const socket = createServer((_request, response) => response.end('existing listener'));
    const processes: ReturnType<typeof runNode>[] = [];
    try {
        socket.listen(0, '127.0.0.1');
        await once(socket, 'listening');
        const address = socket.address();
        if (!address || typeof address === 'string') {
            throw new Error('Fixture requires a TCP port');
        }
        const origin = `http://127.0.0.1:${address.port}`;
        if (!occupied) {
            await new Promise<void>((_resolve) => socket.close(() => _resolve()));
        }
        const vite = join(directory, 'vite-fixture.mjs');
        const wrapper = join(directory, 'wrapper.mjs');
        const config = join(directory, 'playwright.config.mjs');
        await mkdir(stage, { mode: 0o700 });
        await mkdir(reports);
        await writeFile(join(reports, 'prelaunch.ips'), 'preexisting');
        await writeFile(
            vite,
            `import { createServer } from 'node:http';
            const { FIXTURE_MODE, FIXTURE_PORT, NO_HMR } = process.env;
            const identity = { pid: process.pid, parentPid: process.ppid, args: process.argv.slice(2), noHmr: NO_HMR };
            if (FIXTURE_MODE === 'early') process.exit(139);
            if (FIXTURE_MODE === 'signal') process.kill(process.pid, 'SIGTERM');
            if (FIXTURE_MODE === 'describe') {
                console.log(JSON.stringify(identity));
                process.exit(0);
            }
            const server = createServer((request, response) => {
                if (request.url === '/exit') {
                    response.end('exiting', () => process.exit(139));
                    return;
                }
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(identity));
            });
            process.on('SIGTERM', () => server.close(() => process.exit(0)));
            server.listen(Number(FIXTURE_PORT), '127.0.0.1');
            setTimeout(() => process.exit(99), 12_000).unref();`
        );
        await writeFile(
            wrapper,
            `import { launchE2eDevServer, runE2eDevServer } from ${JSON.stringify(launcher)};
            if (process.env.FIXTURE_MODE === 'missing') {
                runE2eDevServer(process.cwd(), 5188, './missing-executable', [], { reportsDirectory: ${JSON.stringify(reports)} });
            } else {
                launchE2eDevServer(process.cwd(), ${JSON.stringify(vite)}, process.argv.slice(2), { reportsDirectory: ${JSON.stringify(reports)} });
            }`
        );
        const server = admissionConfig.webServer;
        if (!server || Array.isArray(server)) {
            throw new Error('Expected one admission web server');
        }
        await writeFile(
            config,
            `export default ${JSON.stringify({
                globalSetup: './warmup.mjs',
                globalTimeout: 13_000,
                testMatch: 'fixture.spec.mjs',
                outputDir: './results',
                reporter: 'line',
                use: { baseURL: origin },
                webServer: {
                    ...server,
                    command: [process.execPath, wrapper, '--browser-ai-admission'].map(shellWord).join(' '),
                    cwd: directory,
                    url: origin,
                },
            })};`
        );
        const warmupFile = join(directory, 'warmup.json');
        const releaseFile = join(directory, 'release-warmup');
        await writeFile(
            join(directory, 'warmup.mjs'),
            `import { existsSync, writeFileSync } from 'node:fs';
            import { setTimeout } from 'node:timers/promises';
            export default async function () {
                const response = await fetch(${JSON.stringify(origin)});
                writeFileSync(${JSON.stringify(warmupFile)}, await response.text());
                if (process.env.FIXTURE_MODE === 'crash') {
                    while (!existsSync(${JSON.stringify(releaseFile)})) await setTimeout(20);
                    throw new Error('fixture warmup released after observing native exit');
                }
            }`
        );
        await writeFile(
            join(directory, 'fixture.spec.mjs'),
            `import { expect, test } from ${JSON.stringify(playwrightTest)};
            test('reads the live child during the proof', async ({ request }) => {
                expect((await request.get('/')).status()).toBe(200);
            });`
        );

        const start = (args: string[], mode: string, withEvidence = true): ReturnType<typeof runNode> => {
            const running = runNode(args, directory, {
                ...process.env,
                RUNNER_TEMP: directory,
                SOURDAW_BROWSER_AI_CRASH_DIRECTORY: withEvidence ? stage : undefined,
                FIXTURE_PORT: String(address.port),
                FIXTURE_MODE: mode,
                NO_HMR: '0',
            });
            processes.push(running);
            return running;
        };
        await check({
            stage,
            origin,
            receipt: (name) => readJson(join(stage, name)),
            warmup: () => readJson(warmupFile),
            playwright: (mode) => start([playwrightCli, 'test', '--config', config], mode),
            direct: (mode, flags = ['--browser-ai-admission'], withEvidence = true) =>
                start([wrapper, ...flags], mode, withEvidence),
            releaseWarmup: () => writeFile(releaseFile, ''),
        });
    } finally {
        for (const running of processes) {
            if (running.child.exitCode === null && running.child.signalCode === null) {
                running.child.kill('SIGINT');
            }
            await running.done;
        }
        if (socket.listening) {
            await new Promise<void>((_resolve) => socket.close(() => _resolve()));
        }
        await rm(directory, { recursive: true, force: true });
    }
}

describe.skipIf(process.platform === 'win32')('Browser AI admission dev server', () => {
    it('records the real child exit while Playwright still owns warmup', async () => {
        await withFixture(false, async ({ stage, origin, receipt, warmup, playwright, releaseWarmup }) => {
            const running = playwright('crash');
            try {
                const response = await vi.waitFor(warmup, { timeout: 8_000 }).catch((error: unknown) => {
                    throw new Error(running.output(), { cause: error });
                });
                expect(response).toEqual({
                    pid: expect.any(Number),
                    parentPid: expect.any(Number),
                    args: ['--host', '127.0.0.1', '--port', '5188', '--strictPort'],
                    noHmr: '0',
                });
                expect((await fetch(`${origin}/exit`)).ok).toBe(true);
                const start = await receipt('start.json');
                const exit = await vi.waitFor(() => receipt('exit.json'), { timeout: 4_000 });
                expect(start).toMatchObject({
                    pid: response.pid,
                    parentPid: response.parentPid,
                    executable: await realpath(process.execPath),
                    launchBefore: expect.any(Number),
                    launchAfter: expect.any(Number),
                    reportNames: ['prelaunch.ips'],
                });
                expect(exit).toMatchObject({
                    pid: response.pid,
                    runId: start.runId,
                    code: 139,
                    signal: null,
                    planned: false,
                    exitedAt: expect.any(Number),
                });
                expect((await stat(join(stage, 'start.json'))).mode & 0o777).toBe(0o600);
                expect((await stat(join(stage, 'exit.json'))).mode & 0o777).toBe(0o600);
                expect(running.child.exitCode).toBeNull();
            } finally {
                await releaseWarmup();
            }
            expect(await running.done).toEqual({ code: 1, signal: null });
            expect(running.output()).toContain('fixture warmup released after observing native exit');
        });
    }, 20_000);

    it('lets Playwright tear down its healthy listener and records the stop as planned', async () => {
        await withFixture(false, async ({ origin, receipt, playwright }) => {
            const running = playwright('healthy');
            expect(await running.done, running.output()).toEqual({ code: 0, signal: null });
            expect(running.output()).toContain('1 passed');
            expect(await receipt('exit.json')).toMatchObject({
                code: 0,
                signal: null,
                planned: true,
            });
            await expect(fetch(origin)).rejects.toThrow();
        });
    }, 20_000);

    it('refuses an already listening origin and leaves the existing listener alive', async () => {
        await withFixture(true, async ({ origin, receipt, playwright }) => {
            const running = playwright('crash');
            expect(await running.done).toEqual({ code: 1, signal: null });
            expect(running.output()).toContain('is already used');
            await expect(receipt('start.json')).rejects.toMatchObject({
                code: 'ENOENT',
            });
            expect(await (await fetch(origin)).text()).toBe('existing listener');
        });
    }, 20_000);

    it('keeps ordinary E2E in mode e2e with HMR disabled and refuses admission port overrides', async () => {
        await withFixture(false, async ({ direct }) => {
            const ordinary = direct('describe', ['6123']);
            expect(await ordinary.done, ordinary.output()).toEqual({ code: 0, signal: null });
            expect(ordinary.output()).toContain(
                '"args":["--mode","e2e","--host","127.0.0.1","--port","6123","--strictPort"],"noHmr":"1"'
            );
            const override = direct('describe', ['--browser-ai-admission', '6123']);
            expect(await override.done).toEqual({ code: 1, signal: null });
            expect(override.output()).toContain('Browser AI admission does not accept additional server arguments');
        });
    }, 20_000);

    it('also preserves an early exit with absent, rejected or unwritable evidence', async () => {
        await withFixture(false, async ({ stage, receipt, direct }) => {
            const noEvidence = direct('early', undefined, false);
            expect(await noEvidence.done, noEvidence.output()).toEqual({ code: 139, signal: null });
            await chmod(stage, 0o755);
            const rejected = direct('early');
            expect(await rejected.done).toEqual({ code: 139, signal: null });
            await expect(receipt('start.json')).rejects.toMatchObject({
                code: 'ENOENT',
            });
            await chmod(stage, 0o700);
            await mkdir(join(stage, 'exit.json'));
            const unwritable = direct('early');
            expect(await unwritable.done).toEqual({ code: 139, signal: null });
            expect(await receipt('start.json')).toMatchObject({
                pid: expect.any(Number),
            });
            expect((await stat(join(stage, 'exit.json'))).isDirectory()).toBe(true);
        });
    }, 20_000);

    it('records and propagates the real child signal independently of numeric exits', async () => {
        await withFixture(false, async ({ receipt, direct }) => {
            const running = direct('signal');
            expect(await running.done, running.output()).toEqual({ code: null, signal: 'SIGTERM' });
            expect(await receipt('exit.json')).toMatchObject({
                code: null,
                signal: 'SIGTERM',
                planned: false,
            });
        });
    }, 20_000);

    it('preserves a spawn failure without attributing a child or staging a receipt', async () => {
        await withFixture(false, async ({ receipt, direct }) => {
            const running = direct('missing');
            const outcome = await running.done;
            expect(outcome).toEqual({ code: expect.any(Number), signal: null });
            expect(outcome.code).not.toBe(0);
            expect(running.output()).toContain('spawn <executable> ENOENT');
            await expect(receipt('start.json')).rejects.toMatchObject({
                code: 'ENOENT',
            });
        });
    }, 20_000);
});
