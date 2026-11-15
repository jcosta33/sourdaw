#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ORCHESTRATOR_USER_NODE_ID,
    REQUIRED_REPOSITORY,
    assertTrustedExecutingBlob,
    authenticateOrchestratorSession,
    githubAuthorizationGitEnv,
    originMainBlob,
    parseGraphqlResponse,
    parseJson,
    spawnCapture,
} from './githubAppIdentity.ts';
import {
    TRUSTED_GH_PATH_ENV,
    TRUSTED_GIT_PATH_ENV,
    TRUSTED_ORIGIN_COMMIT_ENV,
    TRUSTED_PRIMARY_ROOT_ENV,
    fail,
} from './prContract.ts';

export const CLAIM_USAGE = 'usage: pnpm issue:claim <issue-number>';

export const ACTIVE_STATUS_LABEL = 'status:active';
const STATUS_LABEL_PREFIX = 'status:';
const STATUS_FIELD_NAME = 'Status';
const IN_PROGRESS_OPTION_NAME = 'In progress';

export type ClaimArgs = {
    help: boolean;
    issue?: number;
};

export function parseClaimArgs(args: string[]): ClaimArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const issue = Number(args[0]);
    if (args.length !== 1 || !Number.isSafeInteger(issue) || issue <= 0) {
        fail(CLAIM_USAGE);
    }
    return { help: false, issue };
}

export type ClaimBoardItem = {
    itemId: string;
    projectId: string;
    projectNumber: number;
    projectOwner: string;
    projectTitle: string;
    statusName: string | undefined;
};

/**
 * The claim reads and validates every board it will move before its first write, so a board the
 * claim cannot move (too many to read, no readable Status field, no In progress option) refuses
 * with the issue untouched and a rerun can claim it once the board is fixed. The label swap then
 * runs before the board move: the labels are the claim another agent's survey reads. The claim
 * reads the labels back after the edit and moves no board until the swap is observed. The
 * read-back proves the write landed, not exclusivity: two operators claiming at once both add an
 * already-present label without error, so exclusivity comes from the claim token below. A board
 * write that fails after the claim has won leaves the claim standing, so a rerun refuses on
 * status:active; the operator completes that board move by hand under the manual-gh exception for
 * an issue's own project membership.
 */
export function labelSwapPlan(labels: string[]): { add: string; remove: string[] } {
    return {
        add: ACTIVE_STATUS_LABEL,
        remove: labels.filter((label) => label.startsWith(STATUS_LABEL_PREFIX) && label !== ACTIVE_STATUS_LABEL),
    };
}

export function issueLabelsArgs(issue: number): string[] {
    return ['issue', 'view', String(issue), '--repo', REQUIRED_REPOSITORY, '--json', 'labels,state'];
}

type IssueClaimRow = { labels: string[]; state: string };

function readIssueClaimRow(issue: number, gh: Gh): IssueClaimRow {
    const label = `issue #${issue} labels`;
    const row = parseJson<{ labels?: unknown; state?: unknown }>(gh(issueLabelsArgs(issue)), label);
    if (typeof row.state !== 'string') {
        fail(`${label} returned malformed data`);
    }
    return { labels: labelNamesFromRow(row, label), state: row.state };
}

function assertLabelSwapObserved(issue: number, labels: string[], plan: { add: string; remove: string[] }): void {
    const missing = labels.includes(plan.add) ? [] : [`${plan.add} missing`];
    const lingering = plan.remove.filter((label) => labels.includes(label)).map((label) => `${label} still present`);
    const problems = [...missing, ...lingering];
    if (problems.length > 0) {
        fail(`issue #${issue} label edit was not observed: ${problems.join(', ')}; no board was moved`);
    }
}

export function labelNamesFromRow(row: { labels?: unknown }, label: string): string[] {
    if (!Array.isArray(row.labels)) {
        fail(`${label} returned malformed data`);
    }
    return row.labels.map((entry) => {
        if (typeof entry !== 'object' || entry === null || typeof (entry as { name?: unknown }).name !== 'string') {
            fail(`${label} returned malformed data`);
        }
        return (entry as { name: string }).name;
    });
}

