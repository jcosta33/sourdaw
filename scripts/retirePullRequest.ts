#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
} from './githubAppIdentity.ts';
import { fail, PR_STATE } from './prContract.ts';
import {
    readRetirementRecordFile,
    renderRetirementMarker,
    assertRetirementRecord,
    type RetirementRecord,
} from './retirementRecord.ts';
import { parseReviewRepairReplyForRole, reviewRepairRecordDigest } from './reviewRepair.ts';
import { assertCompletedClosureWithMarkers, closePullRequestWithMarkers } from './supersedePullRequest.ts';
import { shellPort, type SupersedePullRequestPort } from './supersedePullRequestGh.ts';

export type RetirementReviewState = {
    threads: {
        threadId: string;
        rootCommentId: string;
        rootReviewId: string;
        resolved: boolean;
        replies: { id: string; body: string; authorNodeId: string | null }[];
    }[];
    requestedReviews: { reviewId: string; body: string; head: string }[];
};
export type RetirePullRequestPort = SupersedePullRequestPort & {
    inspectRetirementReviewState: (number: number) => RetirementReviewState;
};

const usage = 'usage: pnpm pr:retire <pr-number> --head <40-hex-sha> --record <path-to-json>';
export type RetirePullRequestArgs = { number?: number; head?: string; recordPath?: string; help: boolean };
export function parseRetirePullRequestArgs(args: string[]): RetirePullRequestArgs {
    if (args.length === 1 && args[0] === '--help') {
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--head' ||
        args[3] !== '--record' ||
        !/^[1-9][0-9]*$/u.test(args[0] ?? '') ||
        !/^[0-9a-f]{40}$/u.test(args[2] ?? '') ||
        !args[4]?.trim()
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, head: args[2], recordPath: args[4], help: false };
}

function assertReviewProof(record: RetirementRecord, state: RetirementReviewState): void {
    const roots = new Map(record.findings.map((finding) => [finding.rootCommentId, finding]));
    if (
        state.threads.length !== roots.size ||
        new Set(state.threads.map((thread) => thread.rootCommentId)).size !== state.threads.length
    ) {
        fail('retirement record does not cover the exact live review-root set');
    }
    const liveByRoot = new Map(state.threads.map((thread) => [thread.rootCommentId, thread]));
    for (const [rootId, finding] of roots) {
        const thread = liveByRoot.get(rootId);
        assertConfirmedRoot(record, rootId, finding, thread);
    }
    assertReviewBodies(record, state);
}

function assertConfirmedRoot(
    record: RetirementRecord,
    rootId: string,
    finding: RetirementRecord['findings'][number],
    thread: RetirementReviewState['threads'][number] | undefined
): void {
    if (thread === undefined || thread.threadId !== finding.threadId || !thread.resolved) {
        fail(`retirement root ${rootId} is missing, moved, or unresolved`);
    }
    const [repairReply, confirmationReply] = confirmedReplyPair(thread, finding, rootId);
    const author = parseReviewRepairReplyForRole(repairReply.body, 'author');
    const reviewer = parseReviewRepairReplyForRole(confirmationReply.body, 'reviewer');
    if (
        author?.kind !== 'repair' ||
        reviewer?.kind !== 'confirmation' ||
        author.record.pr !== record.pr ||
        author.record.thread !== thread.threadId ||
        String(author.record.finding.commentId) !== rootId ||
        author.record.head !== record.head ||
        reviewer.confirmation.pr !== record.pr ||
        reviewer.confirmation.thread !== thread.threadId ||
        reviewer.confirmation.confirmationHead !== record.head ||
        reviewer.confirmation.recordDigest !== reviewRepairRecordDigest(author.record)
    ) {
        fail(`retirement root ${rootId} lacks a current-head native repair confirmation`);
    }
}

function confirmedReplyPair(
    thread: RetirementReviewState['threads'][number],
    finding: RetirementRecord['findings'][number],
    rootId: string
): [
    RetirementReviewState['threads'][number]['replies'][number],
    RetirementReviewState['threads'][number]['replies'][number],
] {
    const repairReply = thread.replies.filter((reply) => reply.id === finding.authorRepairCommentId);
    const confirmationReply = thread.replies.filter((reply) => reply.id === finding.reviewerConfirmationCommentId);
    if (
        repairReply.length !== 1 ||
        confirmationReply.length !== 1 ||
        repairReply[0]?.authorNodeId !== AUTHOR_BOT_NODE_ID ||
        confirmationReply[0]?.authorNodeId !== REVIEWER_BOT_NODE_ID
    ) {
        fail(`retirement root ${rootId} lacks an immutable-role repair and confirmation pair`);
    }
    return [repairReply[0], confirmationReply[0]];
}

