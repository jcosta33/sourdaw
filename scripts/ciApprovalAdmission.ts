#!/usr/bin/env node
/**
 * Decides whether one `labeled` run of `.github/workflows/health-gates.yml` may start the heavy
 * checks behind the required `Gate`. Only the reviewer App's approval label, applied by that App,
 * admits, and only while that App's newest decisive review of the exact head is an undismissed
 * APPROVE. Every other label event is refused with a reason, and `Gate` fails with it rather than
 * skipping.
 *
 * The workflow runs this file from the default branch, never from the candidate head, so a pull
 * request cannot rewrite the decision that admits it. It therefore imports only Node built-ins and
 * dependency-free repository modules: the trusted checkout installs nothing.
 */
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CI_APPROVAL_LABEL, REVIEWER_BOT_NODE_ID } from './githubAppIdentity.ts';

export type ApprovalAdmissionInput = {
    /** `GET /pulls/{n}/reviews`, either one page or `gh api --paginate --slurp`'s list of pages. */
    reviews: unknown;
    headSha: string;
    labelName: string;
    senderNodeId: string;
    reviewerNodeId: string;
    approvalLabel: string;
};

export type ApprovalAdmission = { admitted: boolean; reason: string };

type DecisiveReview = { state: string; commitId: string; nodeId: string };

const FULL_SHA = /^[0-9a-f]{40}$/u;
// COMMENTED and PENDING reviews carry no verdict; every other state replaces the one before it.
const DECISIVE_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

function refuse(reason: string): ApprovalAdmission {
    return { admitted: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenReviewPages(reviews: unknown): unknown[] | undefined {
    if (!Array.isArray(reviews)) {
        return undefined;
    }
    const entries: unknown[] = reviews;
    const pages: unknown[][] = [];
    for (const entry of entries) {
        if (!Array.isArray(entry)) {
            return entries;
        }
        pages.push(entry);
    }
    return pages.flat();
}

function readReview(value: unknown): DecisiveReview | undefined {
    if (!isRecord(value) || !isRecord(value.user)) {
        return undefined;
    }
    const { state, commit_id: commitId } = value;
    const nodeId = value.user.node_id;
    if (typeof state !== 'string' || typeof commitId !== 'string' || typeof nodeId !== 'string') {
        return undefined;
    }
    return { state, commitId, nodeId };
}

export function decideApprovalAdmission(input: ApprovalAdmissionInput): ApprovalAdmission {
    if (input.labelName !== input.approvalLabel) {
        return refuse(`label "${input.labelName}" is not the approval label "${input.approvalLabel}"`);
    }
    if (input.senderNodeId !== input.reviewerNodeId) {
        return refuse(`the approval label was applied by ${input.senderNodeId}, not the reviewer App`);
    }
    if (!FULL_SHA.test(input.headSha)) {
        return refuse('the event carries no full head SHA');
    }
    const entries = flattenReviewPages(input.reviews);
    if (entries === undefined) {
        return refuse('the review list is unreadable');
    }
    const reviews: DecisiveReview[] = [];
    for (const entry of entries) {
        const review = readReview(entry);
        if (review === undefined) {
            return refuse('the review list holds an unreadable review');
        }
        reviews.push(review);
    }
    // GitHub lists reviews oldest first, so the last decisive one is the reviewer's current verdict.
    const verdict = reviews.findLast(
        (review) =>
            review.nodeId === input.reviewerNodeId &&
            review.commitId === input.headSha &&
            DECISIVE_STATES.has(review.state)
    );
    if (verdict === undefined) {
        return refuse(`the reviewer App has not approved head ${input.headSha}`);
    }
    if (verdict.state !== 'APPROVED') {
        return refuse(`the reviewer App's latest review of head ${input.headSha} is ${verdict.state}`);
    }
    return { admitted: true, reason: `the reviewer App approved head ${input.headSha}` };
}

/**
 * One line of printable ASCII without `%`, so a label name cannot break the step output's line format
 * or smuggle an escape into the workflow annotation `Gate` prints it in.
 */
export function admissionOutputLine(reason: string): string {
    return reason.replaceAll(/[^\x20-\x7E]|%/gu, '?');
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined) {
        throw new Error(`${name} is not set`);
    }
    return value;
}

function runCli(): void {
    const decision = decideApprovalAdmission({
        reviews: JSON.parse(readFileSync(requiredEnv('REVIEWS_PATH'), 'utf8')) as unknown,
        headSha: requiredEnv('HEAD_SHA'),
        labelName: requiredEnv('LABEL_NAME'),
        senderNodeId: requiredEnv('SENDER_NODE_ID'),
        reviewerNodeId: REVIEWER_BOT_NODE_ID,
        approvalLabel: CI_APPROVAL_LABEL,
    });
    const reason = admissionOutputLine(decision.reason);
    appendFileSync(requiredEnv('GITHUB_OUTPUT'), `admitted=${String(decision.admitted)}\nreason=${reason}\n`);
    console.log(`${decision.admitted ? 'Admitted' : 'Not admitted'}: ${reason}`);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    runCli();
}
