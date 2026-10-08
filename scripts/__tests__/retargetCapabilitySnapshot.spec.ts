import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    captureCapabilitySnapshot,
    parseRestPageOutput,
    parseRetargetCapabilityArgs,
    runRetargetCapabilityPlanCli,
    verifyRetargetCapabilitySource,
    type CapabilityReadPort,
    type ListPage,
} from '../retargetCapabilitySnapshot.ts';

import type { GhSession } from '../githubAppIdentity.ts';

const SOURCE = 'a'.repeat(40);
const REPOSITORY = {
    id: 1183242917,
    node_id: 'R_kgDORobapQ',
    full_name: 'jcosta33/sourdaw',
    default_branch: 'main',
    permissions: { admin: true },
    owner: { id: 8978270, node_id: 'MDQ6VXNlcjg5NzgyNzA=', login: 'jcosta33', type: 'User' },
};
const USER = { id: 8978270, node_id: 'MDQ6VXNlcjg5NzgyNzA=', type: 'User' };
const RULE = {
    id: 5,
    name: 'main',
    source: 'jcosta33/sourdaw',
    source_type: 'Repository',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{ type: 'pull_request' }],
    bypass_actors: [],
};
const CLASSIC = {
    id: 'classic-node',
    databaseId: 42,
    pattern: 'main',
    allowsDeletions: false,
    allowsForcePushes: false,
    blocksCreations: true,
    dismissesStaleReviews: true,
    isAdminEnforced: true,
    lockAllowsFetchAndMerge: false,
    lockBranch: false,
    requireLastPushApproval: true,
    requiredApprovingReviewCount: 1,
    requiredDeploymentEnvironments: [],
    requiredStatusCheckContexts: ['Gate'],
    requiredStatusChecks: [{ context: 'Gate', app: null }],
    requiresApprovingReviews: true,
    requiresCodeOwnerReviews: false,
    requiresCommitSignatures: false,
    requiresConversationResolution: true,
    requiresDeployments: false,
    requiresLinearHistory: true,
    requiresStatusChecks: true,
    requiresStrictStatusChecks: true,
    restrictsPushes: false,
    restrictsReviewDismissals: false,
};
const KINDS = [
    'pushAllowances',
    'bypassForcePushAllowances',
    'bypassPullRequestAllowances',
    'reviewDismissalAllowances',
] as const;

function rest(items: unknown[], nextPage: number | null = null): ListPage {
    return { items: items as ListPage['items'], nextPage };
}
function connection(nodes: unknown[], totalCount: number, hasNextPage = false, endCursor: string | null = null) {
    return { nodes, totalCount, pageInfo: { hasNextPage, endCursor } };
}
function fakePort() {
    const calls: string[] = [];
    const port: CapabilityReadPort = {
        user: () => {
            calls.push('user');
            return USER;
        },
        repository: () => {
            calls.push('repository');
            return REPOSITORY;
        },
        rulesetPage: (page) => {
            calls.push(`ruleset-page-${page}`);
            return page === 1 ? rest([RULE]) : rest([]);
        },
        ruleset: (ruleId) => {
            calls.push(`ruleset-${ruleId}`);
            return RULE;
        },
        effectiveBranch: (branch, page) => {
            calls.push(`effective-${branch}-${page}`);
            return rest([]);
        },
        exactMainProtection: () => {
            calls.push('main-classic-exact');
            return { required_status_checks: null };
        },
        classicPage: (cursor) => {
            calls.push(`classic-${String(cursor)}`);
            return {
                repository: {
                    id: REPOSITORY.node_id,
                    databaseId: REPOSITORY.id,
                    nameWithOwner: REPOSITORY.full_name,
                    defaultBranchRef: { name: 'main' },
                    viewerPermission: 'ADMIN',
                    branchProtectionRules: connection([CLASSIC], 1),
                },
            };
        },
        allowancePage: (kind, ruleId, cursor) => {
            calls.push(`${kind}-${ruleId}-${String(cursor)}`);
            const first = cursor === null;
            const actor = { __typename: 'User', id: USER.node_id, databaseId: USER.id, login: 'jcosta33' };
            const member = { id: `${kind}-${first ? 1 : 2}`, branchProtectionRule: { id: ruleId }, actor };
            return {
                node: {
                    id: ruleId,
                    repository: { id: REPOSITORY.node_id },
                    [kind]: connection([member], 2, first, first ? 'cursor-1' : 'cursor-2'),
                },
            };
        },
    };
    return { port, calls };
}

