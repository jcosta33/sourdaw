import { describe, expect, it } from 'vitest';

import { parseCandidateFindings } from '../candidateFindings.ts';
import { SemanticFailure, type SemanticFailureCode } from '../contracts.ts';

const LABEL = 'findings';
const HEAD_SHA = 'a'.repeat(40);

function validFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        findingId: 'finding-1',
        headSha: HEAD_SHA,
        claim: 'the claim',
        expectedBehavior: 'the expected behavior',
        evidenceReferences: [{ path: 'src/a.ts', side: 'before', startLine: 1, endLine: 2 }],
        ...overrides,
    };
}

function refusalOf(fn: () => unknown): { code: SemanticFailureCode; message: string } {
    try {
        fn();
    } catch (error) {
        expect(error).toBeInstanceOf(SemanticFailure);
        const failure = error as SemanticFailure;
        return { code: failure.code, message: failure.message };
    }
    throw new Error('expected a SemanticFailure, but nothing was thrown');
}

describe('parseCandidateFindings reproductionReferences', () => {
    it('refuses a null reproduction reference, naming its index', () => {
        const refusal = refusalOf(() =>
            parseCandidateFindings([validFinding({ reproductionReferences: [null] })], LABEL)
        );
        expect(refusal.code).toBe('unsupported_scope');
        expect(refusal.message).toBe('findings[0].reproductionReferences[0] must be an object');
    });

    it('refuses a non-object reproduction reference, naming its index', () => {
        const refusal = refusalOf(() =>
            parseCandidateFindings([validFinding({ reproductionReferences: [42] })], LABEL)
        );
        expect(refusal.code).toBe('unsupported_scope');
        expect(refusal.message).toBe('findings[0].reproductionReferences[0] must be an object');
    });

    it('refuses a reproduction reference whose path is not a non-empty string', () => {
        const refusal = refusalOf(() =>
            parseCandidateFindings([validFinding({ reproductionReferences: [{ path: 7, note: 'n' }] })], LABEL)
        );
        expect(refusal.code).toBe('unsupported_scope');
        expect(refusal.message).toBe('findings[0].reproductionReferences[0].path must be a non-empty string');
    });

    it('parses a well-formed reproduction reference without defaulting its fields', () => {
        const findings = parseCandidateFindings(
            [
                validFinding({
                    reproductionReferences: [{ path: 'scripts/x.ts', note: 'ran it', verifiedExecution: true }],
                }),
            ],
            LABEL
        );
        expect(findings[0]?.reproductionReferences).toEqual([
            { path: 'scripts/x.ts', note: 'ran it', verifiedExecution: true },
        ]);
    });
});

describe('parseCandidateFindings evidenceReferences line bounds', () => {
    function findingWithBounds(startLine: unknown, endLine: unknown): Record<string, unknown> {
        return validFinding({
            evidenceReferences: [{ path: 'src/a.ts', side: 'before', startLine, endLine }],
        });
    }

    it('refuses a non-numeric line bound as an unsupported scope naming numeric bounds', () => {
        const refusal = refusalOf(() => parseCandidateFindings([findingWithBounds('1', 2)], LABEL));
        expect(refusal.code).toBe('unsupported_scope');
        expect(refusal.message).toBe('findings[0].evidenceReferences[0] must name a numeric startLine and endLine');
    });

    it('still refuses an impossible range that starts before line 1', () => {
        const refusal = refusalOf(() => parseCandidateFindings([findingWithBounds(0, 5)], LABEL));
        expect(refusal.code).toBe('context_collection_failed');
        expect(refusal.message).toBe('findings[0].evidenceReferences[0] has an impossible source range 0-5');
    });

    it('still refuses a range whose end precedes its start', () => {
        const refusal = refusalOf(() => parseCandidateFindings([findingWithBounds(5, 3)], LABEL));
        expect(refusal.code).toBe('context_collection_failed');
        expect(refusal.message).toBe('findings[0].evidenceReferences[0] has an impossible source range 5-3');
    });

    it('still refuses a non-safe-integer bound', () => {
        const refusal = refusalOf(() => parseCandidateFindings([findingWithBounds(1.5, 2)], LABEL));
        expect(refusal.code).toBe('context_collection_failed');
        expect(refusal.message).toBe('findings[0].evidenceReferences[0] line bounds must be safe integers');
    });
});
