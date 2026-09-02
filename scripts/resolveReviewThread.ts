#!/usr/bin/env node
import {
    AUTHOR_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isAuthorBotNodeId,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export const USAGE = 'usage: pnpm review:resolve <pr-number> --thread <thread-node-id> --head <full-sha>';

/** The only body this command ever writes. A thread is answered by a fixed head, not by prose. */
export const RESOLUTION_REPLY_BODY = 'Done';

const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/;

export type ThreadReply = {
    id: string;
    body: string;
    authorNodeId: string | null;
    commitOid: string | null;
};

export type ThreadState = {
    threadId: string;
    isResolved: boolean;
    pullRequestNumber: number;
    pullRequestState: string;
    head: string;
    replies: ThreadReply[];
};

export type ResolveReviewThreadPort = {
    read: (threadId: string) => ThreadState;
    reply: (threadId: string, clientMutationId: string) => void;
    resolve: (threadId: string, clientMutationId: string) => void;
    log: (message: string) => void;
};

export type ResolveReviewThreadAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type ResolveReviewThreadCoordinatorDependencies = {
    primaryRoot: () => string;
    authenticateAuthor: (primaryRoot: string) => Promise<ResolveReviewThreadAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    threadPort: (session: GhSession, primaryRoot: string) => ResolveReviewThreadPort;
    resolve: (number: number, threadId: string, expectedHead: string, port: ResolveReviewThreadPort) => string;
};

export type ResolveReviewThreadArgs = { number?: number; threadId?: string; head?: string; help: boolean };

export function parseResolveReviewThreadArgs(args: string[]): ResolveReviewThreadArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const [number, threadFlag, threadId, headFlag, head] = args;
    if (
        args.length !== 5 ||
        threadFlag !== '--thread' ||
        headFlag !== '--head' ||
        number === undefined ||
        threadId === undefined ||
        head === undefined ||
        !/^[1-9][0-9]*$/.test(number) ||
        !/^\S+$/.test(threadId) ||
        !FORTY_HEX_PATTERN.test(head)
    ) {
        fail(USAGE);
    }
    const parsed = Number(number);
    if (!Number.isSafeInteger(parsed)) {
        fail(USAGE);
    }
    return { number: parsed, threadId, head, help: false };
}

/**
 * Both mutations carry an id derived from what the caller asked for, never from a clock or a random
 * source. A rerun after a partial failure therefore replays the identical request, and the receipt
 * GitHub hands back is checked against the id that was sent — so a response belonging to some other
 * request can never be read as this one succeeding.
 */
export function replyClientMutationId(number: number, threadId: string, head: string): string {
    return `review-resolve-reply:${number}:${threadId}:${head}`;
}

export function resolveClientMutationId(number: number, threadId: string, head: string): string {
    return `review-resolve:${number}:${threadId}:${head}`;
}

/**
 * A `Done` the author App wrote against this exact head. The actor match is on the immutable bot
 * node id, because a login is mutable and a foreign actor posting the same word is not this reply.
 * The commit match is what makes a rerun safe on a thread a reviewer reopened: the earlier `Done`
 * answers the head it was pinned to, and the reopened thread is owed a new one.
 */
function authorDoneReply(state: ThreadState, expectedHead: string): ThreadReply | undefined {
    return state.replies.find(
        (reply) =>
            reply.body === RESOLUTION_REPLY_BODY &&
            isAuthorBotNodeId(reply.authorNodeId) &&
            reply.commitOid === expectedHead
    );
}

function assertThreadPrecondition(state: ThreadState, number: number, threadId: string, expectedHead: string): void {
    if (state.threadId !== threadId) {
        fail(`GitHub returned thread ${state.threadId} for requested thread ${threadId}`);
    }
    if (state.pullRequestNumber !== number) {
        fail(`thread ${threadId} belongs to PR #${state.pullRequestNumber}, not PR #${number}`);
    }
    if (state.pullRequestState !== 'OPEN') {
        fail(`PR #${number} is ${state.pullRequestState}; refusing to resolve a thread on a closed pull request`);
    }
    if (state.head !== expectedHead) {
        fail(`PR #${number} head is ${state.head}, not ${expectedHead}; resolve against the head that addresses it`);
    }
}