export function issueEditLabelsArgs(issue: number, plan: { add: string; remove: string[] }): string[] {
    const args = ['issue', 'edit', String(issue), '--repo', REQUIRED_REPOSITORY, '--add-label', plan.add];
    for (const label of plan.remove) {
        args.push('--remove-label', label);
    }
    return args;
}

const BOARD_QUERY =
    'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){' +
    'projectItems(first:20){totalCount nodes{id project{id number title owner{... on User{login} ... on Organization{login}}} ' +
    'fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}';

export function issueBoardsArgs(issue: number): string[] {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    return [
        'api',
        'graphql',
        '-f',
        `query=${BOARD_QUERY}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${issue}`,
    ];
}

function malformedBoards(issue: number): never {
    fail(`issue #${issue} board membership returned malformed data`);
}

export function boardsFromGraphql(response: unknown, issue: number): ClaimBoardItem[] {
    const envelope = response as {
        data?: { repository?: { issue?: { projectItems?: { totalCount?: unknown; nodes?: unknown } } } };
    };
    const connection = envelope.data?.repository?.issue?.projectItems;
    const nodes = connection?.nodes;
    if (!Array.isArray(nodes) || typeof connection?.totalCount !== 'number') {
        malformedBoards(issue);
    }
    if (connection.totalCount > nodes.length) {
        fail(
            `issue #${issue} sits on ${connection.totalCount} project boards but the claim read only ${nodes.length}; ` +
                'remove the issue from the extra boards or widen the claim'
        );
    }
    return nodes.map((node) => {
        if (typeof node !== 'object' || node === null) {
            malformedBoards(issue);
        }
        const item = node as { id?: unknown; project?: unknown; fieldValueByName?: { name?: unknown } };
        const project = item.project;
        if (typeof item.id !== 'string' || typeof project !== 'object' || project === null) {
            malformedBoards(issue);
        }
        const board = project as { id?: unknown; number?: unknown; title?: unknown; owner?: { login?: unknown } };
        const projectNumber = board.number;
        const ownerLogin = board.owner?.login;
        if (
            typeof board.id !== 'string' ||
            typeof projectNumber !== 'number' ||
            !Number.isSafeInteger(projectNumber) ||
            typeof board.title !== 'string' ||
            typeof ownerLogin !== 'string'
        ) {
            malformedBoards(issue);
        }
        const statusName =
            item.fieldValueByName === null || item.fieldValueByName === undefined
                ? undefined
                : item.fieldValueByName.name;
        if (statusName !== undefined && typeof statusName !== 'string') {
            malformedBoards(issue);
        }
        return {
            itemId: item.id,
            projectId: board.id,
            projectNumber,
            projectOwner: ownerLogin,
            projectTitle: board.title,
            statusName,
        };
    });
}

export function fieldListArgs(board: { projectNumber: number; projectOwner: string }): string[] {
    return ['project', 'field-list', String(board.projectNumber), '--owner', board.projectOwner, '--format', 'json'];
}

/**
 * Field and option ids are read live per board at claim time, never from a recorded list: the ids
 * are opaque GraphQL node values a board edit can rotate, while the names are the tracker's
 * documented contract (Tracking → Ready → In progress → Done).
 */
export function statusFieldIds(
    listing: unknown,
    board: { projectTitle: string }
): { fieldId: string; optionId: string } {
    const fields =
        typeof listing === 'object' && listing !== null && Array.isArray((listing as { fields?: unknown }).fields)
            ? (listing as { fields: unknown[] }).fields
            : undefined;
    if (fields === undefined) {
        fail(`board "${board.projectTitle}" field list returned malformed data`);
    }
    const status = fields.find(
        (field) =>
            typeof field === 'object' &&
            field !== null &&
            (field as { name?: unknown }).name === STATUS_FIELD_NAME &&
            typeof (field as { id?: unknown }).id === 'string' &&
            Array.isArray((field as { options?: unknown }).options)
    );
    if (status === undefined) {
        fail(`board "${board.projectTitle}" has no readable ${STATUS_FIELD_NAME} single-select field`);
    }
    const option = (status as { options: unknown[] }).options.find(
        (candidate) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            (candidate as { name?: unknown }).name === IN_PROGRESS_OPTION_NAME &&
            typeof (candidate as { id?: unknown }).id === 'string'
    );
    if (option === undefined) {
        fail(`board "${board.projectTitle}" ${STATUS_FIELD_NAME} field has no "${IN_PROGRESS_OPTION_NAME}" option`);
    }
    return { fieldId: (status as { id: string }).id, optionId: (option as { id: string }).id };
}

