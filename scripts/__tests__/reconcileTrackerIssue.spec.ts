import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import { inspectTrackerIssue, parseReconcileTrackerIssueArgs } from '../reconcileTrackerIssue.ts';
import {
    applyExactBodyEdits,
    reconcileTrackerIssue,
    type ReconcileTrackerIssuePort,
    type TrackerIssue,
} from '../trackerIssueReconciliation.ts';

const body = 'Current campaign body';
const nextBody = 'Current campaign body\n\nNative inference retired.';
const bodySha256 = createHash('sha256').update(body).digest('hex');

function issue(number: number, overrides: Partial<TrackerIssue> = {}): TrackerIssue {
    return {
        id: `I_${number}`,
        number,
        repository: 'jcosta33/sourdaw',
        state: 'OPEN',
        body,
        comments: [],
        ...overrides,
    };
}

function fakePort(initial: TrackerIssue[]) {
    const issues = new Map(initial.map((value) => [value.number, value]));
    const calls: string[] = [];
    const port: ReconcileTrackerIssuePort = {
        inspect: (number) => {
            calls.push(`inspect:${number}`);
            const value = issues.get(number);
            if (value === undefined) {
                throw new Error(`missing issue ${number}`);
            }
            return structuredClone(value);
        },
        update: (number, input) => {
            calls.push(`update:${number}`);
            const value = issues.get(number);
            if (value === undefined) {
                throw new Error(`missing issue ${number}`);
            }
            const updated: TrackerIssue = {
                ...value,
                body: input.body ?? value.body,
                state: input.state ?? value.state,
            };
            issues.set(value.number, updated);
            return structuredClone(updated);
        },
        comment: (number, commentBody) => {
            calls.push(`comment:${number}:${commentBody}`);
            const value = issues.get(number);
            if (value === undefined) {
                throw new Error(`missing issue ${number}`);
            }
            const comment = {
                id: `IC_${value.number}`,
                body: commentBody,
                authorLogin: AUTHOR_BOT_LOGIN,
                authorType: 'Bot',
            };
            issues.set(value.number, { ...value, comments: [...value.comments, comment] });
            return comment;
        },
        log: (message) => calls.push(`log:${message}`),
    };
    return { port, calls, inspect: (number: number) => issues.get(number) };
}

