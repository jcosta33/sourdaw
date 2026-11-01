import { randomUUID } from 'node:crypto';
import {
    constants,
    fstatSync,
    realpathSync,
    lstatSync,
    readdirSync,
    mkdirSync,
    openSync,
    closeSync,
    readFileSync,
    writeFileSync,
    linkSync,
    unlinkSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The conventional-commit types a change may carry. One list serves three readers: the pull-request
 * title pattern, the type segment of a lane branch, and `lane:open --type`. `style` is deliberately
 * absent from all three.
 */
export const LANE_CHANGE_TYPES = ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'build', 'ci'] as const;

export type LaneChangeType = (typeof LANE_CHANGE_TYPES)[number];

const LANE_CHANGE_TYPE_ALTERNATION = LANE_CHANGE_TYPES.join('|');
const LANE_CHANGE_TYPE_LIST = LANE_CHANGE_TYPES.join(', ');

export const TITLE_PATTERN = new RegExp(`^(?:${LANE_CHANGE_TYPE_ALTERNATION})(?:\\([^)]+\\))?!?: .+`);

const CONVENTIONAL_TYPE_PATTERN = new RegExp(`^(${LANE_CHANGE_TYPE_ALTERNATION})(?:\\([^)]+\\))?!?: .+`);

/** The type a conventional subject or title carries, or `undefined` when it carries none of the allowed ones. */
export function conventionalType(subject: string): LaneChangeType | undefined {
    const captured = CONVENTIONAL_TYPE_PATTERN.exec(subject)?.[1];
    return captured !== undefined && isLaneChangeType(captured) ? captured : undefined;
}

export function isLaneChangeType(value: string): value is LaneChangeType {
    return (LANE_CHANGE_TYPES as readonly string[]).includes(value);
}

/**
 * Validates a `lane:open --type` token. `agent` is refused by name because it is the retired
 * prefix: existing `agent/...` lanes keep working, but no new lane is created under it.
 */
export function assertLaneChangeType(value: string | undefined): LaneChangeType {
    if (value === undefined) {
        fail(
            `lane:open requires --type <type>: the conventional-commit type of the change, one of ${LANE_CHANGE_TYPE_LIST}`
        );
    }
    if (value === 'style') {
        fail(
            `lane type style is not allowed: pull-request titles never use it; choose one of ${LANE_CHANGE_TYPE_LIST}`
        );
    }
    if (value === 'agent') {
        fail(
            `lane type agent is the legacy prefix of existing lanes and is never created; choose one of ${LANE_CHANGE_TYPE_LIST}`
        );
    }
    if (!isLaneChangeType(value)) {
        fail(`unknown lane type ${JSON.stringify(value)}: choose one of ${LANE_CHANGE_TYPE_LIST}`);
    }
    return value;
}

/**
 * GitHub pull-request states as the delivery scripts compare them. GraphQL and
 * the normalized snapshots use these exact tokens; raw REST payloads arrive
 * lowercase and are uppercased on ingest before any compare, so one vocabulary
 * covers every script. A compare against a literal copy of one of these is a
 * second spelling of the same wire token — import it instead. Tracker issues
 * are a different vocabulary (`OPEN`/`CLOSED` with state reasons) and are not
 * owned here.
 */
export const PR_STATE = {
    OPEN: 'OPEN',
    MERGED: 'MERGED',
    CLOSED: 'CLOSED',
} as const;

export type PullRequestState = (typeof PR_STATE)[keyof typeof PR_STATE];

/**
 * The retired fixed prefix of author lanes. Lanes opened before branches were named by change type
 * still carry it, so the delivery scripts keep recognizing it; `lane:open` never mints it.
 */
export const LEGACY_LANE_BRANCH_PREFIX = 'agent';

/**
 * Upper bound on a lane branch name. Live branches stay under ~55 characters; the bound keeps a
 * crafted name from growing paths, refs, descriptor keys and log lines without limit.
 */
export const MAX_LANE_BRANCH_LENGTH = 100;

export type LaneBranchPrefix = LaneChangeType | typeof LEGACY_LANE_BRANCH_PREFIX;

export type ParsedLaneBranch = { prefix: LaneBranchPrefix; issue?: number; slug: string };

