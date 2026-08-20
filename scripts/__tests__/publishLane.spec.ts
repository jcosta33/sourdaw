import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AUTHOR_LOCK_REASON, resolvePrimaryRoot, type GhSession } from '../githubAppIdentity.ts';
import {
    existingOpenPullRequestArgs,
    issueExistsFromLookup,
    issueLookupArgs,
    parsePublishLaneArgs,
    parsePublishWorktrees,
    publishLane,
    resolveAuthorLane,
    shellPort,
    type PublishLanePort,
    type PublishWorktree,
} from '../publishLane.ts';

const PRIMARY_ROOT = '/repo';
const ISSUE_LANE = '/repo/.agents/worktrees/agent-12-work';
const CLEANUP_LANE = '/repo/.agents/worktrees/agent--cleanup';

function worktree(overrides: Partial<PublishWorktree> = {}): PublishWorktree {
    return {
        path: ISSUE_LANE,
        branch: 'agent/12/work',
        locked: true,
        lockReason: AUTHOR_LOCK_REASON,
        ...overrides,
    };
}

function otherAuthorLanes(): PublishWorktree[] {
    return [
        worktree({ path: '/repo/.agents/worktrees/agent-2237-proof', branch: 'agent/2237/proof' }),
        worktree({ path: '/repo/.agents/worktrees/agent-2241-titlebar', branch: 'agent/2241/titlebar' }),
        worktree({ path: '/repo/.agents/worktrees/agent--policy', branch: 'agent/policy' }),
        worktree({ path: '/repo/.agents/worktrees/agent--tracker', branch: 'agent/tracker' }),
    ];
}

type FakeInput = {
    trees?: PublishWorktree[];
    cwd?: string;
    ahead?: number;
    behind?: number;
    dirty?: boolean;
    subject?: string;
    headSha?: string;
    remoteSha?: string;
    ancestor?: boolean;
    existing?: number;
    existingBody?: unknown;
    issueExists?: boolean;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const bodies: string[] = [];
    let dirty = input.dirty ?? false;
    const port: PublishLanePort = {
        fetchMain: () => calls.push('fetch'),
        worktrees: () => input.trees ?? [worktree()],
        cwd: () => input.cwd ?? PRIMARY_ROOT,
        issueExists: (issue) => {
            calls.push(`issueExists:${issue}`);
            return input.issueExists ?? true;
        },
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
        existingOpenPullRequest: () =>
            input.existing === undefined
                ? undefined
                : {
                      number: input.existing,
                      body:
                          input.existingBody === undefined
                              ? '### 📌 Related tickets & additional notes\nCloses #12'
                              : input.existingBody,
                  },
        createPullRequest: ({ title, body, branch }) => {
            bodies.push(body);
            calls.push(`create:${branch}:${title}:${body.includes('Closes #12') ? 'closes' : 'missing'}`);
            return 88;
        },
        updatePullRequest: (number, { title, body }) => {
            bodies.push(body);
            calls.push(`edit:${number}:${title}`);
        },
        // Logging is ordered against the mutating calls, so it shares their ledger.
        log: (message) => {
            calls.push(`log:${message}`);
            logs.push(message);
        },
    };
    return { port, calls, logs, bodies };
}

