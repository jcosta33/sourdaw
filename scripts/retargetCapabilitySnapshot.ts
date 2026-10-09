#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import {
    authenticateOrchestratorSession,
    githubAuthorizationGitEnv,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
    type OrchestratorAuthentication,
} from './githubAppIdentity.ts';
import { assertTrustedExecutingBlobs, trustedExecutingPaths } from './prepareReviewEntry.ts';
import {
    buildCapabilityPlan,
    capabilityObservationRecord,
    renderCapabilityPlan,
    type CapabilityObservation,
} from './retargetCapabilityPlan.ts';

import type { RulesetDocument } from './rulesetHardening.ts';

const REPOSITORY = 'repos/jcosta33/sourdaw';
const MAX_PAGES = 100;
const PROBES = ['main', 'agent/retarget-capability-planner', 'release/v1.0', 'Case.Mixed'] as const;
const ALLOWANCES = [
    'pushAllowances',
    'bypassForcePushAllowances',
    'bypassPullRequestAllowances',
    'reviewDismissalAllowances',
] as const;
type AllowanceKind = (typeof ALLOWANCES)[number];

const CLASSIC_FIELDS = `id databaseId pattern allowsDeletions allowsForcePushes blocksCreations dismissesStaleReviews isAdminEnforced lockAllowsFetchAndMerge lockBranch requireLastPushApproval requiredApprovingReviewCount requiredDeploymentEnvironments requiredStatusCheckContexts requiredStatusChecks { context app { id databaseId slug } } requiresApprovingReviews requiresCodeOwnerReviews requiresCommitSignatures requiresConversationResolution requiresDeployments requiresLinearHistory requiresStatusChecks requiresStrictStatusChecks restrictsPushes restrictsReviewDismissals`;
const CLASSIC_QUERY = `query RetargetClassic($cursor: String) { repository(owner: "jcosta33", name: "sourdaw") { id databaseId nameWithOwner defaultBranchRef { name } viewerPermission branchProtectionRules(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { ${CLASSIC_FIELDS} } } } }`;
const CLASSIC_BOOLEAN_FIELDS = [
    'allowsDeletions',
    'allowsForcePushes',
    'blocksCreations',
    'dismissesStaleReviews',
    'isAdminEnforced',
    'lockAllowsFetchAndMerge',
    'lockBranch',
    'requireLastPushApproval',
    'requiresApprovingReviews',
    'requiresCodeOwnerReviews',
    'requiresCommitSignatures',
    'requiresConversationResolution',
    'requiresDeployments',
    'requiresLinearHistory',
    'requiresStatusChecks',
    'requiresStrictStatusChecks',
    'restrictsPushes',
    'restrictsReviewDismissals',
] as const;
const ACTOR_FIELDS = `__typename ... on User { id databaseId login } ... on Team { id databaseId slug } ... on App { id databaseId slug }`;
const ALLOWANCE_QUERIES: Record<AllowanceKind, string> = {
    pushAllowances: `query RetargetPush($ruleId: ID!, $cursor: String) { node(id: $ruleId) { ... on BranchProtectionRule { id repository { id } pushAllowances(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id branchProtectionRule { id } actor { ${ACTOR_FIELDS} } } } } } }`,
    bypassForcePushAllowances: `query RetargetForce($ruleId: ID!, $cursor: String) { node(id: $ruleId) { ... on BranchProtectionRule { id repository { id } bypassForcePushAllowances(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id branchProtectionRule { id } actor { ${ACTOR_FIELDS} } } } } } }`,
    bypassPullRequestAllowances: `query RetargetPull($ruleId: ID!, $cursor: String) { node(id: $ruleId) { ... on BranchProtectionRule { id repository { id } bypassPullRequestAllowances(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id branchProtectionRule { id } actor { ${ACTOR_FIELDS} } } } } } }`,
    reviewDismissalAllowances: `query RetargetDismissal($ruleId: ID!, $cursor: String) { node(id: $ruleId) { ... on BranchProtectionRule { id repository { id } reviewDismissalAllowances(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id branchProtectionRule { id } actor { ${ACTOR_FIELDS} } } } } } }`,
};

