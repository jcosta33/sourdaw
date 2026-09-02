#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isReviewerBotNodeId,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { composeReviewCommentBody, fail, type ReviewCommentContent } from './prContract.ts';
import { reviewBundlePath } from './prepareReview.ts';
import {
    type PullRequestRemoteMutationBoundary,
    type PullRequestReviewPublicationMutationBoundary,
    type PullRequestReviewPublicationMutationSerialization,
    currentReviewPublicationOwnerFence,
    isReviewPublicationPullRequestMutationLockOwner,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    readPullRequestMutationLockReceipt,
    recordReviewPublicationRecoveryReceipt,
    replacePullRequestMutationLockOwner,
    releasePullRequestMutationLockOwner,
    reviewPublicationOwnerFenceIsLive,
    withPullRequestReviewPublicationMutationLock,
} from './pullRequestMutationLock.ts';
import { legacyReviewPublicationIncidents } from './reviewPublicationLegacyIncidents.ts';

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES';

/**
 * GitHub's review-creation request and the review it hands back use two different vocabularies:
 * the request says `APPROVE` / `REQUEST_CHANGES` / `COMMENT`, the response says `APPROVED` /
 * `CHANGES_REQUESTED` / `COMMENTED`. GitHub can also silently coerce the requested event — most
 * observed when the PR closed or merged between bundle prep and posting — and return 200 with a
 * review whose recorded state does not match what was asked for. Map the two vocabularies
 * explicitly rather than by string coincidence, so a coercion is never mistaken for success.
 */
export const EXPECTED_REVIEW_STATE: Record<ReviewEvent, string> = {
    APPROVE: 'APPROVED',
    REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

export type ReviewComment = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    defect: string;
    consequence: string;
    done: string;
};

export type ReviewDocument = {
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
};

export type PublishReviewPort = {
    primaryRoot: () => string;
    pullRequest: (number: number) => { state: string; head: string };
    readReviewJson: (path: string) => unknown;
    readBundleDiff: (path: string) => string;
    postReview: (input: {
        number: number;
        commitId: string;
        event: ReviewEvent;
        body: string;
        comments: ReviewComment[];
    }) => { id: number; actorNodeId: string; login: string };
    log: (message: string) => void;
};

export type PublishReviewAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type PublishReviewCoordinatorDependencies = {
    primaryRoot: () => string;
    serializeMutation: PullRequestReviewPublicationMutationSerialization;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    reviewPort: (
        session: GhSession,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt']
    ) => PublishReviewPort;
    publish: (
        number: number,
        prepared: PreparedReviewPublication,
        port: PublishReviewPort,
        boundary: PullRequestReviewPublicationMutationBoundary
    ) => number;
};

export function parsePublishReviewArgs(args: string[]): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const value = Number(args[0]);
    if (!Number.isSafeInteger(value) || value <= 0 || args.length !== 1) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    return { number: value, help: false };
}

export function parseReviewDocument(value: unknown): ReviewDocument {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('review.json must be an object');
    }
    const record = value as Record<string, unknown>;
    if (record.event !== 'APPROVE' && record.event !== 'REQUEST_CHANGES') {
        fail('review.json event must be APPROVE or REQUEST_CHANGES');
    }
    const rawComments = commentsArray(record.comments);
    if (record.event === 'APPROVE' && rawComments.length > 0) {
        fail('APPROVE must carry no comments; an inline comment opens a thread that blocks the merge');
    }
    const comments = parseCommentEntries(rawComments);
    const body = typeof record.body === 'string' ? record.body : '';
    if (record.event === 'REQUEST_CHANGES') {
        if (comments.length === 0) {
            fail('REQUEST_CHANGES requires comments');
        }
        if (body.trim() === '') {
            fail('REQUEST_CHANGES requires a top-level body');
        }
    }
    if (record.event === 'APPROVE' && body.trim() === '') {
        fail('APPROVE requires a body stating what was attacked and held');
    }
    return { event: record.event, body, comments };
}

export function reviewPublicationPayload(input: {
    commitId: string;
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
}): string {
    return JSON.stringify({
        commit_id: input.commitId,
        event: input.event,
        body: input.body,
        comments: input.comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: comment.side,
            body: composeReviewCommentBody(comment),
        })),
    });
}

export function reviewPublicationPayloadDigest(payload: string): string {
    return createHash('sha256').update(payload).digest('hex');
}

export type PreparedReviewPublication = {
    head: string;
    document: ReviewDocument;
    payloadDigest: string;
};

