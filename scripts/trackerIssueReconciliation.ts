import { createHash } from 'node:crypto';

import { AUTHOR_BOT_LOGIN, REQUIRED_REPOSITORY, isAuthorBotLogin } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type TrackerIssueComment = {
    id: string;
    body: string;
    authorLogin: string | null;
    authorType: string | null;
};

export type TrackerIssue = {
    id: string;
    number: number;
    repository: string;
    state: 'OPEN' | 'CLOSED';
    stateReason: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED' | null;
    body: string;
    comments: TrackerIssueComment[];
};

type TrackerIssueUpdate = {
    body?: string;
    state?: 'CLOSED';
    stateReason?: 'COMPLETED';
};

export type ReconcileTrackerIssuePort = {
    inspect: (number: number) => TrackerIssue;
    update: (number: number, input: TrackerIssueUpdate) => TrackerIssue;
    comment: (number: number, body: string) => TrackerIssueComment;
    log: (message: string) => void;
};

export type BodyEdit = { from: string; to: string };

type ReconcileTrackerIssueInput =
    | { issueNumber: number; expectedBodySha256: string; nextBody: string }
    | { issueNumber: number; expectedBodySha256: string; replacementNumber: number };

const maximumIssueBodyBytes = 65_536;

export function applyExactBodyEdits(body: string, edits: BodyEdit[]): string {
    let result = body;
    for (const [index, edit] of edits.entries()) {
        const occurrences = result.split(edit.from).length - 1;
        if (occurrences !== 1) {
            fail(`tracker body edit ${index} must match exactly once; found ${occurrences}`);
        }
        result = result.replace(edit.from, edit.to);
    }
    const bytes = Buffer.byteLength(result, 'utf8');
    if (result.trim() === '' || bytes > maximumIssueBodyBytes) {
        fail(`reconciled tracker body must contain 1-${maximumIssueBodyBytes} UTF-8 bytes`);
    }
    return result;
}

export function assertBodyDigest(body: string, expected: string, number: number): void {
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== expected) {
        fail(`issue #${number} body digest changed: expected ${expected}, found ${actual}`);
    }
}

export function reconcileTrackerIssue(
    input: ReconcileTrackerIssueInput,
    authorLogin: string,
    port: ReconcileTrackerIssuePort
): string {
    if (authorLogin !== AUTHOR_BOT_LOGIN) {
        fail(`authenticated author login ${authorLogin} is not ${AUTHOR_BOT_LOGIN}`);
    }
    const before = port.inspect(input.issueNumber);
    assertBoundIssue(before, input.issueNumber);
    assertBodyDigest(before.body, input.expectedBodySha256, input.issueNumber);

    if ('nextBody' in input) {
        return replaceIssueBody(before, input.nextBody, port);
    }

    return supersedeIssue(before, input.replacementNumber, port);
}

export function completeTrackerIssue(
    issueNumber: number,
    authorLogin: string,
    port: ReconcileTrackerIssuePort
): string {
    assertAuthorLogin(authorLogin);
    const before = port.inspect(issueNumber);
    assertBoundIssue(before, issueNumber);

    if (before.state === 'CLOSED' && !isCompletedIssue(before)) {
        fail(`issue #${issueNumber} is already closed without a completed state reason`);
    }
    if (isCompletedIssue(before)) {
        assertCompletedIssue(port.inspect(issueNumber), before);
        return log(`tracker-issue-completed:${issueNumber}`, port);
    }

    const receipt = recoverCompletedMutation(
        before,
        () => port.update(issueNumber, { state: 'CLOSED', stateReason: 'COMPLETED' }),
        port
    );
    assertCompletedIssue(receipt, before);
    assertCompletedIssue(port.inspect(issueNumber), before);
    return log(`tracker-issue-completed:${issueNumber}`, port);
}

function replaceIssueBody(before: TrackerIssue, nextBody: string, port: ReconcileTrackerIssuePort): string {
    assertOpen(before);
    if (nextBody === before.body) {
        fail(`issue #${before.number} body update is a no-op`);
    }
    const receipt = recoverIssueMutation(
        before,
        nextBody,
        'OPEN',
        () => port.update(before.number, { body: nextBody }),
        port
    );
    assertFinalIssue(receipt, before, nextBody, 'OPEN');
    assertFinalIssue(port.inspect(before.number), before, nextBody, 'OPEN');
    return log(`tracker-issue-updated:${before.number}`, port);
}

function assertAuthorLogin(authorLogin: string): void {
    if (authorLogin !== AUTHOR_BOT_LOGIN) {
        fail(`authenticated author login ${authorLogin} is not ${AUTHOR_BOT_LOGIN}`);
    }
}

function recoverCompletedMutation(
    before: TrackerIssue,
    mutate: () => TrackerIssue,
    port: ReconcileTrackerIssuePort
): TrackerIssue {
    try {
        return mutate();
    } catch (error) {
        const recovered = port.inspect(before.number);
        if (!isSameCompletedIssue(recovered, before)) {
            throw error;
        }
        return recovered;
    }
}

function isCompletedIssue(value: TrackerIssue): boolean {
    return value.state === 'CLOSED' && value.stateReason === 'COMPLETED';
}

