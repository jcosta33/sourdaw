import { describe, expect, it } from 'vitest';

import {
    ACTIVE_STATUS_LABEL,
    assertTrustedClaimLauncherBinding,
    boardsFromGraphql,
    claimTrackerIssue,
    labelNamesFromRow,
    labelSwapPlan,
    parseClaimArgs,
    runClaimTrackerIssueCli,
    statusFieldIds,
    trustedClaimRuntime,
    type ClaimBoardItem,
    type ClaimCliDeps,
    type Gh,
} from '../claimTrackerIssue.ts';

/**
 * The claim is a public tracker write under the operator credential, so the only way a test may
 * exercise the path from read to write is through an injected `gh`. A fake here answers the exact
 * `gh` argv the real port issues and records every call, so the assertions pin both the decisions
 * (which labels, which boards, which ids) and the commands that carry them.
 */
type BoardFixture = {
    itemId: string;
    projectId: string;
    projectNumber: number;
    projectTitle: string;
    statusName?: string;
};

const ROADMAP: BoardFixture = {
    itemId: 'PVTI_roadmap-item',
    projectId: 'PVT_roadmap',
    projectNumber: 3,
    projectTitle: 'Sourdaw Roadmap',
    statusName: 'Ready',
};

const BUGS: BoardFixture = {
    itemId: 'PVTI_bugs-item',
    projectId: 'PVT_bugs',
    projectNumber: 2,
    projectTitle: 'Sourdaw Bugs',
    statusName: 'Needs evidence',
};

function boardsGraphql(boards: BoardFixture[], totalCount: number = boards.length): string {
    return JSON.stringify({
        data: {
            repository: {
                issue: {
                    projectItems: {
                        totalCount,
                        nodes: boards.map((board) => ({
                            id: board.itemId,
                            project: {
                                id: board.projectId,
                                number: board.projectNumber,
                                title: board.projectTitle,
                                owner: { login: 'jcosta33' },
                            },
                            fieldValueByName: board.statusName === undefined ? null : { name: board.statusName },
                        })),
                    },
                },
            },
        },
    });
}

function fieldListJson(projectNumber: number): string {
    return JSON.stringify({
        fields: [
            { name: 'Title', type: 'ProjectV2Field', id: 'F_title' },
            {
                name: 'Status',
                type: 'ProjectV2SingleSelectField',
                id: `F_status_${projectNumber}`,
                options: [
                    { name: 'Ready', id: 'opt_ready' },
                    { name: 'In progress', id: `opt_in_progress_${projectNumber}` },
                    { name: 'Done', id: 'opt_done' },
                ],
            },
        ],
    });
}