function prepareReviewPublication(number: number, port: PublishReviewPort): PreparedReviewPublication {
    const head = port.pullRequest(number).head;
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    let parsed: unknown;
    try {
        parsed = port.readReviewJson(join(bundle, 'review.json'));
    } catch {
        fail(`missing review.json at ${join(bundle, 'review.json')}`);
    }
    const document = parseReviewDocument(parsed);
    assertReviewCommentLinesInBundleDiff(document.comments, port.readBundleDiff(join(bundle, 'diff.patch')));
    return {
        head,
        document,
        payloadDigest: reviewPublicationPayloadDigest(
            reviewPublicationPayload({
                commitId: head,
                event: document.event,
                body: document.body,
                comments: document.comments,
            })
        ),
    };
}

export function publishPreparedReview(
    number: number,
    prepared: PreparedReviewPublication,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    const pullRequest = port.pullRequest(number);
    if (pullRequest.state !== 'OPEN') {
        fail(`pull request is ${pullRequest.state}; refusing to post a review`);
    }
    if (pullRequest.head !== prepared.head) {
        fail('pull-request head moved; refusing to post a stale review');
    }
    boundary?.journalReviewPublication({
        expectedHead: prepared.head,
        payloadDigest: prepared.payloadDigest,
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
    });
    const posted = port.postReview({
        number,
        commitId: prepared.head,
        event: prepared.document.event,
        body: prepared.document.body,
        comments: prepared.document.comments,
    });
    if (!isReviewerBotNodeId(posted.actorNodeId)) {
        fail(`review was posted by actor ${posted.actorNodeId} (${posted.login}), not ${REVIEWER_BOT_NODE_ID}`);
    }
    port.log(String(posted.id));
    return posted.id;
}

