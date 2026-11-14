import { parseGraphqlResponse, REQUIRED_REPOSITORY } from './githubAppIdentity.ts';
import { fail, PR_STATE, type PullRequestState } from './prContract.ts';

import type { RemoteBranch } from './measurementRevisionHolders.ts';

/** The GitHub reads and the guarded branch delete `branch:prune` runs through its port. */

const [REQUIRED_OWNER, REQUIRED_NAME] = REQUIRED_REPOSITORY.split('/') as [string, string];

export type BranchPullRequest = {
    number: number;
    state: PullRequestState;
    headRefOid: string;
    baseRefName: string;
};
export type DeleteOutcome = 'deleted' | 'already-gone' | 'moved';
export type PullRequestListing = { pullRequests: BranchPullRequest[]; complete: boolean };

export type Gh = (args: string[]) => string;

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

export function listRemoteBranches(gh: Gh): RemoteBranch[] {
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

export function pullRequestsForBranches(names: string[], gh: Gh): Map<string, PullRequestListing> {
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

export function fetchBranchTip(name: string, gh: Gh): string | undefined {
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

export function fetchRepositoryId(gh: Gh): string {
    const query = `query{repository(owner:"${REQUIRED_OWNER}",name:"${REQUIRED_NAME}"){id}}`;
    const response = graphql(gh, query, [], 'repository id') as { data?: { repository?: { id?: unknown } } };
    const id = response.data?.repository?.id;
    if (typeof id !== 'string' || id === '') {
        fail('invalid repository id response');
    }
    return id;
}
