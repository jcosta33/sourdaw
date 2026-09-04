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

    it('emits the full child stdout on success when showOutput is set', async () => {
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: oversizedStdoutChild,
            profile: 'focused',
            showOutput: true,
            availableMemoryBytes: abundantMemoryBytes,
        });

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const exitCode = emitGuardedResult(process.execPath, result, true);

        expect(exitCode).toBe(0);
        expect(result.omittedBytes).toBe(0);
        expect(logSpy.mock.calls.some(([line]) => typeof line === 'string' && line.startsWith('LINE 1\n'))).toBe(true);
        logSpy.mockRestore();
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
});
