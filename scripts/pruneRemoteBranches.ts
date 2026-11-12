import { isAbsolute } from 'node:path';
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
import {
    branchHoldsRevision,
    fetchRecordedMeasurementRevisions,
    retainMeasurementRevisionHolders,
    type BranchClass,
    type RemoteBranch,
} from './measurementRevisionHolders.ts';
import {
    fail,
    PR_STATE,
    TRUSTED_GH_PATH_ENV,
    TRUSTED_GIT_PATH_ENV,
    TRUSTED_ORIGIN_COMMIT_ENV,
    TRUSTED_PRIMARY_ROOT_ENV,
    type PullRequestState,
} from './prContract.ts';

export type { PullRequestState };
export type BranchPullRequest = {
    number: number;
    state: PullRequestState;
    headRefOid: string;
    baseRefName: string;
};
export type DeleteOutcome = 'deleted' | 'already-gone' | 'moved';
export type PullRequestListing = { pullRequests: BranchPullRequest[]; complete: boolean };

export type PruneRemoteBranchesPort = {
    listBranches: () => RemoteBranch[];
    pullRequestsFor: (branches: string[]) => Map<string, PullRequestListing>;
    baseDependentsFor: (branches: string[]) => Map<string, PullRequestListing>;
    branchTip: (name: string) => string | undefined;
    deleteBranch: (branch: RemoteBranch) => DeleteOutcome;
    recordedMeasurementRevisions: () => string[];
    baseBranchTip: () => RemoteBranch;
    branchHoldsRevision: (branch: RemoteBranch, revision: string) => boolean;
};

export type PruneRemoteBranchesArgs = { apply: boolean; limit?: number; help: boolean; branches?: string[] };

const usage = 'usage: pnpm branch:prune [--apply] [--limit <n>] [--branch <name>]...';
const BATCH_SIZE = 50;
const [REQUIRED_OWNER, REQUIRED_NAME] = REQUIRED_REPOSITORY.split('/') as [string, string];

export function parsePruneRemoteBranchesArgs(args: string[]): PruneRemoteBranchesArgs {
    if (args.length === 1 && args[0] === '--help') {
        return { apply: false, help: true };
    }
    let apply = false;
    let limit: number | undefined;
    let branches: string[] | undefined;
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
        if (arg === '--branch') {
            const name = parseBranchSelector(args[index + 1]);
            branches ??= [];
            if (!branches.includes(name)) {
                branches.push(name);
            }
            index += 2;
            continue;
        }
        fail(usage);
    }
    return { apply, limit, help: false, branches };
}

function parseBranchSelector(value: string | undefined): string {
    if (value === undefined || value === '' || value.startsWith('-')) {
        fail(usage);
    }
    try {
        spawnCapture('git', ['check-ref-format', `refs/heads/${value}`]);
    } catch {
        fail(usage);
    }
    return value;
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

export function classifyRemoteBranch(
    branch: RemoteBranch,
    pullRequests: BranchPullRequest[],
    complete: boolean
): BranchClass {
    if (branch.name === REQUIRED_BASE_BRANCH) {
        return 'protected';
    }
    if (!complete) {
        return 'unlisted';
    }
    if (pullRequests.some((pullRequest) => pullRequest.state === PR_STATE.OPEN)) {
        return 'open';
    }
    if (pullRequests.length === 0) {
        return 'unpublished';
    }
    if (!pullRequests.some((pullRequest) => pullRequest.headRefOid === branch.tip)) {
        return 'moved';
    }
    if (!pullRequests.some((pullRequest) => landedTip(branch, pullRequest))) {
        return 'unmerged';
    }
    return 'spent';
}

/**
 * Only a merge into main proves a branch's work landed: a closed-unmerged pull request leaves its
 * commits nowhere else, and a child merged into its parent's branch has not reached main yet.
 */
function landedTip(branch: RemoteBranch, pullRequest: BranchPullRequest): boolean {
    return (
        pullRequest.state === PR_STATE.MERGED &&
        pullRequest.baseRefName === REQUIRED_BASE_BRANCH &&
        pullRequest.headRefOid === branch.tip
    );
}

function batchNames(names: string[], size: number): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < names.length; index += size) {
        batches.push(names.slice(index, index + size));
    }
    return batches;
}

function fetchPullRequestsInBatches(names: string[], port: PruneRemoteBranchesPort): Map<string, PullRequestListing> {
    const result = new Map<string, PullRequestListing>();
    for (const batch of batchNames(names, BATCH_SIZE)) {
        const batchResult = port.pullRequestsFor(batch);
        for (const name of batch) {
            const listing = batchResult.get(name);
            if (listing === undefined) {
                fail(`missing pull-request batch result for ${name}`);
            }
            result.set(name, listing);
        }
    }
    return result;
}

