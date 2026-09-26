import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    PULL_REQUEST_BODY_BYTE_LIMIT,
    REQUIRED_BODY_HEADINGS,
    REVIEW_COMMENT_MAX_BYTES,
    assertConventionalSubject,
    assertLaneSlug,
    assertPullRequestBody,
    canonicalIssueReferenceFromBody,
    canonicalPath,
    composeDeliveryReceipt,
    composePublishBody,
    composeReviewCommentBody,
    containsPath,
    fail,
    issueRelationshipFromBody,
    laneBranchName,
    parseDeliveryReceipt,
    supersessionCommentBody,
    supersessionReplacement,
    GUARD_FAILURES_DIR,
    guardFailureReceiptPath,
    isGuardFailureReason,
    parseGuardFailureReceipt,
    readGuardFailureReceipt,
    type GuardFailureReceipt,
    type ReviewCommentContent,
} from '../prContract.ts';
import {
    assertObservableTestInstructions,
    narratingTestInstructionSegments,
    testInstructionsNarrateChecks,
    COMMAND_HEADS,
    CHECK_NARRATION_TEST_INSTRUCTIONS_REFUSAL,
} from '../testInstructions.ts';

const WHAT_HEADING = '### 🎯 What does this PR do?';
const HOW_HEADING = '### 🧪 How to test';
const SCREENSHOTS_HEADING = '### 🖼️ Screenshots';
const RELATED_HEADING = '### 📌 Related issues & additional notes';
const TITLE = 'feat(vcs): add identities';
const SUMMARY = 'Keep VCS identity records so each authored change names who wrote it.';
const TEST_INSTRUCTIONS = 'Run the lane publisher contract test and confirm it passes.';

/**
 * The refusal text, so a test can assert what a message must *not* say. `toThrow` only proves a
 * substring is present, and the defect here is a message naming the wrong section, not a missing one.
 */
function refusal(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected a refusal, but the body was accepted');
}

