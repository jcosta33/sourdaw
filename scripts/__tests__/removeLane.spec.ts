import { describe, expect, it } from 'vitest';

import {
    parseWorktrees,
    removeLane,
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
        headRepositoryOwner: { login: 'jcosta33' },
        mergedAt: '2026-08-12T00:00:00Z',
        ...overrides,
    };
}

type FakeInput = {
    lane?: Worktree;
    currentDirectory?: string;
    dirty?: boolean;
    operation?: string;
    remoteHead?: string;
    pullRequests?: PullRequest[];
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const port: LaneRemovalPort = {
        fetch: () => calls.push('fetch'),
        repository: () => 'jcosta33/sourdaw',
        currentDirectory: () => input.currentDirectory ?? root,
        worktrees: () => [worktree({ path: root, branch: 'main' }), input.lane ?? worktree()],
        dirty: () => input.dirty ?? false,
        operation: () => input.operation,
        remoteHead: () => input.remoteHead ?? 'head',
        pullRequests: () => input.pullRequests ?? [pullRequest()],
        remove: (path) => calls.push(`remove:${path}`),
    };
    return { port, calls };
}

describe('lane removal', () => {
    it('removes a clean inactive lane with matching Git and GitHub ownership', () => {
        const { port, calls } = fakePort();

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `remove:${target}`]);
    });

    it.each([
        ['primary', root, {}, /primary/],
        ['outside', '/tmp/feature', { lane: worktree({ path: '/tmp/feature' }) }, /not an agent worktree/],
        ['active', target, { currentDirectory: `${target}/scripts` }, /active worktree/],
        ['locked', target, { lane: worktree({ locked: true }) }, /locked or shared/],
        ['detached', target, { lane: worktree({ branch: undefined, detached: true }) }, /ownership is unknown/],
        ['dirty', target, { dirty: true }, /dirty/],
        ['operation', target, { operation: 'rebase' }, /active rebase/],
        ['open PR', target, { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null })] }, /still active/],
        ['foreign PR', target, { pullRequests: [pullRequest({ headRepositoryOwner: { login: 'other' } })] }, /foreign/],
        ['reused branch', target, { pullRequests: [pullRequest(), pullRequest({ number: 43 })] }, /one pull request/],
        ['moved remote', target, { remoteHead: 'moved' }, /ownership is unproven/],
    ])('rejects a %s lane', (_case, path, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => removeLane(path, port)).toThrow(message);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
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
            worktree({ branch: undefined, detached: true, locked: true }),
        ]);
    });
});

describe('lane-removal shell boundary', () => {
    it('paginates ownership reads and removes without force or branch deletion', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const runs: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
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
                                    repo: { owner: { login: 'jcosta33' } },
                                },
                                merged_at: '2026-08-12T00:00:00Z',
                            },
                        ],
                    ]);
                }
                if (args.includes('--verify')) {
                    return 'head';
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: (command, args) => runs.push({ command, args }),
        };
        const port = shellPort(shell);

        expect(port.pullRequests('feat/work')).toEqual([pullRequest()]);
        expect(port.remoteHead('feat/work')).toBe('head');
        port.remove(target);

        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
        expect(runs).toContainEqual({ command: 'git', args: ['worktree', 'remove', target] });
    });
});