export function itemEditArgs(board: ClaimBoardItem, ids: { fieldId: string; optionId: string }): string[] {
    return [
        'project',
        'item-edit',
        '--project-id',
        board.projectId,
        '--id',
        board.itemId,
        '--field-id',
        ids.fieldId,
        '--single-select-option-id',
        ids.optionId,
    ];
}

export type Gh = (args: string[]) => string;

/**
 * Every claim runs as the same operator credential and re-adding a present label succeeds
 * silently, so nothing a claim reads about the labels says which claim wrote them. Each claim
 * therefore posts one comment carrying a fresh random token after its label swap is observed,
 * then reads the timeline until two consecutive reads agree, and wins only when its token is the sole claim token since
 * status:active was last removed. Of two concurrent claims, the one whose comment became visible
 * later sees both, so at most one sees itself alone, whatever order the comment ids or timestamps
 * fall in; both may lose and withdraw, never both win. A loser withdraws its own comment and moves
 * no board.
 *
 * The election assumes a comment is visible to every read that starts after its POST returns.
 * GitHub documents no such read-after-write guarantee for the REST API. A claim whose own comment
 * is not yet visible refuses; a rival's comment that one read cannot see yet is not detected.
 *
 * Posting after the swap means a claim that dies after posting leaves status:active behind, so
 * later claims refuse on the label, and removing that label releases the claim and starts a new
 * token window. Only comments the verified operator wrote whose whole body is the token line
 * count: anyone can comment on the public tracker, and a quoted token is not a claim.
 */
const CLAIM_TOKEN_PATTERN = /^Claimed by pnpm issue:claim \(sourdaw-claim:v1:([0-9a-f-]{36})\)\.$/;

export function claimTokenBody(token: string): string {
    return `Claimed by pnpm issue:claim (sourdaw-claim:v1:${token}).`;
}

export function postClaimTokenArgs(issue: number, token: string): string[] {
    return [
        'api',
        '-X',
        'POST',
        `repos/${REQUIRED_REPOSITORY}/issues/${issue}/comments`,
        '-f',
        `body=${claimTokenBody(token)}`,
    ];
}

export function issueTimelineArgs(issue: number): string[] {
    return ['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/issues/${issue}/timeline?per_page=100`];
}

export function deleteClaimTokenArgs(commentId: number): string[] {
    return ['api', '-X', 'DELETE', `repos/${REQUIRED_REPOSITORY}/issues/comments/${commentId}`];
}

export type ClaimToken = { commentId: number; token: string; url: string | undefined };

function postClaimToken(issue: number, token: string, gh: Gh): number {
    const comment = parseJson<{ id?: unknown }>(gh(postClaimTokenArgs(issue, token)), `issue #${issue} claim comment`);
    if (typeof comment.id !== 'number' || !Number.isSafeInteger(comment.id)) {
        fail(`issue #${issue} claim comment returned malformed data`);
    }
    return comment.id;
}

type TimelineEntry = {
    event?: unknown;
    id?: unknown;
    body?: unknown;
    html_url?: unknown;
    user?: { node_id?: unknown } | null;
    label?: { name?: unknown } | null;
};

function isTimelinePage(page: unknown): page is unknown[] {
    return Array.isArray(page);
}

function isTimelineEntry(entry: unknown): entry is TimelineEntry {
    return typeof entry === 'object' && entry !== null;
}

function timelineEntries(pages: unknown, issue: number): TimelineEntry[] {
    if (!Array.isArray(pages) || !pages.every(isTimelinePage)) {
        fail(`issue #${issue} timeline returned malformed data`);
    }
    const entries = pages.flat();
    if (!entries.every(isTimelineEntry)) {
        fail(`issue #${issue} timeline returned malformed data`);
    }
    return entries;
}

function claimTokenFromEntry(entry: TimelineEntry): ClaimToken | undefined {
    if (entry.event !== 'commented' || entry.user?.node_id !== ORCHESTRATOR_USER_NODE_ID) {
        return undefined;
    }
    const token = typeof entry.body === 'string' ? CLAIM_TOKEN_PATTERN.exec(entry.body)?.[1] : undefined;
    if (token === undefined || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id)) {
        return undefined;
    }
    return {
        commentId: entry.id,
        token,
        url: typeof entry.html_url === 'string' ? entry.html_url : undefined,
    };
}

