import { describe, expect, it } from 'vitest';

import {
    PULL_REQUEST_BODY_BYTE_LIMIT,
    assertConventionalSubject,
    assertLaneSlug,
    assertPullRequestBody,
    assertReviewCommentBody,
    composePublishBody,
    fail,
    issueRelationshipFromBody,
    laneBranchName,
    repairLegacyBody,
} from '../prContract.ts';

const WHAT_HEADING = '### 🎯 What does this PR do?';
const HOW_HEADING = '### 🧪 How to test';
const SCREENSHOTS_HEADING = '### 🖼️ Screenshots';
const RELATED_HEADING = '### 📌 Related tickets & additional notes';

/** The inserted block, spelled once, so byte-identity can be proven by deleting exactly it. */
const SCREENSHOTS_INSERTION = `${SCREENSHOTS_HEADING}\nNone.\n\n`;

/**
 * A body of the shape a pull request opened before Screenshots joined the template actually has:
 * every heading it was written against, each one full.
 */
const BODY_WITHOUT_SCREENSHOTS = `${WHAT_HEADING}
Keeps collaboration sync state consistent across reconnects.

${HOW_HEADING}
pnpm test:run src/modules/collaboration/__tests__/syncState.spec.ts

${RELATED_HEADING}
Closes #2039
`;

const COMPLETED_BODY = BODY_WITHOUT_SCREENSHOTS.replace(RELATED_HEADING, `${SCREENSHOTS_INSERTION}${RELATED_HEADING}`);

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

    it('composes a body with Closes and the four template headings', () => {
        const body = composePublishBody(2164, 'feat(vcs): add identities');
        expect(body).toContain('Closes #2164');
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
        ['empty section', composePublishBody(1, 'feat: x').replace('None.', '')],
        ['oversized', `${composePublishBody(1, 'feat: x')}${'a'.repeat(4000)}`],
    ])('rejects a %s body', (_case, body) => {
        expect(() => assertPullRequestBody(body, 'body')).toThrow(/body/);
    });

    it('names the absent heading, not the full section that precedes it', () => {
        // The section before an absent heading has no terminator, which is not the same fact as
        // that section being empty. `pnpm deliver 2256` refused with "section is empty: How to
        // test" on a How-to-test section several sentences long; the body was missing Screenshots.
        const message = refusal(() => assertPullRequestBody(BODY_WITHOUT_SCREENSHOTS, 'body'));

        expect(message).toBe(`body is missing: ${SCREENSHOTS_HEADING}`);
        expect(message).not.toContain('is empty');
        expect(message).not.toContain(HOW_HEADING);
    });

    it('names the absent final heading rather than the section before it', () => {
        const body = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${SCREENSHOTS_HEADING}\nNone.\n`;

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe(`body is missing: ${RELATED_HEADING}`);
        expect(message).not.toContain('is empty');
    });

    it('calls out-of-order headings out of order rather than empty', () => {
        // Every heading is present and every section is full; only their order is wrong. Deriving a
        // section's end from the next heading's position makes the earlier one look unterminated.
        const body = `${WHAT_HEADING}\nChange.\n\n${SCREENSHOTS_HEADING}\nNone.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\nNone.\n`;

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe('body sections are out of order');
        expect(message).not.toContain('is empty');
    });

    it('names the empty section, and never reports it as missing', () => {
        const body = COMPLETED_BODY.replace('None.', '');

        const message = refusal(() => assertPullRequestBody(body, 'body'));

        expect(message).toBe(`body section is empty: ${SCREENSHOTS_HEADING}`);
        expect(message).not.toContain('is missing');
    });

    describe('completing a body written against an older template', () => {
        it('adds the missing heading and leaves every existing byte where it was', () => {
            const completed = repairLegacyBody(BODY_WITHOUT_SCREENSHOTS, 'body');

            expect(completed).toBe(COMPLETED_BODY);
            expect(completed?.replace(SCREENSHOTS_INSERTION, '')).toBe(BODY_WITHOUT_SCREENSHOTS);
            expect(() => assertPullRequestBody(completed ?? '', 'body')).not.toThrow();
        });

        it('answers undefined for a body that already satisfies the contract', () => {
            expect(repairLegacyBody(COMPLETED_BODY, 'body')).toBeUndefined();
            expect(repairLegacyBody(composePublishBody(2164, 'feat(vcs): add identities'), 'body')).toBeUndefined();
        });

        it('refuses a missing heading whose content only its author can write', () => {
            const body = BODY_WITHOUT_SCREENSHOTS.replace(`${HOW_HEADING}\n`, '').replace(
                RELATED_HEADING,
                `${SCREENSHOTS_INSERTION}${RELATED_HEADING}`
            );

            expect(() => repairLegacyBody(body, 'body')).toThrow(
                new RegExp(`is missing ${HOW_HEADING}, and only its author can write that section`)
            );
        });

        it('fails loudly instead of trimming when completion would overflow the byte ceiling', () => {
            const headroom = PULL_REQUEST_BODY_BYTE_LIMIT - Buffer.byteLength(BODY_WITHOUT_SCREENSHOTS, 'utf8') - 1;
            const oversized = BODY_WITHOUT_SCREENSHOTS.replace('Keeps', `${'a'.repeat(headroom)}Keeps`);

            expect(Buffer.byteLength(oversized, 'utf8')).toBeLessThanOrEqual(PULL_REQUEST_BODY_BYTE_LIMIT);
            expect(() => repairLegacyBody(oversized, 'body')).toThrow(
                /cannot be completed within 4000 bytes: adding ### 🖼️ Screenshots would overflow it/
            );
        });

        it('refuses a body whose existing headings it cannot insert between', () => {
            const outOfOrder = `${RELATED_HEADING}\nCloses #2039\n\n${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n`;
            const duplicated = `${WHAT_HEADING}\nChange.\n\n${HOW_HEADING}\nRun it.\n\n${RELATED_HEADING}\nCloses #2039\n\n${WHAT_HEADING}\nAgain.\n`;

            expect(() => repairLegacyBody(outOfOrder, 'body')).toThrow(/headings out of order: completing it would/);
            expect(refusal(() => repairLegacyBody(duplicated, 'body'))).toBe(
                `body repeats ${WHAT_HEADING}: completing it would rewrite that section`
            );
        });
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
