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

const largeStdoutChild = [
    '-e',
    `
for (let line = 1; line <= 2000; line += 1) {
    process.stdout.write('LINE ' + line + '\\n');
}
`.trim(),
];

describe('resource guard --show-output', () => {
    it('captures child stdout from the first line when showOutput is set', async () => {
        const cli = parseCliArgs(['--show-output', '--', process.execPath, ...largeStdoutChild]);
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
        expect(result.output).toContain('LINE 2000');
    });

    it('emits the full child stdout on success when showOutput is set', async () => {
        const result = await runIsolatedGuardedCommand({
            command: process.execPath,
            args: largeStdoutChild,
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
});
