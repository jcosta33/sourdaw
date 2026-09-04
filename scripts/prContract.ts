export const TITLE_PATTERN = /^(?:feat|fix|chore|docs|test|refactor|perf|build|ci)(?:\([^)]+\))?!?: .+/;

/**
 * The headings a body must carry to merge. Screenshots is deliberately not among them: its
 * canonical content is the literal `None.` that `composePublishBody` writes into every body, and a
 * section whose required content states that it has nothing to say gates nothing. It remains in the
 * template and is still offered and written — it is simply not a merge gate.
 */
export const REQUIRED_BODY_HEADINGS = [
    '### 🎯 What does this PR do?',
    '### 🧪 How to test',
    '### 📌 Related tickets & additional notes',
] as const;

/**
 * Every heading the template defines, in template order. This bounds where a section's content
 * *ends*, which is a different question from which headings a body must carry. An offered heading
 * still terminates the section above it: without that, dropping Screenshots from the required list
 * would silently fold its block into the How-to-test span, and an empty How-to-test section
 * followed by `### 🖼️ Screenshots\nNone.` would read as full and pass the emptiness check.
 */
const TEMPLATE_BODY_HEADINGS = [
    '### 🎯 What does this PR do?',
    '### 🧪 How to test',
    '### 🖼️ Screenshots',
    '### 📌 Related tickets & additional notes',
] as const;

export const PULL_REQUEST_BODY_BYTE_LIMIT = 4_000;

export function fail(message: string): never {
    throw new Error(message);
}

export function assertConventionalSubject(subject: string, label: string): void {
    if (!TITLE_PATTERN.test(subject)) {
        fail(`${label} is not conventional`);
    }
}

export type RequiredBodyHeading = (typeof REQUIRED_BODY_HEADINGS)[number];

/** Where each required heading sits in a body. A negative index means the heading is absent. */
type LocatedSection = { heading: RequiredBodyHeading; index: number };

function locateRequiredSections(body: string): LocatedSection[] {
    return REQUIRED_BODY_HEADINGS.map((heading) => ({ heading, index: body.indexOf(heading) }));
}

/**
 * Where a section's content stops: the next template heading that actually appears after it,
 * required or merely offered, or the end of the body when none does.
 */
function sectionContentEnd(body: string, contentStart: number): number {
    const boundaries = TEMPLATE_BODY_HEADINGS.map((heading) => body.indexOf(heading, contentStart)).filter(
        (index) => index >= 0
    );
    return boundaries.length === 0 ? body.length : Math.min(...boundaries);
}

function requiredSectionFromBody(body: string, heading: RequiredBodyHeading): string {
    const headingIndex = body.indexOf(heading);
    if (headingIndex < 0) {
        fail(`pull-request body is missing: ${heading}`);
    }
    const contentStart = headingIndex + heading.length;
    if (body.includes(heading, contentStart)) {
        fail(`pull-request body duplicates: ${heading}`);
    }
    const content = body.slice(contentStart, sectionContentEnd(body, contentStart)).trim();
    if (content === '') {
        fail(`pull-request body section is empty: ${heading}`);
    }
    return content;
}

export function whatFromBody(body: string): string {
    return requiredSectionFromBody(body, REQUIRED_BODY_HEADINGS[0]);
}

export function howToTestFromBody(body: string): string {
    return requiredSectionFromBody(body, REQUIRED_BODY_HEADINGS[1]);
}

function foldedPhrase(text: string): string {
    return text.trim().replaceAll(/\s+/g, ' ').toLowerCase();
}

function conventionalRemainder(title: string): string {
    const separator = title.indexOf(': ');
    return separator < 0 ? title : title.slice(separator + 2);
}

function whatRepeatsTitle(what: string, title: string): boolean {
    const foldedWhat = foldedPhrase(what);
    return foldedWhat === foldedPhrase(title) || foldedWhat === foldedPhrase(conventionalRemainder(title));
}

/**
 * A missing heading and an empty section are two different failures, so they are diagnosed in two
 * separate passes and never share a message. Deriving one section's end from the *next* heading's
 * position — the only way to know where its content stops — means an absent later heading makes the
 * current section look unterminated. Judging presence first, across every required heading, is what
 * keeps that from being reported as the preceding section being empty: a body whose How-to-test
 * heading was never written is missing How-to-test, not missing a What-does-this-do section that is
 * sitting right there, full.
 */
