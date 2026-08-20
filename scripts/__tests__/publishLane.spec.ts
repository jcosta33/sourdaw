import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AUTHOR_LOCK_REASON, resolvePrimaryRoot, type GhSession } from '../githubAppIdentity.ts';
import {
    existingOpenPullRequestArgs,
    issueExistsFromLookup,
    issueLookupArgs,
    laneIssueNumber,
    matchingOpenPullRequestNumber,
    parsePublishLaneArgs,
    parsePublishWorktrees,
    publishLane,
    resolveAuthorLane,
    shellPort,
    type OpenPullRequestRow,
    type PublishLanePort,
    type PublishWorktree,
} from '../publishLane.ts';

const PRIMARY_ROOT = '/repo';
const ISSUE_LANE = '/repo/.agents/worktrees/agent-12-work';
const CLEANUP_LANE = '/repo/.agents/worktrees/agent--cleanup';
const LEGACY_LANE = '/repo/.agents/worktrees/collab-sync-state';
const LEGACY_BRANCH = 'fix/collab-sync-state-2039';

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
    existingByCall?: Array<number | undefined>;
    issueExists?: boolean;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const bodies: string[] = [];
    let dirty = input.dirty ?? false;
    let pullRequestQueries = 0;
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
        // The queried branch is the entire authorization decision on the legacy path, so it goes
        // into the ledger: a fake that discarded it would stay green if resolution asked about a
        // sibling lane's branch, or a constant.
        existingOpenPullRequest: (branch) => {
            const query = pullRequestQueries++;
            calls.push(`pr:${branch}`);
            return input.existingByCall === undefined ? input.existing : input.existingByCall[query];
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

/**
 * The whole text of a refusal, so a test can assert what it must *not* say. `toThrow` can only
 * assert presence, and the defect these tests pin is an extra sentence, not a missing one.
 */
function refusalMessage(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected a refusal, but resolution succeeded');
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
            legacy: false,
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
            legacy: false,
        });
    });

    it('measures lane depth on the canonical paths, not the recorded spellings', () => {
        const resolver = (path: string) => (path === '/w' || path.startsWith('/w/') ? `/private${path}` : path);
        const outer = worktree({ path: '/private/w/a', branch: 'agent/outer' });
        const inner = worktree({ path: '/w/a/i', branch: 'agent/inner' });

        expect(resolveAuthorLane(undefined, [outer, inner], '/w/a/i/src', resolver)).toEqual({
            path: '/w/a/i',
            branch: 'agent/inner',
            legacy: false,
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
    ])('refuses to publish without an issue when %s', (_case, trees, cwd) => {
        const { port, calls } = fakePort({ trees, cwd });

        expect(() => publishLane(undefined, port)).toThrow(
            /not inside a locked author lane: run pnpm lane:publish from inside the lane, or pass the issue number/
        );
        expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
    });

    it('refuses an author-locked, off-convention branch with no open pull request, naming the branch', () => {
        // Correctly locked (AUTHOR_LOCK_REASON) but off-convention, e.g. a hand-locked release
        // branch or a not-yet-published legacy lane: proves the lock alone is not enough, the open
        // pull request is the actual gate.
        const trees = [...otherAuthorLanes(), worktree({ path: '/repo/release-1-2', branch: 'release/1.2' })];

        expect(() => resolveAuthorLane(undefined, trees, '/repo/release-1-2')).toThrow(/release\/1\.2/);
        expect(() => resolveAuthorLane(undefined, trees, '/repo/release-1-2')).toThrow(/no open pull request/);
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
            legacy: false,
        });
        expect(resolveAuthorLane(undefined, trees, '/private/var/lanes/agent--cleanup', resolver)).toEqual({
            path: '/var/lanes/agent--cleanup',
            branch: 'agent/cleanup',
            legacy: false,
        });
    });

    it('makes a relative lane path absolute before resolving symlinks', () => {
        const laneAbsolute = resolve('lanes/agent--relative');
        const resolver = (path: string) => (path === laneAbsolute ? `${laneAbsolute}-real` : path);
        const trees = [worktree({ path: 'lanes/agent--relative', branch: 'agent/relative' })];

        expect(resolveAuthorLane(undefined, trees, `${laneAbsolute}-real/src`, resolver)).toEqual({
            path: 'lanes/agent--relative',
            branch: 'agent/relative',
            legacy: false,
        });
    });

    it('resolves a supplied issue by branch prefix without consulting the cwd', () => {
        const trees = [...otherAuthorLanes(), worktree()];

        expect(resolveAuthorLane(12, trees, PRIMARY_ROOT)).toEqual({
            path: ISSUE_LANE,
            branch: 'agent/12/work',
            legacy: false,
        });
        expect(resolveAuthorLane(12, trees, '/elsewhere/checkout')).toEqual({
            path: ISSUE_LANE,
            branch: 'agent/12/work',
            legacy: false,
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
        expect(parsePublishLaneArgs([])).toEqual({ help: false });
        expect(parsePublishLaneArgs(['--help'])).toEqual({ help: true });
        expect(() => parsePublishLaneArgs(['12', '13'])).toThrow(/usage/);
        expect(() => parsePublishLaneArgs(['beat'])).toThrow(/usage/);
    });

    it('carries the process cwd into the port, which is the whole issueless resolution path', () => {
        const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };
        const here = dirname(fileURLToPath(import.meta.url));

        expect(here).not.toBe(resolvePrimaryRoot(undefined, here));
        expect(shellPort(session, here).cwd()).toBe(here);
        expect(shellPort(session).cwd()).toBe(process.cwd());
    });

    it('requests headRefName and isCrossRepository so the match can be proven client-side', () => {
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
            'number,headRefName,isCrossRepository',
        ]);
        expect(existingOpenPullRequestArgs('agent/12/work').join(' ')).not.toContain('jcosta33:agent');
    });

    describe('matchingOpenPullRequestNumber', () => {
        function row(overrides: Partial<OpenPullRequestRow> = {}): OpenPullRequestRow {
            return { number: 41, headRefName: 'agent/12/work', isCrossRepository: false, ...overrides };
        }

        it('accepts an exact same-repo head match', () => {
            expect(matchingOpenPullRequestNumber([row()], 'agent/12/work')).toBe(41);
        });

        it('rejects a longer branch name that merely starts with the queried one', () => {
            // Neither `--head` nor `gh`'s matching is documented as exact vs. prefix; the gate must
            // not depend on that. A pull request open on `agent/12/work-extra` must never authorize
            // a push targeting `agent/12/work`.
            expect(
                matchingOpenPullRequestNumber([row({ headRefName: 'agent/12/work-extra' })], 'agent/12/work')
            ).toBeUndefined();
        });

        it('rejects a cross-repository pull request with the identical head name', () => {
            // `--repo` scopes the base repository, not the head repository, so a fork can open a
            // pull request whose head branch happens to share the exact same name.
            expect(matchingOpenPullRequestNumber([row({ isCrossRepository: true })], 'agent/12/work')).toBeUndefined();
        });

        it('still refuses more than one matching open pull request', () => {
            expect(() => matchingOpenPullRequestNumber([row(), row({ number: 42 })], 'agent/12/work')).toThrow(
                /agent\/12\/work has more than one open pull request/
            );
        });
    });

    describe('legacy, pre-agent/ lanes', () => {
        function legacyWorktree(overrides: Partial<PublishWorktree> = {}): PublishWorktree {
            return {
                path: LEGACY_LANE,
                branch: LEGACY_BRANCH,
                locked: true,
                lockReason: AUTHOR_LOCK_REASON,
                ...overrides,
            };
        }

        it('never resolves a legacy candidate by issue argument, even fully qualified', () => {
            // The candidate here is exactly what an unmodified legacy fallback would accept: correct
            // lock, an open pull request. Nothing in the branch ties it to issue 2039 specifically —
            // `laneIssueNumber` requires the `agent/` prefix this branch doesn't have — so resolving
            // it here would let `pnpm lane:publish <any real issue>` push an unrelated stranded lane
            // and stamp `Closes #<that issue>` on its pull request. This is the test that goes red if
            // the legacy fallback is reinstated in the issue-argument branch.
            const trees = [...otherAuthorLanes(), legacyWorktree()];

            expect(() => resolveAuthorLane(2039, trees, PRIMARY_ROOT, undefined, () => true)).toThrow(
                /expected exactly one locked author lane for issue #2039/
            );
        });

        it('resolves an off-convention branch with an open pull request, from inside the lane', () => {
            const trees = [...otherAuthorLanes(), legacyWorktree()];

            expect(resolveAuthorLane(undefined, trees, `${LEGACY_LANE}/src`, undefined, () => true)).toEqual({
                path: LEGACY_LANE,
                branch: LEGACY_BRANCH,
                legacy: true,
            });
        });

        it('refuses an off-convention branch with no open pull request, naming the branch as the reason', () => {
            const trees = [...otherAuthorLanes(), legacyWorktree()];

            expect(() => resolveAuthorLane(undefined, trees, LEGACY_LANE, undefined, () => false)).toThrow(
                new RegExp(`${LEGACY_BRANCH.replace('/', '\\/')}.*no open pull request`)
            );
        });

        it('refuses a lock that names another owner without telling the caller how to take it', () => {
            // The lock reason is the only ownership signal this gate has, so an unrecognized
            // `active:<someone>` is an owner, not a lane that forgot to migrate. Printing the
            // unlock/relock pair here is a recipe: run the two commands and the next invocation
            // resolves, commits, pushes, and rewrites that owner's pull request.
            const trees = [...otherAuthorLanes(), legacyWorktree({ lockReason: 'active:principal' })];
            const message = refusalMessage(() =>
                resolveAuthorLane(undefined, trees, LEGACY_LANE, undefined, () => true)
            );

            expect(message).toContain('active:principal');
            expect(message).toContain(`only ${AUTHOR_LOCK_REASON} may publish`);
            expect(message).not.toContain('git worktree unlock');
            expect(message).not.toContain('git worktree lock');
        });

        it('offers the lock migration only for a lock that names nobody', () => {
            const remedy = new RegExp(
                `git worktree unlock ${LEGACY_LANE} && git worktree lock --reason ${AUTHOR_LOCK_REASON} ${LEGACY_LANE}`
            );
            const unowned = (lockReason: string | undefined) => [...otherAuthorLanes(), legacyWorktree({ lockReason })];

            expect(
                refusalMessage(() =>
                    resolveAuthorLane(undefined, unowned(undefined), LEGACY_LANE, undefined, () => true)
                )
            ).toMatch(remedy);
            // `lane-remove:<pid>` is `removeLane`'s own marker: it records a removal, not an owner.
            expect(
                refusalMessage(() =>
                    resolveAuthorLane(undefined, unowned('lane-remove:2147483647'), LEGACY_LANE, undefined, () => true)
                )
            ).toMatch(remedy);
        });

        it('does not treat a foreign lock on an off-convention branch as a legacy candidate at all', () => {
            // A collaboration-session lock is not "not yet migrated" — it was never an author lane.
            // Without a proven open pull request it must fall through to the ordinary refusal, not
            // a legacy-specific one that would wrongly invite relocking someone else's worktree.
            const trees = [
                ...otherAuthorLanes(),
                legacyWorktree({ lockReason: 'active:collab-lane-3', branch: 'collab/sync' }),
            ];

            expect(() => resolveAuthorLane(undefined, trees, LEGACY_LANE, undefined, () => false)).toThrow(
                /not inside a locked author lane: run pnpm lane:publish from inside the lane, or pass the issue number/
            );
        });

        it('parses no issue number out of a legacy branch whose slug happens to end in digits', () => {
            expect(laneIssueNumber(LEGACY_BRANCH)).toBeUndefined();
            expect(laneIssueNumber('fix/proof-metering-bs1770-2039')).toBeUndefined();
            expect(laneIssueNumber('fix/arrangement-satellite-paths-2039')).toBeUndefined();
        });

        it('falls through to a valid enclosing conforming lane when a deeper legacy candidate refuses', () => {
            // The legacy candidate is nested inside the conforming lane and is the deepest enclosing
            // candidate, so it is tried first. Its lock is wrong (`active:collab-lane-9`, not
            // AUTHOR_LOCK_REASON) and it does have an open pull request, so `resolveLegacyCandidate`
            // refuses it as someone else's worktree. That refusal is the deepest candidate's, not
            // the operator's: the loop must record it and fall through to the shallower conforming
            // lane the operator is actually standing in.
            const outer = worktree({ path: '/repo/.agents/worktrees/agent--outer', branch: 'agent/outer' });
            const nestedLegacy = worktree({
                path: '/repo/.agents/worktrees/agent--outer/legacy-nested',
                branch: 'fix/legacy-nested',
                lockReason: 'active:collab-lane-9',
            });

            expect(
                resolveAuthorLane(
                    undefined,
                    [outer, nestedLegacy],
                    '/repo/.agents/worktrees/agent--outer/legacy-nested/src',
                    undefined,
                    () => true
                )
            ).toEqual({ path: '/repo/.agents/worktrees/agent--outer', branch: 'agent/outer', legacy: false });
        });

        it.each([
            ['the token is rejected', 'gh: Bad credentials (HTTP 401)'],
            [
                'the branch has more than one open pull request',
                'branch fix/legacy-nested has more than one open pull request',
            ],
        ])('propagates a pull-request lookup that failed when %s', (_case, failure) => {
            // A throw out of `hasOpenPullRequest` means "could not find out", never "this candidate
            // does not apply". Only `resolveLegacyCandidate`'s own two refusals mean the latter, so
            // an unknown must stop resolution instead of falling through to a shallower lane and
            // pushing it.
            const outer = worktree({ path: '/repo/.agents/worktrees/agent--outer', branch: 'agent/outer' });
            const nestedLegacy = worktree({
                path: '/repo/.agents/worktrees/agent--outer/legacy-nested',
                branch: 'fix/legacy-nested',
            });

            expect(() =>
                resolveAuthorLane(
                    undefined,
                    [outer, nestedLegacy],
                    '/repo/.agents/worktrees/agent--outer/legacy-nested/src',
                    undefined,
                    () => {
                        throw new Error(failure);
                    }
                )
            ).toThrow(failure);
        });

        it('publishes a legacy lane by pushing only, leaving its pull request exactly as written', () => {
            // `lane:publish` did not author this pull request and cannot reproduce it:
            // `laneIssueNumber` reads only the `agent/<issue>/` shape, so recomposing the body would
            // replace a hand-written `Closes #2039` with `None.` and stop the merge closing the
            // issue. The push is the whole deliverable.
            const { port, calls, bodies } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            expect(publishLane(undefined, port)).toBe(2275);
            expect(calls).toContain(`push:${LEGACY_BRANCH}`);
            expect(calls.some((call) => call.startsWith('edit:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
            expect(bodies).toEqual([]);
        });

        it('asks about the legacy lane own branch, both when authorizing and after the push', () => {
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existing: 2275,
            });

            publishLane(undefined, port);

            expect(calls.filter((call) => call.startsWith('pr:'))).toEqual([
                `pr:${LEGACY_BRANCH}`,
                `pr:${LEGACY_BRANCH}`,
            ]);
        });

        it('refuses when the pull request that authorized the legacy push is gone by the time it lands', () => {
            // Resolution and the post-push lookup are two separate queries. If the pull request
            // closed in between there is nothing to update and nothing this script may author, so
            // it must refuse rather than open a replacement carrying a regenerated body.
            const { port, calls } = fakePort({
                trees: [...otherAuthorLanes(), legacyWorktree()],
                cwd: LEGACY_LANE,
                existingByCall: [2275, undefined],
            });

            expect(() => publishLane(undefined, port)).toThrow(/no longer has an open pull request/);
            expect(calls.some((call) => call.startsWith('create:'))).toBe(false);
        });
    });
});
