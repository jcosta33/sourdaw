import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AUTHOR_BOT_NODE_ID as AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    githubTrackerIssuePort,
    inspectTrackerIssue,
    parseReconcileTrackerIssueArgs,
    processIsProvenDead,
    recoverRepositoryTrackerMutationLease,
    runReconcileTrackerIssueCli,
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
                authorNodeId: AUTHOR_BOT_LOGIN,
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

    describe('tracker mutation lease recovery', () => {
        const token = '123e4567-e89b-12d3-a456-426614174000';
        // A pid this process never probes for real: every case injects the dead-owner proof.
        const ownerPid = 987_654;
        const dead = () => true;
        const live = () => false;

        function withLeaseRoot(contents: string | undefined, check: (root: string, leasePath: string) => void): void {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-tracker-lease-recovery-'));
            const leasePath = join(root, '.git', 'sourdaw-tracker-mutation.lease');
            mkdirSync(join(root, '.git'));
            if (contents !== undefined) {
                writeFileSync(leasePath, contents);
            }
            try {
                check(root, leasePath);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }

        const v2Lease = JSON.stringify({ version: 2, pid: ownerPid, token });

        it('does not prove the running process dead', () => {
            expect(processIsProvenDead(process.pid)).toBe(false);
        });

        // spawnSync returns only after the child exited and was reaped, so its pid is unused. A reuse
        // in between would read as live and fail this case; it can never pass falsely.
        it('proves an exited and reaped child process dead', () => {
            const child = spawnSync(process.execPath, ['-e', '']);
            expect(child.status).toBe(0);
            expect(processIsProvenDead(child.pid)).toBe(true);
        });

        // Spying on `process.kill` makes the EPERM answer independent of the caller's uid; a real probe
        // of pid 1 only answers EPERM to a non-root caller and would prove nothing when run as root.
        it.each(['EPERM', 'EINVAL'])('does not prove an owner dead when the probe answers %s', (code) => {
            const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
                throw Object.assign(new Error(`kill ${code}`), { code });
            });
            try {
                expect(processIsProvenDead(ownerPid)).toBe(false);
                expect(kill).toHaveBeenCalledWith(ownerPid, 0);
            } finally {
                kill.mockRestore();
            }
        });

        it('records a versioned owner while the lease is held', () => {
            withLeaseRoot(undefined, (root, leasePath) => {
                withRepositoryTrackerMutationLease(root, () => {
                    const owner = JSON.parse(readFileSync(leasePath, 'utf8')) as Record<string, unknown>;
                    expect(Object.keys(owner).sort()).toEqual(['pid', 'token', 'version']);
                    expect(owner).toMatchObject({ version: 2, pid: process.pid });
                });
                expect(existsSync(leasePath)).toBe(false);
            });
        });

        it('refuses acquisition over a dead owner without taking it over and names the recovery command', () => {
            withLeaseRoot(v2Lease, (root, leasePath) => {
                let ran = false;
                expect(() =>
                    withRepositoryTrackerMutationLease(
                        root,
                        () => {
                            ran = true;
                        },
                        { processIsProvenDead: dead }
                    )
                ).toThrow(
                    `tracker mutation lease is busy: owner pid ${ownerPid}, token ${token}; the owner is proven dead; ` +
                        `recover it with: pnpm issue:reconcile --recover-lease ${token}`
                );
                expect(ran).toBe(false);
                expect(readFileSync(leasePath, 'utf8')).toBe(v2Lease);
            });
        });

        it('refuses acquisition over a live owner without offering recovery', () => {
            withLeaseRoot(v2Lease, (root) => {
                let message = '';
                try {
                    withRepositoryTrackerMutationLease(root, () => undefined, { processIsProvenDead: live });
                } catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
                expect(message).toContain(`owner pid ${ownerPid}, token ${token}; the owner is live or unprovable`);
                expect(message).not.toContain('--recover-lease');
            });
        });

        it('refuses acquisition over an unprovable lease record and asks for manual removal', () => {
            withLeaseRoot('{not json', (root) => {
                expect(() =>
                    withRepositoryTrackerMutationLease(root, () => undefined, { processIsProvenDead: dead })
                ).toThrow(
                    /lease is busy.*unprovable; remove it manually after confirming no reconcile or deliver is running/
                );
            });
        });

        it.each([
            ['a current lease', v2Lease],
            ['an unversioned lease from before the format version', JSON.stringify({ pid: ownerPid, token })],
        ])('removes %s whose owner is proven dead and lets a new acquisition succeed', (_label, contents) => {
            withLeaseRoot(contents, (root, leasePath) => {
                const probed: number[] = [];
                recoverRepositoryTrackerMutationLease(root, token, {
                    processIsProvenDead: (pid) => {
                        probed.push(pid);
                        return true;
                    },
                });

                expect(probed).toEqual([ownerPid]);
                expect(existsSync(leasePath)).toBe(false);
                expect(withRepositoryTrackerMutationLease(root, () => 'acquired')).toBe('acquired');
            });
        });

        it.each([
            ['a live owner', v2Lease, token, live, /live or unprovable; nothing removed/],
            ['a mismatched token', v2Lease, 'other-token', dead, /does not match.*nothing removed/],
            ['malformed JSON', '{not json', token, dead, /unprovable; remove it manually after confirming/],
            [
                'an unknown version',
                JSON.stringify({ version: 3, pid: ownerPid, token }),
                token,
                dead,
                /unprovable; remove it manually/,
            ],
            [
                'an extra key',
                JSON.stringify({ version: 2, pid: ownerPid, token, ownerFence: {} }),
                token,
                dead,
                /unprovable; remove it manually/,
            ],
            ['a missing token', JSON.stringify({ version: 2, pid: ownerPid }), token, dead, /unprovable/],
            ['a non-positive pid', JSON.stringify({ version: 2, pid: 0, token }), token, dead, /unprovable/],
            ['an empty token', JSON.stringify({ version: 2, pid: ownerPid, token: '' }), '', dead, /unprovable/],
        ])(
            'refuses recovery of %s and leaves the lease in place',
            (_label, contents, suppliedToken, probe, message) => {
                withLeaseRoot(contents, (root, leasePath) => {
                    expect(() =>
                        recoverRepositoryTrackerMutationLease(root, suppliedToken, { processIsProvenDead: probe })
                    ).toThrow(message);
                    expect(readFileSync(leasePath, 'utf8')).toBe(contents);
                });
            }
        );

        it('refuses recovery when no lease exists', () => {
            withLeaseRoot(undefined, (root) => {
                expect(() => recoverRepositoryTrackerMutationLease(root, token, { processIsProvenDead: dead })).toThrow(
                    /no tracker mutation lease/
                );
            });
        });

        it('refuses recovery when the lease changes between the proof and the removal', () => {
            withLeaseRoot(v2Lease, (root, leasePath) => {
                const replacement = JSON.stringify({ version: 2, pid: ownerPid + 1, token: 'new-owner' });
                expect(() =>
                    recoverRepositoryTrackerMutationLease(root, token, {
                        processIsProvenDead: () => {
                            writeFileSync(leasePath, replacement);
                            return true;
                        },
                    })
                ).toThrow(/changed while it was proven; nothing removed/);
                expect(readFileSync(leasePath, 'utf8')).toBe(replacement);
            });
        });

        it('parses the recovery form alone and rejects it beside other arguments', () => {
            expect(parseReconcileTrackerIssueArgs(['--recover-lease', token])).toEqual({
                help: false,
                recoverLeaseToken: token,
            });
            expect(() => parseReconcileTrackerIssueArgs(['--recover-lease'])).toThrow(/--recover-lease <token>/);
            expect(() => parseReconcileTrackerIssueArgs(['--recover-lease', token, '2372'])).toThrow(
                /--recover-lease <token>/
            );
        });

        it('refuses CLI recovery of a live owner through the real liveness probe', async () => {
            const liveLease = JSON.stringify({ version: 2, pid: process.pid, token });
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-tracker-lease-cli-live-'));
            mkdirSync(join(root, '.git'));
            const leasePath = join(root, '.git', 'sourdaw-tracker-mutation.lease');
            writeFileSync(leasePath, liveLease);
            try {
                await expect(
                    runReconcileTrackerIssueCli(['--recover-lease', token], {
                        resolvePrimaryRoot: () => root,
                        authenticateTrackerAuthor: () => expect.fail('lease recovery must not authenticate'),
                    })
                ).rejects.toThrow(/live or unprovable; nothing removed/);
                expect(readFileSync(leasePath, 'utf8')).toBe(liveLease);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        it('recovers from the CLI without authenticating to GitHub', async () => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-tracker-lease-cli-'));
            mkdirSync(join(root, '.git'));
            const leasePath = join(root, '.git', 'sourdaw-tracker-mutation.lease');
            writeFileSync(leasePath, v2Lease);
            try {
                await expect(
                    runReconcileTrackerIssueCli(['--recover-lease', token], {
                        resolvePrimaryRoot: () => root,
                        authenticateTrackerAuthor: () => expect.fail('lease recovery must not authenticate'),
                        processIsProvenDead: dead,
                    })
                ).resolves.toBe(0);
                expect(existsSync(leasePath)).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    it('documents that the lease only serializes sanctioned local writers', () => {
        const source = readFileSync(join(import.meta.dirname, '../reconcileTrackerIssue.ts'), 'utf8');

        expect(source).toContain('Only sanctioned local writers are serialized');
        expect(source).toContain('External GitHub issue body edits are unsupported');
        expect(source).not.toContain('out-of-band writes are handled fail-closed');
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

        expect(() => completeTrackerIssue(2372, 'BOT_other', port)).toThrow(/authenticated author actor/i);
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
                authorNodeId: AUTHOR_BOT_LOGIN,
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
            authorNodeId: AUTHOR_BOT_LOGIN,
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
            authorNodeId: AUTHOR_BOT_LOGIN,
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
            authorNodeId: AUTHOR_BOT_LOGIN,
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
            authorNodeId: 'U_foreign',
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
            authorNodeId: AUTHOR_BOT_LOGIN,
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
            reconcileTrackerIssue({ issueNumber: 2372, expectedBodySha256: bodySha256, nextBody }, 'BOT_other', port)
        ).toThrow(/authenticated author actor/i);
        expect(calls).toEqual([]);
    });
});
