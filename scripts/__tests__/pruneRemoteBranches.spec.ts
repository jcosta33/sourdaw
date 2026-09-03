import { describe, expect, it } from 'vitest';

import { REQUIRED_REPOSITORY } from '../githubAppIdentity.ts';
import {
    classifyRemoteBranch,
    deleteRemoteBranch,
    encodeBranchRefPath,
    parsePruneRemoteBranchesArgs,
    pruneRemoteBranches,
    type BranchPullRequest,
    type DeleteOutcome,
    type PruneRemoteBranchesArgs,
    type PruneRemoteBranchesPort,
    type RemoteBranch,
} from '../pruneRemoteBranches.ts';

function branch(name: string, tip: string): RemoteBranch {
    return { name, tip };
}
function mergedPr(number: number, headRefOid: string): BranchPullRequest {
    return { number, state: 'MERGED', headRefOid };
}
function closedPr(number: number, headRefOid: string): BranchPullRequest {
    return { number, state: 'CLOSED', headRefOid };
}
function openPr(number: number, headRefOid: string): BranchPullRequest {
    return { number, state: 'OPEN', headRefOid };
}

describe('classifyRemoteBranch', () => {
    it('should classify main as protected even with a merged pull request whose head equals the tip', () => {
        const value = branch('main', 'tip-main');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'tip-main')])).toBe('protected');
    });

    it('should classify a branch with any OPEN pull request as open when a MERGED pull request also exists', () => {
        const value = branch('feature', 'tip-feature');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'other-tip'), openPr(2, 'tip-feature')])).toBe('open');
    });

    it('should classify a branch with no pull requests as unpublished', () => {
        const value = branch('stray', 'tip-stray');
        expect(classifyRemoteBranch(value, [])).toBe('unpublished');
    });

    it('should classify a branch whose tip matches no pull-request head as moved', () => {
        const value = branch('drift', 'tip-now');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'tip-then')])).toBe('moved');
    });

    it('should classify a branch whose tip matches a MERGED pull-request head as spent', () => {
        const value = branch('alpha', 'tip-alpha');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'tip-alpha')])).toBe('spent');
    });

    it('should classify a branch whose tip matches a CLOSED pull-request head as spent', () => {
        const value = branch('beta', 'tip-beta');
        expect(classifyRemoteBranch(value, [closedPr(2, 'tip-beta')])).toBe('spent');
    });

    it('should classify an incompletely listed branch as unlisted even when a fetched node is OPEN', () => {
        const value = branch('gamma', 'tip-gamma');
        expect(classifyRemoteBranch(value, [openPr(3, 'tip-gamma')], false)).toBe('unlisted');
    });

    it('should classify a branch with exactly ten of ten fetched pull requests as spent, not unlisted', () => {
        const value = branch('delta', 'tip-delta');
        const pullRequests = Array.from({ length: 9 }, (_unused, index) => closedPr(index + 1, `old-tip-${index}`));
        pullRequests.push(mergedPr(10, 'tip-delta'));
        expect(classifyRemoteBranch(value, pullRequests, true)).toBe('spent');
    });
});

describe('encodeBranchRefPath', () => {
    it('should keep / between segments and encode # and spaces within a segment', () => {
        expect(encodeBranchRefPath('feature/my branch#1')).toBe('feature/my%20branch%231');
    });
});

describe('parsePruneRemoteBranchesArgs', () => {
    it('should reject an unknown flag', () => {
        expect(() => parsePruneRemoteBranchesArgs(['--bogus'])).toThrow();
    });

    it('should reject a positional argument', () => {
        expect(() => parsePruneRemoteBranchesArgs(['some-branch'])).toThrow();
    });

    it('should reject --limit 0', () => {
        expect(() => parsePruneRemoteBranchesArgs(['--limit', '0'])).toThrow();
    });

    it('should reject --limit abc', () => {
        expect(() => parsePruneRemoteBranchesArgs(['--limit', 'abc'])).toThrow();
    });

    it('should accept --apply --limit 5', () => {
        expect(parsePruneRemoteBranchesArgs(['--apply', '--limit', '5'])).toEqual({
            apply: true,
            limit: 5,
            help: false,
        });
    });
});