describe('tracker issue reconciliation', () => {
    it('parses exact body replacement and supersession modes', () => {
        expect(
            parseReconcileTrackerIssueArgs([
                '2372',
                '--expected-body-sha256',
                bodySha256,
                '--edits-file',
                '/tmp/edits.json',
            ])
        ).toEqual({
            help: false,
            issueNumber: 2372,
            expectedBodySha256: bodySha256,
            editsFile: '/tmp/edits.json',
        });
        expect(
            parseReconcileTrackerIssueArgs(['835', '--expected-body-sha256', bodySha256, '--superseded-by', '2372'])
        ).toEqual({
            help: false,
            issueNumber: 835,
            expectedBodySha256: bodySha256,
            replacementNumber: 2372,
        });
    });

    it('applies every exact body edit once and rejects drift or ambiguity', () => {
        expect(applyExactBodyEdits('WebLLM and native inference', [{ from: ' and native inference', to: '' }])).toBe(
            'WebLLM'
        );
        expect(() =>
            applyExactBodyEdits('native local and native local', [{ from: 'native local', to: 'browser local' }])
        ).toThrow(/exactly once/i);
        expect(() => applyExactBodyEdits('WebLLM', [{ from: 'native local', to: 'browser local' }])).toThrow(
            /exactly once/i
        );
    });

    it('rejects a pull request returned from the issue endpoint', () => {
        const gh = () =>
            JSON.stringify({
                node_id: 'PR_835',
                number: 835,
                repository_url: 'https://api.github.com/repos/jcosta33/sourdaw',
                state: 'open',
                body,
                pull_request: {},
            });

        expect(() => inspectTrackerIssue(835, gh)).toThrow(/pull request, not a tracker issue/i);
    });

    it('rejects an issue receipt bound to another repository', () => {
        const gh = () =>
            JSON.stringify({
                node_id: 'I_835',
                number: 835,
                repository_url: 'https://api.github.com/repos/jcosta33/other',
                state: 'open',
                body,
            });

        expect(() => inspectTrackerIssue(835, gh)).toThrow(/cannot inspect issue/i);
    });

    it('replaces an open issue body only when the expected digest matches', () => {
        const { port, inspect } = fakePort([issue(2372)]);
        expect(
            reconcileTrackerIssue(
                {
                    issueNumber: 2372,
                    expectedBodySha256: bodySha256,
                    nextBody,
                },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toBe('tracker-issue-updated:2372');
        expect(inspect(2372)?.body).toBe(nextBody);
        expect(inspect(2372)?.state).toBe('OPEN');
    });

    it('rejects stale body evidence before mutation', () => {
        const { port, calls } = fakePort([issue(2372)]);
        expect(() =>
            reconcileTrackerIssue(
                {
                    issueNumber: 2372,
                    expectedBodySha256: '0'.repeat(64),
                    nextBody,
                },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/body digest changed/i);
        expect(calls).toEqual(['inspect:2372']);
    });

    it('closes a superseded issue with one canonical replacement marker', () => {
        const { port, inspect } = fakePort([issue(835), issue(2372)]);
        expect(
            reconcileTrackerIssue(
                {
                    issueNumber: 835,
                    expectedBodySha256: bodySha256,
                    replacementNumber: 2372,
                },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toBe('tracker-issue-superseded:835:2372');
        expect(inspect(835)?.state).toBe('CLOSED');
        expect(inspect(835)?.comments).toEqual([
            {
                id: 'IC_835',
                body: 'Superseded by #2372.',
                authorLogin: AUTHOR_BOT_LOGIN,
                authorType: 'Bot',
            },
        ]);
    });

    it('rejects a replacement outside the repository before mutation', () => {
        const { port, calls } = fakePort([issue(835), issue(2372, { repository: 'jcosta33/other' })]);
        expect(() =>
            reconcileTrackerIssue(
                {
                    issueNumber: 835,
                    expectedBodySha256: bodySha256,
                    replacementNumber: 2372,
                },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/cannot bind tracker issue #2372/i);
        expect(calls).toEqual(['inspect:835', 'inspect:2372']);
    });

    it('recovers a body update that commits before the transport throws', () => {
        const { port, inspect } = fakePort([issue(2372)]);
        const update = port.update;
        port.update = (number, input) => {
            update(number, input);
            throw new Error('connection reset after commit');
        };

        expect(
            reconcileTrackerIssue(
                { issueNumber: 2372, expectedBodySha256: bodySha256, nextBody },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toBe('tracker-issue-updated:2372');
        expect(inspect(2372)?.body).toBe(nextBody);
    });

    it('rejects an ambiguous body write unless inspection proves the exact final state', () => {
        const { port, calls } = fakePort([issue(2372)]);
        const update = port.update;
        port.update = (number) => {
            update(number, { body: `${nextBody}\nUnexpected concurrent edit.` });
            throw new Error('connection reset after an unproven commit');
        };

        expect(() =>
            reconcileTrackerIssue(
                { issueNumber: 2372, expectedBodySha256: bodySha256, nextBody },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/unproven commit/i);
        expect(calls).not.toContain('log:tracker-issue-updated:2372');
    });

    it('recovers committed marker and close writes after ambiguous transport failures', () => {
        const { port, inspect } = fakePort([issue(835), issue(2372)]);
        const comment = port.comment;
        port.comment = (number, commentBody) => {
            comment(number, commentBody);
            throw new Error('comment response lost');
        };
        const update = port.update;
        port.update = (number, input) => {
            update(number, input);
            throw new Error('close response lost');
        };

        expect(
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toBe('tracker-issue-superseded:835:2372');
        expect(inspect(835)?.state).toBe('CLOSED');
        expect(inspect(835)?.comments).toHaveLength(1);
    });

    it('treats an already closed issue with one canonical marker as converged', () => {
        const marker = {
            id: 'IC_835',
            body: 'Superseded by #2372.',
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: 'Bot',
        };
        const { port, calls } = fakePort([issue(835, { state: 'CLOSED', comments: [marker] }), issue(2372)]);

        expect(
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toBe('tracker-issue-superseded:835:2372');
        expect(calls).toEqual(['inspect:835', 'inspect:2372', 'log:tracker-issue-superseded:835:2372']);
    });

    it('rejects duplicate canonical markers instead of guessing ownership', () => {
        const marker = {
            id: 'IC_835',
            body: 'Superseded by #2372.',
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: 'Bot',
        };
        const duplicate = { ...marker, id: 'IC_835_duplicate' };
        const { port } = fakePort([issue(835, { state: 'CLOSED', comments: [marker, duplicate] }), issue(2372)]);

        expect(() =>
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/duplicate|exactly one/i);
    });

    it('rejects a matching marker that was not written by the author bot', () => {
        const foreignMarker = {
            id: 'IC_835_foreign',
            body: 'Superseded by #2372.',
            authorLogin: 'jcosta33',
            authorType: 'User',
        };
        const { port, calls } = fakePort([issue(835, { comments: [foreignMarker] }), issue(2372)]);

        expect(() =>
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/canonical supersession marker/i);
        expect(calls).toEqual(['inspect:835', 'inspect:2372']);
    });

    it('rejects an invalid supersession comment receipt before closing', () => {
        const { port, calls } = fakePort([issue(835), issue(2372)]);
        port.comment = (_number, commentBody) => ({
            id: '',
            body: commentBody,
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: 'Bot',
        });

        expect(() =>
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/invalid receipt/i);
        expect(calls).toEqual(['inspect:835', 'inspect:2372']);
    });

    it('rejects self-supersession before writing a marker', () => {
        const { port, calls } = fakePort([issue(835)]);

        expect(() =>
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 835 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/cannot supersede itself/i);
        expect(calls).toEqual(['inspect:835']);
    });

    it('rejects any caller other than the authenticated author bot before inspection', () => {
        const { port, calls } = fakePort([issue(2372)]);
        expect(() =>
            reconcileTrackerIssue({ issueNumber: 2372, expectedBodySha256: bodySha256, nextBody }, 'jcosta33', port)
        ).toThrow(/authenticated author login/i);
        expect(calls).toEqual([]);
    });
});
