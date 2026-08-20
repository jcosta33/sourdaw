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
    /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?)\s+(?:#([1-9][0-9]*)|[\w.-]+\/[\w.-]+#([1-9][0-9]*)|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/([1-9][0-9]*))\b/gi;

function assertIssueClosingReferences(
    body: string,
    issue: number | undefined,
    relationship: IssueRelationship | undefined
): void {
    const references = [...body.matchAll(CLOSING_REFERENCE_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3]);
    const expected = relationship === 'closes' && issue !== undefined ? String(issue) : undefined;
    if (expected === undefined ? references.length > 0 : references.length !== 1 || references[0] !== expected) {
        fail('pull-request body contains unexpected issue-closing references');
    }
}

export function issueRelationshipFromBody(body: string, issue: number | undefined): IssueRelationship | undefined {
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
    const relationships = lines.flatMap((line) => {
        const match = /^(Closes|Related) #([1-9][0-9]*)$/.exec(line);
        return match === null ? [] : [{ label: match[1], issue: match[2] }];
    });
    if (issue === undefined) {
        if (lines[0] !== NO_RELATED_TICKETS || relationships.length > 0) {
            fail('issueless pull-request body must start its Related tickets section with None.');
        }
        assertIssueClosingReferences(body, issue, undefined);
        return undefined;
    }
    if (relationships.length !== 1 || relationships[0]?.issue !== String(issue) || lines.includes(NO_RELATED_TICKETS)) {
        fail(`pull-request body must contain exactly one relationship to #${issue}`);
    }
    const relationship = relationships[0].label === 'Closes' ? 'closes' : 'relates';
    assertIssueClosingReferences(body, issue, relationship);
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
