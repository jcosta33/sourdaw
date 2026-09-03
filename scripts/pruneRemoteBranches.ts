#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    originMainBlob,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type RemoteBranch = { name: string; tip: string };
export type PullRequestState = 'OPEN' | 'MERGED' | 'CLOSED';
export type BranchPullRequest = { number: number; state: PullRequestState; headRefOid: string };
export type DeleteOutcome = 'deleted' | 'already-gone';
export type BranchClass = 'protected' | 'open' | 'unpublished' | 'moved' | 'spent';

export type PruneRemoteBranchesPort = {
    listBranches: () => RemoteBranch[];
    pullRequestsFor: (branches: string[]) => Map<string, BranchPullRequest[]>;
    branchTip: (name: string) => string | undefined;
    deleteBranch: (name: string) => DeleteOutcome;
};

export type PruneRemoteBranchesArgs = { apply: boolean; limit?: number; help: boolean };

const usage = 'usage: pnpm branch:prune [--apply] [--limit <n>]';
const BATCH_SIZE = 50;
const [REQUIRED_OWNER, REQUIRED_NAME] = REQUIRED_REPOSITORY.split('/') as [string, string];

export function parsePruneRemoteBranchesArgs(args: string[]): PruneRemoteBranchesArgs {
    if (args.length === 1 && args[0] === '--help') {
        return { apply: false, help: true };
    }
    let apply = false;
    let limit: number | undefined;
    let index = 0;
    while (index < args.length) {
        const arg = args[index];
        if (arg === '--apply') {
            apply = true;
            index += 1;
            continue;
        }
        if (arg === '--limit') {
            limit = parsePositiveLimit(args[index + 1]);
            index += 2;
            continue;
        }
        fail(usage);
    }
    return { apply, limit, help: false };
}

function parsePositiveLimit(value: string | undefined): number {
    if (value === undefined || !/^[0-9]+$/.test(value)) {
        fail(usage);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        fail(usage);
    }
    return parsed;
}

export function encodeBranchRefPath(name: string): string {
    return name.split('/').map(encodeURIComponent).join('/');
}

export function classifyRemoteBranch(branch: RemoteBranch, pullRequests: BranchPullRequest[]): BranchClass {
    if (branch.name === REQUIRED_BASE_BRANCH) {
        return 'protected';
    }
    if (pullRequests.some((pullRequest) => pullRequest.state === 'OPEN')) {
        return 'open';
    }
    if (pullRequests.length === 0) {
        return 'unpublished';
    }
    if (!pullRequests.some((pullRequest) => pullRequest.headRefOid === branch.tip)) {
        return 'moved';
    }
    return 'spent';
}

function batchNames(names: string[], size: number): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < names.length; index += size) {
        batches.push(names.slice(index, index + size));
    }
    return batches;
}

function fetchPullRequestsInBatches(names: string[], port: PruneRemoteBranchesPort): Map<string, BranchPullRequest[]> {
    const result = new Map<string, BranchPullRequest[]>();
    for (const batch of batchNames(names, BATCH_SIZE)) {
        const batchResult = port.pullRequestsFor(batch);
        for (const name of batch) {
            const pullRequests = batchResult.get(name);
            if (pullRequests === undefined) {
                fail(`missing pull-request batch result for ${name}`);
            }
            result.set(name, pullRequests);
        }
    }
    return result;
}

function classifyBranches(branches: RemoteBranch[], prMap: Map<string, BranchPullRequest[]>): Map<string, BranchClass> {
    const classes = new Map<string, BranchClass>();
    for (const branch of branches) {
        classes.set(branch.name, classifyRemoteBranch(branch, prMap.get(branch.name) ?? []));
    }
    return classes;
}

function countByClass(classes: Map<string, BranchClass>): Record<BranchClass, number> {
    const counts: Record<BranchClass, number> = { protected: 0, open: 0, unpublished: 0, moved: 0, spent: 0 };
    for (const value of classes.values()) {
        counts[value] += 1;
    }
    return counts;
}

function matchingPullRequest(branch: RemoteBranch, pullRequests: BranchPullRequest[]): BranchPullRequest {
    const matching = pullRequests.find((pullRequest) => pullRequest.headRefOid === branch.tip);
    if (matching === undefined) {
        fail(`spent branch ${branch.name} has no matching pull request`);
    }
    return matching;
}

function printNamesUnderHeading(
    branchClass: BranchClass,
    branches: RemoteBranch[],
    classes: Map<string, BranchClass>,
    log: (message: string) => void
): void {
    log(`${branchClass}:`);
    for (const branch of branches) {
        if (classes.get(branch.name) === branchClass) {
            log(`  ${branch.name}`);
        }
    }
}

