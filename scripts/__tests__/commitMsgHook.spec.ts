import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LANE_CHANGE_TYPES, TITLE_PATTERN } from '../prContract.ts';

const HOOK = resolve(import.meta.dirname, '../../.githooks/commit-msg');

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** Runs the hook on a message file holding `message`, as `git commit` does. */
function runHook(message: string): { status: number | null; stderr: string } {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-commit-msg-'));
    directories.push(directory);
    const file = join(directory, 'COMMIT_EDITMSG');
    writeFileSync(file, message);
    const result = spawnSync('bash', [HOOK, file], { encoding: 'utf8' });
    if (result.error !== undefined) {
        throw result.error;
    }
    return { status: result.status, stderr: result.stderr };
}

describe('commit-msg hook', () => {
    it.each(LANE_CHANGE_TYPES)('accepts a %s subject, the same type set a pull-request title carries', (type) => {
        expect(runHook(`${type}(scope): subject\n\nbody\n`)).toEqual({ status: 0, stderr: '' });
        expect(runHook(`${type}: subject\n`).status).toBe(0);
        expect(TITLE_PATTERN.test(`${type}: subject`)).toBe(true);
    });

    it.each(['style: x', 'revert: x', 'Revert "feat: x"', 'Reapply "feat: x"', 'WIP x'])(
        'refuses %j, a subject lane:publish would refuse as the lane title',
        (subject) => {
            const result = runHook(`${subject}\n`);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("subject does not match this repo's convention");
            expect(TITLE_PATTERN.test(subject)).toBe(false);
        }
    );

    it.each(["Merge branch 'main'", 'fixup! feat: x', 'squash! feat: x', '# a comment', ''])(
        "passes git's own transient or merge subject %j through",
        (subject) => {
            expect(runHook(`${subject}\n`).status).toBe(0);
        }
    );

    it('refuses a conventional subject longer than 100 characters', () => {
        const result = runHook(`feat: ${'x'.repeat(95)}\n`);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('(max 100)');
    });

    it('names exactly the lane change types in its pattern and its help text', () => {
        const hook = readFileSync(HOOK, 'utf8');
        const alternation = /pattern='\^\(([^)]+)\)/.exec(hook)?.[1];
        expect(alternation?.split('|')).toEqual([...LANE_CHANGE_TYPES]);
        const help = /^Types {5}(.+)$/m.exec(hook)?.[1];
        expect(help?.split(' ')).toEqual([...LANE_CHANGE_TYPES]);
    });
});