export function assertPullRequestBody(body: string, label: string, title?: string): void {
    if (Buffer.byteLength(body, 'utf8') > PULL_REQUEST_BODY_BYTE_LIMIT) {
        fail(`${label} exceeds 4000 bytes`);
    }
    const sections = locateRequiredSections(body);
    const absent = sections.find((section) => section.index < 0);
    if (absent !== undefined) {
        fail(`${label} is missing: ${absent.heading}`);
    }
    for (const [position, section] of sections.entries()) {
        const previous = sections[position - 1];
        if (previous !== undefined && section.index <= previous.index) {
            fail(`${label} sections are out of order`);
        }
    }
    for (const section of sections) {
        const contentStart = section.index + section.heading.length;
        if (body.includes(section.heading, contentStart)) {
            fail(`${label} duplicates: ${section.heading}`);
        }
        const contentEnd = sectionContentEnd(body, contentStart);
        if (body.slice(contentStart, contentEnd).trim() === '') {
            fail(`${label} section is empty: ${section.heading}`);
        }
    }
    if (title !== undefined && whatRepeatsTitle(whatFromBody(body), title)) {
        fail(`${label} What section repeats the title`);
    }
}

export const ISSUE_NUMBER_PATTERN = /^[1-9][0-9]*$/;

export const NO_RELATED_TICKETS = 'None.';

export type IssueRelationship = 'closes' | 'relates';

export type CanonicalIssueReference = {
    issue: number;
    relationship: IssueRelationship;
};

export type DeliveryReceiptPayload = {
    schemaVersion?: 1 | 2;
    pullRequest: number;
    head: string;
    bodySha256: string;
    closingIssue?: number;
    ciAdmissionMode?: 'advisory' | 'required';
    observedCiState?:
        | 'successful'
        | 'failed'
        | 'pending'
        | 'absent'
        | 'skipped'
        | 'cancelled'
        | 'unstable'
        | 'malformed'
        | 'unavailable';
};

