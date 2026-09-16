import { createHash } from 'node:crypto';

import { fail } from './prContract.ts';

import type { ApprovalEvidence, ReviewDocument } from './publishReview.ts';

export function assertReviewDocumentFormat(record: Record<string, unknown>): void {
    if ('format' in record && record.format !== 'compact-v1') {
        fail('review.json format must be compact-v1 when present');
    }
}

export function renderLegacyApprovalBody(body: string, evidence: ApprovalEvidence): string {
    const appendix = `\n\nVerification for ${evidence.headSha}\n\n${evidence.claims
        .map((claim) => `Expected: ${claim.observable}\nCheck: ${claim.verification}\nObserved: ${claim.observed}`)
        .join('\n\n')}`;
    return body.endsWith(appendix) ? body : body + appendix;
}

export function renderReviewDocumentBody(document: ReviewDocument): string {
    if (document.format !== 'compact-v1') {
        return document.body;
    }
    const evidence = parseApprovalEvidence(document.evidence);
    const digest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
    const body = `${document.body}\n\nEvidence SHA-256: ${digest}`;
    const length = [...body].length;
    if (length > 600) {
        fail(`APPROVE public body is ${length} Unicode code points; maximum is 600`);
    }
    return body;
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function evidenceLine(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        value.trim() === '' ||
        value !== value.trim() ||
        /[\r\n\u2028\u2029]/u.test(value)
    ) {
        fail(`${label} must be a nonblank single-line trimmed string`);
    }
    return value;
}

export function parseApprovalEvidence(value: unknown): ApprovalEvidence {
    const record = evidenceRecord(value, 'review.json evidence');
    const headSha = evidenceLine(record.headSha, 'review.json evidence.headSha');
    if (!Array.isArray(record.claims) || record.claims.length === 0) {
        fail('review.json evidence.claims must contain at least one claim');
    }
    const claims = record.claims.map((value: unknown, index: number) => {
        const label = `review.json evidence.claims[${index}]`;
        const claim = evidenceRecord(value, label);
        return {
            observable: evidenceLine(claim.observable, `${label}.observable`),
            verification: evidenceLine(claim.verification, `${label}.verification`),
            observed: evidenceLine(claim.observed, `${label}.observed`),
        };
    });
    return { headSha, claims };
}