type FakePortInput = {
    branches: RemoteBranch[];
    pullRequestsFor: (names: string[]) => Map<string, BranchPullRequest[]>;
    branchTip?: (name: string) => string | undefined;
    deleteBranch?: (name: string) => DeleteOutcome;
};
function fakePort(input: FakePortInput): {
    port: PruneRemoteBranchesPort;
    deleteCalls: string[];
    pullRequestBatchSizes: number[];
    branchTipCalls: string[];
} {
    const deleteCalls: string[] = [];
    const pullRequestBatchSizes: number[] = [];
    const branchTipCalls: string[] = [];
    const defaultBranchTip = (name: string): string | undefined =>
        input.branches.find((candidate) => candidate.name === name)?.tip;
    const port: PruneRemoteBranchesPort = {
        listBranches: () => input.branches,
        pullRequestsFor: (names) => {
            pullRequestBatchSizes.push(names.length);
            const raw = input.pullRequestsFor(names);
            return new Map(names.map((name) => [name, { pullRequests: raw.get(name) ?? [], complete: true }]));
        },
        branchTip: (name) => {
            branchTipCalls.push(name);
            return (input.branchTip ?? defaultBranchTip)(name);
        },
        deleteBranch: (name) => {
            deleteCalls.push(name);
            return input.deleteBranch === undefined ? 'deleted' : input.deleteBranch(name);
        },
    };
    return { port, deleteCalls, pullRequestBatchSizes, branchTipCalls };
}
function collectingLog(): { log: (message: string) => void; lines: string[] } {
    const lines: string[] = [];
    return { log: (message) => lines.push(message), lines };
}
function mapFor(master: Map<string, BranchPullRequest[]>, names: string[]): Map<string, BranchPullRequest[]> {
    return new Map(names.map((name) => [name, master.get(name) ?? []]));
}
function dryArgs(): PruneRemoteBranchesArgs {
    return { apply: false, help: false };
}
function applyArgs(limit?: number): PruneRemoteBranchesArgs {
    return { apply: true, limit, help: false };
}

const threeSpentBranches = [branch('alpha', 'ta'), branch('beta', 'tb'), branch('gamma', 'tc')];
function threeSpentMaster(): Map<string, BranchPullRequest[]> {
    return new Map([
        ['alpha', [mergedPr(1, 'ta')]],
        ['beta', [mergedPr(2, 'tb')]],
        ['gamma', [closedPr(3, 'tc')]],
    ]);
}