const CLOSING_REFERENCE_PATTERN =
    /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?):?\s+(?:#([1-9][0-9]*)|([\w.-]+\/[\w.-]+)#([1-9][0-9]*))\b/gi;
const CLOSING_RELATIONSHIP_PATTERN =
    /^(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?):?\s+(?:#([1-9][0-9]*)|([\w.-]+\/[\w.-]+)#([1-9][0-9]*))$/i;
const RELATED_RELATIONSHIP_PATTERN = /^Related #([1-9][0-9]*)$/;
const CANONICAL_CLOSING_RELATIONSHIP_PATTERN = /^Closes (?:#([1-9][0-9]*)|([\w.-]+\/[\w.-]+)#([1-9][0-9]*))$/;
const DELIVERY_RECEIPT_NAMESPACE = 'sourdaw-delivery-receipt:';
const DELIVERY_RECEIPT_MARKER_PREFIX = `<!-- ${DELIVERY_RECEIPT_NAMESPACE}`;
const DELIVERY_RECEIPT_V1_PREFIX = '<!-- sourdaw-delivery-receipt:v1';
const DELIVERY_RECEIPT_V1_PATTERN =
    /^<!-- sourdaw-delivery-receipt:v1\npull-request: ([1-9][0-9]*)\nhead: ([A-Za-z0-9._-]{1,128})\nbody-sha256: ([0-9a-f]{64})\nclosing-issue: (none|[1-9][0-9]*)\n-->$/;
const DELIVERY_RECEIPT_V2_PREFIX = '<!-- sourdaw-delivery-receipt:v2';
const DELIVERY_RECEIPT_V2_PATTERN =
    /^<!-- sourdaw-delivery-receipt:v2\npull-request: ([1-9][0-9]*)\nhead: ([A-Za-z0-9._-]{1,128})\nbody-sha256: ([0-9a-f]{64})\nclosing-issue: (none|[1-9][0-9]*)(?:\nci-admission-mode: (advisory|required)(?:\nobserved-ci-state: (successful|failed|pending|absent|skipped|cancelled|unstable|malformed|unavailable))?)?\n-->$/;

type ClosingReference = { issue: string; repository?: string };
type IssueReference = ClosingReference & { label: 'Closes' | 'Related' };

function referencesIssue(reference: ClosingReference, issue: number, repository: string | undefined): boolean {
    return (
        reference.issue === String(issue) &&
        (reference.repository === undefined ||
            (repository !== undefined && reference.repository.toLowerCase() === repository.toLowerCase()))
    );
}

function assertIssueClosingReferences(
    body: string,
    issue: number | undefined,
    relationship: IssueRelationship | undefined,
    repository?: string
): void {
    const matches = [...body.matchAll(CLOSING_REFERENCE_PATTERN)];
    const expected = relationship === 'closes' ? issue : undefined;
    const unexpectedPhrases: string[] = [];
    let matchedExpected = false;

    for (const match of matches) {
        const reference: ClosingReference =
            match[1] === undefined ? { repository: match[2], issue: match[3] ?? '' } : { issue: match[1] };
        if (expected !== undefined && !matchedExpected && referencesIssue(reference, expected, repository)) {
            matchedExpected = true;
        } else {
            unexpectedPhrases.push(match[0]);
        }
    }

    if (unexpectedPhrases.length > 0 || (expected !== undefined && !matchedExpected)) {
        const phrases = unexpectedPhrases.map((phrase) => `"${phrase}"`).join(', ');
        const phraseDetail = phrases.length > 0 ? ` (${phrases})` : '';
        fail(
            `pull-request body contains unexpected issue-closing references${phraseDetail}. ` +
                'GitHub closing keywords (close, fix, resolve #<issue>) in pull-request descriptions auto-close issues on merge; ' +
                'remove the keyword from prose or rephrase.'
        );
    }
}

function relatedTicketLines(body: string): string[] {
    const heading = REQUIRED_BODY_HEADINGS.at(-1);
    const headingIndex = heading === undefined ? -1 : body.indexOf(heading);
    if (heading === undefined || headingIndex < 0 || headingIndex !== body.lastIndexOf(heading)) {
        fail('pull-request body must contain exactly one Related tickets section');
    }
    return body
        .slice(headingIndex + heading.length)
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

export function canonicalIssueReferenceFromBody(body: string, repository: string): CanonicalIssueReference | undefined {
    const lines = relatedTicketLines(body);
    if (lines[0] === NO_RELATED_TICKETS) {
        if (
            lines.some(
                (line) => CANONICAL_CLOSING_RELATIONSHIP_PATTERN.test(line) || RELATED_RELATIONSHIP_PATTERN.test(line)
            )
        ) {
            fail('pull-request body cannot combine None. with an issue relationship');
        }
        assertIssueClosingReferences(body, undefined, undefined, repository);
        return undefined;
    }

    const references = lines.flatMap<ClosingReference & { relationship: IssueRelationship }>((line) => {
        const closing = CANONICAL_CLOSING_RELATIONSHIP_PATTERN.exec(line);
        if (closing !== null) {
            return [
                {
                    relationship: 'closes',
                    repository: closing[2],
                    issue: closing[1] ?? closing[3] ?? '',
                },
            ];
        }
        const related = RELATED_RELATIONSHIP_PATTERN.exec(line);
        return related === null ? [] : [{ relationship: 'relates', issue: related[1] ?? '' }];
    });
    const reference = references[0];
    if (references.length !== 1 || reference === undefined || lines.includes(NO_RELATED_TICKETS)) {
        fail('pull-request body must contain exactly one canonical issue relationship or None.');
    }
    if (reference.repository !== undefined && reference.repository.toLowerCase() !== repository.toLowerCase()) {
        fail(`pull-request body issue relationship must target ${repository}`);
    }
    const issue = Number(reference.issue);
    if (!Number.isSafeInteger(issue) || issue <= 0) {
        fail('pull-request body issue relationship must use a safe positive integer');
    }
    assertIssueClosingReferences(body, issue, reference.relationship, repository);
    return { issue, relationship: reference.relationship };
}

export function composeDeliveryReceipt(payload: DeliveryReceiptPayload): string {
    const schemaVersion = payload.schemaVersion ?? 2;
    assertSafeIssueNumber(payload.pullRequest, 'delivery receipt pull request');
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(payload.head)) {
        fail('delivery receipt head is invalid');
    }
    if (!/^[0-9a-f]{64}$/.test(payload.bodySha256)) {
        fail('delivery receipt body digest is invalid');
    }
    if (payload.closingIssue !== undefined) {
        assertSafeIssueNumber(payload.closingIssue, 'delivery receipt closing issue');
    }

    if (schemaVersion === 1) {
        if (payload.ciAdmissionMode !== undefined || payload.observedCiState !== undefined) {
            fail('delivery receipt v1 cannot carry CI metadata');
        }
        return [
            DELIVERY_RECEIPT_V1_PREFIX,
            `pull-request: ${payload.pullRequest}`,
            `head: ${payload.head}`,
            `body-sha256: ${payload.bodySha256}`,
            `closing-issue: ${payload.closingIssue === undefined ? 'none' : String(payload.closingIssue)}`,
            '-->',
        ].join('\n');
    }

    if (payload.ciAdmissionMode === undefined && payload.observedCiState !== undefined) {
        fail('delivery receipt observed CI state requires an admission mode');
    }
    if (payload.ciAdmissionMode === 'advisory' && payload.observedCiState === undefined) {
        fail('delivery receipt advisory mode requires an observed CI state');
    }
    if (payload.ciAdmissionMode === 'required' && payload.observedCiState !== undefined) {
        fail('delivery receipt required mode cannot carry an advisory CI state');
    }

    const visibleLines = [
        `Delivery receipt for PR #${payload.pullRequest}.`,
        '',
        `- Head: \`${payload.head}\``,
        `- Pull request body SHA-256: \`${payload.bodySha256}\``,
        `- Closing issue: ${payload.closingIssue === undefined ? 'None.' : `#${payload.closingIssue}`}`,
        ...(payload.ciAdmissionMode === undefined ? [] : [`- CI admission: ${payload.ciAdmissionMode}`]),
        ...(payload.ciAdmissionMode === 'advisory' ? [`- Observed CI state: ${payload.observedCiState}`] : []),
        '',
    ];
    const hiddenLines = [
        DELIVERY_RECEIPT_V2_PREFIX,
        `pull-request: ${payload.pullRequest}`,
        `head: ${payload.head}`,
        `body-sha256: ${payload.bodySha256}`,
        `closing-issue: ${payload.closingIssue === undefined ? 'none' : String(payload.closingIssue)}`,
        ...(payload.ciAdmissionMode === undefined ? [] : [`ci-admission-mode: ${payload.ciAdmissionMode}`]),
        ...(payload.ciAdmissionMode === 'advisory' ? [`observed-ci-state: ${payload.observedCiState}`] : []),
        '-->',
    ];
    return [...visibleLines, ...hiddenLines].join('\n');
}

export function parseDeliveryReceipt(body: string): DeliveryReceiptPayload | undefined {
    if (body.startsWith(DELIVERY_RECEIPT_V1_PREFIX)) {
        const match = DELIVERY_RECEIPT_V1_PATTERN.exec(body);
        if (match === null) {
            fail('invalid delivery receipt');
        }
        const pullRequest = Number(match[1]);
        const head = match[2] ?? '';
        const bodySha256 = match[3] ?? '';
        const rawClosingIssue = match[4];
        const closingIssue = rawClosingIssue === 'none' ? undefined : Number(rawClosingIssue);
        const payload = { schemaVersion: 1 as const, pullRequest, head, bodySha256, closingIssue };
        if (composeDeliveryReceipt(payload) !== body) {
            fail('non-canonical delivery receipt');
        }
        return payload;
    }

    const reservedNamespaceIndex = body.indexOf(DELIVERY_RECEIPT_NAMESPACE);
    if (reservedNamespaceIndex < 0) {
        return undefined;
    }

    const reservedMarkerIndex = body.indexOf(DELIVERY_RECEIPT_MARKER_PREFIX);
    const receiptIndex = body.indexOf(DELIVERY_RECEIPT_V2_PREFIX);
    if (receiptIndex < 0 || reservedMarkerIndex !== receiptIndex) {
        fail('unsupported delivery receipt');
    }
    const hiddenReceipt = body.slice(receiptIndex);
    const match = DELIVERY_RECEIPT_V2_PATTERN.exec(hiddenReceipt);
    if (match === null) {
        fail('invalid delivery receipt');
    }
    const pullRequest = Number(match[1]);
    const head = match[2] ?? '';
    const bodySha256 = match[3] ?? '';
    const rawClosingIssue = match[4];
    const ciAdmissionMode = match[5] as DeliveryReceiptPayload['ciAdmissionMode'];
    const observedCiState = match[6] as DeliveryReceiptPayload['observedCiState'];
    const closingIssue = rawClosingIssue === 'none' ? undefined : Number(rawClosingIssue);
    const payload = {
        schemaVersion: 2 as const,
        pullRequest,
        head,
        bodySha256,
        closingIssue,
        ...(ciAdmissionMode === undefined ? {} : { ciAdmissionMode }),
        ...(observedCiState === undefined ? {} : { observedCiState }),
    };
    if (composeDeliveryReceipt(payload) !== body) {
        fail('non-canonical delivery receipt');
    }
    return payload;
}

function assertSafeIssueNumber(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(`${label} must be a safe positive integer`);
    }
}

/** The relationship lines that name `issue`, ignoring lines that relate the body to other issues. */
function relationshipsForIssue(
    relationships: IssueReference[],
    issue: number,
    repository: string | undefined
): IssueReference[] {
    return relationships.filter((reference) => referencesIssue(reference, issue, repository));
}

export function issueRelationshipFromBody(
    body: string,
    issue: number | undefined,
    repository?: string
): IssueRelationship | undefined {
    const lines = relatedTicketLines(body);
    const relationships = lines.flatMap<IssueReference>((line) => {
        const closing = CLOSING_RELATIONSHIP_PATTERN.exec(line);
        if (closing !== null) {
            return [
                {
                    label: 'Closes',
                    repository: closing[2],
                    issue: closing[1] ?? closing[3] ?? '',
                },
            ];
        }
        const related = RELATED_RELATIONSHIP_PATTERN.exec(line);
        return related === null ? [] : [{ label: 'Related', issue: related[1] ?? '' }];
    });
    if (issue === undefined) {
        if (lines[0] !== NO_RELATED_TICKETS || relationships.length > 0) {
            fail('issueless pull-request body must start its Related tickets section with None.');
        }
        assertIssueClosingReferences(body, issue, undefined, repository);
        return undefined;
    }
    const matching = relationshipsForIssue(relationships, issue, repository);
    const existing = matching[0];
    if (matching.length !== 1 || existing === undefined || lines.includes(NO_RELATED_TICKETS)) {
        fail(`pull-request body must contain exactly one relationship to #${issue}`);
    }
    const relationship = existing.label === 'Closes' ? 'closes' : 'relates';
    assertIssueClosingReferences(body, issue, relationship, repository);
    return relationship;
}

export function composePublishBody(
    issue: number | undefined,
    title: string,
    summary: string,
    testInstructions: string,
    relationship: IssueRelationship = 'closes'
): string {
    const what = summary.trim();
    if (what === '') {
        fail('pull-request What section is empty');
    }
    const howToTest = testInstructions.trim();
    if (howToTest === '') {
        fail('pull-request How to test instructions are empty');
    }
    const relatedTickets =
        issue === undefined ? NO_RELATED_TICKETS : `${relationship === 'closes' ? 'Closes' : 'Related'} #${issue}`;
    const body = `### 🎯 What does this PR do?
${what}

### 🧪 How to test
${howToTest}

### 🖼️ Screenshots
None.

### 📌 Related tickets & additional notes
${relatedTickets}
`;
    assertPullRequestBody(body, 'pull-request body', title);
    assertIssueClosingReferences(body, issue, issue === undefined ? undefined : relationship);
    if (issue !== undefined && !body.includes(`${relationship === 'closes' ? 'Closes' : 'Related'} #${issue}`)) {
        fail(`pull-request body is missing ${relationship === 'closes' ? 'Closes' : 'Related'} #<issue-number>`);
    }
    return body;
}

export function isIssueArgument(value: string): boolean {
    return ISSUE_NUMBER_PATTERN.test(value);
}

export function assertIssueNumber(value: string, usage: string): number {
    if (!isIssueArgument(value)) {
        fail(usage);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail(usage);
    }
    return number;
}

export function assertLaneSlug(slug: string): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        fail('lane slug must match [a-z0-9]+(?:-[a-z0-9]+)*');
    }
    if (/^[0-9]+$/.test(slug)) {
        fail('lane slug must not be purely numeric; a bare number is read as the issue number');
    }
}

