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

export type RequiredBodyHeading = (typeof REQUIRED_BODY_HEADINGS)[number];

/** Where each required heading sits in a body. A negative index means the heading is absent. */
type LocatedSection = { heading: RequiredBodyHeading; index: number };

function locateRequiredSections(body: string): LocatedSection[] {
    return REQUIRED_BODY_HEADINGS.map((heading) => ({ heading, index: body.indexOf(heading) }));
}

/**
 * A missing heading and an empty section are two different failures, so they are diagnosed in two
 * separate passes and never share a message. Deriving one section's end from the *next* heading's
 * position — the only way to know where its content stops — means an absent later heading makes the
 * current section look unterminated. Judging presence first, across every required heading, is what
 * keeps that from being reported as the preceding section being empty: a body whose Screenshots
 * heading was never written is missing Screenshots, not missing a How-to-test section that is
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
    for (const [position, section] of sections.entries()) {
        const contentStart = section.index + section.heading.length;
        if (body.includes(section.heading, contentStart)) {
            fail(`${label} duplicates: ${section.heading}`);
        }
        const contentEnd = sections[position + 1]?.index ?? body.length;
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

/**
 * The content a missing heading may be added with. A completion must never invent authored prose, so
 * a heading only appears here when the template's own answer for "nothing to say" is a statement of
 * absence rather than a summary somebody has to write. Screenshots is that heading: every body
 * `composePublishBody` writes already reads `None.` under it, so adding it to a body that has no
 * screenshots states exactly what is true of that pull request.
 *
 * Related tickets is deliberately absent even though `None.` is its filler too. There the word
 * asserts that the pull request references no issue, and a body written before a heading existed may
 * carry its `Closes #<issue>` as prose further up; writing `None.` underneath would contradict its
 * author rather than complete them.
 */
export const LEGACY_SECTION_FILLERS: Partial<Record<RequiredBodyHeading, string>> = {
    '### 🖼️ Screenshots': 'None.',
};

function withTrailingBlankLine(text: string): string {
    const trailing = /\n*$/.exec(text)?.[0].length ?? 0;
    return text === '' ? text : `${text}${'\n'.repeat(Math.max(0, 2 - trailing))}`;
}

/**
 * Brings a body written against an older template up to the current one, or returns `undefined` when
 * it already carries every required heading. The template gains headings over time and an existing
 * pull request's body is the only copy of what its author wrote, so this only ever *adds*: existing
 * bytes are copied through untouched, a heading is inserted immediately before the first required
 * heading that follows it, and nothing is reordered, shortened or replaced.
 *
 * It refuses rather than guesses. A body whose existing headings are out of order or repeated cannot
 * take an insertion without rewriting them; a missing heading with no honest filler is a section only
 * its author can write; and a completion that would push the body past the byte ceiling has no
 * silent remedy, because trimming to make room is exactly the rewriting this must not do. Every one
 * of those is louder than the alternative, which is a pull request that can never be delivered and
 * no message saying why.
 */
export function repairLegacyBody(body: string, label: string): string | undefined {
    const sections = locateRequiredSections(body);
    if (sections.every((section) => section.index >= 0)) {
        return undefined;
    }
    const present = sections.filter((section) => section.index >= 0);
    for (const [position, section] of present.entries()) {
        const previous = present[position - 1];
        if (previous !== undefined && section.index <= previous.index) {
            fail(`${label} carries its template headings out of order: completing it would reorder them`);
        }
        if (body.includes(section.heading, section.index + section.heading.length)) {
            fail(`${label} repeats ${section.heading}: completing it would rewrite that section`);
        }
    }
    const added: string[] = [];
    let repaired = '';
    let cursor = 0;
    const append = (text: string): void => {
        if (text === '') {
            return;
        }
        repaired = repaired === '' ? text : `${withTrailingBlankLine(repaired)}${text}`;
    };
    for (const [position, section] of sections.entries()) {
        if (section.index >= 0) {
            continue;
        }
        const filler = LEGACY_SECTION_FILLERS[section.heading];
        if (filler === undefined) {
            fail(`${label} is missing ${section.heading}, and only its author can write that section`);
        }
        const insertAt = sections.slice(position + 1).find((later) => later.index >= 0)?.index ?? body.length;
        append(body.slice(cursor, insertAt));
        append(`${section.heading}\n${filler}\n`);
        added.push(section.heading);
        cursor = insertAt;
    }
    append(body.slice(cursor));
    if (Buffer.byteLength(repaired, 'utf8') > PULL_REQUEST_BODY_BYTE_LIMIT) {
        fail(
            `${label} cannot be completed within ${PULL_REQUEST_BODY_BYTE_LIMIT} bytes: adding ${added.join(', ')} would overflow it, and no existing section may be shortened to make room`
        );
    }
    assertPullRequestBody(repaired, label);
    return repaired;
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