const REFUSED_PUBLISH_CASES: Array<[string, FakeInput, RegExp]> = [
    ['zero lanes', { trees: [] }, /expected exactly one locked author lane for issue #12/],
    [
        'two lanes',
        { trees: [worktree(), worktree({ path: '/repo/.agents/worktrees/other', branch: 'agent/12/other' })] },
        /expected exactly one locked author lane for issue #12/,
    ],
    ['zero ahead', { ahead: 0 }, /lane must be strictly ahead of origin\/main/],
    ['behind', { behind: 1, ahead: 1 }, /lane must be strictly ahead of origin\/main/],
    ['free-text subject', { subject: 'WIP' }, /pull-request title is not conventional/],
    ['diverged remote', { remoteSha: 'other', ancestor: false }, /refusing non-fast-forward push of agent\/12\/work/],
];

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

    it('names the resolved lane before it commits, pushes or opens a pull request', () => {
        const { port, calls } = fakePort({ dirty: true });

        publishLane(12, port);

        const receipt = calls.indexOf(`log:publishing ${ISSUE_LANE} on agent/12/work`);
        expect(receipt).toBeGreaterThanOrEqual(0);
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('commit:')));
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('push:')));
        expect(receipt).toBeLessThan(calls.findIndex((call) => call.startsWith('create:')));
    });

    it('writes Closes #<issue> into the body when an issue is given', () => {
        const { port, bodies } = fakePort();

        publishLane(12, port);

        expect(bodies.at(-1)).toContain('Closes #12');
    });

    it('takes Closes #<issue> from the lane branch when no issue argument is given', () => {
        const { port, calls, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: `${ISSUE_LANE}/scripts`,
        });

        expect(publishLane(undefined, port)).toBe(88);
        expect(calls).toContain('push:agent/12/work');
        expect(bodies.at(-1)).toContain('Closes #12');
    });

    it('references a campaign issue without closing it', () => {
        const { port, bodies } = fakePort();

        publishLane(12, port, 'relates');

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('takes the related issue from the lane branch', () => {
        const { port, bodies } = fakePort({
            trees: [...otherAuthorLanes(), worktree()],
            cwd: `${ISSUE_LANE}/scripts`,
        });

        publishLane(undefined, port, 'relates');

        expect(bodies.at(-1)).toContain('Related #12');
    });

    it('preserves Related on a later flagless update', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: '### 📌 Related tickets & additional notes\nRelated #12',
        });

        publishLane(12, port);

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('changes a valid existing relationship only when requested', () => {
        const { port, bodies } = fakePort({
            existing: 41,
            existingBody: '### 📌 Related tickets & additional notes\nCloses #12',
        });

        publishLane(12, port, 'relates');

        expect(bodies.at(-1)).toContain('Related #12');
        expect(bodies.at(-1)).not.toContain('Closes #12');
    });

    it('validates existing state before an explicit relationship change', () => {
        const { port, calls } = fakePort({ existing: 41, existingBody: 'None.' });

        expect(() => publishLane(12, port, 'relates')).toThrow(/Related tickets/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('validates existing state before a flagless update', () => {
        const { port, calls } = fakePort({ existing: 41, existingBody: null });

        expect(() => publishLane(12, port)).toThrow(/body is unreadable/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('rejects mixed None and issue relationships before mutation', () => {
        const { port, calls } = fakePort({
            existing: 41,
            existingBody: '### 📌 Related tickets & additional notes\nNone.\nCloses #12',
        });

        expect(() => publishLane(12, port)).toThrow(/exactly one relationship/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('validates an existing issueless pull request', () => {
        const { port, calls } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
            existing: 41,
            existingBody: '### 📌 Related tickets & additional notes\nCloses #12',
        });

        expect(() => publishLane(undefined, port)).toThrow(/issueless pull-request body/);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
    });

    it('rejects --relates on an issueless lane', () => {
        const { port } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
        });

        expect(() => publishLane(undefined, port, 'relates')).toThrow(/requires an issue lane/);
    });

    it('publishes the lane it is standing in even when other author lanes exist', () => {
        const { port, calls, bodies, logs } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: CLEANUP_LANE,
        });

        expect(publishLane(undefined, port)).toBe(88);
        expect(calls).toContain('push:agent/cleanup');
        expect(calls.some((call) => call.startsWith('issueExists:'))).toBe(false);
        expect(bodies.at(-1)).not.toContain('Closes #');
        expect(bodies.at(-1)).toContain('### 📌 Related tickets & additional notes\nNone.');
        expect(logs.at(-1)).toBe('88');
    });

    it('resolves the lane from a nested subdirectory of the lane', () => {
        const { port, calls } = fakePort({
            trees: [...otherAuthorLanes(), worktree({ path: CLEANUP_LANE, branch: 'agent/cleanup' })],
            cwd: `${CLEANUP_LANE}/scripts/__tests__`,
        });

        expect(publishLane(undefined, port)).toBe(88);
        expect(calls).toContain('push:agent/cleanup');
    });

    it('never matches a lane whose path is only a string prefix of the cwd', () => {
        const foo = worktree({ path: '/repo/.agents/worktrees/agent--foo', branch: 'agent/foo' });
        const fooTwo = worktree({ path: '/repo/.agents/worktrees/agent--foo-2', branch: 'agent/foo-2' });

        expect(resolveAuthorLane(undefined, [foo, fooTwo], '/repo/.agents/worktrees/agent--foo-2')).toEqual({
            path: '/repo/.agents/worktrees/agent--foo-2',
            branch: 'agent/foo-2',
        });
        expect(() => resolveAuthorLane(undefined, [foo], '/repo/.agents/worktrees/agent--foo-2')).toThrow(
            /not inside a locked author lane/
        );
    });

    it('picks the innermost lane when one author lane is nested inside another', () => {
        const outer = worktree({ path: '/repo/.agents/worktrees/agent--foo', branch: 'agent/foo' });
        const inner = worktree({ path: '/repo/.agents/worktrees/agent--foo/inner', branch: 'agent/inner' });

        expect(resolveAuthorLane(undefined, [outer, inner], '/repo/.agents/worktrees/agent--foo/inner/src')).toEqual({
            path: '/repo/.agents/worktrees/agent--foo/inner',
            branch: 'agent/inner',
        });
    });

    it('measures lane depth on the canonical paths, not the recorded spellings', () => {
        const resolver = (path: string) => (path === '/w' || path.startsWith('/w/') ? `/private${path}` : path);
        const outer = worktree({ path: '/private/w/a', branch: 'agent/outer' });
        const inner = worktree({ path: '/w/a/i', branch: 'agent/inner' });

        expect(resolveAuthorLane(undefined, [outer, inner], '/w/a/i/src', resolver)).toEqual({
            path: '/w/a/i',
            branch: 'agent/inner',
        });
    });

    it.each([
        ['there is no locked author lane at all', [] as PublishWorktree[], PRIMARY_ROOT],
        ['the cwd is the primary root', otherAuthorLanes(), PRIMARY_ROOT],
        ['the cwd is outside every lane', otherAuthorLanes(), '/elsewhere/checkout'],
        [
            'the cwd is inside a worktree locked by someone else',
            [
                ...otherAuthorLanes(),
                worktree({
                    path: '/repo/.agents/worktrees/collab-sync-state',
                    branch: 'collab/sync',
                    lockReason: 'active:collab-lane-3',
                }),
            ],
            '/repo/.agents/worktrees/collab-sync-state',
        ],
        [
            'the cwd is inside an unlocked worktree',
            [
                ...otherAuthorLanes(),
                worktree({
                    path: '/repo/.agents/worktrees/scratch',
                    branch: 'scratch',
                    locked: false,
                    lockReason: undefined,
                }),
            ],
            '/repo/.agents/worktrees/scratch',
        ],
        [
            'the cwd is inside an author-locked worktree whose branch is not a lane',
            [...otherAuthorLanes(), worktree({ path: '/repo/release-1-2', branch: 'release/1.2' })],
            '/repo/release-1-2',
        ],
    ])('refuses to publish without an issue when %s', (_case, trees, cwd) => {
        const { port, calls } = fakePort({ trees, cwd });

        expect(() => publishLane(undefined, port)).toThrow(
            /not inside a locked author lane: run pnpm lane:publish from inside the lane, or pass the issue number/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('resolves symlinked paths on both sides before comparing', () => {
        const resolver = (path: string) => (path.startsWith('/var/') ? `/private${path}` : path);
        const trees = [
            worktree({ path: '/var/lanes/agent--cleanup', branch: 'agent/cleanup' }),
            worktree({ path: '/private/var/lanes/agent--other', branch: 'agent/other' }),
        ];

        expect(resolveAuthorLane(undefined, trees, '/var/lanes/agent--cleanup/scripts', resolver)).toEqual({
            path: '/var/lanes/agent--cleanup',
            branch: 'agent/cleanup',
        });
        expect(resolveAuthorLane(undefined, trees, '/private/var/lanes/agent--cleanup', resolver)).toEqual({
            path: '/var/lanes/agent--cleanup',
            branch: 'agent/cleanup',
        });
    });

    it('makes a relative lane path absolute before resolving symlinks', () => {
        const laneAbsolute = resolve('lanes/agent--relative');
        const resolver = (path: string) => (path === laneAbsolute ? `${laneAbsolute}-real` : path);
        const trees = [worktree({ path: 'lanes/agent--relative', branch: 'agent/relative' })];

        expect(resolveAuthorLane(undefined, trees, `${laneAbsolute}-real/src`, resolver)).toEqual({
            path: 'lanes/agent--relative',
            branch: 'agent/relative',
        });
    });

    it('resolves a supplied issue by branch prefix without consulting the cwd', () => {
        const trees = [...otherAuthorLanes(), worktree()];

        expect(resolveAuthorLane(12, trees, PRIMARY_ROOT)).toEqual({
            path: ISSUE_LANE,
            branch: 'agent/12/work',
        });
        expect(resolveAuthorLane(12, trees, '/elsewhere/checkout')).toEqual({
            path: ISSUE_LANE,
            branch: 'agent/12/work',
        });
        expect(() =>
            resolveAuthorLane(2237, [...trees, worktree({ branch: 'agent/2237/second' })], PRIMARY_ROOT)
        ).toThrow(/expected exactly one locked author lane for issue #2237/);
    });

    it('refuses a supplied issue that does not exist and touches nothing first', () => {
        const { port, calls } = fakePort({ issueExists: false, dirty: true });

        expect(() => publishLane(12, port)).toThrow(/issue #12 does not exist in jcosta33\/sourdaw/);
        expect(calls).toContain('issueExists:12');
        expect(calls.some((call) => call.startsWith('commit:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('reads issue existence from the gh api exit status, not from stdout alone', () => {
        expect(issueLookupArgs(12)).toEqual([
            'api',
            'repos/jcosta33/sourdaw/issues/12',
            '--jq',
            '{number: .number, isPullRequest: (has("pull_request"))}',
        ]);
        const found = issueExistsFromLookup(12, {
            status: 0,
            stdout: '{"number":12,"isPullRequest":false}\n',
            stderr: '',
        });
        expect(found).toBe(true);
        expect(issueExistsFromLookup(12, { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })).toBe(false);
        expect(() =>
            issueExistsFromLookup(12, { status: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' })
        ).toThrow(/Bad credentials/);
    });

    it('refuses a pull-request number, which the issues endpoint resolves just as happily', () => {
        expect(() =>
            issueExistsFromLookup(2254, { status: 0, stdout: '{"number":2254,"isPullRequest":true}\n', stderr: '' })
        ).toThrow(/#2254 in jcosta33\/sourdaw is a pull request, not an issue/);
    });

    it('uses the HEAD subject as the pull-request title', () => {
        const { port, calls } = fakePort({ subject: 'feat(foo): bar' });

        publishLane(12, port);

        expect(calls.some((call) => call.includes('feat(foo): bar'))).toBe(true);
    });

    it.each(REFUSED_PUBLISH_CASES)('refuses %s', (_case, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => publishLane(12, port)).toThrow(message);
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
        expect(parsePublishLaneArgs(['12', '--relates'])).toEqual({ issue: 12, relationship: 'relates', help: false });
        expect(parsePublishLaneArgs(['--relates'])).toEqual({ relationship: 'relates', help: false });
        expect(parsePublishLaneArgs([])).toEqual({ help: false });
        expect(parsePublishLaneArgs(['--help'])).toEqual({ help: true });
        expect(() => parsePublishLaneArgs(['12', '13'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['--relates', '--relates'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['beat'])).toThrow(/usage/);
    });

    it('carries the process cwd into the port, which is the whole issueless resolution path', () => {
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };
        const here = dirname(fileURLToPath(import.meta.url));

        expect(here).not.toBe(resolvePrimaryRoot(undefined, here));
        expect(shellPort(session, here).cwd()).toBe(here);
        expect(shellPort(session).cwd()).toBe(process.cwd());
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
            'number,body',
        ]);
        expect(existingOpenPullRequestArgs('agent/12/work').join(' ')).not.toContain('jcosta33:agent');
    });
});
