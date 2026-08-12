import { describe, expect, it } from 'vitest';

import { deliverPullRequest, type DeliveryPort, type PullRequestSnapshot } from '../deliverPullRequest';

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

type FakeInput = {
    primary?: PullRequestSnapshot[];
    review?: { totalReviews: number; unresolvedThreads: number };
    dependent?: PullRequestSnapshot;
    dirty?: boolean;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const primary = [...(input.primary ?? [pullRequest(), pullRequest()])];
    const dependent =
        input.dependent ?? pullRequest({ number: 43, headRefName: 'feat/child', baseRefName: 'feat/gate' });
    let retargeted = false;
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
            return retargeted ? { ...dependent, baseRefName: 'main' } : dependent;
        },
        reviewState: () => input.review ?? { totalReviews: 3, unresolvedThreads: 0 },
        dependents: () => [dependent],
        localHead: () => 'head',
        localDirty: () => input.dirty ?? false,
        remoteBranchHead: () => 'base',
        verify: (base, head, overrides) =>
            calls.push(`verify:${base}:${head}:${overrides.e2eSpecs.join(',')}:${overrides.fullE2e}`),
        merge: (number, head) => calls.push(`merge:${number}:${head}`),
        retarget: (number, base) => {
            calls.push(`retarget:${number}:${base}`);
            retargeted = true;
        },
        log: (message) => calls.push(message),
    };
    return { port, calls };
}

describe('pull-request delivery', () => {
    it('verifies, merges the expected head, and retargets a stable dependent', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port, { e2eSpecs: ['tests/e2e/project.spec.ts'], fullE2e: false });

        expect(calls).toEqual(
            expect.arrayContaining([
                'verify:base:head:tests/e2e/project.spec.ts:false',
                'merge:42:head',
                'retarget:43:main',
            ])
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
        const { port, calls } = fakePort({ review: { totalReviews: 3, unresolvedThreads: 1 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/unresolved review/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });

    it('rejects a dirty worktree before verification', () => {
        const { port, calls } = fakePort({ dirty: true });

        expect(() => deliverPullRequest(42, port)).toThrow(/working tree is dirty/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });

    it('rejects a dependent that moved during verification', () => {
        const dependent = pullRequest({ number: 43, headRefName: 'feat/child', baseRefName: 'other' });
        const { port, calls } = fakePort({ dependent });
        const originalDependents = port.dependents;
        port.dependents = () => [{ ...dependent, baseRefName: 'feat/gate' }];

        expect(() => deliverPullRequest(42, port)).toThrow(/stacked PR #43 changed/);
        expect(calls).not.toContain('merge:42:head');
        port.dependents = originalDependents;
    });

    it('rejects missing review activity', () => {
        const { port, calls } = fakePort({ review: { totalReviews: 0, unresolvedThreads: 0 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/no review activity/);
        expect(calls.some((call) => call.startsWith('verify:'))).toBe(false);
    });
});
