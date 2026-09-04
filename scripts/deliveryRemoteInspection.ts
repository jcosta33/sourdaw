import {
    type MissingReceiptIncident,
    type RecoveryIncident,
    type RejectedMergeIncident,
} from './deliveryLockLegacyIncidents.ts';
import { isAuthorBotNodeId, parseJson, spawnCapture, type GhSession } from './githubAppIdentity.ts';
import { parseDeliveryReceipt, fail } from './prContract.ts';

export type RejectedMergeRecoveryRemoteState = {
    state: string;
    head: string;
    receipt: {
        id: number;
        body: string;
        authorNodeId: string;
        createdAt: string;
        updatedAt: string;
    };
};

export type IssueCommentObservation = {
    id: number;
    authorNodeId: string;
    body: string;
};

export type MissingReceiptRecoveryRemoteState = {
    state: string;
    head: string;
    merged: boolean;
    comments: IssueCommentObservation[];
};

export type DeliveryLockRecoveryRemoteState = RejectedMergeRecoveryRemoteState | MissingReceiptRecoveryRemoteState;

/** What a journaled recovery observes twice, and requires unchanged, before it clears a lock. */
export type JournaledRecoveryRemoteState = {
    state: string;
    head: string;
    merged: boolean;
    mergedByActorNodeId?: string;
    receipts: IssueCommentObservation[];
};

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(`delivery lock recovery could not read ${label}`);
    }
    return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || value === '') {
        fail(`delivery lock recovery could not read ${label}`);
    }
    return value;
}

function numericId(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`delivery lock recovery could not read ${label}`);
    }
    return value;
}

function mergedState(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        fail('delivery lock recovery could not read pull-request merged state');
    }
    return value;
}

function readPullRequestRecord(repository: string, session: GhSession, primaryRoot: string, number: number) {
    const pullRequest = record(
        parseJson<unknown>(
            spawnCapture('gh', ['api', `repos/${repository}/pulls/${number}`], {
                cwd: primaryRoot,
                env: session.env,
            }),
            'delivery lock recovery pull-request state'
        ),
        'pull-request state'
    );
    return { pullRequest, head: record(pullRequest.head, 'pull-request head') };
}

function readRejectedMergeRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    incident: RejectedMergeIncident
): RejectedMergeRecoveryRemoteState {
    const { pullRequest, head } = readPullRequestRecord(repository, session, primaryRoot, incident.number);
    const comment = record(
        parseJson<unknown>(
            spawnCapture('gh', ['api', `repos/${repository}/issues/comments/${incident.receiptId}`], {
                cwd: primaryRoot,
                env: session.env,
            }),
            'delivery lock recovery delivery receipt'
        ),
        'delivery receipt'
    );
    const author = record(comment.user, 'delivery receipt author');
    return {
        state: text(pullRequest.state, 'pull-request state'),
        head: text(head.sha, 'pull-request head'),
        receipt: {
            id: numericId(comment.id, 'delivery receipt id'),
            body: text(comment.body, 'delivery receipt body'),
            authorNodeId: text(author.node_id, 'delivery receipt author'),
            createdAt: text(comment.created_at, 'delivery receipt created time'),
            updatedAt: text(comment.updated_at, 'delivery receipt updated time'),
        },
    };
}

function readIssueCommentObservation(value: unknown): IssueCommentObservation {
    const comment = record(value, 'issue comment');
    const author = record(comment.user, 'issue comment author');
    return {
        id: numericId(comment.id, 'issue comment id'),
        authorNodeId: text(author.node_id, 'issue comment author'),
        body: text(comment.body, 'issue comment body'),
    };
}

// REST issue comments come back in ascending comment-ID order; pagination and flattening
// keep that order so the two stability reads compare the same observation sequence.
function readIssueComments(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    number: number
): IssueCommentObservation[] {
    const pages = parseJson<unknown>(
        spawnCapture(
            'gh',
            ['api', '--paginate', '--slurp', `repos/${repository}/issues/${number}/comments?per_page=100`],
            { cwd: primaryRoot, env: session.env }
        ),
        'delivery lock recovery issue comments'
    );
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        fail('delivery lock recovery could not read issue comments');
    }
    return pages.flat().map(readIssueCommentObservation);
}

function readMissingReceiptRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    incident: MissingReceiptIncident
): MissingReceiptRecoveryRemoteState {
    const { pullRequest, head } = readPullRequestRecord(repository, session, primaryRoot, incident.number);
    return {
        state: text(pullRequest.state, 'pull-request state'),
        head: text(head.sha, 'pull-request head'),
        merged: mergedState(pullRequest.merged),
        comments: readIssueComments(repository, session, primaryRoot, incident.number),
    };
}

function readMergedByActorNodeId(pullRequest: Record<string, unknown>): string | undefined {
    const mergedBy = pullRequest.merged_by;
    if (mergedBy === null || mergedBy === undefined) {
        return undefined;
    }
    return text(record(mergedBy, 'pull-request merge actor').node_id, 'pull-request merge actor');
}

export function defaultJournaledRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    number: number
): JournaledRecoveryRemoteState {
    const { pullRequest, head } = readPullRequestRecord(repository, session, primaryRoot, number);
    const mergedByActorNodeId = readMergedByActorNodeId(pullRequest);
    return {
        state: text(pullRequest.state, 'pull-request state'),
        head: text(head.sha, 'pull-request head'),
        merged: mergedState(pullRequest.merged),
        ...(mergedByActorNodeId === undefined ? {} : { mergedByActorNodeId }),
        receipts: readIssueComments(repository, session, primaryRoot, number).filter(
            (comment) => isAuthorBotNodeId(comment.authorNodeId) && parseDeliveryReceipt(comment.body) !== undefined
        ),
    };
}

export function defaultRemoteState(
    repository: string,
    session: GhSession,
    primaryRoot: string,
    incident: RecoveryIncident
): DeliveryLockRecoveryRemoteState {
    if (incident.kind === 'rejected-merge') {
        return readRejectedMergeRemoteState(repository, session, primaryRoot, incident);
    }
    return readMissingReceiptRemoteState(repository, session, primaryRoot, incident);
}

function sameRejectedMergeRemoteState(
    left: RejectedMergeRecoveryRemoteState,
    right: RejectedMergeRecoveryRemoteState
): boolean {
    return (
        left.state === right.state &&
        left.head === right.head &&
        left.receipt.id === right.receipt.id &&
        left.receipt.body === right.receipt.body &&
        left.receipt.authorNodeId === right.receipt.authorNodeId &&
        left.receipt.createdAt === right.receipt.createdAt &&
        left.receipt.updatedAt === right.receipt.updatedAt
    );
}

function sameIssueCommentObservation(
    left: IssueCommentObservation,
    right: IssueCommentObservation | undefined
): boolean {
    return (
        right !== undefined &&
        left.id === right.id &&
        left.authorNodeId === right.authorNodeId &&
        left.body === right.body
    );
}

function sameMissingReceiptRemoteState(
    left: MissingReceiptRecoveryRemoteState,
    right: MissingReceiptRecoveryRemoteState
): boolean {
    return (
        left.state === right.state &&
        left.head === right.head &&
        left.merged === right.merged &&
        left.comments.length === right.comments.length &&
        left.comments.every((comment, index) => sameIssueCommentObservation(comment, right.comments[index]))
    );
}

export function sameRemoteState(
    left: DeliveryLockRecoveryRemoteState,
    right: DeliveryLockRecoveryRemoteState
): boolean {
    if ('receipt' in left && 'receipt' in right) {
        return sameRejectedMergeRemoteState(left, right);
    }
    if ('merged' in left && 'merged' in right) {
        return sameMissingReceiptRemoteState(left, right);
    }
    return false;
}

export function sameJournaledRemoteState(
    left: JournaledRecoveryRemoteState,
    right: JournaledRecoveryRemoteState
): boolean {
    return (
        left.state === right.state &&
        left.head === right.head &&
        left.merged === right.merged &&
        left.mergedByActorNodeId === right.mergedByActorNodeId &&
        left.receipts.length === right.receipts.length &&
        left.receipts.every((receipt, index) => sameIssueCommentObservation(receipt, right.receipts[index]))
    );
}
