#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticatePublishingAuthor,
    isAuthorBotNodeId,
    gitAuthenticatedArgs,
    githubAuthorizationGitEnv,
    originMainBlob,
    parseJson,
    removalLockPid,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
    type GhSession,
    type PublishingAuthorAuthorization,
} from './githubAppIdentity.ts';
import {
    assertConventionalSubject,
    assertIssueNumber,
    AUTHOR_LANE_BRANCH_PREFIX,
    canonicalPath,
    composePublishBody,
    containsPath,
    fail,
    howToTestFromBody,
    issueRelationshipFromBody,
    readGuardFailureReceipt,
    TRUSTED_COMMON_DIR_ENV,
    TRUSTED_GH_PATH_ENV,
    TRUSTED_GIT_PATH_ENV,
    TRUSTED_ORIGIN_COMMIT_ENV,
    TRUSTED_PRIMARY_ROOT_ENV,
    whatFromBody,
    type GuardFailureReceipt,
    type IssueRelationship,
} from './prContract.ts';
import { formatReviewDiffSummary, summarizeReviewDiff } from './reviewDiffSummary.ts';
import {
    assertStackAcyclic,
    parseStackParents,
    readLaneStack,
    readRegisteredLaneStack,
    stackParentQuery,
    stackPublicationBase,
    writeLaneStack,
} from './stackedLanes.ts';

export { canonicalPath, containsPath };

export type PublishWorktree = {
    path: string;
    branch?: string;
    locked: boolean;
    lockReason?: string;
};

export type ExistingPullRequest = {
    number: number;
    title: unknown;
    body: unknown;
    baseRefName?: string;
    headRefOid?: string;
};
export type StackPublicationContext = {
    branch: string;
    head: string;
    parentNumber: number;
    parentState: string;
    parentHead: string;
};

export const PUBLISH_LANE_USAGE =
    'usage: pnpm lane:publish <issue-number | --lane <absolute-path>> [--relates] [--summary <text>] [--test <instructions>] [--model <model>] [--milestone <title>] [--project <title>] [--label <name>]';

/**
 * The same authoring-model rule `lane:open` enforces, mirrored here rather than imported: the
 * trusted publish snapshot's dependency graph is closed, so `publishLane.ts` cannot take a new
 * local dependency to reach `openLane.ts`'s copy. The specs hold the two spellings to one rule.
 */
export const AUTHOR_MODEL_PATTERN = /^[a-z0-9][a-z0-9.+-]{0,39}$/;

const AUTHOR_MODEL_RULE =
    'the lowercase public name of the model itself, keeping every qualifier that distinguishes capability or edition within the family (flash, mini, pro, air, codex, thinking) and dropping only deployment-routing prefixes and date-snapshot suffixes, e.g. glm-5.3-flash, glm-5.3, claude-sonnet-4.5, gpt-5.2-codex, kimi-k2.5';

function normalizeAuthorModel(token: string): string {
    const normalized = token.trim().toLowerCase();
    if (!AUTHOR_MODEL_PATTERN.test(normalized)) {
        fail(`--model must be ${AUTHOR_MODEL_RULE}`);
    }
    return normalized;
}

type TrustedPublishRuntime = {
    primaryRoot: string;
    commonDir: string;
    gitPath: string;
    ghPath: string;
    originCommit: string;
};

export function trustedPublishRuntime(env: NodeJS.ProcessEnv = process.env): TrustedPublishRuntime {
    const primaryRoot = env[TRUSTED_PRIMARY_ROOT_ENV];
    const commonDir = env[TRUSTED_COMMON_DIR_ENV];
    const gitPath = env[TRUSTED_GIT_PATH_ENV];
    const ghPath = env[TRUSTED_GH_PATH_ENV];
    const originCommit = env[TRUSTED_ORIGIN_COMMIT_ENV];
    if (
        primaryRoot === undefined ||
        commonDir === undefined ||
        gitPath === undefined ||
        ghPath === undefined ||
        originCommit === undefined ||
        !isAbsolute(primaryRoot) ||
        !isAbsolute(commonDir) ||
        !isAbsolute(gitPath) ||
        !isAbsolute(ghPath) ||
        !/^[0-9a-f]{40,64}$/.test(originCommit)
    ) {
        fail('lane:publish must run through the protected primary checkout launcher');
    }
    return { primaryRoot, commonDir, gitPath, ghPath, originCommit };
}

/**
 * Flag-authored metadata overrides for one publication. `model` is pre-normalized by argv parsing;
 * `milestone`, `projects`, and `labels` are validated against live tracker state before anything is
 * written.
 */
export type PublishMetadataFlags = {
    model?: string;
    milestone?: string;
    projects?: string[];
    labels?: string[];
};

export type PullRequestMetadata = { labels: string[]; milestoneTitle?: string; projectTitles: string[] };

/** The metadata a publication must leave on its pull request. `labels` leads with the model label. */
export type PublishMetadataTarget = {
    model: string;
    labels: string[];
    milestoneTitle?: string;
    projectTitles: string[];
};

/** The pieces of the target a pull request is missing, or `undefined` when it is already complete. */
export type MetadataEditPlan = { addLabels: string[]; milestoneTitle?: string; addProjectTitles: string[] };

export const MODEL_LABEL_COLOR = '8250df';

/**
 * The label name is the bare model token; no name prefix marks it as authorship. The fence that
 * keeps these labels out of inheritance and `--label` is the label description (`Authored by
 * <model>`), not the name.
 */
export function modelLabelName(model: string): string {
    return model;
}

/**
 * `--force` turns create into create-or-update, so this is the idempotent way to make sure the
 * label exists before any pull-request write references it. The shared color keeps the bare-name
 * authorship labels visually grouped now that no `model:` prefix does it.
 */
export function ensureModelLabelArgs(model: string): string[] {
    return [
        'label',
        'create',
        modelLabelName(model),
        '--color',
        MODEL_LABEL_COLOR,
        '--description',
        `Authored by ${model}`,
        '--force',
    ];
}

/**
 * `gh label create --force` updates whatever label already owns the name, so the label-creation
 * path must first prove the model token names no label the repository maintains: overwriting a
 * descriptive label's color and description would silently convert it into the authorship fence.
 * Names match case-insensitively because GitHub holds them unique that way. A same-named label
 * carrying the `Authored by ` description is the mechanism's own output, and an absent name
 * creates fresh — both proceed.
 */
function assertModelLabelNameAvailable(model: string, knownLabels: LabelRow[]): void {
    const collision = knownLabels.find(
        (label) => label.name.toLowerCase() === model.toLowerCase() && !isAuthorshipLabel(label)
    );
    if (collision !== undefined) {
        fail(
            `the model token "${model}" collides with an existing repository label; authorship labels ` +
                "never overwrite one; pick the model's exact public name"
        );
    }
}

function titleOf(value: unknown): string | undefined {
    if (typeof value === 'object' && value !== null && 'title' in value && typeof value.title === 'string') {
        return value.title;
    }
    return undefined;
}

/** One repository label as the tracker reports it: its canonical name and, when present, its description. */
export type LabelRow = { name: string; description?: string };

const AUTHORED_BY_DESCRIPTION_PREFIX = 'Authored by ';

/** An authorship label is exactly one whose description begins `Authored by `. */
function isAuthorshipLabel(label: LabelRow): boolean {
    return label.description !== undefined && label.description.startsWith(AUTHORED_BY_DESCRIPTION_PREFIX);
}

/** One parser owns the defensive row shape; name-only readers project onto it. */
function labelRowsFromRow(labels: unknown[] | undefined): LabelRow[] {
    return (labels ?? []).flatMap((label) => {
        if (typeof label === 'string') {
            return [{ name: label }];
        }
        if (typeof label === 'object' && label !== null && 'name' in label && typeof label.name === 'string') {
            const description =
                'description' in label && typeof label.description === 'string' ? label.description : undefined;
            return [{ name: label.name, ...(description === undefined ? {} : { description }) }];
        }
        return [];
    });
}

function labelNamesFromRow(labels: unknown[] | undefined): string[] {
    return labelRowsFromRow(labels).map((row) => row.name);
}

export type IssueTrackerRow = {
    labels?: unknown[];
    milestone?: { title?: unknown } | null;
    projectItems?: unknown[];
};

export function trackerMetadataFromIssueRow(row: IssueTrackerRow): {
    milestoneTitle?: string;
    projectTitles: string[];
    labels: LabelRow[];
} {
    const milestoneTitle = titleOf(row.milestone);
    const projectTitles = (row.projectItems ?? []).flatMap((item) => {
        const title = titleOf(item);
        return title === undefined ? [] : [title];
    });
    return {
        ...(milestoneTitle === undefined ? {} : { milestoneTitle }),
        projectTitles: [...new Set(projectTitles)],
        labels: labelRowsFromRow(row.labels),
    };
}

