/** Publication evidence safety and fresh, plan-carrying reviewer admission. */

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';

import type { ReviewDocument } from './reviewDocumentParser.ts';
import type { CompletedReviewStance } from './reviewDossier.ts';
import type { ReviewRiskPlan } from './reviewRiskPolicy.ts';

export const REVIEW_STANCES_ADMISSION_FORMAT = 'stances-admission-v1';

/** Published review claims share the caller evidence safety rules. */
export function assertReviewEvidenceClaimsSafe(document: ReviewDocument): void {
    for (const [index, claim] of (document.evidence?.claims ?? []).entries()) {
        assertPublicationSafeEvidence(`review evidence claim[${index}].observable`, [claim.observable]);
        assertPublicationSafeEvidence(`review evidence claim[${index}].verification`, [claim.verification]);
        assertPublicationSafeEvidence(`review evidence claim[${index}].observed`, [claim.observed]);
    }
}

type ProbeResult = 'mutation-detected' | 'still-green' | 'not-run';
type AdmissionProbe = {
    reviewerModel: string;
    baselineProbe: { spec: string; mutation: string; observed: string; result: ProbeResult };
    exhaustion?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function safeString(label: string, value: unknown): string {
    if (typeof value !== 'string') {
        fail(`${label} must be a non-blank string`);
    }
    assertPublicationSafeEvidence(label, [value]);
    return value;
}

function same(label: string, actual: unknown, expected: unknown): void {
    if (actual !== expected) {
        fail(`${label} mismatch: expected ${describe(expected)}`);
    }
}

function probeKey(stance: string, model: string): string {
    return JSON.stringify([stance, model]);
}

function readProbe(value: unknown, label: string): AdmissionProbe['baselineProbe'] {
    if (!isRecord(value)) {
        fail(`${label} must be an object with spec, mutation, observed and result`);
    }
    const spec = safeString(`${label}.spec`, value.spec);
    const mutation = safeString(`${label}.mutation`, value.mutation);
    const observed = safeString(`${label}.observed`, value.observed);
    if (value.result !== 'mutation-detected' && value.result !== 'still-green' && value.result !== 'not-run') {
        fail(`${label}.result must be mutation-detected, still-green or not-run`);
    }
    return { spec, mutation, observed, result: value.result };
}

/**
 * This gate checks caller attestations structurally; it cannot establish whether a reviewer was
 * blind, the mutation really ran, or the selected risks are independent. Historical replay and
 * recovery never call it.
 */
export function assertFreshReviewStructuralAdmission(
    plan: ReviewRiskPlan,
    completedDraws: readonly CompletedReviewStance[],
    record: { present: true; value: unknown } | { present: false },
    path: string
): void {
    if (!record.present) {
        fail(`missing review stances admission at ${path}; fresh reviewer publication requires stances.json`);
    }
    const value = record.value;
    if (!isRecord(value)) {
        fail(`review stances admission at ${path} must be an object`);
    }
    same('review stances admission format', value.format, REVIEW_STANCES_ADMISSION_FORMAT);
    same('review stances admission pr', value.pr, plan.pr);
    same('review stances admission headSha', value.headSha, plan.headSha);
    same('review stances admission baseSha', value.baseSha, plan.baseSha);
    if (!Array.isArray(value.stances)) {
        fail(`review stances admission at ${path} stances must be an array`);
    }

    const names = new Set<string>();
    const probes = new Map<string, AdmissionProbe>();
    for (const [index, row] of value.stances.entries()) {
        const label = `review stances admission stances[${index}]`;
        if (!isRecord(row)) {
            fail(`${label} must be an object`);
        }
        const stance = safeString(`${label}.stance`, row.stance);
        safeString(`${label}.admittedBy`, row.admittedBy);
        if (names.has(stance)) {
            fail(`${label} duplicates stance ${describe(stance)}; duplicate rows cannot increase the stance count`);
        }
        names.add(stance);
        if (!Array.isArray(row.draws)) {
            fail(`${label}.draws must be an array of completed draw probes`);
        }
        for (const [drawIndex, draw] of row.draws.entries()) {
            const drawLabel = `${label}.draws[${drawIndex}]`;
            if (!isRecord(draw)) {
                fail(`${drawLabel} must be an object`);
            }
            const reviewerModel = safeString(`${drawLabel}.reviewerModel`, draw.reviewerModel);
            const key = probeKey(stance, reviewerModel);
            if (probes.has(key)) {
                fail(
                    `${drawLabel} duplicates baseline probe for stance ${describe(stance)} on ${describe(reviewerModel)}`
                );
            }
            const baselineProbe = readProbe(draw.baselineProbe, `${drawLabel}.baselineProbe`);
            const admission: AdmissionProbe = { reviewerModel, baselineProbe };
            if (draw.exhaustion !== undefined) {
                admission.exhaustion = safeString(`${drawLabel}.exhaustion`, draw.exhaustion);
            }
            probes.set(key, admission);
        }
    }
    if (names.size < 3) {
        fail(`review stances admission requires at least three unique task risk stances; found ${names.size}`);
    }
    if (
        plan.riskClasses.some((risk) => risk === 'native-security' || risk === 'realtime-audio' || risk === 'undo') &&
        !completedDraws.some((draw) => draw.modelTier === 'strongest')
    ) {
        fail('review stances admission requires a completed strongest draw for specialist risk');
    }

    const completed = new Set<string>();
    for (const draw of completedDraws) {
        const key = probeKey(draw.stance, draw.reviewerModel);
        completed.add(key);
        const probe = probes.get(key);
        if (probe === undefined) {
            fail(
                `review stances admission missing baseline probe for stance ${describe(draw.stance)} on ${describe(draw.reviewerModel)}`
            );
        }
        same(
            `review stances admission exhaustion for ${draw.stance} on ${draw.reviewerModel}`,
            probe.exhaustion,
            draw.exhaustion
        );
        if (probe.baselineProbe.result !== 'mutation-detected') {
            fail(
                `review stances admission baseline probe for stance ${describe(draw.stance)} on ${describe(draw.reviewerModel)} reported ${probe.baselineProbe.result}`
            );
        }
    }
    for (const [key, probe] of probes) {
        if (!completed.has(key)) {
            fail(
                `review stances admission has extra baseline probe for ${describe(key)} on ${describe(probe.reviewerModel)}`
            );
        }
    }
}