export type ListPage = { readonly items: JsonValue; readonly nextPage: number | null };
export type CapabilityReadPort = {
    user(): JsonValue;
    repository(): JsonValue;
    rulesetPage(page: number): ListPage;
    ruleset(id: number): JsonValue;
    effectiveBranch(name: string, page: number): ListPage;
    exactMainProtection(): JsonValue | null;
    classicPage(cursor: string | null): JsonValue;
    allowancePage(kind: AllowanceKind, ruleId: string, cursor: string | null): JsonValue;
};

function json(value: string): JsonValue {
    try {
        return JSON.parse(value) as JsonValue;
    } catch {
        throw new Error('GitHub returned malformed JSON');
    }
}
function object(value: JsonValue, label: string): RulesetDocument {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} is malformed`);
    }
    return value;
}
function list(value: JsonValue, label: string): JsonValue[] {
    if (!Array.isArray(value) || value.some((item) => item === null)) {
        throw new Error(`${label} is malformed`);
    }
    return value;
}
function id(value: JsonValue, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
        throw new Error(`${label} is malformed`);
    }
    return value;
}
function assertClassicChecks(rule: RulesetDocument): void {
    if (rule.requiredStatusChecks === null) {
        return;
    }
    if (!Array.isArray(rule.requiredStatusChecks)) {
        throw new TypeError('classic status checks are incomplete');
    }
    for (const value of rule.requiredStatusChecks) {
        const check = object(value, 'classic status check');
        if (typeof check.context !== 'string' || check.app === undefined) {
            throw new Error('classic status check is incomplete');
        }
        if (check.app !== null) {
            const app = object(check.app, 'classic status app');
            if (typeof app.id !== 'string' || !Number.isSafeInteger(app.databaseId)) {
                throw new TypeError('classic status app is incomplete');
            }
        }
    }
}
function assertClassicRule(rule: RulesetDocument): void {
    id(rule.id ?? null, 'classic rule id');
    if (!Number.isSafeInteger(rule.databaseId) || typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
        throw new Error('classic rule identity is incomplete');
    }
    for (const field of CLASSIC_BOOLEAN_FIELDS) {
        if (typeof rule[field] !== 'boolean') {
            throw new TypeError('classic rule scalar is incomplete');
        }
    }
    if (rule.requiredApprovingReviewCount !== null && !Number.isSafeInteger(rule.requiredApprovingReviewCount)) {
        throw new Error('classic review count is incomplete');
    }
    for (const field of ['requiredDeploymentEnvironments', 'requiredStatusCheckContexts'] as const) {
        const value = rule[field];
        if (value !== null && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) {
            throw new Error('classic required context is incomplete');
        }
    }
    assertClassicChecks(rule);
}
function connection(
    value: JsonValue,
    label: string
): { nodes: JsonValue[]; next: string | null; total: number; hasNext: boolean } {
    const data = object(value, label);
    const page = object(data.pageInfo ?? null, `${label} page info`);
    if (
        !Number.isSafeInteger(data.totalCount) ||
        Number(data.totalCount) < 0 ||
        typeof page.hasNextPage !== 'boolean'
    ) {
        throw new Error(`${label} count or page info is malformed`);
    }
    const nodes = list(data.nodes ?? null, `${label} nodes`);
    if (nodes.length > 100) {
        throw new Error(`${label} exceeds page size`);
    }
    const next = page.endCursor;
    if (page.hasNextPage && (typeof next !== 'string' || next.length === 0)) {
        throw new Error(`${label} cursor is missing`);
    }
    return {
        nodes,
        next: typeof next === 'string' ? next : null,
        total: Number(data.totalCount),
        hasNext: page.hasNextPage,
    };
}
function pagedConnection(first: (cursor: string | null) => JsonValue, label: string): JsonValue[] {
    const nodes: JsonValue[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let total: number | null = null;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const part = connection(first(cursor), label);
        if (total !== null && part.total !== total) {
            throw new Error(`${label} count changed`);
        }
        total = part.total;
        for (const value of part.nodes) {
            const node = object(value, `${label} node`);
            const nodeId = id(node.id ?? null, `${label} node id`);
            if (seenIds.has(nodeId)) {
                throw new Error(`${label} repeated node`);
            }
            seenIds.add(nodeId);
            nodes.push(node);
        }
        if (nodes.length > total) {
            throw new Error(`${label} exceeds total count`);
        }
        if (!part.hasNext) {
            if (nodes.length !== total) {
                throw new Error(`${label} omitted nodes`);
            }
            return nodes;
        }
        if (part.next === null || part.next === cursor || seenCursors.has(part.next)) {
            throw new Error(`${label} cursor repeated`);
        }
        seenCursors.add(part.next);
        cursor = part.next;
    }
    throw new Error(`${label} page limit exceeded`);
}
function restPages(read: (page: number) => ListPage, label: string): JsonValue[] {
    const values: JsonValue[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = read(page);
        for (const value of list(result.items, label)) {
            const key = canonicalJson(value);
            if (seen.has(key)) {
                throw new Error(`${label} repeated item`);
            }
            seen.add(key);
            values.push(value);
        }
        if (result.nextPage === null) {
            return values;
        }
        if (result.nextPage !== page + 1) {
            throw new Error(`${label} page link is not sequential`);
        }
    }
    throw new Error(`${label} page limit exceeded`);
}

/** Repeats the entire inventory; equality establishes stable observations, not server atomicity. */
export function captureCapabilitySnapshot(port: CapabilityReadPort): CapabilityObservation {
    const user = object(port.user(), 'user');
    const repository = object(port.repository(), 'repository');
    const limitations: string[] = [];
    const rulesetSummaries = restPages((page) => port.rulesetPage(page), 'ruleset listing');
    const rulesets = rulesetSummaries.map((summary) => {
        const listed = object(summary, 'ruleset listing item');
        if (!Number.isSafeInteger(listed.id) || Number(listed.id) <= 0) {
            throw new Error('ruleset id is malformed');
        }
        const detail = object(port.ruleset(Number(listed.id)), 'ruleset detail');
        if (
            detail.id !== listed.id ||
            detail.name !== listed.name ||
            detail.source !== listed.source ||
            detail.source_type !== listed.source_type
        ) {
            throw new Error('ruleset listing and detail disagree');
        }
        if (!Array.isArray(detail.bypass_actors)) {
            limitations.push('ruleset bypass actors unavailable');
        }
        return detail;
    });
    const repoNodeId = repository.node_id;
    const classic = pagedConnection((cursor) => {
        const response = object(port.classicPage(cursor), 'classic GraphQL response');
        const repo = object(response.repository ?? null, 'classic repository');
        if (
            repo.id !== repoNodeId ||
            repo.databaseId !== repository.id ||
            repo.nameWithOwner !== repository.full_name ||
            object(repo.defaultBranchRef ?? null, 'classic default branch').name !== 'main'
        ) {
            throw new Error('classic repository identity changed');
        }
        if (repo.viewerPermission !== 'ADMIN') {
            limitations.push('classic administration visibility unavailable');
        }
        return repo.branchProtectionRules ?? null;
    }, 'classic rules');
    const decorated = classic.map((raw) => {
        const rule = object(raw, 'classic rule');
        assertClassicRule(rule);
        const ruleId = id(rule.id ?? null, 'classic rule id');
        const allowances: RulesetDocument = {};
        for (const kind of ALLOWANCES) {
            allowances[kind] = pagedConnection((cursor) => {
                const response = object(port.allowancePage(kind, ruleId, cursor), 'allowance GraphQL response');
                const node = object(response.node ?? null, 'allowance rule');
                if (node.id !== ruleId || object(node.repository ?? null, 'allowance repository').id !== repoNodeId) {
                    throw new Error('allowance rule or repository changed');
                }
                return node[kind] ?? null;
            }, kind).map((entry) => {
                const allowance = object(entry, `${kind} entry`);
                if (object(allowance.branchProtectionRule ?? null, 'allowance owner').id !== ruleId) {
                    throw new Error('allowance bound to another rule');
                }
                const actor = object(allowance.actor ?? null, 'allowance actor');
                if (
                    typeof actor.__typename !== 'string' ||
                    !['User', 'Team', 'App'].includes(actor.__typename) ||
                    typeof actor.id !== 'string' ||
                    !Number.isSafeInteger(actor.databaseId)
                ) {
                    throw new Error('allowance actor is incomplete');
                }
                return allowance;
            });
        }
        return { ...rule, allowances };
    });
    const effectiveBranches: Record<string, JsonValue[]> = {};
    for (const branch of PROBES) {
        try {
            effectiveBranches[branch] = restPages((page) => port.effectiveBranch(branch, page), `effective ${branch}`);
        } catch {
            limitations.push(`effective rules unavailable for ${branch}`);
            effectiveBranches[branch] = [];
        }
    }
    let exactMainProtection: JsonValue | null = null;
    try {
        exactMainProtection = port.exactMainProtection();
    } catch {
        limitations.push('exact main classic protection unavailable');
    }
    return { user, repository, rulesets, classic: decorated, effectiveBranches, exactMainProtection, limitations };
}

function restPage(
    session: GhSession,
    primaryRoot: string,
    path: string,
    page: number,
    capture: typeof spawnCapture
): ListPage {
    const output = capture(
        'gh',
        ['api', '--hostname', 'github.com', '-i', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`],
        { env: session.env, cwd: primaryRoot, trim: false }
    );
    return parseRestPageOutput(output, path, page);
}

