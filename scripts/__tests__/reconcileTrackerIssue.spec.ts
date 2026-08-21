import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    githubTrackerIssuePort,
    inspectTrackerIssue,
    parseReconcileTrackerIssueArgs,
    withRepositoryTrackerMutationLease,
} from '../reconcileTrackerIssue.ts';
import {
    applyExactBodyEdits,
    completeTrackerIssue,
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
        stateReason: null,
        body,
        comments: [],
        ...overrides,
    };
}

function fakePort(initial: TrackerIssue[]) {
    const issues = new Map(initial.map((value) => [value.number, value]));
    const calls: string[] = [];
    let leaseHeld = false;
    const port: ReconcileTrackerIssuePort & {
        withMutationLease: <Value>(operation: () => Value) => Value;
    } = {
        withMutationLease: (operation) => {
            if (leaseHeld) {
                throw new Error('tracker mutation lease is busy');
            }
            leaseHeld = true;
            try {
                return operation();
            } finally {
                leaseHeld = false;
            }
        },
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
                stateReason: input.body !== undefined ? value.stateReason : input.stateReason,
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

    it.each([
        ['COMPLETED' as const, 'completed'],
        ['NOT_PLANNED' as const, 'not_planned'],
    ])('writes the %s state reason through the issue-only REST adapter', (stateReason, restReason) => {
        const calls: string[][] = [];
        const port = githubTrackerIssuePort(
            (args) => {
                calls.push(args);
                if (args.includes('--paginate')) {
                    return JSON.stringify([[]]);
                }
                return JSON.stringify({
                    node_id: 'I_2372',
                    number: 2372,
                    repository_url: 'https://api.github.com/repos/jcosta33/sourdaw',
                    state: 'closed',
                    state_reason: restReason,
                    body,
                });
            },
            (operation) => operation()
        );

        expect(port.update(2372, { state: 'CLOSED', stateReason })).toMatchObject({
            state: 'CLOSED',
            stateReason,
            body,
        });
        expect(calls[0]).toEqual([
            'api',
            '--method',
            'PATCH',
            'repos/jcosta33/sourdaw/issues/2372',
            '-f',
            'state=closed',
            '-f',
            `state_reason=${restReason}`,
        ]);
    });

    it('parses the required REST state/reason matrix and rejects invalid combinations', () => {
        const inspect = (state: string, stateReason: string | null) =>
            inspectTrackerIssue(2372, (args) => {
                if (args.includes('--paginate')) {
                    return JSON.stringify([[]]);
                }
                return JSON.stringify({
                    node_id: 'I_2372',
                    number: 2372,
                    repository_url: 'https://api.github.com/repos/jcosta33/sourdaw',
                    state,
                    state_reason: stateReason,
                    body,
                });
            });

        expect(inspect('open', null).stateReason).toBeNull();
        expect(inspect('closed', 'not_planned').stateReason).toBe('NOT_PLANNED');
        expect(inspect('closed', 'duplicate').stateReason).toBe('DUPLICATE');
        expect(() => inspect('open', 'completed')).toThrow(/cannot inspect issue/i);
        expect(() => inspect('closed', 'reopened')).toThrow(/cannot inspect issue/i);
    });

    it('refuses adapter-parsed non-completed closure without sending a PATCH', () => {
        const calls: string[][] = [];
        const port = githubTrackerIssuePort(
            (args) => {
                calls.push(args);
                if (args.includes('--paginate')) {
                    return JSON.stringify([[]]);
                }
                return JSON.stringify({
                    node_id: 'I_2372',
                    number: 2372,
                    repository_url: 'https://api.github.com/repos/jcosta33/sourdaw',
                    state: 'closed',
                    state_reason: 'not_planned',
                    body,
                });
            },
            (operation) => operation()
        );

        expect(() => completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toThrow(/without a completed state reason/);
        expect(calls.some((args) => args.includes('PATCH'))).toBe(false);
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

    it('holds the cooperative mutation lease across the final digest check and verified body PATCH', () => {
        const { port, inspect } = fakePort([issue(2372)]);
        const update = port.update;
        let competingEditEntered = false;
        port.update = (number, input) => {
            try {
                port.withMutationLease(() => {
                    competingEditEntered = true;
                    update(number, { body: `${body}\nCompeting sanctioned edit.` });
                });
            } catch (error) {
                expect(error).toMatchObject({ message: 'tracker mutation lease is busy' });
            }
            return update(number, input);
        };

        reconcileTrackerIssue({ issueNumber: 2372, expectedBodySha256: bodySha256, nextBody }, AUTHOR_BOT_LOGIN, port);

        expect(competingEditEntered).toBe(false);
        expect(inspect(2372)?.body).toBe(nextBody);
    });

    it('excludes a second sanctioned writer from the repository-owned lease', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-tracker-lease-'));
        mkdirSync(join(root, '.git'));
        try {
            withRepositoryTrackerMutationLease(root, () => {
                expect(() => withRepositoryTrackerMutationLease(root, () => undefined)).toThrow(/lease is busy/);
            });
            expect(withRepositoryTrackerMutationLease(root, () => 'released')).toBe('released');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('completes an issue while preserving its exact identity and body', () => {
        const { port, calls, inspect } = fakePort([issue(2372)]);

        expect(completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toBe('tracker-issue-completed:2372');
        expect(inspect(2372)).toMatchObject({
            id: 'I_2372',
            number: 2372,
            repository: 'jcosta33/sourdaw',
            state: 'CLOSED',
            stateReason: 'COMPLETED',
            body,
        });
        expect(calls.at(-1)).toBe('log:tracker-issue-completed:2372');
    });

    it('treats an exactly completed issue as converged without another mutation', () => {
        const { port, calls } = fakePort([issue(2372, { state: 'CLOSED', stateReason: 'COMPLETED' })]);

        expect(completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toBe('tracker-issue-completed:2372');
        expect(calls).toEqual(['inspect:2372', 'inspect:2372', 'log:tracker-issue-completed:2372']);
    });

    it('refuses to relabel an issue already closed for a different reason', () => {
        const { port, calls } = fakePort([issue(2372, { state: 'CLOSED', stateReason: 'NOT_PLANNED' })]);

        expect(() => completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toThrow(/without a completed state reason/);
        expect(calls).toEqual(['inspect:2372']);
    });

    it('recovers a completion write that commits before the transport throws', () => {
        const { port, inspect } = fakePort([issue(2372)]);
        const update = port.update;
        port.update = (number, input) => {
            update(number, input);
            throw new Error('close response lost');
        };

        expect(completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toBe('tracker-issue-completed:2372');
        expect(inspect(2372)).toMatchObject({ state: 'CLOSED', stateReason: 'COMPLETED', body });
    });

    it.each([
        ['node', { id: 'I_other' }],
        ['repository', { repository: 'jcosta33/other' }],
        ['body', { body: 'concurrent body' }],
        ['receipt', { state: 'OPEN' as const, stateReason: null }],
    ])('rejects a completion receipt with the wrong %s', (_case, overrides) => {
        const { port, calls } = fakePort([issue(2372)]);
        port.update = () => issue(2372, { state: 'CLOSED', stateReason: 'COMPLETED', ...overrides });

        expect(() => completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toThrow(/changed during completion/);
        expect(calls).not.toContain('log:tracker-issue-completed:2372');
    });

    it('propagates a completion failure when inspection proves no committed write', () => {
        const { port, calls } = fakePort([issue(2372)]);
        port.update = () => {
            throw new Error('close did not commit');
        };

        expect(() => completeTrackerIssue(2372, AUTHOR_BOT_LOGIN, port)).toThrow(/close did not commit/);
        expect(calls).toEqual(['inspect:2372', 'inspect:2372']);
    });

    it('rejects completion by a non-bot caller before inspecting the issue', () => {
        const { port, calls } = fakePort([issue(2372)]);

        expect(() => completeTrackerIssue(2372, 'jcosta33', port)).toThrow(/authenticated author login/i);
        expect(calls).toEqual([]);
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
        expect(inspect(835)?.stateReason).toBe('NOT_PLANNED');
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
        const { port, calls } = fakePort([
            issue(835, { state: 'CLOSED', stateReason: 'NOT_PLANNED', comments: [marker] }),
            issue(2372),
        ]);

        expect(
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toBe('tracker-issue-superseded:835:2372');
        expect(calls).toEqual(['inspect:835', 'inspect:2372', 'log:tracker-issue-superseded:835:2372']);
    });

    it('rejects a supersession receipt closed for any reason other than not planned', () => {
        const marker = {
            id: 'IC_835',
            body: 'Superseded by #2372.',
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: 'Bot',
        };
        const { port, calls } = fakePort([
            issue(835, { state: 'CLOSED', stateReason: 'COMPLETED', comments: [marker] }),
            issue(2372),
        ]);

        expect(() =>
            reconcileTrackerIssue(
                { issueNumber: 835, expectedBodySha256: bodySha256, replacementNumber: 2372 },
                AUTHOR_BOT_LOGIN,
                port
            )
        ).toThrow(/changed during supersession/);
        expect(calls).not.toContain('log:tracker-issue-superseded:835:2372');
    });

    it('rejects duplicate canonical markers instead of guessing ownership', () => {
        const marker = {
            id: 'IC_835',
            body: 'Superseded by #2372.',
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: 'Bot',
        };
        const duplicate = { ...marker, id: 'IC_835_duplicate' };
        const { port } = fakePort([
            issue(835, { state: 'CLOSED', stateReason: 'NOT_PLANNED', comments: [marker, duplicate] }),
            issue(2372),
        ]);

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