function isSameCompletedIssue(value: TrackerIssue, before: TrackerIssue): boolean {
    return (
        value.id === before.id &&
        value.number === before.number &&
        value.repository === before.repository &&
        value.body === before.body &&
        isCompletedIssue(value)
    );
}

function assertCompletedIssue(value: TrackerIssue, before: TrackerIssue): void {
    if (!isSameCompletedIssue(value, before)) {
        fail(`issue #${before.number} changed during completion`);
    }
}

function supersedeIssue(before: TrackerIssue, replacementNumber: number, port: ReconcileTrackerIssuePort): string {
    if (replacementNumber === before.number) {
        fail(`issue #${before.number} cannot supersede itself`);
    }
    const replacement = port.inspect(replacementNumber);
    assertBoundIssue(replacement, replacementNumber);
    if (replacement.repository !== before.repository) {
        fail('replacement issue must belong to the same repository');
    }
    assertOpen(replacement);

    const markerBody = `Superseded by #${replacement.number}.`;
    if (before.state === 'CLOSED') {
        assertOneMarker(before, markerBody);
        return log(`tracker-issue-superseded:${before.number}:${replacement.number}`, port);
    }

    const marker = ensureMarker(before, markerBody, port);
    const afterComment = port.inspect(before.number);
    assertFinalIssue(afterComment, before, before.body, 'OPEN');
    assertOneMarker(afterComment, markerBody, marker.id);

    const closeReceipt = recoverIssueMutation(
        before,
        before.body,
        'CLOSED',
        () => port.update(before.number, { state: 'CLOSED' }),
        port
    );
    assertFinalIssue(closeReceipt, before, before.body, 'CLOSED');

    const finalIssue = port.inspect(before.number);
    assertFinalIssue(finalIssue, before, before.body, 'CLOSED');
    assertOneMarker(finalIssue, markerBody, marker.id);
    return log(`tracker-issue-superseded:${before.number}:${replacement.number}`, port);
}

function recoverIssueMutation(
    before: TrackerIssue,
    expectedBody: string,
    expectedState: TrackerIssue['state'],
    mutate: () => TrackerIssue,
    port: ReconcileTrackerIssuePort
): TrackerIssue {
    try {
        return mutate();
    } catch (error) {
        const recovered = port.inspect(before.number);
        if (!sameIssue(recovered, before, expectedBody, expectedState)) {
            throw error;
        }
        return recovered;
    }
}

function ensureMarker(issue: TrackerIssue, body: string, port: ReconcileTrackerIssuePort): TrackerIssueComment {
    const existing = exactMarker(issue, body);
    if (existing !== undefined) {
        return existing;
    }

    let receipt: TrackerIssueComment;
    try {
        receipt = port.comment(issue.number, body);
    } catch (error) {
        const recoveredIssue = port.inspect(issue.number);
        assertFinalIssue(recoveredIssue, issue, issue.body, issue.state);
        const recovered = exactMarker(recoveredIssue, body);
        if (recovered === undefined) {
            throw error;
        }
        receipt = recovered;
    }

    if (!isCanonicalMarker(receipt, body)) {
        fail('supersession comment returned an invalid receipt');
    }
    return receipt;
}

function assertBoundIssue(value: TrackerIssue, number: number): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY || value.id === '') {
        fail(`cannot bind tracker issue #${number}`);
    }
}

function assertOpen(value: TrackerIssue): void {
    if (value.state !== 'OPEN') {
        fail(`issue #${value.number} is ${value.state}; expected OPEN`);
    }
}

function sameIssue(
    value: TrackerIssue,
    before: TrackerIssue,
    expectedBody: string,
    expectedState: TrackerIssue['state']
): boolean {
    return (
        value.id === before.id &&
        value.number === before.number &&
        value.repository === before.repository &&
        value.state === expectedState &&
        value.body === expectedBody
    );
}

function assertFinalIssue(
    value: TrackerIssue,
    before: TrackerIssue,
    expectedBody: string,
    expectedState: TrackerIssue['state']
): void {
    if (!sameIssue(value, before, expectedBody, expectedState)) {
        fail(`issue #${before.number} changed during reconciliation`);
    }
}

function exactMarker(issue: TrackerIssue, body: string): TrackerIssueComment | undefined {
    const markers = issue.comments.filter((comment) => comment.body === body);
    if (markers.length > 1) {
        fail(`issue #${issue.number} has duplicate supersession markers`);
    }
    const marker = markers[0];
    if (marker !== undefined && !isCanonicalMarker(marker, body)) {
        fail(`issue #${issue.number} has a non-canonical supersession marker`);
    }
    return marker;
}

function isCanonicalMarker(comment: TrackerIssueComment, body: string): boolean {
    return (
        comment.body === body &&
        comment.id !== '' &&
        isAuthorBotLogin(comment.authorLogin) &&
        comment.authorType === 'Bot'
    );
}

function assertOneMarker(issue: TrackerIssue, body: string, expectedId?: string): void {
    const marker = exactMarker(issue, body);
    if (marker === undefined || (expectedId !== undefined && marker.id !== expectedId)) {
        fail(`issue #${issue.number} must contain exactly one canonical supersession marker`);
    }
}

function log(message: string, port: ReconcileTrackerIssuePort): string {
    port.log(message);
    return message;
}