function assertReviewBodies(record: RetirementRecord, state: RetirementReviewState): void {
    const reviews = new Map(record.reviewBodies.map((item) => [item.reviewId, item.rootCommentIds]));
    if (
        state.requestedReviews.length !== reviews.size ||
        new Set(state.requestedReviews.map((review) => review.reviewId)).size !== state.requestedReviews.length
    ) {
        fail('retirement record does not map every REQUEST_CHANGES review body');
    }
    for (const review of state.requestedReviews) {
        const mapped = reviews.get(review.reviewId);
        if (mapped === undefined || mapped.length === 0 || !/^[0-9a-f]{40}$/u.test(review.head)) {
            fail(`REQUEST_CHANGES review ${review.reviewId} is unmapped or lacks its original head`);
        }
        const actual = state.threads
            .filter((thread) => thread.rootReviewId === review.reviewId)
            .map((thread) => thread.rootCommentId);
        if (
            actual.length === 0 ||
            actual.length !== mapped.length ||
            actual.some((rootId) => !mapped.includes(rootId))
        ) {
            fail(`REQUEST_CHANGES review ${review.reviewId} has body-only or unmapped findings`);
        }
    }
}

export function retirePullRequest(
    number: number,
    head: string,
    record: RetirementRecord,
    authorNodeId: string,
    port: RetirePullRequestPort
): string {
    if (!isAuthorBotNodeId(authorNodeId)) {
        fail(`authenticated author actor ${authorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
    }
    assertRetirementRecord(record);
    if (record.pr !== number || record.head !== head) {
        fail('retirement record does not match PR number and head');
    }
    const before = port.inspect(number);
    if (
        before.number !== number ||
        before.repository !== REQUIRED_REPOSITORY ||
        before.headRepository !== REQUIRED_REPOSITORY ||
        before.head !== head ||
        before.base !== record.base ||
        before.merged
    ) {
        fail(`PR #${number} does not match the retirement record`);
    }
    assertReviewProof(record, port.inspectRetirementReviewState(number));
    const marker = { body: renderRetirementMarker(record), label: 'retirement-v1 marker' };
    if (before.state === PR_STATE.CLOSED) {
        if (!before.closedAt) {
            fail(`PR #${number} has no closure timestamp`);
        }
        assertCompletedClosureWithMarkers(before, number, head, record.base, [marker]);
    } else {
        if (before.state !== PR_STATE.OPEN) {
            fail(`PR #${number} is ${before.state.toLowerCase()}`);
        }
        closePullRequestWithMarkers(number, head, before, [marker], port, {
            beforeClose: () => {
                const current = port.inspect(number);
                if (
                    current.headRepository !== REQUIRED_REPOSITORY ||
                    current.head !== head ||
                    current.base !== record.base
                ) {
                    fail(`PR #${number} source identity moved before retirement close`);
                }
                assertReviewProof(record, port.inspectRetirementReviewState(number));
            },
            afterClose: (verified, ids, receipt) => {
                if (
                    verified.number !== number ||
                    verified.repository !== REQUIRED_REPOSITORY ||
                    verified.headRepository !== REQUIRED_REPOSITORY ||
                    verified.head !== head ||
                    verified.base !== record.base ||
                    verified.state !== PR_STATE.CLOSED ||
                    verified.closedAt !== receipt.closedAt ||
                    verified.comments.filter(
                        (comment) =>
                            comment.body === marker.body &&
                            comment.id === ids[0] &&
                            comment.authorNodeId === AUTHOR_BOT_NODE_ID &&
                            comment.authorType === 'Bot'
                    ).length !== 1
                ) {
                    fail(`PR #${number} retirement close was not verified`);
                }
                assertCompletedClosureWithMarkers(verified, number, head, record.base, [marker]);
                assertReviewProof(record, port.inspectRetirementReviewState(number));
            },
        });
    }
    const message = `pull-request-retired:${number}`;
    port.log(message);
    return message;
}

export async function runRetirePullRequestCli(args: string[] = process.argv.slice(2)): Promise<number> {
    const parsed = parseRetirePullRequestArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${usage.slice(7)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.head === undefined || parsed.recordPath === undefined) {
        fail(usage);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/retirePullRequest.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/retirePullRequest.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail('retirement requires immutable author App identity');
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        retirePullRequest(
            parsed.number,
            parsed.head,
            readRetirementRecordFile(parsed.recordPath),
            auth.minted.actorNodeId,
            retirementShellPort(auth.session)
        );
        return 0;
    } finally {
        auth.session.dispose();
    }
}

function retirementShellPort(session: Parameters<typeof shellPort>[0]): RetirePullRequestPort {
    const primaryRoot = resolvePrimaryRoot();
    return {
        ...shellPort(session, primaryRoot),
        inspectRetirementReviewState: (number) =>
            inspectRetirementReviewState(number, (args) =>
                spawnCapture('gh', args, { cwd: primaryRoot, env: session.env })
            ),
    };
}

type ReviewConnection = { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor?: string } };
type ReadGh = (args: string[]) => string;