describe('pull-request contract', () => {
    it('accepts a conventional subject and rejects free text', () => {
        assertConventionalSubject('feat(vcs): add identities', 'title');
        expect(() => assertConventionalSubject('WIP identities', 'title')).toThrow(/not conventional/);
    });

    it('composes a body with Closes and every required heading, and no retired Screenshots one', () => {
        const body = composePublishBody(2164, TITLE, SUMMARY, TEST_INSTRUCTIONS);
        expect(body).toContain('Closes #2164');
        for (const heading of REQUIRED_BODY_HEADINGS) {
            expect(body).toContain(heading);
        }
        expect(REQUIRED_BODY_HEADINGS).not.toContain(SCREENSHOTS_HEADING);
        expect(body).not.toContain(SCREENSHOTS_HEADING);
        expect(body).toContain(`${HOW_HEADING}\n${TEST_INSTRUCTIONS}`);
        expect(body).toContain(`${WHAT_HEADING}\n${SUMMARY}`);
        expect(body).not.toContain(`${WHAT_HEADING}\n${TITLE}`);
        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it('refuses a What section that repeats the title', () => {
        expect(() => composePublishBody(2164, TITLE, TITLE, TEST_INSTRUCTIONS)).toThrow(
            /What section repeats the title/
        );
        expect(() => composePublishBody(2164, TITLE, 'add identities', TEST_INSTRUCTIONS)).toThrow(
            /What section repeats the title/
        );
        expect(() => composePublishBody(2164, TITLE, '  ADD   IDENTITIES  ', TEST_INSTRUCTIONS)).toThrow(
            /What section repeats the title/
        );
        expect(() => composePublishBody(2164, TITLE, SUMMARY, TEST_INSTRUCTIONS)).not.toThrow();
    });

    it('references an umbrella issue without closing it', () => {
        const body = composePublishBody(2164, TITLE, SUMMARY, TEST_INSTRUCTIONS, 'relates');
        expect(body).toContain('Related #2164');
        expect(body).not.toContain('Closes #2164');
        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it('recovers one existing issue relationship', () => {
        const prefix = '### 📌 Related issues & additional notes\n';
        expect(issueRelationshipFromBody(`${prefix}Closes #2164`, 2164)).toBe('closes');
        expect(issueRelationshipFromBody(`${prefix}CLOSES #2164`, 2164)).toBe('closes');
        expect(issueRelationshipFromBody(`${prefix}Closes: #2164`, 2164)).toBe('closes');
        expect(issueRelationshipFromBody(`${prefix}Closes jcosta33/sourdaw#2164`, 2164, 'jcosta33/sourdaw')).toBe(
            'closes'
        );
        expect(issueRelationshipFromBody(`${prefix}Closes JCOSTA33/SOURDAW#2164`, 2164, 'jcosta33/sourdaw')).toBe(
            'closes'
        );
        expect(issueRelationshipFromBody(`${prefix}Related #2164`, 2164)).toBe('relates');
        expect(issueRelationshipFromBody(`${prefix}None.`, undefined)).toBeUndefined();
        expect(() => issueRelationshipFromBody(`${prefix}Closes #21640`, 2164)).toThrow(/exactly one relationship/);
        expect(() => issueRelationshipFromBody(`${prefix}None.`, 2164)).toThrow(/exactly one relationship/);
        expect(issueRelationshipFromBody(`${prefix}Closes #2164\nRelated #99`, 2164)).toBe('closes');
        expect(() => issueRelationshipFromBody(`${prefix}None.\nCloses #2164`, 2164)).toThrow(
            /exactly one relationship/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2164\n${prefix}Related #2164`, 2164)).toThrow(
            /exactly one Related issues section/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #90071992547409930`, Number.MAX_SAFE_INTEGER)).toThrow(
            /exactly one relationship/
        );
        expect(() => issueRelationshipFromBody(`Fixes #99\n${prefix}Related #2164`, 2164)).toThrow(
            /unexpected issue-closing references/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2164`, undefined)).toThrow(/must start/);
        expect(() => issueRelationshipFromBody(`${prefix}Closes other/sourdaw#2164`, 2164, 'jcosta33/sourdaw')).toThrow(
            /exactly one relationship/
        );
    });

    it('reads the pre-rename Related tickets heading exactly once, for recomposition', () => {
        const legacy = '### 📌 Related tickets & additional notes\n';
        expect(issueRelationshipFromBody(`${legacy}Closes #2164`, 2164)).toBe('closes');
        expect(issueRelationshipFromBody(`${legacy}None.`, undefined)).toBeUndefined();
        expect(canonicalIssueReferenceFromBody(`${legacy}Closes #2164`, 'jcosta33/sourdaw')?.issue).toBe(2164);
        expect(() => issueRelationshipFromBody('Closes #2164', 2164)).toThrow(/exactly one Related issues section/);
        expect(() => issueRelationshipFromBody(`${legacy}Closes #2164\n${legacy}Related #2164`, 2164)).toThrow(
            /exactly one Related issues section/
        );
        expect(() =>
            issueRelationshipFromBody(`${legacy}Closes #2164\n### 📌 Related issues & additional notes\nNone.`, 2164)
        ).toThrow(/exactly one Related issues section/);
        // Reading tolerates the legacy spelling; the merge gate never does.
        expect(() =>
            assertPullRequestBody(
                '### 🎯 What does this PR do?\nsummary\n### 🧪 How to test\nsteps\n### 🖼️ Screenshots\nNone.\n' +
                    `${legacy}None.`,
                'body'
            )
        ).toThrow(/is missing: .*Related issues/);
    });

    it('tolerates extra Related lines for other issues once exactly one line names the lane issue', () => {
        const prefix = '### 📌 Related issues & additional notes\n';
        expect(issueRelationshipFromBody(`${prefix}Closes #2857\nRelated #2854\nRelated #2856`, 2857)).toBe('closes');
        expect(issueRelationshipFromBody(`${prefix}Related #2857\nRelated #2854`, 2857)).toBe('relates');
        expect(issueRelationshipFromBody(`${prefix}Related #2854\nCloses #2857`, 2857)).toBe('closes');
        expect(() => issueRelationshipFromBody(`${prefix}Related #2854\nRelated #2856`, 2857)).toThrow(
            /exactly one relationship to #2857/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2857\nRelated #2857`, 2857)).toThrow(
            /exactly one relationship to #2857/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2857\nNone.`, 2857)).toThrow(
            /exactly one relationship to #2857/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2854\nRelated #2857`, 2857)).toThrow(
            /unexpected issue-closing references/
        );
    });

    it('derives delivery authority only from one canonical same-repository relationship', () => {
        const prefix = '### 📌 Related issues & additional notes\n';
        expect(canonicalIssueReferenceFromBody(`${prefix}Closes #2164`, 'jcosta33/sourdaw')).toEqual({
            issue: 2164,
            relationship: 'closes',
        });
        expect(canonicalIssueReferenceFromBody(`${prefix}Closes JCOSTA33/SOURDAW#2164`, 'jcosta33/sourdaw')).toEqual({
            issue: 2164,
            relationship: 'closes',
        });
        expect(canonicalIssueReferenceFromBody(`${prefix}Related #2164`, 'jcosta33/sourdaw')).toEqual({
            issue: 2164,
            relationship: 'relates',
        });
        expect(canonicalIssueReferenceFromBody(`${prefix}None.`, 'jcosta33/sourdaw')).toBeUndefined();
        expect(() =>
            canonicalIssueReferenceFromBody(`${prefix}Closes other/repository#2164`, 'jcosta33/sourdaw')
        ).toThrow(/must target jcosta33\/sourdaw/);
        expect(() => canonicalIssueReferenceFromBody(`${prefix}Closes #90071992547409930`, 'jcosta33/sourdaw')).toThrow(
            /safe positive integer/
        );
    });

    it.each(['Fixes #2164', 'closes #2164', 'Closes: #2164'])('rejects non-canonical delivery authority %s', (line) => {
        const prefix = '### 📌 Related issues & additional notes\n';
        expect(() => canonicalIssueReferenceFromBody(`${prefix}${line}`, 'jcosta33/sourdaw')).toThrow(/canonical/);
    });

    it('rejects closing authority outside the canonical Related issues section', () => {
        const prefix = '### 📌 Related issues & additional notes\n';
        expect(() => canonicalIssueReferenceFromBody(`Fixes #99\n${prefix}Closes #2164`, 'jcosta33/sourdaw')).toThrow(
            /unexpected issue-closing references/
        );
    });

    it('round-trips one exact immutable delivery receipt and rejects malformed variants', () => {
        const payload = {
            pullRequest: 2495,
            head: '3fc61d12acb110faba1a15e251268a1a7d09be9d',
            bodySha256: 'a'.repeat(64),
            closingIssue: 2406,
        };
        const receipt = composeDeliveryReceipt(payload);

        expect(receipt).toMatchInlineSnapshot(`
          "Delivery receipt for PR #2495.

          - Head: \`3fc61d12acb110faba1a15e251268a1a7d09be9d\`
          - Pull request body SHA-256: \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`
          - Closing issue: #2406

          <!-- sourdaw-delivery-receipt:v2
          pull-request: 2495
          head: 3fc61d12acb110faba1a15e251268a1a7d09be9d
          body-sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          closing-issue: 2406
          -->"
        `);
        expect(parseDeliveryReceipt(receipt)).toEqual({ ...payload, schemaVersion: 2 });
        expect(parseDeliveryReceipt('ordinary PR comment')).toBeUndefined();
        expect(() =>
            parseDeliveryReceipt(receipt.replace('closing-issue: 2406', 'closing-issue: 90071992547409930'))
        ).toThrow(/safe positive integer/);
        expect(() => parseDeliveryReceipt(receipt.replace('body-sha256:', 'body-digest:'))).toThrow(
            /invalid delivery receipt/
        );
    });

    it.each([
        [
            'unsupported hidden v3 receipt',
            [
                'Delivery receipt for PR #2495.',
                '',
                '- Head: `3fc61d12acb110faba1a15e251268a1a7d09be9d`',
                `- Pull request body SHA-256: \`${'a'.repeat(64)}\``,
                '- Closing issue: #2406',
                '',
                '<!-- sourdaw-delivery-receipt:v3',
                'pull-request: 2495',
                'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
                `body-sha256: ${'a'.repeat(64)}`,
                'closing-issue: 2406',
                '-->',
            ].join('\n'),
        ],
        [
            'misplaced legacy v1 marker after visible text',
            [
                'Delivery receipt for PR #2495.',
                '',
                '- Head: `3fc61d12acb110faba1a15e251268a1a7d09be9d`',
                `- Pull request body SHA-256: \`${'a'.repeat(64)}\``,
                '- Closing issue: #2406',
                '',
                '<!-- sourdaw-delivery-receipt:v1',
                'pull-request: 2495',
                'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
                `body-sha256: ${'a'.repeat(64)}`,
                'closing-issue: 2406',
                '-->',
            ].join('\n'),
        ],
        ['reserved namespace in ordinary text', 'ordinary note about sourdaw-delivery-receipt:v9 receipts'],
    ])('fails closed on reserved delivery receipt markers: %s', (_label, malformedReceipt) => {
        expect(() => parseDeliveryReceipt(malformedReceipt)).toThrow(/unsupported delivery receipt/);
    });

    it.each(['unstable', 'skipped'] as const)(
        'round-trips an advisory delivery receipt that records a %s aggregate CI state',
        (observedCiState) => {
            const payload = {
                pullRequest: 2495,
                head: '3fc61d12acb110faba1a15e251268a1a7d09be9d',
                bodySha256: 'a'.repeat(64),
                closingIssue: 2406,
                ciAdmissionMode: 'advisory' as const,
                observedCiState,
            };
            const receipt = composeDeliveryReceipt(payload);

            expect(receipt).toContain('- CI admission: advisory');
            expect(receipt).toContain(`- Observed CI state: ${observedCiState}`);
            expect(receipt).toContain(`observed-ci-state: ${observedCiState}`);
            expect(parseDeliveryReceipt(receipt)).toEqual({ ...payload, schemaVersion: 2 });
        }
    );

    it('keeps parsing legacy v1 delivery receipts byte-for-byte', () => {
        const legacy = [
            '<!-- sourdaw-delivery-receipt:v1',
            'pull-request: 2495',
            'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
            `body-sha256: ${'a'.repeat(64)}`,
            'closing-issue: 2406',
            '-->',
        ].join('\n');

        expect(parseDeliveryReceipt(legacy)).toEqual({
            schemaVersion: 1,
            pullRequest: 2495,
            head: '3fc61d12acb110faba1a15e251268a1a7d09be9d',
            bodySha256: 'a'.repeat(64),
            closingIssue: 2406,
        });
    });

    it('rejects a v2 receipt whose visible lines drift from the hidden envelope', () => {
        const payload = {
            pullRequest: 2495,
            head: '3fc61d12acb110faba1a15e251268a1a7d09be9d',
            bodySha256: 'a'.repeat(64),
            closingIssue: 2406,
        };
        const drifted = composeDeliveryReceipt(payload).replace('- Closing issue: #2406', '- Closing issue: #2407');

        expect(drifted).toContain('closing-issue: 2406');
        expect(() => parseDeliveryReceipt(drifted)).toThrow(/non-canonical delivery receipt/);
    });

    it('rejects a legacy v1 receipt whose numbers survive the pattern but not safe-integer validation', () => {
        const legacy = [
            '<!-- sourdaw-delivery-receipt:v1',
            'pull-request: 9007199254740993',
            'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
            `body-sha256: ${'a'.repeat(64)}`,
            'closing-issue: 2406',
            '-->',
        ].join('\n');

        expect(() => parseDeliveryReceipt(legacy)).toThrow(/safe positive integer/);
    });

    it.each([
        [
            'advisory mode without observed state',
            [
                'Delivery receipt for PR #2495.',
                '',
                '- Head: `3fc61d12acb110faba1a15e251268a1a7d09be9d`',
                `- Pull request body SHA-256: \`${'a'.repeat(64)}\``,
                '- Closing issue: #2406',
                '- CI admission: advisory',
                '',
                '<!-- sourdaw-delivery-receipt:v2',
                'pull-request: 2495',
                'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
                `body-sha256: ${'a'.repeat(64)}`,
                'closing-issue: 2406',
                'ci-admission-mode: advisory',
                '-->',
            ].join('\n'),
            /advisory mode requires an observed CI state/,
        ],
        [
            'required mode with observed state',
            [
                'Delivery receipt for PR #2495.',
                '',
                '- Head: `3fc61d12acb110faba1a15e251268a1a7d09be9d`',
                `- Pull request body SHA-256: \`${'a'.repeat(64)}\``,
                '- Closing issue: #2406',
                '- CI admission: required',
                '',
                '<!-- sourdaw-delivery-receipt:v2',
                'pull-request: 2495',
                'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
                `body-sha256: ${'a'.repeat(64)}`,
                'closing-issue: 2406',
                'ci-admission-mode: required',
                'observed-ci-state: failed',
                '-->',
            ].join('\n'),
            /required mode cannot carry an advisory CI state/,
        ],
        [
            'observed state without mode',
            [
                'Delivery receipt for PR #2495.',
                '',
                '- Head: `3fc61d12acb110faba1a15e251268a1a7d09be9d`',
                `- Pull request body SHA-256: \`${'a'.repeat(64)}\``,
                '- Closing issue: #2406',
                '',
                '<!-- sourdaw-delivery-receipt:v2',
                'pull-request: 2495',
                'head: 3fc61d12acb110faba1a15e251268a1a7d09be9d',
                `body-sha256: ${'a'.repeat(64)}`,
                'closing-issue: 2406',
                'observed-ci-state: failed',
                '-->',
            ].join('\n'),
            /invalid delivery receipt|observed CI state requires an admission mode/,
        ],
    ])('rejects malformed raw v2 delivery receipts: %s', (_label, malformedReceipt, expectedError) => {
        expect(() => parseDeliveryReceipt(malformedReceipt)).toThrow(expectedError);
    });

    it('rejects hidden GitHub closing references', () => {
        expect(() => composePublishBody(2164, TITLE, 'feat(vcs): fixes #99', TEST_INSTRUCTIONS, 'relates')).toThrow(
            /unexpected issue-closing references/
        );
        expect(() => composePublishBody(2164, TITLE, 'feat(vcs): closes owner/repo#99', TEST_INSTRUCTIONS)).toThrow(
            /unexpected issue-closing references/
        );
        expect(() => composePublishBody(2164, TITLE, 'feat(vcs): closes: #99', TEST_INSTRUCTIONS, 'relates')).toThrow(
            /unexpected issue-closing references/
        );
        expect(() =>
            composePublishBody(2164, TITLE, 'feat(vcs): closes : #99', TEST_INSTRUCTIONS, 'relates')
        ).not.toThrow();
        expect(() =>
            composePublishBody(
                undefined,
                TITLE,
                'feat(vcs): resolves https://github.com/owner/repo/issues/99',
                TEST_INSTRUCTIONS
            )
        ).not.toThrow();
    });

    it('refuses closing keywords in the summary naming the offending phrase and rule', () => {
        expect(() => composePublishBody(2164, TITLE, 'Addresses defect (closes #2174)', TEST_INSTRUCTIONS)).toThrow(
            'pull-request body contains unexpected issue-closing references ("closes #2174"). ' +
                'GitHub closing keywords (close, fix, resolve #<issue>) in pull-request descriptions auto-close issues on merge; ' +
                'remove the keyword from prose or rephrase.'
        );
    });

    it('composes a nonempty Related issues section when no issue is given', () => {
        const body = composePublishBody(undefined, TITLE, SUMMARY, TEST_INSTRUCTIONS);
        expect(body).not.toContain('Closes #');
        expect(body.slice(body.indexOf('### 📌 Related issues & additional notes')).trim()).toBe(
            '### 📌 Related issues & additional notes\nNone.'
        );
        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it.each([
        ['missing heading', '### 🎯 What does this PR do?\nChange.\n'],
        ['empty section', composePublishBody(1, 'feat: x', SUMMARY, TEST_INSTRUCTIONS).replace(TEST_INSTRUCTIONS, '')],
        ['oversized', `${composePublishBody(1, 'feat: x', SUMMARY, TEST_INSTRUCTIONS)}${'a'.repeat(4000)}`],
    ])('rejects a %s body', (_case, body) => {
        expect(() => assertPullRequestBody(body, 'body')).toThrow(/body/);
    });

    it('accepts a body with no Screenshots heading at all', () => {
        const body = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\nCloses #1\n`;

        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it.each(REQUIRED_BODY_HEADINGS)('still refuses a body missing %s, naming it', (heading) => {
        const full = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\nCloses #1\n`;
        const without = full.replace(`${heading}\n`, '');

        expect(refusal(() => assertPullRequestBody(without, 'body'))).toBe(`body is missing: ${heading}`);
    });

    it('still terminates a required section at the retired Screenshots heading', () => {
        // Bodies published before the template dropped Screenshots still carry it. If it stopped
        // bounding sections, How-to-test's content span would run past it to Related issues and
        // swallow `### 🖼️ Screenshots\nNone.`, so an empty How-to-test section would read as full
        // and merge.
        const body = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\n\n${SCREENSHOTS_HEADING}\nNone.\n\n${RELATED_HEADING}\nCloses #1\n`;

        expect(refusal(() => assertPullRequestBody(body, 'body'))).toBe(`body section is empty: ${HOW_HEADING}`);
    });

    it('names the absent heading, not the full section that precedes it', () => {
        // The section before an absent heading has no terminator, which is not the same fact as
        // that section being empty. `pnpm deliver 2256` refused with "section is empty: How to
        // test" on a How-to-test section several sentences long; the body was missing a later
        // heading entirely.
        const body = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nSeveral sentences of real instructions.\n`;

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe(`body is missing: ${RELATED_HEADING}`);
        expect(message).not.toContain('is empty');
        expect(message).not.toContain(HOW_HEADING);
    });

    it('names the absent middle heading rather than the section before it', () => {
        const body = `${WHAT_HEADING}\nChange.\n\n${RELATED_HEADING}\nCloses #1\n`;

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe(`body is missing: ${HOW_HEADING}`);
        expect(message).not.toContain('is empty');
    });

    it('calls out-of-order headings out of order rather than empty', () => {
        // Every heading is present and every section is full; only their order is wrong. Deriving a
        // section's end from the next heading's position makes the earlier one look unterminated.
        const body = `${RELATED_HEADING}\nCloses #1\n\n${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n`;

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe('body sections are out of order');
        expect(message).not.toContain('is empty');
    });

    it('names the empty section, and never reports it as missing', () => {
        const body = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\n\n`;

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe(`body section is empty: ${RELATED_HEADING}`);
        expect(message).not.toContain('is missing');
    });

    it('builds agent branch names and rejects bad slugs', () => {
        expect(laneBranchName(12, 'beat')).toBe('agent/12/beat');
        expect(laneBranchName(12, 'work')).toBe('agent/12/work');
        expect(() => assertLaneSlug('Work')).toThrow(/slug/);
        expect(() => assertLaneSlug('agent')).not.toThrow();
    });

    it('drops the issue segment from the branch name when no issue is given', () => {
        expect(laneBranchName(undefined, 'work')).toBe('agent/work');
        expect(laneBranchName(undefined, 'lane-issue-optional')).toBe('agent/lane-issue-optional');
    });

    it('rejects a purely numeric slug that would be read as an issue number', () => {
        expect(() => assertLaneSlug('2206')).toThrow(/purely numeric/);
        expect(() => assertLaneSlug('0')).toThrow(/purely numeric/);
        expect(() => assertLaneSlug('sprint-2206')).not.toThrow();
    });

    /**
     * `pr:supersede` writes this comment and `lane:remove` reads it back to decide whether a closed
     * lane may be deleted. The two only agree because they share this pair, so the round trip is
     * the contract, not the literal.
     */
    it('round-trips the supersession receipt it writes', () => {
        expect(supersessionCommentBody(2398)).toBe('Superseded by #2398.');
        expect(supersessionReplacement(supersessionCommentBody(2398))).toBe(2398);
    });

    it.each([
        ['a bare Done reply', 'Done'],
        ['prose that merely mentions a supersession', 'This was superseded by #12, see there.'],
        ['a receipt with trailing commentary', 'Superseded by #12. Please look there.'],
        ['a receipt with a leading quote', '> Superseded by #12.'],
        ['a receipt with no terminating period', 'Superseded by #12'],
        ['a receipt naming pull request zero', 'Superseded by #0.'],
        ['a receipt naming no pull request', 'Superseded by #.'],
    ])('reads no replacement out of %s', (_case, body) => {
        expect(supersessionReplacement(body)).toBeUndefined();
    });

    it('rethrows the given message from fail', () => {
        expect(() => fail('boom')).toThrow(/boom/);
    });

    it('composes the three fields into one space-joined body', () => {
        expect(composeReviewCommentBody({ defect: 'Defect.', consequence: 'Consequence.', done: 'Done.' })).toBe(
            'Defect. Consequence. Done.'
        );
    });

    it('accepts a one-sentence-per-field comment the old sentence floor would have rejected', () => {
        // Each field is a single sentence with no internal period, so the retired sentence-splitting
        // rule would have counted one sentence overall and refused it. The field contract accepts it
        // because every field is present, not because of how many sentences it reads as. Each field
        // also gains its own terminal period, since none supplied one.
        const content: ReviewCommentContent = {
            defect: 'The gate accepts a coerced review state',
            consequence: 'A silently coerced review could still report success',
            done: 'Compare the recorded state against the requested event',
        };
        expect(composeReviewCommentBody(content)).toBe(
            'The gate accepts a coerced review state. A silently coerced review could still report success. Compare the recorded state against the requested event.'
        );
    });

    it('appends a period to a field with no terminal punctuation', () => {
        expect(composeReviewCommentBody({ defect: 'Bad thing', consequence: 'Breaks stuff', done: 'Fix it' })).toBe(
            'Bad thing. Breaks stuff. Fix it.'
        );
    });

    it('preserves a field already ending in terminal punctuation, including a question', () => {
        expect(
            composeReviewCommentBody({
                defect: 'Is this intentional?',
                consequence: 'Ship it!',
                done: 'Confirm the intent.',
            })
        ).toBe('Is this intentional? Ship it! Confirm the intent.');
    });

    it('does not append a second period after a closing quote that already ends in terminal punctuation', () => {
        expect(composeReviewCommentBody({ defect: 'It says "do X."', consequence: 'b', done: 'c' })).toBe(
            'It says "do X." b. c.'
        );
    });

    it('treats an ellipsis as terminal punctuation', () => {
        expect(composeReviewCommentBody({ defect: 'It trails off…', consequence: 'b', done: 'c' })).toBe(
            'It trails off… b. c.'
        );
    });

    it('prefixes failure messages with a custom context', () => {
        expect(() =>
            composeReviewCommentBody({ defect: '', consequence: 'c', done: 'd' }, 'review.json comments[2]')
        ).toThrow(/review\.json comments\[2\] defect is empty/);
    });

    it.each([
        ['defect', { defect: '', consequence: 'c', done: 'd' }],
        ['consequence', { defect: 'a', consequence: '', done: 'd' }],
        ['done', { defect: 'a', consequence: 'b', done: '' }],
    ])('fails when %s is blank', (field, content) => {
        expect(() => composeReviewCommentBody(content)).toThrow(new RegExp(`review comment ${field} is empty`));
    });

    it.each([
        ['defect', { defect: 'a\nb', consequence: 'c', done: 'd' }],
        ['consequence', { defect: 'a', consequence: 'b\nc', done: 'd' }],
        ['done', { defect: 'a', consequence: 'b', done: 'c\nd' }],
    ])('fails when %s contains a newline', (field, content) => {
        expect(() => composeReviewCommentBody(content)).toThrow(new RegExp(`review comment ${field} must be one line`));
    });

    it.each([
        ['CR', 'a\rb'],
        ['U+2028 line separator', 'a\u2028b'],
        ['U+2029 paragraph separator', 'a\u2029b'],
    ])('fails when defect contains an interior %s', (_label, defect) => {
        expect(() => composeReviewCommentBody({ defect, consequence: 'c', done: 'd' })).toThrow(
            /review comment defect must be one line/
        );
    });

    it('fails when a field has leading or trailing whitespace', () => {
        expect(() => composeReviewCommentBody({ defect: ' a', consequence: 'b', done: 'c' })).toThrow(
            /review comment defect has leading or trailing whitespace/
        );
        expect(() => composeReviewCommentBody({ defect: 'a', consequence: 'b', done: 'c ' })).toThrow(
            /review comment done has leading or trailing whitespace/
        );
    });

    it('reports whitespace, not a line break, when a field has both a trailing space and an interior newline', () => {
        // Pins the evaluation order: whitespace is checked first, so a field with both defects is
        // reported for the whitespace, not the line break — never leaving that order incidental.
        expect(() => composeReviewCommentBody({ defect: 'a\nb ', consequence: 'c', done: 'd' })).toThrow(
            /review comment defect has leading or trailing whitespace/
        );
    });

    it('fails when the composed body exceeds the byte limit', () => {
        const longField = 'x'.repeat(300);
        expect(() => composeReviewCommentBody({ defect: longField, consequence: longField, done: longField })).toThrow(
            new RegExp(`exceeding the ${REVIEW_COMMENT_MAX_BYTES}-byte limit`)
        );
    });

    it('fails on a multi-byte UTF-8 body that is under the limit in characters but over it in bytes', () => {
        // Each euro sign is one character but three UTF-8 bytes, so this body reads as well under the
        // limit by character count while its true byte length exceeds it — proof the check counts bytes.
        const content: ReviewCommentContent = {
            defect: '€'.repeat(100),
            consequence: '€'.repeat(100),
            done: 'd',
        };
        const composed = `${content.defect} ${content.consequence} ${content.done}`;
        expect(composed.length).toBeLessThan(REVIEW_COMMENT_MAX_BYTES);
        expect(() => composeReviewCommentBody(content)).toThrow(
            new RegExp(`exceeding the ${REVIEW_COMMENT_MAX_BYTES}-byte limit`)
        );
    });

    it('accepts a body exactly at the byte limit', () => {
        // Each field already ends in a period, so normalization does not touch it, and the raw field
        // lengths plus the two separating spaces are independently checked against the limit — not
        // derived from whatever composeReviewCommentBody happens to return — so a composer that drops
        // a separator, or measures only the fields, cannot pass this by accident.
        const defect = `${'a'.repeat(199)}.`;
        const consequence = `${'b'.repeat(199)}.`;
        const done = `${'c'.repeat(197)}.`;
        expect(defect.length + consequence.length + done.length + 2).toBe(REVIEW_COMMENT_MAX_BYTES);

        const composed = composeReviewCommentBody({ defect, consequence, done });

        expect(composed).toBe(`${defect} ${consequence} ${done}`);
        expect(Buffer.byteLength(composed, 'utf8')).toBe(REVIEW_COMMENT_MAX_BYTES);
    });

    it('rejects a body one byte over the limit', () => {
        const defect = `${'a'.repeat(200)}.`;
        const consequence = `${'b'.repeat(199)}.`;
        const done = `${'c'.repeat(197)}.`;
        expect(defect.length + consequence.length + done.length + 2).toBe(REVIEW_COMMENT_MAX_BYTES + 1);

        expect(() => composeReviewCommentBody({ defect, consequence, done })).toThrow(
            new RegExp(`exceeding the ${REVIEW_COMMENT_MAX_BYTES}-byte limit`)
        );
    });
});

describe('product-scope test instructions', () => {
    // The gate's refusal, imported rather than copied: the exported literal is the single owner,
    // so rewording it reddens every pin in this file and in publishLane.spec.ts from one place.
    const REFUSAL = CHECK_NARRATION_TEST_INSTRUCTIONS_REFUSAL;
    // The refusal is the fixed sentence followed by the judged segments, so a verdict pin matches
    // the sentence as the message's prefix and the quoting pins below own the rest.
    const REFUSAL_PREFIX = new RegExp(`^${REFUSAL.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

    /**
     * The full head inventory, spec-owned on purpose: dropping any head reddens the equality pin.
     * For a bare head the behavioral iteration reddens too — a second net. For a colon-bearing
     * head the equality pin is the only net: the dropped head's line still refuses, because the
     * slash/colon path rule classifies it as command material regardless.
     */
    const COMMAND_HEADS_UNDER_TEST = [
        'bash',
        'biome',
        'bun',
        'cargo',
        'cat',
        'cd',
        'cmake',
        'curl',
        'deno',
        'diff',
        'docker',
        'dotnet',
        'echo',
        'electron',
        'electron-builder',
        'env',
        'eslint',
        'find',
        'flutter',
        'format',
        'gh',
        'git',
        'go',
        'gradle',
        'grep',
        'guard',
        'head',
        'jest',
        'knip',
        'less',
        'lint',
        'ls',
        'make',
        'mvn',
        'node',
        'npm',
        'npx',
        'oxlint',
        'pip',
        'pnpm',
        'playwright',
        'prettier',
        'pytest',
        'python',
        'python3',
        'rg',
        'rustc',
        'sh',
        'sort',
        'tail',
        'tee',
        'test:barrel-mocks',
        'test:e2e',
        'test:run',
        'deps:validate',
        'tsx',
        'tsc',
        'typecheck',
        'uv',
        'vite',
        'vitest',
        'wasm:all',
        'wasm-bindgen',
        'wasm-pack',
        'wasm:verify',
        'wc',
        'which',
        'xargs',
        'yarn',
    ];

    it('pins the command-head inventory the narration gate classifies by', () => {
        expect([...COMMAND_HEADS]).toEqual(COMMAND_HEADS_UNDER_TEST);
    });

    it.each(COMMAND_HEADS_UNDER_TEST)('refuses the annotation-only inventory line for the %s head', (head) => {
        const line = `${head} run all (green)`;

        expect(testInstructionsNarrateChecks(line)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(line))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a pure command list', () => {
        const list = ['- `pnpm test:run scripts/__tests__/x.spec.ts` (140 passed)', '- `pnpm typecheck` (clean)'].join(
            '\n'
        );

        expect(testInstructionsNarrateChecks(list)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(list))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses an inventory whose lead is an ordinary shell-tool sweep', () => {
        // The head inventory is the un-gating boundary: an unlisted tool word lands as prose and
        // rescues its own line, laundering the whole inventory behind it.
        const sweep = "- grep -rn 'handleClip' src/modules/ (ok)\n- pnpm typecheck (clean)";

        expect(testInstructionsNarrateChecks(sweep)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(sweep))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses one semicolon-joined line of commands', () => {
        const line = 'pnpm test:run src/x.spec.ts; pnpm typecheck; pnpm lint';

        expect(testInstructionsNarrateChecks(line)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(line))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses numbered lines whose commands ride in backticks behind a filler word', () => {
        // "Run" is filler and the backtick span is the classified content, so `1. Run `pnpm …``
        // is narration like the bare command would be — the markers never rescue it.
        const steps = ['1. Run `pnpm test:run x`', '2. Run `pnpm typecheck`'].join('\n');

        expect(testInstructionsNarrateChecks(steps)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(steps))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses filler-led segments alongside command-led ones', () => {
        const mixed = ['- `pnpm lint` (clean)', '- same for pnpm typecheck:test (OK)'].join('\n');

        expect(testInstructionsNarrateChecks(mixed)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(mixed))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a bare tool head with a colon', 'vitest: run every suite'],
        ['a bare compiler head', 'tsc --noEmit'],
        ['a tool head with a conjunction', 'lint + format the touched modules'],
        ['a guard invocation', 'guard --profile focused -- pnpm test:run scripts/x.spec.ts'],
        // Deliberately redundant: the subcommand slot drops './scripts/seed' as the token at
        // index 1 behind 'node', and the slash rule drops it as a command token either way, so
        // no single-rule deletion reddens this fixture.
        ['a launch of an extension-less path', 'node ./scripts/seed'],
    ])('refuses %s as the only content', (_label, instructions) => {
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a prose-position slash token only through the path rule', () => {
        // Outside any argument run, 'web/console' survives into the remainder as a plain word
        // unless the slash rule drops it — deleting that rule turns it into a rescuing noun and
        // reddens this fixture.
        const line = 'the web/console spec and pnpm lint (clean)';

        expect(testInstructionsNarrateChecks(line)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(line))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a package-manager exec chain', 'pnpm exec cargo build'],
        ['an exec chain seeding through a script', 'pnpm exec tsx scripts/seed.ts seed-project'],
        ['a commit message quoted in single quotes', "git commit -m 'add the drag handle'"],
        ['a commit message quoted in double quotes', 'git commit -m "add the drag handle"'],
    ])('refuses %s', (_label, instructions) => {
        // A head inside the argument run is command material the run continues through, and prose
        // quoted inside the run drops with the run in every shell quote kind — neither can rescue
        // the launch it belongs to.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a python one-liner with a quoted semicolon', 'python -c "import json; print(1)"'],
        ['a commit message carrying a quoted semicolon', 'git commit -m "fix the handle; add tests"'],
        ['a node one-liner with a single-quoted semicolon', "node -e 'process.exit(1); console.log(2)'"],
    ])('refuses %s', (_label, instructions) => {
        // The segment split separates only on '.'/';' outside a quoted span — all three quote
        // kinds — so a separator inside the quoted argument cannot manufacture a launch-less
        // fragment whose stray words rescue the line. The double-quoted pair and the single-quoted
        // node shape each redden the deletion of their own quote kind's tracking in
        // splitOutsideQuotedSpans.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a rebuild-and-verify command pair', 'pnpm wasm:all\npnpm wasm:verify'],
        [
            'a spec path whose own name carries an observation stem',
            'pnpm test:run src/modules/BrowserAi/repositories/__tests__/checkModelCached.spec.ts (green)\n' +
                'pnpm typecheck (clean)',
        ],
        ['a seeded spec path', 'pnpm test:run src/utils/seedProject.spec.ts'],
    ])('refuses %s', (_label, instructions) => {
        // The stems ride inside command tokens — the colon suffix, the path — which the remainder
        // drops before any cue or vocabulary test sees them, so these stay narration.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a script-name continuation', 'pnpm test:run everything (140 passed)'],
        ['the same launch quoted', '`pnpm test:run everything` (140 passed)'],
        ['a spec-file argument', 'pnpm test:run x.spec.ts (140 passed)'],
    ])('refuses %s', (_label, instructions) => {
        // The colon-bearing head is the same launch's script name: the argument run continues
        // through it, so the bare arguments behind it stay narration.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['annotation words leading into a launch', 'Run the suite `pnpm test:run x.spec.ts`'],
        [
            'annotation words leading into two launches',
            'Run the focused suite with `pnpm test:run x.spec.ts` then `pnpm typecheck` (clean)',
        ],
    ])('refuses %s', (_label, instructions) => {
        // Annotation vocabulary between the filler and the launch must not defeat the head check:
        // a head anywhere in an all-annotation segment narrates it.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('strips see-verb annotations and keeps a see-verb step that carries its own verb', () => {
        const annotation = '`pnpm test:run x.spec.ts` (expected: 140 passed)';
        const stripped = '`pnpm typecheck` (see CI)';
        const step = 'See the channel meter follow the level';

        expect(testInstructionsNarrateChecks(annotation)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(annotation))).toMatch(REFUSAL_PREFIX);
        expect(testInstructionsNarrateChecks(stripped)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(stripped))).toMatch(REFUSAL_PREFIX);
        // Without a see stem, a see-verb observation is rescued by its leading non-head word.
        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it.each([
        ['a wasm-pack build', 'wasm-pack build crates/audio-engine'],
        // './scripts/seed' is not extension-shaped — its only dot is leading, with no trailing
        // dot-letters — so this fixture singly pins the slash rule; the extension rule's nets are
        // the '.env' and 'data.json' leads below.
        ['a dotted script path', './scripts/seed'],
        ['a dotted script path behind a launch', 'node ./scripts/seed'],
        // The extension rule through a dot-led shape: '.env' ends in dot-plus-letters with no
        // slash, so only FILE_EXTENSION_SUFFIX makes it command material.
        ['a dot-led env file', '.env lint all (clean)'],
        // The extension rule through a plain filename lead: 'data.json' carries no slash or dot
        // prefix, so deleting FILE_EXTENSION_SUFFIX leaves it a prose word that rescues.
        ['a data-file lead', 'data.json lint all (green)'],
    ])('refuses %s', (_label, instructions) => {
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a launched extension-bearing data file', () => {
        const line = 'node data.json (green)';

        expect(testInstructionsNarrateChecks(line)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(line))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a status copula after the launch', '`pnpm typecheck` is clean'],
        ['a copula pair joined by a semicolon', '`pnpm lint` is green; `pnpm typecheck` is green'],
        ['an exec flow into a suite that passes', 'cargo test -p audio-engine and the suite passes'],
        [
            'a guard invocation with an all-annotation tail',
            'pnpm guard --profile focused -- pnpm test:run x.spec.ts, all green, as expected',
        ],
        ['a suite narration closed with a pronoun status clause', 'run the suite `pnpm lint` and it is clean'],
    ])('refuses %s', (_label, instructions) => {
        // Status companions like 'passes' and 'as expected' are vocabulary the run's trailing
        // rule treats as annotation, and a pronoun clause like 'it is clean' is annotation behind
        // a launch the run never opened — either way the segment keeps narrating instead of
        // ending in a rescuing word.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a bare launch quoted or bare, subcommand and all', () => {
        // The token after a leading command head is that launch's subcommand, so quoting the
        // launch cannot change the verdict — and 'pnpm build' refuses the same way.
        for (const launch of ['pnpm dev', '`pnpm dev`', 'pnpm build']) {
            expect(testInstructionsNarrateChecks(launch)).toBe(true);
            expect(refusal(() => assertObservableTestInstructions(launch))).toMatch(REFUSAL_PREFIX);
        }
    });

    it('passes a bare launch whose argument run flows into a step', () => {
        // 'dev' is the launch's subcommand slot and drops; the run ends at the vocabulary word
        // 'and', and the drag cue rescues the rest.
        const step = 'pnpm dev and drag a clip onto a lane, it lands quantized';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('passes an exec chain flowing into a step with in-run cue words', () => {
        // 'exec' is the subcommand slot and 'playwright' a head inside the run — both command
        // material the run continues through; 'open' is the cue word that ends the run and is
        // kept, so the rest of the step rescues the segment.
        const step = 'pnpm exec playwright open the app and see the mixer render';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it.each([
        ['a watch launch ending in its own cue-stemmed argument', 'gh run watch'],
        ['a checks launch trailing the same argument', 'gh pr checks watch'],
        ['an exec chain ending at its cue-word argument', 'pnpm exec playwright open'],
        ['an inventory led by one of those launches', '- gh run watch (green)\n- pnpm typecheck (clean)'],
    ])('refuses %s', (_label, instructions) => {
        // A run-ending vocabulary-or-cue word rescues only when material follows it: as the
        // segment's last token it is the command's trailing argument and drops, and a word
        // followed by nothing but annotation drops with it — while 'open' above keeps the
        // segment's rescue because the step's words follow it.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses the ast-grep form the repository mandates', () => {
        // After the exec slot, 'run' names the ast-grep subcommand whose flags count as command
        // material: command material directly behind a run-ending word keeps the argument run
        // open, so '--lang' and 'src' can never leak out as rescuing prose — while 'pnpm run
        // build' and 'gh run watch' still refuse through their subcommand slot and the launched
        // drag step still passes.
        const line = "pnpm exec ast-grep run --lang ts -p 'executeAppAction($$$ARGS)' src";

        expect(testInstructionsNarrateChecks(line)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(line))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a lane-unique port prefix', 'SOURDAW_E2E_PORT=4010 pnpm test:e2e tests/transport.spec.ts'],
        ['a CI env prefix', 'CI=true pnpm test'],
        ['a numeric env prefix', 'NO_HMR=1 pnpm dev'],
    ])('refuses %s: an env assignment cannot lead a launch as prose', (_label, instructions) => {
        // A NAME=value token is command material, so the launch behind it cannot be rescued by
        // reading the assignment as the segment's leading prose word.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a quiet oxlint sweep', 'oxlint --quiet src/modules/foo'],
        ['a python3 module launch', 'python3 -m pytest tests/'],
    ])('refuses %s', (_label, instructions) => {
        // This repository's own binaries narrate bare like every other head; the inventory
        // iteration above already reddens any dropped spelling of these two.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a run subcommand with a bare argument', 'pnpm run build'],
        ['a bare start launch', 'npm start'],
        ['a staging launch', 'git add .'],
        ['a branch switch', 'git switch main'],
        ['a report launch', 'pnpm exec playwright show-report'],
        // This repository's own wasm toolchain narrates bare: a build line with status
        // annotation must refuse like its pnpm-prefixed spelling.
        ['a bare wasm-bindgen build', 'wasm-bindgen build --target web (ok)'],
        ['a conjunction pair with an annotation tail', 'pnpm typecheck and pnpm lint, both green'],
        // A command mention behind a bare-subcommand launch's conjunction: the head drops as
        // command material and the annotation-only remainder keeps the segment narration, so the
        // loose arm of the run closer cannot launder a second command behind a conjunction.
        ['a launch with a command mention behind its conjunction', 'pnpm dev and vitest everything (green)'],
        ['a launch with a flagged command behind its conjunction', 'pnpm dev and tsc --noEmit (clean)'],
        // A run-ending word with nothing material behind it is the command's trailing argument,
        // not an observation: 'play' and 'drag' are cue stems the trailing rule drops, while
        // 'see' never reaches the cue test — it rides the annotation vocabulary, and the
        // argument-run scan drops it the same way. These shapes border the trailing-cue rule and
        // were cross-checked against an external semantic judgment before pinning.
        ['a bare cue after the launch', 'pnpm dev and play'],
        ['a comma cue with nothing behind it', 'pnpm dev, drag'],
        ['a see verb with nothing to see', 'npm start and see'],
    ])('refuses %s', (_label, instructions) => {
        // The subcommand slot drops the token behind the leading head whatever it is, and the
        // argument run behind the slot stays annotation-only — none of these teach a step.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('passes a prose-led action list as the fail-open margin', () => {
        // 'Open' is a cue leading prose, not a launch, so the segment stays prose-led and passes
        // whatever follows — the documented margin where the gate judges inventories, not quality.
        const step = 'Open the app and drag';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('refuses a launch whose annotation clause a semicolon splits off', () => {
        // The pronoun clause left behind carries no launch and narrates nothing by itself, but the
        // launch segment before the semicolon still does, and one narrating segment refuses.
        const split = 'pnpm typecheck; it is clean';

        expect(testInstructionsNarrateChecks(split)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(split))).toMatch(REFUSAL_PREFIX);
    });

    it('keeps noun-clause parentheticals that name UI state', () => {
        // A parenthetical whose content is not pure annotation keeps its content in the prose, and
        // the nouns beyond the vocabulary rescue the segment. The short twin has no vocabulary
        // word left to rescue through: its article itself ends the argument run (the kept
        // parenthetical's edge punctuation strips away) with the material noun 'clip' behind it.
        const tracks = '1. `pnpm dev` (the level meter tracks the input)';
        const lands = '1. `pnpm dev` (the clip lands quantized to the grid)';
        const landsShort = '1. `pnpm dev` (the clip lands quantized)';

        expect(testInstructionsNarrateChecks(tracks)).toBe(false);
        expect(() => assertObservableTestInstructions(tracks)).not.toThrow();
        expect(testInstructionsNarrateChecks(lands)).toBe(false);
        expect(() => assertObservableTestInstructions(lands)).not.toThrow();
        expect(testInstructionsNarrateChecks(landsShort)).toBe(false);
        expect(() => assertObservableTestInstructions(landsShort)).not.toThrow();
    });

    it('refuses a launch whose argument run stays annotation', () => {
        const annotations = 'pnpm lint on every touched file (clean)';

        expect(testInstructionsNarrateChecks(annotations)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(annotations))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a git sync sequence', 'git fetch origin; git merge origin/main'],
        ['a make task pair', 'make test\nmake lint'],
        ['an electron launch', 'electron .'],
        ['a node script invocation', 'node scripts/check.ts'],
        // The semicolon strands the check run as a clause of its own, which the command rule
        // refuses before the check-command mention is consulted.
        ['a cargo test clause behind an app step', 'Open the mixer; cargo test passes.'],
    ])('refuses %s', (_label, instructions) => {
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('passes a manual step whose leading verb is also a command head', () => {
        // 'Format' names a command head, so the argument-run scan opens — and must close at the
        // first word a reader reads, leaving the step's nouns to rescue the segment as usual.
        const step = 'Format the disk name in the export dialog';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it.each([
        ['a MIDI step', 'Make a MIDI track'],
        ['a rename step', 'Format the clip name'],
        ['a note-taking step', 'make a note of the levels'],
        ['a shell-named sorting step', 'sort the clips by name'],
        ['a shell-named printing step', 'echo the level'],
        // The article guard consults the first token behind a head-only quoted span, so the
        // quoted spellings read their article exactly where the bare ones do; deleting that
        // probe reddens these three while 'make test' stays a launch through the pinned
        // make-task fixture.
        ['a backticked MIDI step', '`make` a MIDI track'],
        ['a backticked rename step', '`format` the clip name'],
        ['a backticked sorting step behind a filler', 'run `sort` the clips by name'],
    ])('passes a manual %s whose head-verb opens onto an article', (_label, step) => {
        // The article directly behind the peeled head keeps the argument run closed — the head is
        // the step's own verb naming its object — so the UI nouns reach the rescue check instead
        // of being eaten as the launch's arguments. A bare argument behind the same head stays a
        // launch: 'make test' and 'make lint' are pinned refusing by the make-task fixture.
        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it.each([
        ['an article naming the tested spec', 'pnpm test:run the transport spec (140 passed)'],
        ['an article naming the launched app', 'pnpm typecheck the app (clean)'],
        ['an article-led inventory', 'pnpm test:run the transport spec (140 passed)\npnpm typecheck the app (clean)'],
        ['a bare argument behind a run-closing filler', 'pnpm dlx vitest run x (green)'],
    ])(
        'refuses %s: a bare token behind a run-closing vocabulary word stays command argument',
        (_label, instructions) => {
            // Behind a launch of command machinery — a command-material subcommand slot or a head
            // dropped inside the run — the bare non-cue word behind the run-ending vocabulary word is
            // the command's own argument, not the material that closes it: these refuse where their
            // article-free twins (`pnpm test:run everything (140 passed)`, pinned above) always have.
            // Reverting the strict material rule reddens this fixture while the launched drag-step
            // pass rides its cue and clause unchanged.
            expect(testInstructionsNarrateChecks(instructions)).toBe(true);
            expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
        }
    );

    it.each([
        // A preposition behind the head takes the article guard's neighbor route: the run opens,
        // the preposition ends it as vocabulary, and the UI nouns behind rescue the step.
        ['a navigation step', 'go to the mixer'],
        ['a search step', 'find the missing plugin'],
    ])('passes a manual %s whose head-verb opens onto a preposition', (_label, step) => {
        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('passes a comma-joined observation no conjunction introduces', () => {
        const step = 'pnpm dev, drag a clip onto a lane, it lands quantized';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('passes a filler-led sentence mentioning its launch mid-prose', () => {
        // 'Run' peels as filler and the prose carries the launch mention inside the sentence,
        // with the observation trailing — a natural author phrasing whose rescue rides the
        // beyond-vocabulary nouns, not the cue stems.
        const step = 'Run the app with the flag and the meter follows';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('passes a single-quoted leading launch teaching its observation', () => {
        // The peel must treat both quote kinds as the launch's shell, so the observation after a
        // single-quoted launch rescues the segment exactly as the backtick spelling does.
        const step = "'pnpm dev' and drag a clip onto a lane, it lands quantized";

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('pairs the double quote in every quoted-span rule', () => {
        // The lead unwrap, the span removal, and the quoted-argument drop must agree on all three
        // quote kinds: a double-quoted lead is a launch shell, and a double-quoted data-file lead
        // is command material exactly like its single-quoted spelling.
        const step = '"pnpm dev" and drag a clip onto a lane, it lands quantized';

        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();

        const doubleQuotedLead = '"data.json" (green)';
        expect(testInstructionsNarrateChecks(doubleQuotedLead)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(doubleQuotedLead))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a backticked launch annotated with a bare result', '1. `pnpm typecheck` (no errors)'],
        ['a backticked launch annotated with an expectation', '1. `pnpm typecheck` (should be green)'],
        ['a backticked launch annotated with a status', '1. `pnpm lint` (still green)'],
        ['a backticked launch followed by its passing count', '1. `pnpm test:run x` — 140 passing'],
        ['a double-quoted exec chain seeding a build', '"pnpm exec" cargo build'],
        [
            'a three-line inventory of annotated launches',
            '1. `pnpm test:run scripts/__tests__/x.spec.ts` (140 passed)\n2. `pnpm typecheck` — it is clean\n3. `pnpm lint` (still green)',
        ],
    ])('refuses %s', (_label, instructions) => {
        // The launch shell never rescues its own annotations: result companions ('no errors',
        // 'should be green', 'still green', '140 passing', 'it is clean') are vocabulary the
        // remainder drops, and a quoted lead opens the argument run exactly like the bare
        // spelling — its content is the launch whose subcommand slot and arguments keep
        // narrating behind it.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a filler word joining two commands mid-segment', () => {
        const joined = 'pnpm typecheck and then pnpm lint';

        expect(testInstructionsNarrateChecks(joined)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(joined))).toMatch(REFUSAL_PREFIX);
    });

    it('reads a cue-bearing parenthetical as part of the step and a bare one as annotation', () => {
        // A parenthetical carrying an observation cue keeps its content in the prose the cue check
        // reads; a cue-free one is the annotation it looks like and strips away.
        const teaches = '1. `pnpm dev` (confirm the transport play button toggles)';
        const annotates = '`pnpm typecheck` (clean)';

        expect(testInstructionsNarrateChecks(teaches)).toBe(false);
        expect(() => assertObservableTestInstructions(teaches)).not.toThrow();
        expect(testInstructionsNarrateChecks(annotates)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(annotates))).toMatch(REFUSAL_PREFIX);
    });

    it('passes a prose step a filler word opens', () => {
        // Filler stripping must stop at a command list, not read the sentence's next word as one.
        const prose = 'Run the arrangement view at 200% zoom and confirm the new clip handle appears.';

        expect(testInstructionsNarrateChecks(prose)).toBe(false);
        expect(() => assertObservableTestInstructions(prose)).not.toThrow();
        expect(
            testInstructionsNarrateChecks('Open the arrangement view and confirm the new clip handle appears.')
        ).toBe(false);
    });

    it.each([
        ['a prose sentence narrating the specs', 'Run the focused publisher specs and confirm they pass.'],
        ['a spec path inside prose', 'The census in src/x/__tests__/census.spec.ts fails if two controls share text.'],
        ['a spec file named without its folder', 'authoredParameterGuidance.spec.ts covers every control.'],
        ['a unit-test mention', 'Unit tests cover the undo path.'],
        ['an end-to-end mention', 'The e2e smoke set exercises the mixer.'],
        ['a CI mention', 'CI runs the native graph tests on every push.'],
        ['a unit-suite mention', 'Covered by the unit suite.'],
        ['an end-to-end-suite mention', 'Covered by the end-to-end suite.'],
        ['an integration-test mention', 'Covered by integration tests.'],
        ['a mention of the existing tests', 'Covered by the existing tests.'],
        ['a test-suite mention', 'Covered by the test suite.'],
        ['a tests-folder mention with no spec filename', 'See src/modules/x/__tests__/README for context.'],
        // The runners as proper nouns: prose words rescue both sentences from the command rule,
        // so only the runner-name vocabulary refuses these two.
        ['a test-runner mention', 'Vitest covers the transport scheduler.'],
        ['a browser-runner mention', 'Covered by Playwright.'],
        // The bare plural names coverage where a bare singular names audio: only `tests` refuses.
        ['a bare plural tests mention', 'Covered by tests.'],
        ['a passing-tests claim', 'All tests pass.'],
    ])('refuses %s even with no command token', (_label, instructions) => {
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a spectrum step', 'Open the spectrum analyzer and confirm the peak sits at 1 kHz.'],
        ['ci letters inside a longer word', 'Play the acid loop and confirm the circuit saturates.'],
        // CI_WORD is case-sensitive on purpose: a lower-case standalone 'ci' is a name the step
        // types, not the pipeline.
        ['a standalone lower-case ci token', 'Rename the clip to ci and confirm the label updates.'],
        ['a special-effects step', 'Load a special preset and confirm the reverb tail rings out.'],
        // A bare 'test' qualifies nothing: a test tone or a test take is audio the reviewer
        // plays or records.
        ['a test-tone step', 'Play the test tone and confirm the meter reads -18 dBFS.'],
        ['a test-tone peak step', 'Play the test tone and confirm the meter peaks at -6 dB.'],
        ['a test-take step', 'Record a test take and confirm it lands on the take lane.'],
    ])('passes %s that only brushes the test-suite vocabulary', (_label, step) => {
        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it.each([
        [
            'a coverage note beside an app step',
            'Open the mixer and confirm the send knob reads -12 dB. Automated coverage: pnpm test:run src/modules/PunchRecording.',
        ],
        ['a developer aside naming a focused run', 'Developers can run pnpm test:run src/modules/Mixer.'],
        ['a verification claim naming two checks', 'Verified with pnpm typecheck and pnpm lint on the changed files.'],
        ['a lint claim', 'Checked with pnpm lint.'],
        ['a labelled cargo check', 'Focused checks: pnpm cargo:test --package daw-engine capture.'],
        [
            'a typecheck ahead of an app step',
            'Run pnpm typecheck, then open the mixer and confirm the send knob reads -12 dB.',
        ],
        [
            'a typecheck parenthetical inside an app step',
            'Open the mixer and confirm the hint shows (pnpm typecheck clean).',
        ],
        ['a labelled check list', 'Checks: pnpm lint, pnpm typecheck.'],
        ['a ticked checklist of checks', '- [x] pnpm lint\n- [x] pnpm typecheck'],
        ['a cargo test run inside an app step', 'Open the mixer and confirm cargo test passes.'],
        ['a playwright test run inside an app step', 'Open the mixer and confirm playwright test passes.'],
        ['a check-only tool behind an app step', 'Confirm the fader moves, then run tsc --noEmit.'],
    ])('refuses %s: a check-run mention narrates whatever prose rides beside it', (_label, instructions) => {
        // Cue words and UI nouns rescue a launch through the command rule, so these refuse only
        // through the check-command mention: no step a reviewer performs needs a check run.
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a dev launch folded into the step', 'Run pnpm dev, open the mixer, and confirm the send knob reads -12 dB.'],
        ['a parenthesized desktop launch', 'Launch the desktop app (pnpm desktop:dev) and open the mixer.'],
        ['a format verb naming its object', 'Format the clip name and confirm it reads Take 2.'],
    ])('passes %s: launches, bare format, and bare test are not check runs', (_label, step) => {
        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it('scans an unclosed-parenthesis flood in linear time and keeps flat parenthetical verdicts', () => {
        // A parenthetical match that could span another '(' rescans to the end of the value from
        // every unclosed one — quadratic, tens of seconds on this input.
        expect(testInstructionsNarrateChecks('(a '.repeat(200_000))).toBe(false);
        expect(testInstructionsNarrateChecks('`pnpm test:run everything` (140 passed)')).toBe(true);
        expect(
            testInstructionsNarrateChecks('Press the loop shortcut (Cmd+L) and confirm the loop brace appears.')
        ).toBe(false);
        expect(testInstructionsNarrateChecks('Launch the desktop app (pnpm desktop:dev) and open the mixer.')).toBe(
            false
        );
    });

    it.each([
        ['a two-step inline list', '1. Press Play. 2. Press Stop; the playhead returns to bar 1.'],
        [
            'a three-step inline list',
            "1. Record or comp a clip so its take lane holds a take, select the clip, and invoke 'Cut Clip' from the command palette. 2. Press Undo: the clip and its take lane return (previously the history was empty and undo did nothing). 3. Redo reapplies the cut.",
        ],
    ])('passes %s whose later markers strand as letter-free segments', (_label, steps) => {
        // Only a line's leading marker leaves before the sentence split, so '2' and '3' strand as
        // segments of their own; a segment with no letters names no command and never narrates.
        expect(testInstructionsNarrateChecks(steps)).toBe(false);
        expect(() => assertObservableTestInstructions(steps)).not.toThrow();
    });

    it('refuses an inline numbered list of commands', () => {
        // The letter-free guard exempts only the stranded markers: the command segments between
        // them still narrate.
        const steps = '1. pnpm lint. 2. pnpm typecheck.';

        expect(testInstructionsNarrateChecks(steps)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(steps))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        ['a navigation step', 'Go to Settings.'],
        ['a back step', 'Go back.'],
        ['a channel step naming a bare number', 'Make track 2 mono.'],
        // A letter-free token is never command-shaped evidence, even when it leads with a dash
        // the flag rule would otherwise read.
        ['a level observation naming a signed number', 'Echo at -6 dB is audible.'],
        ['a sorting step', 'Sort by name.'],
        ['a search step', 'Find Reverb.'],
        ['a display step', 'Format as bars.'],
        ['an audible-effect observation', 'Echo should be audible.'],
        ['a noise comparison', 'Less hiss than before.'],
        [
            'a step-verb sentence between app steps',
            'Open the arrangement view. Go to bar 9. Press Play; the clip starts on the downbeat.',
        ],
        // The word class decides, not the casing: a lower-case verb behind a stripped filler word
        // or opening a clause is still the step's verb.
        ['a lower-case navigation verb behind a filler word', 'Press Play. Then go to bar 9.'],
        [
            'a lower-case sorting verb opening a semicolon clause',
            'Open the browser; sort by name; the list reorders alphabetically.',
        ],
        ['a lower-case channel verb behind a filler word', 'Press Play. Then make track 2 mono.'],
        ['a lower-case navigation verb behind another filler word', 'Press Stop. Also go to bar 1.'],
    ])('passes %s whose leading verb is also a command head', (_label, step) => {
        // An English imperative head with no flag, path, colon suffix, filename, or env
        // assignment beside it is the step's verb, not a launch opening an argument run that
        // would eat the UI nouns behind it.
        expect(testInstructionsNarrateChecks(step)).toBe(false);
        expect(() => assertObservableTestInstructions(step)).not.toThrow();
    });

    it.each([
        ['a lower-case make launch', 'make test'],
        ['a capitalized launch carrying a flag', 'Cargo test --package daw-engine'],
        ['a lower-case find sweep', 'find . -name x'],
        ['a lower-case go test run', 'go test ./...'],
        // A flag beside a verb head is command-shaped evidence: the trailing non-vocabulary word
        // is the command's argument, never a UI noun that rescues a step.
        ['a verb head carrying a flag and a bare argument', 'sort -r results'],
        // The verb head still drops from the prose, so with nothing but annotation behind it the
        // head mention keeps the segment narrating.
        ['a capitalized head followed only by annotation', 'Make test'],
        // A quoted head was typed as a command, so its verb reading exempts nothing.
        ['a backticked verb-head launch', '`Make` release'],
        // Tool names are never step verbs, so a capitalized tool line classifies exactly like its
        // lower-case spelling.
        ['a lower-case tool launch', 'pnpm dev'],
        ['a capitalized tool launch', 'Pnpm dev'],
        ['a capitalized build line citing its result', 'Cargo build succeeds.'],
        ['a capitalized git line citing its result', 'Git diff is empty.'],
    ])(
        'refuses %s: the step-verb exemption needs an English verb head and no command-shaped token',
        (_label, instructions) => {
            expect(testInstructionsNarrateChecks(instructions)).toBe(true);
            expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
        }
    );

    it('passes None.', () => {
        expect(testInstructionsNarrateChecks('None.')).toBe(false);
        expect(() => assertObservableTestInstructions('None.')).not.toThrow();
    });

    it('refuses a command list that a prose line sits beside', () => {
        // The #4422 gate passed any value holding one prose sentence, so a spec run followed by a
        // sentence describing what the spec asserts published unchanged. Every segment is judged.
        const mixed = '- `pnpm lint` (clean)\n- No user-visible change; this only touches scripts.';
        const narratedCensus =
            'Run pnpm test:run src/modules/Arrangement/x.spec.ts. Open the device panel and confirm each knob reads its own hint.';

        expect(testInstructionsNarrateChecks(mixed)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(mixed))).toMatch(REFUSAL_PREFIX);
        expect(testInstructionsNarrateChecks(narratedCensus)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(narratedCensus))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a bare launch standing as its own step ahead of the app steps', () => {
        // A launch folded into the step that uses it passes (pinned below); on its own line it is
        // a command segment like any other.
        const steps = '1. pnpm dev\n2. Open the mixer and confirm the send knob reads -12 dB.';
        const capitalized = '1. Pnpm dev\n2. Open the mixer and confirm the send knob reads -12 dB.';

        expect(testInstructionsNarrateChecks(steps)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(steps))).toMatch(REFUSAL_PREFIX);
        expect(testInstructionsNarrateChecks(capitalized)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(capitalized))).toMatch(REFUSAL_PREFIX);
    });

    it.each([
        [
            'a launch that teaches its observation behind a comma',
            'Run `pnpm dev` and confirm the transport play button toggles.',
        ],
        [
            'a backticked launch followed by observation clauses',
            '`pnpm dev`, open the arrangement view, confirm the fader renders',
        ],
        [
            'a numbered step pairing the command with its observation',
            '1. `pnpm dev` then open the arrangement view and confirm the new clip handle appears',
        ],
        [
            'a numbered step pairing the launch with a drag observation',
            '1. `pnpm dev` and drag a clip onto a lane, the clip lands quantized to the grid',
        ],
        [
            'a numbered step pairing the launch with a listening check',
            '1. `pnpm dev`, play the transport from bar 1, audio starts at the set tempo',
        ],
        ['a launched observation whose nouns inflect the cue stems', 'Run `pnpm dev` and confirm playback starts'],
    ])('passes %s', (_label, instructions) => {
        // The launch head alone does not make these narration: each teaches what to observe, so
        // the remainder rule keeps them acceptable for a product-scope change.
        expect(testInstructionsNarrateChecks(instructions)).toBe(false);
        expect(() => assertObservableTestInstructions(instructions)).not.toThrow();
    });

    it('drops empty segments from separators and blank lines instead of counting them', () => {
        // Whitespace-only text has no segment at all, so it is not command narration — the emptiness
        // gate lives in composePublishBody, not here.
        expect(testInstructionsNarrateChecks('   \n\t  ')).toBe(false);
        expect(testInstructionsNarrateChecks('  `pnpm typecheck`  \n')).toBe(true);
        expect(testInstructionsNarrateChecks('pnpm typecheck; ; ;')).toBe(true);
        expect(testInstructionsNarrateChecks('pnpm typecheck.\n\n')).toBe(true);
    });

    it('quotes the judged segment in the refusal and not the step beside it', () => {
        const instructions = 'Open the mixer and drag the reverb send to -6 dB.\npnpm lint is clean.';

        expect(narratingTestInstructionSegments(instructions)).toEqual(['pnpm lint is clean']);
        const message = refusal(() => assertObservableTestInstructions(instructions));
        expect(message).toMatch(REFUSAL_PREFIX);
        expect(message).toContain('"pnpm lint is clean"');
        expect(message).not.toContain('drag the reverb send');
    });

    it('bounds each quoted segment and counts the segments past the quoting limit', () => {
        const long = `pnpm lint ${'x'.repeat(200)}`;
        const instructions = [long, 'pnpm typecheck', 'cargo build', 'git status', 'pnpm knip'].join('\n');

        const message = refusal(() => assertObservableTestInstructions(instructions));
        expect(message).toContain(`"${long.slice(0, 120)}…"`);
        expect(message).not.toContain(long);
        expect(message).toContain('"pnpm typecheck", "cargo build" and 2 more');
        expect(message).not.toContain('git status');
    });

    it.each([
        'Play the reverb clip and stop at bar 3. The tail is unchanged.',
        'Export the mixdown. The format is unchanged.',
        'Export the mixdown. Find the new file.',
        'Delete an EQ band. Node 2 is gone.',
        'Delete an EQ band. The node is unchanged.',
    ])('reads an unquoted English-word head as prose, not a command: %s', (instructions) => {
        expect(testInstructionsNarrateChecks(instructions)).toBe(false);
        expect(() => assertObservableTestInstructions(instructions)).not.toThrow();
    });

    it.each([
        'Open the mixer. Git diff is empty.',
        'Open the mixer. `diff` is empty.',
        'find . -name x',
        'make test',
        'Make test',
    ])('still refuses a tool head, a quoted head, or a command-shaped line: %s', (instructions) => {
        expect(testInstructionsNarrateChecks(instructions)).toBe(true);
        expect(refusal(() => assertObservableTestInstructions(instructions))).toMatch(REFUSAL_PREFIX);
    });

    it('refuses a value larger than a pull-request body before classifying it', () => {
        const oversized = `pnpm x ${'the '.repeat(300_000)}`;

        expect(refusal(() => assertObservableTestInstructions(oversized))).toBe(
            `pull-request --test exceeds the ${PULL_REQUEST_BODY_BYTE_LIMIT}-byte pull-request body limit`
        );
    });
});

describe('guard failure receipt contract', () => {
    const validReceipt: GuardFailureReceipt = {
        version: 1,
        lane: 'agent-3161-test',
        branch: 'agent/3161/test',
        headSha: '0123456789abcdef0123456789abcdef01234567',
        failedAt: '2026-09-07T12:00:00.000Z',
        reason: 'memory',
        command: 'pnpm',
        args: ['test:run', 'src/x.spec.ts'],
        profile: 'focused',
        peakRssBytes: 5 * 1024 ** 3,
        maxRssBytes: 4 * 1024 ** 3,
        durationMs: 1500,
    };

    it('identifies guard failure reasons correctly', () => {
        expect(isGuardFailureReason('leak')).toBe(true);
        expect(isGuardFailureReason('memory')).toBe(true);
        expect(isGuardFailureReason('monitor')).toBe(true);
        expect(isGuardFailureReason('pressure')).toBe(true);
        expect(isGuardFailureReason('timeout')).toBe(true);

        expect(isGuardFailureReason('signal')).toBe(false);
        expect(isGuardFailureReason('unknown')).toBe(false);
        expect(isGuardFailureReason(123)).toBe(false);
        expect(isGuardFailureReason(null)).toBe(false);
        expect(isGuardFailureReason(undefined)).toBe(false);
        expect(isGuardFailureReason({})).toBe(false);
    });

    it('computes the guard failure receipt path', () => {
        expect(GUARD_FAILURES_DIR).toBe('.agents/guard-failures');
        expect(guardFailureReceiptPath('/repo', 'agent-lane')).toBe('/repo/.agents/guard-failures/agent-lane.json');
    });

    it('parses a valid guard-failure receipt', () => {
        const raw = JSON.stringify(validReceipt, null, 2);
        const parsed = parseGuardFailureReceipt(raw);
        expect(parsed).toEqual(validReceipt);
    });

    it('parses a receipt with an absolute original cwd and rejects malformed cwd fields', () => {
        const receiptWithCwd = { ...validReceipt, cwd: '/repo/.agents/worktrees/agent-3161-test' };

        expect(parseGuardFailureReceipt(JSON.stringify(receiptWithCwd))).toEqual(receiptWithCwd);
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, cwd: '' }))).toThrow(
            /cwd must be an absolute path/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, cwd: 'src' }))).toThrow(
            /cwd must be an absolute path/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, cwd: 42 }))).toThrow(
            /cwd must be an absolute path/
        );
    });

    it('rejects invalid JSON', () => {
        expect(() => parseGuardFailureReceipt('not-json')).toThrow(/not valid JSON/);
    });

    it('rejects non-object receipts', () => {
        expect(() => parseGuardFailureReceipt('"string"')).toThrow(/must be a JSON object/);
        expect(() => parseGuardFailureReceipt('null')).toThrow(/must be a JSON object/);
        expect(() => parseGuardFailureReceipt('123')).toThrow(/must be a JSON object/);
        expect(() => parseGuardFailureReceipt('[]')).toThrow(/must be a JSON object/);
    });

    it('rejects bad version', () => {
        const raw = JSON.stringify({ ...validReceipt, version: 2 });
        expect(() => parseGuardFailureReceipt(raw)).toThrow(/version must be 1/);
    });

    it('rejects invalid reason', () => {
        const raw = JSON.stringify({ ...validReceipt, reason: 'signal' });
        expect(() => parseGuardFailureReceipt(raw)).toThrow(/reason is invalid/);
    });

    it('rejects invalid or missing string fields', () => {
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, lane: '' }))).toThrow(
            /lane is invalid/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, branch: '' }))).toThrow(
            /branch is invalid/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, failedAt: '' }))).toThrow(
            /failedAt is invalid/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, command: '' }))).toThrow(
            /command is invalid/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, profile: '' }))).toThrow(
            /profile is invalid/
        );
    });

    it('rejects non-40-hex headSha', () => {
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, headSha: 'short' }))).toThrow(
            /headSha must be a 40-character hex commit SHA/
        );
        expect(() =>
            parseGuardFailureReceipt(
                JSON.stringify({ ...validReceipt, headSha: '0123456789abcdef0123456789abcdef0123456z' })
            )
        ).toThrow(/headSha must be a 40-character hex commit SHA/);
        expect(() =>
            parseGuardFailureReceipt(
                JSON.stringify({ ...validReceipt, headSha: '0123456789abcdef0123456789abcdef012345678' })
            )
        ).toThrow(/headSha must be a 40-character hex commit SHA/);
    });

    it('rejects invalid args', () => {
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, args: 'not-array' }))).toThrow(
            /args must be an array of strings/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, args: [123] }))).toThrow(
            /args must be an array of strings/
        );
    });

    it('rejects invalid number fields', () => {
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, peakRssBytes: -1 }))).toThrow(
            /peakRssBytes must be a non-negative number/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, maxRssBytes: '400' }))).toThrow(
            /maxRssBytes must be a non-negative number/
        );
        expect(() => parseGuardFailureReceipt(JSON.stringify({ ...validReceipt, durationMs: NaN }))).toThrow(
            /durationMs must be a non-negative number/
        );
    });

    it('returns undefined when receipt file does not exist', () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-prcontract-test-'));
        try {
            expect(readGuardFailureReceipt(primaryRoot, 'non-existent-lane')).toBeUndefined();
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('throws when receipt file exists but contains invalid JSON or schema violation', () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-prcontract-test-'));
        const dir = join(primaryRoot, GUARD_FAILURES_DIR);
        mkdirSync(dir, { recursive: true });
        try {
            // Invalid JSON
            writeFileSync(join(dir, 'invalid-json.json'), 'not valid json', 'utf8');
            expect(() => readGuardFailureReceipt(primaryRoot, 'invalid-json')).toThrow(/not valid JSON/);

            // Schema violation: invalid reason
            writeFileSync(
                join(dir, 'schema-violation.json'),
                JSON.stringify({ ...validReceipt, reason: 'invalid_reason' }),
                'utf8'
            );
            expect(() => readGuardFailureReceipt(primaryRoot, 'schema-violation')).toThrow(/reason is invalid/);

            // Valid receipt parses correctly
            writeFileSync(join(dir, 'valid.json'), JSON.stringify(validReceipt), 'utf8');
            expect(readGuardFailureReceipt(primaryRoot, 'valid')).toEqual(validReceipt);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });
});

