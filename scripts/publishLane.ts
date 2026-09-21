#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateOrchestratorSession,
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
import {
    changedReviewPaths,
    formatReviewDiffSummary,
    summarizeReviewDiff,
    type ReviewChangedPath,
} from './reviewDiffSummary.ts';
import {
    assertStackAcyclic,
    parseStackParents,
    readLaneStack,
    readRegisteredLaneStack,
    stackParentQuery,
    stackPublicationBase,
    writeLaneStack,
} from './stackedLanes.ts';
import { assertObservableTestInstructions } from './testInstructions.ts';

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
 * The source trees whose changes a user runs in the app: a lane touching any of them is product
 * scope, and its How-to-test section has to teach an observable step, not recite checks. Declared
 * above the guidance so the printed tree list is derived from it rather than retyped beside it.
 */
export const PRODUCT_SCOPE_PREFIXES = ['src/modules/', 'src/components/', 'electron/'] as const;

/**
 * The `--test` contract the usage line has no room to state, printed under it by `--help`. Usage
 * stays one line because refusals embed it verbatim; the rule rides beside it.
 */
export const PUBLISH_LANE_TEST_GUIDANCE = `--test teaches how a reviewer verifies the change; for product-scope changes (${PRODUCT_SCOPE_PREFIXES.join(', ')}) it must give user/reviewer-observable steps and their expected result, and CI or author checks do not substitute.`;

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

/**
 * The half of a pull request's metadata the author App can read. Project membership is not in it:
 * it is read separately, through the operator credential, and only when a target project exists.
 */
export type PullRequestLabelMetadata = {
    labels: string[];
    /** Fenced authorship labels (`Authored by …` description) the pull request wears now. */
    fencedAuthorLabels: string[];
    milestoneTitle?: string;
};

export type PullRequestMetadata = PullRequestLabelMetadata & { projectTitles: string[] };

/** The metadata a publication must leave on its pull request. `labels` leads with the model label. */
export type PublishMetadataTarget = {
    model: string;
    labels: string[];
    milestoneTitle?: string;
    projectTitles: string[];
};

/**
 * The pieces of the target a pull request is missing, plus the fenced authorship labels a model
 * change supersedes, or `undefined` when it is already complete.
 */
export type MetadataEditPlan = {
    addLabels: string[];
    removeLabels: string[];
    milestoneTitle?: string;
    addProjectTitles: string[];
};

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
};

export function trackerMetadataFromIssueRow(row: IssueTrackerRow): {
    milestoneTitle?: string;
    labels: LabelRow[];
} {
    const milestoneTitle = titleOf(row.milestone);
    return {
        ...(milestoneTitle === undefined ? {} : { milestoneTitle }),
        labels: labelRowsFromRow(row.labels),
    };
}

/** One parser for both `projectItems` rows: an issue's and a pull request's carry the same shape. */
export function projectTitlesFromRow(row: { projectItems?: unknown[] }): string[] {
    return [
        ...new Set(
            (row.projectItems ?? []).flatMap((item) => {
                const title = titleOf(item);
                return title === undefined ? [] : [title];
            })
        ),
    ];
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
};

/**
 * GitHub's live structural mergeability, reduced to the three answers a publish report
 * distinguishes. `CONFLICTING` is the only conflict; the `UNKNOWN` GitHub returns while it computes,
 * and every other or unreadable value, is uncertainty. Reporting uncertainty as a conflict would
 * send an operator to resolve a conflict that may not exist.
 */
export type PullRequestMergeability = 'mergeable' | 'conflicting' | 'unknown';

export function mergeabilityFromPullRequestRow(row: { mergeable?: unknown }): PullRequestMergeability {
    if (row.mergeable === 'MERGEABLE') {
        return 'mergeable';
    }
    if (row.mergeable === 'CONFLICTING') {
        return 'conflicting';
    }
    return 'unknown';
}

