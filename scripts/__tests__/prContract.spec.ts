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
        expect(() => issueRelationshipFromBody(`${prefix}Closes #2164`, undefined)).toThrow(/must start/);
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
