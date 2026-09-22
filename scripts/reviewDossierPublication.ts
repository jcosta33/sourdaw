/**
 * Publication bridge for the durable review-dossier record (#2999, spec #2995 AC-009/AC-011).
 *
 * The trusted publisher holds the orchestrator's caller-authored `dossier.json` input and the
 * bundle's `risk-plan.json`. `buildReviewDossier` turns that input into the canonical record
 * `parseReviewDossier` accepts, or recognizes an already-persisted record and replays it unchanged
 * so a retried publication is idempotent. Both paths bind the record's identity and risk classes to
 * the plan, its comment findings to the review document, its recommendation to the document's event,
 * and — when the bundle carries the caller's pre-dispatch `stances.json` — its stance draws to that
 * record as sets of stance names. Stances are the model's task-derived judgement, so the plan's
 * mechanically derived stance list never gates the record.
 */

import { join } from 'node:path';

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';
import { assembleReviewDossier, parseReviewDossier, serializeReviewDossier } from './reviewDossier.ts';
import { acceptedFindings, completedStances, discardedDispositions } from './reviewDossierViews.ts';

import type { ReviewDossier, ReviewDossierEvent, ReviewDossierStance, ReviewModelTier } from './reviewDossier.ts';
import type { ReviewerStanceDraw } from './reviewerModelDiversity.ts';
import type { ReviewRiskPlan } from './reviewRiskPolicy.ts';

export const REVIEW_DOSSIER_INPUT_FORMAT = 'dossier-input-v1';

export type ReviewDossierStanceInput = {
    stance: ReviewDossierStance;
    reviewerModel: string;
    modelTier: ReviewModelTier;
    outcome: 'blocker-found' | 'clean';
    /** Present only when this draw reused an authoring model: what made every other model unavailable. */
    exhaustion?: string;
};

export type ReviewStancesRecord = {
    stances: { stance: string }[];
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
    recordedStances?: readonly string[];
};
type ReviewDossierPublication = { dossier: ReviewDossier; canonical: string; fromPersisted: boolean };