/**
 * Reply, then resolve, then read the thread back. Both mutations are idempotent against state that
 * is readable before and after them, so a rerun after a partial failure needs nothing persisted: the
 * reply is skipped when the author's `Done` for this head is already there, and an already-resolved
 * thread that carries that reply is the finished state rather than a conflict.
 */
export function resolveReviewThread(
    number: number,
    threadId: string,
    expectedHead: string,
    port: ResolveReviewThreadPort
): string {
    const before = port.read(threadId);
    assertThreadPrecondition(before, number, threadId, expectedHead);
    const existingReply = authorDoneReply(before, expectedHead);
    if (before.isResolved && existingReply === undefined) {
        fail(
            `thread ${threadId} is already resolved without a Done reply from ${AUTHOR_BOT_NODE_ID} at ${expectedHead}`
        );
    }
    if (before.isResolved) {
        return logResolved(number, threadId, port);
    }
    if (existingReply === undefined) {
        port.reply(threadId, replyClientMutationId(number, threadId, expectedHead));
    }
    port.resolve(threadId, resolveClientMutationId(number, threadId, expectedHead));
    const after = port.read(threadId);
    if (authorDoneReply(after, expectedHead) === undefined) {
        fail(`thread ${threadId} carries no Done reply from ${AUTHOR_BOT_NODE_ID} at ${expectedHead} after replying`);
    }
    if (!after.isResolved) {
        fail(`thread ${threadId} is still unresolved after resolveReviewThread`);
    }
    return logResolved(number, threadId, port);
}

function logResolved(number: number, threadId: string, port: ResolveReviewThreadPort): string {
    const success = `review-thread-resolved:${number}:${threadId}`;
    port.log(success);
    return success;
}

type Gh = (args: string[]) => string;

function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}

type ThreadNode = {
    id?: unknown;
    isResolved?: unknown;
    pullRequest?: { number?: unknown; state?: unknown; headRefOid?: unknown };
    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
};

const THREAD_COMMENT_FIELDS =
    'nodes{id body commit{oid} author{__typename login ... on Bot{id}}} pageInfo{hasNextPage endCursor}';

function threadQuery(paged: boolean): string {
    const connection = paged ? 'comments(first:100,after:$cursor)' : 'comments(first:100)';
    return `query($threadId:ID!${paged ? ',$cursor:String!' : ''}){node(id:$threadId){... on PullRequestReviewThread{id isResolved pullRequest{number state headRefOid} ${connection}{${THREAD_COMMENT_FIELDS}}}}}`;
}

type ThreadCommentNode = { id?: unknown; body?: unknown; author?: unknown; commit?: unknown };

function readThreadReply(node: ThreadCommentNode, threadId: string): ThreadReply {
    const author = node.author as { id?: unknown } | null | undefined;
    const commit = node.commit as { oid?: unknown } | null | undefined;
    if (typeof node.id !== 'string' || typeof node.body !== 'string') {
        fail(`review thread ${threadId} returned an unreadable comment`);
    }
    return {
        id: node.id,
        body: node.body,
        authorNodeId: typeof author?.id === 'string' ? author.id : null,
        commitOid: typeof commit?.oid === 'string' ? commit.oid : null,
    };
}

