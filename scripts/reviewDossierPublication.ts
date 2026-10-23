/**
 * Publication bridge for the durable review-dossier record (#2999; ADR 0054).
 *
 * The trusted publisher derives the canonical record itself, from the review document's `draws`,
 * comments, event and approval evidence plus the bundle's `risk-plan.json`; no caller document
 * carries the record. `buildReviewDossier` assembles that record, or recognizes the head's
 * already-persisted record and replays it unchanged so a retried publication is idempotent. Both
 * paths bind the record's identity and risk classes to the plan, its comment findings to the review
 * document, and its recommendation to the document's event.
 */

import { fail } from './prContract.ts';
import {
    REVIEW_DOSSIER_FORMAT,
    assembleReviewDossier,
    parseReviewDossier,
    serializeReviewDossier,
} from './reviewDossier.ts';
import { acceptedFindings, discardedDispositions, publishedReviewId } from './reviewDossierViews.ts';

import type { ReviewDraw } from './reviewDocumentParser.ts';
import type { ReviewDossier, ReviewDossierEvent } from './reviewDossier.ts';
import type { ReviewRiskPlan } from './reviewRiskPolicy.ts';

type ReviewDossierComment = { path: string; line: number; side: 'LEFT' | 'RIGHT' };
type ReviewRecommendation = 'approve' | 'request-changes';
type ReviewDossierBuildInput = {
    plan: ReviewRiskPlan;
    /** The bundle's `dossier.json` value when the file exists, or undefined. */
    persisted: unknown;
    draws: readonly ReviewDraw[] | undefined;
    evidence: readonly { observable: string; verification: string; observed: string }[];
    comments: readonly ReviewDossierComment[];
    recommendation: ReviewRecommendation;
};
type ReviewDossierPublication = { dossier: ReviewDossier; canonical: string; fromPersisted: boolean };

const DRAW_OUTCOMES: Record<ReviewDraw['outcome'], 'blocker-found' | 'clean'> = {
    clean: 'clean',
    findings: 'blocker-found',
};

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

/**
 * The head's persisted canonical record, or undefined when `dossier.json` holds anything else — a
 * retired caller input is no record and is replaced by the derived one. The check keys on the format
 * field alone: a value claiming the canonical format must validate in full, chain digests included,
 * so a tampered record fails closed with its own corruption error instead of being replaced.
 */
export function persistedReviewDossier(raw: unknown): ReviewDossier | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return undefined;
    }
    if ((raw as { format?: unknown }).format !== REVIEW_DOSSIER_FORMAT) {
        return undefined;
    }
    return parseReviewDossier(raw);
}

function assembleFromDraws(input: ReviewDossierBuildInput, draws: readonly ReviewDraw[]): ReviewDossier {
    const stanceEvents = draws.map((draw): ReviewDossierEvent => ({
        kind: 'stance-completed',
        stance: draw.stance,
        reviewerModel: draw.reviewerModel,
        modelTier: draw.tier,
        outcome: DRAW_OUTCOMES[draw.outcome],
    }));
    const findingEvents = input.comments.map((comment, index): ReviewDossierEvent => ({
        kind: 'finding-accepted',
        findingId: `comment-${index}`,
        path: comment.path,
        line: comment.line,
        side: comment.side,
    }));
    return assembleReviewDossier({
        plan: input.plan,
        events: [...stanceEvents, ...findingEvents],
        evidence: input.evidence,
        limitations: [],
        recommendation: input.recommendation,
    });
}

function assertSameValue(label: string, actual: unknown, expected: unknown): void {
    if (actual !== expected) {
        fail(`${label} mismatch: record has ${describeValue(actual)}, expected ${describeValue(expected)}`);
    }
}

function assertEqualList(label: string, actual: readonly string[], expected: readonly string[]): void {
    if (actual.length === expected.length && actual.every((value, index) => value === expected[index])) {
        return;
    }
    fail(`${label} mismatch: record has [${actual.join(', ')}], expected [${expected.join(', ')}]`);
}

function assertFindingsMatchComments(
    accepted: readonly { findingId: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }[],
    comments: readonly ReviewDossierComment[]
): void {
    if (accepted.length !== comments.length) {
        fail(
            `review dossier publication accepted finding count ${accepted.length} does not match ${comments.length} review comments`
        );
    }
    for (const [index, finding] of accepted.entries()) {
        const comment = comments[index];
        if (comment === undefined) {
            fail(`review dossier publication has no review comment at index ${index}`);
        }
        if (finding.findingId !== `comment-${index}`) {
            fail(
                `review dossier publication accepted finding ${index} id ${finding.findingId} must be comment-${index}`
            );
        }
        if (finding.path !== comment.path || finding.line !== comment.line || finding.side !== comment.side) {
            fail(
                `review dossier publication accepted finding ${index} ${finding.path}:${finding.line}:${finding.side} does not match review comment ${comment.path}:${comment.line}:${comment.side}`
            );
        }
    }
}

/** Historical records carry discards; their ids must stay outside the positional comment ids. */
function assertNoCommentIdCollision(
    discarded: readonly { findingId: string }[],
    comments: readonly ReviewDossierComment[]
): void {
    const commentIds = new Set(comments.map((_comment, index) => `comment-${index}`));
    for (const entry of discarded) {
        if (commentIds.has(entry.findingId)) {
            fail(
                `review dossier publication discarded finding id ${entry.findingId} collides with a review comment id`
            );
        }
    }
}

function assertPublicationAgreement(dossier: ReviewDossier, input: ReviewDossierBuildInput): void {
    assertSameValue('review dossier publication pr', dossier.pr, input.plan.pr);
    assertSameValue('review dossier publication headSha', dossier.headSha, input.plan.headSha);
    assertSameValue('review dossier publication baseSha', dossier.baseSha, input.plan.baseSha);
    assertEqualList('review dossier publication riskClasses', dossier.riskClasses, input.plan.riskClasses);
    assertSameValue('review dossier publication recommendation', dossier.recommendation, input.recommendation);
    assertNoCommentIdCollision(discardedDispositions(dossier), input.comments);
    assertFindingsMatchComments(acceptedFindings(dossier), input.comments);
}

/**
 * The record a publication persists or replays. A persisted record that already binds its
 * publication replays unchanged. Otherwise the record is derived from the document's `draws`; a
 * document without them falls back to a persisted record that never bound its publication — the
 * shape a pre-ADR-0054 run left behind when it crashed before its POST — and with neither the
 * publication is refused. A persisted record that claims a publication is not trusted on that claim
 * alone: the publish path's replay must still prove the named review stands live and exact.
 */
export function buildReviewDossier(input: ReviewDossierBuildInput): ReviewDossierPublication {
    const persisted = persistedReviewDossier(input.persisted);
    const dossier = selectPublicationRecord(persisted, input);
    assertPublicationAgreement(dossier, input);
    return { dossier, canonical: serializeReviewDossier(dossier), fromPersisted: dossier === persisted };
}

function selectPublicationRecord(persisted: ReviewDossier | undefined, input: ReviewDossierBuildInput): ReviewDossier {
    if (persisted !== undefined && (publishedReviewId(persisted) !== undefined || input.draws === undefined)) {
        return persisted;
    }
    if (input.draws !== undefined) {
        return assembleFromDraws(input, input.draws);
    }
    return fail(
        `review.json must carry draws for head ${input.plan.headSha}: one { stance, reviewerModel, tier, outcome } entry per completed blind draw`
    );
}
