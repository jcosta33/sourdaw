import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { TRUSTED_GH_PATH_ENV } from '../prContract.ts';
import {
    captureCapabilitySnapshot,
    parseRestPageOutput,
    parseRetargetCapabilityArgs,
    runRetargetCapabilityPlanCli,
    shellCapabilityReadPort,
    verifyRetargetCapabilitySource,
    type CapabilityReadPort,
    type ListPage,
} from '../retargetCapabilitySnapshot.ts';

import type { JsonValue } from '../canonicalRecord.ts';
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
const EXACT_MAIN_PROTECTION = {
    url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
    required_status_checks: null,
    enforce_admins: { enabled: false },
    required_pull_request_reviews: null,
    restrictions: null,
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

function rest(items: JsonValue[], nextPage: number | null = null): ListPage {
    return { items, nextPage };
}
function connection(nodes: JsonValue[], totalCount: number, hasNextPage = false, endCursor: string | null = null) {
    return { nodes, totalCount, pageInfo: { hasNextPage, endCursor } };
}
function requiredRecord(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
    if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} is missing from the test fixture`);
    }
    return value;
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
            return EXACT_MAIN_PROTECTION;
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
    it('routes all eight read methods and four allowance variants through the supplied capture', () => {
        const calls: Array<{ command: string; args: string[] }> = [];
        const capture = (command: string, args: string[]) => {
            calls.push({ command, args });
            if (args.includes('graphql')) {
                return '{"data":{}}';
            }
            return args.includes('-i') ? 'HTTP/2 200\n\n[]' : '{}';
        };
        const session: GhSession = {
            configDir: '/unused',
            env: { [TRUSTED_GH_PATH_ENV]: '/retarget-test/nonexistent-gh' },
            dispose: vi.fn(),
        };
        const port = shellCapabilityReadPort(session, '/primary', capture);
        port.user();
        port.repository();
        port.rulesetPage(2);
        port.ruleset(55);
        port.effectiveBranch('Case.Mixed', 3);
        port.exactMainProtection();
        port.classicPage('@cursor');
        for (const kind of KINDS) {
            port.allowancePage(kind, '@rule', '42');
        }
        expect(calls).toHaveLength(11);
        expect(calls.every(({ command }) => command === 'gh')).toBe(true);
        const restCalls = calls.filter(({ args }) => !args.includes('graphql'));
        expect(restCalls.map(({ args }) => args.slice(0, 3))).toEqual(
            Array.from({ length: 6 }, () => ['api', '--hostname', 'github.com'])
        );
        expect(restCalls.map(({ args }) => args.at(-1))).toEqual([
            'user',
            'repos/jcosta33/sourdaw',
            'repos/jcosta33/sourdaw/rulesets?includes_parents=true&per_page=100&page=2',
            'repos/jcosta33/sourdaw/rulesets/55?includes_parents=true',
            'repos/jcosta33/sourdaw/rules/branches/Case.Mixed?per_page=100&page=3',
            'repos/jcosta33/sourdaw/branches/main/protection',
        ]);
        expect(restCalls.filter(({ args }) => args.includes('-i'))).toHaveLength(2);
        expect(restCalls.every(({ args }) => !args.includes('-X') && !args.includes('-f'))).toBe(true);
        const graphCalls = calls.filter(({ args }) => args.includes('graphql'));
        expect(graphCalls).toHaveLength(5);
        expect(graphCalls.every(({ args }) => args.some((value) => value.startsWith('query=query Retarget')))).toBe(
            true
        );
        expect(graphCalls[0]?.args).toContain('cursor=@cursor');
        for (const { args } of graphCalls.slice(1)) {
            expect(args).toEqual(expect.arrayContaining(['ruleId=@rule', 'cursor=42']));
        }
    });

    it('passes opaque GraphQL cursors and node IDs as literal string fields', () => {
        const calls: string[][] = [];
        const spawn = (_command: string, args: string[]) => {
            calls.push(args);
            return '{"data":{}}';
        };
        const port = shellCapabilityReadPort({ configDir: '/unused', env: {}, dispose: vi.fn() }, '/primary', spawn);
        port.classicPage('@cursor');
        port.classicPage('true');
        port.allowancePage('pushAllowances', '@rule', '42');
        port.allowancePage('bypassForcePushAllowances', '123', '@cursor');
        port.allowancePage('bypassPullRequestAllowances', 'false', null);
        port.allowancePage('reviewDismissalAllowances', '42', 'false');
        expect(calls).toHaveLength(6);
        for (const args of calls) {
            expect(args).toContain('graphql');
            expect(args).toContain('-f');
            expect(args.some((value) => value.startsWith('query=query Retarget'))).toBe(true);
            expect(args).not.toContain('-F');
        }
        expect(calls[0]).toContain('cursor=@cursor');
        expect(calls[1]).toContain('cursor=true');
        expect(calls[2]).toEqual(expect.arrayContaining(['ruleId=@rule', 'cursor=42']));
        expect(calls[3]).toEqual(expect.arrayContaining(['ruleId=123', 'cursor=@cursor']));
        expect(calls[4]).toContain('ruleId=false');
        expect(calls[5]).toEqual(expect.arrayContaining(['ruleId=42', 'cursor=false']));
    });

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
        const classicRule = result.classic[0];
        if (classicRule === undefined) {
            throw new Error('expected one captured classic rule');
        }
        const allowances = requiredRecord(classicRule.allowances, 'classic allowances');
        for (const kind of KINDS) {
            expect(calls).toContain(`${kind}-classic-node-null`);
            expect(calls).toContain(`${kind}-classic-node-cursor-1`);
            const entries = allowances[kind];
            if (!Array.isArray(entries)) {
                throw new TypeError(`missing ${kind} connection entries`);
            }
            expect(entries).toHaveLength(2);
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
        const session: GhSession = { configDir: '/unused', env: {}, dispose: disposed };
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
        const printed: string[] = [];
        const print = vi.fn((value: string) => {
            printed.push(value);
        });
        expect(
            runRetargetCapabilityPlanCli([], {
                sourceCheck: () => SOURCE,
                primaryRoot: () => '/primary',
                authenticate: () => ({
                    minted: { actorNodeId: USER.node_id },
                    session: { configDir: '/unused', env: {}, dispose: disposed },
                }),
                readPort: () => port,
                now: () => '2026-10-08T00:00:00.000Z',
                print,
            })
        ).toBe(0);
        const printedValue = printed[0];
        if (printedValue === undefined) {
            throw new Error('expected one emitted capability plan');
        }
        const emitted: unknown = JSON.parse(printedValue);
        if (
            typeof emitted !== 'object' ||
            emitted === null ||
            Array.isArray(emitted) ||
            !('activationEligible' in emitted) ||
            !('sourceSha' in emitted)
        ) {
            throw new Error('emitted capability plan is not an object');
        }
        expect(print).toHaveBeenCalledOnce();
        expect(emitted.activationEligible).toBe(false);
        expect(emitted.sourceSha).toBe(SOURCE);
        expect(disposed).toHaveBeenCalledOnce();
    });

    it('emits an explicit limitation for two stable reads with a null required-check list', () => {
        const { port } = fakePort();
        const disposed = vi.fn();
        const printed: string[] = [];
        const result = runRetargetCapabilityPlanCli([], {
            sourceCheck: () => SOURCE,
            primaryRoot: () => '/primary',
            authenticate: () => ({
                minted: { actorNodeId: USER.node_id },
                session: { configDir: '/unused', env: {}, dispose: disposed },
            }),
            readPort: () => ({
                ...port,
                ruleset: () => ({
                    ...RULE,
                    rules: [
                        {
                            type: 'required_status_checks',
                            parameters: { strict_required_status_checks_policy: false, required_status_checks: null },
                        },
                    ],
                }),
            }),
            now: () => '2026-10-08T00:00:00.000Z',
            print: (value) => printed.push(value),
        });
        expect(result).toBe(0);
        expect(printed).toHaveLength(1);
        const value = printed[0];
        if (value === undefined) {
            throw new Error('expected one emitted capability plan');
        }
        const emitted: unknown = JSON.parse(value);
        expect(emitted).toMatchObject({
            completeObservedInventory: false,
            limitations: ['an applicable ruleset has incomplete required status checks'],
            activationEligible: false,
        });
        expect(disposed).toHaveBeenCalledOnce();
    });

    it('prints incomplete exact-main classic binding after two stable CLI captures', () => {
        const { port } = fakePort();
        const disposed = vi.fn();
        const printed: string[] = [];
        let exactReads = 0;
        const protection = {
            ...EXACT_MAIN_PROTECTION,
            required_status_checks: {
                url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection/required_status_checks',
                contexts_url:
                    'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection/required_status_checks/contexts',
                strict: false,
                contexts: ['Gate'],
                checks: [{ context: 'Gate', app_id: { unreadable: true } }],
            },
        };
        const result = runRetargetCapabilityPlanCli([], {
            sourceCheck: () => SOURCE,
            primaryRoot: () => '/primary',
            authenticate: () => ({
                minted: { actorNodeId: USER.node_id },
                session: { configDir: '/unused', env: {}, dispose: disposed },
            }),
            readPort: () => ({
                ...port,
                exactMainProtection: () => {
                    exactReads += 1;
                    return protection;
                },
            }),
            now: () => '2026-10-08T00:00:00.000Z',
            print: (value) => printed.push(value),
        });
        expect(result).toBe(0);
        expect(exactReads).toBe(2);
        expect(printed).toHaveLength(1);
        const output = printed[0];
        if (output === undefined) {
            throw new Error('expected one emitted capability plan');
        }
        const emitted: unknown = JSON.parse(output);
        expect(emitted).toMatchObject({
            completeObservedInventory: false,
            limitations: ['exact main classic protection is incomplete'],
            activationEligible: false,
        });
        expect(disposed).toHaveBeenCalledOnce();
    });

    it.each(['detail', 'effective'] as const)(
        'does not certify two equal captures with absent required-check parameters in %s policy',
        (surface) => {
            const { port } = fakePort();
            const disposed = vi.fn();
            const printed: string[] = [];
            let policyReads = 0;
            const result = runRetargetCapabilityPlanCli([], {
                sourceCheck: () => SOURCE,
                primaryRoot: () => '/primary',
                authenticate: () => ({
                    minted: { actorNodeId: USER.node_id },
                    session: { configDir: '/unused', env: {}, dispose: disposed },
                }),
                readPort: () => ({
                    ...port,
                    ruleset: (id) => {
                        if (surface === 'detail') {
                            policyReads += 1;
                            return { ...RULE, rules: [{ type: 'required_status_checks' }] };
                        }
                        return port.ruleset(id);
                    },
                    effectiveBranch: (branch, page) => {
                        if (surface === 'effective' && branch === 'main') {
                            policyReads += 1;
                            return rest([{ type: 'required_status_checks' }]);
                        }
                        return port.effectiveBranch(branch, page);
                    },
                }),
                now: () => '2026-10-08T00:00:00.000Z',
                print: (value) => printed.push(value),
            });
            expect(result).toBe(0);
            expect(policyReads).toBe(2);
            expect(printed).toHaveLength(1);
            const output = printed[0];
            if (output === undefined) {
                throw new Error('expected one emitted capability plan');
            }
            const emitted: unknown = JSON.parse(output);
            expect(emitted).toMatchObject({
                completeObservedInventory: false,
                limitations: ['an applicable ruleset has incomplete required status checks'],
                activationEligible: false,
            });
            expect(disposed).toHaveBeenCalledOnce();
        }
    );

    it.each(['detail', 'effective'] as const)(
        'does not certify two equal captures with a malformed optional check binding in %s policy',
        (surface) => {
            const { port } = fakePort();
            const disposed = vi.fn();
            const printed: string[] = [];
            let policyReads = 0;
            const requiredCheck = {
                type: 'required_status_checks',
                parameters: {
                    strict_required_status_checks_policy: false,
                    required_status_checks: [{ context: 'Gate', integration_id: { unreadable: true } }],
                },
            };
            const result = runRetargetCapabilityPlanCli([], {
                sourceCheck: () => SOURCE,
                primaryRoot: () => '/primary',
                authenticate: () => ({
                    minted: { actorNodeId: USER.node_id },
                    session: { configDir: '/unused', env: {}, dispose: disposed },
                }),
                readPort: () => ({
                    ...port,
                    ruleset: (id) => {
                        if (surface === 'detail') {
                            policyReads += 1;
                            return { ...RULE, rules: [requiredCheck] };
                        }
                        return port.ruleset(id);
                    },
                    effectiveBranch: (branch, page) => {
                        if (surface === 'effective' && branch === 'main') {
                            policyReads += 1;
                            return rest([requiredCheck]);
                        }
                        return port.effectiveBranch(branch, page);
                    },
                }),
                now: () => '2026-10-08T00:00:00.000Z',
                print: (value) => printed.push(value),
            });
            expect(result).toBe(0);
            expect(policyReads).toBe(2);
            expect(printed).toHaveLength(1);
            const output = printed[0];
            if (output === undefined) {
                throw new Error('expected one emitted capability plan');
            }
            const emitted: unknown = JSON.parse(output);
            expect(emitted).toMatchObject({
                completeObservedInventory: false,
                limitations: ['an applicable ruleset has incomplete required status checks'],
                activationEligible: false,
            });
            expect(disposed).toHaveBeenCalledOnce();
        }
    );

    const unreadableEffectiveMain: JsonValue[][] = [
        [
            {
                type: 'required_status_checks',
                parameters: { strict_required_status_checks_policy: false, required_status_checks: null },
            },
        ],
        [false],
        [{}],
        [{ type: 'unrecognized_policy_rule' }],
    ];
    it.each(unreadableEffectiveMain.map((rules) => ({ rules })))(
        'does not certify two equal captures with unreadable effective-main rules',
        ({ rules }) => {
            const { port } = fakePort();
            const disposed = vi.fn();
            const printed: string[] = [];
            let mainReads = 0;
            let result: number;
            try {
                result = runRetargetCapabilityPlanCli([], {
                    sourceCheck: () => SOURCE,
                    primaryRoot: () => '/primary',
                    authenticate: () => ({
                        minted: { actorNodeId: USER.node_id },
                        session: { configDir: '/unused', env: {}, dispose: disposed },
                    }),
                    readPort: () => ({
                        ...port,
                        effectiveBranch: (branch, page) => {
                            if (branch === 'main') {
                                mainReads += 1;
                                return rest(rules);
                            }
                            return port.effectiveBranch(branch, page);
                        },
                    }),
                    now: () => '2026-10-08T00:00:00.000Z',
                    print: (value) => printed.push(value),
                });
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect(mainReads).toBe(2);
                expect(printed).toEqual([]);
                expect(disposed).toHaveBeenCalledOnce();
                return;
            }
            expect(result).toBe(0);
            expect(mainReads).toBe(2);
            expect(printed).toHaveLength(1);
            const output = printed[0];
            if (output === undefined) {
                throw new Error('expected one emitted capability plan');
            }
            const emitted: unknown = JSON.parse(output);
            expect(emitted).toMatchObject({ completeObservedInventory: false, activationEligible: false });
            expect(disposed).toHaveBeenCalledOnce();
        }
    );

    const unreadableProtection: JsonValue[] = [null, false, [], {}, { unrelated: true }];
    it.each(unreadableProtection)('emits incomplete inventory for stable unreadable exact-main protection', (value) => {
        const { port } = fakePort();
        const disposed = vi.fn();
        const printed: string[] = [];
        const result = runRetargetCapabilityPlanCli([], {
            sourceCheck: () => SOURCE,
            primaryRoot: () => '/primary',
            authenticate: () => ({
                minted: { actorNodeId: USER.node_id },
                session: { configDir: '/unused', env: {}, dispose: disposed },
            }),
            readPort: () => ({ ...port, exactMainProtection: () => value }),
            now: () => '2026-10-08T00:00:00.000Z',
            print: (output) => printed.push(output),
        });
        expect(result).toBe(0);
        expect(printed).toHaveLength(1);
        const output = printed[0];
        if (output === undefined) {
            throw new Error('expected one emitted capability plan');
        }
        const emitted: unknown = JSON.parse(output);
        expect(emitted).toMatchObject({
            completeObservedInventory: false,
            limitations: ['exact main classic protection is incomplete'],
            activationEligible: false,
        });
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
