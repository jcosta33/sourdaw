import { describe, expect, it } from 'vitest';

import {
    deliverPullRequest,
    parseCliArgs,
    shellPort,
    type DeliveryPort,
    type PullRequestSnapshot,
    type ReviewState,
    type ShellRunner,
    type StackedPullRequest,
} from '../deliverPullRequest';

const body = `### 🎯 What does this PR do?
Change.
### 🧪 How to test
Run.
### 🖼️ Screenshots
None.
### 📌 Related tickets & additional notes
None.`;

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
    dependentSets?: StackedPullRequest[][];
    dirty?: boolean;
    deletesMergedBranches?: boolean;
    failRetargetOnce?: number;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const primary = [...(input.primary ?? [pullRequest(), pullRequest()])];
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
        reviewState: () => input.review ?? { currentHeadReviews: 3, unresolvedThreads: 0 },
        dependents: () => {
            const next = dependentSets.shift();
            if (next !== undefined) {
                lastDependents = next;
            }
            return [...lastDependents];
        },
        repositoryDeletesMergedBranches: () => input.deletesMergedBranches ?? false,
        localHead: () => 'head',
        localDirty: () => input.dirty ?? false,
        remoteBranchHead: () => 'base',
        verify: (base, head, overrides) => calls.push(`verify:${base}:${head}:${overrides.e2eSpecs.join(',')}`),
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
    return { port, calls };
}

describe('pull-request delivery', () => {
    it('verifies, merges the expected head, and retargets stable dependents', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port, { e2eSpecs: ['tests/e2e/project.spec.ts'] });

        expect(calls).toEqual(
            expect.arrayContaining(['verify:base:head:tests/e2e/project.spec.ts', 'merge:42:head', 'retarget:43:main'])
        );
        expect(calls.findIndex((call) => call.startsWith('verify:'))).toBeLessThan(
            calls.findIndex((call) => call.startsWith('merge:'))
        );
    });

    it('rejects head drift after verification', () => {
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest({ headRefOid: 'moved' })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/headRefOid changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects unresolved review before verification', () => {
        const { port, calls } = fakePort({ review: { currentHeadReviews: 3, unresolvedThreads: 1 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/unresolved review/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });

    it('rejects missing current-head review activity', () => {
        const { port, calls } = fakePort({ review: { currentHeadReviews: 0, unresolvedThreads: 0 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/no current-head review activity/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });

    it('rejects a dirty worktree before verification', () => {
        const { port, calls } = fakePort({ dirty: true });

        expect(() => deliverPullRequest(42, port)).toThrow(/working tree is dirty/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });

    it('rejects dependent drift during verification', () => {
        const before = stacked();
        const after = stacked({ headRefOid: 'moved' });
        const { port, calls } = fakePort({ dependentSets: [[before], [after]] });

        expect(() => deliverPullRequest(42, port)).toThrow(/stacked PR #43 changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects dependent-set additions during verification', () => {
        const first = stacked();
        const added = stacked({ number: 44, headRefName: 'feat/other', headRefOid: 'other-head' });
        const { port, calls } = fakePort({ dependentSets: [[first], [first, added]] });

        expect(() => deliverPullRequest(42, port)).toThrow(/set changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects stacked delivery when GitHub deletes merged branches', () => {
        const { port, calls } = fakePort({ deletesMergedBranches: true });

        expect(() => deliverPullRequest(42, port)).toThrow(/automatic merged-branch deletion/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
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
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });
});

describe('delivery CLI', () => {
    it('parses repeated targeted E2E specs', () => {
        expect(parseCliArgs(['42', '--e2e', 'tests/e2e/a.spec.ts', '--e2e', 'tests/e2e/b.spec.ts'])).toEqual({
            number: 42,
            overrides: {
                e2eSpecs: ['tests/e2e/a.spec.ts', 'tests/e2e/b.spec.ts'],
            },
            help: false,
        });
    });

    it.each([
        [['42', '--e2e', '--unknown'], /requires a spec path/],
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
                                        nodes: [{ state: 'COMMENTED', commit: { oid: 'head' } }],
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
                if (joined.includes('/merge')) {
                    return JSON.stringify({ merged: true, message: 'merged' });
                }
                throw new Error(`unexpected capture: ${command} ${joined}`);
            },
            run: (command, args) => runs.push({ command, args }),
        };
        const port = shellPort('jcosta33/sourdaw', shell);

        expect(port.reviewState(42, 'head')).toEqual({ currentHeadReviews: 1, unresolvedThreads: 0 });
        expect(port.dependents('feat/gate')).toEqual([stacked()]);
        expect(port.repositoryDeletesMergedBranches()).toBe(false);
        port.verify('base', 'head', { e2eSpecs: ['tests/e2e/a.spec.ts'] });
        port.merge(42, 'head');
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
                'merge_method=merge',
            ],
        });
        expect(runs).toContainEqual({
            command: 'pnpm',
            args: ['verify:change', '--base', 'base', '--head', 'head', '--e2e', 'tests/e2e/a.spec.ts'],
        });
        expect(runs).toContainEqual({
            command: 'gh',
            args: ['api', '--method', 'PATCH', 'repos/jcosta33/sourdaw/pulls/43', '-f', 'base=main', '--silent'],
        });
    });
});