function printPlan(
    branches: RemoteBranch[],
    classes: Map<string, BranchClass>,
    prMap: Map<string, BranchPullRequest[]>,
    log: (message: string) => void
): void {
    const counts = countByClass(classes);
    for (const branchClass of Object.keys(counts) as BranchClass[]) {
        log(`${branchClass}: ${counts[branchClass]}`);
    }
    for (const branch of branches) {
        if (classes.get(branch.name) === 'spent') {
            const pr = matchingPullRequest(branch, prMap.get(branch.name) ?? []);
            log(`spent ${branch.name} ${branch.tip.slice(0, 9)} #${pr.number}:${pr.state}`);
        }
    }
    printNamesUnderHeading('moved', branches, classes, log);
    printNamesUnderHeading('unpublished', branches, classes, log);
}

type ApplyOutcome = {
    deleted: number;
    alreadyGone: number;
    keptAtRecheck: number;
    attempted: number;
    stopped: boolean;
};

function applyDeletion(
    branch: RemoteBranch,
    freshPullRequests: BranchPullRequest[],
    port: PruneRemoteBranchesPort,
    log: (message: string) => void
): DeleteOutcome {
    const outcome = port.deleteBranch(branch.name);
    if (outcome === 'deleted') {
        const pr = matchingPullRequest(branch, freshPullRequests);
        log(`deleted ${branch.name} (${branch.tip.slice(0, 9)}, #${pr.number} ${pr.state})`);
    } else {
        log(`already gone ${branch.name}`);
    }
    return outcome;
}

function recheckDisplayClass(recheckClass: BranchClass, tipMoved: boolean): BranchClass | 'moved' {
    return recheckClass === 'spent' && tipMoved ? 'moved' : recheckClass;
}

function applySpentBranches(
    spent: RemoteBranch[],
    limit: number,
    port: PruneRemoteBranchesPort,
    log: (message: string) => void
): ApplyOutcome {
    const toAttempt = spent.slice(0, limit);
    let deleted = 0;
    let alreadyGone = 0;
    let keptAtRecheck = 0;
    for (const branch of toAttempt) {
        const freshTip = port.branchTip(branch.name);
        if (freshTip === undefined) {
            alreadyGone += 1;
            log(`already gone ${branch.name}`);
            continue;
        }
        const freshPullRequests = port.pullRequestsFor([branch.name]).get(branch.name) ?? [];
        const recheckClass = classifyRemoteBranch({ name: branch.name, tip: freshTip }, freshPullRequests);
        const tipMoved = freshTip !== branch.tip;
        if (recheckClass !== 'spent' || tipMoved) {
            keptAtRecheck += 1;
            log(`kept ${branch.name}: ${recheckDisplayClass(recheckClass, tipMoved)} at re-check`);
            continue;
        }
        let outcome: DeleteOutcome;
        try {
            outcome = applyDeletion(branch, freshPullRequests, port, log);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log(`stopped after ${deleted} deletions: ${message}`);
            return { deleted, alreadyGone, keptAtRecheck, attempted: toAttempt.length, stopped: true };
        }
        if (outcome === 'deleted') {
            deleted += 1;
        } else {
            alreadyGone += 1;
        }
    }
    return { deleted, alreadyGone, keptAtRecheck, attempted: toAttempt.length, stopped: false };
}

export function pruneRemoteBranches(
    args: PruneRemoteBranchesArgs,
    port: PruneRemoteBranchesPort,
    log: (message: string) => void
): number {
    const branches = port.listBranches();
    const prMap = fetchPullRequestsInBatches(
        branches.map((branch) => branch.name),
        port
    );
    const classes = classifyBranches(branches, prMap);
    printPlan(branches, classes, prMap, log);
    const spent = branches
        .filter((branch) => classes.get(branch.name) === 'spent')
        .sort((left, right) => left.name.localeCompare(right.name));
    if (!args.apply) {
        log(`dry run: ${spent.length} branches would be deleted; pass --apply to delete`);
        return 0;
    }
    const result = applySpentBranches(spent, args.limit ?? Infinity, port, log);
    if (result.stopped) {
        return 1;
    }
    const remaining = spent.length - result.attempted;
    log(
        `deleted ${result.deleted}, already gone ${result.alreadyGone}, kept at re-check ${result.keptAtRecheck}, remaining spent ${remaining}`
    );
    return 0;
}

type Gh = (args: string[]) => string;

function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}

function toRemoteBranch(value: unknown): RemoteBranch {
    const node = value as { name?: unknown; target?: { oid?: unknown } | null };
    if (typeof node.name !== 'string' || typeof node.target?.oid !== 'string') {
        fail('invalid remote branch node');
    }
    return { name: node.name, tip: node.target.oid };
}