describe('canonicalPath and containsPath', () => {
    describe('containsPath', () => {
        it('identifies exact match as contained', () => {
            expect(containsPath('/repo/sub', '/repo/sub')).toBe(true);
        });

        it('identifies parent-child containment', () => {
            expect(containsPath('/repo', '/repo/sub')).toBe(true);
            expect(containsPath('/repo', '/repo/sub/deep/nested')).toBe(true);
        });

        it('rejects sibling and cousin paths', () => {
            expect(containsPath('/repo/sub1', '/repo/sub2')).toBe(false);
            expect(containsPath('/repo/sub', '/repo/sub-other')).toBe(false);
            expect(containsPath('/repo/sub', '/other/repo/sub')).toBe(false);
            expect(containsPath('/repo/sub/deep', '/repo/sub')).toBe(false);
        });
    });

    describe('canonicalPath', () => {
        it('resolves path through resolveExisting resolver', () => {
            const resolved = canonicalPath('/some/path', (p) => `${p}/canonical`);
            expect(resolved).toBe(resolve('/some/path/canonical'));
        });

        it('falls back to resolved absolute path when resolveExisting throws', () => {
            const resolved = canonicalPath('relative/path', () => {
                throw new Error('ENOENT');
            });
            expect(resolved).toBe(resolve('relative/path'));
        });

        it('resolves real symlinks on filesystem', () => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-canonical-test-'));
            try {
                const targetDir = join(root, 'target');
                const linkDir = join(root, 'link');
                mkdirSync(targetDir);
                symlinkSync(targetDir, linkDir);

                const canonical = canonicalPath(linkDir, realpathSync);
                expect(canonical).toBe(realpathSync(targetDir));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
});
