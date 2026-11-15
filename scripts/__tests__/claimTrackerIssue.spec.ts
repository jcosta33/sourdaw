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

type IssueFixture = {
    state?: string;
    ignoreLabelEdit?: boolean;
    timeline?: TimelineEntry[];
    hideClaimComments?: boolean;
    /** Runs after each timeline page is served, standing in for a write between two page fetches. */
    afterTimelinePage?: (page: number, timeline: TimelineEntry[]) => TimelineEntry[] | undefined;
    commentIds?: number[];
    boardTotalCount?: number;
    boardsResponse?: string;
    fieldLists?: Record<number, unknown>;
    failItemEdit?: (args: string[]) => string | undefined;
};

type TimelineEntry = {
    event: string;
    id?: number;
    body?: string;
    html_url?: string;
    user?: { node_id: string };
    label?: { name: string };
};

const OPERATOR_NODE_ID = 'MDQ6VXNlcjg5NzgyNzA=';
/** Another account's legacy GraphQL node id, the base64 of `04:User` and its database id. */
const FOREIGN_NODE_ID = Buffer.from('04:User1').toString('base64');
/** A claim token in the UUID shape the claim comment carries, one hex digit repeated per group. */
function fixtureToken(digit: string): string {
    return [8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-');
}

const TOKEN_A = fixtureToken('a');
const TOKEN_B = fixtureToken('b');
const TOKEN_STALE = fixtureToken('c');

/** The page size the claim requests, so fixtures can place entries on either side of a page boundary. */
const TIMELINE_PAGE_SIZE = 100;

/** Ordinary operator comments that are not claim tokens, numbered from 1. */
function noteComments(count: number): TimelineEntry[] {
    return Array.from({ length: count }, (_, index) => ({
        event: 'commented',
        id: index + 1,
        body: `Progress note ${index + 1}.`,
        user: { node_id: OPERATOR_NODE_ID },
    }));
}

function tokenComment(id: number, token: string, nodeId: string = OPERATOR_NODE_ID): TimelineEntry {
    return {
        event: 'commented',
        id,
        body: `Claimed by pnpm issue:claim (sourdaw-claim:v1:${token}).`,
        html_url: `https://github.com/jcosta33/sourdaw/issues/7#issuecomment-${id}`,
        user: { node_id: nodeId },
    };
}

/** The label edit applies to the fake's own label set, so the claim's read-back observes it. */
function appliedLabelEdit(labels: string[], args: string[]): string[] {
    const added = args.flatMap((token, index) => (args[index - 1] === '--add-label' ? [token] : []));
    const removed = args.flatMap((token, index) => (args[index - 1] === '--remove-label' ? [token] : []));
    return [...labels.filter((label) => !removed.includes(label)), ...added.filter((label) => !labels.includes(label))];
}

function labelEvents(before: string[], after: string[]): TimelineEntry[] {
    return [
        ...before.filter((label) => !after.includes(label)).map((name) => ({ event: 'unlabeled', label: { name } })),
        ...after.filter((label) => !before.includes(label)).map((name) => ({ event: 'labeled', label: { name } })),
    ];
}

/**
 * One shared fake issue that any number of claimers address, each through its own recorded `gh`.
 * Label edits, claim comments and their deletions land on the same timeline GitHub would return,
 * so two claims interleaved through it observe each other exactly as two real claimers would.
 */
function fakeIssue(initialLabels: string[], boards: BoardFixture[], issue: IssueFixture = {}) {
    let labels = initialLabels;
    let timeline: TimelineEntry[] = issue.timeline ?? [];
    const preassignedIds = issue.commentIds ?? [];
    let postedComments = 0;
    const issueView = (viewed: string[]) =>
        JSON.stringify({ labels: viewed.map((name) => ({ name })), state: issue.state ?? 'OPEN' });

    /**
     * Pages are positional like GitHub's `page`/`per_page` timeline: each page is cut from the
     * timeline as it stands when that page is fetched, so a deletion between two fetches shifts
     * later entries onto a page already read.
     */
    function timelinePages(): TimelineEntry[][] {
        const pages: TimelineEntry[][] = [];
        for (let page = 0; ; page += 1) {
            const visible =
                issue.hideClaimComments === true ? timeline.filter((e) => e.event !== 'commented') : timeline;
            const entries = visible.slice(page * TIMELINE_PAGE_SIZE, (page + 1) * TIMELINE_PAGE_SIZE);
            pages.push(entries);
            timeline = issue.afterTimelinePage?.(page, timeline) ?? timeline;
            if (entries.length < TIMELINE_PAGE_SIZE) {
                return pages;
            }
        }
    }

    function claimer(options: { firstReadBeforeAnyEdit?: boolean } = {}) {
        const calls: string[][] = [];
        const firstRead = labels;
        const gh: Gh = (args) => {
            calls.push(args);
            if (args[0] === 'issue' && args[1] === 'view') {
                const viewsSoFar = calls.filter((call) => call[0] === 'issue' && call[1] === 'view').length;
                return issueView(options.firstReadBeforeAnyEdit === true && viewsSoFar === 1 ? firstRead : labels);
            }
            if (args[0] === 'issue' && args[1] === 'edit') {
                if (issue.ignoreLabelEdit !== true) {
                    const edited = appliedLabelEdit(labels, args);
                    timeline = [...timeline, ...labelEvents(labels, edited)];
                    labels = edited;
                }
                return 'https://github.com/jcosta33/sourdaw/issues/4342';
            }
            if (args[0] === 'api' && args[1] === 'graphql') {
                return issue.boardsResponse ?? boardsGraphql(boards, issue.boardTotalCount);
            }
            if (args[0] === 'api' && args[1] === '-X' && args[2] === 'POST') {
                const id = preassignedIds[postedComments] ?? 5000 + postedComments;
                postedComments += 1;
                const body = (args[5] ?? '').slice('body='.length);
                const token = /sourdaw-claim:v1:([0-9a-f-]{36})/.exec(body)?.[1] ?? 'unparsed';
                timeline = [...timeline, { ...tokenComment(id, token), body }];
                return JSON.stringify({ id, body });
            }
            if (args[0] === 'api' && args[1] === '-X' && args[2] === 'DELETE') {
                const id = Number(args[3]?.split('/').at(-1));
                timeline = timeline.filter((entry) => !(entry.event === 'commented' && entry.id === id));
                return '';
            }
            if (args[0] === 'api' && args[1] === '--paginate') {
                return JSON.stringify(timelinePages());
            }
            if (args[0] === 'project' && args[1] === 'field-list') {
                const projectNumber = Number(args[2]);
                const listing = issue.fieldLists?.[projectNumber];
                return listing === undefined ? fieldListJson(projectNumber) : JSON.stringify(listing);
            }
            if (args[0] === 'project' && args[1] === 'item-edit') {
                const failure = issue.failItemEdit?.(args);
                if (failure !== undefined) {
                    throw new Error(failure);
                }
                return '';
            }
            throw new Error(`unexpected gh call: ${args.join(' ')}`);
        };
        return { gh, calls };
    }

    return { claimer, timeline: () => timeline, labels: () => labels };
}

function fakeGh(initialLabels: string[], boards: BoardFixture[], issue: IssueFixture = {}) {
    const shared = fakeIssue(initialLabels, boards, issue);
    const { gh, calls } = shared.claimer();
    const logs: string[] = [];
    return { gh, calls, logs, timeline: shared.timeline, labels: shared.labels };
}

function claimComments(timeline: TimelineEntry[]): TimelineEntry[] {
    return timeline.filter((entry) => entry.event === 'commented');
}

function callsWith(calls: string[][], head: string[]): string[][] {
    return calls.filter((call) => head.every((token, index) => call[index] === token));
}

describe('claim tracker issue', () => {
    it('swaps status:ready for status:active and moves the one board holding the issue', () => {
        const { gh, calls, logs } = fakeGh(['enhancement', 'priority:P3', 'status:ready'], [ROADMAP]);

        claimTrackerIssue(4342, gh, (message) => logs.push(message));

        const boardsIndex = calls.findIndex((call) => call[0] === 'api' && call[1] === 'graphql');
        const fieldsIndex = calls.findIndex((call) => call[0] === 'project' && call[1] === 'field-list');
        const editIndex = calls.findIndex((call) => call[0] === 'issue' && call[1] === 'edit');
        const moveIndex = calls.findIndex((call) => call[0] === 'project' && call[1] === 'item-edit');
        expect(boardsIndex).toBeGreaterThanOrEqual(0);
        expect(fieldsIndex).toBeGreaterThan(boardsIndex);
        expect(editIndex).toBeGreaterThan(fieldsIndex);
        expect(moveIndex).toBeGreaterThan(editIndex);
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
        expect(calls[0]).toEqual(['issue', 'view', '7', '--repo', 'jcosta33/sourdaw', '--json', 'labels,state']);
        expect(calls.some((call) => call[0] === 'project')).toBe(false);
    });

    it('refuses a closed issue before any write', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], { state: 'CLOSED' });

        expect(() => claimTrackerIssue(7, gh, () => undefined)).toThrow(/issue #7 is closed; /);
        expect(calls).toEqual([['issue', 'view', '7', '--repo', 'jcosta33/sourdaw', '--json', 'labels,state']]);
    });

    it('reads the labels back after the edit and refuses before any board write when the swap is not observed', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], { ignoreLabelEdit: true });

        expect(() => claimTrackerIssue(7, gh, () => undefined)).toThrow(
            /issue #7 label edit was not observed: status:active missing, status:ready still present/
        );
        expect(callsWith(calls, ['issue', 'view'])).toHaveLength(2);
        expect(callsWith(calls, ['api', '-X', 'POST'])).toEqual([]);
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
    });

    it('refuses an issue closed during the claim before any board write', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP]);
        const closesOnEdit: Gh = (args) => {
            const output = gh(args);
            if (args[0] === 'issue' && args[1] === 'view' && callsWith(calls, ['issue', 'edit']).length > 0) {
                return JSON.stringify({ ...JSON.parse(output), state: 'CLOSED' });
            }
            return output;
        };

        expect(() => claimTrackerIssue(7, closesOnEdit, () => undefined)).toThrow(
            'issue #7 closed during the claim; status labels were edited, no board was moved'
        );
        expect(callsWith(calls, ['issue', 'edit'])).toHaveLength(1);
        expect(callsWith(calls, ['api', '-X', 'POST'])).toEqual([]);
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
    });

    it('reads the labels back after the edit and refuses when only a planned removal is still present', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP]);
        const keepsReady: Gh = (args) => {
            const output = gh(args);
            if (args[0] === 'issue' && args[1] === 'view' && callsWith(calls, ['issue', 'edit']).length > 0) {
                return JSON.stringify({ labels: [{ name: 'status:active' }, { name: 'status:ready' }], state: 'OPEN' });
            }
            return output;
        };

        expect(() => claimTrackerIssue(7, keepsReady, () => undefined)).toThrow(/status:ready still present/);
        expect(callsWith(calls, ['api', '-X', 'POST'])).toEqual([]);
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
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

