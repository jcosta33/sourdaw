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

/**
 * A missing heading and an empty section are two different failures, so they are diagnosed in two
 * separate passes and never share a message. Deriving one section's end from the *next* heading's
 * position — the only way to know where its content stops — means an absent later heading makes the
 * current section look unterminated. Judging presence first, across every required heading, is what
 * keeps that from being reported as the preceding section being empty: a body whose How-to-test
 * heading was never written is missing How-to-test, not missing a What-does-this-do section that is
 * sitting right there, full.
 */
export function assertPullRequestBody(body: string, label: string): void {
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
}

export const ISSUE_NUMBER_PATTERN = /^[1-9][0-9]*$/;

export const NO_RELATED_TICKETS = 'None.';

export type IssueRelationship = 'closes' | 'relates';

const CLOSING_REFERENCE_PATTERN =
    /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?):?\s+(?:#([1-9][0-9]*)|([\w.-]+\/[\w.-]+)#([1-9][0-9]*))\b/gi;
const CLOSING_RELATIONSHIP_PATTERN =
    /^(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?):?\s+(?:#([1-9][0-9]*)|([\w.-]+\/[\w.-]+)#([1-9][0-9]*))$/i;
const RELATED_RELATIONSHIP_PATTERN = /^Related #([1-9][0-9]*)$/;

type ClosingReference = { issue: string; repository?: string };
type IssueReference = ClosingReference & { label: 'Closes' | 'Related' };

function isExpectedClosingReference(
    reference: ClosingReference,
    issue: number,
    repository: string | undefined
): boolean {
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
    const references = [...body.matchAll(CLOSING_REFERENCE_PATTERN)].map<ClosingReference>((match) =>
        match[1] === undefined ? { repository: match[2], issue: match[3] ?? '' } : { issue: match[1] }
    );
    const expected = relationship === 'closes' ? issue : undefined;
    if (
        expected === undefined
            ? references.length > 0
            : references.length !== 1 ||
              references[0] === undefined ||
              !isExpectedClosingReference(references[0], expected, repository)
    ) {
        fail('pull-request body contains unexpected issue-closing references');
    }
}

export function issueRelationshipFromBody(
    body: string,
    issue: number | undefined,
    repository?: string
): IssueRelationship | undefined {
    const heading = REQUIRED_BODY_HEADINGS.at(-1);
    const headingIndex = heading === undefined ? -1 : body.indexOf(heading);
    if (heading === undefined || headingIndex < 0 || headingIndex !== body.lastIndexOf(heading)) {
        fail('pull-request body must contain exactly one Related tickets section');
    }
    const lines = body
        .slice(headingIndex + heading.length)
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
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
    const existing = relationships[0];
    if (
        relationships.length !== 1 ||
        existing === undefined ||
        existing.issue !== String(issue) ||
        (existing.repository !== undefined &&
            (repository === undefined || existing.repository.toLowerCase() !== repository.toLowerCase())) ||
        lines.includes(NO_RELATED_TICKETS)
    ) {
        fail(`pull-request body must contain exactly one relationship to #${issue}`);
    }
    const relationship = existing.label === 'Closes' ? 'closes' : 'relates';
    assertIssueClosingReferences(body, issue, relationship, repository);
    return relationship;
}

export function composePublishBody(
    issue: number | undefined,
    subject: string,
    relationship: IssueRelationship = 'closes'
): string {
    const relatedTickets =
        issue === undefined ? NO_RELATED_TICKETS : `${relationship === 'closes' ? 'Closes' : 'Related'} #${issue}`;
    const body = `### 🎯 What does this PR do?
${subject}

### 🧪 How to test
pnpm test:run on the named spec files in this change.

### 🖼️ Screenshots
None.

### 📌 Related tickets & additional notes
${relatedTickets}
`;
    assertPullRequestBody(body, 'pull-request body');
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

export function assertReviewCommentBody(body: string): void {
    const trimmed = body.trim();
    if (trimmed === '') {
        fail('review comment is empty');
    }
    if (trimmed !== body || trimmed.includes('\n')) {
        fail('review comment must be one paragraph');
    }
    const sentences = trimmed.split(/(?<=\.)\s+/).filter((part) => part !== '');
    if (sentences.length < 3) {
        fail('review comment must state defect, consequence, and required outcome');
    }
}
