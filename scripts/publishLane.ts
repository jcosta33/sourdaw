#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_LOGIN,
    AUTHOR_LOCK_REASON,
    GITHUB_HTTPS_REMOTE,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    gitAuthenticatedArgs,
    originMainBlob,
    parseJson,
    removalLockPid,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
    type GhSession,
} from './githubAppIdentity.ts';
import { assertConventionalSubject, assertIssueNumber, composePublishBody, fail } from './prContract.ts';

export type PublishWorktree = {
    path: string;
    branch?: string;
    locked: boolean;
    lockReason?: string;
};

export const PUBLISH_LANE_USAGE = 'usage: pnpm lane:publish [issue-number]';

export type PublishLanePort = {
    fetchMain: () => void;
    worktrees: () => PublishWorktree[];
    cwd: () => string;
    issueExists: (issue: number) => boolean;
    aheadBehind: (lane: string) => { ahead: number; behind: number };
    dirty: (lane: string) => boolean;
    laneSubject: (lane: string) => string | undefined;
    headSha: (lane: string) => string;
    remoteBranchSha: (branch: string) => string | undefined;
    isAncestor: (ancestorSha: string, descendantSha: string, lane: string) => boolean;
    push: (lane: string, branch: string) => void;
    existingOpenPullRequest: (branch: string) => number | undefined;
    createPullRequest: (input: { branch: string; title: string; body: string }) => number;
    updatePullRequest: (number: number, input: { title: string; body: string }) => void;
    log: (message: string) => void;
};

export function parsePublishLaneArgs(args: string[]): { issue?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const issueArg = args[0];
    if (issueArg === undefined) {
        return { help: false };
    }
    if (args.length !== 1) {
        fail(PUBLISH_LANE_USAGE);
    }
    return { issue: assertIssueNumber(issueArg, PUBLISH_LANE_USAGE), help: false };
}

/**
 * `legacy` marks a lane resolved through the pre-`agent/` path. It is not decoration: that lane's
 * pull request predates `lane:publish` and is not this script's to rewrite, so the flag has to
 * travel with the lane all the way to the publish step.
 */
type ResolvedLane = { path: string; branch: string; legacy: boolean };

export const NO_ISSUE_LANE_FAILURE =
    'not inside a locked author lane: run pnpm lane:publish from inside the lane, or pass the issue number';

export function canonicalPath(path: string, resolveExisting: (path: string) => string): string {
    const absolute = resolve(path);
    try {
        return resolveExisting(absolute);
    } catch {
        return absolute;
    }
}