const LANE_BRANCH_PATTERN = new RegExp(
    `^(${[...LANE_CHANGE_TYPES, LEGACY_LANE_BRANCH_PREFIX].join('|')})/(?:([1-9][0-9]*)/)?([a-z0-9]+(?:-[a-z0-9]+)*)$`
);

/**
 * The one reader of lane branch names. Every delivery script that must decide "is this an author
 * lane, and which issue does it track" goes through it, because the name is untrusted input: a
 * worktree's branch is whatever its creator typed, not what `lane:open` would have minted.
 *
 * The grammar is `<prefix>/<slug>` or `<prefix>/<issue>/<slug>`, nothing else, where
 *   - `<prefix>` is a lane change type or the legacy `agent`, and only the first segment is ever read
 *     as the prefix, so a slug may be `fix` or `agent` without ambiguity (`docs/12/agent`);
 *   - `<issue>` is a positive integer without a leading zero and exists only in the three-segment
 *     form, so `fix/12-beat` is an issueless slug that starts with digits, never issue 12;
 *   - `<slug>` is lowercase alphanumeric words joined by single dashes and is never purely numeric,
 *     so a two-segment `fix/12` is refused and a three-segment `fix/12/34` cannot be read two ways.
 * Anything else, including an unknown prefix such as `style`, any `..`, a leading dash, whitespace,
 * a trailing newline, or a name past `MAX_LANE_BRANCH_LENGTH`, parses to nothing and is not a lane.
 */
export function parseLaneBranch(branch: string): ParsedLaneBranch | undefined {
    if (branch.length > MAX_LANE_BRANCH_LENGTH) {
        return undefined;
    }
    const match = LANE_BRANCH_PATTERN.exec(branch);
    const prefix = match?.[1];
    const slug = match?.[3];
    if (prefix === undefined || !isLaneBranchPrefix(prefix) || slug === undefined || /^[0-9]+$/.test(slug)) {
        return undefined;
    }
    const issueText = match?.[2];
    if (issueText === undefined) {
        return { prefix, slug };
    }
    const issue = Number(issueText);
    return Number.isSafeInteger(issue) ? { prefix, issue, slug } : undefined;
}

function isLaneBranchPrefix(value: string): value is LaneBranchPrefix {
    return value === LEGACY_LANE_BRANCH_PREFIX || isLaneChangeType(value);
}

export function isLaneBranch(branch: string): boolean {
    return parseLaneBranch(branch) !== undefined;
}

/**
 * Environment variable names the trusted launcher binds for a GitHub-writing
 * command. They live in this leaf rather than in
 * `trustedGithubWriteBootstrap.ts` because the trusted snapshot's import rule
 * forbids every pinned script from importing the loader — so the scripts
 * (publish, deliver, the mutation lock, the identity module) and the loader
 * itself share these spellings through the one module both may depend on.
 */
export const TRUSTED_PRIMARY_ROOT_ENV = 'SOURDAW_TRUSTED_PRIMARY_ROOT';
export const TRUSTED_COMMON_DIR_ENV = 'SOURDAW_TRUSTED_COMMON_DIR';
export const TRUSTED_GIT_PATH_ENV = 'SOURDAW_TRUSTED_GIT_PATH';
export const TRUSTED_GH_PATH_ENV = 'SOURDAW_TRUSTED_GH_PATH';
export const TRUSTED_PS_PATH_ENV = 'SOURDAW_TRUSTED_PS_PATH';
export const TRUSTED_GIT_AI_PATH_ENV = 'SOURDAW_TRUSTED_GIT_AI_PATH';
export const TRUSTED_POWERSHELL_PATH_ENV = 'SOURDAW_TRUSTED_POWERSHELL_PATH';
export const TRUSTED_ORIGIN_COMMIT_ENV = 'SOURDAW_TRUSTED_ORIGIN_COMMIT';
export const TRUSTED_GATE_WORKFLOW_ENV = 'SOURDAW_TRUSTED_GATE_WORKFLOW';

/** The headings a body must carry to merge: every heading the template defines. */
export const REQUIRED_BODY_HEADINGS = [
    '### 🎯 What does this PR do?',
    '### 🧪 How to test',
    '### 📌 Related issues & additional notes',
] as const;

