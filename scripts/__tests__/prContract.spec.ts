import { describe, expect, it } from 'vitest';

import {
    REQUIRED_BODY_HEADINGS,
    REVIEW_COMMENT_MAX_BYTES,
    assertConventionalSubject,
    assertLaneSlug,
    assertPullRequestBody,
    canonicalIssueReferenceFromBody,
    composeDeliveryReceipt,
    composePublishBody,
    composeReviewCommentBody,
    fail,
    issueRelationshipFromBody,
    laneBranchName,
    parseDeliveryReceipt,
    supersessionCommentBody,
    supersessionReplacement,
    type ReviewCommentContent,
} from '../prContract.ts';

const WHAT_HEADING = '### 🎯 What does this PR do?';
const HOW_HEADING = '### 🧪 How to test';
const SCREENSHOTS_HEADING = '### 🖼️ Screenshots';
const RELATED_HEADING = '### 📌 Related tickets & additional notes';
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

    it('composes a body with Closes, every required heading, and the offered Screenshots one', () => {
        const body = composePublishBody(2164, TITLE, SUMMARY, TEST_INSTRUCTIONS);
        expect(body).toContain('Closes #2164');
        // The old name of this test claimed four headings but asserted only that the body was
        // valid, so the count was never observed. Assert the list itself, and assert separately
        // that composing still offers Screenshots even though it no longer gates the merge.
        for (const heading of REQUIRED_BODY_HEADINGS) {
            expect(body).toContain(heading);
        }
        expect(REQUIRED_BODY_HEADINGS).not.toContain(SCREENSHOTS_HEADING);
        expect(body).toContain(`${SCREENSHOTS_HEADING}\nNone.`);
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
        const prefix = '### 📌 Related tickets & additional notes\n';
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
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2164\nRelated #99`, 2164)).toThrow(
            /exactly one relationship/
        );
        expect(() => issueRelationshipFromBody(`${prefix}None.\nCloses #2164`, 2164)).toThrow(
            /exactly one relationship/
        );
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2164\n${prefix}Related #2164`, 2164)).toThrow(
            /exactly one Related tickets section/
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

    it('derives delivery authority only from one canonical same-repository relationship', () => {
        const prefix = '### 📌 Related tickets & additional notes\n';
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
        const prefix = '### 📌 Related tickets & additional notes\n';
        expect(() => canonicalIssueReferenceFromBody(`${prefix}${line}`, 'jcosta33/sourdaw')).toThrow(/canonical/);
    });

    it('rejects closing authority outside the canonical Related tickets section', () => {
        const prefix = '### 📌 Related tickets & additional notes\n';
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

    it('composes a nonempty Related tickets section when no issue is given', () => {
        const body = composePublishBody(undefined, TITLE, SUMMARY, TEST_INSTRUCTIONS);
        expect(body).not.toContain('Closes #');
        expect(body.slice(body.indexOf('### 📌 Related tickets & additional notes')).trim()).toBe(
            '### 📌 Related tickets & additional notes\nNone.'
        );
        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it.each([
        ['missing heading', '### 🎯 What does this PR do?\nChange.\n'],
        // Emptying Screenshots no longer proves anything, because Screenshots is no longer
        // required. This empties a required section instead, which is what the case is named for.
        ['empty section', composePublishBody(1, 'feat: x', SUMMARY, TEST_INSTRUCTIONS).replace(TEST_INSTRUCTIONS, '')],
        ['oversized', `${composePublishBody(1, 'feat: x', SUMMARY, TEST_INSTRUCTIONS)}${'a'.repeat(4000)}`],
    ])('rejects a %s body', (_case, body) => {
        expect(() => assertPullRequestBody(body, 'body')).toThrow(/body/);
    });

    it('accepts a body with no Screenshots heading at all', () => {
        // Screenshots is offered, not required: its canonical content is the literal `None.` that
        // composing writes into every body, so gating the merge on it gated nothing.
        const body = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\nCloses #1\n`;

        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it.each(REQUIRED_BODY_HEADINGS)('still refuses a body missing %s, naming it', (heading) => {
        const full = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\nCloses #1\n`;
        const without = full.replace(`${heading}\n`, '');

        expect(refusal(() => assertPullRequestBody(without, 'body'))).toBe(`body is missing: ${heading}`);
    });

    it('still terminates a required section at the offered Screenshots heading', () => {
        // Screenshots left the required list, so it no longer bounds a section by being in that
        // list. If it stopped bounding sections altogether, How-to-test's content span would run
        // past it to Related tickets and swallow `### 🖼️ Screenshots\nNone.`, so an empty
        // How-to-test section would read as full and merge.
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
