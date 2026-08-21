import { describe, expect, it } from 'vitest';

import {
    REQUIRED_BODY_HEADINGS,
    assertConventionalSubject,
    assertLaneSlug,
    assertPullRequestBody,
    assertReviewCommentBody,
    canonicalIssueReferenceFromBody,
    composeDeliveryReceipt,
    composePublishBody,
    fail,
    issueRelationshipFromBody,
    laneBranchName,
    parseDeliveryReceipt,
    supersessionCommentBody,
    supersessionReplacement,
} from '../prContract.ts';

const WHAT_HEADING = '### 🎯 What does this PR do?';
const HOW_HEADING = '### 🧪 How to test';
const SCREENSHOTS_HEADING = '### 🖼️ Screenshots';
const RELATED_HEADING = '### 📌 Related tickets & additional notes';

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
        const body = composePublishBody(2164, 'feat(vcs): add identities');
        expect(body).toContain('Closes #2164');
        // The old name of this test claimed four headings but asserted only that the body was
        // valid, so the count was never observed. Assert the list itself, and assert separately
        // that composing still offers Screenshots even though it no longer gates the merge.
        for (const heading of REQUIRED_BODY_HEADINGS) {
            expect(body).toContain(heading);
        }
        expect(REQUIRED_BODY_HEADINGS).not.toContain(SCREENSHOTS_HEADING);
        expect(body).toContain(`${SCREENSHOTS_HEADING}\nNone.`);
        expect(() => assertPullRequestBody(body, 'body')).not.toThrow();
    });

    it('references an umbrella issue without closing it', () => {
        const body = composePublishBody(2164, 'feat(vcs): add identities', 'relates');
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

        expect(parseDeliveryReceipt(receipt)).toEqual(payload);
        expect(parseDeliveryReceipt('ordinary PR comment')).toBeUndefined();
        expect(() =>
            parseDeliveryReceipt(receipt.replace('closing-issue: 2406', 'closing-issue: 90071992547409930'))
        ).toThrow(/safe positive integer/);
        expect(() => parseDeliveryReceipt(receipt.replace('body-sha256:', 'body-digest:'))).toThrow(
            /invalid delivery receipt/
        );
    });

    it('rejects hidden GitHub closing references', () => {
        expect(() => composePublishBody(2164, 'feat(vcs): fixes #99', 'relates')).toThrow(
            /unexpected issue-closing references/
        );
        expect(() => composePublishBody(2164, 'feat(vcs): closes owner/repo#99')).toThrow(
            /unexpected issue-closing references/
        );
        expect(() => composePublishBody(2164, 'feat(vcs): closes: #99', 'relates')).toThrow(
            /unexpected issue-closing references/
        );
        expect(() => composePublishBody(2164, 'feat(vcs): closes : #99', 'relates')).not.toThrow();
        expect(() =>
            composePublishBody(undefined, 'feat(vcs): resolves https://github.com/owner/repo/issues/99')
        ).not.toThrow();
    });

    it('composes a nonempty Related tickets section when no issue is given', () => {
        const body = composePublishBody(undefined, 'feat(vcs): add identities');
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
        [
            'empty section',
            composePublishBody(1, 'feat: x').replace('pnpm test:run on the named spec files in this change.', ''),
        ],
        ['oversized', `${composePublishBody(1, 'feat: x')}${'a'.repeat(4000)}`],
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

    it('requires one-paragraph review comments with defect, consequence, and outcome', () => {
        assertReviewCommentBody(
            'The merge path still accepts COMMENT. Delivery could merge without reviewer APPROVE. Require jcosta33-reviewer[bot] APPROVED on the current head.'
        );
        expect(() => assertReviewCommentBody('Looks wrong.')).toThrow(/defect/);
        expect(() =>
            assertReviewCommentBody('First paragraph.\n\nSecond paragraph continues the essay and must be refused.')
        ).toThrow(/one paragraph/);
        expect(() => fail('boom')).toThrow(/boom/);
    });
});
