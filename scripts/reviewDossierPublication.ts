/**
 * Publication bridge for the durable review-dossier record (#2999, spec #2995 AC-009/AC-011).
 *
 * The trusted publisher holds the orchestrator's caller-authored `dossier.json` input and the
 * bundle's `risk-plan.json`. `buildReviewDossier` turns that input into the canonical record
 * `parseReviewDossier` accepts, or recognizes an already-persisted record and replays it unchanged
 * so a retried publication is idempotent. Both paths refuse a record that disagrees with the plan,
 * the review document's comments, or the recommendation the document's event implies.
 */

import { fail } from './prContract.ts';
import {
    acceptedFindings,
    assembleReviewDossier,
    assertPublicationSafeEvidence,
    completedStances,
    discardedDispositions,
    parseReviewDossier,
    serializeReviewDossier,
} from './reviewDossier.ts';

import type { ReviewDossier, ReviewDossierEvent, ReviewModelTier } from './reviewDossier.ts';
import type { ReviewRiskPlan, ReviewStanceId } from './reviewRiskPolicy.ts';

export const REVIEW_DOSSIER_INPUT_FORMAT = 'dossier-input-v1';

export type ReviewDossierStanceInput = {
    stance: ReviewStanceId;
    reviewerModel: string;
    modelTier: ReviewModelTier;
    outcome: 'blocker-found' | 'clean';
};

export type ReviewDossierInput = {
    format: 'dossier-input-v1';
    pr: number;
    headSha: string;
    baseSha: string;
    stances: ReviewDossierStanceInput[];
    evidence: { observable: string; verification: string; observed: string }[];
    limitations: string[];
};

type ReviewDossierComment = { path: string; line: number; side: 'LEFT' | 'RIGHT' };
type ReviewRecommendation = 'approve' | 'request-changes';
type ReviewDossierBuildInput = {
    plan: ReviewRiskPlan;
    raw: unknown;
    discarded: unknown;
    comments: readonly ReviewDossierComment[];
    recommendation: ReviewRecommendation;
};
type ReviewDossierPublication = { dossier: ReviewDossier; canonical: string; fromPersisted: boolean };

/**
 * Total maps, so a widened stance, tier or outcome union fails to compile here instead of silently
 * refusing a caller input the record format accepts.
 */
const STANCE_MEMBERSHIP: Record<ReviewStanceId, true> = {
    correctness: true,
    'module-boundaries': true,
    'realtime-audio': true,
    'project-integrity-undo': true,
    'security-platform': true,
    'code-craft': true,
    'test-validity': true,
};

const MODEL_TIER_MEMBERSHIP: Record<ReviewModelTier, true> = {
    economy: true,
    standard: true,
    strongest: true,
};

