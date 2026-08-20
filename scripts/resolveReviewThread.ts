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
    rootCommentDatabaseId: number | null;
    rootAuthorLogin: string | null;
};

export type ReviewThreadInspection = {
    head: string;
    thread: ReviewThread | null;
};

export type ResolveReviewThreadPort = {
    inspect: (number: number, threadId: string) => ReviewThreadInspection;
    replyDone: (number: number, rootCommentDatabaseId: number) => void;
    resolve: (threadId: string) => void;
    log: (message: string) => void;
};

export type ResolveReviewThreadArgs = {
    number?: number;
    threadId?: string;
    head?: string;
    help: boolean;
};

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
        fail('usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>');
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail('usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>');
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
    const rootCommentDatabaseId = assertResolvableThread(initial.thread, threadId);

    port.replyDone(number, rootCommentDatabaseId);

    const afterReply = port.inspect(number, threadId);
    if (afterReply.head !== expectedHead) {
        fail('pull-request head moved after reply; refusing to resolve the thread');
    }
    assertResolvableThread(afterReply.thread, threadId);

    port.resolve(threadId);

    const verified = port.inspect(number, threadId);
    assertExpectedHead(verified.head, expectedHead);
    if (verified.thread?.id !== threadId || !verified.thread.isResolved) {
        fail(`review thread ${threadId} was not resolved`);
    }
    const success = `review-thread-resolved:${number}:${threadId}`;
    port.log(success);
    return success;
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): ResolveReviewThreadPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        inspect: (number, requestedThreadId) => inspectReviewThread(number, requestedThreadId, gh),
        replyDone: (number, rootCommentDatabaseId) => {
            gh([
                'api',
                '--method',
                'POST',
                `repos/${REQUIRED_REPOSITORY}/pulls/${number}/comments/${rootCommentDatabaseId}/replies`,
                '-f',
                'body=Done',
            ]);
        },
        resolve: (threadId) => {
            const mutation =
                'mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}';
            const response = parseJson<{
                data?: { resolveReviewThread?: { thread?: { id?: unknown; isResolved?: unknown } } };
            }>(
                gh(['api', 'graphql', '-f', `query=${mutation}`, '-F', `threadId=${threadId}`]),
                'resolve review thread'
            );
            const thread = response.data?.resolveReviewThread?.thread;
            if (thread?.id !== threadId || thread.isResolved !== true) {
                fail(`resolve review thread returned an invalid result for ${threadId}`);
            }
        },
        log: (message) => console.log(message),
    };
}

function assertExpectedHead(currentHead: string, expectedHead: string): void {
    if (currentHead !== expectedHead) {
        fail('supplied head does not match the current pull-request head');
    }
}

function assertResolvableThread(thread: ReviewThread | null, expectedThreadId: string): number {
    if (thread === null || thread.id !== expectedThreadId) {
        fail(`review thread ${expectedThreadId} was not found on this pull request`);
    }
    if (thread.isResolved) {
        fail(`review thread ${expectedThreadId} is already resolved`);
    }
    if (!isReviewerBotLogin(thread.rootAuthorLogin)) {
        fail(`review thread ${expectedThreadId} root comment is not authored by ${REVIEWER_BOT_LOGIN}`);
    }
    const rootCommentDatabaseId = thread.rootCommentDatabaseId;
    if (
        typeof rootCommentDatabaseId !== 'number' ||
        !Number.isSafeInteger(rootCommentDatabaseId) ||
        rootCommentDatabaseId <= 0
    ) {
        fail(`review thread ${expectedThreadId} root comment has no database id`);
    }
    return rootCommentDatabaseId;
}

function inspectReviewThread(
    number: number,
    requestedThreadId: string,
    gh: (args: string[]) => string
): ReviewThreadInspection {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    const query =
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId author{login}}}}}}}}';
    const response = parseJson<{
        data?: {
            repository?: {
                pullRequest?: {
                    headRefOid?: unknown;
                    reviewThreads?: {
                        nodes?: Array<{
                            id?: unknown;
                            isResolved?: unknown;
                            comments?: {
                                nodes?: Array<{
                                    databaseId?: unknown;
                                    author?: { login?: unknown } | null;
                                }>;
                            };
                        }>;
                    };
                };
            };
        };
    }>(
        gh([
            'api',
            'graphql',
            '-f',
            `query=${query}`,
            '-F',
            `owner=${owner}`,
            '-F',
            `name=${name}`,
            '-F',
            `number=${number}`,
        ]),
        `review thread query for PR #${number}`
    );
    const pullRequest = response.data?.repository?.pullRequest;
    if (typeof pullRequest?.headRefOid !== 'string') {
        fail(`cannot read current head for PR #${number}`);
    }
    const selected = pullRequest.reviewThreads?.nodes?.find((thread) => thread.id === requestedThreadId);
    if (selected === undefined || typeof selected.id !== 'string' || typeof selected.isResolved !== 'boolean') {
        return { head: pullRequest.headRefOid, thread: null };
    }
    const root = selected.comments?.nodes?.[0];
    return {
        head: pullRequest.headRefOid,
        thread: {
            id: selected.id,
            isResolved: selected.isResolved,
            rootCommentDatabaseId: typeof root?.databaseId === 'number' ? root.databaseId : null,
            rootAuthorLogin: typeof root?.author?.login === 'string' ? root.author.login : null,
        },
    };
}

async function main(): Promise<number> {
    const parsed = parseResolveReviewThreadArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log('Usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>');
        return 0;
    }
    if (parsed.number === undefined || parsed.threadId === undefined || parsed.head === undefined) {
        fail('usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>');
    }
    const executingFile = fileURLToPath(import.meta.url);
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/resolveReviewThread.ts',
        executingFile,
        originMainBlob('scripts/resolveReviewThread.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (auth.minted.login !== AUTHOR_BOT_LOGIN) {
            fail(`minted login ${auth.minted.login} is not ${AUTHOR_BOT_LOGIN}`);
        }
        const repository = spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
            env: auth.session.env,
            cwd: primaryRoot,
        });
        assertRequiredRepository(repository);
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
