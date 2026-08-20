import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    deliverPullRequest as deliverPullRequestWithTracker,
    parseCliArgs,
    shellPort,
    type DeliveryPort,
    type PullRequestSnapshot,
    type ReviewState,
    type ShellRunner,
    type StackedPullRequest,
    type TrackerCompletionPort,
} from '../deliverPullRequest';
import { GITHUB_HTTPS_REMOTE, REQUIRED_BASE_BRANCH } from '../githubAppIdentity.ts';

function relationshipBody(relationship: string): string {
    return `### 🎯 What does this PR do?
Change.
### 🧪 How to test
Run.
### 🖼️ Screenshots
None.
### 📌 Related tickets & additional notes
${relationship}`;
}

const body = relationshipBody('None.');

type MergeSettings = {
    allow_merge_commit: boolean;
    allow_rebase_merge: boolean;
    allow_squash_merge: boolean;
    delete_branch_on_merge: boolean;
};

function mergePolicyPort(settings: string | Error) {
    const captures: Array<{ command: string; args: string[] }> = [];
    const port = shellPort('jcosta33/sourdaw', {
        capture: (command, args) => {
            captures.push({ command, args });
            if (args.join(' ') === 'api repos/jcosta33/sourdaw') {
                if (settings instanceof Error) {
                    throw settings;
                }
                return settings;
            }
            if (args.includes('repos/jcosta33/sourdaw/pulls/42/merge')) {
                return JSON.stringify({ merged: true, message: 'merged' });
            }
            throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
        },
        run: () => undefined,
    });
    return { captures, port };
}

function mergeSettings(settings: MergeSettings): string {
    return JSON.stringify(settings);
}

function stackedDeliveryPort(finalSettings: MergeSettings) {
    const captures: Array<{ command: string; args: string[] }> = [];
    let child = pullRequest({ ...stacked(), baseRefOid: 'base' });
    const port = shellPort('jcosta33/sourdaw', {
        capture: (command, args) => {
            captures.push({ command, args });
            const joined = args.join(' ');
            if (command === 'git' && joined === 'rev-parse HEAD') {
                return 'head';
            }
            if (command === 'git' && joined === 'status --porcelain=v1') {
                return '';
            }
            if (command === 'git' && joined === 'rev-parse refs/remotes/origin/main') {
                return 'base';
            }
            if (joined.includes('pr view')) {
                return JSON.stringify(args.includes('43') ? child : pullRequest());
            }
            if (joined.includes('query=')) {
                return JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                reviews: {
                                    nodes: [
                                        {
                                            state: 'APPROVED',
                                            submittedAt: '2026-08-19T00:00:00Z',
                                            author: { login: 'jcosta33-reviewer[bot]' },
                                            commit: { oid: 'head' },
                                        },
                                    ],
                                    pageInfo: { hasPreviousPage: false },
                                },
                                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
                            },
                        },
                    },
                });
            }
            if (joined.includes('pulls?state=open')) {
                return JSON.stringify([
                    [
                        {
                            number: 43,
                            state: 'open',
                            head: { ref: 'feat/child', sha: 'child-head' },
                            base: { ref: 'feat/gate' },
                        },
                    ],
                ]);
            }
            if (joined.includes('.delete_branch_on_merge')) {
                return 'false';
            }
            if (joined === 'api repos/jcosta33/sourdaw') {
                return mergeSettings(finalSettings);
            }
            if (joined.includes('/merge')) {
                return JSON.stringify({ merged: true, message: 'merged' });
            }
            throw new Error(`unexpected capture: ${command} ${joined}`);
        },
        run: (_command, args) => {
            if (args.includes('PATCH')) {
                child = { ...child, baseRefName: 'main' };
            }
        },
    });
    return { captures, port };
}

function pullRequest(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
    return {
        number: 42,
        state: 'OPEN',
        isDraft: false,
        title: 'feat(delivery): add gate',
        body,
        headRefName: 'feat/gate',
        headRefOid: 'head',
        baseRefName: 'main',
        baseRefOid: 'base',
        mergeStateStatus: 'CLEAN',
        reviewDecision: '',
        changedFiles: 3,
        additions: 40,
        deletions: 5,
        ...overrides,
    };
}

function stacked(overrides: Partial<StackedPullRequest> = {}): StackedPullRequest {
    return {
        number: 43,
        state: 'OPEN',
        headRefName: 'feat/child',
        headRefOid: 'child-head',
        baseRefName: 'feat/gate',
        ...overrides,
    };
}

