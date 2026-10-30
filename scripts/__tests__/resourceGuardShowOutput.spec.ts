import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
    emitGuardedResult,
    parseCliArgs,
    RESOURCE_ROOT_ENV,
    RESOURCE_SESSION_ENV,
    runGuardedCommand,
} from '../resourceGuard';

function fixtureRoot(label: string): string {
    return mkdtempSync(join(tmpdir(), `sourdaw-resource-show-output-${label}-`));
}

const abundantMemoryBytes = 128 * 1024 ** 3;
const enforcementAdmissionRoot = fixtureRoot('enforcement');

afterAll(() => rmSync(enforcementAdmissionRoot, { recursive: true, force: true }));

function runIsolatedGuardedCommand(
    input: Parameters<typeof runGuardedCommand>[0]
): ReturnType<typeof runGuardedCommand> {
    return runGuardedCommand({ ...input, admissionRoot: enforcementAdmissionRoot });
}

/** Child stdout exceeds 32 KiB so a bumped 32 KiB tail still drops LINE 1. */
const oversizedStdoutLineCount = 4000;
const oversizedStdoutChild = [
    '-e',
    `
for (let line = 1; line <= ${oversizedStdoutLineCount}; line += 1) {
    process.stdout.write('LINE ' + line + '\\n');
}
`.trim(),
];