function fetchBaseDependentsInBatches(names: string[], port: PruneRemoteBranchesPort): Map<string, PullRequestListing> {
    const result = new Map<string, PullRequestListing>();
    for (const batch of batchNames(names, BATCH_SIZE)) {
        let batchResult: Map<string, PullRequestListing>;
        try {
            batchResult = port.baseDependentsFor(batch);
        } catch {
            batchResult = new Map();
        }
        for (const name of batch) {
            result.set(name, batchResult.get(name) ?? { pullRequests: [], complete: false });
        }
    }
    return result;
}

function dependentBlockReason(listing: PullRequestListing): string | undefined {
    if (!listing.complete) {
        return 'base-dependent pull requests not fully listed';
    }
    const dependent = listing.pullRequests.find((pullRequest) => pullRequest.state === PR_STATE.OPEN);
    return dependent === undefined ? undefined : `open base-dependent pull request #${dependent.number}`;
}

function requireListing(prMap: Map<string, PullRequestListing>, name: string): PullRequestListing {
    const listing = prMap.get(name);
    if (listing === undefined) {
        fail(`missing pull-request listing for ${name}`);
    }
    return listing;
}

function classifyBranches(branches: RemoteBranch[], prMap: Map<string, PullRequestListing>): Map<string, BranchClass> {
    const classes = new Map<string, BranchClass>();
    for (const branch of branches) {
        const listing = requireListing(prMap, branch.name);
        classes.set(branch.name, classifyRemoteBranch(branch, listing.pullRequests, listing.complete));
    }
    return classes;
}

function countByClass(classes: Map<string, BranchClass>): Record<BranchClass, number> {
    const counts: Record<BranchClass, number> = {
        protected: 0,
        unlisted: 0,
        open: 0,
        unpublished: 0,
        moved: 0,
        unmerged: 0,
        spent: 0,
    };
    for (const value of classes.values()) {
        counts[value] += 1;
    }
    return counts;
}