export function publishReview(
    number: number,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    return publishPreparedReview(number, prepareReviewPublication(number, port), port, boundary);
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture,
    markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'] = () => undefined
): PublishReviewPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[], input?: string) => capture('gh', args, { cwd: primaryRoot, env: session.env, input });
    return {
        primaryRoot: () => primaryRoot,
        pullRequest: (number) => {
            const pullRequest = parseJson<{ state?: unknown; headRefOid?: unknown }>(
                gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'state,headRefOid']),
                'review publication pull request'
            );
            if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
                fail('review publication pull request is unreadable');
            }
            return { state: pullRequest.state, head: pullRequest.headRefOid };
        },
        readReviewJson: (path) => JSON.parse(readFileSync(path, 'utf8')) as unknown,
        readBundleDiff: (path) => readFileSync(path, 'utf8'),
        postReview: ({ number, commitId, event, body, comments }) => {
            const input = reviewPublicationPayload({ commitId, event, body, comments });
            markRemoteMutationAttempt();
            const response = parseJson<{
                id: number;
                state?: string;
                user?: { node_id?: string; login?: string };
            }>(
                gh(
                    ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews`, '--input', '-'],
                    input
                ),
                'create review'
            );
            if (!Number.isSafeInteger(response.id) || response.id <= 0) {
                fail('create review returned an unreadable id');
            }
            const expectedState = EXPECTED_REVIEW_STATE[event];
            if (response.state !== expectedState) {
                fail(
                    `review ${response.id} requested ${event} but GitHub recorded ${response.state ?? 'no state'}; refusing to report success`
                );
            }
            return {
                id: response.id,
                actorNodeId: response.user?.node_id ?? '',
                login: response.user?.login ?? '',
            };
        },
        log: (message) => {
            console.log(message);
        },
    };
}

function commentsArray(value: unknown): unknown[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        fail('review.json comments must be an array');
    }
    return value;
}

function assertReviewCommentLinesInBundleDiff(comments: ReviewComment[], diff: string): void {
    const changed = changedDiffLines(diff);
    for (const [index, comment] of comments.entries()) {
        const lines = changed.get(comment.path);
        const side = comment.side === 'RIGHT' ? lines?.right : lines?.left;
        if (side?.has(comment.line) !== true) {
            fail(
                `review.json comments[${index}] ${comment.side} ${comment.path}:${comment.line} is not a changed line in bundle diff.patch`
            );
        }
    }
}

function changedDiffLines(diff: string): Map<string, { left: Set<number>; right: Set<number> }> {
    const changed = new Map<string, { left: Set<number>; right: Set<number> }>();
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let leftLine: number | undefined;
    let rightLine: number | undefined;
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            oldPath = undefined;
            newPath = undefined;
            leftLine = undefined;
            rightLine = undefined;
            continue;
        }
        if (leftLine === undefined && rightLine === undefined && line.startsWith('--- ')) {
            oldPath = diffPath(line.slice(4), 'a/');
            continue;
        }
        if (leftLine === undefined && rightLine === undefined && line.startsWith('+++ ')) {
            newPath = diffPath(line.slice(4), 'b/');
            leftLine = undefined;
            rightLine = undefined;
            continue;
        }
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk !== null) {
            leftLine = Number(hunk[1]);
            rightLine = Number(hunk[2]);
            continue;
        }
        if (leftLine === undefined || rightLine === undefined || line === '') {
            continue;
        }
        if (line.startsWith('-')) {
            if (oldPath !== undefined) {
                const entry = changed.get(oldPath) ?? { left: new Set<number>(), right: new Set<number>() };
                entry.left.add(leftLine);
                changed.set(oldPath, entry);
            }
            leftLine += 1;
        } else if (line.startsWith('+')) {
            if (newPath !== undefined) {
                const entry = changed.get(newPath) ?? { left: new Set<number>(), right: new Set<number>() };
                entry.right.add(rightLine);
                changed.set(newPath, entry);
            }
            rightLine += 1;
        } else if (line.startsWith(' ')) {
            leftLine += 1;
            rightLine += 1;
        } else {
            continue;
        }
    }
    return changed;
}

function diffPath(value: string, prefix: 'a/' | 'b/'): string | undefined {
    if (value === '/dev/null') {
        return undefined;
    }
    const path = decodeGitDiffPath(value);
    if (path === undefined || !path.startsWith(prefix)) {
        return undefined;
    }
    const repositoryPath = path.slice(prefix.length);
    return isSafeRepositoryPath(repositoryPath) ? repositoryPath : undefined;
}

function decodeGitDiffPath(value: string): string | undefined {
    if (!value.startsWith('"')) {
        const metadata = value.indexOf('\t');
        return metadata === -1 ? value : value.slice(0, metadata);
    }
    const bytes: number[] = [];
    let cursor = 1;
    while (cursor < value.length) {
        const character = value[cursor];
        if (character === '"') {
            const metadata = value.slice(cursor + 1);
            if (metadata !== '' && !metadata.startsWith('\t')) {
                return undefined;
            }
            try {
                return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
            } catch {
                return undefined;
            }
        }
        if (character !== '\\') {
            const codePoint = value.codePointAt(cursor);
            if (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f) {
                return undefined;
            }
            bytes.push(...new TextEncoder().encode(String.fromCodePoint(codePoint)));
            cursor += codePoint > 0xffff ? 2 : 1;
            continue;
        }
        const escaped = value[cursor + 1];
        if (escaped === undefined) {
            return undefined;
        }
        const escapedByte = gitQuotedEscapeByte(escaped);
        if (escapedByte !== undefined) {
            bytes.push(escapedByte);
            cursor += 2;
            continue;
        }
        const octal = /^([0-7]{3})/.exec(value.slice(cursor + 1))?.[1];
        if (octal === undefined) {
            return undefined;
        }
        bytes.push(Number.parseInt(octal, 8));
        cursor += 4;
    }
    return undefined;
}

function gitQuotedEscapeByte(value: string): number | undefined {
    const escaped: Record<string, number> = {
        '"': 0x22,
        '\\': 0x5c,
        a: 0x07,
        b: 0x08,
        f: 0x0c,
        n: 0x0a,
        r: 0x0d,
        t: 0x09,
        v: 0x0b,
    };
    return escaped[value];
}

function isSafeRepositoryPath(path: string): boolean {
    return (
        path !== '' &&
        !path.startsWith('/') &&
        !path.includes('\0') &&
        path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    );
}

/**
 * The one place `defect` / `consequence` / `done` are still `unknown`: everything upstream of this
 * function reads raw JSON, and everything downstream trusts `ReviewCommentContent`. Each `typeof`
 * check below narrows a genuinely unknown value, unlike a check written against an input already
 * typed `string` — that version compiles clean but is unreachable, and an "unnecessary condition"
 * cleanup would delete it as dead code with nothing to object. Composing through
 * `composeReviewCommentBody` here, rather than after returning, keeps the byte-ceiling and format
 * failures for this comment's fields naming this comment's index too.
 */
function parseReviewCommentContent(
    fields: { defect: unknown; consequence: unknown; done: unknown },
    index: number
): ReviewCommentContent {
    const { defect, consequence, done } = fields;
    if (typeof defect !== 'string') {
        fail(`review.json comments[${index}] defect is invalid`);
    }
    if (typeof consequence !== 'string') {
        fail(`review.json comments[${index}] consequence is invalid`);
    }
    if (typeof done !== 'string') {
        fail(`review.json comments[${index}] done is invalid`);
    }
    const content: ReviewCommentContent = { defect, consequence, done };
    composeReviewCommentBody(content, `review.json comments[${index}]`);
    return content;
}

function parseCommentEntries(entries: unknown[]): ReviewComment[] {
    return entries.map((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`review.json comments[${index}] must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if ('body' in record) {
            fail(`review.json comments[${index}] uses body; supply defect, consequence, and done instead`);
        }
        const path = record.path;
        const line = record.line;
        const side = record.side;
        if (typeof path !== 'string' || path === '') {
            fail(`review.json comments[${index}] path is invalid`);
        }
        if (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0) {
            fail(`review.json comments[${index}] line is invalid`);
        }
        if (side !== 'LEFT' && side !== 'RIGHT') {
            fail(`review.json comments[${index}] side must be LEFT or RIGHT`);
        }
        const content = parseReviewCommentContent(
            { defect: record.defect, consequence: record.consequence, done: record.done },
            index
        );
        return { path, line, side, ...content };
    });
}