describe('bounded capability capture', () => {
    it('accepts only the next page of the same fixed REST endpoint', () => {
        const path = 'repos/jcosta33/sourdaw/rulesets?includes_parents=true';
        const good = `HTTP/2 200\r\nlink: <https://api.github.com/repos/jcosta33/sourdaw/rulesets?includes_parents=true&per_page=100&page=2>; rel="next"\r\n\r\n[]`;
        expect(parseRestPageOutput(good, path, 1).nextPage).toBe(2);
        expect(() => parseRestPageOutput(good.replace('api.github.com', 'example.test'), path, 1)).toThrow(
            /fixed endpoint/u
        );
        expect(() => parseRestPageOutput(good.replace('page=2', 'page=3'), path, 1)).toThrow(/fixed endpoint/u);
        expect(() => parseRestPageOutput(good.replace('&page=2', '&page=2&dry_run=false'), path, 1)).toThrow(
            /fixed endpoint/u
        );
    });
    it('enumerates REST rulesets and every classic allowance page with immutable bindings', () => {
        const { port, calls } = fakePort();
        const result = captureCapabilitySnapshot(port);
        expect(result.rulesets).toEqual([RULE]);
        expect(result.classic).toHaveLength(1);
        for (const kind of KINDS) {
            expect(calls).toContain(`${kind}-classic-node-null`);
            expect(calls).toContain(`${kind}-classic-node-cursor-1`);
            expect(result.classic[0].allowances[kind]).toHaveLength(2);
        }
        expect(calls).toContain('effective-main-1');
        expect(result.limitations).toEqual([]);
    });

    it('reports inaccessible inherited bypass and effective rules as incomplete', () => {
        const { port } = fakePort();
        const changed: CapabilityReadPort = {
            ...port,
            ruleset: () => ({ ...RULE, bypass_actors: null }),
            effectiveBranch: () => {
                throw new Error('access denied');
            },
        };
        const result = captureCapabilitySnapshot(changed);
        expect(result.limitations).toContain('ruleset bypass actors unavailable');
        expect(result.limitations).toContain('effective rules unavailable for main');
    });

    it.each([
        ['missing nodes', () => ({ nodes: null, totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null } })],
        ['wrong total', () => connection([CLASSIC], 2)],
        ['stalled cursor', () => connection([CLASSIC], 2, true, 'same')],
    ])('refuses incomplete classic pagination: %s', (_label, makePage) => {
        const { port } = fakePort();
        const broken: CapabilityReadPort = {
            ...port,
            classicPage: () => ({
                repository: {
                    id: REPOSITORY.node_id,
                    databaseId: REPOSITORY.id,
                    nameWithOwner: REPOSITORY.full_name,
                    defaultBranchRef: { name: 'main' },
                    viewerPermission: 'ADMIN',
                    branchProtectionRules: makePage(),
                },
            }),
        };
        expect(() => captureCapabilitySnapshot(broken)).toThrow();
    });

    it('refuses a classic rule whose queried protection fields are missing', () => {
        const { port } = fakePort();
        const broken: CapabilityReadPort = {
            ...port,
            classicPage: () => ({
                repository: {
                    id: REPOSITORY.node_id,
                    databaseId: REPOSITORY.id,
                    nameWithOwner: REPOSITORY.full_name,
                    defaultBranchRef: { name: 'main' },
                    viewerPermission: 'ADMIN',
                    branchProtectionRules: connection([{ id: 'classic-node', pattern: 'main' }], 1),
                },
            }),
        };
        expect(() => captureCapabilitySnapshot(broken)).toThrow(/classic rule identity is incomplete/u);
    });

    it('refuses a changed policy between observed captures and disposes the session', () => {
        const { port } = fakePort();
        let captures = 0;
        const disposed = vi.fn();
        const print = vi.fn();
        const session = { dispose: disposed } as unknown as GhSession;
        const result = () =>
            runRetargetCapabilityPlanCli([], {
                sourceCheck: () => SOURCE,
                primaryRoot: () => '/primary',
                authenticate: () => ({ minted: { actorNodeId: USER.node_id }, session }),
                readPort: () => ({
                    ...port,
                    ruleset: () => {
                        captures += 1;
                        return { ...RULE, rules: [{ type: 'pull_request', marker: captures }] };
                    },
                }),
                now: () => '2026-10-08T00:00:00.000Z',
                print,
            });
        expect(result).toThrow(/changed during capture/u);
        expect(disposed).toHaveBeenCalledOnce();
        expect(print).not.toHaveBeenCalled();
    });

    it('refuses flags before authentication and emits one inactive canonical plan for stable reads', () => {
        expect(parseRetargetCapabilityArgs(['--help'])).toBe('help');
        expect(() => parseRetargetCapabilityArgs(['--apply'])).toThrow(/usage/u);
        const auth = vi.fn();
        expect(() =>
            runRetargetCapabilityPlanCli(['--host', 'example'], {
                sourceCheck: vi.fn(),
                primaryRoot: vi.fn(),
                authenticate: auth,
                readPort: vi.fn(),
                now: vi.fn(),
                print: vi.fn(),
            })
        ).toThrow(/usage/u);
        expect(auth).not.toHaveBeenCalled();
        const { port } = fakePort();
        const disposed = vi.fn();
        const print = vi.fn();
        expect(
            runRetargetCapabilityPlanCli([], {
                sourceCheck: () => SOURCE,
                primaryRoot: () => '/primary',
                authenticate: () => ({
                    minted: { actorNodeId: USER.node_id },
                    session: { dispose: disposed } as unknown as GhSession,
                }),
                readPort: () => port,
                now: () => '2026-10-08T00:00:00.000Z',
                print,
            })
        ).toBe(0);
        const emitted = JSON.parse(print.mock.calls[0][0]);
        expect(print).toHaveBeenCalledOnce();
        expect(emitted.activationEligible).toBe(false);
        expect(emitted.sourceSha).toBe(SOURCE);
        expect(disposed).toHaveBeenCalledOnce();
    });
});

