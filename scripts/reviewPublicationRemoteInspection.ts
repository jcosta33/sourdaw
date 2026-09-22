import { REQUIRED_REPOSITORY, parseJson } from './githubAppIdentity.ts';
import { composeReviewCommentBody, fail } from './prContract.ts';
import { EXPECTED_REVIEW_STATE, type ReviewDocument } from './publishReview.ts';

export type RemotePublishedReview = {
    id: number;
    state: string;
    body: string;
    commitId: string;
    actorNodeId: string;
    comments: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>;
};

/** A public pull-request review comment as the publication binding needs it. */
export type PublishedReviewComment = {
    id: number;
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
};

export type RecoveryInspection = {
    state: string;
    head: string;
    reviews: RemotePublishedReview[];
    otherActorReviews?: RemotePublishedReview[];
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSafeInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

/** The public comments one review carries, strict-parsed and in GitHub's ascending creation order. */
export function readReviewComments(
    gh: (args: string[]) => string,
    number: number,
    reviewId: number
): PublishedReviewComment[] {
    const pages = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/comments?per_page=100`]),
            'review publication comments'
        ),
        'review publication comments'
    );
    const comments: PublishedReviewComment[] = [];
    for (const entry of pages) {
        if (!isRecord(entry)) {
            fail('review publication comment is unreadable');
        }
        if (entry.pull_request_review_id !== reviewId) {
            continue;
        }
        const id = asSafeInteger(entry.id);
        const line = asSafeInteger(entry.original_line);
        if (
            id === undefined ||
            line === undefined ||
            typeof entry.path !== 'string' ||
            (entry.side !== 'LEFT' && entry.side !== 'RIGHT') ||
            typeof entry.body !== 'string'
        ) {
            fail('review publication comment is unreadable');
        }
        comments.push({ id, path: entry.path, line, side: entry.side, body: entry.body });
    }
    return comments;
}

/** One posted review by id, or undefined when GitHub answers 404. */
export function readRemoteReview(
    gh: (args: string[]) => string,
    number: number,
    reviewId: number
): RemotePublishedReview | undefined {
    let raw: string;
    try {
        raw = gh(['api', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews/${reviewId}`]);
    } catch (error) {
        if (error instanceof Error && /\bHTTP 404\b/u.test(error.message)) {
            return undefined;
        }
        throw error;
    }
    const record = parseJson<{
        id?: unknown;
        state?: unknown;
        body?: unknown;
        commit_id?: unknown;
        user?: { node_id?: unknown };
    }>(raw, 'review publication review read');
    const id = asSafeInteger(record.id);
    if (
        id === undefined ||
        typeof record.state !== 'string' ||
        typeof record.body !== 'string' ||
        typeof record.commit_id !== 'string' ||
        typeof record.user?.node_id !== 'string'
    ) {
        fail('review publication review read is unreadable');
    }
    const comments = readReviewComments(gh, number, reviewId);
    return {
        id,
        state: record.state,
        body: record.body,
        commitId: record.commit_id,
        actorNodeId: record.user.node_id,
        comments: comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: comment.side,
            body: comment.body,
        })),
    };
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