export function defaultPublishReviewCoordinatorDependencies(): PublishReviewCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        serializeMutation: withPullRequestReviewPublicationMutationLock,
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        reviewPort: (session, primaryRoot, markRemoteMutationAttempt) =>
            shellPort(session, primaryRoot, spawnCapture, markRemoteMutationAttempt),
        publish: publishPreparedReview,
    };
}

export async function coordinatePublishReview(
    number: number,
    dependencies: PublishReviewCoordinatorDependencies = defaultPublishReviewCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    try {
        const auth = await dependencies.authenticateReviewer(primaryRoot);
        try {
            if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
                fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
            }
            assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
            const preflightPort = dependencies.reviewPort(auth.session, primaryRoot, () => undefined);
            const prepared = prepareReviewPublication(number, preflightPort);
            await dependencies.serializeMutation(
                primaryRoot,
                number,
                async (boundary) =>
                    dependencies.publish(
                        number,
                        prepared,
                        dependencies.reviewPort(auth.session, primaryRoot, boundary.markRemoteMutationAttempt),
                        boundary
                    ),
                {
                    reviewPublication: {
                        expectedHead: prepared.head,
                        payloadDigest: prepared.payloadDigest,
                        reviewerActorNodeId: auth.minted.actorNodeId,
                        ownerFence: currentReviewPublicationOwnerFence,
                    },
                }
            );
        } finally {
            auth.session.dispose();
        }
    } catch (error) {
        const recovery = retainedReviewPublicationRecoveryCommand(primaryRoot, number);
        if (recovery === undefined) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}; retained exact review-publication owner: ${recovery}`, { cause: error });
    }
}

function retainedReviewPublicationRecoveryCommand(primaryRoot: string, number: number): string | undefined {
    try {
        const ownerOid = readPullRequestMutationLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
        if (ownerOid === undefined) {
            return undefined;
        }
        const owner = readPullRequestMutationLockOwner(primaryRoot, ownerOid, number);
        if (!isReviewPublicationPullRequestMutationLockOwner(owner)) {
            return undefined;
        }
        return `pnpm review:publish:recover ${number} --owner ${ownerOid}`;
    } catch {
        return undefined;
    }
}

export async function runPublishReviewCli(
    args: string[],
    dependencies?: PublishReviewCoordinatorDependencies
): Promise<number> {
    const parsed = parsePublishReviewArgs(args);
    if (parsed.help) {
        console.log('Usage: pnpm review:publish <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    await coordinatePublishReview(parsed.number, dependencies);
    return 0;
}

export type RecoverPublishReviewArgs = {
    number?: number;
    owner?: string;
    help: boolean;
};

export type RemotePublishedReview = {
    id: number;
    state: string;
    body: string;
    commitId: string;
    actorNodeId: string;
    comments: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>;
};

type RecoveryInspection = {
    state: string;
    head: string;
    reviews: RemotePublishedReview[];
    otherActorReviews?: RemotePublishedReview[];
};

export type RecoverPublishReviewDependencies = {
    primaryRoot: () => string;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    inspect: (
        number: number,
        expectedActorNodeId: string,
        expectedHead: string,
        session: GhSession,
        primaryRoot: string
    ) => RecoveryInspection;
    isOwnerLive?: (
        owner: Extract<import('./pullRequestMutationLock.ts').PullRequestMutationLockOwner, { version: 3 }>
    ) => boolean;
    currentOwnerFence?: () => import('./pullRequestMutationLock.ts').PullRequestMutationLockOwnerFence;
    isLegacyOwnerLive?: (pid: number) => boolean;
    legacyIncident?: (
        number: number,
        ownerOid: string
    ) => (typeof legacyReviewPublicationIncidents)[number] | undefined;
};

const recoverPublishReviewUsage = 'usage: pnpm review:publish:recover <pr-number> --owner <lock-object-id>';

export function parseRecoverPublishReviewArgs(args: string[]): RecoverPublishReviewArgs {
    if (args.length === 1 && args[0] === '--help') {
        return { help: true };
    }
    if (args.length !== 3 || !/^[1-9][0-9]*$/u.test(args[0] ?? '') || args[1] !== '--owner') {
        fail(recoverPublishReviewUsage);
    }
    const number = Number(args[0]);
    const owner = args[2];
    if (!Number.isSafeInteger(number) || owner === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(owner)) {
        fail(recoverPublishReviewUsage);
    }
    return { number, owner: owner.toLowerCase(), help: false };
}

function defaultRecoverPublishReviewDependencies(): RecoverPublishReviewDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        inspect: (number, expectedActorNodeId, expectedHead, session, primaryRoot) => {
            const gh = (args: string[]) => spawnCapture('gh', args, { env: session.env, cwd: primaryRoot });
            return inspectReviewPublicationRemote(number, expectedActorNodeId, expectedHead, gh);
        },
        isOwnerLive: reviewPublicationOwnerFenceIsLive,
    };
}

export function inspectReviewPublicationRemote(
    number: number,
    expectedActorNodeId: string,
    expectedHead: string,
    gh: (args: string[]) => string
): { state: string; head: string; reviews: RemotePublishedReview[] } {
    const pullRequest = parseJson<{ state?: unknown; headRefOid?: unknown }>(
        gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'state,headRefOid']),
        'review-publication recovery pull request'
    );
    if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
        fail('review-publication recovery pull request is unreadable');
    }
    const remote = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews?per_page=100`]),
            'review-publication recovery reviews'
        ),
        'review-publication recovery reviews'
    );
    const remoteComments = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/comments?per_page=100`]),
            'review-publication recovery pull-request comments'
        ),
        'review-publication recovery pull-request comments'
    );
    const reviews: RemotePublishedReview[] = [];
    const otherActorReviews: RemotePublishedReview[] = [];
    for (const entry of remote) {
        if (entry === null || typeof entry !== 'object') {
            fail('review-publication recovery reviews are unreadable');
        }
        const record = entry as Record<string, unknown>;
        const user = record.user;
        if (typeof user !== 'object' || user === null || typeof (user as { node_id?: unknown }).node_id !== 'string') {
            fail('review-publication recovery reviews are unreadable');
        }
        if (record.commit_id !== expectedHead) {
            continue;
        }
        if (
            typeof record.id !== 'number' ||
            !Number.isSafeInteger(record.id) ||
            typeof record.state !== 'string' ||
            typeof record.body !== 'string' ||
            typeof record.commit_id !== 'string'
        ) {
            fail('review-publication recovery review candidate is unreadable');
        }
        const candidate: RemotePublishedReview = {
            id: record.id,
            state: record.state,
            body: record.body,
            commitId: record.commit_id,
            actorNodeId: (user as { node_id: string }).node_id,
            comments: remoteComments
                .filter((comment) => {
                    if (
                        comment === null ||
                        typeof comment !== 'object' ||
                        !Number.isSafeInteger((comment as { pull_request_review_id?: unknown }).pull_request_review_id)
                    ) {
                        fail('review-publication recovery pull-request comment is unreadable');
                    }
                    return (comment as { pull_request_review_id: number }).pull_request_review_id === record.id;
                })
                .map((comment) => {
                    if (
                        comment === null ||
                        typeof comment !== 'object' ||
                        typeof (comment as { path?: unknown }).path !== 'string' ||
                        !Number.isSafeInteger((comment as { original_line?: unknown }).original_line) ||
                        ((comment as { side?: unknown }).side !== 'LEFT' &&
                            (comment as { side?: unknown }).side !== 'RIGHT') ||
                        typeof (comment as { body?: unknown }).body !== 'string'
                    ) {
                        fail('review-publication recovery pull-request comment is unreadable');
                    }
                    return {
                        path: (comment as { path: string }).path,
                        line: (comment as { original_line: number }).original_line,
                        side: (comment as { side: 'LEFT' | 'RIGHT' }).side,
                        body: (comment as { body: string }).body,
                    };
                }),
        };
        if ((user as { node_id: string }).node_id === expectedActorNodeId) {
            reviews.push(candidate);
        } else {
            otherActorReviews.push(candidate);
        }
    }
    return {
        state: pullRequest.state,
        head: pullRequest.headRefOid.toLowerCase(),
        reviews,
        ...(otherActorReviews.length === 0 ? {} : { otherActorReviews }),
    };
}

function flattenedGhPages(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        fail(`${label} are unreadable`);
    }
    if (value.every((page) => Array.isArray(page))) {
        return value.flat();
    }
    if (value.every((entry) => !Array.isArray(entry))) {
        return value;
    }
    return fail(`${label} are unreadable`);
}

export function exactPublishedReview(
    review: RemotePublishedReview,
    document: ReviewDocument,
    head: string,
    actorNodeId: string
): boolean {
    if (
        review.actorNodeId !== actorNodeId ||
        review.commitId !== head ||
        review.state !== EXPECTED_REVIEW_STATE[document.event] ||
        review.body !== document.body ||
        review.comments.length !== document.comments.length
    ) {
        return false;
    }
    return review.comments.every((comment, index) => {
        const expected = document.comments[index];
        return (
            expected !== undefined &&
            comment.path === expected.path &&
            comment.line === expected.line &&
            comment.side === expected.side &&
            comment.body === composeReviewCommentBody(expected)
        );
    });
}

function recoveryReceipt(
    number: number,
    ownerOid: string,
    head: string,
    payloadDigest: string,
    outcome: string
): object {
    return { version: 1, operation: 'review-publication-recovery', number, ownerOid, head, payloadDigest, outcome };
}

function isMatchingRecoveryReceipt(value: unknown, number: number, ownerOid: string): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const receipt = value as Record<string, unknown>;
    return (
        Object.keys(receipt).length === 7 &&
        Object.keys(receipt).every((key) =>
            ['version', 'operation', 'number', 'ownerOid', 'head', 'payloadDigest', 'outcome'].includes(key)
        ) &&
        receipt.version === 1 &&
        receipt.operation === 'review-publication-recovery' &&
        receipt.number === number &&
        receipt.ownerOid === ownerOid &&
        typeof receipt.head === 'string' &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(receipt.head) &&
        typeof receipt.payloadDigest === 'string' &&
        /^[0-9a-f]{64}$/u.test(receipt.payloadDigest) &&
        (receipt.outcome === 'absent' || receipt.outcome === 'landed')
    );
}

function hasExactRecoveryReceipt(value: unknown, receipt: object): boolean {
    return JSON.stringify(value) === JSON.stringify(receipt);
}

function requireLegacyReviewPublicationIncident(
    incident: (typeof legacyReviewPublicationIncidents)[number] | undefined
): (typeof legacyReviewPublicationIncidents)[number] {
    if (incident === undefined) {
        fail('legacy review-publication recovery requires the exact trusted incident receipt');
    }
    return incident;
}

function requireReviewPublicationOwner(
    owner: import('./pullRequestMutationLock.ts').PullRequestMutationLockOwner,
    number: number
): Extract<import('./pullRequestMutationLock.ts').PullRequestMutationLockOwner, { version: 3 }> {
    if (!isReviewPublicationPullRequestMutationLockOwner(owner)) {
        fail(`PR #${number} recovery requires a review-publication lock owner`);
    }
    return owner;
}

