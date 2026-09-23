/**
 * Bound on the reviewer change-request repair loop (#4584): a pull request that has taken the
 * escalation threshold of reviewer `REQUEST_CHANGES` rounds must not receive another fresh reviewer
 * publication until the orchestrator records an explicit reassessment for that head in the bundle's
 * `reassessment.json`. The gate is a fail-closed step in the trusted GitHub-write closure; the
 * repair path is deliberately never gated so unresolved threads always stay resolvable.
 *
 * Pure by construction: parsing and counting take data, never a live session.
 */

import { join } from 'node:path';

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';
import {
    reconstructReviewRounds,
    type PublicReview,
    type PublicReviewComment,
    type ReviewReconstruction,
} from './reconstructReviewRounds.ts';

export const REVIEW_ROUND_ESCALATION_THRESHOLD = 3;
export const REVIEW_REASSESSMENT_FORMAT = 'reassessment-v1';
export const REASSESSMENT_FILE_NAME = 'reassessment.json';

export const REVIEW_REASSESSMENT_ACTIONS = ['split', 'respec', 'continue'] as const;
export type ReviewReassessmentAction = (typeof REVIEW_REASSESSMENT_ACTIONS)[number];

export type ReviewReassessment = {
    format: typeof REVIEW_REASSESSMENT_FORMAT;
    pr: number;
    headSha: string;
    baseSha: string;
    roundsObserved: number;
    threshold: number;
    action: ReviewReassessmentAction;
    reason: string;
};

const REASSESSMENT_ACTION_SET: ReadonlySet<string> = new Set(REVIEW_REASSESSMENT_ACTIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isReassessmentAction(value: string): value is ReviewReassessmentAction {
    return REASSESSMENT_ACTION_SET.has(value);
}

function readNonBlankString(label: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`review reassessment ${label} must be a non-blank string, found ${describeValue(value)}`);
    }
    return value;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`review reassessment ${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readNonNegativeInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        fail(`review reassessment ${label} must be a non-negative safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readAction(label: string, value: unknown): ReviewReassessmentAction {
    if (typeof value !== 'string' || !isReassessmentAction(value)) {
        fail(
            `review reassessment ${label} must be one of ${REVIEW_REASSESSMENT_ACTIONS.join(', ')}, found ${describeValue(value)}`
        );
    }
    return value;
}

/**
 * The reason is caller-authored published evidence, so it carries the same single-line, trimmed,
 * bounded, credential-refusing rules as the record's other literal fields.
 */
function readReason(label: string, value: unknown): string {
    const text = readNonBlankString(label, value);
    assertPublicationSafeEvidence(`review reassessment ${label}`, [text]);
    return text;
}

export function parseReviewReassessment(value: unknown): ReviewReassessment {
    if (!isRecord(value)) {
        fail(`review reassessment must be an object, found ${describeValue(value)}`);
    }
    if (value.format !== REVIEW_REASSESSMENT_FORMAT) {
        fail(`review reassessment format must be ${REVIEW_REASSESSMENT_FORMAT}, found ${describeValue(value.format)}`);
    }
    const threshold = readPositiveInteger('threshold', value.threshold);
    if (threshold !== REVIEW_ROUND_ESCALATION_THRESHOLD) {
        fail(
            `review reassessment threshold ${threshold} does not match the escalation threshold ${REVIEW_ROUND_ESCALATION_THRESHOLD}`
        );
    }
    return {
        format: REVIEW_REASSESSMENT_FORMAT,
        pr: readPositiveInteger('pr', value.pr),
        headSha: readNonBlankString('headSha', value.headSha),
        baseSha: readNonBlankString('baseSha', value.baseSha),
        roundsObserved: readNonNegativeInteger('roundsObserved', value.roundsObserved),
        threshold,
        action: readAction('action', value.action),
        reason: readReason('reason', value.reason),
    };
}

/** The reviewer `REQUEST_CHANGES` rounds in a reconstruction — rounds, never findings. */
export function countReviewerRequestChangesRounds(reconstruction: ReviewReconstruction): number {
    return reconstruction.rounds.filter((round) => round.role === 'reviewer' && round.verdict === 'changes-requested')
        .length;
}

export type ReviewReassessmentFile = { present: true; value: unknown } | { present: false };

/**
 * The escalation gate. Below the threshold it requires nothing and returns `undefined`; at or above
 * it the caller-authored reassessment must be present, must bind this pull request, head and base,
 * must record exactly the observed count, and must carry a known action and a safe reason. Every
 * refusal names the observed count, the threshold, the expected file path, and the allowed actions.
 */
export function gateReviewRoundEscalation(input: {
    observedCount: number;
    pr: number;
    headSha: string;
    baseSha: string;
    bundle: string;
    reassessment: ReviewReassessmentFile;
}): ReviewReassessment | undefined {
    if (input.observedCount < REVIEW_ROUND_ESCALATION_THRESHOLD) {
        return undefined;
    }
    if (!input.reassessment.present) {
        const path = join(input.bundle, REASSESSMENT_FILE_NAME);
        fail(
            `review round escalation: observed ${input.observedCount} reviewer request-changes rounds, at or above the threshold ${REVIEW_ROUND_ESCALATION_THRESHOLD}; ` +
                `the orchestrator must record a reassessment at ${path} for head ${input.headSha} ` +
                `with roundsObserved ${input.observedCount} and one action from ${REVIEW_REASSESSMENT_ACTIONS.join(', ')}`
        );
    }
    const reassessment = parseReviewReassessment(input.reassessment.value);
    if (reassessment.pr !== input.pr) {
        fail(`review reassessment pr ${reassessment.pr} does not match pull request ${input.pr}`);
    }
    if (reassessment.headSha !== input.headSha) {
        fail(`review reassessment headSha ${reassessment.headSha} does not match the live head ${input.headSha}`);
    }
    if (reassessment.baseSha !== input.baseSha) {
        fail(`review reassessment baseSha ${reassessment.baseSha} does not match the bundle baseSha ${input.baseSha}`);
    }
    if (reassessment.roundsObserved !== input.observedCount) {
        fail(
            `review reassessment roundsObserved ${reassessment.roundsObserved} does not match the observed ${input.observedCount}`
        );
    }
    return reassessment;
}

/**
 * Logs the escalation flag when the observed reviewer request-changes rounds meet the threshold.
 * Advisory by design: the repair path must never refuse on an unreadable public history, so both a
 * missing reader and a failed reconstruction are swallowed rather than thrown.
 */
export function logReviewRoundEscalationAtThreshold(
    number: number,
    head: string,
    reviews: ((number: number) => PublicReview[]) | undefined,
    comments: ((number: number) => PublicReviewComment[]) | undefined,
    log: (message: string) => void
): void {
    try {
        if (reviews === undefined || comments === undefined) {
            return;
        }
        const reconstruction = reconstructReviewRounds(
            number,
            { state: 'OPEN', head },
            reviews(number),
            comments(number)
        );
        const requestChanges = countReviewerRequestChangesRounds(reconstruction);
        if (requestChanges >= REVIEW_ROUND_ESCALATION_THRESHOLD) {
            log(
                `review-round-escalation:${number}:request-changes=${requestChanges}:threshold=${REVIEW_ROUND_ESCALATION_THRESHOLD}`
            );
        }
    } catch {
        // Never refuse a repair because the public round history was unreadable.
    }
}
