import { describe, expect, it } from 'vitest';

import { REQUIRED_REPOSITORY } from '../githubAppIdentity.ts';
import { branchHoldsRevision, recordedRevisionsInTables, type RemoteBranch } from '../measurementRevisionHolders.ts';
import {
    classifyRemoteBranch,
    deleteRemoteBranch,
    encodeBranchRefPath,
    parsePruneRemoteBranchesArgs,
    parsePullRequestListing,
    pruneRemoteBranches,
    queryBaseDependents,
    type BranchPullRequest,
    type DeleteOutcome,
    type PruneRemoteBranchesArgs,
    type PruneRemoteBranchesPort,
    type PullRequestListing,
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
        expect(classifyRemoteBranch(value, [mergedPr(1, 'tip-main')], true)).toBe('protected');
    });

    it('should classify a branch with any OPEN pull request as open when a MERGED pull request also exists', () => {
        const value = branch('feature', 'tip-feature');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'other-tip'), openPr(2, 'tip-feature')], true)).toBe('open');
    });

    it('should classify a branch with no pull requests as unpublished', () => {
        const value = branch('stray', 'tip-stray');
        expect(classifyRemoteBranch(value, [], true)).toBe('unpublished');
    });

    it('should classify a branch whose tip matches no pull-request head as moved', () => {
        const value = branch('drift', 'tip-now');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'tip-then')], true)).toBe('moved');
    });

    it('should classify a branch whose tip matches a MERGED pull-request head as spent', () => {
        const value = branch('alpha', 'tip-alpha');
        expect(classifyRemoteBranch(value, [mergedPr(1, 'tip-alpha')], true)).toBe('spent');
    });

    it('should classify a branch whose tip matches a CLOSED pull-request head as spent', () => {
        const value = branch('beta', 'tip-beta');
        expect(classifyRemoteBranch(value, [closedPr(2, 'tip-beta')], true)).toBe('spent');
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

describe('parsePullRequestListing', () => {
    it('should mark a listing incomplete when totalCount exceeds the fetched node count', () => {
        const nodes = Array.from({ length: 10 }, (_unused, index) => mergedPr(index + 1, 'tip-busy'));
        const listing = parsePullRequestListing({ nodes, totalCount: 11 }, 'busy');
        expect(listing.complete).toBe(false);
        expect(listing.pullRequests).toHaveLength(10);
    });

    it('should mark a listing complete when totalCount equals the fetched node count', () => {
        const nodes = Array.from({ length: 10 }, (_unused, index) => mergedPr(index + 1, 'tip-busy'));
        const listing = parsePullRequestListing({ nodes, totalCount: 10 }, 'busy');
        expect(listing.complete).toBe(true);
    });

    it('should mark an empty listing complete with zero fetched nodes of zero total', () => {
        const listing = parsePullRequestListing({ nodes: [], totalCount: 0 }, 'stray');
        expect(listing).toEqual({ pullRequests: [], complete: true });
    });

    it('should throw naming the branch when totalCount is missing', () => {
        expect(() => parsePullRequestListing({ nodes: [] }, 'gamma')).toThrow(
            'invalid pull-request total count for gamma'
        );
    });

    it('should throw the missing-alias message when nodes is not an array', () => {
        expect(() => parsePullRequestListing({ totalCount: 0 }, 'delta')).toThrow(
            'missing pull-request alias for delta'
        );
    });
});

describe('queryBaseDependents', () => {
    it('queries open pull requests by base branch with supplied variables and preserves incomplete pagination', () => {
        const calls: string[][] = [];
        const nodes = Array.from({ length: 10 }, (_unused, index) => openPr(index + 1, `child-tip-${index}`));
        const runner = (args: string[]): string => {
            calls.push(args);
            return JSON.stringify({ data: { repository: { b0: { totalCount: 11, nodes } } } });
        };

        expect(queryBaseDependents(['parent/one'], runner).get('parent/one')).toEqual({
            pullRequests: nodes,
            complete: false,
        });
        expect(calls).toHaveLength(1);
        const call = calls[0] ?? [];
        expect(call).toContain('-f');
        expect(call).toContain('n0=parent/one');
        expect(call.join(' ')).toContain('pullRequests(baseRefName:$n0');
        expect(call.join(' ')).toContain('states:[OPEN]');
        expect(call.join(' ')).not.toContain('headRefName');
    });

    it('propagates query errors so the pruning guard can preserve the whole affected batch', () => {
        const runner = (): string => {
            throw new Error('GraphQL unavailable');
        };

        expect(() => queryBaseDependents(['parent'], runner)).toThrow('GraphQL unavailable');
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

type FakePullRequestsResult = BranchPullRequest[] | PullRequestListing;
type FakePortInput = {
    branches: RemoteBranch[];
    pullRequestsFor: (names: string[]) => Map<string, FakePullRequestsResult>;
    baseDependentsFor?: (names: string[]) => Map<string, FakePullRequestsResult>;
    branchTip?: (name: string) => string | undefined;
    deleteBranch?: (name: string) => DeleteOutcome;
    recordedMeasurementRevisions?: () => string[];
    baseBranchTip?: () => RemoteBranch;
    branchHoldsRevision?: (branch: RemoteBranch, revision: string) => boolean;
};
function toListing(value: FakePullRequestsResult | undefined): PullRequestListing {
    if (value === undefined) {
        return { pullRequests: [], complete: true };
    }
    return Array.isArray(value) ? { pullRequests: value, complete: true } : value;
}
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
            return new Map(names.map((name) => [name, toListing(raw.get(name))]));
        },
        baseDependentsFor: (names) => {
            const raw = input.baseDependentsFor?.(names) ?? new Map();
            return new Map(names.map((name) => [name, toListing(raw.get(name))]));
        },
        branchTip: (name) => {
            branchTipCalls.push(name);
            return (input.branchTip ?? defaultBranchTip)(name);
        },
        deleteBranch: (name) => {
            deleteCalls.push(name);
            return input.deleteBranch === undefined ? 'deleted' : input.deleteBranch(name);
        },
        recordedMeasurementRevisions: () => input.recordedMeasurementRevisions?.() ?? [],
        baseBranchTip: () =>
            input.baseBranchTip?.() ??
            input.branches.find((candidate) => candidate.name === 'main') ??
            input.branches[0] ?? { name: 'main', tip: 'tip-main' },
        branchHoldsRevision: (branch, revision) => input.branchHoldsRevision?.(branch, revision) ?? false,
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
    it('keeps a spent parent branch when a complete plan-time read finds an open base-dependent pull request', () => {
        const target = branch('parent', 'tip-parent');
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: () => new Map([['parent', [mergedPr(1, 'tip-parent')]]]),
            baseDependentsFor: () => new Map([['parent', [openPr(2, 'tip-child')]]]),
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept parent: open base-dependent pull request #2');
    });

    it('keeps a spent branch when its plan-time base-dependent listing is incomplete', () => {
        const target = branch('parent', 'tip-parent');
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: () => new Map([['parent', [mergedPr(1, 'tip-parent')]]]),
            baseDependentsFor: () => new Map([['parent', { pullRequests: [openPr(2, 'tip-child')], complete: false }]]),
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept parent: base-dependent pull requests not fully listed');
    });

    it('keeps every candidate in a batch when the plan-time base-dependent query fails', () => {
        const targets = [branch('parent-a', 'tip-a'), branch('parent-b', 'tip-b')];
        const { port, deleteCalls } = fakePort({
            branches: targets,
            pullRequestsFor: () =>
                new Map([
                    ['parent-a', [mergedPr(1, 'tip-a')]],
                    ['parent-b', [mergedPr(2, 'tip-b')]],
                ]),
            baseDependentsFor: () => {
                throw new Error('query failed');
            },
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept parent-a: base-dependent pull requests not fully listed');
        expect(lines).toContain('kept parent-b: base-dependent pull requests not fully listed');
    });

    it('keeps a spent branch when the final base-dependent reread finds a newly opened child', () => {
        const target = branch('parent', 'tip-parent');
        let dependentReads = 0;
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: () => new Map([['parent', [mergedPr(1, 'tip-parent')]]]),
            baseDependentsFor: () => {
                dependentReads += 1;
                return new Map([['parent', dependentReads === 1 ? [] : [openPr(3, 'tip-late-child')]]]);
            },
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(dependentReads).toBe(2);
        expect(lines).toContain('kept parent: open base-dependent pull request #3 at re-check');
    });

    it('keeps a spent branch when the final base-dependent reread is incomplete', () => {
        const target = branch('parent', 'tip-parent');
        let dependentReads = 0;
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: () => new Map([['parent', [mergedPr(1, 'tip-parent')]]]),
            baseDependentsFor: () => {
                dependentReads += 1;
                return new Map([
                    [
                        'parent',
                        dependentReads === 1 ? [] : { pullRequests: [openPr(3, 'tip-late-child')], complete: false },
                    ],
                ]);
            },
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept parent: base-dependent pull requests not fully listed at re-check');
    });
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
            baseDependentsFor: (names) => new Map(names.map((name) => [name, { pullRequests: [], complete: true }])),
            branchTip: () => target.tip,
            deleteBranch: (name) => {
                deleteCalls.push(name);
                return 'deleted';
            },
            recordedMeasurementRevisions: () => [],
            baseBranchTip: () => branch('main', 'tip-main'),
            branchHoldsRevision: () => false,
        };
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(dryArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept busy: pull requests not fully listed');
    });

    it('should keep a branch at re-check whose fresh listing is incomplete, even with a merged pull request at the tip', () => {
        // The plan sees a complete listing with a single MERGED pull request at the tip, so the branch
        // is spent. By delete time the branch has ten-plus open pull requests and the re-check only
        // fetches the newest ten, so pullRequestsFor reports complete: false even though the same
        // MERGED pull request is still present in the fetched page. The branch must be kept rather than
        // deleted out from under whatever pull request the re-check could not see.
        const target = branch('busy', 'tip-busy');
        const mergedAtTip = mergedPr(7, 'tip-busy');
        let pullRequestCalls = 0;
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: (names) => {
                pullRequestCalls += 1;
                const listing: FakePullRequestsResult =
                    pullRequestCalls === 1 ? [mergedAtTip] : { pullRequests: [mergedAtTip], complete: false };
                return new Map(names.map((name) => [name, listing]));
            },
        });
        const { log, lines } = collectingLog();
        const code = pruneRemoteBranches(applyArgs(), port, log);
        expect(code).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain('kept busy: unlisted at re-check');
    });

    it('retains the last remote holder of a recorded measurement revision and names both', () => {
        // Deleting this merged branch would make the recorded revision unresolvable, which
        // breaks the required Gate on main for every later pull request (#4364). Without the
        // measurement guard the branch is spent and deleted, so this test fails.
        const target = branch('measured', 'tip-measured');
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: () => new Map([['measured', [mergedPr(1, 'tip-measured')]]]),
            recordedMeasurementRevisions: () => ['1111111111111111111111111111111111111111'],
            branchHoldsRevision: (candidate, revision) =>
                candidate.name === 'measured' && revision === '1111111111111111111111111111111111111111',
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain(
            'kept measured: last remote holder of recorded measurement revision 1111111111111111111111111111111111111111'
        );
    });

    it('still prunes an ordinary merged branch that holds no recorded measurement revision', () => {
        const { port, deleteCalls } = fakePort({
            branches: [branch('measured', 'tip-measured'), branch('ordinary', 'tip-ordinary')],
            pullRequestsFor: () =>
                new Map([
                    ['measured', [mergedPr(1, 'tip-measured')]],
                    ['ordinary', [mergedPr(2, 'tip-ordinary')]],
                ]),
            recordedMeasurementRevisions: () => ['2222222222222222222222222222222222222222'],
            branchHoldsRevision: (candidate) => candidate.name === 'measured',
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual(['ordinary']);
        expect(lines).toContain('deleted ordinary (tip-ordin, #2 MERGED)');
        expect(lines).toContain(
            'kept measured: last remote holder of recorded measurement revision 2222222222222222222222222222222222222222'
        );
    });

    it('prunes ordinary branches and reports the revision by name when the recorded revision is gone from the remote', () => {
        // A tracked table can record a sourceRevision the remote no longer holds: GitHub answers the
        // comparison with "gh: Not Found (HTTP 404)", which the holder read classifies as a stale
        // table entry rather than an unanswerable comparison. The run must report it once and still
        // prune the merged branches that hold no revision. Without the gone-revision guard the error
        // escapes and this test fails with the thrown error instead of returning 0.
        const goneRevision = '7777777777777777777777777777777777777777';
        const heldRevision = '8888888888888888888888888888888888888888';
        const { port, deleteCalls } = fakePort({
            branches: [branch('measured', 'tip-measured'), branch('ordinary', 'tip-ordinary')],
            pullRequestsFor: () =>
                new Map([
                    ['measured', [mergedPr(1, 'tip-measured')]],
                    ['ordinary', [mergedPr(2, 'tip-ordinary')]],
                ]),
            recordedMeasurementRevisions: () => [goneRevision, heldRevision],
            baseBranchTip: () => branch('main', 'tip-main'),
            branchHoldsRevision: (_candidate, revision) => {
                if (revision === goneRevision) {
                    throw new Error('gh: Not Found (HTTP 404)');
                }
                return false;
            },
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual(['measured', 'ordinary']);
        expect(lines).toContain(`unresolvable measurement revision ${goneRevision}: no remote branch holds it`);
        expect(lines.filter((line) => line.startsWith('unresolvable measurement revision'))).toHaveLength(1);
        expect(lines).toContain('spent ordinary tip-ordin #2:MERGED');
        expect(lines).toContain('deleted 2, already gone 0, kept at re-check 0, remaining spent 0');
    });

    it('keeps the branch that still holds a recorded revision alongside an unresolvable one', () => {
        // The resolver must keep working for the revisions after the gone one, or the branch that is
        // the last remote holder of a live revision gets deleted and breaks the required Gate on main.
        const goneRevision = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
        const heldRevision = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2';
        const { port, deleteCalls } = fakePort({
            branches: [branch('holder', 'tip-holder'), branch('other', 'tip-other')],
            pullRequestsFor: () =>
                new Map([
                    ['holder', [mergedPr(1, 'tip-holder')]],
                    ['other', [mergedPr(2, 'tip-other')]],
                ]),
            recordedMeasurementRevisions: () => [goneRevision, heldRevision],
            baseBranchTip: () => branch('main', 'tip-main'),
            branchHoldsRevision: (candidate, revision) => {
                if (revision === goneRevision) {
                    throw new Error('gh: Not Found (HTTP 404)');
                }
                return candidate.name === 'holder';
            },
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual(['other']);
        expect(lines).toContain(`kept holder: last remote holder of recorded measurement revision ${heldRevision}`);
    });

    it('refuses the whole run without deleting anything when a revision comparison cannot be answered', () => {
        // Only a comparison GitHub itself confirms gone may be reported and skipped. A rate limit,
        // network failure, or unexpected response shape leaves reachability unknown, and an unknown
        // answer must never be treated as "no branch holds it": a wrong skip deletes the last remote
        // holder of a live measurement revision. The confirmed-gone classification is the only
        // reason to continue, so any other failure escapes pruneRemoteBranches before the plan prints.
        const { port, deleteCalls } = fakePort({
            branches: [branch('measured', 'tip-measured')],
            pullRequestsFor: () => new Map([['measured', [mergedPr(1, 'tip-measured')]]]),
            recordedMeasurementRevisions: () => ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
            branchHoldsRevision: () => {
                throw new Error('gh: API rate limit exceeded for installation (HTTP 403)');
            },
        });
        const { log, lines } = collectingLog();

        expect(() => pruneRemoteBranches(applyArgs(), port, log)).toThrow(
            'gh: API rate limit exceeded for installation (HTTP 403)'
        );
        expect(deleteCalls).toEqual([]);
        expect(lines).not.toContain(
            'unresolvable measurement revision bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: no remote branch holds it'
        );
        expect(lines.some((line) => line.startsWith('spent: '))).toBe(false);
    });

    it('reports only the gone revision and still refuses an unanswerable comparison reached alongside it', () => {
        // The catch must discriminate on the confirmed-gone comparison, not on "some comparison
        // failed": a first revision the remote confirms gone is reported and skipped, a later
        // unanswerable one must still escape. Replacing the 404 classification with a bare catch
        // would therefore report the second revision as gone and return normally.
        const goneRevision = 'ccccccccccccccccccccccccccccccccccccccc1';
        const unanswerableRevision = 'ccccccccccccccccccccccccccccccccccccccc2';
        const { port, deleteCalls } = fakePort({
            branches: [branch('spent-branch', 'tip-spent')],
            pullRequestsFor: () => new Map([['spent-branch', [mergedPr(1, 'tip-spent')]]]),
            recordedMeasurementRevisions: () => [goneRevision, unanswerableRevision],
            baseBranchTip: () => branch('main', 'tip-main'),
            branchHoldsRevision: (_candidate, revision) => {
                if (revision === goneRevision) {
                    throw new Error('gh: Not Found (HTTP 404)');
                }
                throw new Error('gh: unexpected end of JSON input');
            },
        });
        const { log, lines } = collectingLog();

        expect(() => pruneRemoteBranches(applyArgs(), port, log)).toThrow('gh: unexpected end of JSON input');
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain(`unresolvable measurement revision ${goneRevision}: no remote branch holds it`);
        expect(lines).not.toContain(
            `unresolvable measurement revision ${unanswerableRevision}: no remote branch holds it`
        );
    });

    it('retains a later holder when an earlier listed branch cannot be compared', () => {
        // gh answers the same 404 for a vanished branch tip as for a missing revision, so a branch
        // that cannot be compared must mean only "this branch holds nothing". Aborting the scan
        // there would both discard holders already found and abandon the remaining branches, so the
        // resolver would answer no holders and the prune would delete the branch that is the
        // revision's last remote holder. The reference branch is compared successfully, so the
        // revision is provably live and must never be reported as unresolvable.
        const revision = '9999999999999999999999999999999999999999';
        const { port, deleteCalls } = fakePort({
            branches: [
                branch('vanished', 'tip-vanished'),
                branch('measured', 'tip-measured'),
                branch('ordinary', 'tip-ordinary'),
            ],
            pullRequestsFor: () =>
                new Map([
                    ['vanished', [openPr(9, 'tip-elsewhere')]],
                    ['measured', [mergedPr(1, 'tip-measured')]],
                    ['ordinary', [mergedPr(2, 'tip-ordinary')]],
                ]),
            recordedMeasurementRevisions: () => [revision],
            baseBranchTip: () => branch('reference', 'tip-reference'),
            branchHoldsRevision: (candidate) => {
                if (candidate.name === 'vanished') {
                    throw new Error('gh: Not Found (HTTP 404)');
                }
                return candidate.name === 'measured';
            },
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual(['ordinary']);
        expect(lines).toContain(`kept measured: last remote holder of recorded measurement revision ${revision}`);
        expect(lines.some((line) => line.startsWith('unresolvable measurement revision'))).toBe(false);
    });

    it('does not retain a holder when a surviving branch still holds the recorded revision', () => {
        const { port, deleteCalls } = fakePort({
            branches: [branch('measured', 'tip-measured'), branch('other', 'tip-other')],
            pullRequestsFor: () =>
                new Map([
                    ['measured', [mergedPr(1, 'tip-measured')]],
                    ['other', [openPr(2, 'tip-other')]],
                ]),
            recordedMeasurementRevisions: () => ['3333333333333333333333333333333333333333'],
            branchHoldsRevision: () => true,
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual(['measured']);
        expect(lines.some((line) => line.startsWith('kept measured:'))).toBe(false);
    });

    it('does not retain a holder when the recorded revision already reached the protected base branch', () => {
        const { port, deleteCalls } = fakePort({
            branches: [branch('main', 'tip-main'), branch('measured', 'tip-measured')],
            pullRequestsFor: () =>
                new Map([
                    ['main', [mergedPr(1, 'tip-main')]],
                    ['measured', [mergedPr(2, 'tip-measured')]],
                ]),
            recordedMeasurementRevisions: () => ['4444444444444444444444444444444444444444'],
            branchHoldsRevision: (candidate) => candidate.name === 'main' || candidate.name === 'measured',
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual(['measured']);
        expect(lines.some((line) => line.startsWith('kept measured:'))).toBe(false);
    });

    it('retains every holder when each holder of the recorded revision would itself be deleted', () => {
        const { port, deleteCalls } = fakePort({
            branches: [branch('first', 'tip-first'), branch('second', 'tip-second')],
            pullRequestsFor: () =>
                new Map([
                    ['first', [mergedPr(1, 'tip-first')]],
                    ['second', [mergedPr(2, 'tip-second')]],
                ]),
            recordedMeasurementRevisions: () => ['5555555555555555555555555555555555555555'],
            branchHoldsRevision: () => true,
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(applyArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain(
            'kept first: last remote holder of recorded measurement revision 5555555555555555555555555555555555555555'
        );
        expect(lines).toContain(
            'kept second: last remote holder of recorded measurement revision 5555555555555555555555555555555555555555'
        );
    });

    it('reports a retained measurement holder on a dry run without deleting anything', () => {
        const target = branch('measured', 'tip-measured');
        const { port, deleteCalls } = fakePort({
            branches: [target],
            pullRequestsFor: () => new Map([['measured', [mergedPr(1, 'tip-measured')]]]),
            recordedMeasurementRevisions: () => ['6666666666666666666666666666666666666666'],
            branchHoldsRevision: () => true,
        });
        const { log, lines } = collectingLog();

        expect(pruneRemoteBranches(dryArgs(), port, log)).toBe(0);
        expect(deleteCalls).toEqual([]);
        expect(lines).toContain(
            'kept measured: last remote holder of recorded measurement revision 6666666666666666666666666666666666666666'
        );
        expect(lines).toContain('dry run: 0 branches would be deleted; pass --apply to delete');
    });
});

describe('recordedRevisionsInTables', () => {
    it('derives the recorded revisions from the table contents, sorted and deduplicated', () => {
        expect(
            recordedRevisionsInTables([
                JSON.stringify({ sourceRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
                JSON.stringify({ sourceRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
                JSON.stringify({ sourceRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
            ])
        ).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
    });

    it('ignores a table that records no full hexadecimal revision', () => {
        expect(
            recordedRevisionsInTables([
                JSON.stringify({ sourceRevision: 'not-a-revision' }),
                JSON.stringify({ machine: {} }),
            ])
        ).toEqual([]);
    });
});

describe('branchHoldsRevision', () => {
    it('compares the revision against the branch tip on GitHub and accepts ahead or identical', () => {
        const calls: string[][] = [];
        const statuses = ['ahead', 'identical', 'behind', 'diverged'];
        const runner = (args: string[]): string => {
            calls.push(args);
            return statuses[calls.length - 1] ?? '';
        };
        const target = branch('alpha', 'tip-alpha');

        expect(branchHoldsRevision(target, 'revision-sha', runner)).toBe(true);
        expect(branchHoldsRevision(target, 'revision-sha', runner)).toBe(true);
        expect(branchHoldsRevision(target, 'revision-sha', runner)).toBe(false);
        expect(branchHoldsRevision(target, 'revision-sha', runner)).toBe(false);
        expect(calls[0]).toEqual([
            'api',
            `repos/${REQUIRED_REPOSITORY}/compare/revision-sha...tip-alpha`,
            '--jq',
            '.status',
        ]);
    });

    it('propagates a comparison that cannot be answered instead of guessing', () => {
        const runner = (): string => {
            throw new Error('gh: Not Found (HTTP 404)');
        };

        expect(() => branchHoldsRevision(branch('alpha', 'tip-alpha'), 'revision-sha', runner)).toThrow(
            'gh: Not Found (HTTP 404)'
        );
    });

    it('propagates an HTTP 404 that carries no resolvable revision, such as a malformed revision name', () => {
        const runner = (): string => {
            throw new Error('gh: Not Found (HTTP 404)');
        };

        expect(() => branchHoldsRevision(branch('alpha', 'tip-alpha'), 'revision-sha', runner)).toThrow(
            'gh: Not Found (HTTP 404)'
        );
    });
});

describe('pruneRemoteBranches comparison-failure classification', () => {
    const revision = 'dddddddddddddddddddddddddddddddddddddddd';

    function pruneWithComparisonFailure(failure: (branch: RemoteBranch, revision: string) => boolean): {
        deleteCalls: string[];
        lines: string[];
    } {
        const { port, deleteCalls } = fakePort({
            branches: [branch('measured', 'tip-measured')],
            pullRequestsFor: () => new Map([['measured', [mergedPr(1, 'tip-measured')]]]),
            recordedMeasurementRevisions: () => [revision],
            baseBranchTip: () => branch('main', 'tip-main'),
            branchHoldsRevision: failure,
        });
        const { log, lines } = collectingLog();
        expect(() => pruneRemoteBranches(applyArgs(), port, log)).toThrow();
        expect(deleteCalls).toEqual([]);
        expect(lines).not.toContain(`unresolvable measurement revision ${revision}: no remote branch holds it`);
        return { deleteCalls, lines };
    }

    it('refuses the run on a rate limit rather than treating an unknown reachability answer as gone', () => {
        expect(
            pruneWithComparisonFailure(() => {
                throw new Error('gh: API rate limit exceeded for installation (HTTP 403)');
            }).deleteCalls
        ).toEqual([]);
    });

    it('refuses the run on a server fault or a gateway response', () => {
        pruneWithComparisonFailure(() => {
            throw new Error('gh: Server Error (HTTP 502)');
        });
        pruneWithComparisonFailure(() => {
            throw new Error('gh: Bad Gateway (HTTP 504)');
        });
    });

    it('refuses the run on a network failure or an unparsable response', () => {
        pruneWithComparisonFailure(() => {
            throw new Error('getaddrinfo ENOTFOUND api.github.com');
        });
        pruneWithComparisonFailure(() => {
            throw new Error('gh: unexpected end of JSON input');
        });
    });

    it('refuses the run when only the base comparison cannot be answered, so an unproven revision is never skipped', () => {
        // A 404 on every listed branch is not proof on its own: if the independent base comparison
        // fails for any other reason, reachability is unknown and the run must still refuse.
        pruneWithComparisonFailure((candidate) => {
            if (candidate.name === 'main') {
                throw new Error('gh: Server Error (HTTP 502)');
            }
            throw new Error('gh: Not Found (HTTP 404)');
        });
    });

    it('refuses the run on an HTTP 404 for a revision that is not full hexadecimal, so a malformed name never reads as gone', () => {
        const { port, deleteCalls } = fakePort({
            branches: [branch('measured', 'tip-measured')],
            pullRequestsFor: () => new Map([['measured', [mergedPr(1, 'tip-measured')]]]),
            recordedMeasurementRevisions: () => ['revision-sha'],
            baseBranchTip: () => branch('main', 'tip-main'),
            branchHoldsRevision: () => {
                throw new Error('gh: Not Found (HTTP 404)');
            },
        });
        const { log, lines } = collectingLog();
        expect(() => pruneRemoteBranches(applyArgs(), port, log)).toThrow('gh: Not Found (HTTP 404)');
        expect(deleteCalls).toEqual([]);
        expect(lines).not.toContain('unresolvable measurement revision revision-sha: no remote branch holds it');
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