type FakeInput = {
    primary?: PullRequestSnapshot[];
    review?: ReviewState;
    reviewStates?: ReviewState[];
    dependentSets?: StackedPullRequest[][];
    dirty?: boolean;
    deletesMergedBranches?: boolean;
    failRetargetOnce?: number;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const primary = [...(input.primary ?? [pullRequest(), pullRequest()])];
    const reviewStates = [...(input.reviewStates ?? [])];
    const dependentSets = input.dependentSets?.map((set) => [...set]) ?? [[stacked()], [stacked()]];
    const pullRequests = new Map<number, PullRequestSnapshot>();
    for (const set of dependentSets) {
        for (const dependent of set) {
            pullRequests.set(
                dependent.number,
                pullRequest({
                    ...dependent,
                    baseRefOid: 'base',
                })
            );
        }
    }
    let lastDependents = dependentSets.at(-1) ?? [];
    let failedRetarget = false;
    const port: DeliveryPort = {
        fetch: () => calls.push('fetch'),
        pullRequest: (number) => {
            if (number === 42) {
                const next = primary.shift();
                if (next === undefined) {
                    throw new Error('missing primary fixture');
                }
                return next;
            }
            const current = pullRequests.get(number);
            if (current === undefined) {
                throw new Error(`missing PR #${number} fixture`);
            }
            return current;
        },
        reviewState: (number, expectedHead) => {
            calls.push(`review:${number}:${expectedHead}`);
            return (
                reviewStates.shift() ?? input.review ?? { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 }
            );
        },
        dependents: () => {
            const next = dependentSets.shift();
            if (next !== undefined) {
                lastDependents = next;
            }
            return [...lastDependents];
        },
        repositoryDeletesMergedBranches: () => input.deletesMergedBranches ?? false,
        merge: (number, head) => calls.push(`merge:${number}:${head}`),
        retarget: (number, base) => {
            calls.push(`retarget:${number}:${base}`);
            if (input.failRetargetOnce === number && !failedRetarget) {
                failedRetarget = true;
                throw new Error(`retarget ${number} failed`);
            }
            const current = pullRequests.get(number);
            if (current === undefined) {
                throw new Error(`missing PR #${number} fixture`);
            }
            pullRequests.set(number, { ...current, baseRefName: base });
        },
        log: (message) => calls.push(message),
    };
    const tracker: TrackerCompletionPort = {
        complete: (issueNumber: number) => {
            calls.push(`complete:${issueNumber}`);
        },
    };
    return { port, calls, tracker };
}

function deliverPullRequest(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort = {
        complete: (issueNumber: number) => expect.fail(`unexpected issue completion: ${issueNumber}`),
    }
): void {
    deliverPullRequestWithTracker(number, port, tracker);
}

