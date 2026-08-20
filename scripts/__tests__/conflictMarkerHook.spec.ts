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

/**
 * Joins lines with CRLF and terminates the last one, so a fixture's line endings are stated by the
 * builder rather than hidden inside an escape in a template literal.
 */
function crlf(lines: string[]): string {
    return `${lines.join('\r\n')}\r\n`;
}

beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), 'sourdaw-conflict-hook-'));
    git(['init', '-q', '-b', 'main', '.']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
    // The CRLF cases below assert on what reaches the index, so line-ending translation is pinned
    // off rather than inherited: with `autocrlf` on, git would rewrite the fixture to LF on the way
    // in and those cases would silently stop testing CRLF at all.
    git(['config', 'core.autocrlf', 'false']);
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
     * awk ends a record at `\n` alone, so on a CRLF file every line still carries a trailing `\r`.
     * The closing-fence test compared what followed the delimiter run against the empty string, and
     * `"\r"` is not empty — so a fence opened and never closed, and every marker from there to end
     * of file was skipped as sample code. The LF version of the same bytes was refused, which is
     * what makes this a line-ending defect rather than a fence defect.
     */
    it('refuses a real conflict in CRLF prose after a properly closed fence', () => {
        stage(
            'crlf.md',
            crlf(['Intro', '', backtick3, 'code', backtick3, '', 'Prose', '', open, 'ours', separator, 'theirs', close])
        );

        const { status, stderr } = runHook();

        expect(status, 'a trailing carriage return stopped the fence closing, hiding every later marker').toBe(1);
        expect(stderr).toMatch(/crlf\.md:9:/);
    });

    /**
     * The discriminating half of the CRLF repair, and the one case that separates a real fix from
     * two wrong ones. A marker inside the fence and another in prose after it must produce exactly
     * one report: the later line.
     *
     * Before the repair the fence never closed and both markers were hidden, so the hook exited 0.
     * A repair that strips `\r` by abandoning the fence exemption on CRLF files instead reports
     * both lines. Only tracking the fence correctly on CRLF input reports the second and not the
     * first, so this asserts the absence of line 4 as firmly as the presence of line 8.
     */
    it('exempts a fenced CRLF marker while still catching one past the fence', () => {
        stage('mixed.md', crlf([backtick3, open, 'ours', close, backtick3, '', 'Prose', open, 'ours', close]));

        const { status, stderr } = runHook();

        expect(status, 'the CRLF fence never closed, so the marker in prose after it went unseen').toBe(1);
        expect(
            stderr,
            'the fence exemption was lost rather than fixed: a marker inside the fence was reported'
        ).not.toMatch(/mixed\.md:2:/);
        expect(stderr, 'the marker in prose after the CRLF fence was still not reported').toMatch(/mixed\.md:8:/);
    });

    /**
     * The exemption itself, on CRLF input. This one passes both before and after the repair — before,
     * because the fence never closed and the marker was skipped for the wrong reason; after, because
     * the fence opens and closes and the marker is genuinely inside it. It reproduces no defect and
     * is kept only as a guard against the repair that deletes the exemption instead of fixing it.
     * The case above is the one that actually discriminates.
     */
    it('accepts a CRLF marker genuinely inside a fenced block', () => {
        stage('inf.md', crlf(['Doc', '', backtick3, open, 'ours', separator, 'theirs', close, backtick3]));

        expect(runHook().status).toBe(0);
    });

    /**
     * The hook builds two lists and intersects them: the staged paths, and the index paths whose
     * content matches a marker. Every case below is a filename that the two sides used to spell
     * differently, so the intersection matched neither and a file carrying a real conflict dropped
     * out of the scan entirely — the hook exited 0 with markers staged.
     *
     * `git grep -l` renders a path through `core.quotePath` unless `-z` is passed, while
     * `git diff --name-only -z` always emits raw bytes. The trigger is not one property of the
     * name: `café.md` is quoted because it is non-ASCII and `core.quotePath` defaults on, but
     * `has"quote.md` and a name holding a control character are quoted whatever that config says.
     * That is why the repair is `-z` on both sides rather than `core.quotePath=false`, and why
     * these cases name distinct causes instead of repeating one.
     *
     * The last two go past quoting to representation. A path may contain a literal newline, which
     * no line-based intersection can carry and which also aborts `awk -v`; a path may contain a
     * backslash, which `awk -v` silently expands as an escape sequence. Both ended in the same
     * fail-open, so both are pinned here.
     */
    it.each([
        ['a non-ASCII name', 'café.md'],
        ['a name needing quotes for a reason core.quotePath does not govern', 'has"quote.md'],
        ['a name holding a backslash', 'back\\slash.md'],
        ['a name holding a literal newline', 'we\nird.md'],
    ])('refuses a real conflict staged under %s', (_case, name) => {
        stage(name, `${open}\nours\n${separator}\ntheirs\n${close}\n`);

        const { status, stderr } = runHook();

        expect(status, `a conflict staged under ${JSON.stringify(name)} was never scanned and committed silently`).toBe(
            1
        );
        expect(stderr).toMatch(/staged content still contains merge-conflict markers/);
        // The report must name the file by its real bytes, not by a quoted or escape-expanded
        // rendering of them: an operator has to be able to find the file the hook is refusing.
        expect(stderr).toContain(`${name}:1:`);
    });

    /**
     * `core.quotePath=false` is the repair this defect invites and the one that does not hold. It
     * addresses the non-ASCII spelling and nothing else, so the same hole stays open one filename
     * away. Forcing the config off here proves the fix does not depend on it.
     */
    it('refuses a conflict under a quote-needing name even with core.quotePath off', () => {
        git(['config', 'core.quotePath', 'false']);
        stage('has"quote.md', `${open}\nours\n${close}\n`);

        expect(runHook().status, 'the intersection still depended on how core.quotePath renders a path').toBe(1);
    });

    /**
     * The rewritten intersection is the load-bearing change, so the ordinary shapes it has to keep
     * getting right are pinned rather than assumed. A space needs no quoting and so never
     * reproduced the defect; it is here because the new membership test compares whole records and
     * would be the first thing broken by a return to word-splitting.
     */
    it('refuses a real conflict staged under an ASCII name containing spaces', () => {
        stage('has space.md', `a\n${open}\nb\n`);

        expect(runHook().status).toBe(1);
    });

    /**
     * `-I` drops binary blobs, so marker bytes inside one are not a staged textual conflict. The NUL
     * bytes are what make git call this blob binary in the first place: without one in the first
     * 8000 bytes git reads the file as text and this case would quietly stop testing `-I` at all.
     */
    it('ignores marker bytes inside a binary file', () => {
        const binary = Buffer.concat([
            Buffer.from(`${open}\n`),
            Buffer.from([0x00, 0x01, 0x02]),
            Buffer.from('payload'),
            Buffer.from([0x00]),
            Buffer.from(`\n${close}\n`),
        ]);
        writeFileSync(join(repository, 'blob.bin'), binary);
        git(['add', '--', 'blob.bin']);

        expect(runHook().status, 'a binary blob was scanned as text').toBe(0);
    });

    /** A deletion stages no content, so there is nothing for this hook to refuse. */
    it('ignores a staged deletion of a file that contained markers', () => {
        stage('gone.ts', `a\n${open}\nb\n`);
        git(['commit', '-q', '--no-verify', '-m', 'chore(fixture): seed with markers']);
        git(['rm', '-q', '--', 'gone.ts']);

        expect(runHook().status).toBe(0);
    });

    /** A rename stages the content under the new name, and the markers travel with it. */
    it('refuses a rename that carries markers to the new path', () => {
        stage('old.ts', `a\n${open}\nb\n`);
        git(['commit', '-q', '--no-verify', '-m', 'chore(fixture): seed with markers']);
        git(['mv', 'old.ts', 'renamed.ts']);

        const { status, stderr } = runHook();

        expect(status).toBe(1);
        expect(stderr).toMatch(/renamed\.ts:2:/);
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
