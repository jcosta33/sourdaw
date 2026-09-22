import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_COMMIT_EMAIL, AUTHOR_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    ATTESTATION_FORMAT,
    SOURCE_ATTESTATION_MARKER,
    attestationMarkerLine,
    latestAttestationForHead,
    parseSourceAttestation,
    sourceAttestationComment,
    sourceAttestationRecord,
    type AttestedCommit,
} from '../sourceAttestation.ts';

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER_HEAD = 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function commit(oid: string, name = 'hplovecraft208[bot]', email = AUTHOR_BOT_COMMIT_EMAIL): AttestedCommit {
    return { oid, name, email };
}

const COMMIT_A = commit('0000000000000000000000000000000000000001');
const COMMIT_B = commit('0000000000000000000000000000000000000002');

/** An attestation comment as the reader consumes it, authored by the App unless overridden. */
function appComment(body: string, authorNodeId = AUTHOR_BOT_NODE_ID): { body: string; authorNodeId: string } {
    return { body, authorNodeId };
}

describe('sourceAttestation', () => {
    it('round-trips a record through its comment, commits sorted into the canonical OID order', () => {
        const record = sourceAttestationRecord(4526, HEAD, [COMMIT_B, COMMIT_A]);

        expect(record.commits.map((entry) => entry.oid)).toEqual([COMMIT_A.oid, COMMIT_B.oid]);
        const parsed = parseSourceAttestation(sourceAttestationComment(record));

        expect(parsed).toEqual(record);
    });

    it('prints the one canonical byte form: key-sorted, whitespace-free JSON after the marker', () => {
        const record = sourceAttestationRecord(4526, HEAD, [COMMIT_A]);

        expect(attestationMarkerLine(record)).toBe(
            `${SOURCE_ATTESTATION_MARKER} {"commits":[{"email":"${AUTHOR_BOT_COMMIT_EMAIL}",` +
                `"name":"hplovecraft208[bot]","oid":"${COMMIT_A.oid}"}],` +
                `"format":"${ATTESTATION_FORMAT}","head":"${HEAD}","pr":4526}`
        );
    });

    it('keeps the public prose bounded: the count and head, never per-commit detail', () => {
        const body = sourceAttestationComment(sourceAttestationRecord(4526, HEAD, [COMMIT_A, COMMIT_B]));
        const prose = body.split('\n\n')[0];

        expect(prose).toContain('2 commits');
        expect(prose).toContain(HEAD.slice(0, 7));
        expect(prose).not.toContain(COMMIT_A.oid);
        expect(prose).not.toContain(AUTHOR_BOT_COMMIT_EMAIL);
    });

    it('collapses the marker into a details block after the sentence, marker line byte-for-byte', () => {
        const record = sourceAttestationRecord(4526, HEAD, [COMMIT_A, COMMIT_B]);
        const body = sourceAttestationComment(record);

        expect(body.split('\n\n')[0]).toContain('2 commits');
        expect(body).toContain('<details>');
        expect(body).toContain('<summary>Attestation record</summary>');
        expect(body.split('\n')).toContain(attestationMarkerLine(record));
        expect(parseSourceAttestation(body)).toEqual(record);

        // The record must be readable only on expand: the block wraps it, and nothing outside the
        // block repeats it — a marker after the close, a missing close, or a duplicate outside all
        // leave the wall of JSON visible where this change exists to hide it.
        const openIndex = body.indexOf('<details>');
        const closeIndex = body.indexOf('</details>');
        expect(closeIndex).toBeGreaterThan(openIndex);
        expect(body.slice(openIndex, closeIndex)).toContain(attestationMarkerLine(record));
        expect(body.slice(0, openIndex) + body.slice(closeIndex)).not.toContain(attestationMarkerLine(record));
        expect(body.split('\n').filter((line) => line === attestationMarkerLine(record))).toHaveLength(1);
    });

    it('ignores prose that merely mentions the marker token', () => {
        const body = `See ${SOURCE_ATTESTATION_MARKER} for the record format — this note is prose, not a record.`;

        expect(parseSourceAttestation(body)).toBeUndefined();
    });

    it('refuses a present but malformed marker instead of laundering it into absence', () => {
        expect(() => parseSourceAttestation(`${SOURCE_ATTESTATION_MARKER} not json`)).toThrow(/not valid JSON/);
        // Reordered keys and stray whitespace are not the canonical byte form.
        expect(() =>
            parseSourceAttestation(
                `${SOURCE_ATTESTATION_MARKER} {"pr":4526,"format":"${ATTESTATION_FORMAT}","head":"${HEAD}","commits":[]}`
            )
        ).toThrow(/canonical/);
        expect(() =>
            parseSourceAttestation(
                `${SOURCE_ATTESTATION_MARKER} { "commits":[],"format":"attestation-v1","head":"${HEAD}","pr":4526 }`
            )
        ).toThrow(/canonical/);
    });

    it('fails closed on an unknown format version', () => {
        const forged = `${SOURCE_ATTESTATION_MARKER} {"commits":[],"format":"attestation-v2","head":"${HEAD}","pr":4526}`;

        expect(() => parseSourceAttestation(forged)).toThrow(/format must be attestation-v1/);
    });

    it('refuses records with missing or extra keys, so a shape drift cannot parse as the frozen schema', () => {
        const extraKey = `${SOURCE_ATTESTATION_MARKER} {"actor":"bot","commits":[],"format":"${ATTESTATION_FORMAT}","head":"${HEAD}","pr":4526}`;
        const missingKey = `${SOURCE_ATTESTATION_MARKER} {"format":"${ATTESTATION_FORMAT}","head":"${HEAD}","pr":4526}`;

        expect(() => parseSourceAttestation(extraKey)).toThrow(/exactly the keys/);
        expect(() => parseSourceAttestation(missingKey)).toThrow(/exactly the keys/);
    });

    it('refuses abbreviated or non-hex commit OIDs and heads: the attestation binds exact identities', () => {
        expect(() => sourceAttestationRecord(4526, HEAD, [commit('abc123')])).toThrow(/full 40-hex/);
        expect(() => sourceAttestationRecord(4526, HEAD, [commit('g'.repeat(40))])).toThrow(/full 40-hex/);
        expect(() => sourceAttestationRecord(4526, 'abc', [COMMIT_A])).toThrow(/full 40-hex/);
        expect(() => sourceAttestationRecord(4526, HEAD.toUpperCase(), [COMMIT_A])).toThrow(/full 40-hex/);
    });

    it('refuses a duplicated commit OID in both writer and reader', () => {
        expect(() => sourceAttestationRecord(4526, HEAD, [COMMIT_A, COMMIT_A])).toThrow(/twice/);
        const marker =
            `${SOURCE_ATTESTATION_MARKER} {"commits":[{"email":"a@b.c","name":"n","oid":"${COMMIT_A.oid}"},` +
            `{"email":"a@b.c","name":"n","oid":"${COMMIT_A.oid}"}],"format":"${ATTESTATION_FORMAT}","head":"${HEAD}","pr":4526}`;
        expect(() => parseSourceAttestation(marker)).toThrow(/canonical ascending, duplicate-free/);
    });

    it('refuses out-of-order commits at parse: one attestation has exactly one byte representation', () => {
        const marker =
            `${SOURCE_ATTESTATION_MARKER} {"commits":[{"email":"a@b.c","name":"n","oid":"${COMMIT_B.oid}"},` +
            `{"email":"a@b.c","name":"n","oid":"${COMMIT_A.oid}"}],"format":"${ATTESTATION_FORMAT}","head":"${HEAD}","pr":4526}`;

        expect(() => parseSourceAttestation(marker)).toThrow(/canonical ascending/);
    });

    it('bounds caller-visible identity fields to a single line of bounded bytes', () => {
        expect(() => sourceAttestationRecord(4526, HEAD, [commit(COMMIT_A.oid, 'line one\nline two')])).toThrow(
            /single-line/
        );
        expect(() => sourceAttestationRecord(4526, HEAD, [commit(COMMIT_A.oid, 'x'.repeat(300))])).toThrow(/256 bytes/);
    });

    it('refuses a commits payload that would not fit the GitHub comment ceiling, pre-push', () => {
        const huge = Array.from({ length: 400 }, (_, index) =>
            commit(`${String(index).padStart(40, '0')}`, 'n'.repeat(200), 'e'.repeat(200))
        );

        expect(() => sourceAttestationRecord(4526, HEAD, huge)).toThrow(/split the lane/);
    });

    it('refuses a non-positive or non-integer pull-request number', () => {
        expect(() => sourceAttestationRecord(0, HEAD, [])).toThrow(/positive safe integer/);
        expect(() => sourceAttestationRecord(4.5, HEAD, [])).toThrow(/positive safe integer/);
    });

    it('an empty commit set attests truthfully: a publication can add no commits', () => {
        const record = sourceAttestationRecord(4526, HEAD, []);

        expect(parseSourceAttestation(sourceAttestationComment(record))).toEqual(record);
    });

    it('records observed authorship verbatim, including foreign identities — refusal is the gate\u2019s, not the writer\u2019s', () => {
        const foreign = commit(COMMIT_A.oid, 'hplovecraft208[bot]', 'fixture@example.com');
        const record = sourceAttestationRecord(4526, HEAD, [foreign]);

        expect(parseSourceAttestation(sourceAttestationComment(record))).toEqual(record);
    });

    describe('latestAttestationForHead', () => {
        it('returns the newest author-App attestation bound to the head', () => {
            const older = sourceAttestationRecord(4526, HEAD, [COMMIT_A]);
            const newer = sourceAttestationRecord(4526, HEAD, [COMMIT_A, COMMIT_B]);
            const comments = [
                appComment(sourceAttestationComment(older)),
                appComment('ordinary prose comment'),
                appComment(sourceAttestationComment(newer)),
            ];

            expect(latestAttestationForHead(comments, HEAD)).toEqual(newer);
        });

        it('skips attestations bound to a different head', () => {
            const other = sourceAttestationRecord(4526, OTHER_HEAD, [COMMIT_A]);
            const comments = [appComment(sourceAttestationComment(other))];

            expect(latestAttestationForHead(comments, HEAD)).toBeUndefined();
        });

        it('ignores a foreign-actor marker even when it parses: another actor\u2019s record is not evidence', () => {
            const forged = sourceAttestationRecord(4526, HEAD, [COMMIT_A]);
            const comments = [appComment(sourceAttestationComment(forged), 'BOT_kgDOFORGED')];

            expect(latestAttestationForHead(comments, HEAD)).toBeUndefined();
        });

        it('fails closed on a malformed author-App marker: corrupt protected-channel evidence is never absent', () => {
            const comments = [appComment(`${SOURCE_ATTESTATION_MARKER} not json`)];

            expect(() => latestAttestationForHead(comments, HEAD)).toThrow(/not valid JSON/);
        });

        it('lets a forged-display-name comment by a foreign author stand ignored beside the App\u2019s real record', () => {
            const real = sourceAttestationRecord(4526, HEAD, [COMMIT_A]);
            const comments = [
                appComment(sourceAttestationComment(real), 'MDQ6VXNlcjg5NzgyNzA='),
                appComment(sourceAttestationComment(real)),
            ];

            expect(latestAttestationForHead(comments, HEAD)).toEqual(real);
        });
    });
});