/** The claim tokens posted since status:active was last removed, in comment id order. */
export function claimTokensSinceRelease(entries: TimelineEntry[]): ClaimToken[] {
    const releaseIndex = entries.findLastIndex(
        (entry) => entry.event === 'unlabeled' && entry.label?.name === ACTIVE_STATUS_LABEL
    );
    return entries
        .slice(releaseIndex + 1)
        .flatMap((entry) => {
            const claim = claimTokenFromEntry(entry);
            return claim === undefined ? [] : [claim];
        })
        .sort((left, right) => left.commentId - right.commentId);
}

const RELEASE_HINT = `; ${ACTIVE_STATUS_LABEL} stays on the issue — if no lane holds it, remove the label and claim again`;

/**
 * The timeline pages by position (`page` and `per_page`, its only documented paging parameters),
 * and gh fetches each page as a separate request. Deleting an entry on a page already fetched
 * shifts every later entry one slot earlier, so the entry at the next page boundary lands on a page
 * already read and that read skips it: a rival token can vanish from one read. The deleted entry
 * is in that read and in no read that starts after the deletion, so a read that skipped an entry
 * never equals the next read. Two consecutive reads that agree entry for entry therefore prove the
 * earlier one skipped nothing. Appended entries only push later entries back, which repeats an
 * entry instead of skipping one. A timeline that keeps changing refuses after a bounded number of
 * reads rather than deciding from a read it cannot trust.
 */
const TIMELINE_READ_LIMIT = 4;

function readTimeline(issue: number, gh: Gh): TimelineEntry[] {
    return timelineEntries(parseJson<unknown>(gh(issueTimelineArgs(issue)), `issue #${issue} timeline`), issue);
}

function readSettledTimeline(issue: number, gh: Gh): TimelineEntry[] {
    let previous = readTimeline(issue, gh);
    for (let read = 2; read <= TIMELINE_READ_LIMIT; read += 1) {
        const current = readTimeline(issue, gh);
        if (JSON.stringify(current) === JSON.stringify(previous)) {
            return current;
        }
        previous = current;
    }
    return fail(
        `issue #${issue} timeline changed between every two consecutive reads of ${TIMELINE_READ_LIMIT}; ` +
            `no board was moved${RELEASE_HINT}`
    );
}

function describeClaim(claim: ClaimToken): string {
    return claim.url ?? `comment ${claim.commentId}`;
}

function assertClaimWon(issue: number, token: string, gh: Gh): void {
    const claims = claimTokensSinceRelease(readSettledTimeline(issue, gh));
    if (!claims.some((claim) => claim.token === token)) {
        fail(`issue #${issue} claim comment was not observed on the timeline; no board was moved${RELEASE_HINT}`);
    }
    const others = claims.filter((claim) => claim.token !== token);
    if (others.length > 0) {
        fail(
            `issue #${issue} was claimed concurrently by ${others.map(describeClaim).join(', ')}; ` +
                `this claim withdrew its comment and moved no board${RELEASE_HINT}`
        );
    }
}

/**
 * Withdrawing a token that has not won is always safe: removing a comment can only make another
 * claimer's view less crowded before it reads, never add a second winner. A winner never withdraws.
 */