function fakeGh(labels: string[], boards: BoardFixture[]) {
    const calls: string[][] = [];
    const gh: Gh = (args) => {
        calls.push(args);
        if (args[0] === 'issue' && args[1] === 'view') {
            return JSON.stringify({ labels: labels.map((name) => ({ name })) });
        }
        if (args[0] === 'api') {
            return boardsGraphql(boards);
        }
        if (args[0] === 'project' && args[1] === 'field-list') {
            return fieldListJson(Number(args[2]));
        }
        if (args[0] === 'project' && args[1] === 'item-edit') {
            return '';
        }
        if (args[0] === 'issue' && args[1] === 'edit') {
            return 'https://github.com/jcosta33/sourdaw/issues/4342';
        }
        throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    const logs: string[] = [];
    return { gh, calls, logs };
}

function callsWith(calls: string[][], head: string[]): string[][] {
    return calls.filter((call) => head.every((token, index) => call[index] === token));
}

describe('claim tracker issue', () => {
    it('swaps status:ready for status:active and moves the one board holding the issue', () => {
        const { gh, calls, logs } = fakeGh(['enhancement', 'priority:P3', 'status:ready'], [ROADMAP]);

        claimTrackerIssue(4342, gh, (message) => logs.push(message));

        const editIndex = calls.findIndex((call) => call[0] === 'issue' && call[1] === 'edit');
        const boardsIndex = calls.findIndex((call) => call[0] === 'api');
        const moveIndex = calls.findIndex((call) => call[0] === 'project' && call[1] === 'item-edit');
        expect(editIndex).toBeGreaterThanOrEqual(0);
        expect(boardsIndex).toBeGreaterThan(editIndex);
        expect(moveIndex).toBeGreaterThan(boardsIndex);
        expect(calls).toContainEqual([
            'issue',
            'edit',
            '4342',
            '--repo',
            'jcosta33/sourdaw',
            '--add-label',
            'status:active',
            '--remove-label',
            'status:ready',
        ]);
        expect(calls).toContainEqual(['project', 'field-list', '3', '--owner', 'jcosta33', '--format', 'json']);
        expect(calls).toContainEqual([
            'project',
            'item-edit',
            '--project-id',
            'PVT_roadmap',
            '--id',
            'PVTI_roadmap-item',
            '--field-id',
            'F_status_3',
            '--single-select-option-id',
            'opt_in_progress_3',
        ]);
        expect(logs.some((line) => line.includes('moved to In progress'))).toBe(true);
    });

    it('moves every board holding the issue when it sits on two, each with its own live ids', () => {
        const { gh, calls } = fakeGh(['bug', 'priority:P1', 'status:ready'], [ROADMAP, BUGS]);

        claimTrackerIssue(7, gh, () => undefined);

        const boardsCall = calls.find((call) => call[0] === 'api' && call[1] === 'graphql');
        expect(boardsCall).toEqual([
            'api',
            'graphql',
            '-f',
            'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){' +
                'projectItems(first:20){totalCount nodes{id project{id number title owner{... on User{login} ... on Organization{login}}} ' +
                'fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}',
            '-f',
            'owner=jcosta33',
            '-f',
            'name=sourdaw',
            '-F',
            'number=7',
        ]);
        expect(callsWith(calls, ['project', 'field-list'])).toHaveLength(2);
        expect(calls).toContainEqual(['project', 'field-list', '3', '--owner', 'jcosta33', '--format', 'json']);
        expect(calls).toContainEqual(['project', 'field-list', '2', '--owner', 'jcosta33', '--format', 'json']);
        expect(callsWith(calls, ['project', 'item-edit'])).toHaveLength(2);
        expect(calls).toContainEqual([
            'project',
            'item-edit',
            '--project-id',
            'PVT_bugs',
            '--id',
            'PVTI_bugs-item',
            '--field-id',
            'F_status_2',
            '--single-select-option-id',
            'opt_in_progress_2',
        ]);
    });

    it('refuses an issue that already carries status:active and writes nothing further', () => {
        const { gh, calls } = fakeGh(['bug', 'status:active'], [ROADMAP]);

        expect(() => claimTrackerIssue(7, gh, () => undefined)).toThrow(/already carries status:active/);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual(['issue', 'view', '7', '--repo', 'jcosta33/sourdaw', '--json', 'labels']);
        expect(calls.some((call) => call[0] === 'project')).toBe(false);
    });

    it('claims a no-board issue with the label swap alone, touching no board', () => {
        const { gh, calls, logs } = fakeGh(['bug', 'priority:P2', 'status:needs-evidence'], []);

        claimTrackerIssue(9, gh, (message) => logs.push(message));

        expect(calls).toContainEqual([
            'issue',
            'edit',
            '9',
            '--repo',
            'jcosta33/sourdaw',
            '--add-label',
            'status:active',
            '--remove-label',
            'status:needs-evidence',
        ]);
        expect(calls.some((call) => call[0] === 'project')).toBe(false);
        expect(logs.some((line) => line.includes('sits on no project board'))).toBe(true);
    });

    it('leaves a board that already reads In progress untouched', () => {
        const { gh, calls, logs } = fakeGh(
            ['enhancement', 'status:ready'],
            [{ ...ROADMAP, statusName: 'In progress' }]
        );

        claimTrackerIssue(4342, gh, (message) => logs.push(message));

        expect(calls.some((call) => call[0] === 'project' && call[1] === 'field-list')).toBe(false);
        expect(calls.some((call) => call[0] === 'project' && call[1] === 'item-edit')).toBe(false);
        expect(logs.some((line) => line.includes('already In progress'))).toBe(true);
    });

    it('reads field and option ids from the live listing, never from recorded values', () => {
        const board: ClaimBoardItem = {
            itemId: 'i',
            projectId: 'p',
            projectNumber: 4,
            projectOwner: 'jcosta33',
            projectTitle: 'Sourdaw Refactors',
            statusName: 'Ready',
        };

        expect(statusFieldIds(JSON.parse(fieldListJson(4)), board)).toEqual({
            fieldId: 'F_status_4',
            optionId: 'opt_in_progress_4',
        });
        expect(() => statusFieldIds({ fields: [{ name: 'Area', id: 'F_area' }] }, board)).toThrow(
            /has no readable Status single-select field/
        );
        expect(() =>
            statusFieldIds(
                { fields: [{ name: 'Status', id: 'F_status', options: [{ name: 'Done', id: 'opt_done' }] }] },
                board
            )
        ).toThrow(/has no "In progress" option/);
    });
});

describe('claim label plan', () => {
    it('removes every other status label so the issue carries exactly one status', () => {
        expect(labelSwapPlan(['status:ready'])).toEqual({ add: ACTIVE_STATUS_LABEL, remove: ['status:ready'] });
        expect(labelSwapPlan([])).toEqual({ add: ACTIVE_STATUS_LABEL, remove: [] });
        expect(labelSwapPlan(['status:tracking'])).toEqual({ add: ACTIVE_STATUS_LABEL, remove: ['status:tracking'] });
        expect(labelSwapPlan(['status:needs-evidence', 'bug'])).toEqual({
            add: ACTIVE_STATUS_LABEL,
            remove: ['status:needs-evidence'],
        });
    });

    it('reads label names from the issue row', () => {
        expect(labelNamesFromRow({ labels: [{ name: 'bug' }, { name: 'status:ready' }] }, 'issue labels')).toEqual([
            'bug',
            'status:ready',
        ]);
        expect(() => labelNamesFromRow({ labels: 'nope' }, 'issue labels')).toThrow(/malformed/);
    });
});

describe('claim board parsing', () => {
    it('parses item, project, and current status from the graphql envelope', () => {
        const envelope = JSON.parse(boardsGraphql([ROADMAP]));
        expect(boardsFromGraphql(envelope, 4342)).toEqual([
            {
                itemId: 'PVTI_roadmap-item',
                projectId: 'PVT_roadmap',
                projectNumber: 3,
                projectOwner: 'jcosta33',
                projectTitle: 'Sourdaw Roadmap',
                statusName: 'Ready',
            },
        ]);
        const unset = JSON.parse(boardsGraphql([{ ...ROADMAP, statusName: undefined }]));
        expect(boardsFromGraphql(unset, 4342)[0]?.statusName).toBeUndefined();
    });

    it('refuses a malformed board envelope instead of guessing', () => {
        expect(() => boardsFromGraphql({ data: {} }, 4342)).toThrow(/malformed/);
        expect(() =>
            boardsFromGraphql({ data: { repository: { issue: { projectItems: { nodes: [{ id: 5 }] } } } } }, 4342)
        ).toThrow(/malformed/);
    });

    it('refuses loudly when the issue sits on more boards than one page reads', () => {
        const truncated = JSON.parse(boardsGraphql([ROADMAP], 21));
        expect(() => boardsFromGraphql(truncated, 4342)).toThrow(/sits on 21 project boards but the claim read only 1/);
    });
});

describe('claim arguments', () => {
    it('takes exactly one issue number', () => {
        expect(parseClaimArgs(['4342'])).toEqual({ help: false, issue: 4342 });
        expect(parseClaimArgs(['--help'])).toEqual({ help: true });
        expect(() => parseClaimArgs([])).toThrow(/usage: pnpm issue:claim/);
        expect(() => parseClaimArgs(['--help', '4342'])).toThrow(/--help takes no other arguments/);
        expect(() => parseClaimArgs(['abc'])).toThrow(/usage: pnpm issue:claim/);
        expect(() => parseClaimArgs(['4342', 'extra'])).toThrow(/usage: pnpm issue:claim/);
    });
});

describe('claim trusted runtime', () => {
    it('refuses to run outside the protected primary launcher', () => {
        expect(() => trustedClaimRuntime({})).toThrow(/protected primary checkout launcher/);
        expect(() =>
            trustedClaimRuntime({
                SOURDAW_TRUSTED_PRIMARY_ROOT: '/repo',
                SOURDAW_TRUSTED_GIT_PATH: '/usr/bin/git',
                SOURDAW_TRUSTED_GH_PATH: '/usr/local/bin/gh',
            })
        ).toThrow(/protected primary checkout launcher/);
        expect(
            trustedClaimRuntime({
                SOURDAW_TRUSTED_PRIMARY_ROOT: '/repo',
                SOURDAW_TRUSTED_GIT_PATH: '/usr/bin/git',
                SOURDAW_TRUSTED_GH_PATH: '/usr/local/bin/gh',
                SOURDAW_TRUSTED_ORIGIN_COMMIT: 'a'.repeat(40),
            })
        ).toEqual({
            primaryRoot: '/repo',
            gitPath: '/usr/bin/git',
            ghPath: '/usr/local/bin/gh',
            originCommit: 'a'.repeat(40),
        });
    });
});

describe('claim launcher binding', () => {
    const binding = {
        resolvedCwd: '/repo',
        resolvedPrimaryRoot: '/repo',
        executingFile: '/snapshot/scripts/claimTrackerIssue.ts',
        executingSource: 'source',
        originSource: 'source' as string | undefined,
    };

    it('admits the primary root with the pinned source', () => {
        expect(() => assertTrustedClaimLauncherBinding(binding)).not.toThrow();
        expect(() => assertTrustedClaimLauncherBinding({ ...binding, originSource: undefined })).not.toThrow();
    });

    it('refuses a lane worktree even with fully forged launcher env', () => {
        expect(() =>
            assertTrustedClaimLauncherBinding({ ...binding, resolvedCwd: '/repo/.agents/worktrees/agent-1-x' })
        ).toThrow(/must be launched from the protected primary checkout/);
    });

    it('refuses an executing source that diverges from the pinned origin blob', () => {
        expect(() => assertTrustedClaimLauncherBinding({ ...binding, executingSource: 'mutated' })).toThrow(
            /does not match origin\/main; refusing to run a mutated copy/
        );
    });
});

describe('claim cli wiring', () => {
    type ClaimSession = { env: NodeJS.ProcessEnv; dispose: () => void };

    function recordingDeps(order: string[], ghResponses: (args: string[]) => string) {
        const createGhSessions: ClaimSession[] = [];
        const authSession: ClaimSession = { env: {}, dispose: () => order.push('dispose') };
        const deps: ClaimCliDeps = {
            bindLauncher: () => order.push('bind'),
            authenticate: () => {
                order.push('authenticate');
                return { session: authSession };
            },
            createGh: (session) => {
                createGhSessions.push(session);
                return (args) => {
                    order.push('gh');
                    return ghResponses(args);
                };
            },
            log: () => undefined,
        };
        return { deps, createGhSessions, authSession };
    }

    it('binds the launcher, then authenticates, then hands gh the authenticated session, disposing it last', async () => {
        const order: string[] = [];
        const { deps, createGhSessions, authSession } = recordingDeps(order, (args) => {
            if (args[0] === 'issue' && args[1] === 'view') {
                return JSON.stringify({ labels: [] });
            }
            if (args[0] === 'api') {
                return boardsGraphql([]);
            }
            if (args[0] === 'issue' && args[1] === 'edit') {
                return '';
            }
            throw new Error(`unexpected gh call: ${args.join(' ')}`);
        });

        await expect(runClaimTrackerIssueCli(['9'], deps)).resolves.toBe(0);

        expect(order).toEqual(['bind', 'authenticate', 'gh', 'gh', 'gh', 'dispose']);
        expect(createGhSessions).toHaveLength(1);
        expect(createGhSessions[0]).toBe(authSession);
    });

    it('disposes the session even when the claim refuses after authentication', async () => {
        const order: string[] = [];
        const { deps } = recordingDeps(order, (args) => {
            if (args[0] === 'issue' && args[1] === 'view') {
                return JSON.stringify({ labels: [{ name: 'status:active' }] });
            }
            throw new Error(`unexpected gh call: ${args.join(' ')}`);
        });

        await expect(runClaimTrackerIssueCli(['7'], deps)).rejects.toThrow(/already carries status:active/);

        expect(order).toEqual(['bind', 'authenticate', 'gh', 'dispose']);
    });

    it('refuses before binding or authentication when the argument is not one issue number', async () => {
        const order: string[] = [];
        const { deps } = recordingDeps(order, () => {
            throw new Error('gh must not be called');
        });

        await expect(runClaimTrackerIssueCli(['nonsense'], deps)).rejects.toThrow(/usage: pnpm issue:claim/);
        expect(order).toEqual([]);
    });
});
