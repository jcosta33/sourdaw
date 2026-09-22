/**
 * Parsing and shape contracts for the review and acceptance documents
 * (`review.json` / `acceptance.json`) posted by `review:publish` and
 * `review:accept`. Extracted from `publishReview.ts` so the publication
 * machinery and the document contract evolve independently.
 */
import { composeReviewCommentBody, fail, type ReviewCommentContent } from './prContract.ts';
import { assertReviewDocumentFormat, parseApprovalEvidence, renderLegacyApprovalBody } from './reviewApprovalFormat.ts';

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES';

export type ReviewComment = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    defect: string;
    consequence: string;
    done: string;
};

export type ApprovalEvidence = {
    headSha: string;
    claims: { observable: string; verification: string; observed: string }[];
};

/**
 * The orchestrator's delivery authorization (#3376, spec #3367 AC-005): a distinct authorization
 * bound to the current head (through the document's evidence), the durable evidence-manifest
 * digest, the reviewer App's approval review id, the observed unresolved-thread count, and the
 * delivery intent. Acceptance-only: a review document carrying it is refused.
 */
export type DeliveryAuthorization = {
    intent: 'deliver';
    approvalReviewId: number;
    unresolvedThreads: number;
    evidenceManifestDigest: string;
};

export type AcceptanceDocument = ReviewDocument;

export type ReviewDocument = {
    format?: 'compact-v1';
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
    evidence?: ApprovalEvidence;
    /**
     * The model that performed the review stance, in the same token form
     * `lane:open --model` records (e.g. `glm-5.3`, `glm-5.3-flash`). Required
     * on fresh review publications so `review:publish` can enforce the
     * reviewer-diversity rule: the reviewer model must differ from the PR's
     * authoring-model label when the two are comparable.
     */
    reviewerModel?: string;
    /**
     * Present only when the reviewer model equals an authoring model because no
     * other harness model was available (the contract's otherwise-reuse arm):
     * one non-empty line naming what was unavailable. Its presence is the
     * deliberate fallback assertion, and the published body must still name the
     * reviewer model so the deviation is recorded in the review itself.
     */
    modelExhaustion?: string;
    /**
     * Acceptance-only delivery authorization: `parseAcceptanceDocument` sets it from the
     * `authorization` block, and `parseReviewDocument` refuses that key, so a review document
     * never carries it. Absent on legacy acceptance bundles with no evidence manifest to bind.
     */
    authorization?: DeliveryAuthorization;
};

function assertReviewDocumentCarriesNoAuthorization(record: Record<string, unknown>): void {
    if ('authorization' in record && record.authorization !== undefined) {
        fail('review.json must not carry authorization; delivery authorization is acceptance-only');
    }
}

export function parseReviewDocument(value: unknown): ReviewDocument {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('review.json must be an object');
    }
    const record = value as Record<string, unknown>;
    assertReviewDocumentCarriesNoAuthorization(record);
    assertReviewDocumentFormat(record);
    if (record.event !== 'APPROVE' && record.event !== 'REQUEST_CHANGES') {
        fail('review.json event must be APPROVE or REQUEST_CHANGES');
    }
    const rawComments = commentsArray(record.comments);
    if (record.event === 'APPROVE' && rawComments.length > 0) {
        fail('APPROVE must carry no comments; an inline comment opens a thread that blocks the merge');
    }
    const comments = parseCommentEntries(rawComments);
    const body = typeof record.body === 'string' ? record.body : '';
    if (record.event === 'REQUEST_CHANGES') {
        if (comments.length === 0) {
            fail('REQUEST_CHANGES requires comments');
        }
        if (body.trim() === '') {
            fail('REQUEST_CHANGES requires a top-level body');
        }
    }
    if (record.event === 'APPROVE' && body.trim() === '') {
        fail('APPROVE requires a body stating what was attacked and held');
    }
    const declaredModel = extractDeclaredModelFields(record);
    if ('evidence' in record && record.evidence !== undefined) {
        if (record.event !== 'APPROVE') {
            fail('REQUEST_CHANGES must not carry approval evidence');
        }
        const evidence = parseApprovalEvidence(record.evidence);
        if (record.format === 'compact-v1') {
            return { format: record.format, event: record.event, body, comments, evidence, ...declaredModel };
        }
        return {
            event: record.event,
            body: renderLegacyApprovalBody(body, evidence),
            comments,
            evidence,
            ...declaredModel,
        };
    }
    if (record.format === 'compact-v1') {
        fail('compact-v1 requires APPROVE with evidence');
    }
    return { event: record.event, body, comments, ...declaredModel };
}

/**
 * The optional model fields, omitted entirely when absent: JSON cannot carry `undefined`, and
 * callers (and spec fixtures) distinguish "document declares no model" from a set value by key
 * presence.
 */
function extractDeclaredModelFields(
    record: Record<string, unknown>
): Partial<Pick<ReviewDocument, 'reviewerModel' | 'modelExhaustion'>> {
    const fields: Partial<Pick<ReviewDocument, 'reviewerModel' | 'modelExhaustion'>> = {};
    if (typeof record.reviewerModel === 'string') {
        fields.reviewerModel = record.reviewerModel;
    }
    if (record.modelExhaustion !== undefined) {
        if (typeof record.modelExhaustion !== 'string') {
            fail('review.json modelExhaustion must be a string');
        }
        const value = record.modelExhaustion.trim();
        // The repo's single-line convention (evidenceLine) rejects \r and the Unicode line
        // separators too, not just \n.
        if (value === '' || /[\r\n\u2028\u2029]/u.test(value)) {
            fail(
                'review.json modelExhaustion must be one non-empty line naming what made every other model unavailable'
            );
        }
        fields.modelExhaustion = value;
    }
    return fields;
}