/**
 * Total maps, so a widened tier or outcome union fails to compile here instead of silently
 * refusing a caller input the record format accepts. Stance names are free-form safe strings,
 * so they need no membership map.
 */
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
    const seen = new Map<string, number>();
    for (const [index, entry] of readArray('review dossier input stances', value).entries()) {
        const label = `review dossier input stances[${index}]`;
        if (!isRecord(entry)) {
            fail(`${label} must be an object, found ${describeValue(entry)}`);
        }
        const stance = readPublicationSafeString(`${label}.stance`, entry.stance);
        const reviewerModel = readPublicationSafeString(`${label}.reviewerModel`, entry.reviewerModel);
        // One stance may carry several draws when their reviewer models differ; only an exact
        // (stance, reviewerModel) repeat records the same draw twice. JSON framing cannot collide:
        // the pair separator is structural, never string content.
        const drawKey = JSON.stringify([stance, reviewerModel]);
        const firstIndex = seen.get(drawKey);
        if (firstIndex !== undefined) {
            fail(`${label} repeats stances[${firstIndex}]'s stance and reviewerModel: ${stance} on ${reviewerModel}`);
        }
        seen.set(drawKey, index);
        const stanceInput: ReviewDossierStanceInput = {
            stance,
            reviewerModel,
            modelTier: readLiteral(
                `${label}.modelTier`,
                entry.modelTier,
                isModelTier,
                'economy, standard or strongest'
            ),
            outcome: readLiteral(`${label}.outcome`, entry.outcome, isOutcome, 'blocker-found or clean'),
        };
        if (entry.exhaustion !== undefined) {
            stanceInput.exhaustion = readPublicationSafeString(`${label}.exhaustion`, entry.exhaustion);
        }
        stances.push(stanceInput);
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
 * The caller's pre-dispatch `stances.json`. The gate validates only the shape it consumes — an
 * object whose `stances` entries each name a stance — and treats the failure-mode admissions,
 * baseline-probe results, and per-draw exhaustion records as free-form caller evidence it never
 * reads; the dossier's own draw entries carry the gated exhaustion.
 */
export function parseReviewStancesRecord(value: unknown, path: string): ReviewStancesRecord {
    if (!isRecord(value)) {
        fail(`review stances record at ${path} must be an object, found ${describeValue(value)}`);
    }
    if (!Array.isArray(value.stances)) {
        fail(`review stances record at ${path} stances must be an array, found ${describeValue(value.stances)}`);
    }
    const stances: { stance: string }[] = [];
    for (const [index, entry] of value.stances.entries()) {
        if (!isRecord(entry) || typeof entry.stance !== 'string') {
            fail(`review stances record at ${path} stances[${index}] must carry a stance string`);
        }
        stances.push({ stance: entry.stance });
    }
    return { stances };
}

/**
 * The dispatched-stance names a bundle's stances.json carries, or undefined when the bundle holds
 * no such file — the legacy path that carries no stance-completeness constraint.
 */
export function recordedReviewStances(
    read: { present: true; value: unknown } | { present: false },
    path: string
): string[] | undefined {
    return read.present ? parseReviewStancesRecord(read.value, path).stances.map((entry) => entry.stance) : undefined;
}

/** One completed draw's disclosure fields, shared by both dossier shapes. */
type DossierDrawFields = {
    stance: string;
    reviewerModel: string;
    exhaustion?: string;
};

function dossierStanceToDraw(record: DossierDrawFields): ReviewerStanceDraw {
    const draw: ReviewerStanceDraw = { stance: record.stance, reviewerModel: record.reviewerModel };
    if (record.exhaustion !== undefined) {
        draw.exhaustion = record.exhaustion;
    }
    return draw;
}

/**
 * The bundle dossier's stance draws, for the diversity gate's per-draw disclosure, read from either
 * well-formed file shape: the caller's `dossier-input-v1` stances, or — when the file parses as the
 * persisted `dossier-v1` canonical record — that record's `stance-completed` events. The per-draw
 * rule runs on every publication regardless of file form, so a replay reads the same draws the
 * first publication gated and a mixed round replays unchanged. The probe never refuses: every
 * shape it cannot use — a bundle with no risk plan (the legacy path, which must not read or require
 * dossier material at all), an absent dossier, a malformed dossier — yields undefined and keeps
 * exactly the document-level check, with the dossier gate refusing malformed shapes later, still
 * before any remote write. The caller passes the publication port's bundle reader structurally; the
 * file names are this module's bundle layout, as in `prepareReview`.
 */
export function readDossierStanceDraws(
    port: { readReviewJson: (path: string) => unknown },
    bundle: string
): ReviewerStanceDraw[] | undefined {
    try {
        // Existence probe for the gate-active path, mirroring the dossier gate's legacy tolerance;
        // the plan itself is parsed and bound there, after the diversity check runs.
        port.readReviewJson(join(bundle, 'risk-plan.json'));
    } catch {
        return undefined;
    }
    let raw: unknown;
    try {
        raw = port.readReviewJson(join(bundle, 'dossier.json'));
    } catch {
        return undefined;
    }
    try {
        return parseReviewDossierInput(raw).stances.map(dossierStanceToDraw);
    } catch {
        // Not caller input; the persisted canonical record is the only other well-formed shape.
    }
    const persisted = tryParsePersistedDossier(raw);
    if (persisted === undefined) {
        return undefined;
    }
    return completedStances(persisted).map(dossierStanceToDraw);
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
    const stanceEvents = parsed.stances.map((stance): ReviewDossierEvent => {
        const completed: ReviewDossierEvent = {
            kind: 'stance-completed',
            stance: stance.stance,
            reviewerModel: stance.reviewerModel,
            modelTier: stance.modelTier,
            outcome: stance.outcome,
        };
        if (stance.exhaustion !== undefined) {
            completed.exhaustion = stance.exhaustion;
        }
        return completed;
    });
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

/**
 * The stance correspondence is set-level over stance names against the caller's pre-dispatch
 * record: every dossier draw names a recorded stance, and every recorded stance carries at least
 * one draw — several draws on one stance share its single recorded entry. Stances are the model's
 * task-derived judgement, so the plan's mechanically derived list never gates here; a bundle with
 * no `stances.json` predates the record and is accepted without a stance-completeness constraint.
 */
function assertStancesMatchRecord(
    completed: readonly { stance: ReviewDossierStance }[],
    recorded: readonly string[]
): void {
    const dispatched = completed.map((entry) => entry.stance);
    // Recorded stance names are caller-authored strings, so the correspondence compares in the
    // string domain.
    const dispatchedSet = new Set<string>(dispatched);
    const recordedSet = new Set(recorded);
    const missing = recorded.filter((stance) => !dispatchedSet.has(stance));
    const extra = dispatched.filter((stance) => !recordedSet.has(stance));
    if (missing.length > 0 || extra.length > 0) {
        fail(
            `review dossier publication stances do not match stances.json: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`
        );
    }
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
    // The dossier's stance entries answer to the pre-dispatch record, never to the plan's menu; a
    // bundle without one publishes with no stance-completeness constraint at all.
    if (input.recordedStances !== undefined) {
        assertStancesMatchRecord(completedStances(dossier), input.recordedStances);
    }
    assertSameValue('review dossier publication recommendation', dossier.recommendation, input.recommendation);
    // The discarded-id namespace is independent of the positional accepted ids, and the accepted
    // check claims the whole comment-id namespace, so the collision guard runs first.
    assertNoCommentIdCollision(discardedDispositions(dossier), input.comments);
    assertFindingsMatchComments(acceptedFindings(dossier), input.comments);
}

export function buildReviewDossier(input: ReviewDossierBuildInput): ReviewDossierPublication {
    const persisted = tryParsePersistedDossier(input.raw);
    const dossier = persisted ?? assembleFromInput(input);
    assertPublicationAgreement(dossier, input);
    return { dossier, canonical: serializeReviewDossier(dossier), fromPersisted: persisted !== undefined };
}
