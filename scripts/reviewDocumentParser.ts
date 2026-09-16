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
};

export function parseReviewDocument(value: unknown): ReviewDocument {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('review.json must be an object');
    }
    const record = value as Record<string, unknown>;
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
    const reviewerModel = extractReviewerModel(record);
    // Omit the key entirely when absent: JSON cannot carry `undefined`, and callers
    // (and spec fixtures) distinguish "document declares no model" from a set value
    // by key presence.
    const declaredModel = reviewerModel === undefined ? {} : { reviewerModel };
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

function extractReviewerModel(record: Record<string, unknown>): string | undefined {
    return typeof record.reviewerModel === 'string' ? record.reviewerModel : undefined;
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

export function parseAcceptanceDocument(value: unknown): ReviewDocument {
    const document = parseReviewDocument(value);
    if (document.event !== 'APPROVE') {
        fail('acceptance.json must APPROVE');
    }
    if (document.format === 'compact-v1') {
        return document;
    }
    const attribution = 'Orchestrator acceptance on behalf of jcosta33';
    return {
        ...document,
        body: document.body.startsWith(`${attribution}\n\n`) ? document.body : `${attribution}\n\n${document.body}`,
    };
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
