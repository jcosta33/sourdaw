import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    RESOLUTION_REPLY_BODY,
    USAGE,
    coordinateResolveReviewThread,
    defaultResolveReviewThreadCoordinatorDependencies,
    parseResolveReviewThreadArgs,
    readReviewThread,
    replyClientMutationId,
    replyDone,
    resolveClientMutationId,
    resolveReviewThread,
    resolveThread,
    runResolveReviewThreadCli,
    shellPort,
    type ResolveReviewThreadCoordinatorDependencies,
    type ResolveReviewThreadPort,
    type ThreadReply,
    type ThreadState,
} from '../resolveReviewThread.ts';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const THREAD = 'PRRT_kwDOabc';
const NUMBER = 42;

function doneReply(authorNodeId: string | null = AUTHOR_BOT_NODE_ID): ThreadReply {
    return { id: 'PRRC_done', body: RESOLUTION_REPLY_BODY, authorNodeId };
}

function threadState(overrides: Partial<ThreadState> = {}): ThreadState {
    return {
        threadId: THREAD,
        isResolved: false,
        pullRequestNumber: NUMBER,
        pullRequestState: 'OPEN',
        head: HEAD,
        replies: [{ id: 'PRRC_root', body: 'Defect. Consequence. Done.', authorNodeId: REVIEWER_BOT_NODE_ID }],
        ...overrides,
    };
}

/**
 * The thread as GitHub would answer it across the whole command: the first read returns the initial
 * state, the read after the mutations returns whatever the recorded mutations produced. The fake
 * applies them itself rather than being handed a scripted "after" state, so a test that claims the
 * re-read confirms the mutations is observing the mutations and not a fixture.
 */
function fakePort(initial: ThreadState = threadState()) {
    const calls: string[] = [];
    const logs: string[] = [];
    let current = initial;
    const port: ResolveReviewThreadPort = {
        read: (threadId) => {
            calls.push(`read:${threadId}`);
            return { ...current, replies: [...current.replies] };
        },
        reply: (threadId, clientMutationId) => {
            calls.push(`reply:${threadId}:${clientMutationId}`);
            current = { ...current, replies: [...current.replies, doneReply()] };
        },
        resolve: (threadId, clientMutationId) => {
            calls.push(`resolve:${threadId}:${clientMutationId}`);
            current = { ...current, isResolved: true };
        },
        log: (message) => {
            logs.push(message);
        },
    };
    return { port, calls, logs };
}

describe('parseResolveReviewThreadArgs', () => {
    it('should read the pull request, thread and head', () => {
        expect(parseResolveReviewThreadArgs([String(NUMBER), '--thread', THREAD, '--head', HEAD])).toEqual({
            number: NUMBER,
            threadId: THREAD,
            head: HEAD,
            help: false,
        });
    });

    it('should refuse an abbreviated head', () => {
        expect(() => parseResolveReviewThreadArgs(['42', '--thread', THREAD, '--head', 'a'.repeat(7)])).toThrow(USAGE);
    });

    it('should refuse a missing thread flag', () => {
        expect(() => parseResolveReviewThreadArgs(['42', THREAD, '--head', HEAD])).toThrow(USAGE);
    });

    it('should accept --help alone', () => {
        expect(parseResolveReviewThreadArgs(['--help'])).toEqual({ help: true });
        expect(() => parseResolveReviewThreadArgs(['--help', '42'])).toThrow('--help takes no other arguments');
    });
});

describe('clientMutationId', () => {
    it('should derive both ids from the pull request, thread and head', () => {
        expect(replyClientMutationId(NUMBER, THREAD, HEAD)).toBe(`review-resolve-reply:${NUMBER}:${THREAD}:${HEAD}`);
        expect(resolveClientMutationId(NUMBER, THREAD, HEAD)).toBe(`review-resolve:${NUMBER}:${THREAD}:${HEAD}`);
    });

    it('should change when the head changes, so a rerun on a new head is a new request', () => {
        expect(replyClientMutationId(NUMBER, THREAD, HEAD)).not.toBe(replyClientMutationId(NUMBER, THREAD, OTHER_HEAD));
    });
});

