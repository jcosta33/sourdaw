/**
 * GitHub I/O for `pnpm pr:supersede`. This module owns the GraphQL shapes and the shell port that
 * reach GitHub: pull-request inspection, the live review threads that name the old pull request's
 * findings, issue comments, comment creation and deletion, and closure. The transaction and its
 * marker contract live in `supersedePullRequest.ts`, which drives this port and never touches `gh`.
 *
 * The review-thread read reuses `reviewRepair.ts`'s comment fragment and numeric-database-id reader,
 * so this command binds a finding's `databaseId` the same way the other review commands already do
 * rather than inventing a second shape.
 */

import {
    REQUIRED_REPOSITORY,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail, PR_STATE } from './prContract.ts';
import { REVIEW_THREAD_COMMENT_FIELDS, readCommentDatabaseId } from './reviewRepair.ts';

export type IssueComment = {
    id: string;
    fullDatabaseId: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};
export type SupersededPullRequest = {
    number: number;
    state: string;
    head: string;
    repository: string;
    base: string;
    closedAt: string | null;
    comments: IssueComment[];
};
export type PullRequestCloseReceipt = { closedAt: string };
export type AddedIssueCommentReceipt = IssueComment & { clientMutationId: string };
/** One live review thread as a finding: its node id and its root comment's numeric database id. */
export type SupersededReviewThread = { threadId: string; rootCommentId: string };
export type SupersedePullRequestPort = {
    inspect: (number: number) => SupersededPullRequest;
    inspectReviewThreads: (number: number) => SupersededReviewThread[];
    comment: (number: number, body: string) => AddedIssueCommentReceipt;
    close: (number: number) => PullRequestCloseReceipt;
    deleteComment: (id: string) => void;
    log: (message: string) => void;
};

export function commentClientMutationId(number: number, body: string): string {
    return `supersede-comment:${number}:${body}`;
}

export function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): SupersedePullRequestPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    const ids = new Map<number, string>();
    const nodeId = (number: number) => ids.get(number) ?? fail(`PR #${number} was not inspected`);
    return {
        inspect: (number) => inspectPullRequest(number, gh, ids),
        inspectReviewThreads: (number) => inspectReviewThreads(number, gh),
        comment: (number, body) => addComment(nodeId(number), body, commentClientMutationId(number, body), gh),
        close: (number) => closePullRequest(nodeId(number), gh),
        deleteComment: (id) => deleteComment(id, gh),
        log: (message) => console.log(message),
    };
}
type Gh = (args: string[]) => string;
function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}
function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}
function repositoryFields(): string[] {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    return ['-f', `owner=${owner}`, '-f', `name=${name}`];
}
function inspectPullRequest(number: number, gh: Gh, ids: Map<number, string>): SupersededPullRequest {
    const query =
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){id number state headRefOid baseRefName closedAt}}}';
    const response = graphql(gh, query, [...repositoryFields(), '-F', `number=${number}`], `PR #${number} query`) as {
        data?: {
            repository?: {
                nameWithOwner?: unknown;
                pullRequest?: {
                    id?: unknown;
                    number?: unknown;
                    state?: unknown;
                    headRefOid?: unknown;
                    baseRefName?: unknown;
                    closedAt?: unknown;
                };
            };
        };
    };
    const repository = response.data?.repository;
    const pullRequest = repository?.pullRequest;
    if (
        repository?.nameWithOwner !== REQUIRED_REPOSITORY ||
        typeof pullRequest?.id !== 'string' ||
        typeof pullRequest.number !== 'number' ||
        !Number.isSafeInteger(pullRequest.number) ||
        typeof pullRequest.state !== 'string' ||
        typeof pullRequest.headRefOid !== 'string' ||
        typeof pullRequest.baseRefName !== 'string' ||
        (typeof pullRequest.closedAt !== 'string' && pullRequest.closedAt !== null)
    ) {
        fail(`cannot inspect PR #${number}`);
    }
    ids.set(number, pullRequest.id);
    return {
        number: pullRequest.number,
        state: pullRequest.state,
        head: pullRequest.headRefOid,
        repository: repository.nameWithOwner,
        base: pullRequest.baseRefName,
        closedAt: pullRequest.closedAt,
        comments: inspectIssueComments(pullRequest.id, gh),
    };
}
/**
 * The old pull request's live review threads, each reduced to the finding the lineage binds: the
 * thread's node id and its root comment's numeric database id. The root is the first comment in the
 * thread's own order, so one comment page names it; threads paginate so a long review is not read as
 * a short one, and a repeated root refuses rather than collapsing two findings into one entry.
 */