export function openMilestoneTitlesFromRows(rows: unknown): string[] {
    if (!Array.isArray(rows)) {
        fail('open milestone lookup returned malformed data');
    }
    return rows.flatMap((row) => {
        const title = titleOf(row);
        return title === undefined ? [] : [title];
    });
}

/** `gh project list --format json` answers `{"projects":[...],"totalCount":N}`, not a bare array. */
export function projectTitlesFromListing(listing: unknown): string[] {
    if (
        typeof listing !== 'object' ||
        listing === null ||
        !('projects' in listing) ||
        !Array.isArray(listing.projects)
    ) {
        fail('project list returned malformed data');
    }
    return listing.projects.flatMap((project) => {
        const title = titleOf(project);
        return title === undefined ? [] : [title];
    });
}

export type PullRequestMetadataRow = {
    labels?: unknown[];
    milestone?: { title?: unknown } | null;
    projectItems?: unknown[];
};

export function pullRequestMetadataFromRow(row: PullRequestMetadataRow): PullRequestMetadata {
    const milestoneTitle = titleOf(row.milestone);
    return {
        labels: labelNamesFromRow(row.labels),
        ...(milestoneTitle === undefined ? {} : { milestoneTitle }),
        projectTitles: [
            ...new Set(
                (row.projectItems ?? []).flatMap((item) => {
                    const title = titleOf(item);
                    return title === undefined ? [] : [title];
                })
            ),
        ],
    };
}

/**
 * Flags match live titles case-insensitively, but the target must carry the canonical spelling the
 * tracker reports: a case-variant flag flowing through as typed would differ from what GitHub
 * stores, and every republish would re-edit the pull request.
 */
export function canonicalMilestoneTitle(title: string, openTitles: string[]): string {
    const canonical = openTitles.find((open) => open.toLowerCase() === title.toLowerCase());
    if (canonical === undefined) {
        fail(`--milestone "${title}" matches no open milestone in ${REQUIRED_REPOSITORY}`);
    }
    return canonical;
}

export function canonicalProjectTitle(title: string, knownTitles: string[]): string {
    const canonical = knownTitles.find((known) => known.toLowerCase() === title.toLowerCase());
    if (canonical === undefined) {
        fail(`--project "${title}" matches no project in gh project list for ${REQUIRED_REPOSITORY}'s owner`);
    }
    return canonical;
}

/**
 * Resolves one `--label` value against the live label list case-insensitively, so the edit
 * carries the canonical spelling the tracker stores. A value that resolves to an authorship
 * label — its description begins `Authored by ` — refuses: the authorship label is `--model`'s
 * to set, and a flag spelling of it could only contradict the recorded model.
 */
export function canonicalLabelName(name: string, knownLabels: LabelRow[]): string {
    const canonical = knownLabels.find((known) => known.name.toLowerCase() === name.toLowerCase());
    if (canonical === undefined) {
        fail(`--label "${name}" matches no label in gh label list for ${REQUIRED_REPOSITORY}`);
    }
    if (isAuthorshipLabel(canonical)) {
        fail(
            `--label "${name}" names an authoring model; the authoring model is set with ` +
                '--model <model>, never --label'
        );
    }
    return canonical.name;
}

/**
 * `priority:` and `status:` are issue-workflow namespaces — the boards' status follows issue
 * labels — so they never describe a pull request and are dropped from inheritance, and so are
 * authorship labels: the authorship namespace is no longer a name prefix but the `Authored by `
 * description, which `ensureModelLabel` is the only writer of, so such a label belongs to the
 * authoring-model mechanism alone — set from the recorded or flagged model, never inherited from
 * an issue. Triage labels need no exclusion: they are never inherited, because they do not appear
 * on issues.
 */
export function descriptiveLabelNames(labels: LabelRow[]): string[] {
    return labels
        .filter(
            (label) =>
                !isAuthorshipLabel(label) && !label.name.startsWith('priority:') && !label.name.startsWith('status:')
        )
        .map((label) => label.name);
}

const SUBJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
    feat: 'enhancement',
    fix: 'bug',
    docs: 'documentation',
};

/**
 * An explicit, deliberately small map: only the three conventional types whose meaning matches an
 * existing repository label. Every other type (chore, test, refactor, build, ...) names work that
 * is none of these, and guessing beyond the map would put wrong descriptors on pull requests. The
 * optional `!` matches TITLE_PATTERN's breaking-change marker, so `feat!:` derives like `feat:`.
 */
export function derivedLabelFromSubject(subject: string): string | undefined {
    const type = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(subject)?.[1];
    return type === undefined ? undefined : SUBJECT_TYPE_LABELS[type];
}

/**
 * gh's default page is 30; the repository's label set is far below this limit. The description
 * rides along because it is what the authorship fence reads.
 */
export function labelListArgs(): string[] {
    return ['label', 'list', '--limit', '200', '--json', 'name,description'];
}

export function labelRowsFromListing(rows: unknown): LabelRow[] {
    if (!Array.isArray(rows)) {
        fail('repository label list returned malformed data');
    }
    return labelRowsFromRow(rows);
}

/**
 * The missing pieces only, so a rerun after a partial metadata write converges without churning
 * what a previous publish already set. `undefined` means the pull request already carries the
 * whole target and no `gh pr edit` is issued at all.
 */
export function metadataEditPlan(
    target: PublishMetadataTarget,
    current: PullRequestMetadata
): MetadataEditPlan | undefined {
    const addLabels = target.labels.filter((label) => !current.labels.includes(label));
    const milestoneTitle =
        target.milestoneTitle !== undefined && current.milestoneTitle !== target.milestoneTitle
            ? target.milestoneTitle
            : undefined;
    const addProjectTitles = target.projectTitles.filter((title) => !current.projectTitles.includes(title));
    if (addLabels.length === 0 && milestoneTitle === undefined && addProjectTitles.length === 0) {
        return undefined;
    }
    return { addLabels, ...(milestoneTitle === undefined ? {} : { milestoneTitle }), addProjectTitles };
}

export function applyPullRequestMetadataArgs(number: number, plan: MetadataEditPlan): string[] {
    return [
        'pr',
        'edit',
        String(number),
        '--repo',
        REQUIRED_REPOSITORY,
        ...plan.addLabels.flatMap((label) => ['--add-label', label]),
        ...(plan.milestoneTitle === undefined ? [] : ['--milestone', plan.milestoneTitle]),
        ...plan.addProjectTitles.flatMap((title) => ['--add-project', title]),
    ];
}

export type PublishLanePort = {
    baseSha: () => string;
    worktrees: () => PublishWorktree[];
    cwd: () => string;
    issueExists: (issue: number) => boolean;
    aheadBehind: (lane: string, baseSha: string, headSha: string) => { ahead: number; behind: number };
    dirty: (lane: string) => boolean;
    laneSubject: (lane: string, baseSha: string, headSha: string) => string | undefined;
    headSha: (lane: string) => string;
    remoteBranchSha: (branch: string) => string | undefined;
    isAncestor: (ancestorSha: string, descendantSha: string, lane: string) => boolean;
    push: (lane: string, branch: string, headSha: string) => void;
    existingOpenPullRequest: (branch: string) => ExistingPullRequest | undefined;
    stackBase?: (lane: string, branch: string, head: string, main: string) => StackPublicationContext | undefined;
    pinStackParent?: (branch: string, number: number) => void;
    reportDiff?: (lane: string, base: string, head: string) => void;
    createPullRequest: (input: { branch: string; title: string; body: string; base?: string }) => number;
    updatePullRequest: (number: number, input: { body: string }) => void;
    saveAuthorModel: (branch: string, model: string) => void;
    readAuthorModel: (branch: string) => string | undefined;
    ensureModelLabel: (model: string) => void;
    readIssueTrackerMetadata: (issue: number) => {
        milestoneTitle?: string;
        projectTitles: string[];
        labels: LabelRow[];
    };
    openMilestoneTitles: () => string[];
    knownProjectTitles: () => string[];
    knownLabels: () => LabelRow[];
    readPullRequestMetadata: (number: number) => PullRequestMetadata;
    applyPullRequestMetadata: (number: number, plan: MetadataEditPlan) => void;
    log: (message: string) => void;
    guardFailure: (laneName: string) => GuardFailureReceipt | undefined;
};