describe('pull-request delivery', () => {
    it('completes the canonical Closes issue only after merge and dependent retargeting', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('complete:2372');
        expect(calls.indexOf('complete:2372')).toBeGreaterThan(calls.indexOf('merge:42:head'));
        expect(calls.indexOf('complete:2372')).toBeGreaterThan(calls.indexOf('retarget:43:main'));
    });

    it.each(['Related #2372', 'None.'])('does not complete an issue for %s', (relationship) => {
        const relatedBody = relationshipBody(relationship);
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: relatedBody }), pullRequest({ body: relatedBody })],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('rejects Related-ticket body or target drift before merge', () => {
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: relationshipBody('Closes #2372') }),
                pullRequest({ body: relationshipBody('Closes #2373') }),
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body|closing target.*changed/i);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('rejects body drift even when the canonical closing target is unchanged', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: `${closes}\nChanged note.` })],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('converges issue completion on an already-merged retry after dependent repair', () => {
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('Closes #2372') })],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls.indexOf('complete:2372')).toBeGreaterThan(calls.indexOf('retarget:43:main'));
    });

    it('reports an explicit partial state when issue completion fails after merge', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
            ],
            dependentSets: [[child], [child], []],
        });
        let failOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failOnce) {
                failOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContainEqual(expect.stringMatching(/delivered|success/i));

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(2);
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('merges the expected head and retargets stable dependents', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port);

        expect(calls).toEqual(expect.arrayContaining(['merge:42:head', 'retarget:43:main']));
    });

    it('rejects head drift during delivery', () => {
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest({ headRefOid: 'moved' })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/headRefOid changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('allows base movement during delivery when the feature head and mergeability stay stable', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ baseRefOid: 'base-before' }), pullRequest({ baseRefOid: 'base-after' })],
        });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects mergeability drift after harmless base movement', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({ mergeStateStatus: 'CLEAN', baseRefOid: 'base-before' }),
                pullRequest({ mergeStateStatus: 'BLOCKED', baseRefOid: 'base-after' }),
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/BLOCKED/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects base-branch changes during delivery', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest(), pullRequest({ baseRefName: 'release/1.0' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/baseRefName changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * A retarget moves the base and leaves the head, the approval and the merge state untouched, so
     * every other gate here still reads green while the squash lands on a branch nobody reviewed
     * the change against.
     */
    it('refuses a pull request retargeted away from the trunk before delivery', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ baseRefName: 'release/1.0' }), pullRequest({ baseRefName: 'release/1.0' })],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(calls, 'a pull request retargeted to release/1.0 was squash-merged onto it').not.toContain(
            'merge:42:head'
        );
        expect(String(thrown)).toMatch(/PR #42 targets release\/1\.0, not main; deliver merges into main only/);
        expect(calls.some((call) => call.startsWith('retarget:'))).toBe(false);
    });

    /**
     * The already-merged path does not merge anything, but it does retarget every dependent onto
     * the merged pull request's base. A substituted base there moves the whole stack onto it.
     */
    it('refuses to repair dependents onto a substituted base', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ state: 'MERGED', baseRefName: 'release/1.0' })],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(calls, 'dependents were retargeted onto the substituted base release/1.0').not.toContainEqual(
            expect.stringMatching(/^retarget:/)
        );
        expect(String(thrown)).toMatch(/PR #42 targets release\/1\.0, not main/);
    });

    it('names the base it found, the base it requires, and the way out', () => {
        const { port } = fakePort({
            primary: [pullRequest({ baseRefName: 'agent/parent' }), pullRequest({ baseRefName: 'agent/parent' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(
            /targets agent\/parent, not main.*Deliver the pull request this one is stacked on, which retargets this one/s
        );
    });

    it('delivers the trunk base the lane tooling opens every pull request against', () => {
        expect(REQUIRED_BASE_BRANCH).toBe('main');
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest()] });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects unresolved review before merge', () => {
        const { port, calls } = fakePort({ review: { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 1 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/unresolved review/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects missing reviewer approval on the current head', () => {
        const { port, calls } = fakePort({ review: { latestReviewerStateOnHead: null, unresolvedThreads: 0 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/not approved by jcosta33-reviewer\[bot\]/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects reviewer approval drift between the first and second pre-merge checks', () => {
        const { port, calls } = fakePort({
            reviewStates: [
                { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 },
                { latestReviewerStateOnHead: null, unresolvedThreads: 0 },
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/not approved by jcosta33-reviewer\[bot\]/);
        expect(calls).not.toContain('merge:42:head');
    });

    it.each(['COMMENTED', 'CHANGES_REQUESTED'])('rejects reviewer state %s', (state) => {
        const { port, calls } = fakePort({ review: { latestReviewerStateOnHead: state, unresolvedThreads: 0 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/not approved/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('merges when the local working tree is unrelated to the pull-request head', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects a draft pull request', () => {
        const { port, calls } = fakePort({ primary: [pullRequest({ isDraft: true })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/draft/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects a blocked merge state', () => {
        const { port, calls } = fakePort({ primary: [pullRequest({ mergeStateStatus: 'BLOCKED' })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/BLOCKED/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects an aggregate CHANGES_REQUESTED decision', () => {
        const { port, calls } = fakePort({ primary: [pullRequest({ reviewDecision: 'CHANGES_REQUESTED' })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/requested changes/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects dependent drift during delivery', () => {
        const before = stacked();
        const after = stacked({ headRefOid: 'moved' });
        const { port, calls } = fakePort({ dependentSets: [[before], [after]] });

        expect(() => deliverPullRequest(42, port)).toThrow(/stacked PR #43 changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects dependent-set additions during delivery', () => {
        const first = stacked();
        const added = stacked({ number: 44, headRefName: 'feat/other', headRefOid: 'other-head' });
        const { port, calls } = fakePort({ dependentSets: [[first], [first, added]] });

        expect(() => deliverPullRequest(42, port)).toThrow(/set changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects stacked delivery when GitHub deletes merged branches', () => {
        const { port, calls } = fakePort({ deletesMergedBranches: true });

        expect(() => deliverPullRequest(42, port)).toThrow(/automatic merged-branch deletion/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('repairs dependents after an interrupted post-merge retarget', () => {
        const child = stacked();
        const sibling = stacked({ number: 44, headRefName: 'feat/sibling', headRefOid: 'sibling-head' });
        const { port, calls } = fakePort({
            primary: [pullRequest(), pullRequest(), pullRequest({ state: 'MERGED' })],
            dependentSets: [[child, sibling], [child, sibling], [sibling]],
            failRetargetOnce: 44,
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/retarget 44 failed/);
        expect(calls).toContain('merge:42:head');

        deliverPullRequest(42, port);

        expect(calls.filter((call) => call === 'retarget:44:main')).toHaveLength(2);
        expect(calls).toContain('PR #42 was already merged; repaired 1 remaining dependent(s)');
    });

    it.each([
        ['empty', body.replace('Change.', '')],
        ['duplicate', `${body}\n### 🎯 What does this PR do?\nAgain.`],
        [
            'out-of-order',
            body.replace(
                '### 🎯 What does this PR do?\nChange.\n### 🧪 How to test\nRun.',
                '### 🧪 How to test\nRun.\n### 🎯 What does this PR do?\nChange.'
            ),
        ],
    ])('rejects %s pull-request body sections', (_case, invalidBody) => {
        const { port, calls } = fakePort({ primary: [pullRequest({ body: invalidBody })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/body/);
        expect(calls).not.toContain('merge:42:head');
    });
});

describe('delivery CLI', () => {
    it('parses one pull-request number', () => {
        expect(parseCliArgs(['42'])).toEqual({ number: 42, help: false });
    });

    it.each([
        [['42', '--unknown'], /unknown option/],
        [['0'], /usage/],
        [['--help', '--unknown'], /help takes no other arguments/],
    ])('rejects malformed arguments %#', (args, message) => {
        expect(() => parseCliArgs(args)).toThrow(message);
    });
});

describe('delivery shell boundary', () => {
    it('uses complete GitHub reads and exact-head writes', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const runs: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
                const joined = args.join(' ');
                if (joined.includes('query=')) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviews: {
                                        nodes: [
                                            {
                                                state: 'APPROVED',
                                                submittedAt: '2026-08-19T00:00:00Z',
                                                author: { login: 'jcosta33-reviewer[bot]' },
                                                commit: { oid: 'head' },
                                            },
                                        ],
                                        pageInfo: { hasPreviousPage: false },
                                    },
                                    reviewThreads: {
                                        nodes: [{ isResolved: true }],
                                        pageInfo: { hasNextPage: false },
                                    },
                                },
                            },
                        },
                    });
                }
                if (joined.includes('pulls?state=open')) {
                    return JSON.stringify([
                        [
                            {
                                number: 43,
                                state: 'open',
                                head: { ref: 'feat/child', sha: 'child-head' },
                                base: { ref: 'feat/gate' },
                            },
                        ],
                    ]);
                }
                if (joined.includes('.delete_branch_on_merge')) {
                    return 'false';
                }
                if (joined === 'api repos/jcosta33/sourdaw') {
                    return mergeSettings({
                        allow_merge_commit: true,
                        allow_rebase_merge: false,
                        allow_squash_merge: true,
                        delete_branch_on_merge: false,
                    });
                }
                if (joined.includes('/merge')) {
                    return JSON.stringify({ merged: true, message: 'merged' });
                }
                throw new Error(`unexpected capture: ${command} ${joined}`);
            },
            run: (command, args) => runs.push({ command, args }),
        };
        const port = shellPort('jcosta33/sourdaw', shell);

        expect(port.reviewState(42, 'head')).toEqual({ latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 });
        expect(port.dependents('feat/gate')).toEqual([stacked()]);
        expect(port.repositoryDeletesMergedBranches()).toBe(false);
        port.merge(42, 'head', false);
        port.retarget(43, 'main');

        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
        expect(captures).toContainEqual({
            command: 'gh',
            args: [
                'api',
                '--method',
                'PUT',
                'repos/jcosta33/sourdaw/pulls/42/merge',
                '-f',
                'sha=head',
                '-f',
                'merge_method=squash',
            ],
        });
        expect(runs).toContainEqual({
            command: 'gh',
            args: ['api', '--method', 'PATCH', 'repos/jcosta33/sourdaw/pulls/43', '-f', 'base=main', '--silent'],
        });
    });

    it.each([
        [
            'uses squash when it is the only enabled method',
            {
                allow_merge_commit: false,
                allow_rebase_merge: false,
                allow_squash_merge: true,
                delete_branch_on_merge: false,
            },
            'squash',
        ],
        [
            'uses squash even when merge commits are enabled',
            {
                allow_merge_commit: true,
                allow_rebase_merge: true,
                allow_squash_merge: true,
                delete_branch_on_merge: false,
            },
            'squash',
        ],
    ])('%s', (_case, settings, expectedMethod) => {
        const { captures, port } = mergePolicyPort(mergeSettings(settings));

        port.merge(42, 'head', false);

        expect(captures).toContainEqual({
            command: 'gh',
            args: ['api', 'repos/jcosta33/sourdaw'],
        });
        expect(captures).toContainEqual({
            command: 'gh',
            args: [
                'api',
                '--method',
                'PUT',
                'repos/jcosta33/sourdaw/pulls/42/merge',
                '-f',
                'sha=head',
                '-f',
                `merge_method=${expectedMethod}`,
            ],
        });
    });

    it('rejects merging when no repository merge method is enabled', () => {
        const { captures, port } = mergePolicyPort(
            mergeSettings({
                allow_merge_commit: false,
                allow_rebase_merge: false,
                allow_squash_merge: false,
                delete_branch_on_merge: false,
            })
        );

        expect(() => port.merge(42, 'head', false)).toThrow(/squash merge is not enabled/);
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('rejects stacked delivery when merged-branch deletion is enabled before the final merge', () => {
        const { captures, port } = stackedDeliveryPort({
            allow_merge_commit: false,
            allow_rebase_merge: false,
            allow_squash_merge: true,
            delete_branch_on_merge: true,
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/automatic merged-branch deletion/);
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('rejects malformed repository merge settings', () => {
        const { captures, port } = mergePolicyPort('{"allow_merge_commit":true}');

        expect(() => port.merge(42, 'head', false)).toThrow(/cannot prove repository merge settings/);
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('rejects a failed repository merge-settings query', () => {
        const { captures, port } = mergePolicyPort(new Error('GitHub unavailable'));

        expect(() => port.merge(42, 'head', false)).toThrow(
            /cannot determine repository merge settings: GitHub unavailable/
        );
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('authenticates fetch by pruning all origin heads over HTTPS', () => {
        const helperDir = mkdtempSync(join(tmpdir(), 'sourdaw-git-helper-'));
        const runs: Array<{ command: string; args: string[] }> = [];
        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => '',
                    run: (command, args) => runs.push({ command, args }),
                },
                { gitToken: 'ghs_minted', helperDir }
            );
            port.fetch();
            expect(runs).toHaveLength(1);
            const args = runs[0]?.args ?? [];
            expect(args.slice(0, 3)).toEqual(['-c', 'credential.helper=', '-c']);
            expect(args[3]).toMatch(/^credential\.helper=\//);
            expect(args[3]).not.toContain('ghs_minted');
            expect(args.slice(4)).toEqual([
                'fetch',
                '--prune',
                GITHUB_HTTPS_REMOTE,
                '+refs/heads/*:refs/remotes/origin/*',
            ]);
            expect(args.join('\0')).not.toContain('ghs_minted');
            expect(args).not.toContain('--force');
            expect(args).not.toContain('+refs/heads/main:refs/remotes/origin/main');
        } finally {
            rmSync(helperDir, { recursive: true, force: true });
        }
    });

    it('treats GraphQL reviewer login without [bot] as the reviewer App', () => {
        const shell: ShellRunner = {
            capture: (command, args) => {
                if (args.some((arg) => arg.startsWith('query='))) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviews: {
                                        nodes: [
                                            {
                                                state: 'APPROVED',
                                                submittedAt: '2026-08-19T00:00:00Z',
                                                author: { login: 'jcosta33-reviewer' },
                                                commit: { oid: 'head' },
                                            },
                                        ],
                                        pageInfo: { hasPreviousPage: false },
                                    },
                                    reviewThreads: {
                                        nodes: [{ isResolved: true }],
                                        pageInfo: { hasNextPage: false },
                                    },
                                },
                            },
                        },
                    });
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        expect(shellPort('jcosta33/sourdaw', shell).reviewState(42, 'head')).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            unresolvedThreads: 0,
        });
    });

    it('ignores reviewer approvals that target a different commit than the expected head', () => {
        const shell: ShellRunner = {
            capture: (command, args) => {
                if (args.some((arg) => arg.startsWith('query='))) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviews: {
                                        nodes: [
                                            {
                                                state: 'APPROVED',
                                                submittedAt: '2026-08-19T00:00:00Z',
                                                author: { login: 'jcosta33-reviewer[bot]' },
                                                commit: { oid: 'other-head' },
                                            },
                                        ],
                                        pageInfo: { hasPreviousPage: false },
                                    },
                                    reviewThreads: {
                                        nodes: [{ isResolved: true }],
                                        pageInfo: { hasNextPage: false },
                                    },
                                },
                            },
                        },
                    });
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        expect(shellPort('jcosta33/sourdaw', shell).reviewState(42, 'head')).toEqual({
            latestReviewerStateOnHead: null,
            unresolvedThreads: 0,
        });
    });
});
