import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `.githooks/pre-commit` is a shell script, so the thing under test is the script itself and the
 * only honest way to observe it is to run it against a real index. Every case below builds a
 * throwaway repository, stages content into it, and reads the hook's exit code and stderr.
 *
 * These are real child processes on purpose. `vi.mock('node:child_process')` does not intercept a
 * module under `scripts/`, and a spec that believed otherwise once ran a real `gh` command against
 * the public tracker — but there is nothing to intercept here anyway: the subject is a process.
 *
 * A harness that quietly stopped running the hook is the shape that would make all of this vacuous,
 * and nothing here can drift into it: the accepting and the refusing cases share one `runHook`, and
 * they disagree about the exit code. A harness that failed to launch the script reds both halves
 * rather than passing either.
 */
const hook = resolve(import.meta.dirname, '../../.githooks/pre-commit');

let repository: string;

function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function stage(path: string, content: string): void {
    writeFileSync(join(repository, path), content);
    git(['add', '--', path]);
}

function runHook(env?: Record<string, string>): { status: number | null; stderr: string } {
    const result = spawnSync(hook, [], {
        cwd: repository,
        encoding: 'utf8',
        shell: false,
        env: env === undefined ? undefined : { ...process.env, ...env },
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    return { status: result.status, stderr: result.stderr };
}

/** Column 0 markers, assembled here so this spec file never carries one at column 0 itself. */
const open = `${'<'.repeat(7)} HEAD`;
const separator = '='.repeat(7);
const close = `${'>'.repeat(7)} topic`;
const base = `${'|'.repeat(7)} merged common ancestors`;

/** Fence delimiter runs, assembled by length so their intent (3 vs 4, `` ` `` vs `~`) reads plainly. */
const backtick3 = '`'.repeat(3);
const backtick4 = '`'.repeat(4);
const tilde3 = '~'.repeat(3);

beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), 'sourdaw-conflict-hook-'));
    git(['init', '-q', '-b', 'main', '.']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
});