function matchingPullRequest(branch: RemoteBranch, pullRequests: BranchPullRequest[]): BranchPullRequest {
    const matching = pullRequests.find((pullRequest) => landedTip(branch, pullRequest));
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

function printUnlistedBranches(
    branches: RemoteBranch[],
    classes: Map<string, BranchClass>,
    log: (message: string) => void
): void {
    for (const branch of branches) {
        if (classes.get(branch.name) === 'unlisted') {
            log(`kept ${branch.name}: pull requests not fully listed`);
        }
    }
}

function printPlan(
    branches: RemoteBranch[],
    classes: Map<string, BranchClass>,
    prMap: Map<string, PullRequestListing>,
    log: (message: string) => void
): void {
    const counts = countByClass(classes);
    for (const branchClass of Object.keys(counts) as BranchClass[]) {
        log(`${branchClass}: ${counts[branchClass]}`);
    }
    for (const branch of branches) {
        if (classes.get(branch.name) === 'spent') {
            const pr = matchingPullRequest(branch, requireListing(prMap, branch.name).pullRequests);
            log(`spent ${branch.name} ${branch.tip.slice(0, 9)} #${pr.number}:${pr.state}`);
        }
    }
    printNamesUnderHeading('moved', branches, classes, log);
    printNamesUnderHeading('unmerged', branches, classes, log);
    printNamesUnderHeading('unpublished', branches, classes, log);
    printUnlistedBranches(branches, classes, log);
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
    const outcome = port.deleteBranch(branch);
    if (outcome === 'deleted') {
        const pr = matchingPullRequest(branch, freshPullRequests);
        log(`deleted ${branch.name} (${branch.tip.slice(0, 9)}, #${pr.number} ${pr.state})`);
    } else if (outcome === 'moved') {
        log(`kept ${branch.name}: moved at delete`);
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
        const freshListing = requireListing(port.pullRequestsFor([branch.name]), branch.name);
        const freshPullRequests = freshListing.pullRequests;
        const recheckClass = classifyRemoteBranch(
            { name: branch.name, tip: freshTip },
            freshPullRequests,
            freshListing.complete
        );
        const tipMoved = freshTip !== branch.tip;
        if (recheckClass !== 'spent' || tipMoved) {
            keptAtRecheck += 1;
            log(`kept ${branch.name}: ${recheckDisplayClass(recheckClass, tipMoved)} at re-check`);
            continue;
        }
        let freshDependents: PullRequestListing;
        try {
            freshDependents = requireListing(port.baseDependentsFor([branch.name]), branch.name);
        } catch {
            freshDependents = { pullRequests: [], complete: false };
        }
        const dependentReason = dependentBlockReason(freshDependents);
        if (dependentReason !== undefined) {
            keptAtRecheck += 1;
            log(`kept ${branch.name}: ${dependentReason} at re-check`);
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
        } else if (outcome === 'moved') {
            keptAtRecheck += 1;
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
    const selectedNames = args.branches === undefined ? undefined : new Set(args.branches);
    for (const name of selectedNames ?? []) {
        if (!branches.some((branch) => branch.name === name)) {
            fail(`unknown remote branch: ${name}`);
        }
    }
    const prMap = fetchPullRequestsInBatches(
        branches.map((branch) => branch.name),
        port
    );
    const classes = classifyBranches(branches, prMap);
    const dependents = fetchBaseDependentsInBatches(
        branches.map((branch) => branch.name),
        port
    );
    for (const branch of branches) {
        if (classes.get(branch.name) !== 'spent') {
            continue;
        }
        const reason = dependentBlockReason(requireListing(dependents, branch.name));
        if (reason !== undefined) {
            classes.set(branch.name, 'open');
            log(`kept ${branch.name}: ${reason}`);
        }
    }
    retainMeasurementRevisionHolders(branches, classes, port, log);
    const selectedBranches = branches.filter((branch) => selectedNames === undefined || selectedNames.has(branch.name));
    const selectedClasses = new Map(
        Array.from(classes).filter(([name]) => selectedNames === undefined || selectedNames.has(name))
    );
    printPlan(selectedBranches, selectedClasses, prMap, log);
    const spent = selectedBranches
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
    const node = value as { number?: unknown; state?: unknown; headRefOid?: unknown; baseRefName?: unknown };
    if (
        typeof node.number !== 'number' ||
        !Number.isSafeInteger(node.number) ||
        (node.state !== PR_STATE.OPEN && node.state !== PR_STATE.MERGED && node.state !== PR_STATE.CLOSED) ||
        typeof node.headRefOid !== 'string' ||
        typeof node.baseRefName !== 'string'
    ) {
        fail('invalid pull-request node');
    }
    return { number: node.number, state: node.state, headRefOid: node.headRefOid, baseRefName: node.baseRefName };
}

function pullRequestBatchQuery(size: number): string {
    const params = Array.from({ length: size }, (_unused, index) => `$n${index}:String!`).join(',');
    const aliases = Array.from(
        { length: size },
        (_unused, index) =>
            `b${index}: pullRequests(headRefName:$n${index}, first:10, states:[OPEN,MERGED,CLOSED], orderBy:{field:CREATED_AT,direction:DESC}){totalCount nodes{number state headRefOid baseRefName}}`
    ).join(' ');
    return `query(${params}){repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){${aliases}}}`;
}

function baseDependentBatchQuery(size: number): string {
    const params = Array.from({ length: size }, (_unused, index) => `$n${index}:String!`).join(',');
    const aliases = Array.from(
        { length: size },
        (_unused, index) =>
            `b${index}: pullRequests(baseRefName:$n${index}, first:10, states:[OPEN], orderBy:{field:CREATED_AT,direction:DESC}){totalCount nodes{number state headRefOid baseRefName}}`
    ).join(' ');
    return `query(${params}){repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){${aliases}}}`;
}

export function parsePullRequestListing(alias: unknown, name: string): PullRequestListing {
    const node = alias as { nodes?: unknown; totalCount?: unknown } | undefined;
    if (node === undefined || !Array.isArray(node.nodes)) {
        fail(`missing pull-request alias for ${name}`);
    }
    if (typeof node.totalCount !== 'number') {
        fail(`invalid pull-request total count for ${name}`);
    }
    const pullRequests = node.nodes.map(toBranchPullRequest);
    return { pullRequests, complete: pullRequests.length === node.totalCount };
}

function pullRequestsForBranches(names: string[], gh: Gh): Map<string, PullRequestListing> {
    if (names.length === 0) {
        return new Map();
    }
    const query = pullRequestBatchQuery(names.length);
    const fields = names.flatMap((name, index) => ['-f', `n${index}=${name}`]);
    const response = graphql(gh, query, fields, 'branch pull requests') as {
        data?: { repository?: Record<string, unknown> };
    };
    const repository = response.data?.repository;
    if (repository === undefined) {
        fail('invalid branch pull-request response');
    }
    const result = new Map<string, PullRequestListing>();
    for (const [index, name] of names.entries()) {
        result.set(name, parsePullRequestListing(repository[`b${index}`], name));
    }
    return result;
}

export function queryBaseDependents(names: string[], gh: Gh): Map<string, PullRequestListing> {
    if (names.length === 0) {
        return new Map();
    }
    const query = baseDependentBatchQuery(names.length);
    const fields = names.flatMap((name, index) => ['-f', `n${index}=${name}`]);
    const response = graphql(gh, query, fields, 'base-dependent pull requests') as {
        data?: { repository?: Record<string, unknown> };
    };
    const repository = response.data?.repository;
    if (repository === undefined) {
        fail('invalid base-dependent pull-request response');
    }
    return new Map(names.map((name, index) => [name, parsePullRequestListing(repository[`b${index}`], name)]));
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

const ZERO_OID = '0'.repeat(40);
const DELETE_REF_MUTATION =
    'mutation($repositoryId:ID!,$name:GitRefname!,$beforeOid:GitObjectID!,$afterOid:GitObjectID!){' +
    'updateRefs(input:{repositoryId:$repositoryId,refUpdates:[{name:$name,beforeOid:$beforeOid,afterOid:$afterOid,force:false}]})' +
    '{clientMutationId}}';

/**
 * Deletes the branch only while it still points at the tip it was classified on: `updateRefs`
 * refuses the whole update when `beforeOid` no longer matches, so a push landing after the re-check
 * survives. A refusal does not say why, so the ref is read again: absent is already gone, another tip
 * moved, and the classified tip still in place means the refusal was something else and is reported.
 */
export function deleteRemoteBranch(
    branch: RemoteBranch,
    repositoryId: string,
    gh: Gh,
    readTip: (name: string) => string | undefined
): DeleteOutcome {
    try {
        graphql(
            gh,
            DELETE_REF_MUTATION,
            [
                '-f',
                `repositoryId=${repositoryId}`,
                '-f',
                `name=refs/heads/${branch.name}`,
                '-f',
                `beforeOid=${branch.tip}`,
                '-f',
                `afterOid=${ZERO_OID}`,
            ],
            `delete branch ${branch.name}`
        );
        return 'deleted';
    } catch (error) {
        const tip = readTip(branch.name);
        if (tip === undefined) {
            return 'already-gone';
        }
        if (tip !== branch.tip) {
            return 'moved';
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`delete branch ${branch.name}: ${message}`, { cause: error });
    }
}

function fetchRepositoryId(gh: Gh): string {
    const query = `query{repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){id}}`;
    const response = graphql(gh, query, [], 'repository id') as { data?: { repository?: { id?: unknown } } };
    const id = response.data?.repository?.id;
    if (typeof id !== 'string' || id === '') {
        fail('invalid repository id response');
    }
    return id;
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): PruneRemoteBranchesPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh: Gh = (args) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    let repositoryId: string | undefined;
    return {
        listBranches: () => listRemoteBranches(gh),
        pullRequestsFor: (names) => pullRequestsForBranches(names, gh),
        baseDependentsFor: (names) => queryBaseDependents(names, gh),
        branchTip: (name) => fetchBranchTip(name, gh),
        deleteBranch: (branch) => {
            repositoryId ??= fetchRepositoryId(gh);
            return deleteRemoteBranch(branch, repositoryId, gh, (name) => fetchBranchTip(name, gh));
        },
        recordedMeasurementRevisions: () => fetchRecordedMeasurementRevisions(gh),
        baseBranchTip: () => {
            const base = listRemoteBranches(gh).find((branch) => branch.name === REQUIRED_BASE_BRANCH);
            if (base === undefined) {
                fail(`remote branch listing is missing ${REQUIRED_BASE_BRANCH}`);
            }
            return base;
        },
        branchHoldsRevision: (branch, revision) => branchHoldsRevision(branch, revision, gh),
    };
}

/**
 * The launcher hands its runner the primary root, the commit it pinned, and the git and gh it froze.
 * A run without them was not launched through the protected primary checkout, whose snapshot is the
 * only source of this closure trusted beside the author key, so it stops before authenticating.
 */
export function trustedPruneRuntime(env: NodeJS.ProcessEnv): { primaryRoot: string; originCommit: string } {
    const primaryRoot = env[TRUSTED_PRIMARY_ROOT_ENV];
    const originCommit = env[TRUSTED_ORIGIN_COMMIT_ENV];
    const gitPath = env[TRUSTED_GIT_PATH_ENV];
    const ghPath = env[TRUSTED_GH_PATH_ENV];
    if (
        primaryRoot === undefined ||
        originCommit === undefined ||
        gitPath === undefined ||
        ghPath === undefined ||
        !isAbsolute(primaryRoot) ||
        !isAbsolute(gitPath) ||
        !isAbsolute(ghPath) ||
        !/^[0-9a-f]{40,64}$/.test(originCommit)
    ) {
        fail('branch:prune must run through the protected primary checkout launcher');
    }
    return { primaryRoot, originCommit };
}

export async function runPruneRemoteBranchesCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
    const parsed = parsePruneRemoteBranchesArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    const { primaryRoot, originCommit } = trustedPruneRuntime(env);
    assertTrustedExecutingBlob(
        'scripts/pruneRemoteBranches.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/pruneRemoteBranches.ts', primaryRoot, undefined, 'git', originCommit)
    );
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
        return pruneRemoteBranches(parsed, shellPort(auth.session, primaryRoot), (message) => console.log(message));
    } finally {
        auth.session.dispose();
    }
}