describe('resolveReviewThread', () => {
    it('should post one reply, resolve, and confirm both by reading the thread back', () => {
        const { port, calls, logs } = fakePort();
        expect(resolveReviewThread(NUMBER, THREAD, HEAD, port)).toBe(`review-thread-resolved:${NUMBER}:${THREAD}`);
        expect(calls).toEqual([
            `read:${THREAD}`,
            `reply:${THREAD}:${replyClientMutationId(NUMBER, THREAD, HEAD)}`,
            `resolve:${THREAD}:${resolveClientMutationId(NUMBER, THREAD, HEAD)}`,
            `read:${THREAD}`,
        ]);
        expect(logs).toEqual([`review-thread-resolved:${NUMBER}:${THREAD}`]);
    });

    it('should print the line the delivery tooling parses', () => {
        const { port, logs } = fakePort(threadState({ threadId: 'PRRT_seven', pullRequestNumber: 7 }));
        resolveReviewThread(7, 'PRRT_seven', HEAD, port);
        expect(logs).toEqual(['review-thread-resolved:7:PRRT_seven']);
    });

    it('should post a fresh Done on an unresolved thread that already carries an author Done', () => {
        const { port, calls } = fakePort(threadState({ replies: [threadState().replies[0]!, doneReply()] }));
        expect(resolveReviewThread(NUMBER, THREAD, HEAD, port)).toBe(`review-thread-resolved:${NUMBER}:${THREAD}`);
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([
            `reply:${THREAD}:${replyClientMutationId(NUMBER, THREAD, HEAD)}`,
        ]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([
            `resolve:${THREAD}:${resolveClientMutationId(NUMBER, THREAD, HEAD)}`,
        ]);
    });

    it('should be a no-op success when the thread is already resolved and carries the author Done', () => {
        const { port, calls, logs } = fakePort(
            threadState({ isResolved: true, replies: [threadState().replies[0]!, doneReply()] })
        );
        expect(resolveReviewThread(NUMBER, THREAD, HEAD, port)).toBe(`review-thread-resolved:${NUMBER}:${THREAD}`);
        expect(calls).toEqual([`read:${THREAD}`]);
        expect(logs).toEqual([`review-thread-resolved:${NUMBER}:${THREAD}`]);
    });

    it('should refuse a resolved thread that carries no Done from the author actor', () => {
        const { port, calls } = fakePort(threadState({ isResolved: true }));
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port)).toThrow(
            `thread ${THREAD} is already resolved without a Done reply from ${AUTHOR_BOT_NODE_ID}`
        );
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should not read a foreign actor Done as the author Done', () => {
        const { port, calls } = fakePort(
            threadState({ isResolved: true, replies: [doneReply(REVIEWER_BOT_NODE_ID), doneReply(null)] })
        );
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port)).toThrow('is already resolved without a Done');
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should not read a near-miss author body as the Done reply', () => {
        for (const body of ['done', 'Done.', 'Done ', ' Done']) {
            const nearMiss: ThreadReply = { id: 'PRRC_near', body, authorNodeId: AUTHOR_BOT_NODE_ID };
            const { port } = fakePort(threadState({ isResolved: true, replies: [nearMiss] }));
            expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port), body).toThrow(
                'is already resolved without a Done'
            );
        }
    });

    it('should refuse a head mismatch before mutating anything', () => {
        const { port, calls } = fakePort(threadState({ head: OTHER_HEAD }));
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port)).toThrow(
            `PR #${NUMBER} head is ${OTHER_HEAD}, not ${HEAD}`
        );
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should refuse a thread that hangs off another pull request', () => {
        const { port, calls } = fakePort(threadState({ pullRequestNumber: 99 }));
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port)).toThrow(
            `thread ${THREAD} belongs to PR #99, not PR #${NUMBER}`
        );
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should refuse a closed pull request', () => {
        const { port, calls } = fakePort(threadState({ pullRequestState: 'MERGED' }));
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port)).toThrow(`PR #${NUMBER} is MERGED`);
        expect(calls).toEqual([`read:${THREAD}`]);
    });

    it('should refuse a thread GitHub answered with another thread id', () => {
        const { port } = fakePort(threadState({ threadId: 'PRRT_other' }));
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, port)).toThrow(
            `GitHub returned thread PRRT_other for requested thread ${THREAD}`
        );
    });

    it('should fail without logging success when the confirming read shows the thread still unresolved', () => {
        const { port, logs } = fakePort();
        const silentResolve: ResolveReviewThreadPort = { ...port, resolve: () => undefined };
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, silentResolve)).toThrow(
            `thread ${THREAD} is still unresolved after resolveReviewThread`
        );
        expect(logs).toEqual([]);
    });

    it('should fail without logging success when the confirming read shows no author Done', () => {
        const { port, logs } = fakePort();
        const silentReply: ResolveReviewThreadPort = { ...port, reply: () => undefined };
        expect(() => resolveReviewThread(NUMBER, THREAD, HEAD, silentReply)).toThrow(
            `thread ${THREAD} carries no Done reply from ${AUTHOR_BOT_NODE_ID} after replying`
        );
        expect(logs).toEqual([]);
    });
});