async function runPipedGuard(stream: 'stdout' | 'stderr', childExitCode: number, showOutput = true) {
    const root = fixtureRoot('cli-pipe');
    const payload = `BEGIN:${'x'.repeat(262_144)}:END`;
    const env: NodeJS.ProcessEnv = { ...process.env, [RESOURCE_ROOT_ENV]: root };
    delete env[RESOURCE_SESSION_ENV];
    const program = `process.${stream}.write('BEGIN:' + 'x'.repeat(262144) + ':END'); process.exitCode = ${childExitCode};`;
    try {
        const args = [resolvePath('scripts/resourceGuard.ts'), '--profile', 'focused', '--max-rss-mib', '512'];
        if (showOutput) {
            args.push('--show-output');
        }
        args.push('--', process.execPath, '-e', program);
        const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });
        return {
            ...result,
            stdout: Buffer.concat(stdout).toString(),
            stderr: Buffer.concat(stderr).toString(),
            payload,
        };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('resource guard --show-output', () => {
    it.each([
        ['stdout', 0],
        ['stderr', 7],
    ] as const)(
        'drains complete piped %s output when the child exits %i',
        async (stream, childExitCode) => {
            const result = await runPipedGuard(stream, childExitCode);
            expect(result.signal).toBeNull();
            if (childExitCode === 0) {
                expect(result.code).toBe(0);
                expect(result.stderr).toBe('');
                expect(result.stdout.length).toBeGreaterThan(result.payload.length);
                expect(result.stdout.slice(0, result.payload.length)).toBe(result.payload);
                expect(result.stdout.slice(result.payload.length)).toMatch(
                    /^\n.+: OK \([0-9.]+s, peak [0-9]+ MiB\)\n$/
                );
            } else {
                expect(result.code).toBe(1);
                expect(result.stdout).toBe('');
                const headerEnd = result.stderr.indexOf('\n');
                expect(result.stderr.slice(0, headerEnd)).toMatch(/^.+: FAILED \(exit 7, [0-9.]+s, peak [0-9]+ MiB\)$/);
                expect(result.stderr.length - headerEnd - 1).toBe(result.payload.length + 1);
                expect(result.stderr.slice(headerEnd + 1)).toBe(`${result.payload}\n`);
            }
        },
        30_000
    );

    it('keeps the default bounded failure tail and reports omitted bytes through the CLI', async () => {
        const result = await runPipedGuard('stderr', 7, false);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        const lines = result.stderr.split('\n');
        expect(lines[0]).toMatch(/^.+: FAILED \(exit 7, [0-9.]+s, peak [0-9]+ MiB\)$/);
        expect(lines[1]).toBe(`[${result.payload.length - 16_384} earlier output bytes suppressed]`);
        expect(lines.slice(2).join('\n')).toBe(`${result.payload.slice(-16_384)}\n`);
    }, 30_000);

    it.each([
        ['SIGINT', 130],
        ['SIGTERM', 143],
    ] as const)(
        'exits on %s after its child has stopped',
        async (signal, expectedCode) => {
            const root = fixtureRoot('cli-signal');
            const ready = join(root, 'ready');
            const env: NodeJS.ProcessEnv = { ...process.env, [RESOURCE_ROOT_ENV]: root };
            delete env[RESOURCE_SESSION_ENV];
            const program = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
            const child = spawn(
                process.execPath,
                [
                    resolvePath('scripts/resourceGuard.ts'),
                    '--profile',
                    'focused',
                    '--max-rss-mib',
                    '512',
                    '--',
                    process.execPath,
                    '-e',
                    program,
                ],
                {
                    cwd: root,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                }
            );
            const stderr: Buffer[] = [];
            child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
            child.stdout.resume();
            const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
                (resolve, reject) => {
                    child.once('error', reject);
                    child.once('close', (code, childSignal) => resolve({ code, signal: childSignal }));
                }
            );
            try {
                await vi.waitFor(() => expect(existsSync(ready)).toBe(true), { timeout: 15_000 });
                const guardedPid = Number(readFileSync(ready, 'utf8'));
                expect(Number.isSafeInteger(guardedPid) && guardedPid > 0).toBe(true);
                expect(child.kill(signal)).toBe(true);
                const result = await completion;
                expect(result).toEqual({ code: expectedCode, signal: null });
                expect(Buffer.concat(stderr).toString()).toContain('FAILED (signal,');
                expect(() => process.kill(guardedPid, 0)).toThrow();
                rmSync(root, { recursive: true, force: true });
            } finally {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill('SIGTERM');
                    await completion;
                }
            }
        },
        30_000
    );

    it('captures child stdout from the first line when showOutput is set', async () => {
        const cli = parseCliArgs(['--show-output', '--', process.execPath, ...oversizedStdoutChild]);
        expect(cli.showOutput).toBe(true);

        const result = await runIsolatedGuardedCommand({
            command: cli.command,
            args: cli.args,
            profile: cli.profile,
            showOutput: cli.showOutput,
            availableMemoryBytes: abundantMemoryBytes,
        });

        expect(result.code).toBe(0);
        expect(result.omittedBytes).toBe(0);
        expect(result.output.startsWith('LINE 1\n')).toBe(true);
        expect(result.output).toContain(`LINE ${oversizedStdoutLineCount}`);
    });

    it('emits the full child stdout on success when showOutput is set', () => {
        const output = Array.from({ length: oversizedStdoutLineCount }, (_, index) => `LINE ${index + 1}\n`).join('');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const exitCode = emitGuardedResult(
                process.execPath,
                {
                    code: 0,
                    signal: null,
                    output,
                    omittedBytes: 0,
                    peakRssBytes: 0,
                    maxRssBytes: 512 * 1024 ** 2,
                    durationMs: 100,
                },
                true
            );
            expect(exitCode).toBe(0);
            expect(logSpy.mock.calls.some(([line]) => line === output)).toBe(true);
        } finally {
            logSpy.mockRestore();
        }
    });

    it('fails and emits full child stdout when successful child exit has uncertain cleanup', () => {
        const output = Array.from({ length: oversizedStdoutLineCount }, (_, index) => `LINE ${index + 1}\n`).join('');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const exitCode = emitGuardedResult(
                process.execPath,
                {
                    code: 0,
                    signal: null,
                    reason: 'leak',
                    output,
                    omittedBytes: 0,
                    peakRssBytes: 0,
                    maxRssBytes: 512 * 1024 ** 2,
                    durationMs: 100,
                },
                true
            );
            expect(exitCode).not.toBe(0);
            expect(
                errorSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('FAILED (leak,'))
            ).toBe(true);
            expect(errorSpy.mock.calls.some(([line]) => line === output)).toBe(true);
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('names the applied RSS budget when a memory kill is reported', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const exitCode = emitGuardedResult('pnpm', {
            code: null,
            signal: 'SIGKILL',
            reason: 'memory',
            output: '',
            omittedBytes: 0,
            peakRssBytes: 4500 * 1024 ** 2,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 1000,
        });

        expect(exitCode).toBe(1);
        expect(
            errorSpy.mock.calls.some(
                ([line]) =>
                    typeof line === 'string' &&
                    /peak 4500 MiB exceeded the 4096 MiB RSS budget; rerun with --max-rss-mib/.test(line)
            )
        ).toBe(true);
        errorSpy.mockRestore();
    });

    it('keeps the RSS budget line off a non-memory failure', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const exitCode = emitGuardedResult('pnpm', {
            code: null,
            signal: 'SIGKILL',
            reason: 'timeout',
            output: '',
            omittedBytes: 0,
            peakRssBytes: 1024 ** 3,
            maxRssBytes: 4 * 1024 ** 3,
            durationMs: 1000,
        });

        expect(exitCode).toBe(1);
        expect(
            errorSpy.mock.calls.some(
                ([line]) => typeof line === 'string' && /exceeded the .* MiB RSS budget/.test(line)
            )
        ).toBe(false);
        errorSpy.mockRestore();
    });
});
