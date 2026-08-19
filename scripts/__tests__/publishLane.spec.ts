import { describe, expect, it } from 'vitest';

import { AUTHOR_LOCK_REASON } from '../githubAppIdentity.ts';
import {
    existingOpenPullRequestArgs,
    parsePublishLaneArgs,
    parsePublishWorktrees,
    publishLane,
    type PublishLanePort,
    type PublishWorktree,
} from '../publishLane.ts';

function worktree(overrides: Partial<PublishWorktree> = {}): PublishWorktree {
    return {
        path: '/repo/.agents/worktrees/agent-12-work',
        branch: 'agent/12/work',
        locked: true,
        lockReason: AUTHOR_LOCK_REASON,
        ...overrides,
    };
}

type FakeInput = {
    trees?: PublishWorktree[];
    ahead?: number;
    behind?: number;
    dirty?: boolean;
    subject?: string;
    headSha?: string;
    remoteSha?: string;
    ancestor?: boolean;
    existing?: number;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    let dirty = input.dirty ?? false;
    const port: PublishLanePort = {
        fetchMain: () => calls.push('fetch'),
        worktrees: () => input.trees ?? [worktree()],
        aheadBehind: () => ({ ahead: input.ahead ?? 1, behind: input.behind ?? 0 }),
        dirty: () => dirty,
        headSubject: () => input.subject ?? 'feat(vcs): add identities',
        headSha: () => input.headSha ?? 'abc',
        commitAll: (_lane, subject) => {
            calls.push(`commit:${subject}`);
            dirty = false;
        },
        remoteBranchSha: () => input.remoteSha,
        isAncestor: () => input.ancestor ?? true,
        push: (_lane, branch) => calls.push(`push:${branch}`),
        existingOpenPullRequest: () => input.existing,
        createPullRequest: ({ title, body, branch }) => {
            calls.push(`create:${branch}:${title}:${body.includes('Closes #12') ? 'closes' : 'missing'}`);
            return 88;
        },
        updatePullRequest: (number, { title }) => {
            calls.push(`edit:${number}:${title}`);
        },
        log: (message) => logs.push(message),
    };
    return { port, calls, logs };
}

describe('lane publish', () => {
    it('pushes without force, opens one PR, and prints the number', () => {
        const { port, calls, logs } = fakePort();

        expect(publishLane(12, port)).toBe(88);
        expect(calls.some((call) => call.includes('--force'))).toBe(false);
        expect(calls.some((call) => call.includes('merge --auto'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(true);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
        expect(logs.at(-1)).toBe('88');
    });

    it('updates an existing open pull request instead of opening a second', () => {
        const { port, calls } = fakePort({ existing: 41 });

        expect(publishLane(12, port)).toBe(41);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
        expect(calls).toContain('edit:41:feat(vcs): add identities');
    });

    it('commits leftover dirty files with the conventional HEAD subject', () => {
        const { port, calls } = fakePort({ dirty: true });

        publishLane(12, port);

        expect(calls).toContain('fetch');
        expect(calls).toContain('commit:feat(vcs): add identities');
        expect(calls).toContain('push:agent/12/work');
    });

    it('does not create an extra commit when the lane is already clean', () => {
        const { port, calls } = fakePort({ dirty: false });

        publishLane(12, port);

        expect(calls.some((call) => call.startsWith('commit:'))).toBe(false);
    });

    it('uses the HEAD subject as the pull-request title', () => {
        const { port, calls } = fakePort({ subject: 'feat(foo): bar' });

        publishLane(12, port);

        expect(calls.some((call) => call.includes('feat(foo): bar'))).toBe(true);
    });

    it.each([
        ['zero lanes', { trees: [] }],
        [
            'two lanes',
            { trees: [worktree(), worktree({ path: '/repo/.agents/worktrees/other', branch: 'agent/12/other' })] },
        ],
        ['zero ahead', { ahead: 0 }],
        ['behind', { behind: 1, ahead: 1 }],
        ['free-text subject', { subject: 'WIP' }],
        ['diverged remote', { remoteSha: 'other', ancestor: false }],
    ])('refuses %s', (_case, input) => {
        const { port, calls } = fakePort(input);

        expect(() => publishLane(12, port)).toThrow();
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('parses porcelain worktrees and argv', () => {
        const parsed = parsePublishWorktrees(
            'worktree /repo\0HEAD root\0branch refs/heads/main\0\0worktree /lane\0HEAD head\0branch refs/heads/agent/12/work\0locked active:sourdaw-author\0\0'
        );
        expect(parsed[1]).toEqual({
            path: '/lane',
            branch: 'agent/12/work',
            locked: true,
            lockReason: AUTHOR_LOCK_REASON,
        });
        expect(parsePublishLaneArgs(['12'])).toEqual({ issue: 12, help: false });
        expect(() => parsePublishLaneArgs([])).toThrow(/usage/);
    });

    it('lists same-repo pull requests by branch name, not owner:branch', () => {
        expect(existingOpenPullRequestArgs('agent/12/work')).toEqual([
            'pr',
            'list',
            '--repo',
            'jcosta33/sourdaw',
            '--head',
            'agent/12/work',
            '--state',
            'open',
            '--json',
            'number',
        ]);
        expect(existingOpenPullRequestArgs('agent/12/work').join(' ')).not.toContain('jcosta33:agent');
    });
});