export function inspectReviewThreads(number: number, gh: Gh): SupersededReviewThread[] {
    const label = `PR #${number} review threads`;
    const threads: SupersededReviewThread[] = [];
    const roots = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
        const paged = cursor !== undefined;
        const connection = `reviewThreads(first:100${paged ? ',after:$cursor' : ''})`;
        const variables = `$owner:String!,$name:String!,$number:Int!${paged ? ',$cursor:String!' : ''}`;
        const query = `query(${variables}){repository(owner:$owner,name:$name){pullRequest(number:$number){${connection}{nodes{id comments(first:1){${REVIEW_THREAD_COMMENT_FIELDS}}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = [...repositoryFields(), '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-f', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, label) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        reviewThreads?: {
                            nodes?: unknown;
                            pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
                        };
                    };
                };
            };
        };
        const page = response.data?.repository?.pullRequest?.reviewThreads;
        if (!isUnknownArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review threads for PR #${number}`);
        }
        for (const node of page.nodes) {
            const thread = toSupersededReviewThread(node, number);
            if (roots.has(thread.rootCommentId)) {
                fail(`PR #${number} carries two review threads rooted at comment ${thread.rootCommentId}`);
            }
            roots.add(thread.rootCommentId);
            threads.push(thread);
        }
        if (!page.pageInfo.hasNextPage) {
            return threads;
        }
        const next = page.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-thread pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function toSupersededReviewThread(value: unknown, number: number): SupersededReviewThread {
    const thread = value as { id?: unknown; comments?: { nodes?: unknown } };
    const comments = thread.comments?.nodes;
    if (typeof thread.id !== 'string' || thread.id === '' || !isUnknownArray(comments)) {
        fail(`cannot inspect a review thread on PR #${number}`);
    }
    const [root] = comments;
    if (root === undefined) {
        fail(`review thread ${thread.id} on PR #${number} carries no root comment`);
    }
    const comment = root as { databaseId?: unknown };
    const databaseId = readCommentDatabaseId(
        comment.databaseId,
        `PR #${number} review thread ${thread.id} root comment`
    );
    return { threadId: thread.id, rootCommentId: String(databaseId) };
}
export function inspectIssueComments(subjectId: string, gh: Gh): IssueComment[] {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const comments: IssueComment[] = [];
    for (;;) {
        const connection = cursor === undefined ? 'comments(first:100)' : 'comments(first:100,after:$cursor)';
        const query = `query($subjectId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){node(id:$subjectId){id ... on PullRequest{${connection}{nodes{id fullDatabaseId body author{login __typename ... on Bot{id}}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `subjectId=${subjectId}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `issue comments for ${subjectId}`) as {
            data?: {
                node?: {
                    id?: unknown;
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        const node = response.data?.node;
        if (
            node?.id !== subjectId ||
            !isUnknownArray(node.comments?.nodes) ||
            typeof node.comments.pageInfo?.hasNextPage !== 'boolean'
        ) {
            fail(`invalid issue comments for ${subjectId}`);
        }
        for (const value of node.comments.nodes) {
            const comment = toIssueComment(value);
            if (comments.some((current) => current.id === comment.id)) {
                fail(`duplicate issue comment ${comment.id}`);
            }
            comments.push(comment);
        }
        if (!node.comments.pageInfo.hasNextPage) {
            return comments;
        }
        const next = node.comments.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid issue-comment pagination for ${subjectId}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function toIssueComment(value: unknown): IssueComment {
    const comment = value as {
        id?: unknown;
        fullDatabaseId?: unknown;
        body?: unknown;
        author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
    };
    if (typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId) || typeof comment.body !== 'string') {
        fail('invalid issue comment');
    }
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorNodeId: typeof comment.author?.id === 'string' ? comment.author.id : null,
        authorLogin: typeof comment.author?.login === 'string' ? comment.author.login : null,
        authorType: typeof comment.author?.__typename === 'string' ? comment.author.__typename : null,
    };
}
function addComment(subjectId: string, body: string, clientMutationId: string, gh: Gh): AddedIssueCommentReceipt {
    const query =
        'mutation($subjectId:ID!,$body:String!,$clientMutationId:String!){addComment(input:{subjectId:$subjectId,body:$body,clientMutationId:$clientMutationId}){clientMutationId commentEdge{node{id fullDatabaseId body author{login __typename ... on Bot{id}}}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `subjectId=${subjectId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        'add supersession comment'
    ) as { data?: { addComment?: { clientMutationId?: unknown; commentEdge?: { node?: unknown } } } };
    if (response.data?.addComment?.clientMutationId !== clientMutationId) {
        fail('add supersession comment returned an invalid result');
    }
    return { ...toIssueComment(response.data?.addComment?.commentEdge?.node), clientMutationId };
}
function closePullRequest(pullRequestId: string, gh: Gh): PullRequestCloseReceipt {
    const clientMutationId = `supersede-close:${pullRequestId}`;
    const query = `mutation($pullRequestId:ID!,$clientMutationId:String!){closePullRequest(input:{pullRequestId:$pullRequestId,clientMutationId:$clientMutationId}){clientMutationId pullRequest{id state closedAt}}}`;
    const response = graphql(
        gh,
        query,
        ['-F', `pullRequestId=${pullRequestId}`, '-f', `clientMutationId=${clientMutationId}`],
        'close pull request'
    ) as {
        data?: {
            closePullRequest?: {
                clientMutationId?: unknown;
                pullRequest?: { id?: unknown; state?: unknown; closedAt?: unknown };
            };
        };
    };
    const receipt = response.data?.closePullRequest;
    if (
        receipt?.clientMutationId !== clientMutationId ||
        receipt.pullRequest?.id !== pullRequestId ||
        receipt.pullRequest.state !== PR_STATE.CLOSED ||
        typeof receipt.pullRequest.closedAt !== 'string' ||
        receipt.pullRequest.closedAt === ''
    ) {
        fail('closePullRequest returned an invalid result');
    }
    return { closedAt: receipt.pullRequest.closedAt };
}
export function deleteComment(id: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($id:ID!,$clientMutationId:String!){deleteIssueComment(input:{id:$id,clientMutationId:$clientMutationId}){clientMutationId}}',
        ['-F', `id=${id}`, '-f', `clientMutationId=${id}`],
        'delete supersession comment'
    ) as { data?: { deleteIssueComment?: { clientMutationId?: unknown } } };
    if (response.data?.deleteIssueComment?.clientMutationId !== id) {
        fail(`delete supersession comment returned an invalid result for ${id}`);
    }
}