export function laneBranchName(issue: number | undefined, slug: string): string {
    return issue === undefined ? `agent/${slug}` : `agent/${issue}/${slug}`;
}

/**
 * The supersession receipt. `pr:supersede` writes exactly this comment as the author bot before it
 * closes the old pull request, and `lane:remove` reads it back to tell a superseded lane from an
 * abandoned one. Both sides go through this pair, so the receipt is one contract rather than two
 * string literals that drift apart.
 */
export function supersessionCommentBody(replacement: number): string {
    return `Superseded by #${replacement}.`;
}

const SUPERSESSION_COMMENT_PATTERN = /^Superseded by #([1-9][0-9]*)\.$/;

export function supersessionReplacement(body: string): number | undefined {
    const captured = SUPERSESSION_COMMENT_PATTERN.exec(body)?.[1];
    if (captured === undefined) {
        return undefined;
    }
    const replacement = Number(captured);
    return Number.isSafeInteger(replacement) && replacement > 0 ? replacement : undefined;
}

export type ReviewCommentContent = {
    defect: string;
    consequence: string;
    done: string;
};

export const REVIEW_COMMENT_MAX_BYTES = 600;

const REVIEW_COMMENT_FIELDS = ['defect', 'consequence', 'done'] as const;

// The full ECMAScript LineTerminator set: LF, CR, U+2028 LINE SEPARATOR, U+2029 PARAGRAPH
// SEPARATOR. Written as escapes rather than the literal characters, which render as an
// invisible trap in most editors — indistinguishable from a plain space.
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

