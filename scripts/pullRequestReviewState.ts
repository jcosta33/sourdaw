import { isDeepStrictEqual } from 'node:util';

import { REVIEWER_BOT_NODE_ID, ORCHESTRATOR_USER_NODE_ID, parseJson } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type ReviewState = {
    latestReviewerStateOnHead: string | null;
    orchestratorAcceptedAfterReviewer: boolean;
    unresolvedThreads: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type PullRequestReviewRecord = {
    id: string;
    state: string;
    submittedAt: string | null;
    author: { id: string | null; login: string; __typename: string } | null;
    commitOid: string | null;
};

type ReviewThreadRecord = {
    id: string;
    isResolved: boolean;
};

type ReviewStatePage = {
    pullRequestId: string;
    headRefOid: string;
    reviews: {
        nodes: PullRequestReviewRecord[];
        pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
    };
    reviewThreads: {
        nodes: ReviewThreadRecord[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
};

type CompleteReviewState = {
    pullRequestId: string;
    headRefOid: string;
    reviews: PullRequestReviewRecord[];
    reviewThreads: ReviewThreadRecord[];
};

const REVIEW_STATE_PAGE_SIZE = 100;
const REVIEW_STATE_PAGE_LIMIT = 1_000;
const REVIEW_STATE_QUERY = `query($owner:String!,$name:String!,$number:Int!,$reviewsBefore:String,$threadsAfter:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid reviews(last:${REVIEW_STATE_PAGE_SIZE},before:$reviewsBefore){nodes{id state submittedAt author{login __typename ... on Bot{id} ... on User{id}} commit{oid}} pageInfo{hasPreviousPage startCursor}} reviewThreads(first:${REVIEW_STATE_PAGE_SIZE},after:$threadsAfter){nodes{id isResolved} pageInfo{hasNextPage endCursor}}}}}`;

function invalidReviewState(number: number): never {
    fail(`cannot prove complete review state for PR #${number}`);
}

function requiredReviewStateString(value: unknown, number: number): string {
    if (typeof value !== 'string' || value.trim() === '') {
        invalidReviewState(number);
    }
    return value;
}

function parseReviewAuthor(value: unknown, number: number): PullRequestReviewRecord['author'] {
    if (value === null) {
        return null;
    }
    if (!isRecord(value)) {
        invalidReviewState(number);
    }
    if (value.id !== undefined && (typeof value.id !== 'string' || value.id.trim() === '')) {
        invalidReviewState(number);
    }
    return {
        id: typeof value.id === 'string' ? value.id : null,
        login: requiredReviewStateString(value.login, number),
        __typename: requiredReviewStateString(value.__typename, number),
    };
}

function parseReviewRecord(value: unknown, number: number): PullRequestReviewRecord {
    if (!isRecord(value)) {
        invalidReviewState(number);
    }
    if (value.submittedAt !== null && typeof value.submittedAt !== 'string') {
        invalidReviewState(number);
    }
    let commitOid: string | null = null;
    if (value.commit !== null) {
        if (!isRecord(value.commit)) {
            invalidReviewState(number);
        }
        commitOid = requiredReviewStateString(value.commit.oid, number);
    }
    return {
        id: requiredReviewStateString(value.id, number),
        state: requiredReviewStateString(value.state, number),
        submittedAt: value.submittedAt,
        author: parseReviewAuthor(value.author, number),
        commitOid,
    };
}

function parseReviewThreadRecord(value: unknown, number: number): ReviewThreadRecord {
    if (!isRecord(value) || typeof value.isResolved !== 'boolean') {
        invalidReviewState(number);
    }
    return {
        id: requiredReviewStateString(value.id, number),
        isResolved: value.isResolved,
    };
}

function parseReviewStatePage(response: string, number: number): ReviewStatePage {
    const envelope = parseJson<unknown>(response, 'review query');
    if (
        !isRecord(envelope) ||
        (Object.hasOwn(envelope, 'errors') && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) ||
        !isRecord(envelope.data) ||
        !isRecord(envelope.data.repository)
    ) {
        invalidReviewState(number);
    }
    const pullRequest = envelope.data.repository.pullRequest;
    if (
        !isRecord(pullRequest) ||
        !isRecord(pullRequest.reviews) ||
        !Array.isArray(pullRequest.reviews.nodes) ||
        !isRecord(pullRequest.reviews.pageInfo) ||
        typeof pullRequest.reviews.pageInfo.hasPreviousPage !== 'boolean' ||
        (pullRequest.reviews.pageInfo.startCursor !== null &&
            typeof pullRequest.reviews.pageInfo.startCursor !== 'string') ||
        !isRecord(pullRequest.reviewThreads) ||
        !Array.isArray(pullRequest.reviewThreads.nodes) ||
        !isRecord(pullRequest.reviewThreads.pageInfo) ||
        typeof pullRequest.reviewThreads.pageInfo.hasNextPage !== 'boolean' ||
        (pullRequest.reviewThreads.pageInfo.endCursor !== null &&
            typeof pullRequest.reviewThreads.pageInfo.endCursor !== 'string')
    ) {
        invalidReviewState(number);
    }
    return {
        pullRequestId: requiredReviewStateString(pullRequest.id, number),
        headRefOid: requiredReviewStateString(pullRequest.headRefOid, number),
        reviews: {
            nodes: pullRequest.reviews.nodes.map((node) => parseReviewRecord(node, number)),
            pageInfo: {
                hasPreviousPage: pullRequest.reviews.pageInfo.hasPreviousPage,
                startCursor: pullRequest.reviews.pageInfo.startCursor,
            },
        },
        reviewThreads: {
            nodes: pullRequest.reviewThreads.nodes.map((node) => parseReviewThreadRecord(node, number)),
            pageInfo: {
                hasNextPage: pullRequest.reviewThreads.pageInfo.hasNextPage,
                endCursor: pullRequest.reviewThreads.pageInfo.endCursor,
            },
        },
    };
}

function nextReviewStateCursor(number: number, cursor: string | null, seen: Set<string>): string {
    if (cursor === null || cursor.trim() === '' || seen.has(cursor)) {
        fail(`cannot prove complete review state for PR #${number}`);
    }
    seen.add(cursor);
    return cursor;
}

function assertReviewStatePageBudget(number: number, pagesRead: number): void {
    if (pagesRead >= REVIEW_STATE_PAGE_LIMIT) {
        fail(`cannot prove complete review state for PR #${number}`);
    }
}

function assertReviewStatePageIdentity(
    number: number,
    page: ReviewStatePage,
    pullRequestId: string,
    expectedHead: string
): void {
    if (page.pullRequestId !== pullRequestId || page.headRefOid !== expectedHead) {
        invalidReviewState(number);
    }
}

function readCompleteReviewState(
    number: number,
    expectedHead: string,
    expectedPullRequestId: string | undefined,
    readPage: (reviewsBefore: string | null, threadsAfter: string | null) => ReviewStatePage
): CompleteReviewState {
    const initialPage = readPage(null, null);
    const pullRequestId = expectedPullRequestId ?? initialPage.pullRequestId;
    assertReviewStatePageIdentity(number, initialPage, pullRequestId, expectedHead);
    const reviewPages = [initialPage.reviews.nodes];
    const reviewCursors = new Set<string>();
    let reviewPage = initialPage.reviews;
    let reviewPagesRead = 1;
    while (reviewPage.pageInfo.hasPreviousPage) {
        assertReviewStatePageBudget(number, reviewPagesRead);
        const cursor = nextReviewStateCursor(number, reviewPage.pageInfo.startCursor, reviewCursors);
        const nextPage = readPage(cursor, null);
        assertReviewStatePageIdentity(number, nextPage, pullRequestId, expectedHead);
        reviewPage = nextPage.reviews;
        reviewPages.push(reviewPage.nodes);
        reviewPagesRead += 1;
    }

    const reviewThreads = [...initialPage.reviewThreads.nodes];
    const threadCursors = new Set<string>();
    let threadPage = initialPage.reviewThreads;
    let threadPagesRead = 1;
    while (threadPage.pageInfo.hasNextPage) {
        assertReviewStatePageBudget(number, threadPagesRead);
        const cursor = nextReviewStateCursor(number, threadPage.pageInfo.endCursor, threadCursors);
        const nextPage = readPage(null, cursor);
        assertReviewStatePageIdentity(number, nextPage, pullRequestId, expectedHead);
        threadPage = nextPage.reviewThreads;
        reviewThreads.push(...threadPage.nodes);
        threadPagesRead += 1;
    }

    return {
        pullRequestId,
        headRefOid: expectedHead,
        reviews: reviewPages.reverse().flat(),
        reviewThreads,
    };
}

export function readPullRequestReviewState(
    number: number,
    expectedHead: string,
    repository: string,
    gh: (args: string[]) => string
): ReviewState {
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
        fail(`invalid GitHub repository: ${repository}`);
    }
    const readPage = (reviewsBefore: string | null, threadsAfter: string | null) =>
        parseReviewStatePage(
            gh([
                'api',
                'graphql',
                '-f',
                `query=${REVIEW_STATE_QUERY}`,
                '-f',
                `owner=${owner}`,
                '-f',
                `name=${name}`,
                '-F',
                `number=${number}`,
                ...(reviewsBefore === null ? [] : ['-f', `reviewsBefore=${reviewsBefore}`]),
                ...(threadsAfter === null ? [] : ['-f', `threadsAfter=${threadsAfter}`]),
            ]),
            number
        );
    const first = readCompleteReviewState(number, expectedHead, undefined, readPage);
    const second = readCompleteReviewState(number, expectedHead, first.pullRequestId, readPage);
    if (!isDeepStrictEqual(first, second)) {
        fail(`cannot prove stable review state for PR #${number}`);
    }
    // Connection order is authoritative even when GitHub gives two reviews the same timestamp.
    const reviewerIndex = second.reviews.findLastIndex(
        (review) =>
            review.state !== 'PENDING' &&
            review.author?.__typename === 'Bot' &&
            review.author.id === REVIEWER_BOT_NODE_ID
    );
    const acceptanceIndex = second.reviews.findLastIndex(
        (review) =>
            review.state !== 'PENDING' &&
            review.author?.__typename === 'User' &&
            review.author.id === ORCHESTRATOR_USER_NODE_ID
    );
    const reviewer = second.reviews[reviewerIndex];
    const acceptance = second.reviews[acceptanceIndex];
    return {
        latestReviewerStateOnHead: reviewer?.commitOid === expectedHead ? reviewer.state : null,
        orchestratorAcceptedAfterReviewer:
            reviewer?.state === 'APPROVED' &&
            reviewer.commitOid === expectedHead &&
            acceptance?.state === 'APPROVED' &&
            acceptance.commitOid === expectedHead &&
            acceptanceIndex > reviewerIndex,
        unresolvedThreads: second.reviewThreads.filter((thread) => !thread.isResolved).length,
    };
}

export function assertIndependentReviewerApproval(number: number, review: ReviewState): void {
    if (review.latestReviewerStateOnHead !== 'APPROVED') {
        fail(
            `PR #${number} is not approved by the required reviewer actor ${REVIEWER_BOT_NODE_ID} on the current head`
        );
    }
    if (review.unresolvedThreads > 0) {
        fail(`PR #${number} has ${review.unresolvedThreads} unresolved review thread(s)`);
    }
}