type GraphqlCall = { query: string; fields: Record<string, string>; args: string[] };

function recordingGh(respond: (call: GraphqlCall) => unknown) {
    const calls: GraphqlCall[] = [];
    const gh = (args: string[]) => {
        const fields: Record<string, string> = {};
        for (let index = 4; index < args.length; index += 2) {
            const [key, ...rest] = (args[index + 1] ?? '').split('=');
            fields[key ?? ''] = rest.join('=');
        }
        const call = { query: (args[3] ?? '').slice('query='.length), fields, args };
        calls.push(call);
        return JSON.stringify(respond(call));
    };
    return { gh, calls };
}

function threadNode(overrides: Record<string, unknown> = {}) {
    return {
        data: {
            node: {
                id: THREAD,
                isResolved: false,
                pullRequest: { number: NUMBER, state: 'OPEN', headRefOid: HEAD },
                comments: {
                    nodes: [
                        { id: 'PRRC_root', body: 'Defect.', author: { __typename: 'Bot', login: 'r', id: 'BOT_r' } },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
                ...overrides,
            },
        },
    };
}

describe('readReviewThread', () => {
    it('should read the thread, its pull request and its comment authors in one query', () => {
        const { gh, calls } = recordingGh(() => threadNode());
        expect(readReviewThread(THREAD, gh)).toEqual({
            threadId: THREAD,
            isResolved: false,
            pullRequestNumber: NUMBER,
            pullRequestState: 'OPEN',
            head: HEAD,
            replies: [{ id: 'PRRC_root', body: 'Defect.', authorNodeId: 'BOT_r' }],
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.query).toContain('PullRequestReviewThread');
        expect(calls[0]?.fields.threadId).toBe(THREAD);
    });

    it('should pass every string field as an untyped -f value', () => {
        const { gh, calls } = recordingGh((call) =>
            call.fields.cursor === undefined
                ? threadNode({
                      comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'CURSOR' } },
                  })
                : threadNode()
        );
        readReviewThread(THREAD, gh);
        expect(calls).toHaveLength(2);
        expect(calls.flatMap((call) => call.args)).not.toContain('-F');
        expect(calls[1]?.args).toContain('-f');
        expect(calls[1]?.args).toContain('cursor=CURSOR');
    });

    it('should carry a non-Bot author through as no node id', () => {
        const { gh } = recordingGh(() =>
            threadNode({
                comments: {
                    nodes: [{ id: 'PRRC_root', body: 'Done', author: { __typename: 'User' } }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            })
        );
        expect(readReviewThread(THREAD, gh).replies).toEqual([{ id: 'PRRC_root', body: 'Done', authorNodeId: null }]);
    });

    it('should follow comment pagination so a late Done is still seen', () => {
        const { gh, calls } = recordingGh((call) =>
            call.fields.cursor === undefined
                ? threadNode({
                      comments: {
                          nodes: [{ id: 'PRRC_root', body: 'Defect.', author: null }],
                          pageInfo: { hasNextPage: true, endCursor: 'CURSOR' },
                      },
                  })
                : threadNode({
                      comments: {
                          nodes: [
                              { id: 'PRRC_done', body: 'Done', author: { __typename: 'Bot', id: AUTHOR_BOT_NODE_ID } },
                          ],
                          pageInfo: { hasNextPage: false, endCursor: null },
                      },
                  })
        );
        expect(readReviewThread(THREAD, gh).replies.map((reply) => reply.id)).toEqual(['PRRC_root', 'PRRC_done']);
        expect(calls[1]?.fields.cursor).toBe('CURSOR');
    });

    it('should refuse a repeated pagination cursor', () => {
        const { gh } = recordingGh(() =>
            threadNode({
                comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'CURSOR' } },
            })
        );
        expect(() => readReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} returned invalid comment pagination`
        );
    });

    it('should refuse a node that is not a review thread', () => {
        const { gh } = recordingGh(() => ({ data: { node: null } }));
        expect(() => readReviewThread(THREAD, gh)).toThrow(
            `review thread ${THREAD} is not a readable pull-request review thread`
        );
    });
});

describe('replyDone', () => {
    it('should reply through addPullRequestReviewThreadReply with the fixed body', () => {
        const { gh, calls } = recordingGh((call) => ({
            data: {
                addPullRequestReviewThreadReply: {
                    clientMutationId: call.fields.clientMutationId,
                    comment: { id: 'PRRC_done', body: RESOLUTION_REPLY_BODY },
                },
            },
        }));
        replyDone(THREAD, 'mutation-id', gh);
        expect(calls[0]?.query).toContain('addPullRequestReviewThreadReply');
        expect(calls[0]?.query).toContain('pullRequestReviewThreadId:$threadId');
        expect(calls[0]?.query).not.toContain('inReplyTo');
        expect(calls[0]?.args).not.toContain('-F');
        expect(calls[0]?.fields).toMatchObject({ threadId: THREAD, body: 'Done', clientMutationId: 'mutation-id' });
    });

    it('should refuse a receipt for another clientMutationId', () => {
        const { gh } = recordingGh(() => ({
            data: {
                addPullRequestReviewThreadReply: {
                    clientMutationId: 'someone-else',
                    comment: { id: 'PRRC_done', body: RESOLUTION_REPLY_BODY },
                },
            },
        }));
        expect(() => replyDone(THREAD, 'mutation-id', gh)).toThrow(
            `addPullRequestReviewThreadReply returned an invalid result for ${THREAD}`
        );
    });

    it('should refuse a receipt whose comment body is not Done', () => {
        const { gh } = recordingGh((call) => ({
            data: {
                addPullRequestReviewThreadReply: {
                    clientMutationId: call.fields.clientMutationId,
                    comment: { id: 'PRRC_done', body: 'Done!' },
                },
            },
        }));
        expect(() => replyDone(THREAD, 'mutation-id', gh)).toThrow('returned an invalid result');
    });
});

describe('resolveThread', () => {
    it('should resolve the thread and check the receipt', () => {
        const { gh, calls } = recordingGh((call) => ({
            data: {
                resolveReviewThread: {
                    clientMutationId: call.fields.clientMutationId,
                    thread: { id: THREAD, isResolved: true },
                },
            },
        }));
        resolveThread(THREAD, 'mutation-id', gh);
        expect(calls[0]?.query).toContain('resolveReviewThread');
        expect(calls[0]?.args).not.toContain('-F');
        expect(calls[0]?.fields).toMatchObject({ threadId: THREAD, clientMutationId: 'mutation-id' });
    });

    it('should refuse a receipt naming another thread', () => {
        const { gh } = recordingGh((call) => ({
            data: {
                resolveReviewThread: {
                    clientMutationId: call.fields.clientMutationId,
                    thread: { id: 'PRRT_other', isResolved: true },
                },
            },
        }));
        expect(() => resolveThread(THREAD, 'mutation-id', gh)).toThrow(
            `resolveReviewThread returned an invalid result for ${THREAD}`
        );
    });

    it('should refuse a receipt for another clientMutationId even when it names this thread', () => {
        const { gh } = recordingGh(() => ({
            data: {
                resolveReviewThread: {
                    clientMutationId: 'someone-else',
                    thread: { id: THREAD, isResolved: true },
                },
            },
        }));
        expect(() => resolveThread(THREAD, 'mutation-id', gh)).toThrow(
            `resolveReviewThread returned an invalid result for ${THREAD}`
        );
    });
});

describe('shellPort', () => {
    it('should run gh from the primary root with the session environment', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-thread-')));
        mkdirSync(join(root, '.git'));
        const commands: { command: string; cwd?: string; env?: NodeJS.ProcessEnv }[] = [];
        const session: GhSession = { configDir: '/config', env: { GH_TOKEN: 'token' }, dispose: () => undefined };
        try {
            const port = shellPort(session, root, (command, _args, options) => {
                commands.push({ command, cwd: options?.cwd, env: options?.env });
                if (command === 'git') {
                    return `${join(root, '.git')}\n`;
                }
                return JSON.stringify(threadNode());
            });
            expect(port.read(THREAD).head).toBe(HEAD);
            const ghCall = commands.find((entry) => entry.command === 'gh');
            expect(ghCall?.env).toEqual({ GH_TOKEN: 'token' });
            expect(ghCall?.cwd).toBe(root);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

function fakeDependencies(
    overrides: Partial<ResolveReviewThreadCoordinatorDependencies> = {},
    actorNodeId: string = AUTHOR_BOT_NODE_ID
) {
    const events: string[] = [];
    const dependencies: ResolveReviewThreadCoordinatorDependencies = {
        primaryRoot: () => '/repo',
        authenticateAuthor: async (primaryRoot) => {
            events.push(`auth:${primaryRoot}`);
            return {
                minted: { actorNodeId },
                session: {
                    configDir: '/config',
                    env: {},
                    dispose: () => {
                        events.push('dispose');
                    },
                },
            };
        },
        repositoryName: () => 'jcosta33/sourdaw',
        threadPort: () => fakePort().port,
        resolve: (number, threadId, head) => {
            events.push(`resolve:${number}:${threadId}:${head}`);
            return `review-thread-resolved:${number}:${threadId}`;
        },
        ...overrides,
    };
    return { dependencies, events };
}

describe('coordinateResolveReviewThread', () => {
    it('should authenticate the author App and resolve the thread', async () => {
        const { dependencies, events } = fakeDependencies();
        await coordinateResolveReviewThread(NUMBER, THREAD, HEAD, dependencies);
        expect(events).toEqual(['auth:/repo', `resolve:${NUMBER}:${THREAD}:${HEAD}`, 'dispose']);
    });

    it('should refuse an actor that is not the author bot, and still dispose the session', async () => {
        const { dependencies, events } = fakeDependencies({}, REVIEWER_BOT_NODE_ID);
        await expect(coordinateResolveReviewThread(NUMBER, THREAD, HEAD, dependencies)).rejects.toThrow(
            `minted actor ${REVIEWER_BOT_NODE_ID} is not ${AUTHOR_BOT_NODE_ID}`
        );
        expect(events).toEqual(['auth:/repo', 'dispose']);
    });

    it('should refuse a foreign repository', async () => {
        const { dependencies } = fakeDependencies({ repositoryName: () => 'someone/else' });
        await expect(coordinateResolveReviewThread(NUMBER, THREAD, HEAD, dependencies)).rejects.toThrow(
            'refusing to operate on someone/else'
        );
    });
});

describe('runResolveReviewThreadCli', () => {
    it('should resolve the thread named by the arguments', async () => {
        const { dependencies, events } = fakeDependencies();
        await expect(
            runResolveReviewThreadCli([String(NUMBER), '--thread', THREAD, '--head', HEAD], dependencies)
        ).resolves.toBe(0);
        expect(events).toContain(`resolve:${NUMBER}:${THREAD}:${HEAD}`);
    });

    it('should print usage for --help without authenticating', async () => {
        const { dependencies, events } = fakeDependencies();
        await expect(runResolveReviewThreadCli(['--help'], dependencies)).resolves.toBe(0);
        expect(events).toEqual([]);
    });
});

describe('defaultResolveReviewThreadCoordinatorDependencies', () => {
    it('should bind the author role and the module resolve function', () => {
        const dependencies = defaultResolveReviewThreadCoordinatorDependencies();
        expect(dependencies.resolve).toBe(resolveReviewThread);
    });
});