function listRemoteBranchesPage(
    gh: Gh,
    cursor: string | undefined
): { branches: RemoteBranch[]; hasNextPage: boolean; endCursor: unknown } {
    const query = `query($cursor:String){repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){refs(refPrefix:"refs/heads/",first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{name target{oid}}}}}`;
    const fields = cursor === undefined ? [] : ['-f', `cursor=${cursor}`];
    const response = graphql(gh, query, fields, 'list remote branches') as {
        data?: {
            repository?: { refs?: { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown }; nodes?: unknown } };
        };
    };
    const refs = response.data?.repository?.refs;
    if (!Array.isArray(refs?.nodes) || typeof refs.pageInfo?.hasNextPage !== 'boolean') {
        fail('invalid remote branch listing');
    }
    return {
        branches: refs.nodes.map(toRemoteBranch),
        hasNextPage: refs.pageInfo.hasNextPage,
        endCursor: refs.pageInfo.endCursor,
    };
}

function listRemoteBranches(gh: Gh): RemoteBranch[] {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const branches: RemoteBranch[] = [];
    for (;;) {
        const page = listRemoteBranchesPage(gh, cursor);
        branches.push(...page.branches);
        if (!page.hasNextPage) {
            return branches;
        }
        if (typeof page.endCursor !== 'string' || page.endCursor === '' || cursors.has(page.endCursor)) {
            fail('invalid remote branch pagination');
        }
        cursors.add(page.endCursor);
        cursor = page.endCursor;
    }
}

function toBranchPullRequest(value: unknown): BranchPullRequest {
    const node = value as { number?: unknown; state?: unknown; headRefOid?: unknown };
    if (
        typeof node.number !== 'number' ||
        !Number.isSafeInteger(node.number) ||
        (node.state !== 'OPEN' && node.state !== 'MERGED' && node.state !== 'CLOSED') ||
        typeof node.headRefOid !== 'string'
    ) {
        fail('invalid pull-request node');
    }
    return { number: node.number, state: node.state, headRefOid: node.headRefOid };
}

function pullRequestBatchQuery(size: number): string {
    const params = Array.from({ length: size }, (_unused, index) => `$n${index}:String!`).join(',');
    const aliases = Array.from(
        { length: size },
        (_unused, index) =>
            `b${index}: pullRequests(headRefName:$n${index}, first:10, states:[OPEN,MERGED,CLOSED], orderBy:{field:CREATED_AT,direction:DESC}){nodes{number state headRefOid}}`
    ).join(' ');
    return `query(${params}){repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){${aliases}}}`;
}

function pullRequestsForBranches(names: string[], gh: Gh): Map<string, BranchPullRequest[]> {
    if (names.length === 0) {
        return new Map();
    }
    const query = pullRequestBatchQuery(names.length);
    const fields = names.flatMap((name, index) => ['-f', `n${index}=${name}`]);
    const response = graphql(gh, query, fields, 'branch pull requests') as {
        data?: { repository?: Record<string, { nodes?: unknown } | undefined> };
    };
    const repository = response.data?.repository;
    if (repository === undefined) {
        fail('invalid branch pull-request response');
    }
    const result = new Map<string, BranchPullRequest[]>();
    for (const [index, name] of names.entries()) {
        const alias = repository[`b${index}`];
        if (alias === undefined || !Array.isArray(alias.nodes)) {
            fail(`missing pull-request alias for ${name}`);
        }
        result.set(name, alias.nodes.map(toBranchPullRequest));
    }
    return result;
}

function fetchBranchTip(name: string, gh: Gh): string | undefined {
    const query = `query($name:String!){repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){ref(qualifiedName:$name){target{oid}}}}`;
    const response = graphql(gh, query, ['-f', `name=refs/heads/${name}`], `branch tip for ${name}`) as {
        data?: { repository?: { ref?: { target?: { oid?: unknown } | null } | null } };
    };
    const repository = response.data?.repository;
    if (repository === undefined || !Object.hasOwn(repository, 'ref')) {
        fail(`invalid branch tip response for ${name}`);
    }
    const ref = repository.ref;
    if (ref === null) {
        return undefined;
    }
    if (typeof ref?.target?.oid !== 'string') {
        fail(`invalid branch tip response for ${name}`);
    }
    return ref.target.oid;
}

export function deleteRemoteBranch(name: string, gh: Gh): DeleteOutcome {
    const path = `repos/${REQUIRED_REPOSITORY}/git/refs/heads/${encodeBranchRefPath(name)}`;
    try {
        gh(['api', '-X', 'DELETE', path]);
        return 'deleted';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/\bHTTP 422\b/u.test(message) && message.includes('Reference does not exist')) {
            return 'already-gone';
        }
        throw new Error(`delete branch ${name}: ${message}`, { cause: error });
    }
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): PruneRemoteBranchesPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh: Gh = (args) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        listBranches: () => listRemoteBranches(gh),
        pullRequestsFor: (names) => pullRequestsForBranches(names, gh),
        branchTip: (name) => fetchBranchTip(name, gh),
        deleteBranch: (name) => deleteRemoteBranch(name, gh),
    };
}

async function main(): Promise<number> {
    const parsed = parsePruneRemoteBranchesArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/pruneRemoteBranches.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/pruneRemoteBranches.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        return pruneRemoteBranches(parsed, shellPort(auth.session), (message) => console.log(message));
    } finally {
        auth.session.dispose();
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