export function pullRequestLabelMetadataFromRow(row: PullRequestMetadataRow): PullRequestLabelMetadata {
    const milestoneTitle = titleOf(row.milestone);
    return {
        labels: labelNamesFromRow(row.labels),
        fencedAuthorLabels: labelRowsFromRow(row.labels)
            .filter(isAuthorshipLabel)
            .map((label) => label.name),
        ...(milestoneTitle === undefined ? {} : { milestoneTitle }),
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
 * Where an issueless lane's pull request belongs, keyed by the type label its subject derives: the
 * boards an issue-bound lane would inherit through its issue. A type that derives no label lands on
 * no board either, and the derived title is still proven against the live project listing before it
 * is applied — this table names a board, it does not assert one exists.
 */
const TYPE_LABEL_PROJECTS: Readonly<Record<string, string>> = {
    bug: 'Sourdaw Bugs',
    enhancement: 'Sourdaw Roadmap',
    documentation: 'Sourdaw Roadmap',
};

export function derivedProjectFromSubject(subject: string): string | undefined {
    const label = derivedLabelFromSubject(subject);
    return label === undefined ? undefined : TYPE_LABEL_PROJECTS[label];
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
 * The missing pieces plus the superseded fences, so a rerun after a partial metadata write
 * converges without churning what a previous publish already set. `undefined` means the pull
 * request already carries the whole target and no `gh pr edit` is issued at all.
 *
 * Removals are fence-derived only: a label leaves the plan's crosshairs by carrying the
 * `Authored by ` description, never by name, so a descriptive label that merely shares a
 * model's name is never removed. The current model's own fence is kept by name equality.
 */
export function metadataEditPlan(
    target: PublishMetadataTarget,
    current: PullRequestMetadata
): MetadataEditPlan | undefined {
    const currentModelLabel = modelLabelName(target.model).toLowerCase();
    const removeLabels = current.fencedAuthorLabels.filter((label) => label.toLowerCase() !== currentModelLabel);
    const addLabels = target.labels.filter((label) => !current.labels.includes(label));
    const milestoneTitle =
        target.milestoneTitle !== undefined && current.milestoneTitle !== target.milestoneTitle
            ? target.milestoneTitle
            : undefined;
    const addProjectTitles = target.projectTitles.filter((title) => !current.projectTitles.includes(title));
    if (
        addLabels.length === 0 &&
        removeLabels.length === 0 &&
        milestoneTitle === undefined &&
        addProjectTitles.length === 0
    ) {
        return undefined;
    }
    return {
        addLabels,
        removeLabels,
        ...(milestoneTitle === undefined ? {} : { milestoneTitle }),
        addProjectTitles,
    };
}

/**
 * Labels and milestone only: those are the author App's to write. `--add-project` needs the
 * operator credential and travels in its own edit, so mixing it in here would fail the whole edit
 * and leave the labels unapplied too.
 */
export function applyPullRequestMetadataArgs(number: number, plan: MetadataEditPlan): string[] {
    return [
        'pr',
        'edit',
        String(number),
        '--repo',
        REQUIRED_REPOSITORY,
        ...plan.addLabels.flatMap((label) => ['--add-label', label]),
        ...plan.removeLabels.flatMap((label) => ['--remove-label', label]),
        ...(plan.milestoneTitle === undefined ? [] : ['--milestone', plan.milestoneTitle]),
    ];
}

export function addPullRequestProjectsArgs(number: number, titles: string[]): string[] {
    return [
        'pr',
        'edit',
        String(number),
        '--repo',
        REQUIRED_REPOSITORY,
        ...titles.flatMap((title) => ['--add-project', title]),
    ];
}

/**
 * Product scope means a *handwritten* change under a product tree. Test, docs, and generated paths
 * under the same trees have no user-observable surface of their own, so they never fire the gate.
 */
export function isProductScopeChange(paths: readonly ReviewChangedPath[]): boolean {
    return paths.some(
        (entry) =>
            entry.group === 'handwritten' && PRODUCT_SCOPE_PREFIXES.some((prefix) => entry.path.startsWith(prefix))
    );
}

/** One commit the authorship gate read named: its short sha and the email it is authored as. */
export type CommitAuthorEmail = {
    sha: string;
    email: string;
};

/**
 * Object-store rewrites that split what a traversal sees from what a push sends: `git log` follows
 * the common dir's `info/grafts` file even under `--no-replace-objects`, and the replace-refs
 * disable applies only to the gate's own read, so every other view — the remote's included — still
 * honors them. Any lane shell sharing the common dir can write both, so their presence refuses
 * publication instead of trusting a read the store can contradict.
 */
export type ObjectStoreRewrites = {
    /** Absolute path of the common dir's `info/grafts`, set only while that file exists. */
    graftsFile: string | undefined;
    /** How many `refs/replace/*` refs the repository carries. */
    replaceRefs: number;
};

/**
 * The three states a remote-tip read can report. `unreadable` is distinct from `absent`: an
 * entirely empty `ls-remote --heads` answer means the remote could not be read (a reachable remote
 * always has at least one head in this repository), while a non-empty listing that lacks the target
 * branch is `absent`. Whether `absent` is a legitimate first publication or a transport flake is the
 * caller's call: the caller fails closed when an open pull request already heads the branch.
 */
export type RemoteBranchRead = { kind: 'present'; sha: string } | { kind: 'absent' } | { kind: 'unreadable' };

export type PublishLanePort = {
    baseSha: () => string;
    worktrees: () => PublishWorktree[];
    cwd: () => string;
    issueExists: (issue: number) => boolean;
    aheadBehind: (lane: string, baseSha: string, headSha: string) => { ahead: number; behind: number };
    dirty: (lane: string) => boolean;
    laneSubject: (lane: string, baseSha: string, headSha: string) => string | undefined;
    /**
     * Author email of every commit reachable from `headSha` but from neither `deltaBaseSha` nor any
     * `excludedBaseSha`, merges included, read in the lane itself without replacement objects, so
     * the gate sees exactly the objects a push would send.
     */
    commitAuthorEmails: (
        lane: string,
        deltaBaseSha: string,
        excludedBaseShas: string[],
        headSha: string
    ) => CommitAuthorEmail[];
    /**
     * The lane repository's object-store rewrites, resolved in the lane itself before any remote
     * write: a graft file or replace ref lets the object store show one history to a traversal and
     * send another to a push, so their presence refuses publication outright.
     */
    objectStoreRewrites: (lane: string) => ObjectStoreRewrites;
    headSha: (lane: string) => string;
    remoteBranchSha: (branch: string) => RemoteBranchRead;
    isAncestor: (ancestorSha: string, descendantSha: string, lane: string) => boolean;
    push: (lane: string, branch: string, headSha: string) => void;
    existingOpenPullRequest: (branch: string) => ExistingPullRequest | undefined;
    stackBase?: (lane: string, branch: string, head: string, main: string) => StackPublicationContext | undefined;
    pinStackParent?: (branch: string, number: number) => void;
    reportDiff?: (lane: string, base: string, head: string) => void;
    /** Read after the push: the pull request's live mergeability, never a pre-push guess. */
    readPullRequestMergeability: (number: number) => PullRequestMergeability;
    /** The paths a real trial merge of `base` and `head` conflicts on, in the lane's own repository. */
    conflictingPaths: (lane: string, base: string, head: string) => string[];
    /** The lane's changed paths between `baseSha` and `headSha`, classified for scope gates. */
    changedPaths: (lane: string, baseSha: string, headSha: string) => readonly ReviewChangedPath[];
    createPullRequest: (input: { branch: string; title: string; body: string; base?: string }) => number;
    updatePullRequest: (number: number, input: { body: string }) => void;
    saveAuthorModel: (branch: string, model: string) => void;
    readAuthorModel: (branch: string) => string | undefined;
    ensureModelLabel: (model: string) => void;
    readIssueTrackerMetadata: (issue: number) => {
        milestoneTitle?: string;
        labels: LabelRow[];
    };
    openMilestoneTitles: () => string[];
    /** Operator-credentialed: user-owned Projects v2 are unreachable for an installation token. */
    knownProjectTitles: () => string[];
    readIssueProjectTitles: (issue: number) => string[];
    knownLabels: () => LabelRow[];
    readPullRequestMetadata: (number: number) => PullRequestLabelMetadata;
    readPullRequestProjectTitles: (number: number) => string[];
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

/**
 * Gate exactly the commits this publication adds to the remote: `remoteTip..head` when the branch
 * already exists remotely at an ancestor of head, else the same resolved base the lane subject
 * derives from, so a stack child gates its own delta rather than its parent's — always excluding
 * everything the resolved bases (origin/main and any stack parent head) reach, because base-side
 * commits a lane merged are not the lane's to author; the bases' own publications gate them. Every
 * remaining commit, merges included, must carry the author App's commit email — the identity lane
 * worktrees are stamped with at open — and the refusal names each offending commit. Its remedy
 * cannot rewrite base-side history: the offered rebase is gated on its root dominating every
 * excluded base, and when no such rewrite exists — as under an open parent head that does not
 * contain the main commits the lane merged, or a merged parent's pre-squash head that squash
 * semantics keep off main forever — the refusal prescribes re-creating the named commits.
 */
function assertBotAuthoredDelta(
    lane: ResolvedLane,
    remoteRead: RemoteBranchRead,
    comparisonHead: string,
    baseSha: string,
    stackParentHead: string | undefined,
    headSha: string,
    port: PublishLanePort
): void {
    // The publication read the remote before this gate and already refused an unreadable listing,
    // so the read here is `present` or `absent`: a present remote tip is the delta base exactly as
    // the undefined-vs-remote-tip split always worked, and an absent branch is a first publication
    // whose delta base is the comparison head.
    const deltaBase = remoteRead.kind === 'present' ? remoteRead.sha : comparisonHead;
    const excludedBaseShas = Array.from(
        new Set([comparisonHead, baseSha, ...(stackParentHead === undefined ? [] : [stackParentHead])])
    );
    const offending = port
        .commitAuthorEmails(lane.path, deltaBase, excludedBaseShas, headSha)
        .filter((commit) => commit.email !== AUTHOR_BOT_COMMIT_EMAIL);
    if (offending.length === 0) {
        return;
    }
    // The rebase remedy is safe only when its root already contains every excluded base: then the
    // rewritten `comparisonHead..head` range holds no base-side commit at all (true for ordinary
    // lanes, where the root is origin/main itself, and for a parent head that already contains
    // current main). A stack child under an open parent can merge newer main commits its parent
    // head does not dominate, and a child of a merged parent retains the parent's pre-squash
    // commits that main can never reach — rebasing onto the root would re-author those base-side
    // commits as the App — so the refusal falls back to re-creating the listed commits with the
    // stamped identity.
    const offersRebase =
        remoteRead.kind === 'absent' &&
        excludedBaseShas
            .filter((sha) => sha !== comparisonHead)
            .every((sha) => port.isAncestor(sha, comparisonHead, lane.path));
    fail(authorshipRefusal(lane.branch, deltaBase, comparisonHead, offending, offersRebase));
}

/** At most this many offending commits are named one by one before the refusal counts the rest. */
const MAX_NAMED_OFFENDING_COMMITS = 8;

/**
 * The refusal names each offending commit and each distinct offending email, states the base-side
 * exclusion, and prescribes only remedies that cannot replace history the lane does not own: the
 * rebase is rooted at the comparison base and offered exactly when the remote branch holds none of
 * the lane's commits and that base dominates every excluded one, so the rewritten range carries no
 * base-side commit; otherwise, and with a pushed lane history, the named commits must be re-created.
 * A rewrite rooted at the remote tip would replay base-side commits the lane merged and re-author
 * them as the App, so the remote tip never roots one.
 */
function authorshipRefusal(
    branch: string,
    deltaBase: string,
    comparisonHead: string,
    offending: CommitAuthorEmail[],
    offersRebase: boolean
): string {
    const distinctEmails = Array.from(new Set(offending.map((commit) => commit.email)))
        .map(displayCommitAuthorEmail)
        .join(', ');
    const namedCommits = offending
        .slice(0, MAX_NAMED_OFFENDING_COMMITS)
        .map((commit) => `${commit.sha} ${displayCommitAuthorEmail(commit.email)}`);
    const more = offending.length - namedCommits.length;
    if (more > 0) {
        namedCommits.push(`+${more} more`);
    }
    const remedy = offersRebase
        ? `git rebase --rebase-merges --exec 'git commit --amend --reset-author --no-edit' ${comparisonHead}`
        : 're-create the listed offending commits with the stamped identity';
    return (
        `${branch} carries commits above ${deltaBase} authored as ${distinctEmails}; offending commits: ` +
        `${namedCommits.join(', ')}. Lane commits must be authored as ${AUTHOR_BOT_COMMIT_NAME} ` +
        `<${AUTHOR_BOT_COMMIT_EMAIL}> through the lane worktree's stamped identity. Commits the resolved ` +
        "bases (origin/main and any stack parent head) already reach are not the lane's to author and are " +
        `excluded here. Restamp the lane with pnpm lane:identity, then ${remedy}`
    );
}

/**
 * A graft file or replace ref lets the object store show the gate one history and the push deliver
 * another: `git log` follows the graft file even under `--no-replace-objects`, and replace refs are
 * disabled for the gate's read alone, so their presence still splits every other view. Publication
 * stays refused while either exists; no read the store can contradict decides a push.
 */
function objectStoreRewritesRefusal(branch: string, rewrites: ObjectStoreRewrites): string {
    const grafts = rewrites.graftsFile ?? 'none';
    return (
        `refusing publish: ${branch}'s repository carries object-store rewrites that split what a ` +
        `traversal reads from what a push delivers — info/grafts: ${grafts}, refs/replace/* refs: ` +
        `${rewrites.replaceRefs}. The authorship gate's read cannot trust an object store that carries ` +
        'them: git log follows the graft file even with --no-replace-objects, and the replace-refs ' +
        "disable applies to that read alone, so every other view — the remote's included — still honors " +
        'them. Delete the graft file or drop the replace refs (git replace -d <sha>), then publish again'
    );
}

/** An empty author email renders readably; a bare comma in the refusal would name nothing. */
function displayCommitAuthorEmail(email: string): string {
    return email === '' ? '(empty author email)' : email;
}

/**
 * `git merge-tree --write-tree --name-only` writes the merged tree's object id, then one line per
 * conflicted path, then a blank line before its human-readable conflict commentary. Only the path
 * block names conflicts; the commentary repeats them with explanations, so the parse stops at the
 * blank separator.
 */
export function conflictingPathsFromMergeTree(output: string): string[] {
    const names: string[] = [];
    for (const line of output.split('\n').slice(1)) {
        if (line === '') {
            return names;
        }
        names.push(line);
    }
    return names;
}

/**
 * Finds one branch's tip in a `git ls-remote --heads` listing (`<sha>\t<refname>` per line), or
 * `undefined` when the listing carries no entry for it. An entirely empty listing is not this
 * function's concern: the caller treats that separately as an unreadable remote.
 */
function lsRemoteHeadSha(listing: string, branch: string): string | undefined {
    const ref = `refs/heads/${branch}`;
    for (const line of listing.split('\n')) {
        const [sha, name] = line.split(/\s+/);
        if (name === ref && sha !== undefined && sha !== '') {
            return sha;
        }
    }
    return undefined;
}

/**
 * A pull request whose head conflicts with its base gets no GitHub merge ref, so no `pull_request`
 * workflow run is created for that head and the required `Gate` check can never appear — waiting on
 * it waits forever. The push and the pull-request write have already succeeded by the time this
 * reads, so a conflict is reported, never refused, and the pull request is never modified.
 *
 * The conflicting paths come from a real in-memory trial merge of the pull request's base and head
 * in the lane, because only the repository can name the actual conflict; a guess or a recorded list
 * would name paths the push never touched. An `UNKNOWN` (or unreadable) mergeability is reported as
 * uncertainty rather than as a conflict, so an unreadable state never sends the operator to resolve
 * a conflict that may not exist.
 */
function reportPullRequestMergeability(
    lane: ResolvedLane,
    number: number,
    base: string,
    head: string,
    port: PublishLanePort
): void {
    const mergeability = port.readPullRequestMergeability(number);
    if (mergeability === 'mergeable') {
        return;
    }
    if (mergeability === 'unknown') {
        port.log(
            `pull request #${number} mergeability is not yet known (GitHub answers UNKNOWN while it computes); ` +
                'check it again before waiting on the required Gate check'
        );
        return;
    }
    port.log(
        `pull request #${number} head ${head} conflicts with its base ${base}: GitHub mints no merge ref for a ` +
            'conflicted head, so no pull_request workflow run is created and the required Gate check cannot appear'
    );
    const paths = port.conflictingPaths(lane.path, base, head);
    if (paths.length === 0) {
        port.log(
            'the local trial merge named no conflicting path; resolve the conflict by hand, then push, before waiting on Gate'
        );
        return;
    }
    port.log(`conflicting paths from the local trial merge (git merge-tree --write-tree ${base} ${head}):`);
    for (const path of paths) {
        port.log(`  ${path}`);
    }
}

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
    const remoteRead = port.remoteBranchSha(lane.branch);
    if (remoteRead.kind === 'unreadable') {
        fail(`cannot read the remote heads for ${lane.branch}: the remote listing was unreadable`);
    }
    if (remoteRead.kind === 'present' && !port.isAncestor(remoteRead.sha, headSha, lane.path)) {
        fail(`refusing non-fast-forward push of ${lane.branch}`);
    }
    // An open pull request whose head is this branch proves the branch was already published, so a
    // reachable remote must list it. A non-empty listing that omits it is the transport flake this
    // gate exists to refuse — never a first publication — so fail closed rather than read it as
    // absent and silently widen the non-fast-forward check from remote-tip..head to base..head. A
    // conforming lane read its pull request before the push; a legacy lane's open pull request is
    // what authorized it.
    if (remoteRead.kind === 'absent' && (lane.legacy || write?.existing !== undefined)) {
        fail(
            `refusing publication of ${lane.branch}: the remote heads listing did not carry the branch although an open pull request for it exists`
        );
    }
    // The refusal above proved a present remote tip an ancestor of head, so the delta is exactly
    // the remote tip..head when the branch exists remotely, and the lane-subject range otherwise.
    // These run before every remote write, with the rest of the pre-push refusal set: first the
    // object store must carry no rewrite that could split the gate's read from the push, and only
    // then can a read over that store decide — the authorship gate and the product-scope
    // test-instructions gate both.
    const rewrites = port.objectStoreRewrites(lane.path);
    if (rewrites.graftsFile !== undefined || rewrites.replaceRefs > 0) {
        fail(objectStoreRewritesRefusal(lane.branch, rewrites));
    }
    // Gated on the flag, never the resolved value: a body preserved verbatim from an existing pull
    // request (--test omitted) is not re-judged, so in-flight pull requests keep their semantics,
    // while every fresh create and explicit rewrite teaches an observable step when the change is
    // product scope. The classification read follows the object-store verification, so no rewrite
    // can split what it reads from what the push packs, and it still lands before any remote write,
    // so a refusal leaves nothing pushed.
    if (testInstructions !== undefined) {
        const changedPaths = port.changedPaths(lane.path, comparisonHead, headSha);
        if (isProductScopeChange(changedPaths)) {
            assertObservableTestInstructions(testInstructions);
        }
    }
    assertBotAuthoredDelta(lane, remoteRead, comparisonHead, baseSha, stack?.parentHead, headSha, port);
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
    reportPullRequestMergeability(lane, number, comparisonHead, headSha, port);
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
 * projects come from the lane's issue, or on an issueless lane the projects come from the
 * conventional subject's type, and flag values override them per field after validation against
 * live tracker state — left empty rather than forced onto the pull request. Descriptive
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
 * this script's to derive, so a legacy lane derives neither a label nor a project.
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
        laneIssue,
        laneIssue === undefined && subject !== undefined ? derivedProjectFromSubject(subject) : undefined,
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
 * Every project read and write on this path runs through the verified operator credential, because
 * installation tokens cannot access user-owned Projects v2 — the platform offers no installation
 * permission for them — and gh ≥ 2.92 swallows the Projects v2 enrichment error and answers
 * `gh issue view --json projectItems` with `projectItems: []` and exit 0, so under the author App
 * an empty read cannot be trusted as "no projects": empty and unreadable are indistinguishable.
 *
 * The project list is therefore both the capability probe and the credential's first use: it runs
 * before any inherited or derived title is read, and before any pull-request write, whenever a lane
 * issue is bound, `--project` flags are present, or an issueless lane's subject derives a board.
 * With explicit flags an unreachable list is a hard failure — the operator asked for something this
 * run cannot deliver and must know now — while the other two sources skip project application with
 * one loud line and let the publish continue, leaving the pull request's project membership to the
 * operator backfill. A lane with none of the three skips the probe entirely: there is nothing to
 * apply and nothing to report.
 *
 * A derived title names a board this repository is expected to keep, not one that must exist, so it
 * survives only when the live listing canonically matches it; an inherited title needs no such
 * check, because the issue already sits on the board.
 */
function resolveProjectTitles(
    laneIssue: number | undefined,
    derivedTitle: string | undefined,
    flaggedTitles: string[] | undefined,
    port: PublishLanePort
): string[] {
    if (laneIssue === undefined && flaggedTitles === undefined && derivedTitle === undefined) {
        return [];
    }
    let knownTitles: string[];
    try {
        knownTitles = port.knownProjectTitles();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (flaggedTitles !== undefined) {
            fail(
                `cannot list the owner's projects with the verified operator credential (${reason}); ` +
                    'installation tokens cannot access user-owned Projects v2, so only that credential can ' +
                    'apply project membership. Apply it by hand under the operator backfill exception, or ' +
                    'retry without --project'
            );
        }
        port.log(
            `cannot list the owner's projects with the verified operator credential (${reason}); leaving ` +
                "the pull request's project membership to the operator backfill"
        );
        return [];
    }
    if (flaggedTitles !== undefined) {
        const canonical = flaggedTitles.map((title) => canonicalProjectTitle(title, knownTitles));
        return [...new Set(canonical)];
    }
    if (laneIssue !== undefined) {
        return port.readIssueProjectTitles(laneIssue);
    }
    if (derivedTitle === undefined) {
        return [];
    }
    const canonical = knownTitles.find((known) => known.toLowerCase() === derivedTitle.toLowerCase());
    if (canonical === undefined) {
        port.log(
            `no project named "${derivedTitle}" exists for ${REQUIRED_REPOSITORY}'s owner; leaving this ` +
                "issueless lane's pull request off every board"
        );
        return [];
    }
    return [canonical];
}

/**
 * Metadata assertion is convergent, not transactional: the pull request already exists by the time
 * this runs, so a failure here leaves a publishable pull request that a rerun completes. Reading
 * current state first keeps a rerun — or a later publish of the same head — from churning metadata
 * that is already right.
 */
function assertPullRequestMetadata(number: number, target: PublishMetadataTarget, port: PublishLanePort): void {
    const current = port.readPullRequestMetadata(number);
    // With no target board the plan's project piece is empty whatever the pull request already
    // carries, and the read costs the operator credential this run may not hold at all.
    const projectTitles = target.projectTitles.length === 0 ? [] : port.readPullRequestProjectTitles(number);
    const plan = metadataEditPlan(target, { ...current, projectTitles });
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

/**
 * The authorship gate's read: every commit, merges included, between the delta base and the head,
 * excluding everything the resolved bases reach — base-side commits are not the lane's to author,
 * and the bases' own publications gate them. `--no-replace-objects` leads the argv because `git
 * log` honors `refs/replace/*` while `git push` packs the original objects, so a read that honors
 * replacements could pass a bot-authored clone while the remote receives the human original.
 */
function commitAuthorEmailArgs(deltaBaseSha: string, excludedBaseShas: string[], headSha: string): string[] {
    return [
        '--no-replace-objects',
        'log',
        '--format=%h %ae',
        `${deltaBaseSha}..${headSha}`,
        ...excludedBaseShas.map((sha) => `^${sha}`),
    ];
}

function readCommitAuthorEmails(
    lane: string,
    deltaBaseSha: string,
    excludedBaseShas: string[],
    headSha: string,
    capture: (args: string[], cwd: string) => string
): CommitAuthorEmail[] {
    const lines = capture(commitAuthorEmailArgs(deltaBaseSha, excludedBaseShas, headSha), lane).split('\n');
    // The capture ends in exactly one blank line; strip only that one, so a commit whose author
    // email is genuinely empty survives as an offending value instead of vanishing with a filter.
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines.map(parseCommitAuthorEmail);
}

/** `%h %ae` splits on the first space; a genuinely empty email leaves the email part empty. */
function parseCommitAuthorEmail(line: string): CommitAuthorEmail {
    const separator = line.indexOf(' ');
    return separator === -1
        ? { sha: line, email: '' }
        : { sha: line.slice(0, separator), email: line.slice(separator + 1) };
}

/**
 * Resolved from inside the lane, not the invoking checkout: a linked worktree's git dir is
 * per-worktree, while the grafts file and replace refs live in the shared common dir.
 */
function gitCommonDirArgs(): string[] {
    return ['rev-parse', '--git-common-dir'];
}

/** `for-each-ref` lists the replace refs that only the gate's own read disables. */
function replaceRefsArgs(): string[] {
    return ['for-each-ref', '--format=%(refname)', 'refs/replace/'];
}

/** An empty capture names zero refs; every remaining line is one `refs/replace/*` ref. */
function countReplaceRefs(rows: string): number {
    return rows === '' ? 0 : rows.split('\n').length;
}

/**
 * Reads the lane's object-store rewrites: the common dir's grafts file, present or not, and the
 * replace-ref count. A relative common-dir answer is resolved against the lane, the one directory
 * the answer is relative to.
 */
function readObjectStoreRewrites(lane: string, capture: (args: string[], cwd: string) => string): ObjectStoreRewrites {
    const commonDir = capture(gitCommonDirArgs(), lane);
    const graftsPath = join(isAbsolute(commonDir) ? commonDir : resolve(lane, commonDir), 'info', 'grafts');
    return {
        graftsFile: existsSync(graftsPath) ? graftsPath : undefined,
        replaceRefs: countReplaceRefs(capture(replaceRefsArgs(), lane)),
    };
}

/**
 * The verified operator credential, opened on its first project read and reused for the rest of the
 * publish. Opening it lazily keeps every publish that touches no board — a legacy lane, an
 * issueless lane whose subject derives none — working on a machine that holds no operator
 * credential at all, and keeps the token's lifetime to the window that needs it.
 */
export type OperatorSessionAccess = {
    session: () => GhSession;
    dispose: () => void;
};

export function operatorSessionAccess(
    env: NodeJS.ProcessEnv,
    authenticate: (input: { env: NodeJS.ProcessEnv }) => { session: GhSession } = authenticateOrchestratorSession
): OperatorSessionAccess {
    let opened: GhSession | undefined;
    return {
        session: () => {
            if (opened === undefined) {
                opened = authenticate({ env }).session;
            }
            return opened;
        },
        dispose: () => {
            opened?.dispose();
            opened = undefined;
        },
    };
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    resolvedPrimaryRoot?: string,
    executables: { git: string; gh: string } = { git: 'git', gh: 'gh' },
    operator?: OperatorSessionAccess
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
    const operatorEnv = () => {
        if (operator === undefined) {
            fail('project membership needs the verified operator credential, which this port was built without');
        }
        return operator.session().env;
    };
    const operatorGh = (args: string[]) => spawnCapture(executables.gh, args, { cwd: primaryRoot, env: operatorEnv() });
    const operatorGhRun = (args: string[]) => spawnRun(executables.gh, args, { cwd: primaryRoot, env: operatorEnv() });
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
        commitAuthorEmails: (lane, deltaBaseSha, excludedBaseShas, headSha) =>
            readCommitAuthorEmails(lane, deltaBaseSha, excludedBaseShas, headSha, (args, cwd) =>
                // Untrimmed: the parse strips exactly one trailing blank itself, so a genuinely
                // empty author email line survives the read instead of vanishing into the trim.
                spawnCapture(executables.git, args, { cwd, env: session.env, trim: false })
            ),
        objectStoreRewrites: (lane) =>
            readObjectStoreRewrites(lane, (args, cwd) =>
                spawnCapture(executables.git, args, { cwd, env: session.env })
            ),
        headSha: (lane) => spawnCapture(executables.git, ['rev-parse', 'HEAD'], { cwd: lane, env: session.env }),
        remoteBranchSha: (branch) => {
            const output = git(['ls-remote', '--heads', GITHUB_HTTPS_REMOTE], primaryRoot);
            if (output === '') {
                return { kind: 'unreadable' };
            }
            const sha = lsRemoteHeadSha(output, branch);
            return sha === undefined ? { kind: 'absent' } : { kind: 'present', sha };
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
        // Merge-base range, like reportDiff above: a two-dot range would diff against main's moving
        // tip, so unrelated origin/main movement past the merge base would fabricate product scope
        // for a lane that never touched it. Classified from the lane root like reportDiff, so the
        // gate and the size report cannot disagree about a linguist-generated marking.
        changedPaths: (lane, baseSha, headSha) =>
            changedReviewPaths(
                lane,
                Buffer.from(
                    spawnCapture(executables.git, ['diff', '--numstat', '-z', `${baseSha}...${headSha}`], {
                        cwd: lane,
                        env: session.env,
                        trim: false,
                    })
                )
            ),
        readPullRequestMergeability: (number) => {
            try {
                return mergeabilityFromPullRequestRow(
                    parseJson<{ mergeable?: unknown }>(
                        gh(pullRequestMergeabilityArgs(number)),
                        `pull request #${number} mergeability`
                    )
                );
            } catch {
                // GitHub computes mergeability lazily, and the push has already landed. A failed or
                // unreadable read is uncertainty, never a conflict and never a refusal.
                return 'unknown';
            }
        },
        conflictingPaths: (lane, base, head) => {
            const result = spawnSync(executables.git, ['merge-tree', '--write-tree', '--name-only', base, head], {
                cwd: lane,
                env: session.env,
                encoding: 'utf8',
            });
            // Exit 1 is `merge-tree` reporting conflicts, and only that status writes the path
            // block. A clean merge or a failed command names no path, and the report says exactly
            // that rather than inventing one.
            return result.status === 1 ? conflictingPathsFromMergeTree(result.stdout ?? '') : [];
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
            projectTitlesFromListing(parseJson<unknown>(operatorGh(projectListArgs(repositoryOwner)), 'project list')),
        readIssueProjectTitles: (issue) =>
            projectTitlesFromRow(
                parseJson<{ projectItems?: unknown[] }>(
                    operatorGh(issueProjectItemsArgs(issue)),
                    `issue #${issue} project membership`
                )
            ),
        knownLabels: () => labelRowsFromListing(parseJson<unknown>(gh(labelListArgs()), 'repository label list')),
        readPullRequestMetadata: (number) =>
            pullRequestLabelMetadataFromRow(
                parseJson<PullRequestMetadataRow>(
                    gh(pullRequestMetadataArgs(number)),
                    `pull request #${number} metadata`
                )
            ),
        readPullRequestProjectTitles: (number) =>
            projectTitlesFromRow(
                parseJson<{ projectItems?: unknown[] }>(
                    operatorGh(pullRequestProjectItemsArgs(number)),
                    `pull request #${number} project membership`
                )
            ),
        applyPullRequestMetadata: (number, plan) => {
            if (plan.addLabels.length > 0 || plan.removeLabels.length > 0 || plan.milestoneTitle !== undefined) {
                ghRun(applyPullRequestMetadataArgs(number, plan));
            }
            if (plan.addProjectTitles.length > 0) {
                operatorGhRun(addPullRequestProjectsArgs(number, plan.addProjectTitles));
            }
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
    return ['issue', 'view', String(issue), '--repo', REQUIRED_REPOSITORY, '--json', 'labels,milestone'];
}

export function issueProjectItemsArgs(issue: number): string[] {
    return ['issue', 'view', String(issue), '--repo', REQUIRED_REPOSITORY, '--json', 'projectItems'];
}

export function openMilestoneTitlesArgs(): string[] {
    return ['api', `repos/${REQUIRED_REPOSITORY}/milestones?state=open`];
}

export function projectListArgs(owner: string): string[] {
    return ['project', 'list', '--owner', owner, '--format', 'json'];
}

export function pullRequestMetadataArgs(number: number): string[] {
    return ['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'labels,milestone'];
}

export function pullRequestMergeabilityArgs(number: number): string[] {
    return ['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'mergeable'];
}

export function pullRequestProjectItemsArgs(number: number): string[] {
    return ['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'projectItems'];
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
        console.log(PUBLISH_LANE_TEST_GUIDANCE);
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
    // The App session env strips every GH_/GITHUB_ variable and points gh at a throwaway config
    // directory, so the stored operator credential is only reachable from the process-derived
    // authorization env.
    const operator = operatorSessionAccess(authorizationEnv);
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
            shellPort(auth.session, selectionPath, primaryRoot, { git: runtime.gitPath, gh: runtime.ghPath }, operator),
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
        operator.dispose();
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
