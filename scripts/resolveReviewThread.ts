#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_LOGIN,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotLogin,
    isReviewerBotLogin,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type ReviewComment = { id: string; fullDatabaseId: string; body: string; authorLogin: string | null };
export type ReviewThread = {
    id: string;
    isResolved: boolean;
    resolvedByLogin: string | null;
    rootCommentId: string | null;
    rootCommentFullDatabaseId: string | null;
    rootAuthorLogin: string | null;
    comments: ReviewComment[];
};
export type ReviewThreadInspection = { head: string; thread: ReviewThread | null };
export type ReviewReply = { id: string; fullDatabaseId: string; authorLogin: string | null };
export type ReviewResolutionReceipt = { resolvedByLogin: string };
export type ResolveReviewThreadPort = {
    inspect: (number: number, threadId: string) => ReviewThreadInspection;
    replyDone: (threadId: string) => ReviewReply;
    resolve: (threadId: string) => ReviewResolutionReceipt;
    unresolve: (threadId: string) => void;
    deleteReply: (replyId: string) => void;
    log: (message: string) => void;
};
export type ResolveReviewThreadArgs = { number?: number; threadId?: string; head?: string; help: boolean };
const usage = 'usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>';

export function parseResolveReviewThreadArgs(args: string[]): ResolveReviewThreadArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--thread' ||
        args[3] !== '--head' ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^\S+$/.test(args[2]) ||
        !/^[0-9a-f]{40}$/i.test(args[4])
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, threadId: args[2], head: args[4], help: false };
}

export function resolveReviewThread(
    number: number,
    threadId: string,
    expectedHead: string,
    authorLogin: string,
    port: ResolveReviewThreadPort
): string {
    if (authorLogin !== AUTHOR_BOT_LOGIN) {
        fail(`authenticated author login ${authorLogin} is not ${AUTHOR_BOT_LOGIN}`);
    }
    const before = port.inspect(number, threadId);
    assertExpectedHead(before.head, expectedHead);
    assertResolvableThread(before.thread, threadId);
    let replyAttempted = false;
    let replyId: string | undefined;
    let resolveAttempted = false;
    let resolutionReceipt: ReviewResolutionReceipt | undefined;
    try {
        replyAttempted = true;
        const reply = port.replyDone(threadId);
        assertReply(reply);
        replyId = reply.id;
        const afterReply = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(afterReply.head, expectedHead);
        assertResolvableThread(afterReply.thread, threadId);
        resolveAttempted = true;
        resolutionReceipt = port.resolve(threadId);
        assertResolutionReceipt(resolutionReceipt);
        const verified = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(verified.head, expectedHead);
        assertFinalResolution(verified.thread, threadId, replyId);
    } catch (error) {
        compensateResolution(
            number,
            threadId,
            before,
            replyAttempted,
            replyId,
            resolveAttempted,
            resolutionReceipt,
            port,
            error
        );
    }
    const success = `review-thread-resolved:${number}:${threadId}`;
    port.log(success);
    return success;
}

