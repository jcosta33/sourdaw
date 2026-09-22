/**
 * Versioned contracts shared by the advisory semantic-review integration.
 *
 * This module owns the pieces that must not drift between the collector, the provider adapter, the
 * interpreter, and the report: the version strings that key caches and invalidate stale advice, the
 * failure taxonomy that separates an operational failure from a semantic signal, the immutable
 * revision context every assessment is bound to, and the evidence-reference shape whose line numbers
 * and paths come from source processing rather than from the model.
 *
 * Nothing here performs I/O. Every function is pure so the rules and the interpretation policy stay
 * testable without network access, GitHub credentials, or a TypeSafe key.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from '../canonicalRecord.ts';

export const SEMANTIC_REPORT_FORMAT = 'semantic-review-v1';
export const SEMANTIC_POLICY_VERSION = 'semantic-policy-v1';
export const SEMANTIC_EVIDENCE_SELECTION_VERSION = 'semantic-evidence-v1';
export const SEMANTIC_REQUEST_FORMAT_VERSION = 'semantic-request-v1';
export const SEMANTIC_PRICING_VERSION = 'typesafe-pricing-2026-09-20';

export const SEMANTIC_SIDECAR_DIRECTORY = 'semantic-review';

/** The `none` evidence selection: a question may answer that no supplied region is the target. */
export const NO_EVIDENCE_ID = 'none';

/**
 * Operational outcomes, kept distinct from a semantic signal so an unavailable provider can never be
 * read as a clean review. Every one of these is a stop: a judgment the service did not deliver cannot
 * stand in for one.
 */
export const SEMANTIC_FAILURE_CODES = [
    'missing_credentials',
    'authentication_failed',
    'rate_limited',
    'timeout',
    'cancelled',
    'provider_unavailable',
    'invalid_response',
    'model_mismatch',
    'context_collection_failed',
    'budget_exhausted',
    'stale_context',
    'unsupported_scope',
    'sensitive_content_excluded',
] as const;

export type SemanticFailureCode = (typeof SEMANTIC_FAILURE_CODES)[number];

const SEMANTIC_FAILURE_CODE_SET: ReadonlySet<string> = new Set(SEMANTIC_FAILURE_CODES);

export function isSemanticFailureCode(value: unknown): value is SemanticFailureCode {
    return typeof value === 'string' && SEMANTIC_FAILURE_CODE_SET.has(value);
}

/** A typed refusal. `code` is what callers branch on; the message is for the operator. */
export class SemanticFailure extends Error {
    readonly code: SemanticFailureCode;

    constructor(code: SemanticFailureCode, message: string) {
        super(message);
        this.name = 'SemanticFailure';
        this.code = code;
    }
}

export function refuse(code: SemanticFailureCode, message: string): never {
    throw new SemanticFailure(code, message);
}

/** A canonical, order-stable digest over any JSON value. Used for context, rules, and cache identity. */
export function semanticDigest(value: JsonValue): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function semanticTextDigest(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function isFullSha(value: unknown): value is string {
    return typeof value === 'string' && SHA_PATTERN.test(value);
}

export function assertFullSha(value: unknown, label: string): string {
    if (!isFullSha(value)) {
        refuse('stale_context', `${label} must be a full 40-hex commit sha`);
    }
    return value;
}

/** A sha256 digest is 64 hex characters; it is not a commit sha and the two are never interchanged. */
export function assertDigest(value: unknown, label: string): string {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
        refuse('invalid_response', `${label} must be a 64-hex digest`);
    }
    return value;
}

export function assertNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        refuse('unsupported_scope', `${label} must be a non-empty string`);
    }
    return value;
}

/**
 * Exactly what was assessed and which trusted implementation assessed it. `targetBaseSha` is the base
 * branch tip captured when the run began; `mergeBaseSha` is the merge base the change is computed
 * from. They are different commits and must never be conflated.
 */
export type SemanticRevisionContext = {
    repository: string;
    repositoryId: string;
    prNumber?: number;
    headSha: string;
    targetBaseSha: string;
    mergeBaseSha: string;
    trustedExecutionSha: string;
    contractSourceSha: string;
    /**
     * The budget profile the evidence was selected under. It determines how much of each region was
     * sent, so two runs over one head under different profiles produce different dispositions and must
     * not share an identity — or a sidecar path, which the second would silently overwrite.
     */
    evidenceProfile: string;
    rulesDigest: string;
    policyVersion: string;
    contextDigest: string;
};

/** The fields that feed `contextDigest`; `contextDigest` itself is derived, never an input. */
export type SemanticRevisionInputs = Omit<SemanticRevisionContext, 'contextDigest'>;

/**
 * A revision identity before the rule set and policy are resolved. Callers resolving a change supply
 * this; the orchestration layer adds the digest and policy version so they cannot be passed in wrong.
 */
export type SemanticRevisionBase = Omit<SemanticRevisionInputs, 'rulesDigest' | 'policyVersion' | 'evidenceProfile'>;

export function computeContextDigest(inputs: SemanticRevisionInputs): string {
    return semanticDigest({
        repository: inputs.repository,
        repositoryId: inputs.repositoryId,
        prNumber: inputs.prNumber ?? null,
        headSha: inputs.headSha,
        targetBaseSha: inputs.targetBaseSha,
        mergeBaseSha: inputs.mergeBaseSha,
        trustedExecutionSha: inputs.trustedExecutionSha,
        contractSourceSha: inputs.contractSourceSha,
        evidenceProfile: inputs.evidenceProfile,
        rulesDigest: inputs.rulesDigest,
        policyVersion: inputs.policyVersion,
    });
}

