import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    lintLedgerCrossingPaths,
    lintLedgerCrossingRefusal,
    readLintLedgerCrossing,
    type GitCapture,
} from '../lintLedgerCrossing.ts';

const SUPPRESSIONS = JSON.stringify({ 'src/a.ts': { 'no-void': { count: 2 } } });
const OXLINT = `{
    // Burn-down baseline for func-style: today's offenders.
    "overrides": [{ "files": ["./src/c.ts", "**/*.ts"], "rules": { "func-style": "off" } }]
}`;
const SIZE_BASELINE = `export const sizeBaselineFiles = [\n    'src/big.ts',\n];\n`;
const CEILINGS = JSON.stringify({ 'src/big.ts': 700 });

describe('lint ledger crossing decision', () => {
    const cases: Array<{
        name: string;
        main: string[];
        pullRequest: string[];
        ledgers: string[];
        crossing: string[];
    }> = [
        {
            name: 'double prune of one suppressed file',
            main: ['eslint-suppressions.json', 'src/a.ts'],
            pullRequest: ['eslint-suppressions.json', 'src/a.ts'],
            ledgers: [SUPPRESSIONS],
            crossing: ['src/a.ts'],
        },
        {
            name: 'prunes of different suppressed files',
            main: ['eslint-suppressions.json', 'src/a.ts'],
            pullRequest: ['eslint-suppressions.json', 'src/b.ts'],
            ledgers: [JSON.stringify({ 'src/a.ts': {}, 'src/b.ts': {} })],
            crossing: [],
        },
        {
            name: 'a file changed on both sides that no ledger binds',
            main: ['src/free.ts'],
            pullRequest: ['src/free.ts'],
            ledgers: [SUPPRESSIONS, OXLINT, SIZE_BASELINE, CEILINGS],
            crossing: [],
        },
        {
            name: 'a file bound only by the ledger one side added',
            main: ['src/new.ts'],
            pullRequest: ['src/new.ts', 'eslint-suppressions.json'],
            ledgers: [SUPPRESSIONS, JSON.stringify({ 'src/new.ts': { 'no-void': { count: 1 } } })],
            crossing: ['src/new.ts'],
        },
        {
            name: 'an oxlint baseline entry written with a ./ prefix',
            main: ['src/c.ts', '.oxlintrc.json'],
            pullRequest: ['src/c.ts'],
            ledgers: [OXLINT],
            crossing: ['src/c.ts'],
        },
        {
            name: 'a size-baselined file grown on both sides',
            main: ['src/big.ts'],
            pullRequest: ['src/big.ts'],
            ledgers: [SIZE_BASELINE, CEILINGS],
            crossing: ['src/big.ts'],
        },
        {
            name: 'a file named only in the ceilings ledger',
            main: ['src/big.ts'],
            pullRequest: ['src/big.ts'],
            ledgers: [CEILINGS],
            crossing: ['src/big.ts'],
        },
        {
            name: 'ledger files themselves changed on both sides with no common source path',
            main: ['eslint-suppressions.json', '.oxlintrc.json', 'src/a.ts'],
            pullRequest: ['eslint-suppressions.json', '.oxlintrc.json', 'src/c.ts'],
            ledgers: [SUPPRESSIONS, OXLINT],
            crossing: [],
        },
        {
            name: 'a glob entry is not a literal path',
            main: ['src/d.ts'],
            pullRequest: ['src/d.ts'],
            ledgers: [OXLINT],
            crossing: [],
        },
    ];

    it.each(cases)('$name', ({ main, pullRequest, ledgers, crossing }) => {
        expect(lintLedgerCrossingPaths(main, pullRequest, ledgers)).toEqual(crossing);
    });

    it('sorts and deduplicates the crossing paths', () => {
        const ledger = JSON.stringify({ 'src/z.ts': {}, 'src/a.ts': {} });
        expect(
            lintLedgerCrossingPaths(['src/z.ts', 'src/a.ts', 'src/z.ts'], ['src/a.ts', 'src/z.ts'], [ledger])
        ).toEqual(['src/a.ts', 'src/z.ts']);
    });

    it('names the merge base, a bounded path list, and the remedy', () => {
        const paths = Array.from({ length: 12 }, (_, index) => `src/f${String(index).padStart(2, '0')}.ts`);
        const message = lintLedgerCrossingRefusal(7, { mergeBase: 'abc123', paths });
        expect(message).toContain('PR #7');
        expect(message).toContain('merge base abc123');
        expect(message).toContain('src/f09.ts and 2 more');
        expect(message).not.toContain('src/f10.ts');
        expect(message).toContain('merge current main into the lane and publish');
        expect(lintLedgerCrossingRefusal(7, { mergeBase: 'abc123', paths: [] })).toBeUndefined();
    });
});