function compensateResolution(
    number: number,
    threadId: string,
    before: ReviewThreadInspection,
    replyAttempted: boolean,
    replyId: string | undefined,
    resolveAttempted: boolean,
    resolutionReceipt: ReviewResolutionReceipt | undefined,
    port: ResolveReviewThreadPort,
    original: unknown
): never {
    const failures: string[] = [];
    let current: ReviewThreadInspection | undefined;
    attempt(failures, 'inspect ambiguous review transaction', () => {
        current = port.inspect(number, threadId);
    });
    if (current === undefined || current.thread === null || before.thread === null) {
        failures.push('cannot determine ambiguous review transaction state');
    } else {
        if (resolutionReceipt !== undefined && current.thread.isResolved !== before.thread.isResolved) {
            if (current.thread.resolvedByLogin === resolutionReceipt.resolvedByLogin) {
                attempt(failures, 'unresolve review thread', () => port.unresolve(threadId));
            } else {
                failures.push('review thread was resolved by another actor; refusing to unresolve');
            }
        } else if (resolveAttempted && current.thread.isResolved !== before.thread.isResolved) {
            failures.push('ambiguous review-thread resolution; refusing to unresolve an unverified transition');
        }
        if (replyAttempted) {
            if (replyId === undefined) {
                failures.push('ambiguous review reply mutation; refusing to delete an unverified comment');
            } else if (hasExpectedReply(current.thread, replyId)) {
                attempt(failures, 'delete review reply', () => port.deleteReply(replyId));
            } else {
                failures.push('review reply receipt is no longer present; refusing to delete an unverified comment');
            }
        }
    }
    attempt(failures, 'verify review-thread compensation', () => {
        const verified = port.inspect(number, threadId);
        if (
            before.thread === null ||
            verified.thread === null ||
            verified.thread.isResolved !== before.thread.isResolved ||
            !sameCommentIds(verified.thread.comments, before.thread.comments)
        ) {
            fail(`review thread ${threadId} compensation was not verified`);
        }
    });
    throwWithCompensation(original, failures);
}

