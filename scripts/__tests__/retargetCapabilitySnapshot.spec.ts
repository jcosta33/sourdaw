import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson, type JsonValue } from '../canonicalRecord.ts';
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
const CLASSIC_REPOSITORY = {
    id: REPOSITORY.node_id,
    databaseId: REPOSITORY.id,
    nameWithOwner: REPOSITORY.full_name,
    defaultBranchRef: { name: 'main' },
    viewerPermission: 'ADMIN',
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

function portWithClassicStatusApp(app: JsonValue): CapabilityReadPort {
    const { port } = fakePort();
    return {
        ...port,
        classicPage: () => ({
            repository: {
                id: REPOSITORY.node_id,
                databaseId: REPOSITORY.id,
                nameWithOwner: REPOSITORY.full_name,
                defaultBranchRef: { name: 'main' },
                viewerPermission: 'ADMIN',
                branchProtectionRules: connection(
                    [{ ...CLASSIC, requiredStatusChecks: [{ context: 'Gate', app }] }],
                    1
                ),
            },
        }),
    };
}

function portWithClassicMetadata(repository: JsonValue, rule: JsonValue, actor?: JsonValue): CapabilityReadPort {
    const { port } = fakePort();
    const withClassic: CapabilityReadPort = {
        ...port,
        classicPage: () => ({
            repository: {
                ...requiredRecord(repository, 'classic repository'),
                branchProtectionRules: connection([rule], 1),
            },
        }),
    };
    if (actor === undefined) {
        return withClassic;
    }
    return {
        ...withClassic,
        allowancePage: (kind, ruleId) => ({
            node: {
                id: ruleId,
                repository: { id: REPOSITORY.node_id },
                [kind]: connection([{ id: `${kind}-node`, branchProtectionRule: { id: ruleId }, actor }], 1),
            },
        }),
    };
}

function runStableClassicCli(port: CapabilityReadPort) {
    const order: string[] = [];
    const printed: string[] = [];
    const disposed = vi.fn();
    let classicReads = 0;
    const run = () =>
        runRetargetCapabilityPlanCli([], {
            sourceCheck: () => {
                order.push('source');
                return SOURCE;
            },
            primaryRoot: () => {
                order.push('primary');
                return '/primary';
            },
            authenticate: () => {
                order.push('authenticate');
                return {
                    minted: { actorNodeId: USER.node_id },
                    session: { configDir: '/unused', env: {}, dispose: disposed },
                };
            },
            readPort: () => {
                order.push('readPort');
                return {
                    ...port,
                    classicPage: (cursor) => {
                        classicReads += 1;
                        return port.classicPage(cursor);
                    },
                };
            },
            now: () => '2026-10-08T00:00:00.000Z',
            print: (value) => printed.push(value),
        });
    return { run, order, printed, disposed, classicReads: () => classicReads };
}

const CLI_DATE = '2026-10-08T00:00:00.000Z';

function largeStablePolicy() {
    return Array.from({ length: 50 }, (_, index) => ({
        id: index + 1,
        name: `main-policy-${index + 1}`,
        source: REPOSITORY.full_name,
        source_type: 'Repository',
        target: 'branch',
        enforcement: 'active',
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        rules: [
            {
                type: 'required_status_checks',
                parameters: {
                    strict_required_status_checks_policy: false,
                    required_status_checks: Array.from({ length: 10 }, (_, check) => ({
                        context: `policy-${index + 1}-check-${check + 1}-${'a'.repeat(70)}`,
                        integration_id: 1234,
                    })),
                },
            },
        ],
        bypass_actors: [],
    }));
}

async function runNativePlanWithPipe(failRead: boolean) {
    const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const fixtureRoot = mkdtempSync(join(realpathSync(tmpdir()), 'retarget-plan-pipe-'));
    const rulesets = largeStablePolicy();
    const disposePath = join(fixtureRoot, 'disposed');
    const backpressurePath = join(fixtureRoot, 'backpressure');
    const fixturePath = join(fixtureRoot, 'fixture.mjs');
    const preloadPath = join(fixtureRoot, 'preload.mjs');
    const fixture = `
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = ${JSON.stringify(root)};
const sha = ${JSON.stringify(SOURCE)};
const user = ${JSON.stringify(USER)};
const repository = ${JSON.stringify(REPOSITORY)};
const rulesets = ${JSON.stringify(rulesets)};
const exact = ${JSON.stringify(EXACT_MAIN_PROTECTION)};
const disposePath = ${JSON.stringify(disposePath)};
export function capture(command, args, options = {}) {
    if (command === 'git') {
        if (args.join(' ') === 'rev-parse --verify origin/main^{commit}') return sha;
        if (args[0] === 'cat-file' && args[1] === '-e' && args[2]?.startsWith(sha + ':')) {
            readFileSync(join(root, args[2].slice(sha.length + 1)), 'utf8');
            return '';
        }
        if (args[0] === 'show' && args[1]?.startsWith(sha + ':')) {
            const source = readFileSync(join(root, args[1].slice(sha.length + 1)), 'utf8');
            return options.trim === false ? source : source.trim();
        }
        if (args.join(' ') !== 'rev-parse --git-common-dir') throw Error('unexpected Git fixture command');
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
        if (result.status !== 0) throw Error('Git fixture failed');
        return result.stdout.trim();
    }
    if (command !== 'gh' || args[0] !== 'api') throw Error('external command refused');
    if (process.env.RETARGET_TEST_FAIL_READ === '1') throw Error('synthetic read failure');
    const header = 'HTTP/2 200 OK\\n\\n';
    const endpoint = args.find((arg) => arg.startsWith('repos/'));
    if (endpoint) {
        const route = endpoint.split('?')[0];
        if (route === 'repos/jcosta33/sourdaw') return JSON.stringify(repository);
        if (route === 'repos/jcosta33/sourdaw/rulesets') return header + JSON.stringify(rulesets);
        if (route.startsWith('repos/jcosta33/sourdaw/rulesets/')) return JSON.stringify(rulesets[Number(route.split('/').at(-1)) - 1]);
        if (route.startsWith('repos/jcosta33/sourdaw/rules/branches/')) {
            const effective = route.endsWith('/main') ? rulesets.map((ruleset) => ({
                ...ruleset.rules[0], ruleset_id: ruleset.id, ruleset_source_type: 'Repository',
                ruleset_source: ruleset.source,
            })) : [];
            return header + JSON.stringify(effective);
        }
        if (route === 'repos/jcosta33/sourdaw/branches/main/protection') return JSON.stringify(exact);
    }
    if (args.at(-1) === 'user') return JSON.stringify(user);
    if (args.includes('graphql')) return JSON.stringify({ data: { repository: {
        id: repository.node_id, databaseId: repository.id, nameWithOwner: repository.full_name,
        defaultBranchRef: { name: 'main' }, viewerPermission: 'ADMIN',
        branchProtectionRules: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } },
    } } });
    throw Error('unexpected API fixture request');
}
export function authenticate() { return { minted: { actorNodeId: user.node_id }, session: {
    configDir: '/synthetic-unused', env: {}, dispose() { writeFileSync(disposePath, 'disposed'); },
} }; }
`;
    const preload = `
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
const fixture = ${JSON.stringify(pathToFileURL(fixturePath).href)};
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (...args) {
    const accepted = originalWrite(...args);
    if (!accepted) writeFileSync(${JSON.stringify(backpressurePath)}, 'backpressured');
    return accepted;
};
registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith('/scripts/githubAppIdentity.ts')) return { ...result, source: String(result.source) +
        '\\nimport { capture, authenticate } from ' + JSON.stringify(fixture) +
        ';\\nspawnCapture = capture;\\nauthenticateOrchestratorSession = authenticate;\\n' };
    return result;
} });
Date.prototype.toISOString = function () { return ${JSON.stringify(CLI_DATE)}; };
`;
    writeFileSync(fixturePath, fixture);
    writeFileSync(preloadPath, preload);
    try {
        const child = spawn(
            process.execPath,
            ['--import', preloadPath, join(root, 'scripts/retargetCapabilitySnapshot.ts')],
            {
                cwd: root,
                env: { PATH: process.env.PATH, RETARGET_TEST_FAIL_READ: failRead ? '1' : '0' },
                stdio: ['ignore', 'pipe', 'pipe'],
                signal: AbortSignal.timeout(20_000),
            }
        );
        const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bufferedBeforeDrain = 0;
        if (!failRead) {
            child.stdout.pause();
            await Promise.race([
                once(child.stdout, 'readable'),
                closed.then(() => {
                    throw new Error('native planner closed before any stdout became readable');
                }),
            ]);
            bufferedBeforeDrain = child.stdout.readableLength;
        }
        // Read concurrently with exit. Yield between chunks so the producer encounters a real pipe consumer.
        const output = (async () => {
            for await (const chunk of child.stdout) {
                stdout.push(chunk as Buffer);
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
        })();
        const diagnostic = (async () => {
            for await (const chunk of child.stderr) {
                stderr.push(chunk as Buffer);
            }
        })();
        const result = await closed;
        await Promise.all([output, diagnostic]);
        return {
            ...result,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            bufferedBeforeDrain,
            backpressured: existsSync(backpressurePath),
            disposed: readFileSync(disposePath, 'utf8'),
        };
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

describe('native planner pipe delivery', () => {
    it('writes a complete large canonical plan through a backpressured pipe before successful exit', async () => {
        const rulesets = largeStablePolicy();
        const port: CapabilityReadPort = {
            user: () => USER,
            repository: () => REPOSITORY,
            rulesetPage: (page) => rest(page === 1 ? rulesets : []),
            ruleset: (id) => rulesets[id - 1] ?? null,
            effectiveBranch: (branch) => {
                if (branch !== 'main') {
                    return rest([]);
                }
                return rest(
                    rulesets.map((ruleset) => ({
                        ...ruleset.rules[0],
                        ruleset_id: ruleset.id,
                        ruleset_source_type: 'Repository',
                        ruleset_source: ruleset.source,
                    }))
                );
            },
            exactMainProtection: () => EXACT_MAIN_PROTECTION,
            classicPage: () => ({
                repository: { ...CLASSIC_REPOSITORY, branchProtectionRules: connection([], 0) },
            }),
            allowancePage: () => {
                throw new Error('fixture has no classic allowance rule');
            },
        };
        const expected = runStableClassicCli(port);
        expect(expected.run()).toBe(0);
        expect(expected.printed).toHaveLength(1);
        const canonical = `${expected.printed[0]}\n`;
        expect(Buffer.byteLength(canonical)).toBeGreaterThan(128 * 1024);

        const actual = await runNativePlanWithPipe(false);
        expect(actual.bufferedBeforeDrain).toBeGreaterThan(0);
        expect(actual.backpressured).toBe(true);
        expect(actual.signal).toBeNull();
        expect(actual.code).toBe(0);
        expect(actual.stderr).toBe('');
        expect(Buffer.byteLength(actual.stdout)).toBe(Buffer.byteLength(canonical));
        expect(actual.stdout === canonical).toBe(true);
        expect(JSON.parse(actual.stdout)).toMatchObject({ activationEligible: false });
        expect(actual.disposed).toBe('disposed');
    }, 30_000);

    it('exits with a diagnostic and disposes after a synthetic native read failure', async () => {
        const actual = await runNativePlanWithPipe(true);
        expect(actual.signal).toBeNull();
        expect(actual.code).toBe(1);
        expect(actual.stdout).toBe('');
        expect(actual.stderr).toBe('retarget capability baseline refused: incomplete or invalid read\n');
        expect(actual.disposed).toBe('disposed');
    }, 30_000);
});

function emittedClassicBaseline(output: string): {
    emitted: Record<string, JsonValue>;
    baseline: Record<string, JsonValue>;
    classic: Record<string, JsonValue>;
} {
    const emitted = requiredRecord(JSON.parse(output) as JsonValue, 'emitted capability plan');
    const baseline = requiredRecord(emitted.baseline, 'captured baseline');
    if (!Array.isArray(baseline.classic)) {
        throw new TypeError('expected captured classic rules');
    }
    const classic = requiredRecord(baseline.classic[0], 'captured classic rule');
    expect(emitted.baselineDigest).toBe(createHash('sha256').update(canonicalJson(baseline)).digest('hex'));
    expect(emitted.originalMainSemanticDigest).toBe(
        createHash('sha256')
            .update(
                canonicalJson({
                    rulesets: [RULE],
                    classic: baseline.classic,
                    effective: [],
                    exactProtection: EXACT_MAIN_PROTECTION,
                })
            )
            .digest('hex')
    );
    return { emitted, baseline, classic };
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

    it.each([42, null])(
        'preserves required status app database ID %s through two stable CLI captures',
        (databaseId) => {
            const app = { id: 'app-node', databaseId, slug: 'example' };
            const port = portWithClassicStatusApp(app);
            const disposed = vi.fn();
            const printed: string[] = [];
            let classicReads = 0;
            const result = runRetargetCapabilityPlanCli([], {
                sourceCheck: () => SOURCE,
                primaryRoot: () => '/primary',
                authenticate: () => ({
                    minted: { actorNodeId: USER.node_id },
                    session: { configDir: '/unused', env: {}, dispose: disposed },
                }),
                readPort: () => ({
                    ...port,
                    classicPage: (cursor) => {
                        classicReads += 1;
                        return port.classicPage(cursor);
                    },
                }),
                now: () => '2026-10-08T00:00:00.000Z',
                print: (value) => printed.push(value),
            });
            expect(result).toBe(0);
            expect(classicReads).toBe(2);
            expect(printed).toHaveLength(1);
            const output = printed[0];
            if (output === undefined) {
                throw new Error('expected one emitted capability plan');
            }
            const emitted = requiredRecord(JSON.parse(output) as JsonValue, 'emitted capability plan');
            const baseline = requiredRecord(emitted.baseline, 'captured baseline');
            if (!Array.isArray(baseline.classic)) {
                throw new TypeError('expected captured classic rules');
            }
            const classic = requiredRecord(baseline.classic[0], 'captured classic rule');
            expect(classic.requiredStatusChecks).toEqual([{ context: 'Gate', app }]);
            expect(emitted.activationEligible).toBe(false);
            expect(disposed).toHaveBeenCalledOnce();
        }
    );

    it.each([
        ['missing database ID', { id: 'app-node', slug: 'example' }],
        ['string database ID', { id: 'app-node', databaseId: '42', slug: 'example' }],
        ['fractional database ID', { id: 'app-node', databaseId: 42.5, slug: 'example' }],
        ['missing node ID', { databaseId: null, slug: 'example' }],
        ['empty node ID', { id: '', databaseId: null, slug: 'example' }],
        ['nonstring node ID', { id: 42, databaseId: null, slug: 'example' }],
    ])('refuses malformed classic status app identity: %s', (_label, app) => {
        expect(() => captureCapabilitySnapshot(portWithClassicStatusApp(app))).toThrow();
    });

    it.each([REPOSITORY.id, null])(
        'preserves classic repository database ID %s through two stable CLI captures',
        (databaseId) => {
            const capture = runStableClassicCli(
                portWithClassicMetadata({ ...CLASSIC_REPOSITORY, databaseId }, CLASSIC)
            );
            expect(capture.run()).toBe(0);
            expect(capture.classicReads()).toBe(2);
            expect(capture.printed).toHaveLength(1);
            const output = capture.printed[0];
            if (output === undefined) {
                throw new Error('expected one emitted capability plan');
            }
            const { emitted, baseline } = emittedClassicBaseline(output);
            expect(baseline.repository).toEqual(REPOSITORY);
            expect(baseline).not.toHaveProperty('classicRepository');
            expect(emitted.activationEligible).toBe(false);
            expect(capture.order).toEqual(['source', 'primary', 'authenticate', 'readPort']);
            expect(capture.disposed).toHaveBeenCalledOnce();
        }
    );

    it.each([42, null])('preserves classic rule database ID %s through two stable CLI captures', (databaseId) => {
        const capture = runStableClassicCli(portWithClassicMetadata(CLASSIC_REPOSITORY, { ...CLASSIC, databaseId }));
        expect(capture.run()).toBe(0);
        expect(capture.classicReads()).toBe(2);
        expect(capture.printed).toHaveLength(1);
        const output = capture.printed[0];
        if (output === undefined) {
            throw new Error('expected one emitted capability plan');
        }
        const { emitted, classic } = emittedClassicBaseline(output);
        expect(classic.id).toBe('classic-node');
        expect(classic.databaseId).toBe(databaseId);
        expect(emitted.activationEligible).toBe(false);
        expect(capture.disposed).toHaveBeenCalledOnce();
    });

    const allowanceActors = (['User', 'Team', 'App'] as const).flatMap((typename) =>
        [42, null].map((databaseId) => ({ typename, databaseId }))
    );
    it.each(allowanceActors)(
        'preserves $typename allowance actor database ID $databaseId through two stable CLI captures',
        ({ typename, databaseId }) => {
            const actor: Record<string, JsonValue> = {
                __typename: typename,
                id: `${typename}-node`,
                databaseId,
            };
            if (typename === 'User') {
                actor.login = 'actor';
            } else {
                actor.slug = 'actor';
            }
            const capture = runStableClassicCli(portWithClassicMetadata(CLASSIC_REPOSITORY, CLASSIC, actor));
            expect(capture.run()).toBe(0);
            expect(capture.classicReads()).toBe(2);
            expect(capture.printed).toHaveLength(1);
            const output = capture.printed[0];
            if (output === undefined) {
                throw new Error('expected one emitted capability plan');
            }
            const { emitted, classic } = emittedClassicBaseline(output);
            const allowances = requiredRecord(classic.allowances, 'captured allowances');
            for (const kind of KINDS) {
                const entries = allowances[kind];
                if (!Array.isArray(entries)) {
                    throw new TypeError(`missing ${kind} connection entries`);
                }
                const entry = requiredRecord(entries[0], `${kind} entry`);
                expect(entry.actor).toEqual(actor);
            }
            expect(emitted.activationEligible).toBe(false);
            expect(capture.disposed).toHaveBeenCalledOnce();
        }
    );

    const { databaseId: _missingRepositoryDatabaseId, ...repositoryWithoutDatabaseId } = CLASSIC_REPOSITORY;
    it.each([
        ['missing database ID', repositoryWithoutDatabaseId],
        ['string database ID', { ...CLASSIC_REPOSITORY, databaseId: String(REPOSITORY.id) }],
        ['fractional database ID', { ...CLASSIC_REPOSITORY, databaseId: 42.5 }],
        ['mismatched numeric database ID', { ...CLASSIC_REPOSITORY, databaseId: REPOSITORY.id + 1 }],
        ['mismatched node ID', { ...CLASSIC_REPOSITORY, id: 'another-repository' }],
        ['mismatched full name', { ...CLASSIC_REPOSITORY, nameWithOwner: 'another/repository' }],
        ['mismatched default branch', { ...CLASSIC_REPOSITORY, defaultBranchRef: { name: 'elsewhere' } }],
    ])('refuses malformed classic repository identity: %s', (_label, repository) => {
        const capture = runStableClassicCli(portWithClassicMetadata(repository, CLASSIC));
        expect(capture.run).toThrow();
        expect(capture.printed).toEqual([]);
        expect(capture.disposed).toHaveBeenCalledOnce();
    });

    const { databaseId: _missingRuleDatabaseId, ...ruleWithoutDatabaseId } = CLASSIC;
    it.each([
        ['missing database ID', ruleWithoutDatabaseId],
        ['string database ID', { ...CLASSIC, databaseId: '42' }],
        ['fractional database ID', { ...CLASSIC, databaseId: 42.5 }],
        ['missing node ID', { ...CLASSIC, id: null }],
        ['empty node ID', { ...CLASSIC, id: '' }],
        ['oversized node ID', { ...CLASSIC, id: 'a'.repeat(257) }],
    ])('refuses malformed classic rule identity in CLI: %s', (_label, rule) => {
        const capture = runStableClassicCli(portWithClassicMetadata(CLASSIC_REPOSITORY, rule));
        expect(capture.run).toThrow();
        expect(capture.printed).toEqual([]);
        expect(capture.disposed).toHaveBeenCalledOnce();
    });

    const allowanceActor = { __typename: 'App', id: 'app-node', databaseId: 42, slug: 'actor' };
    const { databaseId: _missingActorDatabaseId, ...actorWithoutDatabaseId } = allowanceActor;
    it.each([
        ['missing database ID', actorWithoutDatabaseId],
        ['string database ID', { ...allowanceActor, databaseId: '42' }],
        ['fractional database ID', { ...allowanceActor, databaseId: 42.5 }],
        ['missing node ID', { ...allowanceActor, id: null }],
        ['empty node ID', { ...allowanceActor, id: '' }],
        ['oversized node ID', { ...allowanceActor, id: 'a'.repeat(257) }],
    ])('refuses malformed allowance actor identity in CLI: %s', (_label, actor) => {
        const capture = runStableClassicCli(portWithClassicMetadata(CLASSIC_REPOSITORY, CLASSIC, actor));
        expect(capture.run).toThrow();
        expect(capture.printed).toEqual([]);
        expect(capture.disposed).toHaveBeenCalledOnce();
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
