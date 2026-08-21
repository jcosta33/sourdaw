import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import { supersessionCommentBody } from '../prContract.ts';
import {
    parseWorktrees,
    removeLane,
    resolveLaneTarget,
    shellPort,
    type IssueComment,
    type LaneRemovalPort,
    type PullRequest,
    type ReplacementPullRequest,
    type ShellRunner,
    type Worktree,
} from '../removeLane';

const root = '/repo';
const target = '/repo/.agents/worktrees/feature';

function worktree(overrides: Partial<Worktree> = {}): Worktree {
    return {
        path: target,
        head: 'head',
        branch: 'feat/work',
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        ...overrides,
    };
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
        number: 42,
        state: 'MERGED',
        isDraft: false,
        headRefName: 'feat/work',
        headRefOid: 'head',
        headRepository: 'jcosta33/sourdaw',
        mergedAt: '2026-08-12T00:00:00Z',
        ...overrides,
    };
}

function supersessionReceipt(replacement = 99, overrides: Partial<IssueComment> = {}): IssueComment {
    return {
        body: supersessionCommentBody(replacement),
        authorLogin: AUTHOR_BOT_LOGIN,
        authorType: 'Bot',
        ...overrides,
    };
}

function supersededPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
    return pullRequest({ state: 'CLOSED', mergedAt: null, ...overrides });
}

type FakeInput = {
    lane?: Worktree;
    currentDirectory?: string;
    active?: boolean;
    alive?: boolean;
    dirty?: boolean;
    ignored?: string[];
    operation?: string;
    remoteHead?: string | null;
    pullRequests?: PullRequest[];
    comments?: IssueComment[];
    replacement?: Partial<ReplacementPullRequest>;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    let locked = input.lane?.locked ?? false;
    const lane = input.lane ?? worktree();
    const port: LaneRemovalPort = {
        fetch: () => calls.push('fetch'),
        repository: () => 'jcosta33/sourdaw',
        currentDirectory: () => input.currentDirectory ?? root,
        worktrees: () => [worktree({ path: root, branch: 'main' }), { ...lane, locked }],
        active: () => input.active ?? false,
        processAlive: () => input.alive ?? true,
        dirty: () => input.dirty ?? false,
        ignored: () => input.ignored ?? [],
        operation: () => input.operation,
        remoteHead: () => (input.remoteHead === null ? undefined : (input.remoteHead ?? 'head')),
        pullRequests: () => input.pullRequests ?? [pullRequest()],
        comments: (number) => {
            calls.push(`comments:${number}`);
            return input.comments ?? [];
        },
        replacement: (number) => {
            calls.push(`replacement:${number}`);
            return {
                number,
                state: 'MERGED',
                mergedAt: '2026-08-20T00:00:00Z',
                ...input.replacement,
            };
        },
        lock: (path) => {
            calls.push(`lock:${path}`);
            locked = true;
        },
        unlock: (path) => {
            calls.push(`unlock:${path}`);
            locked = false;
        },
        remove: (path) => calls.push(`remove:${path}`),
    };
    return { port, calls };
}

