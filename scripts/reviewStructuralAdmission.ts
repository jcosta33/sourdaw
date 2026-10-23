/** Publication evidence safety and the proportional draw floor a fresh reviewer publication meets. */

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';
import { reviewStanceFloor, STRONGEST_DRAW_CLASSES } from './reviewRiskPolicy.ts';

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
 * The machine-checked minimum (ADR 0054): the round's completed draws cover at least the plan's
 * stance floor in distinct stances, and a specialist plan carries at least one strongest-tier draw.
 * It checks the record's shape only; whether the stances attack independent risks, and whether each
 * reviewer ran its probe, stays the orchestrator's judgement. Exact replay and recovered binding
 * never call it.
 */
export function assertReviewDrawFloor(plan: ReviewRiskPlan, draws: readonly CompletedReviewStance[]): void {
    const floor = reviewStanceFloor(plan);
    const stances = new Set(draws.map((draw) => draw.stance));
    if (stances.size < floor) {
        fail(
            `review.json draws cover ${stances.size} distinct stances; the ${plan.riskClasses.join(', ')} risk plan requires at least ${floor}`
        );
    }
    const specialist = plan.riskClasses.filter((risk) => STRONGEST_DRAW_CLASSES.has(risk));
    if (specialist.length > 0 && !draws.some((draw) => draw.modelTier === 'strongest')) {
        fail(`review.json draws need at least one strongest-tier draw for the ${specialist.join(', ')} risk plan`);
    }
}