function readReviewPage(
    number: number,
    kind: 'reviewThreads' | 'reviews',
    cursor: string | undefined,
    gh: ReadGh
): ReviewConnection {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (!owner || !name) {
        fail('invalid repository');
    }
    const after = cursor ? ',after:$cursor' : '';
    const variables = `$owner:String!,$name:String!,$number:Int!${cursor ? ',$cursor:String!' : ''}`;
    const selection =
        kind === 'reviewThreads'
            ? `reviewThreads(first:100${after}){nodes{id isResolved comments(first:100){nodes{databaseId body author{__typename ... on Bot{id}} pullRequestReview{id}} pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}}`
            : `reviews(first:100${after}){nodes{id state body commit{oid}} pageInfo{hasNextPage endCursor}}`;
    const query = `query(${variables}){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){number ${selection}}}}`;
    const args = [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${number}`,
    ];
    if (cursor) {
        args.push('-f', `cursor=${cursor}`);
    }
    const parsed = JSON.parse(gh(args)) as {
        data?: { repository?: { nameWithOwner?: unknown; pullRequest?: Record<string, unknown> } };
        errors?: unknown[];
    };
    const repository = parsed.data?.repository;
    const pullRequest = repository?.pullRequest;
    const page = pullRequest?.[kind] as ReviewConnection | undefined;
    if (
        parsed.errors?.length ||
        repository?.nameWithOwner !== REQUIRED_REPOSITORY ||
        pullRequest?.number !== number ||
        !Array.isArray(page?.nodes) ||
        typeof page.pageInfo?.hasNextPage !== 'boolean'
    ) {
        fail(`cannot inspect retirement ${kind} for PR #${number}`);
    }
    return page;
}

function readRequestedReview(value: unknown): RetirementReviewState['requestedReviews'][number] | undefined {
    const node = value as Record<string, unknown>;
    if (node.state !== 'CHANGES_REQUESTED') {
        return undefined;
    }
    const commit = node.commit as { oid?: unknown } | undefined;
    if (typeof node.id !== 'string' || typeof node.body !== 'string' || typeof commit?.oid !== 'string') {
        fail('invalid REQUEST_CHANGES review');
    }
    return { reviewId: node.id, body: node.body, head: commit.oid };
}

function readRetirementReply(value: unknown): RetirementReviewState['threads'][number]['replies'][number] {
    const reply = value as Record<string, unknown>;
    const author = reply.author as { __typename?: unknown; id?: unknown } | undefined;
    if (
        typeof reply.databaseId !== 'number' ||
        !Number.isSafeInteger(reply.databaseId) ||
        typeof reply.body !== 'string'
    ) {
        fail('invalid retirement review reply');
    }
    return {
        id: String(reply.databaseId),
        body: reply.body,
        authorNodeId: author?.__typename === 'Bot' && typeof author.id === 'string' ? author.id : null,
    };
}

function readRetirementThread(value: unknown): RetirementReviewState['threads'][number] {
    const node = value as Record<string, unknown>;
    const comments = node.comments as { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } } | undefined;
    if (
        typeof node.id !== 'string' ||
        typeof node.isResolved !== 'boolean' ||
        !Array.isArray(comments?.nodes) ||
        comments.pageInfo?.hasNextPage !== false
    ) {
        fail('retirement review thread cannot be fully read');
    }
    const [rawRoot, ...rawReplies] = comments.nodes;
    const root = rawRoot as Record<string, unknown> | undefined;
    const rootReview = root?.pullRequestReview as { id?: unknown } | undefined;
    if (
        typeof root?.databaseId !== 'number' ||
        !Number.isSafeInteger(root.databaseId) ||
        typeof rootReview?.id !== 'string'
    ) {
        fail('retirement review root lacks a review');
    }
    return {
        threadId: node.id,
        rootCommentId: String(root.databaseId),
        rootReviewId: rootReview.id,
        resolved: node.isResolved,
        replies: rawReplies.map(readRetirementReply),
    };
}

// The read-side projection is kept separate from the existing mutation port. No untrusted record supplies a query.
export function inspectRetirementReviewState(number: number, gh: ReadGh): RetirementReviewState {
    const threads: RetirementReviewState['threads'] = [];
    const requestedReviews: RetirementReviewState['requestedReviews'] = [];
    for (const kind of ['reviewThreads', 'reviews'] as const) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (;;) {
            const page = readReviewPage(number, kind, cursor, gh);
            appendReviewNodes(kind, page.nodes, threads, requestedReviews);
            if (!page.pageInfo.hasNextPage) {
                break;
            }
            const next = page.pageInfo.endCursor;
            if (!next || seen.has(next)) {
                fail(`invalid retirement ${kind} pagination`);
            }
            seen.add(next);
            cursor = next;
        }
    }
    return { threads, requestedReviews };
}

function appendReviewNodes(
    kind: 'reviewThreads' | 'reviews',
    nodes: unknown[],
    threads: RetirementReviewState['threads'],
    requestedReviews: RetirementReviewState['requestedReviews']
): void {
    for (const raw of nodes) {
        if (kind === 'reviewThreads') {
            threads.push(readRetirementThread(raw));
            continue;
        }
        const review = readRequestedReview(raw);
        if (review !== undefined) {
            requestedReviews.push(review);
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void runRetirePullRequestCli().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    );
}