describe('lane removal', () => {
    it('removes a clean inactive lane after two stable reads', () => {
        const { port, calls } = fakePort();

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `lock:${target}`, `unlock:${target}`, `remove:${target}`]);
    });

    it('accepts a pruned remote branch when local and merged GitHub heads agree', () => {
        const { port, calls } = fakePort({ remoteHead: null });

        removeLane(target, port);

        expect(calls).toContain(`remove:${target}`);
    });

    it.each([
        ['primary', root, {}, /primary/],
        [
            'agent root',
            `${root}/.agents/worktrees`,
            { lane: worktree({ path: `${root}/.agents/worktrees` }) },
            /not an agent/,
        ],
        ['outside', '/tmp/feature', { lane: worktree({ path: '/tmp/feature' }) }, /not an agent worktree/],
        ['active', target, { currentDirectory: `${target}/scripts` }, /active worktree/],
        ['other process', target, { active: true }, /active in another process/],
        ['locked', target, { lane: worktree({ locked: true }) }, /locked or shared/],
        ['detached', target, { lane: worktree({ branch: undefined, detached: true }) }, /ownership is unknown/],
        ['dirty', target, { dirty: true }, /dirty/],
        ['ignored data', target, { ignored: ['.env'] }, /ignored data/],
        ['operation', target, { operation: 'rebase' }, /active rebase/],
        ['open PR', target, { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null })] }, /still active/],
        [
            'open draft PR',
            target,
            { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null, isDraft: true })] },
            /still active/,
        ],
        ['foreign repository', target, { pullRequests: [pullRequest({ headRepository: 'jcosta33/fork' })] }, /foreign/],
        ['reused branch', target, { pullRequests: [pullRequest(), pullRequest({ number: 43 })] }, /one pull request/],
        ['moved remote', target, { remoteHead: 'moved' }, /ownership is unproven/],
        [
            'merged PR with a mismatched head',
            target,
            { pullRequests: [pullRequest({ headRefOid: 'ahead' })] },
            /ownership is unproven/,
        ],
        [
            'superseded PR with a mismatched head',
            target,
            {
                remoteHead: null,
                pullRequests: [supersededPullRequest({ headRefOid: 'ahead' })],
                comments: [supersessionReceipt(99)],
            },
            /ownership is unproven/,
        ],
    ])('rejects a %s lane', (_case, path, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => removeLane(path, port)).toThrow(message);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
    });

    /**
     * `pr:supersede` closes the old pull request unmerged, so state alone reads the same as an
     * abandoned lane. The receipt it leaves is the only thing that separates them, and the lane
     * holds a share of the shared author lock until removal succeeds.
     */
    it('removes a superseded lane whose replacement merged', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest()],
            comments: [supersessionReceipt(99)],
        });

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(thrown, 'a superseded lane, and the share of the author lock it holds, stayed stranded').toBeUndefined();
        expect(calls).toContain('comments:42');
        expect(calls).toContain('replacement:99');
        expect(calls).toContain(`remove:${target}`);
    });

    /**
     * `supersessionReplacement` returns `undefined` for a comment that is not receipt-shaped, and
     * that entry must not still count toward the receipt total: one parsed receipt plus one
     * unrelated author-bot comment is one receipt, not two.
     */
    it('removes a superseded lane carrying one valid receipt alongside an unrelated author-bot comment', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest()],
            comments: [supersessionReceipt(99), supersessionReceipt(99, { body: 'Thanks for the update!' })],
        });

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(thrown, 'a valid receipt was outvoted by an unparsed comment').toBeUndefined();
        expect(calls).toContain(`remove:${target}`);
    });

    /**
     * The draft flag says nothing about whether the work landed. `pr:supersede` can close a draft
     * pull request against a genuinely merged replacement, and that lane must be removable through
     * the same receipt path a non-draft superseded lane uses.
     */
    it('removes a superseded draft carrying a valid receipt naming a merged replacement', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest({ isDraft: true })],
            comments: [supersessionReceipt(99)],
        });

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(
            thrown,
            'a superseded draft, and the share of the author lock it holds, stayed stranded'
        ).toBeUndefined();
        expect(calls).toContain(`remove:${target}`);
    });

    it.each([
        [
            'closed with no receipt at all',
            { pullRequests: [supersededPullRequest()], comments: [] },
            /closed without a supersession receipt/,
        ],
        [
            'closed draft with no receipt',
            { pullRequests: [supersededPullRequest({ isDraft: true })], comments: [] },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying an unrelated author-bot comment',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { body: 'Done' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying a receipt nobody trusted wrote',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { authorLogin: 'drive-by', authorType: 'User' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying a receipt from a different installed app',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { authorLogin: 'other-app[bot]' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying a receipt written by a human impersonating the bot login',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { authorType: 'User' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying two receipts that disagree',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99), supersessionReceipt(100)],
            },
            /closed without a supersession receipt/,
        ],
        [
            'superseded by a pull request that never merged',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99)],
                replacement: { state: 'CLOSED', mergedAt: null },
            },
            /superseded by #99, which is not merged/,
        ],
        [
            'superseded by a pull request whose merge is unrecorded',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99)],
                replacement: { state: 'MERGED', mergedAt: null },
            },
            /superseded by #99, which is not merged/,
        ],
        [
            'superseded by a different pull request than the one GitHub answered with',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99)],
                replacement: { number: 98 },
            },
            /superseded by #99, which is not merged/,
        ],
        [
            'closed naming itself as its own replacement',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(42)],
            },
            /names itself as its replacement/,
        ],
    ])('refuses to remove a lane %s', (_case, input, message) => {
        const { port, calls } = fakePort(input);

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(calls, 'a lane holding unmerged work was removed and the work discarded').not.toContainEqual(
            expect.stringMatching(/^remove:/)
        );
        expect(String(thrown)).toMatch(message);
    });

    /**
     * A supersession receipt says the work moved, not that the lane is finished. Everything a
     * merged lane must still prove — clean tree, idle, own head — has to hold on this path too.
     */
    it('holds a superseded lane to every other removal condition', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest()],
            comments: [supersessionReceipt(99)],
            dirty: true,
        });

        expect(() => removeLane(target, port)).toThrow(/dirty/);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
    });

    it('recovers only its own stale PID lock', () => {
        const { port, calls } = fakePort({
            lane: worktree({ locked: true, lockReason: 'lane-remove:2147483647' }),
            alive: false,
        });

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `unlock:${target}`, `lock:${target}`, `unlock:${target}`, `remove:${target}`]);
    });

    it('removes an author-locked lane without dropping the lock on failure', () => {
        const { port, calls } = fakePort({
            lane: worktree({ locked: true, lockReason: 'active:sourdaw-author' }),
            dirty: true,
        });

        expect(() => removeLane(target, port)).toThrow(/dirty/);
        expect(calls).toEqual(['fetch']);
        expect(calls.some((call) => call.startsWith('unlock:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
    });

    it('unlocks an author lock only after successful removal', () => {
        const { port, calls } = fakePort({
            lane: worktree({ locked: true, lockReason: 'active:sourdaw-author' }),
        });

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `unlock:${target}`, `remove:${target}`]);
    });
});

