import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { emitGuardedResult, parseCliArgs, runGuardedCommand } from '../resourceGuard';

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

describe('resource guard --show-output', () => {
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