function decideClaim(issue: number, token: string, gh: Gh): void {
    const commentId = postClaimToken(issue, token, gh);
    try {
        assertClaimWon(issue, token, gh);
    } catch (error) {
        try {
            gh(deleteClaimTokenArgs(commentId));
        } catch (error_) {
            fail(
                `${error instanceof Error ? error.message : String(error)}; ` +
                    `withdrawing claim comment ${commentId} also failed: ` +
                    `${error_ instanceof Error ? error_.message : String(error_)}`
            );
        }
        throw error;
    }
}

export function claimTrackerIssue(
    issue: number,
    gh: Gh,
    log: (message: string) => void,
    token: string = randomUUID()
): void {
    const { labels, state } = readIssueClaimRow(issue, gh);
    if (state !== 'OPEN') {
        fail(`issue #${issue} is closed; reopen it or choose open work before claiming`);
    }
    if (labels.includes(ACTIVE_STATUS_LABEL)) {
        fail(
            `issue #${issue} already carries ${ACTIVE_STATUS_LABEL}; another lane has claimed it — ` +
                'read the board before choosing work'
        );
    }
    const moves = planBoardMoves(issue, gh);
    const plan = labelSwapPlan(labels);
    gh(issueEditLabelsArgs(issue, plan));
    const edited = readIssueClaimRow(issue, gh);
    if (edited.state !== 'OPEN') {
        fail(`issue #${issue} closed during the claim; status labels were edited, no board was moved`);
    }
    assertLabelSwapObserved(issue, edited.labels, plan);
    decideClaim(issue, token, gh);
    const removed = plan.remove.length > 0 ? `, removed ${plan.remove.join(', ')}` : '';
    log(`issue #${issue}: added ${ACTIVE_STATUS_LABEL}${removed}`);
    moveBoards(issue, moves, gh, log);
}

type BoardMove = { board: ClaimBoardItem; ids: { fieldId: string; optionId: string } | undefined };

/** Every board the issue sits on, with the live Status ids for each one not already In progress. */
function planBoardMoves(issue: number, gh: Gh): BoardMove[] {
    const boards = boardsFromGraphql(
        parseGraphqlResponse(gh(issueBoardsArgs(issue)), `issue #${issue} board membership`),
        issue
    );
    return boards.map((board) => ({ board, ids: inProgressIds(board, gh) }));
}

/** The live Status field and In progress option ids, or none for a board already In progress. */
function inProgressIds(board: ClaimBoardItem, gh: Gh): BoardMove['ids'] {
    if (board.statusName === IN_PROGRESS_OPTION_NAME) {
        return undefined;
    }
    return statusFieldIds(parseJson<unknown>(gh(fieldListArgs(board)), `board "${board.projectTitle}" fields`), board);
}

/**
 * Runs only after the claim has won, so a failed board write cannot undo the claim: every board is
 * attempted, and the refusal names the ones left for the operator to move by hand.
 */