export function containsPath(container: string, candidate: string): boolean {
    const relation = relative(container, candidate);
    return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export const AUTHOR_LANE_BRANCH_PREFIX = 'agent/';

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
 * only producer of the `agent/<issue>/<slug>` shape, so the branch is the lane's own record of
 * which issue it closes.
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
    // legacy lane resolves only from inside itself, with no issue argument — see the `issue ===
    // undefined` branch above.
    const prefix = `agent/${issue}/`;
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

export function publishLane(issue: number | undefined, port: PublishLanePort): number {
    port.fetchMain();
    const lane = resolveAuthorLane(
        issue,
        port.worktrees(),
        port.cwd(),
        realpathSync,
        (branch) => port.existingOpenPullRequest(branch) !== undefined
    );
    // Without an argument the target is whatever the caller happened to be standing in, and the
    // next steps push it. Name the selection before anything mutates, so a caller who was in the
    // wrong lane sees which one it was.
    port.log(`publishing ${lane.path} on ${lane.branch}`);
    if (issue !== undefined && !port.issueExists(issue)) {
        fail(`issue #${issue} does not exist in ${REQUIRED_REPOSITORY}`);
    }
    // Publishing never authors a commit message. The only subject this script could invent for
    // uncommitted work is some earlier commit's, which describes a different change; the operator
    // is the one who knows what the leftover files are.
    if (port.dirty(lane.path)) {
        fail(`${lane.branch} ${DIRTY_LANE_FAILURE}`);
    }
    const { ahead, behind } = port.aheadBehind(lane.path);
    if (behind !== 0 || ahead < 1) {
        fail('lane must be strictly ahead of origin/main');
    }
    const content = pullRequestContent(issue, lane, port);
    const headSha = port.headSha(lane.path);
    const remoteSha = port.remoteBranchSha(lane.branch);
    if (remoteSha !== undefined && !port.isAncestor(remoteSha, headSha, lane.path)) {
        fail(`refusing non-fast-forward push of ${lane.branch}`);
    }
    port.push(lane.path, lane.branch);
    const existing = port.existingOpenPullRequest(lane.branch);
    const number = pullRequestNumber(lane, content, existing, port);
    port.log(String(number));
    return number;
}

function pullRequestNumber(
    lane: ResolvedLane,
    content: PullRequestContent | undefined,
    existing: number | undefined,
    port: PublishLanePort
): number {
    if (content === undefined) {
        return legacyPullRequestNumber(lane, existing);
    }
    if (existing === undefined) {
        return port.createPullRequest({ branch: lane.branch, ...content });
    }
    port.updatePullRequest(existing, content);
    return existing;
}

type PullRequestContent = { title: string; body: string };

/**
 * The title and body to write, or `undefined` for a legacy lane, whose pull request this script must
 * not touch. `lane:publish` never authored that pull request — the branch predates the convention
 * and was unpublishable by it — and cannot reproduce it: `laneIssueNumber` reads only the
 * `agent/<issue>/` shape, so recomposing the body would put `None.` under Related tickets and sever
 * the `Closes #<issue>` a human wrote, and retitling from HEAD would rename it too. Parsing an issue
 * out of the branch slug instead is not the fix; the slug is nobody's record, and a rename would
 * then close the wrong ticket.
 *
 * That exemption covers the lane-subject rule too, and covers it by returning first. Deriving the
 * title from the newest non-merge commit above `origin/main`, and refusing a lane that has none,
 * both exist to name a title this script is about to write; a legacy lane writes none, so the port
 * is never asked and neither rule can fire. A legacy lane carrying only merges above `origin/main`
 * therefore still publishes, because pushing is the whole of what publishing it means.
 */
function pullRequestContent(
    issue: number | undefined,
    lane: ResolvedLane,
    port: PublishLanePort
): PullRequestContent | undefined {
    if (lane.legacy) {
        return undefined;
    }
    const title = port.laneSubject(lane.path);
    if (title === undefined) {
        fail(`${lane.branch} ${NO_LANE_SUBJECT_FAILURE}`);
    }
    assertConventionalSubject(title, 'pull-request title');
    // The update path overwrites the whole body, so an argumentless run on an issue lane would
    // strip `Closes #<issue>` off a pull request that already carried it. The resolved lane's own
    // branch is the issue of record; `None.` is only for a lane that genuinely has no issue.
    return { title, body: composePublishBody(issue ?? laneIssueNumber(lane.branch), title) };
}

/**
 * An open pull request for the exact branch is the only thing that authorized this push, and it was
 * proven before the push, not after. If it has closed in between there is nothing to update and
 * nothing this script may author, so it refuses rather than opening a replacement carrying a
 * regenerated body.
 */
function legacyPullRequestNumber(lane: ResolvedLane, existing: number | undefined): number {
    if (existing === undefined) {
        fail(
            `${lane.branch} no longer has an open pull request: it was pushed, but a pre-convention ` +
                `lane's pull request is not lane:publish's to open or rewrite`
        );
    }
    return existing;
}

/**
 * The pull-request title is squash-merged onto `main`, so it has to name the lane's work. Keeping a
 * published lane current means merging `origin/main` into it — rebasing would force a
 * non-fast-forward push — which leaves HEAD a merge commit, so HEAD alone titles the pull request
 * after the merge that carried it. Both halves of this argument list are load-bearing:
 * `--no-merges` skips the merge commits, and `origin/main..HEAD` keeps the walk inside the lane's
 * own commits. Without the range, a lane commit older than `origin/main`'s tip loses the date sort
 * and the title comes from a commit `main` already has.
 */
export const LANE_SUBJECT_ARGS = ['log', '-1', '--format=%s', '--no-merges', 'origin/main..HEAD'];

export function shellPort(session: GhSession, cwd: string = process.cwd()): PublishLanePort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const token = session.env.GH_TOKEN ?? '';
    const git = (args: string[], directory: string) =>
        spawnCapture('git', gitAuthenticatedArgs(token, session.configDir, args), {
            cwd: directory,
            env: session.env,
        });
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    const ghRun = (args: string[]) => spawnRun('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        fetchMain: () => {
            spawnRun(
                'git',
                gitAuthenticatedArgs(token, session.configDir, [
                    'fetch',
                    GITHUB_HTTPS_REMOTE,
                    '+refs/heads/main:refs/remotes/origin/main',
                ]),
                { cwd: primaryRoot, env: session.env }
            );
        },
        worktrees: () =>
            parsePublishWorktrees(spawnCapture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot })),
        cwd: () => cwd,
        issueExists: (issue) => {
            const result = spawnSync('gh', issueLookupArgs(issue), {
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
        aheadBehind: (lane) => {
            const output = spawnCapture('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], {
                cwd: lane,
            });
            const [behindText, aheadText] = output.split(/\s+/);
            const behind = Number(behindText);
            const ahead = Number(aheadText);
            if (!Number.isSafeInteger(behind) || !Number.isSafeInteger(ahead)) {
                fail('cannot prove lane ahead/behind origin/main');
            }
            return { ahead, behind };
        },
        dirty: (lane) =>
            spawnCapture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: lane }) !== '',
        laneSubject: (lane) => spawnCapture('git', LANE_SUBJECT_ARGS, { cwd: lane }) || undefined,
        headSha: (lane) => spawnCapture('git', ['rev-parse', 'HEAD'], { cwd: lane }),
        remoteBranchSha: (branch) => {
            const output = git(['ls-remote', GITHUB_HTTPS_REMOTE, `refs/heads/${branch}`], primaryRoot);
            if (output === '') {
                return undefined;
            }
            const sha = output.split(/\s+/)[0];
            return sha === undefined || sha === '' ? undefined : sha;
        },
        isAncestor: (ancestorSha, descendantSha, lane) => isAncestorCommit(lane, ancestorSha, descendantSha),
        push: (lane, branch) => {
            spawnRun(
                'git',
                gitAuthenticatedArgs(token, session.configDir, [
                    'push',
                    GITHUB_HTTPS_REMOTE,
                    `HEAD:refs/heads/${branch}`,
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
            return matchingOpenPullRequestNumber(rows, branch);
        },
        createPullRequest: ({ branch, title, body }) => {
            const url = gh([
                'pr',
                'create',
                '--repo',
                REQUIRED_REPOSITORY,
                '--base',
                'main',
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
        updatePullRequest: (number, { title, body }) => {
            ghRun(['pr', 'edit', String(number), '--repo', REQUIRED_REPOSITORY, '--title', title, '--body', body]);
        },
        log: (message) => {
            console.log(message);
        },
    };
}

function isAncestorCommit(lane: string, ancestorSha: string, descendantSha: string): boolean {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], {
        cwd: lane,
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
        'number,headRefName,isCrossRepository',
    ];
}

export type OpenPullRequestRow = { number: number; headRefName: string; isCrossRepository: boolean };

/**
 * `--head` narrows the request server-side, but proves nothing about *how* it narrows: `gh` does not
 * document whether it matches the branch exactly or as a prefix, and `--repo` scopes the base
 * repository, not the head repository, so a same-named branch on a fork could satisfy it too. This
 * result gates whether an off-convention, author-locked worktree may push (`resolveLegacyCandidate`'s
 * `hasOpenPullRequest`), so the match has to be proven client-side instead of trusted from the
 * server-side filter: only a row whose `headRefName` is exactly `branch` and whose `isCrossRepository`
 * is `false` counts. This also gates the ordinary update-vs-create path for conforming lanes, where a
 * `lane:publish` push always targets the same repository under the exact `agent/<issue>/<slug>`
 * branch name, so the tightened match changes nothing there.
 */
export function matchingOpenPullRequestNumber(rows: OpenPullRequestRow[], branch: string): number | undefined {
    const matches = rows.filter((row) => row.headRefName === branch && row.isCrossRepository === false);
    if (matches.length > 1) {
        fail(`branch ${branch} has more than one open pull request`);
    }
    return matches[0]?.number;
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

async function main(): Promise<number> {
    const parsed = parsePublishLaneArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log('Usage: pnpm lane:publish [issue-number]');
        return 0;
    }
    const executingFile = fileURLToPath(import.meta.url);
    const cwd = process.cwd();
    assertTrustedExecutingBlob('scripts/publishLane.ts', executingFile, originMainBlob('scripts/publishLane.ts', cwd));
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        const repository = spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
            env: auth.session.env,
            cwd: primaryRoot,
        });
        assertRequiredRepository(repository);
        if (auth.minted.login !== AUTHOR_BOT_LOGIN) {
            fail(`minted login ${auth.minted.login} is not ${AUTHOR_BOT_LOGIN}`);
        }
        publishLane(parsed.issue, shellPort(auth.session));
        return 0;
    } finally {
        auth.session.dispose();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