describe('landed source provenance', () => {
    const root = '/owned';
    const entry = join(root, 'scripts/retargetCapabilitySnapshot.ts');
    const files = new Map([
        [entry, "import './dependency.ts';\n"],
        [join(root, 'scripts/dependency.ts'), 'export const fixed = true;\n'],
        [join(root, 'package.json'), '{"scripts":{"retarget:plan":"node scripts/retargetCapabilitySnapshot.ts"}}'],
    ]);
    const readFile = (path: string) => {
        const value = files.get(path);
        if (value === undefined) {
            throw new Error('missing fixture path');
        }
        return value;
    };
    it('checks entry, transitive dependency, and package route against one pinned commit', () => {
        const readOrigin = vi.fn((path: string, revision: string) => {
            expect(revision).toBe(SOURCE);
            return readFile(join(root, path));
        });
        verifyRetargetCapabilitySource(entry, root, SOURCE, readFile, readOrigin);
        expect(readOrigin.mock.calls.map(([path]) => path)).toEqual([
            'scripts/dependency.ts',
            'scripts/retargetCapabilitySnapshot.ts',
            'package.json',
        ]);
    });
    it('refuses absent and changed dependency or package blobs', () => {
        expect(() =>
            verifyRetargetCapabilitySource(entry, root, SOURCE, readFile, (path) =>
                path === 'scripts/dependency.ts' ? undefined : readFile(join(root, path))
            )
        ).toThrow(/no blob/u);
        expect(() =>
            verifyRetargetCapabilitySource(entry, root, SOURCE, readFile, (path) =>
                path === 'scripts/dependency.ts' ? 'changed' : readFile(join(root, path))
            )
        ).toThrow(/does not match/u);
        expect(() =>
            verifyRetargetCapabilitySource(entry, root, SOURCE, readFile, (path) =>
                path === 'package.json' ? 'changed' : readFile(join(root, path))
            )
        ).toThrow(/does not match/u);
    });

    it('refuses an import added after closure enumeration and a changed package route', () => {
        let entryReads = 0;
        const changingRead = (path: string) => {
            if (path !== entry) {
                return readFile(path);
            }
            entryReads += 1;
            return entryReads === 1 ? readFile(path) : "import './other.ts';\n";
        };
        expect(() =>
            verifyRetargetCapabilitySource(entry, root, SOURCE, changingRead, (path) =>
                path === 'scripts/retargetCapabilitySnapshot.ts' ? "import './other.ts';\n" : readFile(join(root, path))
            )
        ).toThrow(/unlisted local dependency/u);
        const changedPackage = '{"scripts":{"retarget:plan":"node scripts/other.ts"}}';
        expect(() =>
            verifyRetargetCapabilitySource(
                entry,
                root,
                SOURCE,
                (path) => (path === join(root, 'package.json') ? changedPackage : readFile(path)),
                (path) => (path === 'package.json' ? changedPackage : readFile(join(root, path)))
            )
        ).toThrow(/route changed/u);
    });
});