export function buildRevisionContext(inputs: SemanticRevisionInputs): SemanticRevisionContext {
    validateRevisionInputs(inputs);
    return { ...inputs, contextDigest: computeContextDigest(inputs) };
}

function validateRevisionInputs(inputs: SemanticRevisionInputs): void {
    assertNonEmptyString(inputs.repository, 'revision context repository');
    assertNonEmptyString(inputs.repositoryId, 'revision context repositoryId');
    assertFullSha(inputs.headSha, 'revision context headSha');
    assertFullSha(inputs.targetBaseSha, 'revision context targetBaseSha');
    assertFullSha(inputs.mergeBaseSha, 'revision context mergeBaseSha');
    assertFullSha(inputs.trustedExecutionSha, 'revision context trustedExecutionSha');
    assertFullSha(inputs.contractSourceSha, 'revision context contractSourceSha');
    assertNonEmptyString(inputs.evidenceProfile, 'revision context evidenceProfile');
    assertDigest(inputs.rulesDigest, 'revision context rulesDigest');
    assertNonEmptyString(inputs.policyVersion, 'revision context policyVersion');
    if (inputs.prNumber !== undefined && (!Number.isSafeInteger(inputs.prNumber) || inputs.prNumber <= 0)) {
        refuse('unsupported_scope', 'revision context prNumber must be a positive integer');
    }
}

export const EVIDENCE_SIDES = ['before', 'after', 'context'] as const;
export type EvidenceSide = (typeof EVIDENCE_SIDES)[number];

const EVIDENCE_SIDE_SET: ReadonlySet<string> = new Set(EVIDENCE_SIDES);

export function isEvidenceSide(value: unknown): value is EvidenceSide {
    return typeof value === 'string' && EVIDENCE_SIDE_SET.has(value);
}

/**
 * One supplied source region. `evidenceId` is assigned by this application, never by the model, and
 * `startLine`/`endLine` come from source processing, never from generation. Deleted code keeps its
 * before-side identity.
 */
export type EvidenceReference = {
    evidenceId: string;
    revisionSha: string;
    path: string;
    side: EvidenceSide;
    startLine: number;
    endLine: number;
    contentHash: string;
};

export function validateEvidenceReference(value: unknown, label: string): EvidenceReference {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('context_collection_failed', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    assertNonEmptyString(record.evidenceId, `${label} evidenceId`);
    assertFullSha(record.revisionSha, `${label} revisionSha`);
    assertNonEmptyString(record.path, `${label} path`);
    if (!isEvidenceSide(record.side)) {
        refuse('context_collection_failed', `${label} side must be before, after, or context`);
    }
    assertLineRange(record.startLine, record.endLine, label);
    assertNonEmptyString(record.contentHash, `${label} contentHash`);
    return {
        evidenceId: record.evidenceId as string,
        revisionSha: record.revisionSha as string,
        path: record.path as string,
        side: record.side,
        startLine: record.startLine as number,
        endLine: record.endLine as number,
        contentHash: record.contentHash as string,
    };
}

/** A source range is impossible unless it starts at or after line 1 and ends at or after its start. */
export function assertLineRange(startLine: unknown, endLine: unknown, label: string): void {
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)) {
        refuse('context_collection_failed', `${label} line bounds must be safe integers`);
    }
    const start = startLine as number;
    const end = endLine as number;
    if (start < 1 || end < start) {
        refuse('context_collection_failed', `${label} has an impossible source range ${String(start)}-${String(end)}`);
    }
}

export function evidenceIdSet(references: readonly EvidenceReference[]): ReadonlySet<string> {
    return new Set(references.map((reference) => reference.evidenceId));
}

/**
 * Validates a model-selected evidence id against the ids actually supplied, including the explicit
 * `none` option. A selection the application never offered is refused rather than trusted.
 */
export function assertSelectedEvidenceId(value: unknown, supplied: ReadonlySet<string>, label: string): string {
    if (typeof value !== 'string' || value === '') {
        refuse('invalid_response', `${label} must select a supplied evidence id or ${NO_EVIDENCE_ID}`);
    }
    if (value !== NO_EVIDENCE_ID && !supplied.has(value)) {
        refuse('invalid_response', `${label} selected unknown evidence id ${value}`);
    }
    return value;
}

/** Scope accounting for one run: what was found, what was eligible, what was actually assessed. */
export type SemanticScopeUnit = {
    unitId: string;
    path: string;
    ruleId: string;
    evidenceIds: readonly string[];
};

export type SemanticScopeExclusion = {
    path: string;
    reason: string;
};

export type SemanticScopeManifest = {
    discovered: number;
    eligible: number;
    assessed: number;
    cacheHits: number;
    excluded: readonly SemanticScopeExclusion[];
    unassessed: readonly SemanticScopeExclusion[];
    truncated: readonly SemanticScopeExclusion[];
};

export const EXECUTION_STATES = ['completed', 'partial', 'unavailable', 'cancelled', 'skipped'] as const;
export type SemanticExecutionState = (typeof EXECUTION_STATES)[number];

export const PUBLICATION_STATES = ['not_requested', 'published', 'stale', 'failed'] as const;
export type SemanticPublicationState = (typeof PUBLICATION_STATES)[number];

/** Bounded operator-facing wording. A run may never summarize as safe, approved, or all clear. */
export function assertAdvisoryWording(text: string): void {
    const forbidden = /\b(all clear|approved|verified correct|safe to merge|no risk)\b/iu;
    if (forbidden.test(text)) {
        refuse('unsupported_scope', `summary wording claims more than advice: ${text}`);
    }
}