export async function runRecoverPublishReviewLockCli(
    args: string[],
    dependencies: RecoverPublishReviewDependencies = defaultRecoverPublishReviewDependencies()
): Promise<number> {
    const parsed = parseRecoverPublishReviewArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${recoverPublishReviewUsage.slice('usage: '.length)}`);
        return 0;
    }
    const number = parsed.number!;
    const ownerOid = parsed.owner!;
    const primaryRoot = dependencies.primaryRoot();
    const currentOid = readPullRequestMutationLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
    if (currentOid === undefined) {
        if (
            isMatchingRecoveryReceipt(
                readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid),
                number,
                ownerOid
            )
        ) {
            console.log(`review-publication-lock-already-recovered:${number}:${ownerOid}`);
            return 0;
        }
        fail(`PR #${number} review-publication lock is absent without an exact recovery receipt`);
    }
    if (currentOid !== ownerOid) {
        fail(`PR #${number} delivery lock ownership changed before recovery`);
    }
    const originalOwner = readPullRequestMutationLockOwner(primaryRoot, currentOid, number);
    const legacy = originalOwner.version === 1;
    const journaledOwner = legacy ? undefined : requireReviewPublicationOwner(originalOwner, number);
    const trustedIncident = legacy
        ? legacyReviewPublicationIncidents.find(
              (candidate) => candidate.number === number && candidate.ownerOid === ownerOid
          )
        : undefined;
    const findLegacyIncident = (incidentNumber: number, incidentOwnerOid: string) =>
        legacyReviewPublicationIncidents.find(
            (candidate) => candidate.number === incidentNumber && candidate.ownerOid === incidentOwnerOid
        );
    const incident = legacy ? (dependencies.legacyIncident ?? findLegacyIncident)(number, ownerOid) : undefined;
    if (
        legacy &&
        (trustedIncident === undefined ||
            incident === undefined ||
            JSON.stringify(incident) !== JSON.stringify(trustedIncident) ||
            originalOwner.pid !== incident.owner.pid ||
            originalOwner.token !== incident.owner.token ||
            incident.definitiveNoMutationHttpStatus !== 422)
    ) {
        fail('legacy review-publication recovery requires the exact trusted incident receipt');
    }
    const recoveryIncident =
        journaledOwner?.recovery !== undefined
            ? legacyReviewPublicationIncidents.find(
                  (candidate) =>
                      candidate.number === number && candidate.ownerOid === journaledOwner.recovery?.legacyOwnerOid
              )
            : undefined;
    if (
        journaledOwner?.recovery !== undefined &&
        (recoveryIncident === undefined ||
            journaledOwner.expectedHead !== recoveryIncident.expectedHead ||
            journaledOwner.reviewerActorNodeId !== recoveryIncident.reviewerActorNodeId ||
            journaledOwner.payloadDigest !==
                reviewPublicationPayloadDigest(
                    reviewPublicationPayload({
                        commitId: recoveryIncident.expectedHead,
                        event: recoveryIncident.preparedPayload.event,
                        body: recoveryIncident.preparedPayload.body,
                        comments: recoveryIncident.preparedPayload.comments,
                    })
                ) ||
            journaledOwner.mutation.phase !== 'prepared' ||
            journaledOwner.mutation.epoch !== 1)
    ) {
        fail('review-publication recovery requires an exact journaled incident binding');
    }
    if (
        journaledOwner !== undefined &&
        (dependencies.isOwnerLive ?? reviewPublicationOwnerFenceIsLive)(journaledOwner)
    ) {
        fail(`PR #${number} review-publication lock is still held by a live process`);
    }
    if (legacy) {
        if (dependencies.isLegacyOwnerLive?.(originalOwner.pid) === true) {
            fail(`PR #${number} legacy review-publication lock is still held by a live process`);
        }
        if (dependencies.isLegacyOwnerLive === undefined) {
            try {
                process.kill(originalOwner.pid, 0);
                fail(`PR #${number} legacy review-publication lock is still held by a live process`);
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                    throw error;
                }
            }
        }
    }
    const legacyIncident = legacy ? requireLegacyReviewPublicationIncident(incident) : undefined;
    const expectedHead = legacyIncident?.expectedHead ?? journaledOwner?.expectedHead;
    const expectedActorNodeId = legacyIncident?.reviewerActorNodeId ?? journaledOwner?.reviewerActorNodeId;
    if (expectedHead === undefined || expectedActorNodeId === undefined) {
        fail(`PR #${number} recovery requires a review-publication lock owner`);
    }
    const auth = await dependencies.authenticateReviewer(primaryRoot);
    try {
        if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
        }
        if (auth.minted.actorNodeId !== expectedActorNodeId) {
            fail('review-publication recovery retained reviewer actor does not match the authenticated reviewer');
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        const bundle = reviewBundlePath(primaryRoot, number, expectedHead);
        const document = parseReviewDocument(JSON.parse(readFileSync(join(bundle, 'review.json'), 'utf8')) as unknown);
        assertReviewCommentLinesInBundleDiff(document.comments, readFileSync(join(bundle, 'diff.patch'), 'utf8'));
        if (
            legacyIncident !== undefined &&
            JSON.stringify(document) !== JSON.stringify(legacyIncident.preparedPayload)
        ) {
            fail('legacy review-publication recovery bundle does not match the trusted incident receipt');
        }
        const payloadDigest = reviewPublicationPayloadDigest(
            reviewPublicationPayload({
                commitId: expectedHead,
                event: document.event,
                body: document.body,
                comments: document.comments,
            })
        );
        const expectedDigest =
            legacyIncident === undefined
                ? requireReviewPublicationOwner(originalOwner, number).payloadDigest
                : reviewPublicationPayloadDigest(
                      reviewPublicationPayload({
                          commitId: expectedHead,
                          event: legacyIncident.preparedPayload.event,
                          body: legacyIncident.preparedPayload.body,
                          comments: legacyIncident.preparedPayload.comments,
                      })
                  );
        if (payloadDigest !== expectedDigest) {
            fail('review-publication recovery payload does not match the retained lock');
        }
        const first = dependencies.inspect(number, expectedActorNodeId, expectedHead, auth.session, primaryRoot);
        if (
            (first.otherActorReviews ?? []).some((review) =>
                exactPublishedReview(review, document, expectedHead, review.actorNodeId)
            )
        ) {
            fail('review-publication recovery found unauthorized landed review evidence');
        }
        if (
            first.reviews.length > 1 ||
            (first.reviews.length === 1 &&
                !exactPublishedReview(first.reviews[0]!, document, expectedHead, expectedActorNodeId))
        ) {
            fail('review-publication recovery found ambiguous or non-exact remote review evidence');
        }
        const adoptedOwner = {
            version: 3 as const,
            pid: process.pid,
            token: randomUUID(),
            operation: 'review-publication' as const,
            number,
            expectedHead,
            payloadDigest: expectedDigest,
            reviewerActorNodeId: expectedActorNodeId,
            ownerFence: dependencies.currentOwnerFence?.() ?? currentReviewPublicationOwnerFence(),
            mutation: {
                phase: legacyIncident === undefined ? journaledOwner!.mutation.phase : ('prepared' as const),
                epoch:
                    legacyIncident === undefined
                        ? requireReviewPublicationOwner(originalOwner, number).mutation.epoch + 1
                        : 1,
            },
            ...(legacyIncident !== undefined
                ? {
                      recovery: {
                          legacyOwnerOid: ownerOid,
                          definitiveNoMutationHttpStatus: 422 as const,
                      },
                  }
                : {}),
        };
        const adoptedOid = replacePullRequestMutationLockOwner(primaryRoot, number, ownerOid, adoptedOwner);
        try {
            const second = dependencies.inspect(number, expectedActorNodeId, expectedHead, auth.session, primaryRoot);
            if (
                (second.otherActorReviews ?? []).some((review) =>
                    exactPublishedReview(review, document, expectedHead, review.actorNodeId)
                )
            ) {
                fail('review-publication recovery found unauthorized landed review evidence');
            }
            if (
                second.state !== first.state ||
                second.head !== first.head ||
                second.reviews.length !== first.reviews.length ||
                (second.reviews.length === 1 &&
                    !exactPublishedReview(second.reviews[0]!, document, expectedHead, expectedActorNodeId))
            ) {
                fail('review-publication recovery remote state changed during reconciliation');
            }
            const outcome = second.reviews.length === 1 ? 'landed' : 'absent';
            const absentReleaseIsAttested =
                journaledOwner?.mutation.phase === 'prepared' || legacyIncident?.definitiveNoMutationHttpStatus === 422;
            if (outcome === 'absent' && !absentReleaseIsAttested) {
                fail('review-publication recovery cannot release an owner that attempted a remote mutation without landed evidence');
            }
            const receipt = recoveryReceipt(number, ownerOid, expectedHead, expectedDigest, outcome);
            recordReviewPublicationRecoveryReceipt(
                primaryRoot,
                number,
                ownerOid,
                receipt
            );
            if (!hasExactRecoveryReceipt(readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid), receipt)) {
                fail('review-publication recovery receipt does not attest the exact owner, head, payload, and outcome');
            }
            releasePullRequestMutationLockOwner(primaryRoot, number, adoptedOid);
            console.log(`review-publication-lock-recovered:${number}:${ownerOid}:${outcome}`);
            return 0;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
                `${message}; PR #${number} review-publication recovery preserved exact lock owner ${adoptedOid}`,
                { cause: error }
            );
        }
    } finally {
        auth.session.dispose();
    }
}
