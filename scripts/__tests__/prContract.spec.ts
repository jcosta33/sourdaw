import { describe, expect, it } from 'vitest';

import {
    assertConventionalSubject,
    assertLaneSlug,
    assertPullRequestBody,
    assertReviewCommentBody,
    composePublishBody,
    fail,
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