describe('board refusals before any claim write', () => {
    const TWENTY_ONE_BOARDS = 21;
    const refusals: { name: string; boards: BoardFixture[]; issue: IssueFixture; refusal: RegExp }[] = [
        {
            name: 'a second board whose Status field has no In progress option',
            boards: [ROADMAP, BUGS],
            issue: {
                fieldLists: {
                    2: { fields: [{ name: 'Status', id: 'F_status_2', options: [{ name: 'Done', id: 'opt_done' }] }] },
                },
            },
            refusal: /board "Sourdaw Bugs" Status field has no "In progress" option/,
        },
        {
            name: 'a board with no readable Status field',
            boards: [ROADMAP],
            issue: { fieldLists: { 3: { fields: [{ name: 'Area', id: 'F_area' }] } } },
            refusal: /board "Sourdaw Roadmap" has no readable Status single-select field/,
        },
        {
            name: 'a board whose field list is malformed',
            boards: [ROADMAP],
            issue: { fieldLists: { 3: { message: 'not found' } } },
            refusal: /board "Sourdaw Roadmap" field list returned malformed data/,
        },
        {
            name: 'more boards than one page reads',
            boards: [ROADMAP],
            issue: { boardTotalCount: TWENTY_ONE_BOARDS },
            refusal: /sits on 21 project boards but the claim read only 1/,
        },
        {
            name: 'a malformed board membership envelope',
            boards: [ROADMAP],
            issue: { boardsResponse: JSON.stringify({ data: { repository: { issue: {} } } }) },
            refusal: /issue #7 board membership returned malformed data/,
        },
    ];

    for (const row of refusals) {
        it(`refuses ${row.name} before the label swap, the claim comment, or any board move`, () => {
            const { gh, calls, labels, timeline } = fakeGh(['bug', 'status:ready'], row.boards, row.issue);

            expect(() => claimTrackerIssue(7, gh, () => undefined, TOKEN_A)).toThrow(row.refusal);

            expect(callsWith(calls, ['issue', 'edit'])).toEqual([]);
            expect(callsWith(calls, ['api', '-X'])).toEqual([]);
            expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
            expect(labels()).toEqual(['bug', 'status:ready']);
            expect(timeline()).toEqual([]);
        });
    }

    it('keeps the won claim and moves the other boards when one board move fails, naming the board to move by hand', () => {
        const { gh, calls, labels, timeline } = fakeGh(['bug', 'status:ready'], [ROADMAP, BUGS], {
            failItemEdit: (args) => (args.includes('PVT_roadmap') ? 'HTTP 403: Resource not accessible' : undefined),
        });

        expect(() => claimTrackerIssue(7, gh, () => undefined, TOKEN_A)).toThrow(
            'issue #7 is claimed: status:active and this claim comment stay on the issue; ' +
                'board "Sourdaw Roadmap" was not moved to In progress (HTTP 403: Resource not accessible); ' +
                'move it by hand'
        );

        expect(callsWith(calls, ['project', 'item-edit'])).toHaveLength(2);
        expect(callsWith(calls, ['api', '-X', 'DELETE'])).toEqual([]);
        expect(labels()).toContain('status:active');
        expect(claimComments(timeline()).map((entry) => entry.id)).toEqual([5000]);
    });

    it('names every board left unmoved when more than one board move fails', () => {
        const { gh, calls, labels } = fakeGh(['bug', 'status:ready'], [ROADMAP, BUGS], {
            failItemEdit: (args) => (args.includes('PVT_roadmap') ? 'HTTP 403' : 'HTTP 502'),
        });

        expect(() => claimTrackerIssue(7, gh, () => undefined, TOKEN_A)).toThrow(
            'issue #7 is claimed: status:active and this claim comment stay on the issue; ' +
                'board "Sourdaw Roadmap" was not moved to In progress (HTTP 403); ' +
                'board "Sourdaw Bugs" was not moved to In progress (HTTP 502); move them by hand'
        );

        expect(callsWith(calls, ['project', 'item-edit'])).toHaveLength(2);
        expect(labels()).toContain('status:active');
    });
});

