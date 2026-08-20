#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_LOGIN,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isReviewerBotLogin,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type ReviewThread = {
    id: string;
    isResolved: boolean;
    rootCommentId: string | null;
    rootCommentFullDatabaseId: string | null;
    rootAuthorLogin: string | null;
    commentIds: string[];
};
export type ReviewThreadInspection = { head: string; thread: ReviewThread | null };
export type ReviewReply = { id: string; fullDatabaseId: string };
export type ResolveReviewThreadPort = {
    inspect: (number: number, threadId: string) => ReviewThreadInspection;
    replyDone: (threadId: string) => ReviewReply;
    resolve: (threadId: string) => void;
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
    const initial = port.inspect(number, threadId);
    assertExpectedHead(initial.head, expectedHead);
    assertResolvableThread(initial.thread, threadId);
    const reply = port.replyDone(threadId);
    assertReply(reply);
    let resolved = false;
    try {
        const afterReply = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(afterReply.head, expectedHead);
        assertResolvableThread(afterReply.thread, threadId);
        port.resolve(threadId);
        resolved = true;
        const verified = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(verified.head, expectedHead);
        if (verified.thread?.id !== threadId || !verified.thread.isResolved) {
            fail(`review thread ${threadId} was not resolved`);
        }
    } catch (error) {
        compensateResolution(number, threadId, reply.id, resolved, port, error);
    }
    const success = `review-thread-resolved:${number}:${threadId}`;
    port.log(success);
    return success;
}

function compensateResolution(
    number: number,
    threadId: string,
    replyId: string,
    resolved: boolean,
    port: ResolveReviewThreadPort,
    original: unknown
): never {
    const failures: string[] = [];
    if (resolved) {
        attempt(failures, 'unresolve review thread', () => port.unresolve(threadId));
    }
    attempt(failures, 'delete review reply', () => port.deleteReply(replyId));
    attempt(failures, 'verify review-thread compensation', () => {
        const inspection = port.inspect(number, threadId);
        if (
            inspection.thread?.id !== threadId ||
            inspection.thread.isResolved ||
            inspection.thread.commentIds.includes(replyId)
        ) {
            fail(`review thread ${threadId} compensation was not verified`);
        }
    });
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
    if (typeof reply.id !== 'string' || reply.id === '' || !isDecimalId(reply.fullDatabaseId)) {
        fail('add review-thread reply returned an invalid result');
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
        inspect: (number, requestedThreadId) => inspectReviewThread(number, requestedThreadId, gh),
        replyDone: (threadId) => mutationReply(threadId, gh),
        resolve: (threadId) => mutateThread('resolveReviewThread', threadId, true, gh),
        unresolve: (threadId) => mutateThread('unresolveReviewThread', threadId, false, gh),
        deleteReply: (replyId) => deleteReply(replyId, gh),
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
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid ${connection}{nodes{id isResolved comments(first:100){nodes{id fullDatabaseId author{login}}} pageInfo{hasNextPage endCursor}}}}}`;
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
            (candidate): candidate is { id?: unknown; isResolved?: unknown; comments?: { nodes?: unknown } } =>
                typeof candidate === 'object' &&
                candidate !== null &&
                (candidate as { id?: unknown }).id === requestedThreadId
        );
        if (selected !== undefined) {
            return { head, thread: toReviewThread(selected, requestedThreadId) };
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
function toReviewThread(
    value: { id?: unknown; isResolved?: unknown; comments?: { nodes?: unknown } },
    expectedId: string
): ReviewThread {
    if (value.id !== expectedId || typeof value.isResolved !== 'boolean' || !Array.isArray(value.comments?.nodes)) {
        fail(`invalid review thread ${expectedId}`);
    }
    const comments = value.comments.nodes as Array<{
        id?: unknown;
        fullDatabaseId?: unknown;
        author?: { login?: unknown } | null;
    }>;
    const root = comments[0];
    return {
        id: value.id,
        isResolved: value.isResolved,
        rootCommentId: typeof root?.id === 'string' ? root.id : null,
        rootCommentFullDatabaseId: isDecimalId(root?.fullDatabaseId) ? root.fullDatabaseId : null,
        rootAuthorLogin: typeof root?.author?.login === 'string' ? root.author.login : null,
        commentIds: comments.flatMap((comment) => (typeof comment.id === 'string' ? [comment.id] : [])),
    };
}
function mutationReply(threadId: string, gh: Gh): ReviewReply {
    const query =
        'mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{id fullDatabaseId body}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `threadId=${threadId}`, '-f', 'body=Done'],
        'add review-thread reply'
    ) as {
        data?: {
            addPullRequestReviewThreadReply?: { comment?: { id?: unknown; fullDatabaseId?: unknown; body?: unknown } };
        };
    };
    const comment = response.data?.addPullRequestReviewThreadReply?.comment;
    if (comment?.body !== 'Done' || typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId)) {
        fail(`add review-thread reply returned an invalid result for ${threadId}`);
    }
    return { id: comment.id, fullDatabaseId: comment.fullDatabaseId };
}
function mutateThread(
    name: 'resolveReviewThread' | 'unresolveReviewThread',
    threadId: string,
    resolved: boolean,
    gh: Gh
): void {
    const query = `mutation($threadId:ID!){${name}(input:{threadId:$threadId}){thread{id isResolved}}}`;
    const response = graphql(gh, query, ['-F', `threadId=${threadId}`], name) as {
        data?: Record<string, { thread?: { id?: unknown; isResolved?: unknown } }>;
    };
    const thread = response.data?.[name]?.thread;
    if (thread?.id !== threadId || thread.isResolved !== resolved) {
        fail(`${name} returned an invalid result for ${threadId}`);
    }
}
function deleteReply(replyId: string, gh: Gh): void {
    const query =
        'mutation($replyId:ID!){deletePullRequestReviewComment(input:{id:$replyId}){pullRequestReviewComment{ id }}}';
    graphql(gh, query, ['-F', `replyId=${replyId}`], 'delete review reply');
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