/**
 * The Screenshots heading every body carried before the template dropped it. Agents never attached
 * one, so it only ever held `None.`; it is no longer composed, but bodies published before the drop
 * still carry it and a later `lane:publish` reads their sections back.
 */
const RETIRED_SCREENSHOTS_HEADING = '### 🖼️ Screenshots';

/**
 * Every heading that ends the section above it: the template's own plus the retired Screenshots
 * one. Without the retired heading, an older body's How-to-test span would run on into
 * `### 🖼️ Screenshots\nNone.`, so an empty How-to-test section would read as full and pass the
 * emptiness check, and the section read back for re-composition would carry the retired block.
 */
const SECTION_BOUNDARY_HEADINGS = [...REQUIRED_BODY_HEADINGS, RETIRED_SCREENSHOTS_HEADING] as const;

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
 * Where a section's content stops: the next boundary heading that actually appears after it, or
 * the end of the body when none does.
 */
function sectionContentEnd(body: string, contentStart: number): number {
    const boundaries = SECTION_BOUNDARY_HEADINGS.map((heading) => body.indexOf(heading, contentStart)).filter(
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

/**
 * The heading's pre-rename spelling. Bodies published before the Related-issues rename still carry
 * it, and `lane:publish` must read their sections to recompose them under the canonical heading —
 * reading accepts the legacy spelling exactly once, while everything written stays canonical.
 */
const LEGACY_RELATED_HEADING = '### 📌 Related tickets & additional notes';

function relatedTicketLines(body: string): string[] {
    const heading = REQUIRED_BODY_HEADINGS.at(-1);
    if (heading === undefined) {
        fail('pull-request body must contain exactly one Related issues section');
    }
    const legacyCount = body.split(LEGACY_RELATED_HEADING).length - 1;
    const headingIndex = body.indexOf(heading);
    if (headingIndex >= 0) {
        if (headingIndex !== body.lastIndexOf(heading) || legacyCount > 0) {
            fail('pull-request body must contain exactly one Related issues section');
        }
    } else {
        const legacyIndex = body.indexOf(LEGACY_RELATED_HEADING);
        if (legacyIndex < 0 || legacyIndex !== body.lastIndexOf(LEGACY_RELATED_HEADING)) {
            fail('pull-request body must contain exactly one Related issues section');
        }
        return sectionLinesAfter(body, legacyIndex, LEGACY_RELATED_HEADING);
    }
    return sectionLinesAfter(body, headingIndex, heading);
}

function sectionLinesAfter(body: string, headingIndex: number, heading: string): string[] {
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
            fail('issueless pull-request body must start its Related issues section with None.');
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

### 📌 Related issues & additional notes
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

export function laneBranchName(type: LaneChangeType, issue: number | undefined, slug: string): string {
    const branch = issue === undefined ? `${type}/${slug}` : `${type}/${issue}/${slug}`;
    if (!isLaneBranch(branch)) {
        fail(
            `${branch} is not a valid lane branch: at most ${MAX_LANE_BRANCH_LENGTH} characters, ${type}/[<issue>/]<slug>`
        );
    }
    return branch;
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

export const GUARD_FAILURES_DIR = '.agents/guard-failures';
export type GuardFailureReason = 'leak' | 'memory' | 'monitor' | 'pressure' | 'timeout';

export type GuardFailureReceipt = {
    version: 1;
    lane: string;
    branch: string;
    headSha: string;
    failedAt: string;
    reason: GuardFailureReason;
    command: string;
    args: string[];
    cwd?: string;
    // The final storage census of a leak, so a stopped lane can be triaged from its receipt.
    census?: string;
    profile: string;
    peakRssBytes: number;
    maxRssBytes: number;
    durationMs: number;
};

const GUARD_FAILURE_REASONS = new Set<GuardFailureReason>(['leak', 'memory', 'monitor', 'pressure', 'timeout']);

export function isGuardFailureReason(value: unknown): value is GuardFailureReason {
    return typeof value === 'string' && GUARD_FAILURE_REASONS.has(value as GuardFailureReason);
}

export function parseGuardFailureReceipt(raw: string, label = 'guard-failure receipt'): GuardFailureReceipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        fail(`${label} is not valid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        fail(`${label} must be a JSON object`);
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1) {
        fail(`${label} version must be 1`);
    }
    if (!isGuardFailureReason(candidate.reason)) {
        fail(`${label} reason is invalid`);
    }
    if (typeof candidate.lane !== 'string' || candidate.lane.trim() === '') {
        fail(`${label} lane is invalid`);
    }
    if (typeof candidate.branch !== 'string' || candidate.branch.trim() === '') {
        fail(`${label} branch is invalid`);
    }
    if (typeof candidate.headSha !== 'string' || !/^[0-9a-f]{40}$/i.test(candidate.headSha)) {
        fail(`${label} headSha must be a 40-character hex commit SHA`);
    }
    if (typeof candidate.failedAt !== 'string' || candidate.failedAt.trim() === '') {
        fail(`${label} failedAt is invalid`);
    }
    if (typeof candidate.command !== 'string' || candidate.command.trim() === '') {
        fail(`${label} command is invalid`);
    }
    if (!Array.isArray(candidate.args) || !candidate.args.every((arg) => typeof arg === 'string')) {
        fail(`${label} args must be an array of strings`);
    }
    if (candidate.cwd !== undefined && (typeof candidate.cwd !== 'string' || !isAbsolute(candidate.cwd))) {
        fail(`${label} cwd must be an absolute path`);
    }
    if (candidate.census !== undefined && typeof candidate.census !== 'string') {
        fail(`${label} census must be a string`);
    }
    if (typeof candidate.profile !== 'string' || candidate.profile.trim() === '') {
        fail(`${label} profile is invalid`);
    }
    if (
        typeof candidate.peakRssBytes !== 'number' ||
        !Number.isFinite(candidate.peakRssBytes) ||
        candidate.peakRssBytes < 0
    ) {
        fail(`${label} peakRssBytes must be a non-negative number`);
    }
    if (
        typeof candidate.maxRssBytes !== 'number' ||
        !Number.isFinite(candidate.maxRssBytes) ||
        candidate.maxRssBytes < 0
    ) {
        fail(`${label} maxRssBytes must be a non-negative number`);
    }
    if (
        typeof candidate.durationMs !== 'number' ||
        !Number.isFinite(candidate.durationMs) ||
        candidate.durationMs < 0
    ) {
        fail(`${label} durationMs must be a non-negative number`);
    }
    return {
        version: 1,
        lane: candidate.lane,
        branch: candidate.branch,
        headSha: candidate.headSha,
        failedAt: candidate.failedAt,
        reason: candidate.reason,
        command: candidate.command,
        args: candidate.args,
        ...(candidate.cwd === undefined ? {} : { cwd: candidate.cwd }),
        ...(candidate.census === undefined ? {} : { census: candidate.census }),
        profile: candidate.profile,
        peakRssBytes: candidate.peakRssBytes,
        maxRssBytes: candidate.maxRssBytes,
        durationMs: candidate.durationMs,
    };
}

export function guardFailureReceiptPath(primaryRoot: string, laneName: string): string {
    return join(primaryRoot, GUARD_FAILURES_DIR, `${laneName}.json`);
}

export function readGuardFailureReceipt(primaryRoot: string, laneName: string): GuardFailureReceipt | undefined {
    const receiptPath = guardFailureReceiptPath(primaryRoot, laneName);
    let content: string;
    try {
        content = readFileSync(receiptPath, 'utf8');
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    return parseGuardFailureReceipt(content, receiptPath);
}

export function canonicalPath(path: string, resolveExisting: (path: string) => string): string {
    const absolute = resolve(path);
    try {
        return resolveExisting(absolute);
    } catch {
        return absolute;
    }
}

export function containsPath(container: string, candidate: string): boolean {
    const relation = relative(container, candidate);
    return relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

/** Present custody is deliberately separate from historical stack/fork evidence. */
export type AdoptedPullRequest = {
    number: number;
    id: string;
    repository: string;
    authorId: string;
    branch: string;
    base: string;
    baseHead: string;
    head: string;
};
export type LaneAdoption = {
    version: 1;
    kind: 'present-pr-custody';
    pullRequest: AdoptedPullRequest;
    lanePath: string;
    model: string;
    sourceCommit: string;
    nonce: string;
    createdAt: string;
};
export type LaneAdoptionIntent = {
    version: 1;
    kind: 'present-pr-publication';
    nonce: string;
    oldHead: string;
    head: string;
};

function adoptionObject(value: unknown, keys: string[]): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid present adoption object');
    }
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) {
        fail('unexpected present adoption fields');
    }
    return row;
}
function adoptionText(value: unknown, pattern: RegExp): string {
    if (typeof value !== 'string' || !pattern.test(value)) {
        fail('invalid present adoption value');
    }
    return value;
}
const ADOPTION_SHA = /^[0-9a-f]{40}$/;
const ADOPTION_NONCE = /^[0-9a-f-]{36}$/;
const ADOPTION_REF = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/;
function adoptionRef(value: unknown): string {
    const ref = adoptionText(value, ADOPTION_REF);
    if (ref.includes('..') || ref.includes('//') || ref.endsWith('/') || ref.endsWith('.lock')) {
        fail('invalid present adoption ref');
    }
    return ref;
}
export function parseAdoptedPullRequest(value: unknown): AdoptedPullRequest {
    const row = adoptionObject(value, ['number', 'id', 'repository', 'authorId', 'branch', 'base', 'baseHead', 'head']);
    if (typeof row.number !== 'number' || !Number.isSafeInteger(row.number) || row.number < 1) {
        fail('invalid adopted pull request number');
    }
    const branch = adoptionRef(row.branch);
    if (!isLaneBranch(branch)) {
        fail('adoption requires a conforming existing lane branch');
    }
    return {
        number: row.number,
        id: adoptionText(row.id, /^PR_[A-Za-z0-9_-]{1,180}$/),
        repository: adoptionText(row.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        authorId: adoptionText(row.authorId, /^BOT_[A-Za-z0-9_-]{1,180}$/),
        branch,
        base: adoptionRef(row.base),
        baseHead: adoptionText(row.baseHead, ADOPTION_SHA),
        head: adoptionText(row.head, ADOPTION_SHA),
    };
}
export function parseLaneAdoption(raw: string): LaneAdoption {
    const row = adoptionObject(JSON.parse(raw), [
        'version',
        'kind',
        'pullRequest',
        'lanePath',
        'model',
        'sourceCommit',
        'nonce',
        'createdAt',
    ]);
    if (row.version !== 1 || row.kind !== 'present-pr-custody') {
        fail('invalid present adoption format');
    }
    const lanePath = adoptionText(row.lanePath, /^[^\r\n\0]{1,4096}$/);
    if (!isAbsolute(lanePath) || resolve(lanePath) !== lanePath) {
        fail('invalid adopted lane path');
    }
    const createdAt = adoptionText(row.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    if (!Number.isFinite(Date.parse(createdAt))) {
        fail('invalid adoption time');
    }
    return {
        version: 1,
        kind: 'present-pr-custody',
        pullRequest: parseAdoptedPullRequest(row.pullRequest),
        lanePath,
        model: adoptionText(row.model, /^[a-z0-9][a-z0-9.+-]{0,39}$/),
        sourceCommit: adoptionText(row.sourceCommit, ADOPTION_SHA),
        nonce: adoptionText(row.nonce, ADOPTION_NONCE),
        createdAt,
    };
}
export function parseLaneAdoptionIntent(raw: string): LaneAdoptionIntent {
    const row = adoptionObject(JSON.parse(raw), ['version', 'kind', 'nonce', 'oldHead', 'head']);
    if (row.version !== 1 || row.kind !== 'present-pr-publication') {
        fail('invalid adoption publication format');
    }
    return {
        version: 1,
        kind: 'present-pr-publication',
        nonce: adoptionText(row.nonce, ADOPTION_NONCE),
        oldHead: adoptionText(row.oldHead, ADOPTION_SHA),
        head: adoptionText(row.head, ADOPTION_SHA),
    };
}
export function laneAdoptionPath(primaryRoot: string, branch: string, intent = false): string {
    if (!isLaneBranch(branch)) {
        fail('invalid adopted branch');
    }
    return join(
        primaryRoot,
        '.agents',
        'lane-adoptions',
        `${encodeURIComponent(branch)}${intent ? '.publication' : ''}.json`
    );
}
function assertAdoptionDirectories(primaryRoot: string, create: boolean): void {
    for (const directory of [join(primaryRoot, '.agents'), join(primaryRoot, '.agents', 'lane-adoptions')]) {
        if (create) {
            try {
                mkdirSync(directory);
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
                    throw error;
                }
            }
        }
        try {
            const stat = lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) {
                fail('adoption directory is not a private repository directory');
            }
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT' && !create) {
                return;
            }
            throw error;
        }
    }
}
export function readLaneAdoptionRecord(
    primaryRoot: string,
    branch: string,
    intent: true
): LaneAdoptionIntent | undefined;
export function readLaneAdoptionRecord(primaryRoot: string, branch: string, intent?: false): LaneAdoption | undefined;
export function readLaneAdoptionRecord(
    primaryRoot: string,
    branch: string,
    intent = false
): LaneAdoption | LaneAdoptionIntent | undefined {
    assertAdoptionDirectories(primaryRoot, false);
    let fd: number;
    try {
        fd = openSync(
            laneAdoptionPath(primaryRoot, branch, intent),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 32768) {
            fail('adoption record is not a bounded regular file');
        }
        const raw = readFileSync(fd, 'utf8');
        if (raw.length > 32768) {
            fail('oversized adoption record');
        }
        const record = intent ? parseLaneAdoptionIntent(raw) : parseLaneAdoption(raw);
        if (!intent && 'pullRequest' in record && record.pullRequest.branch !== branch) {
            fail('adoption record branch mismatch');
        }
        return record;
    } finally {
        closeSync(fd);
    }
}
/** Link publication makes the complete immutable record visible, never a partial JSON write. */
export function saveLaneAdoptionRecord(
    primaryRoot: string,
    branch: string,
    record: LaneAdoption | LaneAdoptionIntent
): void {
    const intent = record.kind === 'present-pr-publication';
    const raw = JSON.stringify(record);
    if (intent) {
        parseLaneAdoptionIntent(raw);
    } else {
        parseLaneAdoption(raw);
    }
    assertAdoptionDirectories(primaryRoot, true);
    const path = laneAdoptionPath(primaryRoot, branch, intent);
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, raw, { flag: 'wx', mode: 0o600 });
    try {
        linkSync(temporary, path);
    } finally {
        unlinkSync(temporary);
    }
}

/** A complete all-state branch query plus independent live refs, ending with a fresh PR core. */
export function observeAdoptedPullRequest(
    number: number,
    repository: string,
    authorId: string,
    read: (args: string[]) => string
): AdoptedPullRequest {
    const readCore = (): AdoptedPullRequest => {
        const value: unknown = JSON.parse(read(['api', `repos/${repository}/pulls/${number}`]));
        if (typeof value !== 'object' || value === null) {
            fail('unreadable adopted pull request');
        }
        const row = value as {
            number?: unknown;
            node_id?: unknown;
            state?: unknown;
            merged_at?: unknown;
            user?: { node_id?: unknown; type?: unknown };
            head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
            base?: { ref?: unknown; repo?: { full_name?: unknown } };
        };
        if (
            row.number !== number ||
            row.state !== 'open' ||
            row.merged_at !== null ||
            row.user?.node_id !== authorId ||
            row.user.type !== 'Bot' ||
            row.head?.repo?.full_name !== repository ||
            row.base?.repo?.full_name !== repository
        ) {
            fail('adoption requires the exact open same-repository author-App pull request');
        }
        return parseAdoptedPullRequest({
            number,
            id: row.node_id,
            repository,
            authorId,
            branch: row.head.ref,
            head: row.head.sha,
            base: row.base.ref,
            baseHead: '0'.repeat(40),
        });
    };
    const first = readCore();
    const pages: unknown = JSON.parse(
        read([
            'api',
            '--paginate',
            '--slurp',
            `repos/${repository}/pulls?state=all&head=${encodeURIComponent(`${repository.split('/')[0]}:${first.branch}`)}&per_page=100`,
        ])
    );
    if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) => !Array.isArray(page))) {
        fail('incomplete adopted branch candidates');
    }
    const rows: unknown[] = pages.flat();
    if (rows.length !== 1) {
        fail('adopted branch must identify exactly one all-state pull request');
    }
    const candidate = rows[0];
    if (
        typeof candidate !== 'object' ||
        candidate === null ||
        !('number' in candidate) ||
        !('node_id' in candidate) ||
        candidate.number !== number ||
        candidate.node_id !== first.id
    ) {
        fail('adopted branch pull request identity changed');
    }
    const liveRef = (branch: string): string => {
        const value: unknown = JSON.parse(read(['api', `repos/${repository}/git/ref/heads/${branch}`]));
        if (typeof value !== 'object' || value === null) {
            fail('unreadable adopted ref');
        }
        const row = value as { ref?: unknown; object?: { type?: unknown; sha?: unknown } };
        if (row.ref !== `refs/heads/${branch}` || row.object?.type !== 'commit') {
            fail('adopted live ref identity mismatch');
        }
        return adoptionText(row.object.sha, ADOPTION_SHA);
    };
    const head = liveRef(first.branch);
    const baseHead = liveRef(first.base);
    const last = readCore();
    if (JSON.stringify(first) !== JSON.stringify(last) || head !== first.head) {
        fail('adopted pull request moved during observation');
    }
    return { ...first, baseHead };
}
export function assertAdoptedPullRequest(
    current: AdoptedPullRequest,
    expected: AdoptedPullRequest,
    head: string
): void {
    if (JSON.stringify({ ...current, head }) !== JSON.stringify({ ...expected, head }) || current.head !== head) {
        fail('adopted pull request identity, base, ref or head changed');
    }
}

/** A fresh checkout must not evade a failure retained under the branch's former lane name. */
export function assertNoAdoptionGuardFailure(primaryRoot: string, branch: string): void {
    const directory = join(primaryRoot, GUARD_FAILURES_DIR);
    try {
        const stat = lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            fail('guard failure directory is redirected');
        }
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return;
        }
        throw error;
    }
    for (const file of readdirSync(directory)) {
        if (!file.endsWith('.json')) {
            continue;
        }
        if (parseGuardFailureReceipt(readGuardFailureEvidence(join(directory, file))).branch === branch) {
            fail('adoption refuses unresolved guard-failure evidence for this branch');
        }
    }
}
/** Checks and reads one descriptor so the evidence cannot be swapped between the check and the read. */
function readGuardFailureEvidence(path: string): string {
    let fd: number;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
            fail('guard failure evidence is redirected');
        }
        throw error;
    }
    try {
        if (!fstatSync(fd).isFile()) {
            fail('guard failure evidence is redirected');
        }
        return readFileSync(fd, 'utf8');
    } finally {
        closeSync(fd);
    }
}

export type AdoptionWorktree = { path: string; branch: string; head: string; lock: string };
export type AdoptionPort = {
    repository: string;
    authorId: string;
    lockReason: string;
    primaryRoot: string;
    sourceCommit: string;
    observe: (pr: number) => AdoptedPullRequest;
    receipt: (branch: string) => LaneAdoption | undefined;
    save: (record: LaneAdoption) => void;
    assertSafe: (branch: string) => void;
    branch: (branch: string) => string;
    birth: (record: LaneAdoption) => boolean;
    pathExists: (path: string) => boolean;
    worktrees: () => AdoptionWorktree[];
    reserve: (record: LaneAdoption) => void;
    add: (record: LaneAdoption) => void;
    assertCheckout: (record: LaneAdoption) => void;
    clean: (path: string) => boolean;
    identity: (path: string) => boolean;
    stamp: (path: string) => void;
    model: (branch: string) => string;
    saveModel: (branch: string, model: string) => void;
    now: () => string;
    nonce: () => string;
    log: (message: string) => void;
};

function assertAdoptionOwnership(record: LaneAdoption, port: AdoptionPort): AdoptionWorktree | undefined {
    const matches = port
        .worktrees()
        .filter((tree) => tree.branch === record.pullRequest.branch || tree.path === record.lanePath);
    if (matches.length > 1) {
        fail('adoption collides with another worktree');
    }
    const tree = matches[0];
    if (
        tree !== undefined &&
        (tree.path !== record.lanePath ||
            tree.branch !== record.pullRequest.branch ||
            tree.head !== record.pullRequest.head ||
            tree.lock !== port.lockReason ||
            !port.birth(record))
    ) {
        fail('adoption worktree is foreign or changed; preserve its evidence');
    }
    return tree;
}

export function adoptPresentPullRequest(pr: number, expectedHead: string, model: string, port: AdoptionPort): string {
    const observed = port.observe(pr);
    if (
        observed.number !== pr ||
        observed.repository !== port.repository ||
        observed.authorId !== port.authorId ||
        !isLaneBranch(observed.branch)
    ) {
        fail('adoption public identity is not the required author-App PR');
    }
    if (observed.head !== expectedHead) {
        fail('adoption expected head differs from the live pull request');
    }
    const lanePath = join(port.primaryRoot, '.agents', 'worktrees', `adopt-${pr}-${expectedHead.slice(0, 12)}`);
    const existing = port.receipt(observed.branch);
    const record: LaneAdoption = existing ?? {
        version: 1,
        kind: 'present-pr-custody',
        pullRequest: observed,
        lanePath,
        model,
        sourceCommit: port.sourceCommit,
        nonce: port.nonce(),
        createdAt: port.now(),
    };
    if (record.lanePath !== lanePath || record.model !== model || record.pullRequest.number !== pr) {
        fail('conflicting present adoption replay');
    }
    assertAdoptedPullRequest(observed, record.pullRequest, expectedHead);
    let registered = existing !== undefined;
    const assertCurrent = () => {
        port.assertSafe(observed.branch);
        assertAdoptedPullRequest(port.observe(pr), record.pullRequest, expectedHead);
        const retained = port.receipt(observed.branch);
        if (
            (registered && retained === undefined) ||
            (retained !== undefined && JSON.stringify(retained) !== JSON.stringify(record))
        ) {
            fail('present adoption journal changed');
        }
        if (assertAdoptionOwnership(record, port) !== undefined) {
            port.assertCheckout(record);
        }
    };
    assertCurrent();
    if (existing === undefined) {
        if (
            port.branch(observed.branch) !== '' ||
            port.pathExists(lanePath) ||
            assertAdoptionOwnership(record, port) !== undefined
        ) {
            fail('adoption requires an absent local branch, path and worktree');
        }
        port.save(record);
        registered = true;
    }
    assertCurrent();
    const branchHead = port.branch(observed.branch);
    if (branchHead === '') {
        if (port.pathExists(lanePath)) {
            fail('adoption destination appeared before branch reservation');
        }
        port.reserve(record);
    } else if (branchHead !== expectedHead || !port.birth(record)) {
        fail('adoption local branch is foreign or changed');
    }
    assertCurrent();
    if (assertAdoptionOwnership(record, port) === undefined) {
        if (port.pathExists(lanePath)) {
            fail('adoption destination exists without its native worktree');
        }
        port.add(record);
    }
    assertCurrent();
    if (assertAdoptionOwnership(record, port) === undefined || !port.clean(lanePath)) {
        fail('adoption checkout is incomplete or dirty; preserve the journal');
    }
    if (!port.identity(lanePath)) {
        assertCurrent();
        port.stamp(lanePath);
    }
    if (port.model(observed.branch) !== model) {
        assertCurrent();
        port.saveModel(observed.branch, model);
    }
    assertCurrent();
    if (!port.clean(lanePath) || !port.identity(lanePath) || port.model(observed.branch) !== model) {
        fail('adoption final checkout verification failed');
    }
    port.log(`present custody of PR #${pr}; no historical stack association recorded`);
    port.log(lanePath);
    return lanePath;
}

export function adoptionPathExists(path: string): boolean {
    try {
        lstatSync(path);
        return true;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export function parseLaneAdoptionArgs(
    args: string[],
    usage: string
): { adoptPr: number; expectedHead: string; model: string } | undefined {
    if (!args.includes('--adopt-pr') && !args.includes('--expected-head')) {
        return undefined;
    }
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (
            key === undefined ||
            !['--adopt-pr', '--expected-head', '--model'].includes(key) ||
            values.has(key) ||
            value === undefined ||
            value.startsWith('--')
        ) {
            fail(usage);
        }
        values.set(key, value);
    }
    const expectedHead = values.get('--expected-head');
    const model = values.get('--model');
    if (expectedHead === undefined || !/^[0-9a-f]{40}$/.test(expectedHead) || model === undefined) {
        fail(usage);
    }
    return { adoptPr: assertIssueNumber(values.get('--adopt-pr') ?? '', usage), expectedHead, model };
}

export function assertAdoptionParent(path: string): void {
    if (!adoptionPathExists(path)) {
        return;
    }
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) {
        fail('adoption parent directory is redirected');
    }
}
