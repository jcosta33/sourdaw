export const TITLE_PATTERN = /^(?:feat|fix|chore|docs|test|refactor|perf|build|ci)(?:\([^)]+\))?!?: .+/;

export const REQUIRED_BODY_HEADINGS = [
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

export function assertPullRequestBody(body: string, label: string): void {
    if (Buffer.byteLength(body, 'utf8') > PULL_REQUEST_BODY_BYTE_LIMIT) {
        fail(`${label} exceeds 4000 bytes`);
    }
    let previousHeading = -1;
    for (let index = 0; index < REQUIRED_BODY_HEADINGS.length; index += 1) {
        const heading = REQUIRED_BODY_HEADINGS[index];
        if (heading === undefined) {
            continue;
        }
        const headingIndex = body.indexOf(heading);
        if (headingIndex < 0) {
            fail(`${label} is missing: ${heading}`);
        }
        if (headingIndex <= previousHeading) {
            fail(`${label} sections are out of order`);
        }
        if (body.includes(heading, headingIndex + heading.length)) {
            fail(`${label} duplicates: ${heading}`);
        }
        const nextHeading = REQUIRED_BODY_HEADINGS[index + 1];
        const contentEnd =
            nextHeading === undefined ? body.length : body.indexOf(nextHeading, headingIndex + heading.length);
        if (contentEnd < 0 || body.slice(headingIndex + heading.length, contentEnd).trim() === '') {
            fail(`${label} section is empty: ${heading}`);
        }
        previousHeading = headingIndex;
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
