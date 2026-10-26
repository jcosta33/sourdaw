import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { shellPort, type ShellRunner } from '../deliverPullRequest';

function authorshipFixture() {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-landed-authorship-'));
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('GIT_')) delete env[key];
    }
    Object.assign(env, {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_TRACE2_EVENT: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
    });
    const git = (args: string[], input?: string) =>
        execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
            cwd: root,
            env,
            input,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    const commit = (name: string) => {
        writeFileSync(join(root, `${name}.txt`), `${name}\n`);
        git(['add', `${name}.txt`]);
        git(['commit', '--no-gpg-sign', '-m', name]);
        return git(['rev-parse', 'HEAD']);
    };
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
    const base = commit('B0');
    git(['checkout', '-b', 'feature']);
    const sources = ['P1', 'P2', 'P3'].map(commit);
    const head = git(['rev-parse', 'HEAD']);
    git(['checkout', 'main']);
    const unrelated = ['B1', 'B2', 'B3'].map(commit);
    for (const [index, sha] of unrelated.entries()) {
        git(['notes', '--ref=ai', 'add', '-m', `unrelated-${index}`, sha]);
    }
    const parent = git(['rev-parse', 'HEAD']);
    git(['merge', '--squash', 'feature']);
    git(['commit', '--no-gpg-sign', '-m', 'S']);
    const squash = git(['rev-parse', 'HEAD']);
    const invocations: Array<{ command: string; args: string[] }> = [];
    const shell: ShellRunner = {
        capture: (command, args) => {
            expect(command).toBe('git');
            return git(args);
        },
        run: (command, args) => {
            // Keep remote operations and the optional external rewrite out of this portable
            // adapter test. Real Git owns the graph and every parent/object observation.
            invocations.push({ command, args });
        },
    };
    const input = {
        mergeCommitSha: squash,
        headSha: head,
        // An old caller can still carry this structural extra field. It must never
        // become the rewrite destination, even when it is a valid available commit.
        baseSha: base,
        headRef: 'feature',
        baseRef: 'main',
    };
    return {
        root,
        git,
        commit,
        input,
        shell,
        invocations,
        sources,
        unrelated,
        parent,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

describe('landed authorship destination boundary', () => {
    it.each([false, true])(
        'uses the immutable squash parent with later main movement=%s',
        (advanceMain) => {
            const f = authorshipFixture();
            try {
                if (advanceMain) f.commit('B4');
                const before = f.unrelated.map((sha) => f.git(['notes', '--ref=ai', 'list', sha]));
                shellPort('jcosta33/sourdaw', f.shell).syncAuthorshipNotes?.(f.input);
                const rewrite = f.invocations.find(({ args }) => args[0] === 'ci');
                expect(rewrite).toBeDefined();
                if (rewrite === undefined) throw new Error('expected an authorship rewrite');
                const args = rewrite.args;
                const boundary = args[args.indexOf('--base-sha') + 1];
                expect(boundary).toBe(f.parent);
                expect(f.git(['rev-list', '--first-parent', `${boundary}..${f.input.mergeCommitSha}`])).toBe(
                    f.input.mergeCommitSha
                );
                expect(args).toEqual([
                    'ci',
                    'local',
                    'merge',
                    '--merge-commit-sha',
                    f.input.mergeCommitSha,
                    '--base-ref',
                    'main',
                    '--base-sha',
                    f.parent,
                    '--head-ref',
                    'feature',
                    '--head-sha',
                    f.input.headSha,
                    '--skip-fetch',
                    '--skip-push',
                ]);
                expect(f.invocations.at(-1)).toEqual({
                    command: 'git',
                    args: ['push', 'origin', 'refs/notes/ai:refs/notes/ai'],
                });
                expect(f.unrelated.map((sha) => f.git(['notes', '--ref=ai', 'list', sha]))).toEqual(before);
            } finally {
                f.cleanup();
            }
        },
        30_000
    );

    it('reads raw parent headers rather than a grafted or replaced topology', () => {
        const f = authorshipFixture();
        try {
            mkdirSync(join(f.root, '.git', 'info'), { recursive: true });
            writeFileSync(join(f.root, '.git', 'info', 'grafts'), `${f.input.mergeCommitSha} ${f.input.baseSha}\n`);
            f.git(['replace', f.input.mergeCommitSha, f.input.headSha]);
            shellPort('jcosta33/sourdaw', f.shell).syncAuthorshipNotes?.(f.input);
            const args = f.invocations.find(({ args }) => args[0] === 'ci')?.args ?? [];
            expect(args[args.indexOf('--base-sha') + 1]).toBe(f.parent);
        } finally {
            f.cleanup();
        }
    }, 30_000);

    it.each([
        'unavailable squash',
        'malformed squash',
        'noncommit squash',
        'tagged squash',
        'zero parents',
        'multiple parents',
        'unavailable parent',
        'noncommit parent',
        'malformed parent',
    ])(
        'warns and skips rewriting and notes upload for %s',
        (state) => {
            const f = authorshipFixture();
            const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const tree = f.git(['rev-parse', 'HEAD^{tree}']);
                let mergeCommitSha = f.input.mergeCommitSha;
                if (state === 'unavailable squash') mergeCommitSha = '0'.repeat(40);
                if (state === 'malformed squash') mergeCommitSha = 'invalid-squash';
                if (state === 'noncommit squash') mergeCommitSha = f.git(['hash-object', '-w', '--stdin'], 'blob\n');
                if (state === 'tagged squash') {
                    f.git(['-c', 'tag.gpgsign=false', 'tag', '-a', '-m', 'tag', 'not-squash', mergeCommitSha]);
                    mergeCommitSha = f.git(['rev-parse', 'refs/tags/not-squash']);
                }
                if (state === 'zero parents') mergeCommitSha = f.input.baseSha;
                if (state === 'multiple parents') {
                    mergeCommitSha = f.git(['commit-tree', tree, '-p', f.parent, '-p', f.input.headSha], 'M\n');
                }
                if (state === 'unavailable parent' || state === 'noncommit parent') {
                    const parent =
                        state === 'noncommit parent'
                            ? f.git(['hash-object', '-w', '--stdin'], 'not a commit\n')
                            : '1'.repeat(40);
                    mergeCommitSha = f.git(
                        ['hash-object', '-t', 'commit', '-w', '--stdin'],
                        `tree ${tree}\nparent ${parent}\nauthor Fixture <fixture@example.com> 1 +0000\ncommitter Fixture <fixture@example.com> 1 +0000\n\ninvalid parent\n`
                    );
                }
                const shell =
                    state === 'malformed parent'
                        ? {
                              ...f.shell,
                              capture: (_command: string, args: string[]) =>
                                  args[1] === '-t' ? 'commit' : `tree ${tree}\nparent invalid-parent\n\nmessage\n`,
                          }
                        : f.shell;
                expect(() =>
                    shellPort('jcosta33/sourdaw', shell).syncAuthorshipNotes?.({ ...f.input, mergeCommitSha })
                ).not.toThrow();
                expect(warnings).toHaveBeenCalledWith(
                    expect.stringMatching(/^warning: git-ai authorship sync skipped: /)
                );
                expect(f.invocations).toEqual([
                    {
                        command: 'git',
                        args: ['fetch', '--no-tags', 'https://github.com/jcosta33/sourdaw.git', '+main'],
                    },
                ]);
            } finally {
                warnings.mockRestore();
                f.cleanup();
            }
        },
        30_000
    );
});