function moveBoards(issue: number, moves: BoardMove[], gh: Gh, log: (message: string) => void): void {
    if (moves.length === 0) {
        log(`issue #${issue} sits on no project board; nothing to move`);
        return;
    }
    const failures: string[] = [];
    for (const { board, ids } of moves) {
        if (ids === undefined) {
            log(`board "${board.projectTitle}": already ${IN_PROGRESS_OPTION_NAME}`);
            continue;
        }
        try {
            gh(itemEditArgs(board, ids));
            log(`board "${board.projectTitle}": moved to ${IN_PROGRESS_OPTION_NAME}`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            failures.push(`board "${board.projectTitle}" was not moved to ${IN_PROGRESS_OPTION_NAME} (${reason})`);
        }
    }
    if (failures.length > 0) {
        fail(
            `issue #${issue} is claimed: ${ACTIVE_STATUS_LABEL} and this claim comment stay on the issue; ` +
                `${failures.join('; ')}; move ${failures.length === 1 ? 'it' : 'them'} by hand`
        );
    }
}

/**
 * The board writes need the verified operator credential (installation tokens cannot reach
 * user-owned Projects v2), and the label swap rides the same session: it was already the
 * operator's sanctioned manual edit, and one credential window beats minting an author App token
 * for a write the operator performs identically by hand.
 */
export type TrustedClaimRuntime = {
    primaryRoot: string;
    gitPath: string;
    ghPath: string;
    originCommit: string;
};

export function trustedClaimRuntime(env: NodeJS.ProcessEnv = process.env): TrustedClaimRuntime {
    const primaryRoot = env[TRUSTED_PRIMARY_ROOT_ENV];
    const gitPath = env[TRUSTED_GIT_PATH_ENV];
    const ghPath = env[TRUSTED_GH_PATH_ENV];
    const originCommit = env[TRUSTED_ORIGIN_COMMIT_ENV];
    if (
        primaryRoot === undefined ||
        gitPath === undefined ||
        ghPath === undefined ||
        originCommit === undefined ||
        !isAbsolute(primaryRoot) ||
        !isAbsolute(gitPath) ||
        !isAbsolute(ghPath) ||
        !/^[0-9a-f]{40,64}$/.test(originCommit)
    ) {
        fail('issue:claim must run through the protected primary checkout launcher');
    }
    return { primaryRoot, gitPath, ghPath, originCommit };
}

/**
 * The runner-side half of the launcher trust boundary, matching lane:publish and
 * lane:sync-parent: the working directory must be the trusted primary root itself —
 * `git rev-parse --git-common-dir` resolves to the primary from every linked lane worktree, so
 * it cannot prove where the executing file lives — and when origin/main carries this script, the
 * executing source must be that blob, so a mutated copy never reaches the operator credential. A
 * script origin/main does not carry yet (this file before its first merge) skips the blob
 * comparison exactly as the siblings do.
 */
export function assertTrustedClaimLauncherBinding(input: {
    resolvedCwd: string;
    resolvedPrimaryRoot: string;
    executingFile: string;
    executingSource: string;
    originSource: string | undefined;
}): void {
    if (input.resolvedCwd !== input.resolvedPrimaryRoot) {
        fail('issue:claim must be launched from the protected primary checkout');
    }
    assertTrustedExecutingBlob(
        'scripts/claimTrackerIssue.ts',
        input.executingFile,
        input.originSource,
        input.executingSource
    );
}

export type ClaimAuthentication = { session: { env: NodeJS.ProcessEnv; dispose: () => void } };

export type ClaimCliDeps = {
    authenticate: () => ClaimAuthentication;
    bindLauncher: () => void;
    createGh: (session: ClaimAuthentication['session']) => Gh;
    log: (message: string) => void;
};

function realClaimCliDeps(runtime: TrustedClaimRuntime): ClaimCliDeps {
    const executingFile = fileURLToPath(import.meta.url);
    return {
        authenticate: () => authenticateOrchestratorSession(),
        bindLauncher: () =>
            assertTrustedClaimLauncherBinding({
                resolvedCwd: realpathSync(process.cwd()),
                resolvedPrimaryRoot: realpathSync(runtime.primaryRoot),
                executingFile,
                executingSource: readFileSync(executingFile, 'utf8'),
                originSource: originMainBlob(
                    'scripts/claimTrackerIssue.ts',
                    process.cwd(),
                    githubAuthorizationGitEnv(),
                    runtime.gitPath,
                    runtime.originCommit
                ),
            }),
        createGh: (session) => (ghArgs) => spawnCapture('gh', ghArgs, { cwd: runtime.primaryRoot, env: session.env }),
        log: (message) => console.log(message),
    };
}

export async function runClaimTrackerIssueCli(args: string[], deps?: ClaimCliDeps): Promise<number> {
    const parsed = parseClaimArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${CLAIM_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.issue === undefined) {
        fail(CLAIM_USAGE);
    }
    // Resolved after the help branch so `--help` answers without the launcher environment.
    const wired = deps ?? realClaimCliDeps(trustedClaimRuntime());
    wired.bindLauncher();
    const auth = wired.authenticate();
    try {
        claimTrackerIssue(parsed.issue, wired.createGh(auth.session), wired.log);
        return 0;
    } finally {
        auth.session.dispose();
    }
}