describe('lint ledger crossing over a real repository', () => {
    let directory: string | undefined;

    afterEach(() => {
        if (directory !== undefined) {
            rmSync(directory, { recursive: true, force: true });
            directory = undefined;
        }
    });

    function scratchRepository(): { git: GitCapture; write: (path: string, content: string) => void } {
        const root = mkdtempSync(join(tmpdir(), 'lint-ledger-crossing-'));
        directory = root;
        const env = {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_SYSTEM: '/dev/null',
            GIT_AUTHOR_NAME: 'Fixture',
            GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
            GIT_COMMITTER_NAME: 'Fixture',
            GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        };
        const git: GitCapture = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
        git(['init', '--quiet', '--initial-branch=main']);
        return { git, write: (path, content) => writeFileSync(join(root, path), content) };
    }

    function suppressions(count: number): string {
        return `${JSON.stringify({ 'a.ts': { 'no-void': { count } } }, null, 2)}\n`;
    }

    it('refuses a double prune until main is merged into the second branch', () => {
        const { git, write } = scratchRepository();
        write('eslint-suppressions.json', suppressions(2));
        write('a.ts', 'void one;\nkeep;\nkeep;\nvoid two;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);

        git(['switch', '--quiet', '-c', 'a']);
        write('eslint-suppressions.json', suppressions(1));
        write('a.ts', 'one;\nkeep;\nkeep;\nvoid two;\n');
        git(['commit', '--quiet', '-am', 'fix one']);

        git(['switch', '--quiet', '-c', 'b', 'main']);
        write('eslint-suppressions.json', suppressions(1));
        write('a.ts', 'void one;\nkeep;\nkeep;\ntwo;\n');
        git(['commit', '--quiet', '-am', 'fix two']);

        git(['switch', '--quiet', 'main']);
        git(['merge', '--quiet', '--squash', 'a']);
        git(['commit', '--quiet', '-m', 'squash a']);

        const crossing = readLintLedgerCrossing(git, 'main', 'b');
        expect(crossing.paths).toEqual(['a.ts']);
        expect(crossing.mergeBase).toBe(git(['rev-parse', 'main~1']).trim());

        git(['switch', '--quiet', 'b']);
        // The identical prunes merge cleanly into a recorded 1 against 0 violations: the combination
        // a fresh Gate on the merged head now measures.
        git(['merge', '--quiet', '--no-edit', 'main']);

        expect(readLintLedgerCrossing(git, 'main', 'b')).toEqual({
            mergeBase: git(['rev-parse', 'main']).trim(),
            paths: [],
        });
    });

    it('tolerates a ledger absent from every tree', () => {
        const { git, write } = scratchRepository();
        write('a.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('a.ts', 'two;\n');
        git(['commit', '--quiet', '-am', 'b']);
        git(['switch', '--quiet', 'main']);
        write('a.ts', 'three;\n');
        git(['commit', '--quiet', '-am', 'main']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual([]);
    });

    it('refuses to judge a head commit that is not available locally', () => {
        const { git, write } = scratchRepository();
        write('a.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);

        expect(() => readLintLedgerCrossing(git, 'main', '0'.repeat(40))).toThrow(/is not available locally/u);
    });
});
