#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
    REQUIRED_REPOSITORY,
    authenticateOrchestratorSession,
    parseGraphqlResponse,
    parseJson,
    resolvePrimaryRoot,
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
 * The label swap runs before the board move: the labels are the claim another agent's survey
 * reads, while a board left behind by a partial claim is repaired by rerunning the script.
 */
export function labelSwapPlan(labels: string[]): { add: string; remove: string[] } {
    return {
        add: ACTIVE_STATUS_LABEL,
        remove: labels.filter((label) => label.startsWith(STATUS_LABEL_PREFIX) && label !== ACTIVE_STATUS_LABEL),
    };
}

export function issueLabelsArgs(issue: number): string[] {
    return ['issue', 'view', String(issue), '--repo', REQUIRED_REPOSITORY, '--json', 'labels'];
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
    'projectItems(first:20){nodes{id project{id number title owner{... on User{login} ... on Organization{login}}} ' +
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
    const envelope = response as { data?: { repository?: { issue?: { projectItems?: { nodes?: unknown } } } } };
    const nodes = envelope.data?.repository?.issue?.projectItems?.nodes;
    if (!Array.isArray(nodes)) {
        malformedBoards(issue);
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

export function claimTrackerIssue(issue: number, gh: Gh, log: (message: string) => void): void {
    const labels = labelNamesFromRow(
        parseJson<{ labels?: unknown }>(gh(issueLabelsArgs(issue)), `issue #${issue} labels`),
        `issue #${issue} labels`
    );
    if (labels.includes(ACTIVE_STATUS_LABEL)) {
        fail(
            `issue #${issue} already carries ${ACTIVE_STATUS_LABEL}; another lane has claimed it — ` +
                'read the board before choosing work'
        );
    }
    const plan = labelSwapPlan(labels);
    gh(issueEditLabelsArgs(issue, plan));
    const removed = plan.remove.length > 0 ? `, removed ${plan.remove.join(', ')}` : '';
    log(`issue #${issue}: added ${ACTIVE_STATUS_LABEL}${removed}`);
    const boards = boardsFromGraphql(
        parseGraphqlResponse(gh(issueBoardsArgs(issue)), `issue #${issue} board membership`),
        issue
    );
    if (boards.length === 0) {
        log(`issue #${issue} sits on no project board; nothing to move`);
        return;
    }
    for (const board of boards) {
        if (board.statusName === IN_PROGRESS_OPTION_NAME) {
            log(`board "${board.projectTitle}": already ${IN_PROGRESS_OPTION_NAME}`);
            continue;
        }
        const ids = statusFieldIds(
            parseJson<unknown>(gh(fieldListArgs(board)), `board "${board.projectTitle}" fields`),
            board
        );
        gh(itemEditArgs(board, ids));
        log(`board "${board.projectTitle}": moved to ${IN_PROGRESS_OPTION_NAME}`);
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
    return { primaryRoot, gitPath, ghPath };
}

export type ClaimAuthentication = { session: { env: NodeJS.ProcessEnv; dispose: () => void } };

export async function runClaimTrackerIssueCli(
    args: string[],
    authenticate: () => ClaimAuthentication = () => authenticateOrchestratorSession()
): Promise<number> {
    const parsed = parseClaimArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${CLAIM_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.issue === undefined) {
        fail(CLAIM_USAGE);
    }
    const runtime = trustedClaimRuntime();
    const auth = authenticate();
    try {
        const primaryRoot = resolvePrimaryRoot(
            (command, commandArgs, directory) =>
                spawnCapture(command, commandArgs, { cwd: directory, env: auth.session.env }),
            process.cwd()
        );
        if (realpathSync(primaryRoot) !== realpathSync(runtime.primaryRoot)) {
            fail('issue:claim trusted repository binding does not match the protected primary checkout');
        }
        const gh: Gh = (ghArgs) => spawnCapture('gh', ghArgs, { cwd: primaryRoot, env: auth.session.env });
        claimTrackerIssue(parsed.issue, gh, (message) => console.log(message));
        return 0;
    } finally {
        auth.session.dispose();
    }
}