// A terminal mark followed by any number of closing quotes or brackets still ends the field: a
// quoted sentence like `It says "do X."` must not gain a second, stray period after the quote.
const TERMINAL_PUNCTUATION = /[.?!…][)\]}'"’”]*$/;

/**
 * Appends a period unless the field already ends in terminal punctuation (`.`, `?`, `!`, or `…`),
 * optionally followed by closing quotes or brackets — a question stays a question, and a field that
 * closes a quotation does not get a second period stacked after it.
 */
function normalizedReviewCommentField(value: string): string {
    return TERMINAL_PUNCTUATION.test(value) ? value : `${value}.`;
}

/**
 * A sentence count measures shape, not content: it passes three sentences of hedge and rejects one
 * precise sentence that actually says something. Three separate fields require each part — the
 * defect, its consequence, and what done looks like — to actually be present, and a byte ceiling
 * replaces the old floor: nothing here rewards padding, and nothing demands a minimum length. Each
 * field is typed as `string` because the boundary that turns unknown JSON into this shape (see
 * `parseReviewCommentContent` in `publishReview.ts`) is the one place a "not a string" guard is
 * genuinely reachable; repeating that check here would be dead code the type checker cannot tell
 * from the real thing, which is exactly what let it rot into decoration once already. `context`
 * lets a caller parsing a larger document (a numbered `review.json` comment) fold that document's
 * own location into the failure, without this function knowing anything about documents.
 */
export function composeReviewCommentBody(content: ReviewCommentContent, context = 'review comment'): string {
    for (const field of REVIEW_COMMENT_FIELDS) {
        const value = content[field];
        if (value.trim() === '') {
            fail(`${context} ${field} is empty`);
        }
        if (value.trim() !== value) {
            fail(`${context} ${field} has leading or trailing whitespace`);
        }
        if (LINE_TERMINATOR.test(value)) {
            fail(`${context} ${field} must be one line`);
        }
    }
    const body = REVIEW_COMMENT_FIELDS.map((field) => normalizedReviewCommentField(content[field])).join(' ');
    const byteLength = Buffer.byteLength(body, 'utf8');
    if (byteLength > REVIEW_COMMENT_MAX_BYTES) {
        fail(`${context} is ${byteLength} bytes, exceeding the ${REVIEW_COMMENT_MAX_BYTES}-byte limit`);
    }
    return body;
}
