import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type RecordedGhChild = { cwd: string; toplevel: string };

/**
 * Puts a stand-in `gh` first on `PATH` for the body, so a default runner that resolves `gh` by name
 * starts it instead of the real CLI. The stand-in records the directory it starts in and the
 * repository a git it runs there finds, then prints `stdout`.
 */
export function withRecordingGh(stdout: string, body: (recorded: () => RecordedGhChild) => void): void {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-recording-gh-')));
    const bin = join(root, 'bin');
    const record = join(root, 'record');
    const previousPath = process.env.PATH;
    try {
        mkdirSync(bin);
        writeFileSync(
            join(bin, 'gh'),
            [
                '#!/bin/sh',
                `printf '%s\\n%s\\n' "$(pwd -P)" "$(git rev-parse --show-toplevel 2>/dev/null)" > ${JSON.stringify(record)}`,
                `printf '%s' ${JSON.stringify(stdout)}`,
                '',
            ].join('\n')
        );
        chmodSync(join(bin, 'gh'), 0o755);
        process.env.PATH = `${bin}:${previousPath ?? ''}`;
        body(() => {
            const [cwd = '', toplevel = ''] = readFileSync(record, 'utf8').split('\n');
            return { cwd, toplevel };
        });
    } finally {
        if (previousPath === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = previousPath;
        }
        rmSync(root, { recursive: true, force: true });
    }
}