export function assertPublicationEvidence(document: ReviewDocument, head: string): void {
    if (document.event === 'APPROVE' && document.evidence === undefined) {
        fail('new APPROVE publication requires evidence');
    }
    if (document.event === 'APPROVE' && document.format !== 'compact-v1') {
        fail('new APPROVE publication requires format: compact-v1');
    }
    if (document.evidence !== undefined && document.evidence.headSha !== head) {
        fail('approval evidence.headSha does not match the pull-request head');
    }
}

export function parseAcceptanceDocument(value: unknown): AcceptanceDocument {
    let stripped = value;
    let authorization: DeliveryAuthorization | undefined;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (record.authorization !== undefined) {
            authorization = parseDeliveryAuthorization(record.authorization);
            const { authorization: _authorization, ...rest } = record;
            stripped = rest;
        }
    }
    const document = parseReviewDocument(stripped);
    if (document.event !== 'APPROVE') {
        fail('acceptance.json must APPROVE');
    }
    let accepted: AcceptanceDocument = document;
    if (document.format !== 'compact-v1' && !document.body.startsWith(`${ACCEPTANCE_ATTRIBUTION}\n\n`)) {
        accepted = { ...document, body: `${ACCEPTANCE_ATTRIBUTION}\n\n${document.body}` };
    }
    return authorization === undefined ? accepted : { ...accepted, authorization };
}

const ACCEPTANCE_ATTRIBUTION = 'Orchestrator acceptance on behalf of jcosta33';

function parseDeliveryAuthorization(value: unknown): DeliveryAuthorization {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('acceptance.json authorization must be an object');
    }
    const record = value as Record<string, unknown>;
    if (record.intent !== 'deliver') {
        fail("acceptance.json authorization.intent must be 'deliver'");
    }
    const approvalReviewId = record.approvalReviewId;
    if (typeof approvalReviewId !== 'number' || !Number.isSafeInteger(approvalReviewId) || approvalReviewId <= 0) {
        fail('acceptance.json authorization.approvalReviewId must be a positive safe integer');
    }
    const unresolvedThreads = record.unresolvedThreads;
    if (typeof unresolvedThreads !== 'number' || !Number.isSafeInteger(unresolvedThreads) || unresolvedThreads < 0) {
        fail('acceptance.json authorization.unresolvedThreads must be a non-negative safe integer');
    }
    const evidenceManifestDigest = record.evidenceManifestDigest;
    if (typeof evidenceManifestDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(evidenceManifestDigest)) {
        fail('acceptance.json authorization.evidenceManifestDigest must be a sha256 hex digest');
    }
    return { intent: 'deliver', approvalReviewId, unresolvedThreads, evidenceManifestDigest };
}

function commentsArray(value: unknown): unknown[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        fail('review.json comments must be an array');
    }
    return value;
}

/**
 * The one place `defect` / `consequence` / `done` are still `unknown`: everything upstream of this
 * function reads raw JSON, and everything downstream trusts `ReviewCommentContent`. Each `typeof`
 * check below narrows a genuinely unknown value, unlike a check written against an input already
 * typed `string` — that version compiles clean but is unreachable, and an "unnecessary condition"
 * cleanup would delete it as dead code with nothing to object. Composing through
 * `composeReviewCommentBody` here, rather than after returning, keeps the byte-ceiling and format
 * failures for this comment's fields naming this comment's index too.
 */
function parseReviewCommentContent(
    fields: { defect: unknown; consequence: unknown; done: unknown },
    index: number
): ReviewCommentContent {
    const { defect, consequence, done } = fields;
    if (typeof defect !== 'string') {
        fail(`review.json comments[${index}] defect is invalid`);
    }
    if (typeof consequence !== 'string') {
        fail(`review.json comments[${index}] consequence is invalid`);
    }
    if (typeof done !== 'string') {
        fail(`review.json comments[${index}] done is invalid`);
    }
    const content: ReviewCommentContent = { defect, consequence, done };
    composeReviewCommentBody(content, `review.json comments[${index}]`);
    return content;
}

function parseCommentEntries(entries: unknown[]): ReviewComment[] {
    return entries.map((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`review.json comments[${index}] must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if ('body' in record) {
            fail(`review.json comments[${index}] uses body; supply defect, consequence, and done instead`);
        }
        const path = record.path;
        const line = record.line;
        const side = record.side;
        if (typeof path !== 'string' || path === '') {
            fail(`review.json comments[${index}] path is invalid`);
        }
        if (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0) {
            fail(`review.json comments[${index}] line is invalid`);
        }
        if (side !== 'LEFT' && side !== 'RIGHT') {
            fail(`review.json comments[${index}] side must be LEFT or RIGHT`);
        }
        const content = parseReviewCommentContent(
            { defect: record.defect, consequence: record.consequence, done: record.done },
            index
        );
        return { path, line, side, ...content };
    });
}