export function parsePublishLaneArgs(args: string[]): {
    issue?: number;
    lanePath?: string;
    relationship?: IssueRelationship;
    testInstructions?: string;
    summary?: string;
    model?: string;
    milestone?: string;
    projects?: string[];
    labels?: string[];
    help: boolean;
} {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    let issue: number | undefined;
    let lanePath: string | undefined;
    let relationship: IssueRelationship | undefined;
    let testInstructions: string | undefined;
    let summary: string | undefined;
    let model: string | undefined;
    let milestone: string | undefined;
    const projects: string[] = [];
    const labels: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--relates') {
            if (relationship !== undefined) {
                fail(PUBLISH_LANE_USAGE);
            }
            relationship = 'relates';
            continue;
        }
        if (arg === '--test') {
            const value = args[index + 1];
            if (testInstructions !== undefined || value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            testInstructions = value;
            index += 1;
            continue;
        }
        if (arg === '--summary') {
            const value = args[index + 1];
            if (summary !== undefined || value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            summary = value;
            index += 1;
            continue;
        }
        if (arg === '--model') {
            const value = args[index + 1];
            if (model !== undefined || value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            model = normalizeAuthorModel(value);
            index += 1;
            continue;
        }
        if (arg === '--milestone') {
            const value = args[index + 1];
            if (milestone !== undefined || value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            milestone = value;
            index += 1;
            continue;
        }
        if (arg === '--project') {
            const value = args[index + 1];
            if (value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            projects.push(value);
            index += 1;
            continue;
        }
        if (arg === '--label') {
            const value = args[index + 1];
            if (value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            labels.push(value);
            index += 1;
            continue;
        }
        if (arg === '--lane') {
            const value = args[index + 1];
            if (lanePath !== undefined || issue !== undefined || value === undefined || value.startsWith('--')) {
                fail(PUBLISH_LANE_USAGE);
            }
            if (!isAbsolute(value)) {
                fail('--lane requires an absolute path');
            }
            lanePath = value;
            index += 1;
            continue;
        }
        if (arg === undefined || issue !== undefined || lanePath !== undefined) {
            fail(PUBLISH_LANE_USAGE);
        }
        issue = assertIssueNumber(arg, PUBLISH_LANE_USAGE);
    }
    return {
        ...(issue === undefined ? {} : { issue }),
        ...(lanePath === undefined ? {} : { lanePath }),
        ...(relationship === undefined ? {} : { relationship }),
        ...(testInstructions === undefined ? {} : { testInstructions }),
        ...(summary === undefined ? {} : { summary }),
        ...(model === undefined ? {} : { model }),
        ...(milestone === undefined ? {} : { milestone }),
        ...(projects.length === 0 ? {} : { projects: [...new Set(projects)] }),
        ...(labels.length === 0 ? {} : { labels: [...new Set(labels)] }),
        help: false,
    };
}

/**
 * `legacy` marks a lane resolved through the pre-`agent/` path. It is not decoration: that lane's
 * pull request predates `lane:publish` and is not this script's to rewrite, so the flag has to
 * travel with the lane all the way to the publish step.
 */
type ResolvedLane = { path: string; branch: string; legacy: boolean };

type AuthorizedResolvedLane = PublishingAuthorAuthorization & { legacy: boolean };

export const NO_ISSUE_LANE_FAILURE =
    'not inside a locked author lane: pass its issue number or --lane with its absolute worktree root';

/**
 * A push target must be lock-shaped *and* branch-shaped. `lockReason` is only ever set on a locked
 * worktree, so it alone proves the lock; the branch prefix is the part that keeps a hand-locked
 * checkout on, say, `release/1.2` out of the issueless resolution path, where no issue argument
 * constrains the branch name.
 */
function authorLanes(worktrees: PublishWorktree[]): ResolvedLane[] {
    return worktrees.flatMap((worktree) => {
        const branch = worktree.branch;
        if (
            worktree.lockReason !== AUTHOR_LOCK_REASON ||
            branch === undefined ||
            !branch.startsWith(AUTHOR_LANE_BRANCH_PREFIX)
        ) {
            return [];
        }
        return [{ path: worktree.path, branch, legacy: false }];
    });
}

export type LegacyLaneCandidate = { path: string; branch: string; lockReason: string | undefined };

/**
 * Worktrees whose branch predates the `agent/` convention but are still lock-shaped (locked for
 * *some* reason). Structural shape alone proves nothing: a worktree locked for an unrelated purpose
 * (a collaboration session, say) looks identical at this stage. `resolveLegacyCandidate` below is
 * the only thing allowed to turn one of these into a resolved lane or a specific refusal — it
 * requires both an open pull request for the exact branch (the fact that migrates a stranded
 * pre-`agent/` lane) and the correct lock (the fact that grants push authority); either alone falls
 * through to the ordinary "not a lane" refusal instead of misdirecting a worktree that was never an
 * author lane in the first place.
 *
 * `git worktree list` always lists the primary checkout first — `removeLane`'s `identifyLane` relies
 * on that same ordering to refuse removing it — so the primary root is excluded here too, the same
 * way and for the same reason: it can never be a genuine legacy lane, no matter what branch or lock
 * it carries.
 */
function legacyLaneCandidates(worktrees: PublishWorktree[]): LegacyLaneCandidate[] {
    const primaryRoot = worktrees[0]?.path;
    return worktrees.flatMap((worktree) => {
        const branch = worktree.branch;
        if (
            worktree.path === primaryRoot ||
            branch === undefined ||
            branch.startsWith(AUTHOR_LANE_BRANCH_PREFIX) ||
            !worktree.locked
        ) {
            return [];
        }
        return [{ path: worktree.path, branch, lockReason: worktree.lockReason }];
    });
}

/**
 * The migration remedy is only for a lock that names nobody: no reason at all, or `removeLane`'s own
 * `lane-remove:<pid>` marker, which records work in flight rather than an owner. Any other reason is
 * someone's claim on that worktree, and `legacyForeignLockMessage` handles it instead.
 */
function legacyLockMigrationMessage(candidate: LegacyLaneCandidate): string {
    const actual = candidate.lockReason ?? 'with no reason';
    return (
        `${candidate.branch} has an open pull request but ${candidate.path} is locked ${actual}, not ` +
        `${AUTHOR_LOCK_REASON}: only ${AUTHOR_LOCK_REASON} may publish. Migrate the lock, then retry: ` +
        `git worktree unlock ${candidate.path} && git worktree lock --reason ${AUTHOR_LOCK_REASON} ${candidate.path}`
    );
}

/**
 * The lock reason is the only ownership signal this gate has, so a refusal must never hand out the
 * command that overwrites it. An unrecognized `active:<someone>` is another owner working in that
 * worktree; relocking it as the author lane and rerunning would push a branch and rewrite a pull
 * request that belong to them. Name the holder and stop — the remedy is theirs to run, not this
 * caller's.
 */
function legacyForeignLockMessage(candidate: LegacyLaneCandidate, owner: string): string {
    return (
        `${candidate.branch} has an open pull request but ${candidate.path} is locked ${owner}, not ` +
        `${AUTHOR_LOCK_REASON}: only ${AUTHOR_LOCK_REASON} may publish, and that lock names its holder. ` +
        `Whoever holds ${owner} owns this worktree and its pull request; taking the lock here would ` +
        `push over their work. Ask them to publish it.`
    );
}

function legacyNoPullRequestMessage(candidate: LegacyLaneCandidate): string {
    return (
        `${candidate.branch} does not match the ${AUTHOR_LANE_BRANCH_PREFIX} convention and has no open pull ` +
        `request: an off-convention branch may only publish once the repository already has an open pull ` +
        `request for that exact branch.`
    );
}

/**
 * The three outcomes a candidate can have, returned rather than thrown. `skip` means "this worktree
 * was never an author lane, try the next candidate"; `refuse` means "it is one, and here is exactly
 * why it may not publish". Returning them is what lets the resolution loop swallow precisely these
 * two verdicts and nothing else: `hasOpenPullRequest` reaches `gh`, where an expired token, a rate
 * limit, a missing binary, or unparseable output all throw, and every one of those means "could not
 * find out". An authorization gate has to stop on an unknown, not read it as `skip` and go push a
 * different lane.
 */
type LegacyResolution =
    { kind: 'skip' } | { kind: 'refuse'; message: string } | { kind: 'resolved'; lane: ResolvedLane };

/**
 * Applies the legacy-lane bound to one structural candidate: an open pull request for the exact
 * branch is what proves this off-convention worktree is a genuine (if stranded) author lane; the
 * correct lock is what proves it may push. Resolves when both hold; refuses with the specific,
 * actionable message the moment exactly one of the two holds (that is precisely the situation
 * callers need named); skips when neither holds, so the caller can fall back to the ordinary "not a
 * lane" refusal instead of explaining a worktree that was never an author lane.
 */
function resolveLegacyCandidate(
    candidate: LegacyLaneCandidate,
    hasOpenPullRequest: (branch: string) => boolean
): LegacyResolution {
    const correctLock = candidate.lockReason === AUTHOR_LOCK_REASON;
    const hasPullRequest = hasOpenPullRequest(candidate.branch);
    if (correctLock) {
        return hasPullRequest
            ? { kind: 'resolved', lane: { path: candidate.path, branch: candidate.branch, legacy: true } }
            : { kind: 'refuse', message: legacyNoPullRequestMessage(candidate) };
    }
    if (!hasPullRequest) {
        return { kind: 'skip' };
    }
    const owner = candidate.lockReason;
    return owner !== undefined && removalLockPid(owner) === undefined
        ? { kind: 'refuse', message: legacyForeignLockMessage(candidate, owner) }
        : { kind: 'refuse', message: legacyLockMigrationMessage(candidate) };
}

/**
 * The issue a lane branch carries, or `undefined` for an issueless lane. `lane:open <issue>` is the
 * only producer of the `agent/<issue>/<slug>` shape, so the branch records the issue it tracks.
 */
export function laneIssueNumber(branch: string): number | undefined {
    const captured = /^agent\/(\d+)\//.exec(branch)?.[1];
    if (captured === undefined) {
        return undefined;
    }
    const issue = Number(captured);
    return Number.isSafeInteger(issue) && issue > 0 ? issue : undefined;
}

export function resolveAuthorLane(
    issue: number | undefined,
    worktrees: PublishWorktree[],
    cwd: string,
    resolveExisting: (path: string) => string = realpathSync,
    hasOpenPullRequest: (branch: string) => boolean = () => false
): ResolvedLane {
    const lanes = authorLanes(worktrees);
    if (issue === undefined) {
        const here = canonicalPath(cwd, resolveExisting);
        type Enclosing = { canonical: string; resolve: () => LegacyResolution };
        const conformingEnclosing: Enclosing[] = lanes.flatMap((lane) => {
            const canonical = canonicalPath(lane.path, resolveExisting);
            return containsPath(canonical, here)
                ? [{ canonical, resolve: (): LegacyResolution => ({ kind: 'resolved', lane }) }]
                : [];
        });
        const legacyEnclosing: Enclosing[] = legacyLaneCandidates(worktrees).flatMap((candidate) => {
            const canonical = canonicalPath(candidate.path, resolveExisting);
            return containsPath(canonical, here)
                ? [{ canonical, resolve: () => resolveLegacyCandidate(candidate, hasOpenPullRequest) }]
                : [];
        });
        // Depth is measured on the same canonical spellings containment used. Comparing the
        // recorded paths instead lets a symlinked outer lane out-rank the inner lane it contains.
        // Stable sort: ties keep conforming ahead of legacy, since conforming is spread first and a
        // strictly-greater compare never displaces an equal-length earlier entry — the same
        // tie-break the old single-candidate reduce produced.
        const byDescendingDepth = [...conformingEnclosing, ...legacyEnclosing].sort(
            (a, b) => b.canonical.length - a.canonical.length
        );
        // A legacy candidate can refuse (bad lock, or no open pull request) where a conforming lane
        // never does. An enclosing conforming lane may sit shallower than a broken legacy worktree
        // nested inside it — or, symmetrically, deeper; depth alone decides who is tried first — and
        // a valid lane the operator is standing in should not fail because an unrelated nested
        // worktree's problem is not theirs to fix right now. So a refusal is recorded and resolution
        // keeps trying shallower candidates. If nothing ever resolves, the first refusal seen (the
        // deepest candidate's, the one closest to `cwd`) is the most specific diagnostic available
        // and is raised instead of the generic "not inside a locked author lane" message.
        //
        // Only a *returned* refusal is absorbed here. Anything `resolve()` throws is an unknown —
        // `hasOpenPullRequest` reaches the network — and propagates untouched, because a gate that
        // could not find out must not answer "does not apply".
        let firstRefusal: string | undefined;
        for (const candidate of byDescendingDepth) {
            const outcome = candidate.resolve();
            if (outcome.kind === 'resolved') {
                return outcome.lane;
            }
            if (outcome.kind === 'refuse') {
                firstRefusal ??= outcome.message;
            }
        }
        if (firstRefusal !== undefined) {
            fail(firstRefusal);
        }
        return fail(`${cwd} is ${NO_ISSUE_LANE_FAILURE}`);
    }
    // Deliberately no legacy fallback here. An off-convention branch carries no issue of its own
    // (`laneIssueNumber` requires the `agent/` prefix), so nothing ties a passed issue number to a
    // *specific* legacy candidate. Resolving one anyway would let `pnpm lane:publish <any issue>`
    // pick up an unrelated stranded lane and stamp `Closes #<that issue>` on its pull request. A
    // legacy lane resolves only from an explicit lane-path selection with no issue argument — see
    // the `issue === undefined` branch above.
    const prefix = `${AUTHOR_LANE_BRANCH_PREFIX}${issue}/`;
    const matches = lanes.filter((lane) => lane.branch.startsWith(prefix));
    if (matches.length !== 1) {
        return fail(`expected exactly one locked author lane for issue #${issue}`);
    }
    return matches[0]!;
}

export const DIRTY_LANE_FAILURE =
    'has uncommitted changes: commit them yourself with a conventional subject (type(scope): subject), then publish';

export const NO_LANE_SUBJECT_FAILURE =
    'carries no non-merge commit above origin/main: commit the lane work with a conventional subject (type(scope): subject) before publishing';

export function publishLane(
    issue: number | undefined,
    port: PublishLanePort,
    relationship?: IssueRelationship,
    testInstructions?: string,
    summary?: string,
    authorization?: AuthorizedResolvedLane,
    metadataFlags?: PublishMetadataFlags
): number {
    const lane = resolveAuthorLane(
        issue,
        port.worktrees(),
        port.cwd(),
        realpathSync,
        (branch) => port.existingOpenPullRequest(branch) !== undefined
    );
    if (
        authorization !== undefined &&
        (canonicalPath(lane.path, realpathSync) !== canonicalPath(authorization.lanePath, realpathSync) ||
            lane.branch !== authorization.branch ||
            lane.legacy !== authorization.legacy)
    ) {
        fail('publishing lane changed after its permission-scoped token was minted');
    }
    const currentHeadSha = port.headSha(lane.path);
    const headSha = authorization?.headSha ?? currentHeadSha;
    if (currentHeadSha !== headSha) {
        fail(`${lane.branch} HEAD changed after its permission-scoped token was minted`);
    }
    const currentBaseSha = port.baseSha();
    const baseSha = authorization?.baseSha ?? currentBaseSha;
    if (currentBaseSha !== baseSha) {
        fail('origin/main changed after its permission-scoped token was minted');
    }
    const laneIssue = issue ?? laneIssueNumber(lane.branch);
    // Name the resolved selection before anything mutates, so an incorrect target remains visible
    // even when a later gate refuses it.
    port.log(`publishing ${lane.path} on ${lane.branch}`);
    const laneName = basename(lane.path);
    const guardFailure = port.guardFailure(laneName);
    if (guardFailure !== undefined) {
        fail(
            `refusing publish: lane ${lane.branch} has an unresolved guard-failure receipt ` +
                `(${guardFailure.reason} at ${guardFailure.headSha.slice(0, 9)} during '${guardFailure.command} ${guardFailure.args.join(' ')}'): ` +
                `prove it resolved under pnpm guard or run 'pnpm guard --recover' before publishing`
        );
    }
    if (laneIssue !== undefined && !port.issueExists(laneIssue)) {
        fail(`issue #${laneIssue} does not exist in ${REQUIRED_REPOSITORY}`);
    }
    // Publishing never authors a commit message. The only subject this script could invent for
    // uncommitted work is some earlier commit's, which describes a different change; the operator
    // is the one who knows what the leftover files are.
    if (port.dirty(lane.path)) {
        fail(`${lane.branch} ${DIRTY_LANE_FAILURE}`);
    }
    const stack = port.stackBase?.(lane.path, lane.branch, headSha, baseSha);
    const comparisonHead = stack?.head ?? baseSha;
    const { ahead } = port.aheadBehind(lane.path, comparisonHead, headSha);
    if (ahead < 1) {
        fail('lane must be ahead of origin/main');
    }
    const write = pullRequestWrite(
        laneIssue,
        lane,
        comparisonHead,
        headSha,
        port,
        relationship,
        testInstructions,
        summary
    );
    // Resolved before the push: every refusal it can raise (no model on record, a model token
    // colliding with an existing label, an unknown flag title or label) must land with nothing
    // written, not even the branch push.
    const metadata = resolvePublishMetadata(lane, laneIssue, write?.effectiveTitle, metadataFlags, port);
    port.reportDiff?.(lane.path, comparisonHead, headSha);
    if (stack !== undefined) {
        port.pinStackParent?.(lane.branch, stack.parentNumber);
    }
    const assertStackContext = () => {
        if (stack === undefined) {
            return;
        }
        const current = port.stackBase?.(lane.path, lane.branch, headSha, baseSha);
        if (JSON.stringify(current) !== JSON.stringify(stack)) {
            fail('stack parent changed during publication; reconcile and retry');
        }
        const existing = port.existingOpenPullRequest(lane.branch);
        if (existing?.baseRefName !== undefined && existing.baseRefName !== stack.branch) {
            fail('stack child pull-request base changed unexpectedly');
        }
        if (existing !== undefined && existing.baseRefName === undefined) {
            fail('stack child pull-request base is unreadable');
        }
        if (existing?.number !== write?.existing?.number) {
            fail('stack child pull request changed during publication');
        }
        if (port.headSha(lane.path) !== headSha || port.dirty(lane.path)) {
            fail('stack child changed during publication');
        }
    };
    const remoteSha = port.remoteBranchSha(lane.branch);
    if (remoteSha !== undefined && !port.isAncestor(remoteSha, headSha, lane.path)) {
        fail(`refusing non-fast-forward push of ${lane.branch}`);
    }
    if (port.baseSha() !== baseSha) {
        fail('origin/main changed after its permission-scoped token was minted');
    }
    assertStackContext();
    port.push(lane.path, lane.branch, headSha);
    if (port.baseSha() !== baseSha) {
        fail('origin/main changed after its permission-scoped token was minted');
    }
    assertStackContext();
    // The label must exist before any pull-request write can reference it; `--force` makes this
    // create-or-update, and the collision guard in resolution has already proven any same-named
    // label is the mechanism's own, so it is safe on every publish.
    if (metadata !== undefined) {
        port.ensureModelLabel(metadata.model);
    }
    const number = pullRequestNumber(lane, write, port, stack?.branch);
    if (stack !== undefined) {
        const after = port.stackBase?.(lane.path, lane.branch, headSha, baseSha);
        const published = port.existingOpenPullRequest(lane.branch);
        if (
            JSON.stringify(after) !== JSON.stringify(stack) ||
            published?.number !== number ||
            published.baseRefName !== stack.branch ||
            published.headRefOid !== headSha
        ) {
            fail('stack publication changed during mutation; publication may be partial, reconcile before retrying');
        }
    }
    if (metadata !== undefined) {
        assertPullRequestMetadata(number, metadata, port);
    }
    port.log(String(number));
    return number;
}

/**
 * The metadata a publication must leave on its pull request, or `undefined` when this lane's pull
 * request is not `lane:publish`'s to decorate: a legacy lane publishes without an explicit
 * `--model` exactly as it always did, because its pull request predates this mechanism and the
 * flag is the one thing that proves the operator wants it applied anyway.
 *
 * The model resolution order is the contract: an explicit `--model` wins and is persisted for
 * later runs; otherwise the value `lane:open` recorded for the branch is used; a conforming lane
 * with neither fails closed rather than pushing an unattributed pull request. The resolved
 * model's label name is then proven free against the live label list, so the `--force` label
 * creation can only ever create fresh or update the mechanism's own label. Milestone and
 * projects come from the lane's issue, and flag values override them per field after validation
 * against live tracker state — left empty rather than forced onto the pull request. Descriptive
 * labels come from the same issue read (minus the issue-workflow namespaces and authorship
 * labels), or on an issueless lane from the conventional subject, and `--label` adds more by
 * live canonical name; unlike authorship labels they are never created on demand. The model
 * record is written only after every validation here has passed, so a refused run leaves the
 * shared git config untouched.
 *
 * `subject` is the pull request's effective title: the title frozen on an existing pull request
 * (this script never retitles, so a follow-up commit's subject must not re-derive the label), or
 * the newest non-merge conventional subject on a fresh create. A manually retitled,
 * non-conventional title derives nothing. It is `undefined` for a legacy lane, whose title is not
 * this script's to derive, so a legacy lane derives no label either.
 */
function resolvePublishMetadata(
    lane: ResolvedLane,
    laneIssue: number | undefined,
    subject: string | undefined,
    flags: PublishMetadataFlags | undefined,
    port: PublishLanePort
): PublishMetadataTarget | undefined {
    const flaggedModel = flags?.model;
    if (lane.legacy && flaggedModel === undefined) {
        if (flags?.milestone !== undefined || flags?.projects !== undefined || flags?.labels !== undefined) {
            fail('metadata flags require --model on a legacy lane; its pull request predates lane:publish');
        }
        return undefined;
    }
    const model = flaggedModel !== undefined ? flaggedModel : readRecordedAuthorModel(lane.branch, port);
    const inherited = laneIssue === undefined ? undefined : port.readIssueTrackerMetadata(laneIssue);
    let milestoneTitle: string | undefined;
    if (flags?.milestone !== undefined) {
        milestoneTitle = canonicalMilestoneTitle(flags.milestone, port.openMilestoneTitles());
    } else {
        const inheritedMilestone = inherited?.milestoneTitle;
        if (inheritedMilestone !== undefined) {
            const openTitles = port.openMilestoneTitles();
            if (openTitles.some((open) => open.toLowerCase() === inheritedMilestone.toLowerCase())) {
                milestoneTitle = inheritedMilestone;
            } else {
                // An issue can hold a milestone that has since closed; publishing must not resurrect it.
                port.log(
                    `milestone "${inheritedMilestone}" on the lane's issue is no longer open; ` +
                        'leaving the pull request milestone unset'
                );
            }
        }
    }
    const projectTitles = resolveProjectTitles(
        laneIssue !== undefined,
        inherited?.projectTitles ?? [],
        flags?.projects,
        port
    );
    // One label-list read serves both the label-creation collision guard and `--label`
    // canonicalization; the collision guard needs it on every conforming publish, flags or not.
    const knownLabels = port.knownLabels();
    assertModelLabelNameAvailable(model, knownLabels);
    const descriptive = resolveDescriptiveLabels(inherited?.labels, subject, flags?.labels, knownLabels);
    if (flaggedModel !== undefined) {
        port.saveAuthorModel(lane.branch, model);
    }
    return {
        model,
        // The Set is structural defense-in-depth, not an independently observable fence: with the
        // inheritance filter and the flag refusal above, no descriptive source can produce an
        // authorship label (one whose description begins `Authored by `, the only spelling
        // `ensureModelLabel` writes), so this dedupe backs those two fences rather than gating
        // anything a test could reach on its own — which is why no dedicated test pins it.
        labels: [...new Set([modelLabelName(model), ...descriptive])],
        ...(milestoneTitle === undefined ? {} : { milestoneTitle }),
        projectTitles,
    };
}

/**
 * Descriptive labels from three sources, unioned and deduped: the bound issue's labels minus the
 * issue-workflow namespaces and authorship labels, one type label derived from the pull request's
 * effective title on an issueless lane, and canonicalized `--label` flags. Only authorship labels
 * are ever created on demand; descriptive labels must already exist — the live-list validation
 * enforces it for flags, and the other two sources carry names the repository already issued (the
 * issue wears its labels, and the derived three are repository staples). A `--label` that
 * resolves to an authorship label refuses: the authorship label is `--model`'s to set, and a
 * flag spelling of it could only contradict the recorded model.
 */
function resolveDescriptiveLabels(
    inheritedLabels: LabelRow[] | undefined,
    subject: string | undefined,
    flaggedLabels: string[] | undefined,
    knownLabels: LabelRow[]
): string[] {
    const carried: string[] = [];
    if (inheritedLabels !== undefined) {
        carried.push(...descriptiveLabelNames(inheritedLabels));
    } else if (subject !== undefined) {
        const derived = derivedLabelFromSubject(subject);
        if (derived !== undefined) {
            carried.push(derived);
        }
    }
    if (flaggedLabels === undefined) {
        return [...new Set(carried)];
    }
    const canonical = flaggedLabels.map((name) => canonicalLabelName(name, knownLabels));
    return [...new Set([...carried, ...canonical])];
}

function readRecordedAuthorModel(branch: string, port: PublishLanePort): string {
    const recorded = port.readAuthorModel(branch);
    if (recorded === undefined) {
        fail(
            `${branch} has no authoring model on record; backfill it with pnpm lane:publish --model <model>, ` +
                'the lowercase public name of the model itself, e.g. glm-5.3-flash'
        );
    }
    return normalizeAuthorModel(recorded);
}

/**
 * Installation tokens cannot access user-owned Projects v2 — the platform offers no installation
 * permission for them — and gh ≥ 2.92 swallows the Projects v2 enrichment error and answers
 * `gh issue view --json projectItems` with `projectItems: []` and exit 0, so under this token an
 * empty read cannot be trusted as "no projects": empty and unreadable are indistinguishable. The
 * project list probe is therefore the only reliable capability signal, and it runs before any
 * pull-request write whenever a lane issue is bound or `--project` flags are present. With
 * explicit flags an unreachable list is a hard failure (the operator asked for something this
 * token cannot deliver and must know now), while an issue-bound lane with no flags skips project
 * application with one loud line and the publish continues, leaving the pull request's project
 * membership to the operator backfill. Only a lane with neither a bound issue nor flags skips the
 * probe entirely — there is nothing to apply and nothing to report.
 */
function resolveProjectTitles(
    issueBound: boolean,
    inheritedTitles: string[],
    flaggedTitles: string[] | undefined,
    port: PublishLanePort
): string[] {
    if (!issueBound && flaggedTitles === undefined) {
        return [];
    }
    let knownTitles: string[];
    try {
        knownTitles = port.knownProjectTitles();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (flaggedTitles !== undefined) {
            fail(
                `cannot list the owner's projects as the author App (${reason}); installation tokens cannot ` +
                    'access user-owned Projects v2. Apply the project membership by hand under the operator ' +
                    'backfill exception, or retry without --project'
            );
        }
        port.log(
            `cannot list the owner's projects as the author App (${reason}); leaving the pull request's ` +
                'project membership to the operator backfill'
        );
        return [];
    }
    if (flaggedTitles !== undefined) {
        const canonical = flaggedTitles.map((title) => canonicalProjectTitle(title, knownTitles));
        return [...new Set(canonical)];
    }
    return inheritedTitles;
}

/**
 * Metadata assertion is convergent, not transactional: the pull request already exists by the time
 * this runs, so a failure here leaves a publishable pull request that a rerun completes. Reading
 * current state first keeps a rerun — or a later publish of the same head — from churning metadata
 * that is already right.
 */
function assertPullRequestMetadata(number: number, target: PublishMetadataTarget, port: PublishLanePort): void {
    const current = port.readPullRequestMetadata(number);
    const plan = metadataEditPlan(target, current);
    if (plan === undefined) {
        return;
    }
    try {
        port.applyPullRequestMetadata(number, plan);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        fail(
            `could not assert metadata on pull request #${number}: ${reason}; the pull request exists, and ` +
                'rerunning pnpm lane:publish re-asserts its metadata safely'
        );
    }
}

/**
 * A conforming lane's number comes from the pull request `pullRequestWrite` already read, because
 * the relationship it must preserve and the create-vs-update decision come out of that one lookup.
 * A legacy lane never reached that lookup, so its number comes from a second, post-push one — which
 * is also what re-proves the pull request that authorized the push is still open.
 */
function pullRequestNumber(
    lane: ResolvedLane,
    write: PullRequestWrite | undefined,
    port: PublishLanePort,
    base?: string
): number {
    if (write === undefined) {
        return legacyPullRequestNumber(lane, port.existingOpenPullRequest(lane.branch));
    }
    const { existing, ...content } = write;
    if (existing === undefined) {
        return port.createPullRequest({
            branch: lane.branch,
            title: content.title,
            body: content.body,
            ...(base === undefined ? {} : { base }),
        });
    }
    port.updatePullRequest(existing.number, { body: content.body });
    return existing.number;
}

/**
 * The title and body to write, plus the pull request they are written to. `existing` travels with
 * them because it is read once, before the push: the relationship a flagless update must preserve
 * and the create-vs-update decision both come out of that single read.
 *
 * `title` is the newest lane subject — the title a create writes. `effectiveTitle` is the title
 * GitHub will show after this publish: the existing title when one is frozen on the pull request
 * (this script never retitles), the lane subject only on a fresh create. Label derivation reads
 * `effectiveTitle`, because the label must describe the change the title names, not a follow-up
 * commit the PR was never retitled for.
 */
type PullRequestWrite = {
    title: string;
    effectiveTitle: string;
    body: string;
    existing: ExistingPullRequest | undefined;
};

/**
 * The title and body to write, or `undefined` for a legacy lane, whose pull request this script must
 * not touch. `lane:publish` never authored that pull request — the branch predates the convention
 * and was unpublishable by it — and cannot reproduce it: `laneIssueNumber` reads only the
 * `agent/<issue>/` shape, so recomposing the body would put `None.` under Related tickets and sever
 * the `Closes #<issue>` a human wrote, and retitling from HEAD would rename it too. Parsing an issue
 * out of the branch slug instead is not the fix; the slug is nobody's record, and a rename would
 * then close the wrong ticket.
 *
 * That exemption covers the lane-subject and relationship rules too, and covers them by returning
 * first. Deriving the title from the newest non-merge commit above `origin/main`, refusing a lane
 * that has none, and carrying an existing `Closes`/`Related` line forward all exist to name a title
 * and a body this script is about to write; a legacy lane writes neither, so the port is never asked
 * and none of those rules can fire. A legacy lane carrying only merges above `origin/main` therefore
 * still publishes, because pushing is the whole of what publishing it means.
 */
function pullRequestWrite(
    issue: number | undefined,
    lane: ResolvedLane,
    baseSha: string,
    headSha: string,
    port: PublishLanePort,
    relationship: IssueRelationship | undefined,
    testInstructions: string | undefined,
    summary: string | undefined
): PullRequestWrite | undefined {
    if (lane.legacy) {
        return undefined;
    }
    const laneSubject = port.laneSubject(lane.path, baseSha, headSha);
    if (laneSubject === undefined) {
        fail(`${lane.branch} ${NO_LANE_SUBJECT_FAILURE}`);
    }
    assertConventionalSubject(laneSubject, 'pull-request title');
    // The update path overwrites the whole body, so an argumentless run on an issue lane would
    // strip `Closes #<issue>` off a pull request that already carried it. The resolved lane's own
    // branch is the issue of record; `None.` is only for a lane that genuinely has no issue.
    const laneIssue = issue ?? laneIssueNumber(lane.branch);
    if (relationship === 'relates' && laneIssue === undefined) {
        fail('--relates requires an issue lane or issue number');
    }
    const existing = port.existingOpenPullRequest(lane.branch);
    if (existing !== undefined && typeof existing.body !== 'string') {
        fail('existing pull-request body is unreadable');
    }
    const existingTitle = existing?.title;
    if (existing !== undefined && typeof existingTitle !== 'string') {
        fail('existing pull-request title is unreadable');
    }
    // An explicit --relates/--closes needs nothing recovered from the existing body, so a body
    // with no line naming the lane issue (an umbrella-carried extra, say) does not block it.
    const existingRelationship =
        existing === undefined || relationship !== undefined
            ? undefined
            : issueRelationshipFromBody(existing.body as string, laneIssue, REQUIRED_REPOSITORY);
    const resolvedRelationship = relationship ?? existingRelationship ?? 'closes';
    if (existing === undefined && testInstructions === undefined) {
        fail('opening a pull request requires --test <instructions>');
    }
    if (existing === undefined && summary === undefined) {
        fail('opening a pull request requires --summary <text>');
    }
    let resolvedTestInstructions = testInstructions;
    if (resolvedTestInstructions === undefined) {
        if (existing === undefined || typeof existing.body !== 'string') {
            fail('existing pull-request body is unreadable');
        }
        resolvedTestInstructions = howToTestFromBody(existing.body);
    }
    let resolvedSummary = summary;
    if (resolvedSummary === undefined) {
        if (existing === undefined || typeof existing.body !== 'string') {
            fail('existing pull-request body is unreadable');
        }
        resolvedSummary = whatFromBody(existing.body);
    }
    const pullRequestTitle = typeof existingTitle === 'string' ? existingTitle : laneSubject;
    return {
        title: laneSubject,
        effectiveTitle: pullRequestTitle,
        body: composePublishBody(
            laneIssue,
            pullRequestTitle,
            resolvedSummary,
            resolvedTestInstructions,
            resolvedRelationship
        ),
        existing,
    };
}

/**
 * An open pull request for the exact branch is the only thing that authorized this push, and it was
 * proven before the push, not after. If it has closed in between there is nothing to update and
 * nothing this script may author, so it refuses rather than opening a replacement carrying a
 * regenerated body.
 */
function legacyPullRequestNumber(lane: ResolvedLane, existing: ExistingPullRequest | undefined): number {
    if (existing === undefined) {
        fail(
            `${lane.branch} no longer has an open pull request: it was pushed, but a pre-convention ` +
                `lane's pull request is not lane:publish's to open or rewrite`
        );
    }
    return existing.number;
}

/**
 * The pull-request title is squash-merged onto `main`, so the opening write has to name the lane's
 * work. Later publishes leave that title: a follow-up commit must not retitle the pull request, and
 * merging `origin/main` in leaves HEAD a merge commit that must not either. This walk still picks
 * the opening title and still refuses a lane whose only commits above `origin/main` are merges.
 * `--no-merges` skips the merge commits, and the pinned-base range keeps the walk inside the lane's
 * own commits. Without the range, a lane commit older than `origin/main`'s tip loses the date sort
 * and the opening title comes from a commit `main` already has.
 */
function laneSubjectArgs(baseSha: string, headSha: string): string[] {
    return ['log', '-1', '--format=%s', '--no-merges', `${baseSha}..${headSha}`];
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    resolvedPrimaryRoot?: string,
    executables: { git: string; gh: string } = { git: 'git', gh: 'gh' }
): PublishLanePort {
    const primaryRoot =
        resolvedPrimaryRoot ??
        resolvePrimaryRoot(
            (_command, args, directory) => spawnCapture(executables.git, args, { cwd: directory, env: session.env }),
            cwd
        );
    const token = session.env.GH_TOKEN ?? '';
    const [repositoryOwner] = REQUIRED_REPOSITORY.split('/');
    if (repositoryOwner === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    const git = (args: string[], directory: string) =>
        spawnCapture(executables.git, gitAuthenticatedArgs(token, session.configDir, args), {
            cwd: directory,
            env: session.env,
        });
    const gh = (args: string[]) => spawnCapture(executables.gh, args, { cwd: primaryRoot, env: session.env });
    const ghRun = (args: string[]) => spawnRun(executables.gh, args, { cwd: primaryRoot, env: session.env });
    return {
        baseSha: () => {
            spawnRun(
                executables.git,
                gitAuthenticatedArgs(token, session.configDir, [
                    'fetch',
                    GITHUB_HTTPS_REMOTE,
                    '+refs/heads/main:refs/remotes/origin/main',
                ]),
                { cwd: primaryRoot, env: session.env }
            );
            return spawnCapture(executables.git, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], {
                cwd: primaryRoot,
                env: session.env,
            });
        },
        worktrees: () =>
            parsePublishWorktrees(
                spawnCapture(executables.git, ['worktree', 'list', '--porcelain', '-z'], {
                    cwd: primaryRoot,
                    env: session.env,
                })
            ),
        cwd: () => cwd,
        issueExists: (issue) => {
            const result = spawnSync(executables.gh, issueLookupArgs(issue), {
                cwd: primaryRoot,
                env: session.env,
                encoding: 'utf8',
                shell: false,
            });
            if (result.error !== undefined) {
                throw result.error;
            }
            return issueExistsFromLookup(issue, result);
        },
        aheadBehind: (lane, baseSha, headSha) => {
            const output = spawnCapture(
                executables.git,
                ['rev-list', '--left-right', '--count', `${baseSha}...${headSha}`],
                {
                    cwd: lane,
                    env: session.env,
                }
            );
            const [behindText, aheadText] = output.split(/\s+/);
            const behind = Number(behindText);
            const ahead = Number(aheadText);
            if (!Number.isSafeInteger(behind) || !Number.isSafeInteger(ahead)) {
                fail('cannot prove lane ahead/behind origin/main');
            }
            return { ahead, behind };
        },
        dirty: (lane) =>
            spawnCapture(executables.git, ['status', '--porcelain=v1', '--untracked-files=all'], {
                cwd: lane,
                env: session.env,
            }) !== '',
        laneSubject: (lane, baseSha, headSha) =>
            spawnCapture(executables.git, laneSubjectArgs(baseSha, headSha), { cwd: lane, env: session.env }) ||
            undefined,
        headSha: (lane) => spawnCapture(executables.git, ['rev-parse', 'HEAD'], { cwd: lane, env: session.env }),
        remoteBranchSha: (branch) => {
            const output = git(['ls-remote', GITHUB_HTTPS_REMOTE, `refs/heads/${branch}`], primaryRoot);
            if (output === '') {
                return undefined;
            }
            const sha = output.split(/\s+/)[0];
            return sha === undefined || sha === '' ? undefined : sha;
        },
        isAncestor: (ancestorSha, descendantSha, lane) =>
            isAncestorCommit(lane, ancestorSha, descendantSha, session.env, executables.git),
        push: (lane, branch, headSha) => {
            const disabledHooksPath = join(session.configDir, 'disabled-hooks');
            mkdirSync(disabledHooksPath, { recursive: true, mode: 0o700 });
            const hasAiNotes =
                spawnSync(executables.git, ['rev-parse', '--verify', 'refs/notes/ai'], {
                    cwd: lane,
                    env: session.env,
                }).status === 0;
            spawnRun(
                executables.git,
                gitAuthenticatedArgs(token, session.configDir, [
                    '-c',
                    `core.hooksPath=${disabledHooksPath}`,
                    'push',
                    '--no-verify',
                    GITHUB_HTTPS_REMOTE,
                    `${headSha}:refs/heads/${branch}`,
                    ...(hasAiNotes ? ['+refs/notes/ai:refs/notes/ai'] : []),
                ]),
                {
                    cwd: lane,
                    env: session.env,
                }
            );
        },
        existingOpenPullRequest: (branch) => {
            const rows = parseJson<OpenPullRequestRow[]>(
                gh(existingOpenPullRequestArgs(branch)),
                'open pull-request query'
            );
            return matchingOpenPullRequest(rows, branch);
        },
        stackBase: (lane, branch, head, main) => {
            const marker = spawnCapture(
                executables.git,
                ['config', '--get', '--default', '', `branch.${branch}.sourdaw-stack-fork`],
                { cwd: primaryRoot, env: session.env }
            );
            const descriptor = readRegisteredLaneStack(primaryRoot, branch, marker);
            if (descriptor === undefined) {
                return undefined;
            }
            assertStackAcyclic(descriptor, (parentBranch) => readLaneStack(primaryRoot, parentBranch));
            const context = stackPublicationBase(descriptor, head, main, {
                parents: (parentBranch) => parseStackParents(gh(stackParentQuery(parentBranch))),
                isAncestor: (ancestor, descendant) =>
                    isAncestorCommit(lane, ancestor, descendant, session.env, executables.git),
            });
            return {
                branch: context.branch,
                head: context.head,
                parentNumber: context.parent.number,
                parentState: context.parent.state,
                parentHead: context.parent.headSha,
            };
        },
        pinStackParent: (branch, number) => {
            const descriptor = readLaneStack(primaryRoot, branch);
            if (descriptor === undefined) {
                fail('stack descriptor disappeared before publication');
            }
            writeLaneStack(primaryRoot, { ...descriptor, parentPullRequest: number });
        },
        reportDiff: (lane, base, head) => {
            const result = spawnSync(executables.git, ['diff', '--numstat', '-z', `${base}...${head}`], {
                cwd: lane,
                env: session.env,
            });
            if (result.error !== undefined) {
                throw result.error;
            }
            if (result.status !== 0) {
                fail(result.stderr.toString('utf8') || 'cannot measure publication diff');
            }
            console.log(formatReviewDiffSummary(summarizeReviewDiff(lane, result.stdout)));
        },
        createPullRequest: ({ branch, title, body, base }) => {
            const url = gh([
                'pr',
                'create',
                '--repo',
                REQUIRED_REPOSITORY,
                '--base',
                base ?? REQUIRED_BASE_BRANCH,
                '--head',
                branch,
                '--title',
                title,
                '--body',
                body,
            ]);
            const number = Number(url.split('/').at(-1));
            if (!Number.isSafeInteger(number) || number <= 0) {
                fail(`gh pr create returned an unreadable url: ${url}`);
            }
            return number;
        },
        updatePullRequest: (number, { body }) => {
            ghRun(updatePullRequestArgs(number, body));
        },
        saveAuthorModel: (branch, model) => {
            spawnRun(executables.git, ['config', `branch.${branch}.sourdaw-author-model`, model], {
                cwd: primaryRoot,
                env: session.env,
            });
        },
        readAuthorModel: (branch) => {
            const value = spawnCapture(
                executables.git,
                ['config', '--get', '--default', '', `branch.${branch}.sourdaw-author-model`],
                { cwd: primaryRoot, env: session.env }
            );
            return value === '' ? undefined : value;
        },
        ensureModelLabel: (model) => {
            ghRun(ensureModelLabelArgs(model));
        },
        readIssueTrackerMetadata: (issue) =>
            trackerMetadataFromIssueRow(
                parseJson<IssueTrackerRow>(gh(issueTrackerMetadataArgs(issue)), `issue #${issue} tracker metadata`)
            ),
        openMilestoneTitles: () =>
            openMilestoneTitlesFromRows(parseJson<unknown>(gh(openMilestoneTitlesArgs()), 'open milestone titles')),
        knownProjectTitles: () =>
            projectTitlesFromListing(parseJson<unknown>(gh(projectListArgs(repositoryOwner)), 'project list')),
        knownLabels: () => labelRowsFromListing(parseJson<unknown>(gh(labelListArgs()), 'repository label list')),
        readPullRequestMetadata: (number) =>
            pullRequestMetadataFromRow(
                parseJson<PullRequestMetadataRow>(
                    gh(pullRequestMetadataArgs(number)),
                    `pull request #${number} metadata`
                )
            ),
        applyPullRequestMetadata: (number, plan) => {
            ghRun(applyPullRequestMetadataArgs(number, plan));
        },
        log: (message) => {
            console.log(message);
        },
        guardFailure: (laneName) => readGuardFailureReceipt(primaryRoot, laneName),
    };
}

export function isAncestorCommit(
    lane: string,
    ancestorSha: string,
    descendantSha: string,
    env?: NodeJS.ProcessEnv,
    gitCommand: string = 'git'
): boolean {
    const result = spawnSync(gitCommand, ['merge-base', '--is-ancestor', ancestorSha, descendantSha], {
        cwd: lane,
        env,
        encoding: 'utf8',
        shell: false,
    });
    if (result.status === 0) {
        return true;
    }
    if (result.status === 1) {
        return false;
    }
    throw new Error(result.stderr.trim() || 'git merge-base --is-ancestor failed');
}

const ISSUE_NOT_FOUND_PATTERN = /HTTP 404|Not Found|Could not resolve to an? Issue/i;

/**
 * The REST issues endpoint resolves pull-request numbers too, and answers with the same `number`.
 * Only the `pull_request` key tells the two apart, so the lookup has to ask for it: without it a
 * pull-request number passes the existence gate and lands `Closes #<pr>` in the body.
 */
export const ISSUE_LOOKUP_JQ = '{number: .number, isPullRequest: (has("pull_request"))}';

type IssueLookup = { number?: number; isPullRequest?: boolean };

export function issueLookupArgs(issue: number): string[] {
    return ['api', `repos/${REQUIRED_REPOSITORY}/issues/${issue}`, '--jq', ISSUE_LOOKUP_JQ];
}

export function issueExistsFromLookup(
    issue: number,
    result: { status: number | null; stdout: string; stderr: string }
): boolean {
    if (result.status === 0) {
        const lookup = parseJson<IssueLookup>(result.stdout, `issue #${issue} lookup`);
        if (lookup.isPullRequest === true) {
            fail(`#${issue} in ${REQUIRED_REPOSITORY} is a pull request, not an issue; pass the issue it closes`);
        }
        return lookup.number === issue;
    }
    const stderr = result.stderr.trim();
    if (ISSUE_NOT_FOUND_PATTERN.test(stderr)) {
        return false;
    }
    throw new Error(stderr || `cannot prove issue #${issue} exists in ${REQUIRED_REPOSITORY}`);
}

export function existingOpenPullRequestArgs(branch: string): string[] {
    return [
        'pr',
        'list',
        '--repo',
        REQUIRED_REPOSITORY,
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'number,headRefName,isCrossRepository,title,body,baseRefName,headRefOid',
    ];
}

export function updatePullRequestArgs(number: number, body: string): string[] {
    return ['pr', 'edit', String(number), '--repo', REQUIRED_REPOSITORY, '--body', body];
}

export function issueTrackerMetadataArgs(issue: number): string[] {
    return ['issue', 'view', String(issue), '--repo', REQUIRED_REPOSITORY, '--json', 'labels,milestone,projectItems'];
}

export function openMilestoneTitlesArgs(): string[] {
    return ['api', `repos/${REQUIRED_REPOSITORY}/milestones?state=open`];
}

export function projectListArgs(owner: string): string[] {
    return ['project', 'list', '--owner', owner, '--format', 'json'];
}

export function pullRequestMetadataArgs(number: number): string[] {
    return ['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'labels,milestone,projectItems'];
}

export type OpenPullRequestRow = {
    number: number;
    headRefName: string;
    isCrossRepository: boolean;
    title: unknown;
    body: unknown;
    baseRefName?: string;
    headRefOid?: string;
};

/**
 * `--head` narrows the request server-side, but proves nothing about *how* it narrows: `gh` does not
 * document whether it matches the branch exactly or as a prefix, and `--repo` scopes the base
 * repository, not the head repository, so a same-named branch on a fork could satisfy it too. This
 * result gates whether an off-convention, author-locked worktree may push (`resolveLegacyCandidate`'s
 * `hasOpenPullRequest`), so the match has to be proven client-side instead of trusted from the
 * server-side filter: only a row whose `headRefName` is exactly `branch` and whose `isCrossRepository`
 * is `false` counts. This also gates the ordinary update-vs-create path for conforming lanes, where a
 * `lane:publish` push always targets the same repository under the exact `agent/<issue>/<slug>`
 * branch name, so the tightened match changes nothing there — except to keep a fork's body out of
 * the relationship a flagless update carries forward.
 */
export function matchingOpenPullRequest(rows: OpenPullRequestRow[], branch: string): ExistingPullRequest | undefined {
    const matches = rows.filter((row) => row.headRefName === branch && row.isCrossRepository === false);
    if (matches.length > 1) {
        fail(`branch ${branch} has more than one open pull request`);
    }
    return matches[0];
}

export function parsePublishWorktrees(value: string): PublishWorktree[] {
    return value
        .split('\0\0')
        .filter((record) => record !== '')
        .map((record) => {
            const fields = record.split('\0');
            const worktree = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
            if (worktree === undefined) {
                fail('git returned malformed worktree state');
            }
            const locked = fields.find((field) => field === 'locked' || field.startsWith('locked '));
            return {
                path: worktree,
                branch: fields.find((field) => field.startsWith('branch '))?.slice('branch refs/heads/'.length),
                locked: locked !== undefined,
                lockReason: locked?.slice('locked '.length) || undefined,
            };
        });
}

export async function runPublishLaneCli(args: string[]): Promise<number> {
    const parsed = parsePublishLaneArgs(args);
    if (parsed.help) {
        console.log(PUBLISH_LANE_USAGE.replace('usage:', 'Usage:'));
        return 0;
    }
    if (parsed.issue === undefined && parsed.lanePath === undefined) {
        fail(PUBLISH_LANE_USAGE);
    }
    const executingFile = fileURLToPath(import.meta.url);
    const cwd = process.cwd();
    const runtime = trustedPublishRuntime();
    const authorizationEnv = githubAuthorizationGitEnv();
    if (realpathSync(cwd) !== realpathSync(runtime.primaryRoot)) {
        fail('lane:publish must be launched from the protected primary checkout');
    }
    assertTrustedExecutingBlob(
        'scripts/publishLane.ts',
        executingFile,
        originMainBlob('scripts/publishLane.ts', cwd, authorizationEnv, runtime.gitPath, runtime.originCommit)
    );
    const primaryRoot = resolvePrimaryRoot(
        (_command, commandArgs, directory) =>
            spawnCapture(runtime.gitPath, commandArgs, { cwd: directory, env: authorizationEnv }),
        cwd
    );
    const resolvedCommonDir = spawnCapture(runtime.gitPath, ['rev-parse', '--git-common-dir'], {
        cwd: primaryRoot,
        env: authorizationEnv,
    });
    const absoluteCommonDir = realpathSync(
        isAbsolute(resolvedCommonDir) ? resolvedCommonDir : resolve(primaryRoot, resolvedCommonDir)
    );
    if (
        realpathSync(primaryRoot) !== realpathSync(runtime.primaryRoot) ||
        absoluteCommonDir !== realpathSync(runtime.commonDir)
    ) {
        fail('lane:publish trusted repository binding does not match the protected primary checkout');
    }
    const localWorktrees = parsePublishWorktrees(
        spawnCapture(runtime.gitPath, ['worktree', 'list', '--porcelain', '-z'], {
            cwd: primaryRoot,
            env: authorizationEnv,
        })
    );
    // Resolve the locally locked lane before mint so the token scope comes only from that lane's
    // committed diff. Legacy eligibility is re-proven through GitHub after authentication below;
    // `true` here grants no publish authority, it only lets the enclosing locked lane be inspected.
    // An exact path may select a conforming issue lane: publishLane derives and validates its issue
    // from the branch after the authenticated resolution is re-proven.
    const selectionPath = parsed.lanePath ?? cwd;
    const authenticationLane = resolveAuthorLane(parsed.issue, localWorktrees, selectionPath, realpathSync, () => true);
    if (parsed.lanePath !== undefined) {
        if (realpathSync(parsed.lanePath) !== realpathSync(authenticationLane.path)) {
            fail('--lane must name the exact author worktree root');
        }
    }
    spawnRun(runtime.gitPath, ['fetch', GITHUB_HTTPS_REMOTE, '+refs/heads/main:refs/remotes/origin/main'], {
        cwd: primaryRoot,
        env: authorizationEnv,
    });
    const baseSha = spawnCapture(runtime.gitPath, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], {
        cwd: primaryRoot,
        env: authorizationEnv,
    });
    const auth = await authenticatePublishingAuthor({
        primaryRoot,
        lane: { path: authenticationLane.path, branch: authenticationLane.branch },
        baseSha,
        capture: (_command, commandArgs, directory) =>
            spawnCapture(runtime.gitPath, commandArgs, {
                cwd: directory,
                env: authorizationEnv,
                trim: false,
            }),
    });
    try {
        const repository = spawnCapture(
            runtime.ghPath,
            ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
            {
                env: auth.session.env,
                cwd: primaryRoot,
            }
        );
        assertRequiredRepository(repository);
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        publishLane(
            parsed.issue,
            shellPort(auth.session, selectionPath, primaryRoot, { git: runtime.gitPath, gh: runtime.ghPath }),
            parsed.relationship,
            parsed.testInstructions,
            parsed.summary,
            { ...auth.authorization, legacy: authenticationLane.legacy },
            {
                ...(parsed.model === undefined ? {} : { model: parsed.model }),
                ...(parsed.milestone === undefined ? {} : { milestone: parsed.milestone }),
                ...(parsed.projects === undefined ? {} : { projects: parsed.projects }),
                ...(parsed.labels === undefined ? {} : { labels: parsed.labels }),
            }
        );
        return 0;
    } finally {
        auth.session.dispose();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void runPublishLaneCli(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