describe('pruneRemoteBranches', () => {
    it('should make zero deleteBranch calls on a dry run and print the would-delete count', () => {
        const master = threeSpentMaster();
        const { port, deleteCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(dryArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('dry run: 3 branches would be deleted; pass --apply to delete');
    });

    it('should delete only spent branches in name order and print one deleted line each', () => {
        const master = new Map<string, BranchPullRequest[]>([
            ...threeSpentMaster(),
            ['wip', [openPr(4, 'zz')]],
            ['stray', []],
            ['drift', [mergedPr(5, 'old-tip')]],
        ]);
        const branches = [...threeSpentBranches, branch('wip', 'zz'), branch('stray', 'ss'), branch('drift', 'dd')];
        const { port, deleteCalls } = fakePort({ branches, pullRequestsFor: (names) => mapFor(master, names) });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual(['alpha', 'beta', 'gamma']);
        expect(lines).toContain('deleted alpha (ta, #1 MERGED)');
        expect(lines).toContain('deleted beta (tb, #2 MERGED)');
        expect(lines).toContain('deleted gamma (tc, #3 CLOSED)');
    });

    it('should honour --limit, attempting only that many spent branches and reporting the remainder', () => {
        const master = threeSpentMaster();
        const { port, deleteCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(2), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual(['alpha', 'beta']);
        expect(lines).toContain('deleted 2, already gone 0, kept at re-check 0, remaining spent 1');
    });

    it('should skip a branch whose re-check finds an OPEN pull request, printing a kept line, and delete the others', () => {
        const master = threeSpentMaster();
        const { port, deleteCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => {
                if (names.length === 1 && names[0] === 'beta') {
                    return new Map([['beta', [openPr(9, 'zz')]]]);
                }
                return mapFor(master, names);
            },
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual(['alpha', 'gamma']);
        expect(lines).toContain('kept beta: open at re-check');
        expect(lines).toContain('deleted 2, already gone 0, kept at re-check 1, remaining spent 0');
    });

    it('should treat already-gone deletions as success in the final counts', () => {
        const master = threeSpentMaster();
        const { port } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
            deleteBranch: (name) => (name === 'beta' ? 'already-gone' : 'deleted'),
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(lines).toContain('already gone beta');
        expect(lines).toContain('deleted 2, already gone 1, kept at re-check 0, remaining spent 0');
    });

    it('should stop at the first thrown deleteBranch error, report the count so far, return 1, and call deleteBranch no further', () => {
        const master = threeSpentMaster();
        const { port, deleteCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
            deleteBranch: (name) => {
                if (name === 'alpha') {
                    throw new Error('gh: boom (HTTP 500)');
                }
                return 'deleted';
            },
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(1);
        expect(deleteCalls).toEqual(['alpha']);
        expect(lines).toContain('stopped after 0 deletions: gh: boom (HTTP 500)');
    });

    it('should call pullRequestsFor in batches of at most 50 names', () => {
        const branches = Array.from({ length: 120 }, (_unused, index) => branch(`branch-${index}`, `tip-${index}`));
        const { port, pullRequestBatchSizes } = fakePort({
            branches,
            pullRequestsFor: (names) => new Map(names.map((name) => [name, []])),
        });
        const { log } = collectingLog();
        pruneRemoteBranches(dryArgs(), port, log);
        expect(pullRequestBatchSizes).toEqual([50, 50, 20]);
    });

    it('should never call branchTip on a dry run', () => {
        const master = threeSpentMaster();
        const { port, branchTipCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
        });
        const { log } = collectingLog();
        pruneRemoteBranches(dryArgs(), port, log);
        expect(branchTipCalls).toEqual([]);
    });

    it('should skip a branch whose tip changed at re-check, even though fresh pull requests still match the old tip, and call deleteBranch no further for it', () => {
        const master = threeSpentMaster();
        const { port, deleteCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
            branchTip: (name) =>
                name === 'beta' ? 'new-tip-for-beta' : threeSpentBranches.find((b) => b.name === name)?.tip,
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual(['alpha', 'gamma']);
        expect(lines).toContain('kept beta: moved at re-check');
        expect(lines).toContain('deleted 2, already gone 0, kept at re-check 1, remaining spent 0');
    });

    it('should count a branch whose ref is gone at re-check as already gone without calling deleteBranch', () => {
        const master = threeSpentMaster();
        const { port, deleteCalls } = fakePort({
            branches: threeSpentBranches,
            pullRequestsFor: (names) => mapFor(master, names),
            branchTip: (name) => (name === 'beta' ? undefined : threeSpentBranches.find((b) => b.name === name)?.tip),
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual(['alpha', 'gamma']);
        expect(lines).toContain('already gone beta');
        expect(lines).toContain('deleted 2, already gone 1, kept at re-check 0, remaining spent 0');
    });

    it('should keep a branch whose re-check pull requests already match its moved tip, since classifyRemoteBranch alone cannot see the plan-time tip', () => {
        // The plan classifies this branch as spent at tip-a. By delete time the branch has moved to
        // tip-b, and (unlike the "still say spent for the old tip" case above) the fresh pull-request
        // data has also caught up: it now reports a PR head at tip-b, so classifyRemoteBranch({ tip:
        // tip-b }, freshPullRequests) alone answers 'spent' too. Only comparing freshTip against the
        // plan-time branch.tip catches that the ref moved after the plan was taken, which is exactly
        // what the `|| tipMoved` guard exists to do; deleting `|| tipMoved` makes this test fail.
        const target = branch('rebased', 'tip-a');
        const planPullRequests = [mergedPr(42, 'tip-a')];
        const recheckPullRequests = [mergedPr(42, 'tip-b')];
        let pullRequestCalls = 0;
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: (names) => {
                pullRequestCalls += 1;
                return new Map(
                    names.map((name) => [name, pullRequestCalls === 1 ? planPullRequests : recheckPullRequests])
                );
            },
            branchTip: () => 'tip-b',
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept rebased: moved at re-check');
    });

    it('should keep a branch as unlisted at plan time when its pull-request listing is incomplete, even with ten MERGED nodes at the tip', () => {
        // Ten MERGED nodes at the branch tip look spent to classifyRemoteBranch, but the listing is
        // truncated (an eleventh, unfetched pull request could be OPEN and invisible). The port signals
        // that with complete: false, and classifyRemoteBranch must return 'unlisted' before ever looking
        // at pull-request state, so the branch is kept rather than silently treated as spent.
        const target = branch('busy', 'tip-busy');
        const tenMergedAtTip = Array.from({ length: 10 }, (_unused, index) => mergedPr(index + 1, 'tip-busy'));
        const deleteCalls: string[] = [];
        const port: PruneRemoteBranchesPort = {
            listBranches: () => [target],
            pullRequestsFor: (names) =>
                new Map(names.map((name) => [name, { pullRequests: tenMergedAtTip, complete: false }])),
            branchTip: () => target.tip,
            deleteBranch: (name) => {
                deleteCalls.push(name);
                return 'deleted';
            },
        };
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(dryArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept busy: pull requests not fully listed');
    });
});

describe('deleteRemoteBranch', () => {
    it('should resolve already-gone when the runner throws an HTTP 422 Reference-does-not-exist error', () => {
        const runner = (): string => {
            throw new Error('gh: Reference does not exist (HTTP 422)');
        };
        expect(deleteRemoteBranch('gone-branch', runner)).toBe('already-gone');
    });

    it('should reject with an error naming the branch and carrying the original error as cause on any other failure', () => {
        const original = new Error('gh: some other failure (HTTP 404)');
        const runner = (): string => {
            throw original;
        };
        let caught: unknown;
        try {
            deleteRemoteBranch('missing-branch', runner);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toContain('missing-branch');
        expect((caught as Error).cause).toBe(original);
    });

    it('should reject an HTTP 422 that is not Reference-does-not-exist, naming the branch and carrying the original error as cause', () => {
        const original = new Error('gh: Validation Failed: Cannot delete a protected branch (HTTP 422)');
        const runner = (): string => {
            throw original;
        };
        let caught: unknown;
        try {
            deleteRemoteBranch('main', runner);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toContain('main');
        expect((caught as Error).cause).toBe(original);
    });

    it('should delete via gh api -X DELETE at the percent-encoded ref path and return deleted', () => {
        const calls: string[][] = [];
        const runner = (args: string[]): string => {
            calls.push(args);
            return '';
        };
        const outcome = deleteRemoteBranch('feature/my branch', runner);
        expect(outcome).toBe('deleted');
        expect(calls).toEqual([
            ['api', '-X', 'DELETE', `repos/${REQUIRED_REPOSITORY}/git/refs/heads/feature/my%20branch`],
        ]);
    });
});