export function readReviewThread(threadId: string, gh: Gh): ThreadState {
    const label = `review thread ${threadId}`;
    let cursor: string | undefined;
    const seen = new Set<string>();
    const replies: ThreadReply[] = [];
    for (;;) {
        const fields = ['-f', `threadId=${threadId}`, ...(cursor === undefined ? [] : ['-f', `cursor=${cursor}`])];
        const response = graphql(gh, threadQuery(cursor !== undefined), fields, label) as {
            data?: { node?: ThreadNode | null };
        };
        const node = response.data?.node;
        if (
            typeof node?.id !== 'string' ||
            typeof node.isResolved !== 'boolean' ||
            typeof node.pullRequest?.number !== 'number' ||
            typeof node.pullRequest.state !== 'string' ||
            typeof node.pullRequest.headRefOid !== 'string' ||
            !Array.isArray(node.comments?.nodes) ||
            typeof node.comments.pageInfo?.hasNextPage !== 'boolean'
        ) {
            fail(`${label} is not a readable pull-request review thread`);
        }
        for (const comment of node.comments.nodes) {
            replies.push(readThreadReply(comment as ThreadCommentNode, threadId));
        }
        if (!node.comments.pageInfo.hasNextPage) {
            return {
                threadId: node.id,
                isResolved: node.isResolved,
                pullRequestNumber: node.pullRequest.number,
                pullRequestState: node.pullRequest.state,
                head: node.pullRequest.headRefOid,
                replies,
            };
        }
        const next = node.comments.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || seen.has(next)) {
            fail(`${label} returned invalid comment pagination`);
        }
        seen.add(next);
        cursor = next;
    }
}

/**
 * `addPullRequestReviewThreadReply` is the mutation that names a thread. Its predecessor
 * `addPullRequestReviewComment` is deprecated and needs a review envelope to reply into, which is
 * where every pending-review state this command used to reconcile came from.
 */
export function replyDone(threadId: string, clientMutationId: string, gh: Gh): void {
    const query =
        'mutation($threadId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id body}}}';
    const response = graphql(
        gh,
        query,
        [
            '-f',
            `threadId=${threadId}`,
            '-f',
            `body=${RESOLUTION_REPLY_BODY}`,
            '-f',
            `clientMutationId=${clientMutationId}`,
        ],
        `reply on review thread ${threadId}`
    ) as { data?: { addPullRequestReviewThreadReply?: { clientMutationId?: unknown; comment?: { body?: unknown } } } };
    const receipt = response.data?.addPullRequestReviewThreadReply;
    if (receipt?.clientMutationId !== clientMutationId || receipt.comment?.body !== RESOLUTION_REPLY_BODY) {
        fail(`addPullRequestReviewThreadReply returned an invalid result for ${threadId}`);
    }
}

export function resolveThread(threadId: string, clientMutationId: string, gh: Gh): void {
    const query =
        'mutation($threadId:ID!,$clientMutationId:String!){resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId}){clientMutationId thread{id isResolved}}}';
    const response = graphql(
        gh,
        query,
        ['-f', `threadId=${threadId}`, '-f', `clientMutationId=${clientMutationId}`],
        `resolve review thread ${threadId}`
    ) as { data?: { resolveReviewThread?: { clientMutationId?: unknown; thread?: { id?: unknown } } } };
    const receipt = response.data?.resolveReviewThread;
    if (receipt?.clientMutationId !== clientMutationId || receipt.thread?.id !== threadId) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
    }
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture
): ResolveReviewThreadPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        read: (threadId) => readReviewThread(threadId, gh),
        reply: (threadId, clientMutationId) => replyDone(threadId, clientMutationId, gh),
        resolve: (threadId, clientMutationId) => resolveThread(threadId, clientMutationId, gh),
        log: (message) => {
            console.log(message);
        },
    };
}

export function defaultResolveReviewThreadCoordinatorDependencies(): ResolveReviewThreadCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        threadPort: (session, primaryRoot) => shellPort(session, primaryRoot, spawnCapture),
        resolve: resolveReviewThread,
    };
}

export async function coordinateResolveReviewThread(
    number: number,
    threadId: string,
    expectedHead: string,
    dependencies: ResolveReviewThreadCoordinatorDependencies = defaultResolveReviewThreadCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    const auth = await dependencies.authenticateAuthor(primaryRoot);
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        dependencies.resolve(number, threadId, expectedHead, dependencies.threadPort(auth.session, primaryRoot));
    } finally {
        auth.session.dispose();
    }
}

export async function runResolveReviewThreadCli(
    args: string[],
    dependencies?: ResolveReviewThreadCoordinatorDependencies
): Promise<number> {
    const parsed = parseResolveReviewThreadArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.threadId === undefined || parsed.head === undefined) {
        fail(USAGE);
    }
    await coordinateResolveReviewThread(parsed.number, parsed.threadId, parsed.head, dependencies);
    return 0;
}
