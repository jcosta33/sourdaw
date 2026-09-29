/**
 * The candidate-finding contract: the shape one finding has, and how untrusted input becomes it.
 *
 * Kept apart from the verification run that consumes it so the request-shaping and fitting in
 * `verify.ts` stay inside their own size ceilings without weakening the parse.
 */

import { assertLineRange, isEvidenceSide, refuse, type EvidenceReference } from './contracts.ts';

export type CandidateFindingEvidence = {
    readonly path: string;
    readonly side: EvidenceReference['side'];
    /** The range the finding is about. A finding that names no range asks about the whole file. */
    readonly startLine: number;
    readonly endLine: number;
};

export type CandidateFinding = {
    readonly findingId: string;
    readonly headSha: string;
    readonly claim: string;
    readonly allegedFailureInputOrState?: string;
    readonly expectedBehavior: string;
    readonly allegedObservedBehavior?: string;
    readonly evidenceReferences: readonly CandidateFindingEvidence[];
    /** Reported observations and verified execution evidence are kept distinct. */
    readonly reproductionReferences?: readonly {
        readonly path: string;
        readonly note: string;
        readonly verifiedExecution: boolean;
    }[];
    readonly claimedImpactCategory?: string;
};

/** The same shape while it is being assembled field by field from untrusted input. */
type MutableCandidateFinding = {
    findingId: string;
    headSha: string;
    claim: string;
    expectedBehavior: string;
    evidenceReferences: CandidateFindingEvidence[];
    allegedFailureInputOrState?: string;
    allegedObservedBehavior?: string;
    reproductionReferences?: { path: string; note: string; verifiedExecution: boolean }[];
    claimedImpactCategory?: string;
};

export function parseCandidateFindings(value: unknown, label: string): CandidateFinding[] {
    if (!Array.isArray(value)) {
        refuse('unsupported_scope', `${label} must be an array of candidate findings`);
    }
    return value.map((entry, index) => {
        const at = `${label}[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            refuse('unsupported_scope', `${at} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.findingId !== 'string' || record.findingId.trim() === '') {
            refuse('unsupported_scope', `${at}.findingId must be a non-empty string`);
        }
        if (typeof record.headSha !== 'string' || record.headSha.trim() === '') {
            refuse('unsupported_scope', `${at}.headSha must be a non-empty string`);
        }
        if (typeof record.claim !== 'string' || record.claim.trim() === '') {
            refuse('unsupported_scope', `${at}.claim must be a non-empty string`);
        }
        if (typeof record.expectedBehavior !== 'string' || record.expectedBehavior.trim() === '') {
            refuse('unsupported_scope', `${at}.expectedBehavior must be a non-empty string`);
        }
        if (!Array.isArray(record.evidenceReferences)) {
            refuse('unsupported_scope', `${at}.evidenceReferences must be an array`);
        }
        const evidenceReferences = (record.evidenceReferences as unknown[]).map((reference, referenceIndex) => {
            const refLabel = `${at}.evidenceReferences[${String(referenceIndex)}]`;
            if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) {
                refuse('unsupported_scope', `${refLabel} must be an object`);
            }
            const ref = reference as Record<string, unknown>;
            const path = ref.path;
            const side = ref.side;
            if (typeof path !== 'string' || path.trim() === '') {
                refuse('unsupported_scope', `${refLabel}.path must be a non-empty string`);
            }
            if (!isEvidenceSide(side)) {
                refuse('unsupported_scope', `${refLabel}.side must be before, after, or context`);
            }
            // The caller named the range it is asking about, and dropping the bounds sent the whole
            // file: a finding about lines 10-20 egressed all of it and was assessed over a scope
            // wider than the one it named.
            const startLine = ref.startLine;
            const endLine = ref.endLine;
            if (startLine === undefined || endLine === undefined) {
                refuse('unsupported_scope', `${refLabel} must name startLine and endLine`);
            }
            // A non-numeric bound is the caller's malformed scope, so it is refused here rather than
            // falling through to `assertLineRange`, which files a non-safe-integer under
            // `context_collection_failed` and would make this `unsupported_scope` message unreachable.
            if (typeof startLine !== 'number' || typeof endLine !== 'number') {
                refuse('unsupported_scope', `${refLabel} must name a numeric startLine and endLine`);
            }
            assertLineRange(startLine, endLine, refLabel);
            return { path, side, startLine, endLine };
        });
        if (evidenceReferences.length === 0) {
            refuse('unsupported_scope', `${at}.evidenceReferences must not be empty`);
        }
        const finding: MutableCandidateFinding = {
            findingId: record.findingId,
            headSha: record.headSha,
            claim: record.claim,
            expectedBehavior: record.expectedBehavior,
            evidenceReferences,
        };
        if (typeof record.allegedFailureInputOrState === 'string') {
            finding.allegedFailureInputOrState = record.allegedFailureInputOrState;
        }
        if (typeof record.allegedObservedBehavior === 'string') {
            finding.allegedObservedBehavior = record.allegedObservedBehavior;
        }
        if (Array.isArray(record.reproductionReferences)) {
            finding.reproductionReferences = (record.reproductionReferences as unknown[]).map(
                (entry, referenceIndex) => {
                    const refLabel = `${at}.reproductionReferences[${String(referenceIndex)}]`;
                    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
                        refuse('unsupported_scope', `${refLabel} must be an object`);
                    }
                    const ref = entry as Record<string, unknown>;
                    const path = ref.path;
                    if (typeof path !== 'string' || path.trim() === '') {
                        refuse('unsupported_scope', `${refLabel}.path must be a non-empty string`);
                    }
                    return {
                        path,
                        note: typeof ref.note === 'string' ? ref.note : '',
                        verifiedExecution: ref.verifiedExecution === true,
                    };
                }
            );
        }
        if (typeof record.claimedImpactCategory === 'string') {
            finding.claimedImpactCategory = record.claimedImpactCategory;
        }
        return finding;
    });
}

/** A finding bound to another head is refused: its assessment cannot be current advice. */
export function assertFindingsBoundToHead(findings: readonly CandidateFinding[], headSha: string): void {
    for (const finding of findings) {
        if (finding.headSha !== headSha) {
            refuse('stale_context', `finding ${finding.findingId} is bound to head ${finding.headSha}, not ${headSha}`);
        }
    }
}

/**
 * Every finding needs its own identity. A verify run keys its assessments and its omissions by finding
 * id, so two findings under one id collapse into one record the report cannot tell apart — and, because
 * the unassessed list holds one entry per key, a run over two evidence-less findings that share an id
 * would produce a report the validator refuses. Refused here, before any provider call, so a malformed
 * submission costs nothing and can never become a report the pipeline refuses to write.
 */
export function assertFindingIdsAreDistinct(findings: readonly CandidateFinding[]): void {
    const seen = new Set<string>();
    for (const finding of findings) {
        if (seen.has(finding.findingId)) {
            refuse(
                'unsupported_scope',
                `finding id ${finding.findingId} appears more than once; a verify run keys its records by finding id`
            );
        }
        seen.add(finding.findingId);
    }
}
