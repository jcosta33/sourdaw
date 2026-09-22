/**
 * Source attestation (#3373, spec #3367 AC-001): when an author lane publishes, the exact commit
 * OIDs it adds above the comparison base and their observed Git authorship receive an immutable
 * author-App attestation bound to the published head. The record rides the protected-public
 * channel as a `sourdaw-attestation-v1` marker comment posted by the author App on the pull
 * request, framed by the one marker grammar in `canonicalRecord.ts`, so the evidence contract's
 * canonical-byte and actor-binding rules apply unchanged.
 *
 * The attestation is deliberately bounded: it carries the pull request, the published head, and
 * each commit's OID with its observed author name and email — all facts the pull request's commit
 * list already shows publicly. No delegated identity detail (sessions, credentials, prompts) ever
 * enters the record; real provenance stays in the restricted channel (the lane's own Git history
 * and stamping configuration). The writer never judges authorship — refusal of foreign-authored
 * deltas is the publish gate's sole competence — it records what Git observed, so a truthful
 * record can never launder a forged display name into an App identity: the email field carries
 * the immutable database id, and readers trust only comments by the author App's node id.
 *
 * Newest authority: each publication posts at most one record per head; a recomputed record whose
 * canonical marker already stands is not reposted, and a record that differs (the excluded bases
 * moved under the same head) supersedes by comment order. Parsing never launders a corrupt record
 * into an absent one: a body with no marker line is `undefined`, while a present but malformed
 * marker from the author App fails closed.
 */

import { canonicalJson, lastMarkerLine, parseMarkerPayload } from './canonicalRecord.ts';
import { isAuthorBotNodeId } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export const ATTESTATION_FORMAT = 'attestation-v1';

/** The marker token; the canonical JSON payload follows it on the same, final record line. */
export const SOURCE_ATTESTATION_MARKER = `sourdaw-${ATTESTATION_FORMAT}`;

export type AttestedCommit = {
    /** The full 40-hex commit OID; the attestation binds exact identities, never abbreviations. */
    oid: string;
    name: string;
    email: string;
};

export type SourceAttestation = {
    format: typeof ATTESTATION_FORMAT;
    pr: number;
    head: string;
    commits: AttestedCommit[];
};

/** An issue comment as the attestation reader needs it: body plus its author's immutable node id. */
export type AttestationComment = {
    body: string;
    authorNodeId: string;
};

const COMMIT_OID_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * The serialized record must fit GitHub's issue-comment ceiling (65536 bytes) with room for the
 * bounded prose line, so the canonical commits payload is refused well under it.
 */
const MAX_COMMITS_PAYLOAD_BYTES = 60000;

/** A caller-facing field bound: author names and emails stay single-line and byte-bounded. */
const MAX_IDENTITY_FIELD_BYTES = 256;

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(label: string, value: Record<string, unknown>, keys: readonly string[]): void {
    const actual = Object.keys(value);
    if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) {
        fail(`source attestation ${label} must carry exactly the keys ${keys.join(', ')}, found ${actual.join(', ')}`);
    }
}

function assertCommitOid(label: string, value: unknown): string {
    if (typeof value !== 'string' || !COMMIT_OID_PATTERN.test(value)) {
        fail(`source attestation ${label} must be a full 40-hex commit OID, found ${describeValue(value)}`);
    }
    return value;
}

function assertIdentityField(label: string, value: unknown): string {
    if (typeof value !== 'string') {
        fail(`source attestation ${label} must be a string, found ${describeValue(value)}`);
    }
    if (/[\n\r]/u.test(value)) {
        fail(`source attestation ${label} must be single-line`);
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_IDENTITY_FIELD_BYTES) {
        fail(`source attestation ${label} exceeds ${MAX_IDENTITY_FIELD_BYTES} bytes`);
    }
    return value;
}

function assertAttestedCommit(label: string, value: unknown): AttestedCommit {
    if (!isRecord(value)) {
        fail(`source attestation ${label} must be an object, found ${describeValue(value)}`);
    }
    assertExactKeys(label, value, ['email', 'name', 'oid']);
    return {
        oid: assertCommitOid(`${label} oid`, value.oid),
        name: assertIdentityField(`${label} name`, value.name),
        email: assertIdentityField(`${label} email`, value.email),
    };
}

/**
 * The one canonical commit order: ascending OID, no duplicates. The writer sorts and the parser
 * refuses anything else, so one attestation has exactly one byte representation and a reordered
 * or duplicated commit set cannot parse as the record it tampers with.
 */
function canonicalCommits(commits: AttestedCommit[]): AttestedCommit[] {
    const sorted = [...commits].sort((left, right) => {
        if (left.oid < right.oid) {
            return -1;
        }
        return left.oid === right.oid ? 0 : 1;
    });
    let previous: AttestedCommit | undefined;
    for (const commit of sorted) {
        if (previous !== undefined && commit.oid === previous.oid) {
            fail(`source attestation carries commit ${commit.oid} twice`);
        }
        previous = commit;
    }
    return sorted;
}