const OUTCOME_MEMBERSHIP: Record<ReviewDossierStanceInput['outcome'], true> = {
    'blocker-found': true,
    clean: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isReviewStanceId(value: string): value is ReviewStanceId {
    return Object.hasOwn(STANCE_MEMBERSHIP, value);
}

function isModelTier(value: string): value is ReviewModelTier {
    return Object.hasOwn(MODEL_TIER_MEMBERSHIP, value);
}

function isOutcome(value: string): value is ReviewDossierStanceInput['outcome'] {
    return Object.hasOwn(OUTCOME_MEMBERSHIP, value);
}

function readLiteral<Value extends string>(
    label: string,
    value: unknown,
    matches: (candidate: string) => candidate is Value,
    expected: string
): Value {
    if (typeof value !== 'string' || !matches(value)) {
        fail(`${label} must be ${expected}, found ${describeValue(value)}`);
    }
    return value;
}

function readArray(label: string, value: unknown): readonly unknown[] {
    if (!Array.isArray(value)) {
        fail(`${label} must be an array, found ${describeValue(value)}`);
    }
    return value;
}

function readNonBlankString(label: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must be a non-blank string, found ${describeValue(value)}`);
    }
    return value;
}

/** Caller-authored strings are persisted into the record, so they carry the evidence-safety rules. */
function readPublicationSafeString(label: string, value: unknown): string {
    const text = readNonBlankString(label, value);
    assertPublicationSafeEvidence(label, [text]);
    return text;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readStances(value: unknown): ReviewDossierStanceInput[] {
    const stances: ReviewDossierStanceInput[] = [];
    const seen = new Map<ReviewStanceId, number>();
    for (const [index, entry] of readArray('review dossier input stances', value).entries()) {
        const label = `review dossier input stances[${index}]`;
        if (!isRecord(entry)) {
            fail(`${label} must be an object, found ${describeValue(entry)}`);
        }
        const stance = readLiteral(`${label}.stance`, entry.stance, isReviewStanceId, 'a known review stance');
        const firstIndex = seen.get(stance);
        if (firstIndex !== undefined) {
            fail(`${label}.stance duplicates stances[${firstIndex}].stance: ${stance}`);
        }
        seen.set(stance, index);
        stances.push({
            stance,
            reviewerModel: readPublicationSafeString(`${label}.reviewerModel`, entry.reviewerModel),
            modelTier: readLiteral(
                `${label}.modelTier`,
                entry.modelTier,
                isModelTier,
                'economy, standard or strongest'
            ),
            outcome: readLiteral(`${label}.outcome`, entry.outcome, isOutcome, 'blocker-found or clean'),
        });
    }
    return stances;
}

function readEvidence(value: unknown): ReviewDossierInput['evidence'] {
    const evidence: ReviewDossierInput['evidence'] = [];
    for (const [index, entry] of readArray('review dossier input evidence', value).entries()) {
        const label = `review dossier input evidence[${index}]`;
        if (!isRecord(entry)) {
            fail(`${label} must be an object, found ${describeValue(entry)}`);
        }
        evidence.push({
            observable: readNonBlankString(`${label}.observable`, entry.observable),
            verification: readNonBlankString(`${label}.verification`, entry.verification),
            observed: readNonBlankString(`${label}.observed`, entry.observed),
        });
    }
    return evidence;
}

function readLimitations(value: unknown): string[] {
    return readArray('review dossier input limitations', value).map((entry, index) =>
        readNonBlankString(`review dossier input limitations[${index}]`, entry)
    );
}

export function parseReviewDossierInput(value: unknown): ReviewDossierInput {
    if (!isRecord(value)) {
        fail(`review dossier input must be an object, found ${describeValue(value)}`);
    }
    if (value.format !== REVIEW_DOSSIER_INPUT_FORMAT) {
        fail(
            `review dossier input format must be ${REVIEW_DOSSIER_INPUT_FORMAT}, found ${describeValue(value.format)}`
        );
    }
    return {
        format: REVIEW_DOSSIER_INPUT_FORMAT,
        pr: readPositiveInteger('review dossier input pr', value.pr),
        headSha: readNonBlankString('review dossier input headSha', value.headSha),
        baseSha: readNonBlankString('review dossier input baseSha', value.baseSha),
        stances: readStances(value.stances),
        evidence: readEvidence(value.evidence),
        limitations: readLimitations(value.limitations),
    };
}

/**
 * The two forms never validate as each other, so a refusal here is the retry/replay detection:
 * `parseReviewDossier` accepts only the canonical record, and caller input is assembled below.
 */
function tryParsePersistedDossier(raw: unknown): ReviewDossier | undefined {
    try {
        return parseReviewDossier(raw);
    } catch {
        return undefined;
    }
}

function assembleFromInput(input: ReviewDossierBuildInput): ReviewDossier {
    const parsed = parseReviewDossierInput(input.raw);
    assertSameValue('review dossier input pr', parsed.pr, input.plan.pr);
    assertSameValue('review dossier input headSha', parsed.headSha, input.plan.headSha);
    assertSameValue('review dossier input baseSha', parsed.baseSha, input.plan.baseSha);
    const stanceEvents = parsed.stances.map((stance): ReviewDossierEvent => ({
        kind: 'stance-completed',
        stance: stance.stance,
        reviewerModel: stance.reviewerModel,
        modelTier: stance.modelTier,
        outcome: stance.outcome,
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
        discarded: input.discarded ?? [],
        evidence: parsed.evidence,
        limitations: parsed.limitations,
        recommendation: input.recommendation,
    });
}

function assertSameValue(label: string, actual: unknown, expected: unknown): void {
    if (actual !== expected) {
        fail(`${label} mismatch: record has ${describeValue(actual)}, expected ${describeValue(expected)}`);
    }
}

function assertEqualStanceList(label: string, actual: readonly string[], expected: readonly string[]): void {
    if (actual.length === expected.length && actual.every((value, index) => value === expected[index])) {
        return;
    }
    fail(`${label} mismatch: record has [${actual.join(', ')}], expected [${expected.join(', ')}]`);
}

function assertStancesMatchPlan(
    completed: readonly { stance: ReviewStanceId }[],
    required: readonly ReviewStanceId[]
): void {
    const recorded = completed.map((entry) => entry.stance);
    const recordedSet = new Set(recorded);
    const requiredSet = new Set(required);
    const missing = required.filter((stance) => !recordedSet.has(stance));
    const extra = recorded.filter((stance) => !requiredSet.has(stance));
    if (missing.length > 0 || extra.length > 0) {
        fail(
            `review dossier publication stances do not match the plan: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`
        );
    }
}

function assertFindingsMatchComments(
    accepted: readonly { path: string; line: number; side: 'LEFT' | 'RIGHT' }[],
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
        if (finding.path !== comment.path || finding.line !== comment.line || finding.side !== comment.side) {
            fail(
                `review dossier publication accepted finding ${index} ${finding.path}:${finding.line}:${finding.side} does not match review comment ${comment.path}:${comment.line}:${comment.side}`
            );
        }
    }
}

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
    assertEqualStanceList('review dossier publication riskClasses', dossier.riskClasses, input.plan.riskClasses);
    assertEqualStanceList(
        'review dossier publication requiredStances',
        dossier.requiredStances,
        input.plan.requiredStances
    );
    assertStancesMatchPlan(completedStances(dossier), input.plan.requiredStances);
    assertSameValue('review dossier publication recommendation', dossier.recommendation, input.recommendation);
    assertFindingsMatchComments(acceptedFindings(dossier), input.comments);
    assertNoCommentIdCollision(discardedDispositions(dossier), input.comments);
}

export function buildReviewDossier(input: ReviewDossierBuildInput): ReviewDossierPublication {
    const persisted = tryParsePersistedDossier(input.raw);
    const dossier = persisted ?? assembleFromInput(input);
    assertPublicationAgreement(dossier, input);
    return { dossier, canonical: serializeReviewDossier(dossier), fromPersisted: persisted !== undefined };
}