describe('lane path resolution', () => {
    it('resolves relative lane paths from the primary root', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-target-'));
        try {
            const lane = join(repository, '.agents/worktrees/feature');
            mkdirSync(lane, { recursive: true });
            expect(resolveLaneTarget('.agents/worktrees/feature', repository)).toBe(realpathSync(lane));
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe('worktree parser', () => {
    it('preserves locked, detached, and branch state from porcelain output', () => {
        const value = [
            'worktree /repo\0HEAD root\0branch refs/heads/main',
            'worktree /repo/.agents/worktrees/feature\0HEAD head\0detached\0locked shared',
        ].join('\0\0');

        expect(parseWorktrees(`${value}\0\0`)).toEqual([
            worktree({ path: root, head: 'root', branch: 'main' }),
            worktree({ branch: undefined, detached: true, locked: true, lockReason: 'shared' }),
        ]);
    });
});

describe('lane-removal shell boundary', () => {
    it('paginates exact-repository ownership and uses native lock and removal commands', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const runs: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
                if (command === 'lsof') {
                    return `p999\nfcwd\nn${target}`;
                }
                if (args.includes('nameWithOwner')) {
                    return 'jcosta33/sourdaw';
                }
                if (args.includes('--slurp')) {
                    return JSON.stringify([
                        [
                            {
                                number: 42,
                                state: 'closed',
                                draft: false,
                                head: {
                                    ref: 'feat/work',
                                    sha: 'head',
                                    repo: { full_name: 'jcosta33/sourdaw' },
                                },
                                merged_at: '2026-08-12T00:00:00Z',
                            },
                        ],
                    ]);
                }
                if (args[0] === 'for-each-ref') {
                    return '';
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: (command, args) => runs.push({ command, args }),
        };
        const port = shellPort(shell);

        expect(port.pullRequests('feat/work')).toEqual([pullRequest()]);
        expect(port.remoteHead('feat/work')).toBeUndefined();
        expect(port.active(target)).toBe(true);
        port.lock(target);
        port.unlock(target);
        port.remove(target);

        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
        expect(runs.map((entry) => entry.args.slice(0, 2))).toEqual([
            ['worktree', 'lock'],
            ['worktree', 'unlock'],
            ['worktree', 'remove'],
        ]);
        expect(runs.at(-1)).toEqual({ command: 'git', args: ['worktree', 'remove', target] });
    });

    it('reads the supersession receipt and the replacement from paginated GitHub state', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
                if (args.includes('nameWithOwner')) {
                    return 'jcosta33/sourdaw';
                }
                if (args.includes('repos/jcosta33/sourdaw/issues/42/comments?per_page=100')) {
                    return JSON.stringify([
                        [{ body: 'Superseded by #99.', user: { login: 'jcosta33-author[bot]', type: 'Bot' } }],
                        [{ body: 'drive by', user: null }],
                    ]);
                }
                if (args.includes('repos/jcosta33/sourdaw/pulls/99')) {
                    return JSON.stringify({ number: 99, state: 'closed', merged_at: '2026-08-20T00:00:00Z' });
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        const port = shellPort(shell);

        expect(port.comments(42)).toEqual([
            { body: 'Superseded by #99.', authorLogin: 'jcosta33-author[bot]', authorType: 'Bot' },
            { body: 'drive by', authorLogin: null, authorType: null },
        ]);
        // GitHub reports a merged pull request as `closed`; only `merged_at` says it landed.
        expect(port.replacement(99)).toEqual({ number: 99, state: 'MERGED', mergedAt: '2026-08-20T00:00:00Z' });
        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
    });

    it('preserves ignored data and removes disposable output in a real worktree', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-remove-'));
        const lane = join(repository, '.agents/worktrees/feature');
        const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(repository, '.gitignore'), 'node_modules/\n.env\n');
            writeFileSync(join(repository, 'tracked.txt'), 'fixture\n');
            git(['add', '.']);
            git(['commit', '-m', 'fixture']);
            mkdirSync(join(repository, '.agents/worktrees'), { recursive: true });
            git(['worktree', 'add', lane, '-b', 'feat/work']);
            const head = git(['rev-parse', 'HEAD'], lane);
            const resolvedLane = realpathSync(lane);
            const port: LaneRemovalPort = {
                fetch: () => undefined,
                repository: () => 'jcosta33/sourdaw',
                currentDirectory: () => repository,
                worktrees: () => parseWorktrees(git(['worktree', 'list', '--porcelain', '-z'])),
                active: () => false,
                processAlive: () => true,
                dirty: (path) => git(['status', '--porcelain=v1', '--untracked-files=all'], path) !== '',
                ignored: (path) =>
                    git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], path)
                        .split('\n')
                        .filter((candidate) => candidate !== ''),
                operation: () => undefined,
                remoteHead: () => undefined,
                pullRequests: () => [pullRequest({ headRefOid: head })],
                comments: () => [],
                replacement: (number) => ({ number, state: 'MERGED', mergedAt: '2026-08-20T00:00:00Z' }),
                lock: (path) => {
                    git(['worktree', 'lock', '--reason', 'test', path]);
                },
                unlock: (path) => {
                    git(['worktree', 'unlock', path]);
                },
                remove: (path) => {
                    git(['worktree', 'remove', path]);
                },
            };

            writeFileSync(join(lane, '.env'), 'SECRET=keep\n');
            expect(() => removeLane(resolvedLane, port)).toThrow(/ignored data: .env/);
            expect(existsSync(lane)).toBe(true);

            rmSync(join(lane, '.env'));
            mkdirSync(join(lane, 'node_modules'), { recursive: true });
            writeFileSync(join(lane, 'node_modules/cache'), 'generated\n');
            removeLane(resolvedLane, port);
            expect(existsSync(lane)).toBe(false);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});