function assertCanonicalOrder(commits: AttestedCommit[]): void {
    let previous: AttestedCommit | undefined;
    for (const commit of commits) {
        if (previous !== undefined && commit.oid <= previous.oid) {
            fail('source attestation commits are not in the canonical ascending, duplicate-free OID order');
        }
        previous = commit;
    }
}

/**
 * Validates a to-be-attested draft — head plus observed commits — before any remote write, so
 * every refusal a record composition could raise lands pre-push and the post-push compose only
 * formats what this already proved.
 */
export function assertAttestationDraft(head: string, commits: AttestedCommit[]): void {
    assertCommitOid('head', head);
    for (const [index, commit] of commits.entries()) {
        assertAttestedCommit(`commits[${index}]`, commit);
    }
    const sorted = canonicalCommits(commits);
    const payloadBytes = Buffer.byteLength(canonicalJson(sorted), 'utf8');
    if (payloadBytes > MAX_COMMITS_PAYLOAD_BYTES) {
        fail(
            `source attestation commits payload is ${payloadBytes} bytes, over the ${MAX_COMMITS_PAYLOAD_BYTES}-byte ` +
                'bound that keeps the comment under the GitHub ceiling; split the lane into smaller publications'
        );
    }
}

/**
 * Builds the record for one publication: head and every commit OID validated, commits sorted into
 * the canonical order.
 */
export function sourceAttestationRecord(pr: number, head: string, commits: AttestedCommit[]): SourceAttestation {
    if (!Number.isSafeInteger(pr) || pr <= 0) {
        fail(`source attestation pr must be a positive safe integer, found ${describeValue(pr)}`);
    }
    assertAttestationDraft(head, commits);
    return { format: ATTESTATION_FORMAT, pr, head, commits: canonicalCommits(commits) };
}

/** The canonical marker line: the one byte form of the record on the protected-public channel. */
export function attestationMarkerLine(record: SourceAttestation): string {
    return `${SOURCE_ATTESTATION_MARKER} ${canonicalJson(record)}`;
}

/**
 * The comment the author App posts: one bounded prose line naming the count and head, then the
 * marker line carrying the full record collapsed under a neutral summary, so a human reader meets
 * a sentence instead of a wall of JSON. The prose never enumerates commits — the marker is the
 * record — so the public body stays bounded regardless of commit count. The marker line itself is
 * unchanged and still stands alone, so the reader parses the body exactly as it always has.
 */
export function sourceAttestationComment(record: SourceAttestation): string {
    const noun = record.commits.length === 1 ? 'commit' : 'commits';
    return (
        `**Source attestation** — ${record.commits.length} ${noun} above the comparison base bound to head ` +
        `\`${record.head}\` by the author App at publication; the marker record binds every exact OID with its ` +
        `observed Git authorship.\n\n` +
        `<details>\n<summary>Attestation record</summary>\n\n${attestationMarkerLine(record)}\n\n</details>`
    );
}

/**
 * Parses the record a body carries, or `undefined` when the body carries no marker line at all.
 * A present marker that is not the canonical byte form, carries unknown format or keys, or binds
 * malformed values fails closed rather than laundering into absence.
 */
export function parseSourceAttestation(body: string): SourceAttestation | undefined {
    const marker = lastMarkerLine(body, SOURCE_ATTESTATION_MARKER);
    if (marker === undefined) {
        return undefined;
    }
    const payload = parseMarkerPayload(marker.slice(SOURCE_ATTESTATION_MARKER.length).trim(), 'source attestation');
    if (!isRecord(payload)) {
        fail(`source attestation payload must be an object, found ${describeValue(payload)}`);
    }
    assertExactKeys('payload', payload, ['commits', 'format', 'head', 'pr']);
    if (payload.format !== ATTESTATION_FORMAT) {
        fail(`source attestation format must be ${ATTESTATION_FORMAT}, found ${describeValue(payload.format)}`);
    }
    if (typeof payload.pr !== 'number' || !Number.isSafeInteger(payload.pr) || payload.pr <= 0) {
        fail(`source attestation pr must be a positive safe integer, found ${describeValue(payload.pr)}`);
    }
    if (!Array.isArray(payload.commits)) {
        fail(`source attestation commits must be an array, found ${describeValue(payload.commits)}`);
    }
    const commits = payload.commits.map((commit, index) => assertAttestedCommit(`commits[${index}]`, commit));
    assertCanonicalOrder(commits);
    return { format: ATTESTATION_FORMAT, pr: payload.pr, head: assertCommitOid('head', payload.head), commits };
}

/**
 * The newest attestation the author App itself posted for `head`, or `undefined` when none
 * matches. Foreign-authored comments are ignored outright — prose that merely mentions the marker
 * and markers from any other actor are not evidence. A malformed marker from the author App fails
 * closed: corrupt evidence on the protected channel is an operator problem, never an absence.
 * `comments` must arrive in ascending comment-id order, so the last match holds newest authority.
 */
export function latestAttestationForHead(comments: AttestationComment[], head: string): SourceAttestation | undefined {
    let found: SourceAttestation | undefined;
    for (const comment of comments) {
        if (!isAuthorBotNodeId(comment.authorNodeId)) {
            continue;
        }
        const record = parseSourceAttestation(comment.body);
        if (record !== undefined && record.head === head) {
            found = record;
        }
    }
    return found;
}