afterEach(() => {
    // `runHook` and `git commit` both fork children that can still be releasing file handles in the
    // repository when this runs; a single-shot `rmSync` occasionally loses that race with `ENOTEMPTY`
    // and reds an otherwise-passing suite. Retry rather than widen the race window with a sleep.
    rmSync(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('staged conflict-marker hook', () => {
    it('is an executable hook git will actually run', () => {
        expect(() => accessSync(hook, constants.X_OK)).not.toThrow();
    });

    it('accepts a staged file with no markers', () => {
        stage('clean.ts', 'export const value = 1;\n');

        expect(runHook().status).toBe(0);
    });

    it('accepts a commit that stages nothing', () => {
        expect(runHook().status).toBe(0);
    });

    it.each([
        ['an opening marker', `const a = 1;\n${open}\nconst b = 2;\n`],
        ['a closing marker', `const a = 1;\n${close}\n`],
        ['a diff3 base marker', `const a = 1;\n${base}\n`],
        ['a whole unresolved hunk', `${open}\nours\n${separator}\ntheirs\n${close}\n`],
    ])('refuses %s staged as resolved', (_case, content) => {
        stage('src.ts', content);

        const { status, stderr } = runHook();

        expect(status, 'a merge-conflict marker staged as resolved was allowed into the commit').toBe(1);
        expect(stderr).toMatch(/staged content still contains merge-conflict markers/);
        expect(stderr).toMatch(/src\.ts:\d+:/);
    });

    /**
     * The separator is the one marker the hook deliberately ignores. A row of `=` at column 0 is a
     * setext heading in Markdown, and a hook that fires on ordinary prose gets switched off, which
     * costs more than the marker it would have caught — the opening and closing markers of the same
     * conflict are still right there to catch it.
     */
    it('accepts a setext heading underline', () => {
        stage('doc.md', `Title\n${separator}\n\nbody\n`);

        expect(runHook().status).toBe(0);
    });

    it('accepts documentation showing markers inside a fenced code block', () => {
        stage('doc.md', `Resolving a conflict:\n\n\`\`\`\n${open}\nours\n${separator}\ntheirs\n${close}\n\`\`\`\n`);

        expect(runHook().status).toBe(0);
    });

    it('accepts documentation showing markers in an indented code block', () => {
        stage('doc.md', `Resolving a conflict:\n\n    ${open}\n    ours\n    ${close}\n`);

        expect(runHook().status).toBe(0);
    });

    it('refuses markers in Markdown prose outside any fence', () => {
        stage('doc.md', `Intro\n\n${open}\nours\n${separator}\ntheirs\n${close}\n`);

        const { status, stderr } = runHook();

        expect(status).toBe(1);
        expect(stderr).toMatch(/doc\.md:3:/);
    });

    /**
     * The fence exemption belongs to Markdown alone. A source file can hold a Markdown template
     * with a fence in it, and a real conflict inside that template sits at column 0 exactly like a
     * conflict anywhere else in the file, so the exemption must not follow the fence out of `.md`.
     */
    it('refuses markers inside a fenced block in a file that is not Markdown', () => {
        stage(
            'template.ts',
            `export const doc = \`\n\`\`\`\n${open}\nours\n${separator}\ntheirs\n${close}\n\`\`\`\n\`;\n`
        );

        expect(runHook().status, 'the Markdown fence exemption leaked into a source file').toBe(1);
    });

    /**
     * CommonMark's own way to show a fence nested inside a fence: a longer outer run wraps a
     * shorter inner run of the *same* character. A hook that toggles `fence` on any run of
     * backticks, without recording which character opened it or how long the run was, sees three
     * toggles here instead of two and is left stuck "inside a fence" for the rest of the file — so
     * it stops seeing conflict markers in ordinary prose past this point, not just inside the fence.
     */
    it('refuses a real conflict in prose after a 4-backtick fence containing a 3-backtick line', () => {
        stage(
            'doc.md',
            `${backtick4}\nsome code\n${backtick3}\nmore code\n${backtick4}\n\nIntro\n\n${open}\nours\n${separator}\ntheirs\n${close}\n`
        );

        const { status, stderr } = runHook();

        expect(
            status,
            'a 3-backtick line inside a 4-backtick fence toggled `fence` a third time, hiding every later marker'
        ).toBe(1);
        expect(stderr).toMatch(/doc\.md:9:/);
    });

    /** Same defect, the other direction: the nested line uses the other delimiter character. */
    it('refuses a real conflict in prose after a triple-backtick fence containing a triple-tilde line', () => {
        stage(
            'doc.md',
            `${backtick3}\nsome code\n${tilde3}\nmore code\n${backtick3}\n\nIntro\n\n${open}\nours\n${separator}\ntheirs\n${close}\n`
        );

        const { status, stderr } = runHook();

        expect(status, 'a ~~~ content line inside a ``` fence toggled `fence` on the wrong delimiter character').toBe(
            1
        );
        expect(stderr).toMatch(/doc\.md:9:/);
    });

    /**
     * Regression guard: the simple, single fenced example the hook already exempted correctly must
     * keep working once fence state is tracked by character and run length instead of a bare toggle.
     * This passes both before and after the fix — that is the point of a regression guard.
     */
    it.each([
        ['backtick', backtick3],
        ['tilde', tilde3],
    ])('accepts a marker genuinely inside a %s-fenced block', (_label, fence) => {
        stage('doc.md', `Resolving:\n\n${fence}\n${open}\nours\n${separator}\ntheirs\n${close}\n${fence}\n`);

        expect(runHook().status).toBe(0);
    });

    /**
     * A closing run only needs to be at least as long as the opener, not exactly equal — CommonMark
     * lets `````` close ```. A minimal file with only these two fence-looking lines cannot by itself
     * distinguish this from a hook that blindly toggles on any run: the parity of two toggles is the
     * same either way. Threading a mismatched-character line between them forces the two
     * implementations to disagree: the naive toggle counts it as a third flip and ends up "still
     * fenced" at the marker, while correct tracking recognizes it as content (wrong character) and
     * still closes on the final run because it is `>=` the opening length, not `==` it.
     */
    it('closes on a closing run longer than the opening run (```` closes ```)', () => {
        stage('doc.md', `${backtick3}\n${tilde3}\n${backtick4}\n\n${open}\n`);

        const { status, stderr } = runHook();

        expect(
            status,
            'a 4-backtick line failed to close a 3-backtick fence once a mismatched-character line came between them'
        ).toBe(1);
        expect(stderr).toMatch(/doc\.md:5:/);
    });

    /**
     * The working tree is not this hook's business: only what was staged can reach history, and a
     * hook that scanned the tree would block a commit for a conflict the author left aside.
     */
    it('ignores markers that are in the working tree but not staged', () => {
        stage('clean.ts', 'export const value = 1;\n');
        writeFileSync(join(repository, 'clean.ts'), `export const value = 1;\n${open}\nunstaged\n${close}\n`);

        expect(runHook().status).toBe(0);
    });

    it('ignores markers in a tracked file this commit does not touch', () => {
        stage('clean.ts', 'export const value = 1;\n');
        git(['commit', '-q', '--no-verify', '-m', 'chore(fixture): seed']);
        writeFileSync(join(repository, 'clean.ts'), `export const value = 1;\n${open}\nsneaked in\n${close}\n`);
        git(['commit', '-q', '--no-verify', '-a', '-m', 'chore(fixture): sneak markers past the hook']);
        stage('other.ts', 'export const other = 2;\n');

        expect(runHook().status).toBe(0);
    });

    it('reports every offending file in one run', () => {
        stage('a.ts', `a\n${open}\n`);
        stage('b.ts', `b\n${close}\n`);

        const { status, stderr } = runHook();

        expect(status).toBe(1);
        expect(stderr).toMatch(/a\.ts:2:/);
        expect(stderr).toMatch(/b\.ts:2:/);
    });

    it('tells the operator what to do and how to override', () => {
        stage('src.ts', `const a = 1;\n${open}\n`);

        const { stderr } = runHook();

        expect(stderr).toMatch(/Finish the resolution, restage the file, and commit again\./);
        expect(stderr).toMatch(/git commit --no-verify/);
    });

    /**
     * `git grep` failing is not the same thing as `git grep` finding nothing. The hook used to send
     * this stderr to `/dev/null` and read the resulting empty candidate list as "clean" — the
     * plausible real trigger is a pathspec big enough to overflow argv, but any `git grep` failure
     * reproduces the same fail-open shape. A `git` shim on `PATH` that only intercepts the `grep`
     * subcommand forces that failure deterministically without needing a multi-hundred-thousand-byte
     * fixture, and forwards every other subcommand (`diff`, `show`, ...) to the real binary so the
     * rest of the hook runs unmodified.
     */
    it('fails loud rather than passing when git grep itself errors', () => {
        stage('clean.ts', 'export const value = 1;\n');

        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        const shimDir = mkdtempSync(join(tmpdir(), 'sourdaw-conflict-hook-git-shim-'));
        const shimPath = join(shimDir, 'git');
        writeFileSync(
            shimPath,
            [
                '#!/usr/bin/env bash',
                'if [ "$1" = "grep" ]; then',
                "  echo 'boom: simulated grep failure' >&2",
                '  exit 2',
                'fi',
                `exec "${realGit}" "$@"`,
                '',
            ].join('\n')
        );
        chmodSync(shimPath, 0o755);

        try {
            const { status, stderr } = runHook({ PATH: `${shimDir}:${process.env.PATH ?? ''}` });

            expect(status, 'a git grep failure (exit 2) was read as a clean commit').toBe(1);
            expect(stderr).toMatch(/git grep failed/);
            expect(stderr).toMatch(/exit 2/);
        } finally {
            rmSync(shimDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        }
    });

    /**
     * The cases above drive the script directly. This one proves git is wired to it at all, which
     * is the difference between a check that runs and a file that sits in a directory.
     */
    it('blocks a real commit through core.hooksPath and lets a clean one through', () => {
        git(['config', 'core.hooksPath', resolve(import.meta.dirname, '../../.githooks')]);
        stage('src.ts', `const a = 1;\n${open}\nconst b = 2;\n${close}\n`);

        const blocked = spawnSync('git', ['commit', '-m', 'fix(fixture): resolved'], {
            cwd: repository,
            encoding: 'utf8',
            shell: false,
        });

        expect(blocked.status).toBe(1);
        expect(blocked.stderr).toMatch(/staged content still contains merge-conflict markers/);
        expect(git(['rev-list', '--all', '--count'])).toBe('0');

        stage('src.ts', 'const a = 1;\nconst b = 2;\n');
        const accepted = spawnSync('git', ['commit', '-m', 'fix(fixture): resolved'], {
            cwd: repository,
            encoding: 'utf8',
            shell: false,
        });

        expect(accepted.status).toBe(0);
        expect(git(['rev-list', '--all', '--count'])).toBe('1');
    });
});
