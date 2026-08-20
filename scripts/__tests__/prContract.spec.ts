import { describe, expect, it } from 'vitest';

import {
    assertConventionalSubject,
    assertLaneSlug,
    assertPullRequestBody,
    assertReviewCommentBody,
    composePublishBody,
    fail,
    issueRelationshipFromBody,
    laneBranchName,
    supersessionCommentBody,
    supersessionReplacement,
} from '../prContract.ts';

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
