import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    parseWorktrees,
    removeLane,
    resolveLaneTarget,
    shellPort,
    type LaneRemovalPort,
    type PullRequest,
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
        ['foreign repository', target, { pullRequests: [pullRequest({ headRepository: 'jcosta33/fork' })] }, /foreign/],
        ['reused branch', target, { pullRequests: [pullRequest(), pullRequest({ number: 43 })] }, /one pull request/],
        ['moved remote', target, { remoteHead: 'moved' }, /ownership is unproven/],
    ])('rejects a %s lane', (_case, path, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => removeLane(path, port)).toThrow(message);
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