describe('concurrent claims', () => {
    function itemEdits(...callLists: string[][][]): string[][] {
        return callLists.flatMap((calls) => callsWith(calls, ['project', 'item-edit']));
    }

    it('lets only the claim that saw its token alone move the board when both read the labels before either edit', () => {
        const issue = fakeIssue(['bug', 'status:ready'], [ROADMAP]);
        const first = issue.claimer();
        const second = issue.claimer({ firstReadBeforeAnyEdit: true });

        claimTrackerIssue(7, first.gh, () => undefined, TOKEN_A);
        expect(() => claimTrackerIssue(7, second.gh, () => undefined, TOKEN_B)).toThrow(
            'issue #7 was claimed concurrently by https://github.com/jcosta33/sourdaw/issues/7#issuecomment-5000; ' +
                'this claim withdrew its comment and moved no board; ' +
                'status:active stays on the issue — if no lane holds it, remove the label and claim again'
        );

        expect(itemEdits(first.calls)).toHaveLength(1);
        expect(itemEdits(second.calls)).toEqual([]);
        expect(second.calls).toContainEqual(['api', '-X', 'DELETE', 'repos/jcosta33/sourdaw/issues/comments/5001']);
        expect(claimComments(issue.timeline()).map((entry) => entry.id)).toEqual([5000]);
        expect(issue.labels()).toContain('status:active');
    });

    it('elects one claim when a lower comment id becomes visible after a higher one was read alone', () => {
        const issue = fakeIssue(['bug', 'status:ready'], [ROADMAP], { commentIds: [5001, 5000] });
        const first = issue.claimer();
        const second = issue.claimer({ firstReadBeforeAnyEdit: true });

        claimTrackerIssue(7, first.gh, () => undefined, TOKEN_A);
        expect(() => claimTrackerIssue(7, second.gh, () => undefined, TOKEN_B)).toThrow(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-5001; /
        );

        expect(itemEdits(first.calls)).toHaveLength(1);
        expect(itemEdits(second.calls)).toEqual([]);
        expect(claimComments(issue.timeline()).map((entry) => entry.id)).toEqual([5001]);
    });

    it('refuses the later claim when a comment on an already-read timeline page is deleted before the next page is read', () => {
        let deleteBetweenPages = false;
        const issue = fakeIssue(['bug', 'status:ready'], [ROADMAP], {
            timeline: noteComments(TIMELINE_PAGE_SIZE - 2),
            afterTimelinePage: (page, timeline) => {
                if (!deleteBetweenPages || page !== 0) {
                    return undefined;
                }
                deleteBetweenPages = false;
                return timeline.filter((entry) => entry.id !== 5);
            },
        });
        const first = issue.claimer();
        const second = issue.claimer({ firstReadBeforeAnyEdit: true });

        claimTrackerIssue(7, first.gh, () => undefined, TOKEN_A);
        deleteBetweenPages = true;
        expect(() => claimTrackerIssue(7, second.gh, () => undefined, TOKEN_B)).toThrow(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-5000; /
        );

        expect(deleteBetweenPages).toBe(false);
        expect(itemEdits(first.calls)).toHaveLength(1);
        expect(itemEdits(second.calls)).toEqual([]);
        expect(second.calls).toContainEqual(['api', '-X', 'DELETE', 'repos/jcosta33/sourdaw/issues/comments/5001']);
        expect(claimComments(issue.timeline()).filter((entry) => entry.id === 5000 || entry.id === 5001)).toHaveLength(
            1
        );
    });

    it('refuses the later claim when deletions during two consecutive reads hide the same rival token from both', () => {
        let armed = false;
        let read = 0;
        const issue = fakeIssue(['bug', 'status:ready'], [ROADMAP], {
            timeline: noteComments(2 * TIMELINE_PAGE_SIZE - 2),
            afterTimelinePage: (page, timeline) => {
                if (!armed) {
                    return undefined;
                }
                read += page === 0 ? 1 : 0;
                if (read === 1 && page === 1) {
                    return timeline.filter((entry) => entry.id !== 1);
                }
                if (read === 2 && page === 0) {
                    return timeline.filter((entry) => entry.id === undefined || entry.id < 2 || entry.id > 101);
                }
                return undefined;
            },
        });
        const first = issue.claimer();
        const second = issue.claimer({ firstReadBeforeAnyEdit: true });

        claimTrackerIssue(7, first.gh, () => undefined, TOKEN_A);
        armed = true;
        expect(() => claimTrackerIssue(7, second.gh, () => undefined, TOKEN_B)).toThrow(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-5000; /
        );

        expect(read).toBeGreaterThanOrEqual(2);
        expect(itemEdits(first.calls)).toHaveLength(1);
        expect(itemEdits(second.calls)).toEqual([]);
    });

    it('refuses and withdraws when no two consecutive timeline reads agree', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], {
            timeline: noteComments(TIMELINE_PAGE_SIZE - 2),
            afterTimelinePage: (page, timeline) => (page === 0 ? timeline.slice(1) : undefined),
        });

        expect(() => claimTrackerIssue(7, gh, () => undefined, TOKEN_A)).toThrow(
            'issue #7 timeline changed between every two consecutive reads of 4; no board was moved; ' +
                'status:active stays on the issue — if no lane holds it, remove the label and claim again'
        );
        expect(callsWith(calls, ['api', '--paginate'])).toHaveLength(4);
        expect(calls).toContainEqual(['api', '-X', 'DELETE', 'repos/jcosta33/sourdaw/issues/comments/5000']);
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
    });

    it('refuses both claims and moves no board when each reads the timeline holding both tokens', () => {
        const issue = fakeIssue(['bug', 'status:ready'], [ROADMAP]);
        const inner = issue.claimer({ firstReadBeforeAnyEdit: true });
        const outer = issue.claimer();
        let outerView: string | undefined;
        let innerError: unknown;
        const innerGh: Gh = (args) => {
            if (args[0] === 'api' && args[1] === '-X' && args[2] === 'DELETE') {
                outerView = outer.gh([
                    'api',
                    '--paginate',
                    '--slurp',
                    'repos/jcosta33/sourdaw/issues/7/timeline?per_page=100',
                ]);
            }
            return inner.gh(args);
        };
        const outerGh: Gh = (args) => {
            if (args[0] === 'api' && args[1] === '--paginate' && outerView === undefined) {
                try {
                    claimTrackerIssue(7, innerGh, () => undefined, TOKEN_B);
                } catch (error) {
                    innerError = error;
                }
            }
            return args[0] === 'api' && args[1] === '--paginate' ? (outerView ?? outer.gh(args)) : outer.gh(args);
        };

        expect(() => claimTrackerIssue(7, outerGh, () => undefined, TOKEN_A)).toThrow(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-5001; /
        );

        expect(String(innerError)).toMatch(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-5000; /
        );
        expect(itemEdits(inner.calls, outer.calls)).toEqual([]);
        expect(claimComments(issue.timeline())).toEqual([]);
        expect(issue.labels()).toContain('status:active');
    });

    it('lets the claim that posted first win when it runs entirely inside the other claim', () => {
        const issue = fakeIssue(['bug', 'status:ready'], [ROADMAP]);
        const inner = issue.claimer({ firstReadBeforeAnyEdit: true });
        const outer = issue.claimer();
        let innerError: unknown;
        const outerGh: Gh = (args) => {
            if (args[0] === 'issue' && args[1] === 'edit' && callsWith(inner.calls, ['issue', 'view']).length === 0) {
                try {
                    claimTrackerIssue(7, inner.gh, () => undefined, TOKEN_B);
                } catch (error) {
                    innerError = error;
                }
            }
            return outer.gh(args);
        };

        expect(() => claimTrackerIssue(7, outerGh, () => undefined, TOKEN_A)).toThrow(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-5000; /
        );

        expect(innerError).toBeUndefined();
        expect(itemEdits(inner.calls)).toHaveLength(1);
        expect(itemEdits(outer.calls)).toEqual([]);
        expect(outer.calls).toContainEqual(['api', '-X', 'DELETE', 'repos/jcosta33/sourdaw/issues/comments/5001']);
        expect(claimComments(issue.timeline()).map((entry) => entry.id)).toEqual([5000]);
    });

    it('posts the claim token only after the board reads and the observed label swap, and decides from the paginated timeline', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP]);

        claimTrackerIssue(7, gh, () => undefined, TOKEN_A);

        const heads = calls.map((call) => call.slice(0, 3).join(' '));
        expect(heads).toEqual([
            'issue view 7',
            'api graphql -f',
            'project field-list 3',
            'issue edit 7',
            'issue view 7',
            'api -X POST',
            'api --paginate --slurp',
            'api --paginate --slurp',
            'project item-edit --project-id',
        ]);
        expect(calls[5]).toEqual([
            'api',
            '-X',
            'POST',
            'repos/jcosta33/sourdaw/issues/7/comments',
            '-f',
            `body=Claimed by pnpm issue:claim (sourdaw-claim:v1:${TOKEN_A}).`,
        ]);
        expect(calls[6]).toEqual([
            'api',
            '--paginate',
            '--slurp',
            'repos/jcosta33/sourdaw/issues/7/timeline?per_page=100',
        ]);
        expect(calls[7]).toEqual(calls[6]);
    });

    it('ignores a claim token left before status:active was last removed', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], {
            timeline: [
                tokenComment(10, TOKEN_STALE),
                { event: 'labeled', label: { name: 'status:active' } },
                { event: 'unlabeled', label: { name: 'status:active' } },
            ],
        });

        claimTrackerIssue(7, gh, () => undefined, TOKEN_A);

        expect(callsWith(calls, ['project', 'item-edit'])).toHaveLength(1);
        expect(callsWith(calls, ['api', '-X', 'DELETE'])).toEqual([]);
    });

    it('starts the token window at the last release when the issue was claimed and released twice', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], {
            timeline: [
                tokenComment(10, TOKEN_STALE),
                { event: 'unlabeled', label: { name: 'status:active' } },
                tokenComment(11, fixtureToken('d')),
                { event: 'labeled', label: { name: 'status:active' } },
                { event: 'unlabeled', label: { name: 'status:active' } },
            ],
        });

        claimTrackerIssue(7, gh, () => undefined, TOKEN_A);

        expect(callsWith(calls, ['project', 'item-edit'])).toHaveLength(1);
        expect(callsWith(calls, ['api', '-X', 'DELETE'])).toEqual([]);
    });

    it('ignores earlier token comments another account wrote or that only quote a token', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], {
            timeline: [
                tokenComment(10, TOKEN_STALE, FOREIGN_NODE_ID),
                {
                    ...tokenComment(11, TOKEN_STALE),
                    body: `See Claimed by pnpm issue:claim (sourdaw-claim:v1:${TOKEN_STALE}).`,
                },
                {
                    ...tokenComment(12, TOKEN_STALE),
                    body: `Claimed by pnpm issue:claim (sourdaw-claim:v1:${TOKEN_STALE}). Released by hand.`,
                },
            ],
        });

        claimTrackerIssue(7, gh, () => undefined, TOKEN_A);

        expect(callsWith(calls, ['project', 'item-edit'])).toHaveLength(1);
    });

    it('refuses behind an earlier operator token posted since the last release and withdraws its own', () => {
        const { gh, calls, timeline } = fakeGh(['bug', 'status:ready'], [ROADMAP], {
            timeline: [tokenComment(10, TOKEN_STALE)],
        });

        expect(() => claimTrackerIssue(7, gh, () => undefined, TOKEN_A)).toThrow(
            /issue #7 was claimed concurrently by https:\/\/github\.com\/jcosta33\/sourdaw\/issues\/7#issuecomment-10; /
        );
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
        expect(claimComments(timeline()).map((entry) => entry.id)).toEqual([10]);
    });

    it('withdraws its comment and moves no board when its own token is not on the timeline', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP], { hideClaimComments: true });

        expect(() => claimTrackerIssue(7, gh, () => undefined, TOKEN_A)).toThrow(
            'issue #7 claim comment was not observed on the timeline; no board was moved; ' +
                'status:active stays on the issue — if no lane holds it, remove the label and claim again'
        );
        expect(calls).toContainEqual(['api', '-X', 'DELETE', 'repos/jcosta33/sourdaw/issues/comments/5000']);
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
    });

    it('withdraws its comment when the timeline read fails, and reports a failed withdrawal too', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP]);
        const timelineFails: Gh = (args) => {
            if (args[0] === 'api' && args[1] === '--paginate') {
                throw new Error('HTTP 502');
            }
            return gh(args);
        };

        expect(() => claimTrackerIssue(7, timelineFails, () => undefined, TOKEN_A)).toThrow('HTTP 502');
        expect(calls).toContainEqual(['api', '-X', 'DELETE', 'repos/jcosta33/sourdaw/issues/comments/5000']);

        const second = fakeGh(['bug', 'status:ready'], [ROADMAP]);
        const withdrawalFails: Gh = (args) => {
            if (args[0] === 'api' && args[1] === '-X' && args[2] === 'DELETE') {
                throw new Error('HTTP 403');
            }
            return args[0] === 'api' && args[1] === '--paginate' ? timelineFails(args) : second.gh(args);
        };
        expect(() => claimTrackerIssue(7, withdrawalFails, () => undefined, TOKEN_A)).toThrow(
            'HTTP 502; withdrawing claim comment 5000 also failed: HTTP 403'
        );
    });

    it('refuses a malformed timeline instead of deciding the claim', () => {
        const { gh, calls } = fakeGh(['bug', 'status:ready'], [ROADMAP]);
        const malformed: Gh = (args) =>
            args[0] === 'api' && args[1] === '--paginate' ? JSON.stringify({ message: 'nope' }) : gh(args);

        expect(() => claimTrackerIssue(7, malformed, () => undefined, TOKEN_A)).toThrow(
            'issue #7 timeline returned malformed data'
        );
        expect(callsWith(calls, ['project', 'item-edit'])).toEqual([]);
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
        expect(() => assertTrustedClaimLauncherBinding({ ...binding, originSource: undefined })).toThrow(
            'scripts/claimTrackerIssue.ts has no blob on origin/main; refusing to run an unverifiable copy'
        );
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
        let claimed = false;
        let claimBody = '';
        const { deps, createGhSessions, authSession } = recordingDeps(order, (args) => {
            if (args[0] === 'issue' && args[1] === 'view') {
                return JSON.stringify({ labels: claimed ? [{ name: 'status:active' }] : [], state: 'OPEN' });
            }
            if (args[0] === 'api' && args[2] === 'POST') {
                claimBody = (args[5] ?? '').slice('body='.length);
                return JSON.stringify({ id: 1 });
            }
            if (args[0] === 'api' && args[1] === '--paginate') {
                return JSON.stringify([
                    [{ event: 'commented', id: 1, body: claimBody, user: { node_id: OPERATOR_NODE_ID } }],
                ]);
            }
            if (args[0] === 'api') {
                return boardsGraphql([]);
            }
            if (args[0] === 'issue' && args[1] === 'edit') {
                claimed = true;
                return '';
            }
            throw new Error(`unexpected gh call: ${args.join(' ')}`);
        });

        await expect(runClaimTrackerIssueCli(['9'], deps)).resolves.toBe(0);

        expect(order).toEqual(['bind', 'authenticate', 'gh', 'gh', 'gh', 'gh', 'gh', 'gh', 'gh', 'dispose']);
        expect(createGhSessions).toHaveLength(1);
        expect(createGhSessions[0]).toBe(authSession);
    });

    it('disposes the session even when the claim refuses after authentication', async () => {
        const order: string[] = [];
        const { deps } = recordingDeps(order, (args) => {
            if (args[0] === 'issue' && args[1] === 'view') {
                return JSON.stringify({ labels: [{ name: 'status:active' }], state: 'OPEN' });
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