export function parseRestPageOutput(output: string, path: string, page: number): ListPage {
    const split = output.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const boundary = output.indexOf(split);
    if (boundary < 0) {
        throw new Error('GitHub REST headers unavailable');
    }
    const header = output.slice(0, boundary);
    if (!/^HTTP\/\S+ 200\b/mu.test(header)) {
        throw new Error('GitHub REST response was not successful');
    }
    const link = /^link:\s*(.+)$/imu.exec(header)?.[1];
    const nextMatches = link?.match(/<([^>]+)>;\s*rel="next"/gu) ?? [];
    if (nextMatches.length > 1) {
        throw new Error('GitHub REST pagination is ambiguous');
    }
    let nextPage: number | null = null;
    if (nextMatches.length === 1) {
        const urlText = /<([^>]+)>/u.exec(nextMatches[0])?.[1];
        if (urlText === undefined) {
            throw new Error('GitHub REST page link is malformed');
        }
        const url = new URL(urlText);
        const expected = new URL(
            `https://api.github.com/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page + 1}`
        );
        url.searchParams.sort();
        expected.searchParams.sort();
        if (
            url.origin !== expected.origin ||
            url.pathname !== expected.pathname ||
            url.search !== expected.search ||
            url.username !== '' ||
            url.password !== '' ||
            url.hash !== ''
        ) {
            throw new Error('GitHub REST page link escaped the fixed endpoint');
        }
        nextPage = page + 1;
    }
    return { items: json(output.slice(boundary + split.length)), nextPage };
}
function graphql(
    session: GhSession,
    primaryRoot: string,
    query: string,
    variables: readonly string[],
    capture: typeof spawnCapture
): JsonValue {
    const response = object(
        json(
            capture('gh', ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`, ...variables], {
                env: session.env,
                cwd: primaryRoot,
            })
        ),
        'GraphQL response'
    );
    if (response.errors !== undefined || response.data === null) {
        throw new Error('GraphQL data is incomplete');
    }
    return response.data ?? null;
}

/** Transport is fixed to REST GETs and four known GraphQL query documents. */
export function shellCapabilityReadPort(
    session: GhSession,
    primaryRoot: string,
    capture: typeof spawnCapture = spawnCapture
): CapabilityReadPort {
    const rest = (path: string): JsonValue =>
        json(capture('gh', ['api', '--hostname', 'github.com', path], { env: session.env, cwd: primaryRoot }));
    return {
        user: () => rest('user'),
        repository: () => rest(REPOSITORY),
        rulesetPage: (page) =>
            restPage(session, primaryRoot, `${REPOSITORY}/rulesets?includes_parents=true`, page, capture),
        ruleset: (ruleId) => rest(`${REPOSITORY}/rulesets/${ruleId}?includes_parents=true`),
        effectiveBranch: (branch, page) =>
            restPage(session, primaryRoot, `${REPOSITORY}/rules/branches/${encodeURIComponent(branch)}`, page, capture),
        exactMainProtection: () => rest(`${REPOSITORY}/branches/main/protection`),
        classicPage: (cursor) =>
            graphql(session, primaryRoot, CLASSIC_QUERY, cursor === null ? [] : ['-f', `cursor=${cursor}`], capture),
        allowancePage: (kind, ruleId, cursor) => {
            const variables = ['-f', `ruleId=${ruleId}`];
            if (cursor !== null) {
                variables.push('-f', `cursor=${cursor}`);
            }
            return graphql(session, primaryRoot, ALLOWANCE_QUERIES[kind], variables, capture);
        },
    };
}

export function parseRetargetCapabilityArgs(args: readonly string[]): 'help' | 'run' {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        return 'help';
    }
    if (args.length > 0) {
        throw new Error('usage: pnpm retarget:plan');
    }
    return 'run';
}

export type CapabilityCliDependencies = {
    sourceCheck(): string;
    primaryRoot(): string;
    authenticate(): OrchestratorAuthentication;
    readPort(session: GhSession, primaryRoot: string): CapabilityReadPort;
    now(): string;
    print(value: string): void;
};

/** A local drift self-check after module evaluation, not a hostile-code sandbox. */
export function checkRetargetCapabilitySource(
    executingFile: string = fileURLToPath(import.meta.url),
    executingRoot: string = dirname(dirname(executingFile))
): string {
    const env = githubAuthorizationGitEnv();
    const sourceSha = spawnCapture('git', ['rev-parse', '--verify', 'origin/main^{commit}'], {
        cwd: executingRoot,
        env,
    }).trim();
    if (!/^[0-9a-f]{40}$/u.test(sourceSha)) {
        throw new Error('origin/main does not resolve to one commit');
    }
    verifyRetargetCapabilitySource(
        executingFile,
        executingRoot,
        sourceSha,
        (path) => readFileSync(path, 'utf8'),
        (path, revision) => originMainBlob(path, executingRoot, env, 'git', revision)
    );
    return sourceSha;
}

/** Verifies the complete local import closure and route against one caller-pinned commit. */
export function verifyRetargetCapabilitySource(
    executingFile: string,
    executingRoot: string,
    sourceSha: string,
    readFile: (path: string) => string,
    readOrigin: (path: string, revision: string) => string | undefined
): void {
    if (!/^[0-9a-f]{40}$/u.test(sourceSha)) {
        throw new Error('source commit is malformed');
    }
    const blobs = trustedExecutingPaths(executingFile, readFile).map((path) => ({
        path,
        source: readFile(join(executingRoot, path)),
        originBlob: readOrigin(path, sourceSha),
    }));
    assertTrustedExecutingBlobs(blobs);
    const packageSource = readFile(join(executingRoot, 'package.json'));
    const packageBlob = readOrigin('package.json', sourceSha);
    assertTrustedExecutingBlobs([{ path: 'package.json', source: packageSource, originBlob: packageBlob }]);
    const packageRecord = object(json(packageSource), 'package route');
    const scripts = object(packageRecord.scripts ?? null, 'package scripts');
    if (scripts['retarget:plan'] !== 'node scripts/retargetCapabilitySnapshot.ts') {
        throw new Error('retarget:plan route changed');
    }
}

export function runRetargetCapabilityPlanCli(args: readonly string[], dependencies: CapabilityCliDependencies): number {
    if (parseRetargetCapabilityArgs(args) === 'help') {
        dependencies.print('Usage: pnpm retarget:plan');
        return 0;
    }
    const sourceSha = dependencies.sourceCheck();
    const primaryRoot = dependencies.primaryRoot();
    const auth = dependencies.authenticate();
    try {
        const port = dependencies.readPort(auth.session, primaryRoot);
        const startedAt = dependencies.now();
        const first = captureCapabilitySnapshot(port);
        const second = captureCapabilitySnapshot(port);
        const endedAt = dependencies.now();
        if (canonicalJson(capabilityObservationRecord(first)) !== canonicalJson(capabilityObservationRecord(second))) {
            throw new Error('observed policy changed during capture');
        }
        const plan = buildCapabilityPlan(first, sourceSha, { startedAt, endedAt });
        dependencies.print(renderCapabilityPlan(plan));
        return 0;
    } finally {
        auth.session.dispose();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const dependencies: CapabilityCliDependencies = {
        sourceCheck: () => checkRetargetCapabilitySource(),
        primaryRoot: () =>
            resolvePrimaryRoot((command, args, cwd) =>
                spawnCapture(command, args, {
                    cwd,
                    env: githubAuthorizationGitEnv(),
                })
            ),
        authenticate: () => authenticateOrchestratorSession(),
        readPort: shellCapabilityReadPort,
        now: () => new Date().toISOString(),
        print: (value) => console.log(value),
    };
    try {
        process.exit(runRetargetCapabilityPlanCli(process.argv.slice(2), dependencies));
    } catch {
        console.error('retarget capability baseline refused: incomplete or invalid read');
        process.exit(1);
    }
}
