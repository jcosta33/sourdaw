/** Publication evidence safety and the proportional draw floor a fresh reviewer publication meets. */

import { assertPublicationSafeEvidence, unsafeCredentialReason } from './evidenceSafety.ts';
import { composeReviewCommentBody, fail } from './prContract.ts';
import { renderReviewDocumentBody } from './reviewApprovalFormat.ts';
import { assertReviewModelEligible } from './reviewerModelDiversity.ts';
import { reviewStanceFloor } from './reviewRiskPolicy.ts';

import type { ReviewDocument } from './reviewDocumentParser.ts';
import type { CompletedReviewStance } from './reviewDossier.ts';
import type { ReviewRiskPlan } from './reviewRiskPolicy.ts';

/** Published review claims share the caller evidence safety rules. */
export function assertReviewEvidenceClaimsSafe(document: ReviewDocument): void {
    for (const [index, claim] of (document.evidence?.claims ?? []).entries()) {
        assertPublicationSafeEvidence(`review evidence claim[${index}].observable`, [claim.observable]);
        assertPublicationSafeEvidence(`review evidence claim[${index}].verification`, [claim.verification]);
        assertPublicationSafeEvidence(`review evidence claim[${index}].observed`, [claim.observed]);
    }
}

/**
 * Case, compatibility-width, mark, ignorable, separator and punctuation spellings of one stance name
 * one stance: only its letters and digits identify it. Compatibility decomposition (NFKD) rather than
 * composition splits accents off their base letters, so a combining mark never survives as part of a
 * precomposed letter.
 */
function stanceKey(stance: string): string {
    return stance
        .normalize('NFKD')
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The machine-checked minimum (ADR 0054): the round's completed draws cover at least the plan's
 * stance floor in distinct stances and every effective draw meets the review-model cost ceiling.
 * It checks the record's shape only; whether the stances attack independent risks, and whether each
 * reviewer ran its probe, stays the orchestrator's judgement. Exact replay and recovered binding
 * never call it.
 */
export function assertReviewDrawFloor(plan: ReviewRiskPlan, draws: readonly CompletedReviewStance[]): void {
    const floor = reviewStanceFloor(plan);
    const stances = new Set(draws.map((draw) => stanceKey(draw.stance)));
    if (stances.size < floor) {
        fail(
            `review.json draws cover ${stances.size} distinct stances; the ${plan.riskClasses.join(', ')} risk plan requires at least ${floor}`
        );
    }
    for (const [index, draw] of draws.entries()) {
        // Pre-ADR caller documents can reuse an unpublished dossier instead of declaring draws.
        assertReviewModelEligible(draw.reviewerModel, `review dossier draws[${index}].reviewerModel`, draw.modelTier);
    }
}

/** The public review body and every inline comment body leave the machine; none may carry a credential. */
export function assertPublicReviewTextSafe(document: ReviewDocument): void {
    const bodyReason = unsafeCredentialReason(renderReviewDocumentBody(document));
    if (bodyReason !== undefined) {
        fail(`review body contains ${bodyReason}; refusing to publish it`);
    }
    for (const [index, comment] of document.comments.entries()) {
        const commentReason = unsafeCredentialReason(composeReviewCommentBody(comment));
        if (commentReason !== undefined) {
            fail(`review comment[${index}] body contains ${commentReason}; refusing to publish it`);
        }
    }
}