function sameCommentIds(left: ReviewComment[], right: ReviewComment[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const ids = new Set(left.map((comment) => comment.id));
    return ids.size === right.length && right.every((comment) => ids.has(comment.id));
}
function throwWithCompensation(original: unknown, failures: string[]): never {
    const message = errorMessage(original);
    if (failures.length > 0) {
        throw new Error(`${message}; compensation failed: ${failures.join('; ')}`, { cause: original });
    }
    if (original instanceof Error) {
        throw original;
    }
    throw new Error(message);
}
function attempt(failures: string[], label: string, operation: () => void): void {
    try {
        operation();
    } catch (error) {
        failures.push(`${label}: ${errorMessage(error)}`);
    }
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function assertExpectedHead(currentHead: string, expectedHead: string): void {
    if (currentHead !== expectedHead) {
        fail('supplied head does not match the current pull-request head');
    }
}
function assertExpectedHeadAfterMutation(currentHead: string, expectedHead: string): void {
    if (currentHead !== expectedHead) {
        fail('pull-request head moved after mutation; compensating');
    }
}
function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}
function assertReply(reply: ReviewReply): void {
    if (
        typeof reply.id !== 'string' ||
        reply.id === '' ||
        !isDecimalId(reply.fullDatabaseId) ||
        !isAuthorBotLogin(reply.authorLogin)
    ) {
        fail('add review-thread reply returned an invalid result');
    }
}
function assertResolutionReceipt(receipt: ReviewResolutionReceipt): void {
    if (receipt.resolvedByLogin !== AUTHOR_BOT_LOGIN) {
        fail('resolve review thread returned an invalid result');
    }
}
function hasExpectedReply(thread: ReviewThread, replyId: string): boolean {
    return thread.comments.some(
        (comment) => comment.id === replyId && comment.body === 'Done' && comment.authorLogin === AUTHOR_BOT_LOGIN
    );
}
function assertFinalResolution(thread: ReviewThread | null, threadId: string, replyId: string): void {
    if (thread?.id !== threadId || !thread.isResolved || thread.resolvedByLogin !== AUTHOR_BOT_LOGIN) {
        fail(`review thread ${threadId} was not resolved by ${AUTHOR_BOT_LOGIN}`);
    }
    if (!hasExpectedReply(thread, replyId)) {
        fail(`review reply receipt ${replyId} is not present on thread ${threadId}`);
    }
}
function assertResolvableThread(thread: ReviewThread | null, expectedThreadId: string): void {
    if (thread === null || thread.id !== expectedThreadId) {
        fail(`review thread ${expectedThreadId} was not found on this pull request`);
    }
    if (thread.isResolved) {
        fail(`review thread ${expectedThreadId} is already resolved`);
    }
    if (!isReviewerBotLogin(thread.rootAuthorLogin)) {
        fail(`review thread ${expectedThreadId} root comment is not authored by ${REVIEWER_BOT_LOGIN}`);
    }
    if (
        typeof thread.rootCommentId !== 'string' ||
        thread.rootCommentId === '' ||
        !isDecimalId(thread.rootCommentFullDatabaseId)
    ) {
        fail(`review thread ${expectedThreadId} root comment has no decimal fullDatabaseId`);
    }
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): ResolveReviewThreadPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        inspect: (number, id) => inspectReviewThread(number, id, gh),
        replyDone: (id) => mutationReply(id, gh),
        resolve: (id) => resolveThread(id, gh),
        unresolve: (id) => mutateThread('unresolveReviewThread', id, false, gh),
        deleteReply: (id) => deleteReply(id, gh),
        log: (message) => console.log(message),
    };
}
type Gh = (args: string[]) => string;
function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseJson(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}
export function inspectReviewThread(number: number, requestedThreadId: string, gh: Gh): ReviewThreadInspection {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let head: string | undefined;
    for (;;) {
        const connection = cursor === undefined ? 'reviewThreads(first:100)' : 'reviewThreads(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid ${connection}{nodes{id isResolved resolvedBy{login}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review thread query for PR #${number}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        headRefOid?: unknown;
                        reviewThreads?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                    };
                };
            };
        };
        const pullRequest = response.data?.repository?.pullRequest;
        if (typeof pullRequest?.headRefOid !== 'string') {
            fail(`cannot read current head for PR #${number}`);
        }
        if (head === undefined) {
            head = pullRequest.headRefOid;
        } else if (head !== pullRequest.headRefOid) {
            fail(`pull-request head changed while reading review threads for PR #${number}`);
        }
        const threads = pullRequest.reviewThreads;
        if (!Array.isArray(threads?.nodes) || typeof threads.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review-thread page for PR #${number}`);
        }
        const selected = threads.nodes.find(
            (candidate): candidate is { id?: unknown; isResolved?: unknown; resolvedBy?: { login?: unknown } | null } =>
                typeof candidate === 'object' &&
                candidate !== null &&
                (candidate as { id?: unknown }).id === requestedThreadId
        );
        if (selected !== undefined) {
            return {
                head,
                thread: inspectThreadComments(requestedThreadId, selected.isResolved, selected.resolvedBy?.login, gh),
            };
        }
        if (!threads.pageInfo.hasNextPage) {
            return { head, thread: null };
        }
        const next = threads.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-thread pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function inspectThreadComments(threadId: string, isResolved: unknown, resolvedByLogin: unknown, gh: Gh): ReviewThread {
    if (typeof isResolved !== 'boolean') {
        fail(`invalid review thread ${threadId}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const comments: ReviewComment[] = [];
    for (;;) {
        const connection = cursor === undefined ? 'comments(first:100)' : 'comments(first:100,after:$cursor)';
        const query = `query($threadId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){node(id:$threadId){... on PullRequestReviewThread{id ${connection}{nodes{id fullDatabaseId body author{login}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `threadId=${threadId}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review comments for thread ${threadId}`) as {
            data?: {
                node?: {
                    id?: unknown;
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        const thread = response.data?.node;
        if (
            thread?.id !== threadId ||
            !Array.isArray(thread.comments?.nodes) ||
            typeof thread.comments.pageInfo?.hasNextPage !== 'boolean'
        ) {
            fail(`invalid review comments for thread ${threadId}`);
        }
        for (const value of thread.comments.nodes) {
            const comment = toReviewComment(value);
            if (comments.some((current) => current.id === comment.id)) {
                fail(`duplicate review comment ${comment.id}`);
            }
            comments.push(comment);
        }
        if (!thread.comments.pageInfo.hasNextPage) {
            break;
        }
        const next = thread.comments.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-comment pagination for thread ${threadId}`);
        }
        cursors.add(next);
        cursor = next;
    }
    const root = comments[0];
    return {
        id: threadId,
        isResolved,
        resolvedByLogin: typeof resolvedByLogin === 'string' ? resolvedByLogin : null,
        rootCommentId: root?.id ?? null,
        rootCommentFullDatabaseId: root?.fullDatabaseId ?? null,
        rootAuthorLogin: root?.authorLogin ?? null,
        comments,
    };
}
function toReviewComment(value: unknown): ReviewComment {
    const comment = value as {
        id?: unknown;
        fullDatabaseId?: unknown;
        body?: unknown;
        author?: { login?: unknown } | null;
    };
    if (typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId) || typeof comment.body !== 'string') {
        fail('invalid review comment');
    }
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorLogin: typeof comment.author?.login === 'string' ? comment.author.login : null,
    };
}
function mutationReply(threadId: string, gh: Gh): ReviewReply {
    const query =
        'mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{id fullDatabaseId body author{login}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `threadId=${threadId}`, '-f', 'body=Done'],
        'add review-thread reply'
    ) as {
        data?: {
            addPullRequestReviewThreadReply?: {
                comment?: {
                    id?: unknown;
                    fullDatabaseId?: unknown;
                    body?: unknown;
                    author?: { login?: unknown } | null;
                };
            };
        };
    };
    const comment = response.data?.addPullRequestReviewThreadReply?.comment;
    const authorLogin = typeof comment?.author?.login === 'string' ? comment.author.login : null;
    if (
        comment?.body !== 'Done' ||
        typeof comment.id !== 'string' ||
        !isDecimalId(comment.fullDatabaseId) ||
        !isAuthorBotLogin(authorLogin)
    ) {
        fail(`add review-thread reply returned an invalid result for ${threadId}`);
    }
    return { id: comment.id, fullDatabaseId: comment.fullDatabaseId, authorLogin };
}
function mutateThread(
    name: 'resolveReviewThread' | 'unresolveReviewThread',
    threadId: string,
    resolved: boolean,
    gh: Gh
): { resolvedByLogin: string | null } {
    const query = `mutation($threadId:ID!){${name}(input:{threadId:$threadId}){thread{id isResolved resolvedBy{login}}}}`;
    const response = graphql(gh, query, ['-F', `threadId=${threadId}`], name) as {
        data?: Record<
            string,
            { thread?: { id?: unknown; isResolved?: unknown; resolvedBy?: { login?: unknown } | null } }
        >;
    };
    const thread = response.data?.[name]?.thread;
    if (thread?.id !== threadId || thread.isResolved !== resolved) {
        fail(`${name} returned an invalid result for ${threadId}`);
    }
    return { resolvedByLogin: typeof thread.resolvedBy?.login === 'string' ? thread.resolvedBy.login : null };
}
function resolveThread(threadId: string, gh: Gh): ReviewResolutionReceipt {
    const receipt = mutateThread('resolveReviewThread', threadId, true, gh);
    if (receipt.resolvedByLogin !== AUTHOR_BOT_LOGIN) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
    }
    return { resolvedByLogin: AUTHOR_BOT_LOGIN };
}
export function deleteReply(replyId: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($replyId:ID!,$clientMutationId:String!){deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReviewComment{id}}}',
        ['-F', `replyId=${replyId}`, '-f', `clientMutationId=${replyId}`],
        'delete review reply'
    ) as {
        data?: {
            deletePullRequestReviewComment?: {
                clientMutationId?: unknown;
                pullRequestReviewComment?: { id?: unknown } | null;
            };
        };
    };
    const receipt = response.data?.deletePullRequestReviewComment;
    if (receipt?.clientMutationId !== replyId || receipt.pullRequestReviewComment?.id !== replyId) {
        fail(`delete review reply returned an invalid result for ${replyId}`);
    }
}
async function main(): Promise<number> {
    const parsed = parseResolveReviewThreadArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.threadId === undefined || parsed.head === undefined) {
        fail(usage);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/resolveReviewThread.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/resolveReviewThread.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (auth.minted.login !== AUTHOR_BOT_LOGIN) {
            fail(`minted login ${auth.minted.login} is not ${AUTHOR_BOT_LOGIN}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        resolveReviewThread(parsed.number, parsed.threadId, parsed.head, auth.minted.login, shellPort(auth.session));
        return 0;
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
