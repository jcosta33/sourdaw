import { describe, expect, it } from 'vitest';

import {
    describePullRequest,
    parseDescribePullRequestArgs,
    type DescribePullRequestPort,
    type PullRequestDescriptionSnapshot,
} from '../describePullRequest';
import { AUTHOR_BOT_LOGIN, AUTHOR_LOCK_REASON } from '../githubAppIdentity';

const head = 'a'.repeat(40);
const body = [
    '### 🎯 What does this PR do?',
    'Ships the complete DDSP feature.',
    '',
    '### 🧪 How to test',
    'Run the focused DDSP proofs.',
    '',
    '### 🖼️ Screenshots',
    'None.',
    '',
    '### 📌 Related tickets & additional notes',
    'Closes #2261',
    '',
].join('\n');

function fixture(
    overrides: {
        lane?: Partial<ReturnType<DescribePullRequestPort['lane']>>;
        pullRequest?: Partial<PullRequestDescriptionSnapshot>;
        afterUpdate?: Partial<PullRequestDescriptionSnapshot>;
        authorLogin?: string;
    } = {}
) {
    const updates: Array<{ number: number; title: string; body: string }> = [];
    let pullRequest: PullRequestDescriptionSnapshot = {
        number: 2489,
        state: 'OPEN',
        isDraft: false,
        title: 'fix(ddsp): close release proof gaps',
        body: 'old',
        repository: 'jcosta33/sourdaw',
        headRepository: 'jcosta33/sourdaw',
        baseRefName: 'main',
        headRefName: 'agent/2261/ddsp-cache',
        headRefOid: head,
        ...overrides.pullRequest,
    };
    const lane = {
        root: '/repo/.agents/worktrees/agent-2261-ddsp-cache',
        primaryRoot: '/repo',
        branch: 'agent/2261/ddsp-cache',
        head,
        remoteHead: head,
        dirty: false,
        locked: true,
        lockReason: AUTHOR_LOCK_REASON,
        ...overrides.lane,
    };
    const port: DescribePullRequestPort = {
        lane: () => lane,
        inspect: () => pullRequest,
        update: (number, input) => {
            updates.push({ number, ...input });
            pullRequest = { ...pullRequest, ...input, ...overrides.afterUpdate };
        },
        log: () => undefined,
    };
    return { port, updates, authorLogin: overrides.authorLogin ?? AUTHOR_BOT_LOGIN };
}

describe('pull-request description update', () => {
    it('should parse only a safe PR number and body file', () => {
        expect(parseDescribePullRequestArgs(['2489', '--body-file', '/tmp/body.md'])).toEqual({
            number: 2489,
            bodyFile: '/tmp/body.md',
            help: false,
        });
        expect(() => parseDescribePullRequestArgs(['0', '--body-file', '/tmp/body.md'])).toThrow(/usage/u);
        expect(() => parseDescribePullRequestArgs(['2489', '--body', 'inline'])).toThrow(/usage/u);
    });

    it('should update only title and body for the exact clean published lane head', () => {
        const state = fixture();

        expect(describePullRequest(2489, body, state.authorLogin, state.port)).toBe(
            `pull-request-described:2489:${head}`
        );
        expect(state.updates).toEqual([{ number: 2489, title: 'fix(ddsp): close release proof gaps', body }]);
    });

    it.each([
        ['dirty lane', { lane: { dirty: true } }, /lane is dirty/u],
        ['unpublished head', { lane: { remoteHead: 'b'.repeat(40) } }, /not published/u],
        ['head drift', { pullRequest: { headRefOid: 'b'.repeat(40) } }, /head/u],
        ['branch drift', { pullRequest: { headRefName: 'agent/2261/other' } }, /branch/u],
        ['other repository', { pullRequest: { repository: 'someone/fork' } }, /repository/u],
        ['closed pull request', { pullRequest: { state: 'CLOSED' } }, /closed/u],
        ['draft pull request', { pullRequest: { isDraft: true } }, /draft/u],
        ['unlocked lane', { lane: { locked: false, lockReason: undefined } }, /locked author lane/u],
    ] as const)('should refuse %s before mutation', (_case, overrides, message) => {
        const state = fixture(overrides);

        expect(() => describePullRequest(2489, body, state.authorLogin, state.port)).toThrow(message);
        expect(state.updates).toEqual([]);
    });

    it('should require the lane issue to remain the sole closing relationship', () => {
        const state = fixture();
        const wrongIssue = body.replace('Closes #2261', 'Closes #9999');

        expect(() => describePullRequest(2489, wrongIssue, state.authorLogin, state.port)).toThrow(/must close #2261/u);
        expect(state.updates).toEqual([]);
    });

    it('should refuse head drift that happens during the update', () => {
        const state = fixture({ afterUpdate: { headRefOid: 'b'.repeat(40) } });

        expect(() => describePullRequest(2489, body, state.authorLogin, state.port)).toThrow(
            /headRefOid changed during description update/u
        );
    });

    it('should reject malformed or incomplete four-heading bodies and a non-author identity', () => {
        const state = fixture({ authorLogin: 'human' });
        const withoutScreenshots = body.replace('### 🖼️ Screenshots\nNone.\n\n', '');
        const screenshotsBeforeTesting = body.replace(
            '### 🧪 How to test\nRun the focused DDSP proofs.\n\n### 🖼️ Screenshots\nNone.',
            '### 🖼️ Screenshots\nNone.\n\n### 🧪 How to test\nRun the focused DDSP proofs.'
        );

        expect(() => describePullRequest(2489, 'Closes #2261', AUTHOR_BOT_LOGIN, state.port)).toThrow(/missing/u);
        expect(() => describePullRequest(2489, withoutScreenshots, AUTHOR_BOT_LOGIN, state.port)).toThrow(
            /Screenshots/u
        );
        expect(() => describePullRequest(2489, screenshotsBeforeTesting, AUTHOR_BOT_LOGIN, state.port)).toThrow(
            /Screenshots/u
        );
        expect(() => describePullRequest(2489, body, state.authorLogin, state.port)).toThrow(/authenticated author/u);
        expect(state.updates).toEqual([]);
    });
});
